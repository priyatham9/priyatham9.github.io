import { cash, pipeline } from "../labs/models.mjs";

export const VERSION = "1.0.0";
export const MAX_BODY = 4096;
const defaults = {
  finance: { revenue: 12000000, cogs: 7200000, dso: 45, dio: 60, dpo: 30 },
  crm: { cohort: "all", rate: 0.5 },
};
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const reply = (status, data, extra = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
function validate(body) {
  if (
    !record(body) ||
    Object.keys(body).some((k) => !["model", "inputs"].includes(k))
  )
    throw Error("Expected only model and inputs.");
  if (!Object.hasOwn(defaults, body.model))
    throw Error("Model must be finance or crm.");
  if (!record(body.inputs)) throw Error("Inputs must be an object.");
  const allowed = defaults[body.model];
  if (Object.keys(body.inputs).some((k) => !Object.hasOwn(allowed, k)))
    throw Error("Unknown input field.");
  const inputs = { ...allowed, ...body.inputs };
  for (const [key, value] of Object.entries(inputs)) {
    if (key === "cohort") {
      if (!["all", "inbound", "outbound"].includes(value))
        throw Error("Invalid cohort key.");
      continue;
    }
    const max =
      key === "rate" ? 1 : ["revenue", "cogs"].includes(key) ? 1e12 : 3650;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > max
    )
      throw Error(`${key} must be a finite number between 0 and ${max}.`);
  }
  return { model: body.model, inputs };
}
export async function handle(request) {
  if (request.method === "GET")
    return reply(200, { version: VERSION, synthetic: true, models: ["finance", "crm"] });
  if (request.method !== "POST")
    return reply(405, { error: "Use GET or POST." }, { Allow: "GET, POST" });
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    return reply(415, { error: "Content-Type must be application/json." });
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY))
    return reply(413, { error: "Request body exceeds 4096 bytes." });
  let body;
  try {
    const reader = request.body?.getReader();
    let size = 0;
    const chunks = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY) {
          await reader.cancel();
          return reply(413, { error: "Request body exceeds 4096 bytes." });
        }
        chunks.push(value);
      }
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    return reply(400, { error: "Body must contain valid JSON." });
  }
  try {
    const { model, inputs } = validate(body);
    const result =
      model === "finance" ? cash(inputs) : pipeline(inputs.cohort, inputs.rate);
    return reply(200, {
      version: VERSION,
      synthetic: true,
      model,
      inputs,
      result,
    });
  } catch (error) {
    return reply(400, { error: error.message });
  }
}
// Standard Node Vercel Function adapter; handle() remains independently testable.
export default async function handler(req, res) {
  try {
    const chunks = [];
    let size = 0;
    if (req.body !== undefined) {
      const raw =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      chunks.push(Buffer.from(raw));
      size = Buffer.byteLength(raw);
    } else
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) break;
        chunks.push(chunk);
      }
    if (size > MAX_BODY) {
      res.writeHead(413, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Request body exceeds 4096 bytes." }));
      return;
    }
    const method = req.method || "GET";
    const request = new Request("http://localhost/api/analysis", {
      method,
      headers: req.headers,
      ...(!["GET", "HEAD"].includes(method)
        ? { body: Buffer.concat(chunks) }
        : {}),
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch (error) {
    console.error("Analysis request failed", error.name);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unable to compute scenario." }));
  }
}
