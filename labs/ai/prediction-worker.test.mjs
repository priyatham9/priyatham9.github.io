import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { analyzeBytes } from "./prediction-worker.mjs";
import { PredictionWorkerClient } from "./prediction-worker-client.mjs";
import {
  parsePredictionCSV,
  evaluatePredictions,
} from "./prediction-model.mjs";
const bytes = (text) => new TextEncoder().encode(text).buffer;
const csv =
  '\uFEFFoutcome,score_a,score_b,record_id,group\r\n1,.5,1,"a,b",x\r\n0,.5,0,c,y\r\n';

test("worker analysis exactly equals the pure model, including original BOM/CRLF hash", async () => {
  const result = await analyzeBytes(bytes(csv));
  assert.deepEqual(
    result.audit,
    evaluatePredictions(parsePredictionCSV(csv).records),
  );
  assert.equal(result.sha256, createHash("sha256").update(csv).digest("hex"));
  assert.equal(result.byteLength, Buffer.byteLength(csv));
});
test("worker preserves all real public-sample results and verifies its manifest", async () => {
  const body = await readFile(
    new URL("./prediction-sample.csv", import.meta.url),
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("./prediction-sample.manifest.json", import.meta.url),
    ),
  );
  const result = await analyzeBytes(
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    manifest,
  );
  assert.deepEqual(
    result.audit,
    evaluatePredictions(parsePredictionCSV(body.toString()).records),
  );
  await assert.rejects(analyzeBytes(bytes(csv), manifest), /pinned manifest/);
  await assert.rejects(
    analyzeBytes(bytes(csv), {
      sha256: createHash("sha256").update(csv).digest("hex"),
      bytes: Buffer.byteLength(csv),
      rows: 9,
    }),
    /row count/,
  );
});
test("worker rejects invalid UTF-8, oversized bytes and actionable malformed rows", async () => {
  await assert.rejects(analyzeBytes(new Uint8Array([0xff]).buffer), /UTF-8/);
  await assert.rejects(
    analyzeBytes(new ArrayBuffer(10 * 1024 * 1024 + 1)),
    /10 MiB/,
  );
  await assert.rejects(
    analyzeBytes(bytes("outcome,score_a,score_b\n1,,.5")),
    (error) => error.row === 2 && Boolean(error.code),
  );
});
function harness() {
  const workers = [];
  const client = new PredictionWorkerClient(() => {
    const worker = {
      terminated: false,
      terminate() {
        this.terminated = true;
      },
      postMessage(message, transfer) {
        this.message = message;
        this.transfer = transfer;
      },
    };
    workers.push(worker);
    return worker;
  });
  return { client, workers };
}
test("cancellation terminates busy work; a late response cannot resolve its replacement", async () => {
  const { client, workers } = harness();
  const input = bytes(csv);
  const first = client.run(input);
  const rejected = assert.rejects(first, /canceled/);
  assert.equal(workers[0].transfer[0], input);
  client.stop();
  await rejected;
  assert.equal(workers[0].terminated, true);
  const second = client.run(bytes(csv));
  workers[0].onmessage({
    data: { id: workers[0].message.id, result: "stale" },
  });
  assert.ok(client.pending);
  workers[1].onmessage({
    data: { id: workers[1].message.id, result: "current" },
  });
  assert.equal(await second, "current");
});
test("worker errors fail closed, preserve diagnostics, and permit a fresh attempt", async () => {
  const { client, workers } = harness();
  const first = client.run(bytes(csv));
  workers[0].onmessage({
    data: {
      id: workers[0].message.id,
      error: { message: "Bad score", code: "score", row: 2, column: 3 },
    },
  });
  await assert.rejects(
    first,
    (e) => e.code === "score" && e.row === 2 && e.column === 3,
  );
  const second = client.run(bytes(csv));
  workers[0].onerror({ preventDefault() {} });
  await assert.rejects(second, /worker could not run/);
  assert.equal(client.worker, null);
  const third = client.run(bytes(csv));
  workers[1].onmessage({
    data: { id: workers[1].message.id, result: "recovered" },
  });
  assert.equal(await third, "recovered");
});
test("unavailable Worker and failed message transfer reject rather than run on UI thread", async () => {
  const client = new PredictionWorkerClient(() => {
    throw Error("unavailable");
  });
  await assert.rejects(client.run(bytes(csv)), /unavailable/);
  const { client: c, workers } = harness();
  workers[0].postMessage = () => {
    throw Error("clone failed");
  };
  await assert.rejects(c.run(bytes(csv)), /clone failed/);
  assert.equal(workers[0].terminated, true);
});
