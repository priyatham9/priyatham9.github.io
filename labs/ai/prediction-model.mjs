// Local prediction audit. CSV is parsed as data; no expressions are evaluated.
export const LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxRows: 100000,
  maxGroups: 200,
  maxTextLength: 512,
});
export const BUDGET_FRACTIONS = Object.freeze([0.05, 0.1, 0.2]);
const HEADERS = ["outcome", "score_a", "score_b", "record_id", "group"];
const EDGES = Object.freeze([
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
]);

export class PredictionAuditError extends Error {
  constructor(code, message, { row = null, column = null } = {}) {
    super(message);
    this.name = "PredictionAuditError";
    this.code = code;
    this.row = row;
    this.column = column;
  }
}
function fail(code, message, location) {
  throw new PredictionAuditError(code, message, location);
}
function checkLimit(value, hardLimit, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > hardLimit)
    fail(
      "LIMIT_CONFIGURATION",
      `${name} must be a positive integer no greater than ${hardLimit}.`,
    );
}
function textField(value, location) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string")
    fail(
      "TEXT_TYPE",
      "Record IDs and group labels must be text or null.",
      location,
    );
  let length = 0;
  for (const _character of value)
    if (++length > LIMITS.maxTextLength)
      fail(
        "TEXT_LENGTH",
        `Record IDs and group labels are limited to ${LIMITS.maxTextLength} Unicode characters.`,
        location,
      );
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value))
    fail(
      "CONTROL_CHARACTER",
      "Text contains an unsupported control character.",
      location,
    );
  return value.trim() === "" ? null : value;
}
function parseScore(raw, location) {
  const token = raw.trim();
  if (!token)
    fail(
      "MISSING_VALUE",
      "A score is missing; no rows are silently removed.",
      location,
    );
  const match =
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/u.exec(token);
  if (!match)
    fail(
      "INVALID_SCORE",
      "Scores must be finite decimal numbers between 0 and 1; hexadecimal, NaN and Infinity are not accepted.",
      location,
    );
  const whole = match[2] || "",
    fractional = match[3] ?? match[4] ?? "";
  const digits = whole + fractional;
  const firstNonzero = digits.search(/[1-9]/u);
  if (firstNonzero === -1) return 0;
  // Check mathematical decimal range BEFORE IEEE-754 rounding/underflow.
  if (match[1] === "-")
    fail(
      "SCORE_RANGE",
      "A negative score is outside [0, 1], even if it would round to negative zero.",
      location,
    );
  const exponent = match[5] ? Number(match[5]) : 0;
  const decimalOrder = whole.length - firstNonzero + exponent;
  const significant = digits.slice(firstNonzero);
  if (decimalOrder > 1 || (decimalOrder === 1 && !/^10*$/u.test(significant)))
    fail(
      "SCORE_RANGE",
      "A score exceeds 1 in the source text, even if numeric conversion would round it to 1.",
      location,
    );
  const value = Number(token);
  if (!Number.isFinite(value) || value < 0 || value > 1)
    fail("SCORE_RANGE", "Scores must be finite and between 0 and 1.", location);
  if (value === 0)
    fail(
      "SCORE_UNDERFLOW",
      "A nonzero score is too small for the supported numeric representation; use a representable decimal value.",
      location,
    );
  return value;
}

/** Strict RFC-style quoted fields, LF/CRLF records, and an optional leading BOM.
 * Error row numbers count logical CSV rows (header = 1), including quoted newlines.
 * Required headers are exact; optional missing/blank IDs and groups become null.
 */
export function parsePredictionCSV(
  text,
  { maxBytes = LIMITS.maxBytes, maxRows = LIMITS.maxRows } = {},
) {
  checkLimit(maxBytes, LIMITS.maxBytes, "maxBytes");
  checkLimit(maxRows, LIMITS.maxRows, "maxRows");
  if (typeof text !== "string")
    fail("TEXT_REQUIRED", "CSV input must be UTF-8 text.");
  if (text.length > maxBytes)
    fail("BYTE_LIMIT", `CSV exceeds the ${maxBytes}-byte limit.`);
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes)
    fail("BYTE_LIMIT", `CSV exceeds the ${maxBytes}-byte UTF-8 limit.`);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.length)
    fail(
      "EMPTY_CSV",
      "CSV is empty; provide a header and at least one data row.",
    );
  let position = 0,
    logicalRow = 0,
    columns = null;
  const records = [],
    groups = new Set();
  function field(column) {
    const location = { row: logicalRow + 1, column };
    if (text[position] === '"') {
      position++;
      let start = position;
      const chunks = [];
      while (true) {
        const quote = text.indexOf('"', position);
        if (quote < 0)
          fail(
            "UNCLOSED_QUOTE",
            "Quoted field reaches the end of the file without a closing quote.",
            location,
          );
        chunks.push(text.slice(start, quote));
        if (text[quote + 1] === '"') {
          chunks.push('"');
          position = quote + 2;
          start = position;
          continue;
        }
        position = quote + 1;
        if (
          position < text.length &&
          ![",", "\r", "\n"].includes(text[position])
        )
          fail(
            "AFTER_QUOTE",
            "A closing quote must be followed immediately by a comma, newline or end of file.",
            location,
          );
        return chunks.join("");
      }
    }
    const start = position;
    while (
      position < text.length &&
      ![",", "\r", "\n"].includes(text[position])
    ) {
      if (text[position] === '"')
        fail(
          "UNEXPECTED_QUOTE",
          "A quote inside an unquoted field is invalid; quote the complete field and double embedded quotes.",
          location,
        );
      position++;
    }
    return text.slice(start, position);
  }
  while (position < text.length) {
    const values = [];
    while (true) {
      values.push(field(values.length + 1));
      if (values.length > HEADERS.length)
        fail(
          "COLUMN_COUNT",
          "Only outcome, score_a, score_b, record_id and group columns are supported.",
          { row: logicalRow + 1 },
        );
      if (text[position] === ",") {
        position++;
        continue;
      }
      if (text[position] === "\r") {
        if (text[position + 1] !== "\n")
          fail(
            "BARE_CR",
            "Use LF or CRLF record endings; an unquoted bare carriage return is not accepted.",
            { row: logicalRow + 1 },
          );
        position += 2;
      } else if (text[position] === "\n") position++;
      break;
    }
    logicalRow++;
    if (columns === null) {
      columns = values;
      if (new Set(columns).size !== columns.length)
        fail("DUPLICATE_HEADER", "CSV header names must be unique.", {
          row: 1,
        });
      if (columns.some((name) => !HEADERS.includes(name)))
        fail(
          "UNKNOWN_HEADER",
          `Header names must be exactly ${HEADERS.join(", ")}; the last two are optional.`,
          { row: 1 },
        );
      for (const required of HEADERS.slice(0, 3))
        if (!columns.includes(required))
          fail("MISSING_HEADER", `Required column ${required} is missing.`, {
            row: 1,
            column: required,
          });
      continue;
    }
    if (values.length !== columns.length)
      fail(
        "COLUMN_COUNT",
        `Expected ${columns.length} fields but found ${values.length}; blank records are not skipped.`,
        { row: logicalRow },
      );
    if (records.length >= maxRows)
      fail(
        "ROW_LIMIT",
        `CSV exceeds the ${maxRows}-record limit. No partial analysis is returned.`,
        { row: logicalRow },
      );
    const cells = Object.fromEntries(
      columns.map((name, index) => [name, values[index]]),
    );
    const outcomeToken = cells.outcome.trim();
    if (!["0", "1"].includes(outcomeToken))
      fail(
        outcomeToken ? "INVALID_OUTCOME" : "MISSING_VALUE",
        "Outcome must be the literal 0 or 1; blank values, decimal variants and other labels are rejected.",
        { row: logicalRow, column: "outcome" },
      );
    const record = {
      ordinal: records.length + 1,
      recordId: textField(cells.record_id, {
        row: logicalRow,
        column: "record_id",
      }),
      group: textField(cells.group, { row: logicalRow, column: "group" }),
      outcome: Number(outcomeToken),
      scoreA: parseScore(cells.score_a, { row: logicalRow, column: "score_a" }),
      scoreB: parseScore(cells.score_b, { row: logicalRow, column: "score_b" }),
    };
    groups.add(record.group);
    if (groups.size > LIMITS.maxGroups)
      fail(
        "GROUP_LIMIT",
        `At most ${LIMITS.maxGroups} distinct groups, including missing/ungrouped records, are supported. Reduce group granularity; groups are never silently truncated.`,
        { row: logicalRow, column: "group" },
      );
    records.push(record);
  }
  if (!records.length)
    fail("EMPTY_COHORT", "CSV must contain at least one complete data row.");
  return {
    records,
    columns,
    byteLength,
    hasGroupColumn: columns.includes("group"),
    distinctGroups: groups.size,
  };
}

function budgetFraction(value) {
  if (!BUDGET_FRACTIONS.includes(value))
    fail(
      "BUDGET_FRACTION",
      "Budget fraction must be exactly 0.05, 0.10 or 0.20.",
    );
  return value;
}
function validatedRecords(input) {
  if (!Array.isArray(input) || input.length === 0)
    fail("EMPTY_COHORT", "At least one paired prediction record is required.");
  if (input.length > LIMITS.maxRows)
    fail("ROW_LIMIT", `At most ${LIMITS.maxRows} records are supported.`);
  const groups = new Set();
  return input.map((row, index) => {
    const location = { row: index + 1 };
    if (!row || typeof row !== "object" || row.ordinal !== index + 1)
      fail(
        "ORDINAL",
        "Record ordinals must be consecutive source-order integers starting at 1.",
        location,
      );
    if (row.outcome !== 0 && row.outcome !== 1)
      fail(
        "INVALID_OUTCOME",
        "Every outcome must be numeric 0 or 1.",
        location,
      );
    for (const key of ["scoreA", "scoreB"])
      if (
        typeof row[key] !== "number" ||
        !Number.isFinite(row[key]) ||
        row[key] < 0 ||
        row[key] > 1
      )
        fail("INVALID_SCORE", `${key} must be a finite number in [0, 1].`, {
          ...location,
          column: key,
        });
    const clean = {
      ordinal: row.ordinal,
      recordId: textField(row.recordId, location),
      group: textField(row.group, location),
      outcome: row.outcome,
      scoreA: row.scoreA === 0 ? 0 : row.scoreA,
      scoreB: row.scoreB === 0 ? 0 : row.scoreB,
    };
    groups.add(clean.group);
    if (groups.size > LIMITS.maxGroups)
      fail(
        "GROUP_LIMIT",
        `At most ${LIMITS.maxGroups} distinct groups, including missing/ungrouped records, are supported.`,
      );
    return clean;
  });
}
function ordering(records, key) {
  return records
    .map((_, index) => index)
    .sort(
      (a, b) =>
        records[b][key] - records[a][key] ||
        records[a].ordinal - records[b].ordinal,
    );
}
function add(sum, compensation, value) {
  const corrected = value - compensation,
    next = sum + corrected;
  return [next, next - sum - corrected];
}
function metrics(records, key, order, includeDetails) {
  const positives = records.reduce((sum, row) => sum + row.outcome, 0);
  let averagePrecision = positives ? 0 : null,
    seenPositives = 0,
    seen = 0,
    apCorrection = 0;
  while (seen < order.length) {
    const score = records[order[seen]][key];
    let end = seen,
      groupPositives = 0;
    while (end < order.length && records[order[end]][key] === score)
      groupPositives += records[order[end++]].outcome;
    seenPositives += groupPositives;
    if (positives)
      [averagePrecision, apCorrection] = add(
        averagePrecision,
        apCorrection,
        (groupPositives / positives) * (seenPositives / end),
      );
    seen = end;
  }
  let errorSum = 0,
    errorCorrection = 0;
  const bins = includeDetails
    ? EDGES.slice(0, -1).map((lower, index) => ({
        index,
        lower,
        upper: EDGES[index + 1],
        n: 0,
        positives: 0,
        sum: 0,
        correction: 0,
      }))
    : null;
  for (const row of records) {
    const score = row[key];
    [errorSum, errorCorrection] = add(
      errorSum,
      errorCorrection,
      (score - row.outcome) ** 2,
    );
    if (bins) {
      // Explicit boundaries avoid score*10 rounding a value below .9 into bin 9.
      let bin = 0;
      while (bin < 9 && score >= EDGES[bin + 1]) bin++;
      const b = bins[bin];
      b.n++;
      b.positives += row.outcome;
      [b.sum, b.correction] = add(b.sum, b.correction, score);
    }
  }
  const result = {
    averagePrecision,
    brier: errorSum / records.length,
    topBudget: null,
  };
  if (includeDetails) {
    result.calibration = bins.map(
      ({ index, lower, upper, n, positives: count, sum }) => ({
        index,
        lower,
        upper,
        n,
        positives: count,
        meanProbability: n ? sum / n : null,
        observedRate: n ? count / n : null,
      }),
    );
    result.ranks = Array(records.length);
    order.forEach((recordIndex, rank) => {
      result.ranks[recordIndex] = rank + 1;
    });
  }
  return result;
}
function topBudget(
  n,
  positives,
  fraction,
  captured,
  cutoffScore,
  boundaryTieSize,
  aboveBoundary,
) {
  const count = Math.ceil(n * fraction);
  return {
    fraction,
    count,
    positives: captured,
    precision: captured / count,
    recall: positives ? captured / positives : null,
    cutoffScore,
    boundaryTieSize,
    boundaryTieSelected: count - aboveBoundary,
  };
}
/** Reuses cached ranks and metrics; O(N) scans, no refits, sorting, or subgroup filters. */
export function changeBudget(audit, fraction = 0.1) {
  budgetFraction(fraction);
  if (
    !audit ||
    audit.schemaVersion !== "prediction-audit/1" ||
    !Array.isArray(audit.records) ||
    audit.n !== audit.records.length ||
    audit.n < 1
  )
    fail(
      "AUDIT_REQUIRED",
      "changeBudget requires a complete evaluatePredictions result.",
    );
  const records = audit.records,
    mainCount = Math.ceil(audit.n * fraction);
  const groups = audit.groups.map((group) => ({ ...group })),
    groupStates = new Map(
      groups.map((group) => [
        group.group,
        {
          n: group.n,
          positives: group.positives,
          count: Math.ceil(group.n * fraction),
        },
      ]),
    );
  const models = {};
  for (const [model, key] of [
    ["a", "scoreA"],
    ["b", "scoreB"],
  ]) {
    const ranks = audit.models[model].ranks;
    if (!Array.isArray(ranks) || ranks.length !== audit.n)
      fail("RANKS_REQUIRED", "Cached rank length does not match the cohort.");
    const order = new Int32Array(audit.n),
      seenRanks = new Uint8Array(audit.n);
    ranks.forEach((rank, index) => {
      if (
        !Number.isInteger(rank) ||
        rank < 1 ||
        rank > audit.n ||
        seenRanks[rank - 1]
      )
        fail(
          "RANKS_REQUIRED",
          "Cached ranks must form a complete permutation.",
        );
      seenRanks[rank - 1] = 1;
      order[rank - 1] = index;
    });
    for (const state of groupStates.values())
      Object.assign(state, {
        seen: 0,
        captured: 0,
        cutoff: null,
        ties: 0,
        above: 0,
      });
    let captured = 0,
      ties = 0,
      above = 0;
    const cutoff = records[order[mainCount - 1]][key];
    order.forEach((index, rank) => {
      const row = records[index],
        state = groupStates.get(row.group);
      state.seen++;
      if (rank < mainCount) captured += row.outcome;
      if (state.seen <= state.count) {
        state.captured += row.outcome;
        state.cutoff = row[key];
      }
    });
    for (const row of records) {
      if (row[key] === cutoff) ties++;
      if (row[key] > cutoff) above++;
      const state = groupStates.get(row.group);
      if (row[key] === state.cutoff) state.ties++;
      if (row[key] > state.cutoff) state.above++;
    }
    models[model] = {
      ...audit.models[model],
      topBudget: topBudget(
        audit.n,
        audit.positives,
        fraction,
        captured,
        cutoff,
        ties,
        above,
      ),
    };
    for (const group of groups) {
      const s = groupStates.get(group.group);
      group[model] = {
        ...group[model],
        topBudget: topBudget(
          s.n,
          s.positives,
          fraction,
          s.captured,
          s.cutoff,
          s.ties,
          s.above,
        ),
      };
    }
  }
  return {
    ...audit,
    budgetFraction: fraction,
    models,
    groups,
    deltas: {
      averagePrecision:
        models.a.averagePrecision === null
          ? null
          : models.b.averagePrecision - models.a.averagePrecision,
      brier: models.b.brier - models.a.brier,
      precisionAtBudget:
        models.b.topBudget.precision - models.a.topBudget.precision,
    },
  };
}
/** Both models always use the complete paired cohort; group summaries are explicit subsets. */
export function evaluatePredictions(
  input,
  { budgetFraction: fraction = 0.1 } = {},
) {
  budgetFraction(fraction);
  const records = validatedRecords(input),
    positives = records.reduce((sum, row) => sum + row.outcome, 0);
  const groups = new Map();
  for (const row of records) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  const result = {
    schemaVersion: "prediction-audit/1",
    n: records.length,
    positives,
    prevalence: positives / records.length,
    budgetFraction: fraction,
    records,
    models: {},
    deltas: null,
    groups: [],
  };
  for (const [model, key] of [
    ["a", "scoreA"],
    ["b", "scoreB"],
  ])
    result.models[model] = metrics(records, key, ordering(records, key), true);
  for (const [group, members] of groups) {
    const count = members.reduce((sum, row) => sum + row.outcome, 0);
    result.groups.push({
      group,
      n: members.length,
      positives: count,
      prevalence: count / members.length,
      a: metrics(members, "scoreA", ordering(members, "scoreA"), false),
      b: metrics(members, "scoreB", ordering(members, "scoreB"), false),
    });
  }
  return changeBudget(result, fraction);
}
function spreadsheetText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /^[\t\r\n]/u.test(text) || /^\s*[=+\-@]/u.test(text)
    ? `'${text}`
    : text;
}
function quoted(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
/** Caller explicitly supplies all records or a visible subset. JSON preserves original IDs.
 * CSV prefixes potentially active text cells with an apostrophe for spreadsheet safety.
 */
export function exportRecordsCSV(records, { includeHeader = true } = {}) {
  if (!Array.isArray(records) || records.length > LIMITS.maxRows)
    fail("ROW_LIMIT", "CSV export must be an array of at most 100000 records.");
  const lines = includeHeader ? [HEADERS.join(",")] : [];
  for (const row of records) {
    if (
      !row ||
      ![0, 1].includes(row.outcome) ||
      ["scoreA", "scoreB"].some(
        (key) =>
          typeof row[key] !== "number" ||
          !Number.isFinite(row[key]) ||
          row[key] < 0 ||
          row[key] > 1,
      )
    )
      fail("INVALID_RECORD", "Cannot export an invalid prediction record.");
    const id = textField(row.recordId),
      group = textField(row.group);
    lines.push(
      [
        row.outcome,
        row.scoreA,
        row.scoreB,
        quoted(spreadsheetText(id)),
        quoted(spreadsheetText(group)),
      ].join(","),
    );
  }
  return lines.join("\r\n") + (lines.length ? "\r\n" : "");
}
