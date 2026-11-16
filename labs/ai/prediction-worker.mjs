import {
  LIMITS,
  parsePredictionCSV,
  evaluatePredictions,
} from "./prediction-model.mjs";

// The same pure interpreter runs off the UI thread. No network or storage API is
// used here; transferred input bytes remain inside this browser's worker.
export async function analyzeBytes(bytes, exampleManifest = null) {
  if (!(bytes instanceof ArrayBuffer))
    throw Error("Expected original file bytes.");
  const byteLength = bytes.byteLength;
  if (byteLength > LIMITS.maxBytes)
    throw Error("The original file exceeds the 10 MiB byte limit.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  if (
    exampleManifest &&
    (!exampleManifest.sha256 ||
      exampleManifest.sha256 !== sha256 ||
      exampleManifest.bytes !== byteLength)
  )
    throw Error("The public example bytes do not match their pinned manifest.");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw Error("The file is not valid UTF-8 text.");
  }
  const parsed = parsePredictionCSV(text);
  if (exampleManifest && parsed.records.length !== exampleManifest.rows)
    throw Error("The public example row count does not match its manifest.");
  return {
    audit: evaluatePredictions(parsed.records, { budgetFraction: 0.1 }),
    columns: parsed.columns,
    byteLength,
    sha256,
  };
}

if (typeof self !== "undefined" && typeof document === "undefined") {
  self.onmessage = async ({ data }) => {
    try {
      const result = await analyzeBytes(data.bytes, data.exampleManifest);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      // Error's custom fields are not preserved by structured clone. Keep the
      // parser's actionable row/column/code without transmitting any input row.
      self.postMessage({
        id: data.id,
        error: {
          message: error.message,
          code: error.code,
          row: error.row,
          column: error.column,
        },
      });
    }
  };
}
