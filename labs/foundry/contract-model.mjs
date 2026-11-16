// Independent, local-only contract interpreter. No expressions are evaluated as code.
// Reachability is exact for declared dependency edges; it is a recheck set, not
// a claim that every reachable consumer changes numerically.
const clone = (x) => JSON.parse(JSON.stringify(x));
const idOK = (x) =>
  typeof x === "string" &&
  /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(x) &&
  !["constructor", "prototype"].includes(x);
const own = (x, k) => Object.hasOwn(x, k);
const ownValue = (x, k) => (own(x, k) ? x[k] : undefined);
const shape = (condition, message) => {
  if (!condition) throw new RangeError(message);
};
const signatureKeys = ["unit", "concept", "grain", "aggregation"];
export function canonicalJSON(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`)
      .join(",")}}`;
  throw new RangeError("Contracts must contain finite JSON values only");
}
const fieldKey = (o, f) => `field:${o}:${f}`;
const linkKey = (o, l) => `link:${o}:${l}`;
const metricKey = (id) => `metric:${id}`;
const actionKey = (id) => `action:${id}`;
const sorted = (xs) => [...xs].sort();
const sig = (x) => ({
  ...Object.fromEntries(signatureKeys.map((k) => [k, x[k]])),
  ...(own(x, "rateScale") ? { rateScale: x.rateScale } : {}),
});
const mismatchKeys = (a, b) =>
  [...signatureKeys, "rateScale"].filter(
    (k) => (a[k] ?? null) !== (b[k] ?? null),
  );
function validateSignature(value, label) {
  shape(
    value &&
      signatureKeys.every(
        (k) =>
          typeof value[k] === "string" &&
          value[k].length > 0 &&
          value[k].length < 100,
      ),
    `${label} needs unit, concept, grain and aggregation.`,
  );
  shape(
    ["additive", "nonadditive"].includes(value.aggregation),
    `${label}: aggregation must be additive or nonadditive.`,
  );
  if (own(value, "rateScale"))
    shape(
      Number.isFinite(value.rateScale) && value.rateScale > 0,
      `${label}: rateScale must be positive.`,
    );
}
function indexed(list, label) {
  shape(
    Array.isArray(list) && list.length <= 100,
    `${label} must be an array with at most 100 entries.`,
  );
  const map = new Map();
  for (const item of list) {
    shape(item && idOK(item.id), `${label} has an invalid ID.`);
    shape(!map.has(item.id), `${label} contains duplicate ID ${item.id}.`);
    map.set(item.id, item);
  }
  return map;
}
function validateShape(c) {
  shape(c && c.contractVersion === 1, "contractVersion must be 1.");
  shape(
    typeof c.name === "string" && typeof c.provenance === "string",
    "A contract needs a name and provenance statement.",
  );
  shape(
    c.units &&
      typeof c.units === "object" &&
      !Array.isArray(c.units) &&
      Object.keys(c.units).length <= 100,
    "Declare a unit catalog with at most 100 entries.",
  );
  for (const [id, u] of Object.entries(c.units)) {
    shape(
      idOK(id) &&
        u &&
        Number.isFinite(u.scale) &&
        u.scale > 0 &&
        u.dimensions &&
        typeof u.dimensions === "object" &&
        !Array.isArray(u.dimensions),
      `Unit ${id} needs a positive canonical scale and dimension vector.`,
    );
    shape(
      Object.keys(u.dimensions).length <= 20 &&
        Object.entries(u.dimensions).every(
          ([d, p]) => idOK(d) && Number.isInteger(p) && Math.abs(p) <= 8,
        ),
      `Unit ${id} has an invalid dimension vector.`,
    );
  }
  shape(
    c.ratioConcepts &&
      typeof c.ratioConcepts === "object" &&
      !Array.isArray(c.ratioConcepts) &&
      Object.keys(c.ratioConcepts).length <= 100,
    "Declare ratioConcepts for rate output semantics.",
  );
  for (const [id, r] of Object.entries(c.ratioConcepts))
    shape(
      idOK(id) &&
        r &&
        typeof r.numerator === "string" &&
        typeof r.denominator === "string",
      `Ratio concept ${id} needs numerator and denominator concept roles.`,
    );
  const types = indexed(c.types, "types"),
    objects = indexed(c.objects, "objects"),
    metrics = indexed(c.metrics, "metrics"),
    actions = indexed(c.actions, "actions");
  shape(types.size > 0, "Declare at least one object type.");
  for (const t of types.values()) {
    shape(
      t.fields &&
        typeof t.fields === "object" &&
        !Array.isArray(t.fields) &&
        Object.keys(t.fields).length <= 40,
      `${t.id}: invalid fields.`,
    );
    shape(
      t.links &&
        typeof t.links === "object" &&
        !Array.isArray(t.links) &&
        Object.keys(t.links).length <= 20,
      `${t.id}: invalid links.`,
    );
    for (const [name, f] of Object.entries(t.fields)) {
      shape(
        idOK(name) && f && ["number", "string"].includes(f.kind),
        `${t.id}.${name}: invalid field kind or ID.`,
      );
      validateSignature(f, `${t.id}.${name}`);
      if (own(f, "min"))
        shape(
          f.kind === "number" && Number.isFinite(f.min),
          `${name}: min applies only to finite numbers.`,
        );
      if (own(f, "integer"))
        shape(
          f.kind === "number" && typeof f.integer === "boolean",
          `${name}: integer is a boolean constraint on number fields.`,
        );
    }
    for (const [name, l] of Object.entries(t.links))
      shape(
        idOK(name) &&
          l &&
          idOK(l.targetType) &&
          typeof l.required === "boolean",
        `${t.id}.${name}: link needs targetType and required.`,
      );
    shape(
      !Object.keys(t.links).some((k) => own(t.fields, k)),
      `${t.id}: field and link names must be distinct.`,
    );
    shape(
      Array.isArray(t.uniqueBy) &&
        t.uniqueBy.length <= 60 &&
        new Set(t.uniqueBy).size === t.uniqueBy.length &&
        t.uniqueBy.every(
          (k) => idOK(k) && (own(t.fields, k) || own(t.links, k)),
        ),
      `${t.id}: uniqueBy must name distinct declared fields/links.`,
    );
  }
  for (const o of objects.values())
    shape(
      idOK(o.type) &&
        o.fields &&
        typeof o.fields === "object" &&
        !Array.isArray(o.fields) &&
        o.links &&
        typeof o.links === "object" &&
        !Array.isArray(o.links),
      `${o.id}: object needs type, fields and links.`,
    );
  for (const m of metrics.values()) {
    shape(
      ["sum", "rate"].includes(m.operation),
      `${m.id}: supported operations are sum and rate.`,
    );
    shape(
      typeof m.label === "string" && typeof m.critical === "boolean",
      `${m.id}: label and critical are required.`,
    );
    shape(
      Array.isArray(m.inputs) && m.inputs.length > 0 && m.inputs.length <= 100,
      `${m.id}: inputs must be nonempty.`,
    );
    if (m.operation === "rate") {
      shape(
        m.inputs.length === 2,
        `${m.id}: rate requires numerator then denominator.`,
      );
      shape(
        Number.isFinite(m.scale) && m.scale > 0,
        `${m.id}: rate scale must be positive.`,
      );
    }
    if (m.operation === "sum")
      shape(
        Array.isArray(m.preserveKeys) &&
          m.preserveKeys.length <= 60 &&
          new Set(m.preserveKeys).size === m.preserveKeys.length &&
          m.preserveKeys.every(idOK),
        `${m.id}: sum needs distinct preserveKeys (context dimensions that must remain equal).`,
      );
    validateSignature(m.output, `${m.id} output`);
    for (const input of m.inputs) {
      shape(
        input &&
          ((idOK(input.object) && idOK(input.field) && !own(input, "metric")) ||
            (idOK(input.metric) &&
              !own(input, "object") &&
              !own(input, "field"))),
        `${m.id}: each input is a field reference or metric reference.`,
      );
      validateSignature(input.expect, `${m.id} input expectation`);
    }
  }
  for (const a of actions.values()) {
    shape(
      idOK(a.metric) &&
        typeof a.label === "string" &&
        a.operator === "gte" &&
        Number.isFinite(a.threshold) &&
        typeof a.critical === "boolean",
      `${a.id}: action needs metric, gte operator, finite threshold and critical.`,
    );
    validateSignature(a.expect, `${a.id} expected metric signature`);
  }
  canonicalJSON(c);
  return {
    types,
    objects,
    metrics,
    actions,
    units: new Map(Object.entries(c.units)),
    ratioConcepts: new Map(Object.entries(c.ratioConcepts)),
  };
}
export function evaluateContract(contract) {
  const { types, objects, metrics, actions, units, ratioConcepts } =
    validateShape(contract);
  const nodes = new Map(),
    edges = new Map(),
    diagnostics = [],
    nodeErrors = new Map(),
    results = new Map();
  const add = (id, kind, label, data) =>
    nodes.set(id, { id, kind, label, fingerprint: canonicalJSON(data) });
  const edge = (from, to) => {
    if (!edges.has(from)) edges.set(from, new Set());
    edges.get(from).add(to);
  };
  const problem = (node, code, message, critical = true) => {
    const d = { node, code, message, critical };
    diagnostics.push(d);
    if (!nodeErrors.has(node)) nodeErrors.set(node, []);
    nodeErrors.get(node).push(d);
    return d;
  };
  add("contract", "metadata", "Contract description", {
    name: contract.name,
    provenance: contract.provenance,
  });
  for (const [id, u] of units)
    add(`unit:${id}`, "unit", `${id} unit definition`, u);
  for (const [id, r] of ratioConcepts)
    add(`ratio:${id}`, "concept", `${id} ratio roles`, r);
  for (const t of types.values()) {
    add(`type:${t.id}`, "schema", `${t.id} identity contract`, {
      uniqueBy: t.uniqueBy,
    });
    add(`unique:${t.id}`, "constraint", `${t.id} uniqueness`, {
      uniqueBy: t.uniqueBy,
    });
    edge(`type:${t.id}`, `unique:${t.id}`);
    for (const [f, spec] of Object.entries(t.fields)) {
      add(`schema:${t.id}:${f}`, "schema", `${t.id}.${f} field contract`, spec);
      edge(`unit:${spec.unit}`, `schema:${t.id}:${f}`);
      if (!units.has(spec.unit))
        problem(
          `schema:${t.id}:${f}`,
          "unknown-unit",
          `Field unit ${spec.unit} is absent from the unit catalog.`,
        );
    }
    for (const [l, spec] of Object.entries(t.links)) {
      add(
        `schema-link:${t.id}:${l}`,
        "schema",
        `${t.id}.${l} link contract`,
        spec,
      );
      if (!types.has(spec.targetType))
        problem(
          `schema-link:${t.id}:${l}`,
          "unknown-target-type",
          `Link target type ${spec.targetType} is not declared.`,
        );
    }
  }
  function contextDependencies(o, t) {
    return t.uniqueBy.map((k) =>
      own(t.fields, k) ? fieldKey(o.id, k) : linkKey(o.id, k),
    );
  }
  for (const o of objects.values()) {
    const objectNode = `object:${o.id}`;
    add(objectNode, "object", o.id, { type: o.type });
    edge(`type:${o.type}`, objectNode);
    const t = types.get(o.type);
    if (!t) {
      problem(
        objectNode,
        "unknown-type",
        `${o.id} uses undeclared type ${o.type}.`,
      );
      continue;
    }
    for (const [name, spec] of Object.entries(t.fields)) {
      const key = fieldKey(o.id, name),
        value = ownValue(o.fields, name);
      add(key, "field", `${o.id}.${name}`, own(o.fields, name) ? value : null);
      edge(objectNode, key);
      edge(`schema:${o.type}:${name}`, key);
      if (
        !own(o.fields, name) ||
        typeof value !== spec.kind ||
        (spec.kind === "number" &&
          (!Number.isFinite(value) ||
            (spec.integer && !Number.isSafeInteger(value)) ||
            (own(spec, "min") && value < spec.min)))
      )
        problem(
          key,
          "invalid-field",
          `${o.id}.${name} must be a ${spec.integer ? "safe integer" : spec.kind}${own(spec, "min") ? ` ≥ ${spec.min}` : ""}. Missing values are not zero.`,
        );
    }
    for (const name of Object.keys(o.fields))
      if (!own(t.fields, name)) {
        const key = fieldKey(o.id, name);
        add(key, "field", `${o.id}.${name} (undeclared)`, o.fields[name]);
        edge(objectNode, key);
        edge(`schema:${o.type}:${name}`, key);
        problem(
          key,
          "undeclared-field",
          `${o.id}.${name} has no declared field contract.`,
        );
      }
    for (const [name, spec] of Object.entries(t.links)) {
      const key = linkKey(o.id, name),
        target = own(o.links, name) ? o.links[name] : undefined;
      add(key, "link", `${o.id}.${name}`, target ?? null);
      edge(objectNode, key);
      edge(`schema-link:${o.type}:${name}`, key);
      if (typeof target === "string") edge(`object:${target}`, key);
      if (
        !types.has(spec.targetType) ||
        (spec.required && !target) ||
        (target != null &&
          (!objects.has(target) ||
            objects.get(target).type !== spec.targetType))
      )
        problem(
          key,
          "broken-reference",
          `${o.id}.${name} must reference an existing declared ${spec.targetType}; received ${target === undefined ? "missing" : canonicalJSON(target)}.`,
        );
    }
    for (const name of Object.keys(o.links))
      if (!own(t.links, name)) {
        const key = linkKey(o.id, name);
        add(key, "link", `${o.id}.${name} (undeclared)`, o.links[name]);
        edge(objectNode, key);
        problem(
          key,
          "undeclared-link",
          `${o.id}.${name} has no declared link contract.`,
        );
      }
    for (const key of contextDependencies(o, t)) edge(key, `unique:${o.type}`);
    for (const k of t.uniqueBy) {
      const value = own(t.fields, k)
        ? ownValue(o.fields, k)
        : ownValue(o.links, k);
      if (value === undefined || value === null || value === "")
        problem(
          own(t.fields, k) ? fieldKey(o.id, k) : linkKey(o.id, k),
          "incomplete-reporting-key",
          `${o.id}.${k} is a missing reporting-key component. Optional links still require a value when used in uniqueBy; unknown keys cannot identify a cohort.`,
        );
    }
  }
  for (const t of types.values())
    if (t.uniqueBy.length) {
      const seen = new Map();
      for (const o of objects.values())
        if (o.type === t.id) {
          const values = t.uniqueBy.map((k) =>
            own(t.fields, k) ? ownValue(o.fields, k) : ownValue(o.links, k),
          );
          if (values.some((v) => v === undefined || v === null)) continue;
          const key = canonicalJSON(values);
          if (seen.has(key))
            problem(
              `unique:${t.id}`,
              "duplicate-grain",
              `${o.id} and ${seen.get(key)} share ${t.uniqueBy.join(" + ")}=${key}. They cannot be counted as independent reporting units.`,
            );
          else seen.set(key, o.id);
        }
    }
  function dependencies(input) {
    if (input.metric) return [metricKey(input.metric)];
    const o = objects.get(input.object),
      t = o && types.get(o.type);
    return [
      fieldKey(input.object, input.field),
      `object:${input.object}`,
      ...(t ? [...contextDependencies(o, t), `unique:${o.type}`] : []),
    ];
  }
  for (const m of metrics.values()) {
    const key = metricKey(m.id);
    add(key, "metric", m.label, m);
    edge(`unit:${m.output.unit}`, key);
    if (m.operation === "rate") edge(`ratio:${m.output.concept}`, key);
    for (const input of m.inputs) {
      for (const dep of dependencies(input)) edge(dep, key);
      edge(`unit:${input.expect.unit}`, key);
    }
  }
  for (const a of actions.values()) {
    const key = actionKey(a.id);
    add(key, "action", a.label, a);
    edge(metricKey(a.metric), key);
  }
  const active = new Set();
  function resolveInput(input, consumer) {
    let value;
    if (input.metric) {
      if (!metrics.has(input.metric)) {
        problem(
          consumer,
          "unknown-metric",
          `Input metric ${input.metric} is missing.`,
        );
        return null;
      }
      value = calculate(input.metric);
    } else {
      const o = objects.get(input.object),
        t = o && types.get(o.type),
        spec =
          t && own(t.fields, input.field) ? t.fields[input.field] : undefined;
      if (!o || !spec) {
        problem(
          consumer,
          "unknown-field",
          `Input ${input.object}.${input.field} is missing or undeclared.`,
        );
        return null;
      }
      const errors = dependencies(input).flatMap(
        (k) => nodeErrors.get(k) || [],
      );
      if (errors.length) {
        problem(
          consumer,
          "invalid-input",
          `Input ${input.object}.${input.field} violates ${[...new Set(errors.map((e) => e.code))].join(", ")}.`,
        );
        return null;
      }
      if (spec.kind !== "number") {
        problem(
          consumer,
          "nonnumeric-input",
          `${input.object}.${input.field} is not numeric.`,
        );
        return null;
      }
      if (!units.has(spec.unit)) {
        problem(
          consumer,
          "unknown-unit",
          `Input unit ${spec.unit} is absent from the unit catalog.`,
        );
        return null;
      }
      const cohort = t.uniqueBy.length
        ? `${t.id}:${canonicalJSON(t.uniqueBy.map((k) => (own(t.fields, k) ? ownValue(o.fields, k) : ownValue(o.links, k))))}`
        : `object:${o.id}`;
      value = {
        valid: true,
        value: o.fields[input.field],
        signature: sig(spec),
        lineage: [fieldKey(o.id, input.field)],
        cohorts: [cohort],
        context: Object.fromEntries(
          t.uniqueBy.map((k) => [
            k,
            [own(t.fields, k) ? ownValue(o.fields, k) : ownValue(o.links, k)],
          ]),
        ),
      };
    }
    if (!value.valid) {
      problem(
        consumer,
        "invalid-upstream",
        `Upstream metric ${input.metric} is invalid; its number is not reused.`,
      );
      return null;
    }
    const mismatches = mismatchKeys(value.signature, input.expect);
    if (mismatches.length) {
      for (const k of mismatches)
        problem(
          consumer,
          `contract-${k}`,
          `${input.metric || `${input.object}.${input.field}`}: expected ${k}=${input.expect[k]}, received ${value.signature[k]}. No implicit conversion is permitted.`,
        );
      return null;
    }
    return value;
  }
  function calculate(id) {
    const key = metricKey(id);
    if (results.has(key)) return results.get(key);
    const m = metrics.get(id);
    if (active.has(id)) {
      problem(
        key,
        "dependency-cycle",
        `Metric dependency cycle includes ${id}.`,
      );
      return { valid: false, value: null };
    }
    active.add(id);
    const inputs = m.inputs.map((input) => resolveInput(input, key));
    active.delete(id);
    let value = null;
    if (inputs.every(Boolean)) {
      if (!units.has(m.output.unit))
        problem(
          key,
          "unknown-output-unit",
          `Output unit ${m.output.unit} is absent from the unit catalog.`,
        );
      if (m.operation === "sum") {
        const leaves = inputs.flatMap((i) => i.lineage);
        if (new Set(leaves).size !== leaves.length)
          problem(
            key,
            "duplicate-lineage",
            "Sum inputs overlap in atomic field lineage; a reporting value would be counted twice.",
          );
        if (
          inputs.some((i) => i.signature.aggregation !== "additive") ||
          m.output.aggregation !== "additive"
        )
          problem(
            key,
            "nonadditive-sum",
            "Only additive measures may be summed. Pool case counts and hours, not incidence rates.",
          );
        if (
          inputs.some(
            (i) =>
              i.signature.unit !== m.output.unit ||
              i.signature.concept !== m.output.concept,
          )
        )
          problem(
            key,
            "sum-signature",
            "A sum must preserve the unit and concept of every input. Output grain may explicitly aggregate.",
          );
        if (inputs.some((i) => i.signature.grain !== inputs[0].signature.grain))
          problem(
            key,
            "mixed-input-grain",
            "A sum requires inputs at the same declared grain; mixed reporting scopes are not automatically disjoint.",
          );
        for (const k of m.preserveKeys) {
          const values = inputs.flatMap((i) =>
            own(i.context, k) ? i.context[k] : [],
          );
          if (
            inputs.some((i) => !own(i.context, k)) ||
            new Set(values.map(canonicalJSON)).size !== 1
          )
            problem(
              key,
              "aggregation-context",
              `Aggregation must preserve one shared ${k}; inputs do not share that context.`,
            );
        }
        value = inputs.reduce((s, i) => s + i.value, 0);
      } else {
        if (inputs[1].value <= 0)
          problem(
            key,
            "invalid-denominator",
            "A rate needs a strictly positive denominator. Zero exposure is not a zero rate.",
          );
        if (
          canonicalJSON(sorted(inputs[0].cohorts)) !==
          canonicalJSON(sorted(inputs[1].cohorts))
        )
          problem(
            key,
            "cohort-mismatch",
            "Numerator and denominator cover different reporting units. Matching numeric units is insufficient.",
          );
        if (m.output.aggregation !== "nonadditive")
          problem(key, "rate-additivity", "A rate output must be nonadditive.");
        const role = ratioConcepts.get(m.output.concept);
        if (!role)
          problem(
            key,
            "unknown-ratio-concept",
            `Rate output concept ${m.output.concept} has no declared numerator/denominator roles.`,
          );
        else if (
          role.numerator !== inputs[0].signature.concept ||
          role.denominator !== inputs[1].signature.concept
        )
          problem(
            key,
            "rate-concept-roles",
            `Output concept ${m.output.concept} requires ${role.numerator} / ${role.denominator}; received ${inputs[0].signature.concept} / ${inputs[1].signature.concept}.`,
          );
        const numeratorUnit = units.get(inputs[0].signature.unit),
          denominatorUnit = units.get(inputs[1].signature.unit),
          outputUnit = units.get(m.output.unit);
        if (numeratorUnit && denominatorUnit && outputUnit) {
          const dimensions = Object.create(null);
          for (const [d, p] of Object.entries(numeratorUnit.dimensions))
            dimensions[d] = (dimensions[d] || 0) + p;
          for (const [d, p] of Object.entries(denominatorUnit.dimensions))
            dimensions[d] = (dimensions[d] || 0) - p;
          const normalize = (ds) =>
            Object.fromEntries(
              Object.entries(ds)
                .filter(([, p]) => p !== 0)
                .sort(([a], [b]) => a.localeCompare(b)),
            );
          if (
            canonicalJSON(normalize(dimensions)) !==
            canonicalJSON(normalize(outputUnit.dimensions))
          )
            problem(
              key,
              "rate-unit-dimensions",
              `Numerator / denominator dimensions ${canonicalJSON(normalize(dimensions))} do not equal output-unit dimensions ${canonicalJSON(normalize(outputUnit.dimensions))}.`,
            );
          const close = (a, b) =>
            Number.isFinite(a) &&
            Number.isFinite(b) &&
            a > 0 &&
            b > 0 &&
            Math.abs(a - b) <= 1e-10 * Math.max(Math.abs(a), Math.abs(b));
          if (
            !close(
              m.scale * outputUnit.scale,
              numeratorUnit.scale / denominatorUnit.scale,
            )
          )
            problem(
              key,
              "rate-unit-scale",
              `${inputs[0].signature.unit} / ${inputs[1].signature.unit} into ${m.output.unit} requires multiplier ${numeratorUnit.scale / denominatorUnit.scale / outputUnit.scale}; received ${m.scale}. No implicit conversion is permitted.`,
            );
          if (!close(m.output.rateScale, 1 / outputUnit.scale))
            problem(
              key,
              "rate-scale-contract",
              "Output rateScale must equal the inverse canonical scale of its declared output unit; it is not necessarily the numerical calculation multiplier.",
            );
        }
        value = (inputs[0].value / inputs[1].value) * m.scale;
      }
      if (!Number.isFinite(value))
        problem(
          key,
          "nonfinite-result",
          "The computation did not produce a finite number.",
        );
    }
    const valid = inputs.every(Boolean) && !(nodeErrors.get(key) || []).length;
    const context = valid
      ? Object.fromEntries(
          sorted(new Set(inputs.flatMap((i) => Object.keys(i.context)))).map(
            (k) => [
              k,
              [
                ...new Set(
                  inputs.flatMap((i) =>
                    own(i.context, k) ? i.context[k] : [],
                  ),
                ),
              ],
            ],
          ),
        )
      : {};
    const result = {
      id,
      key,
      kind: "metric",
      label: m.label,
      critical: m.critical,
      valid,
      value: valid ? value : null,
      signature: sig(m.output),
      lineage: valid ? sorted(new Set(inputs.flatMap((i) => i.lineage))) : [],
      cohorts: valid ? sorted(new Set(inputs.flatMap((i) => i.cohorts))) : [],
      context,
    };
    results.set(key, result);
    return result;
  }
  for (const m of metrics.values()) calculate(m.id);
  for (const a of actions.values()) {
    const key = actionKey(a.id),
      metric = results.get(metricKey(a.metric));
    if (!metric?.valid)
      problem(
        key,
        "invalid-action-input",
        `Review rule ${a.id} cannot evaluate invalid or missing metric ${a.metric}.`,
        a.critical,
      );
    if (metric?.valid)
      for (const k of mismatchKeys(metric.signature, a.expect))
        problem(
          key,
          `action-contract-${k}`,
          `Review threshold expects ${k}=${a.expect[k]}, received ${metric.signature[k]}.`,
          a.critical,
        );
    const valid = !!metric?.valid && !(nodeErrors.get(key) || []).length;
    results.set(key, {
      id: a.id,
      key,
      kind: "action",
      label: a.label,
      critical: a.critical,
      valid,
      value: valid ? metric.value >= a.threshold : null,
      threshold: a.threshold,
      metric: a.metric,
    });
  }
  // Object/schema integrity failures are blocking. Metric failures inherit the
  // declared consumer criticality; critical downstream consumers remain blocked.
  for (const d of diagnostics)
    if (d.node.startsWith("metric:"))
      d.critical = metrics.get(d.node.slice(7))?.critical ?? true;
  return {
    valid: !diagnostics.some((d) => d.critical),
    diagnostics,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.entries()]
      .flatMap(([from, tos]) => sorted(tos).map((to) => ({ from, to })))
      .sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    results: [...results.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}
export function compareContracts(before, after) {
  const baseline = evaluateContract(before),
    proposal = evaluateContract(after);
  const bnodes = new Map(baseline.nodes.map((n) => [n.id, n])),
    anodes = new Map(proposal.nodes.map((n) => [n.id, n]));
  const changed = sorted(new Set([...bnodes.keys(), ...anodes.keys()])).filter(
    (id) => bnodes.get(id)?.fingerprint !== anodes.get(id)?.fingerprint,
  );
  const edges = new Map();
  for (const e of [...baseline.edges, ...proposal.edges]) {
    if (!edges.has(e.from)) edges.set(e.from, new Set());
    edges.get(e.from).add(e.to);
  }
  const paths = new Map(changed.map((id) => [id, [id]])),
    queue = [...changed];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const next of sorted(edges.get(id) || []))
      if (!paths.has(next)) {
        paths.set(next, [...paths.get(id), next]);
        queue.push(next);
      }
  }
  const bresults = new Map(baseline.results.map((r) => [r.key, r])),
    aresults = new Map(proposal.results.map((r) => [r.key, r]));
  const consumers = sorted(
    new Set([...bresults.keys(), ...aresults.keys()]),
  ).map((key) => {
    const previous = bresults.get(key) || null,
      current = aresults.get(key) || null;
    const outputChanged =
      canonicalJSON(
        previous && {
          valid: previous.valid,
          value: previous.value,
          signature: previous.signature ?? null,
        },
      ) !==
      canonicalJSON(
        current && {
          valid: current.valid,
          value: current.value,
          signature: current.signature ?? null,
        },
      );
    return {
      key,
      label: (current || previous).label,
      kind: (current || previous).kind,
      affected: paths.has(key),
      outputChanged,
      before: previous,
      after: current,
      path: paths.get(key) || [],
    };
  });
  return {
    baseline,
    proposal,
    changedNodes: changed,
    consumers,
    affectedCount: consumers.filter((c) => c.affected).length,
    changedOutputCount: consumers.filter((c) => c.outputChanged).length,
    totalConsumers: consumers.length,
    approvable: proposal.valid,
    scope:
      "Exact reachability over the union of declared before/after dependencies. Reachable consumers require recheck; output changes are evaluated separately. No production action is performed.",
  };
}
export async function sha256(value) {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function reviewBundle(
  before,
  after,
  { note = "", locallyApproved = false } = {},
) {
  const comparison = compareContracts(before, after);
  if (locallyApproved && !comparison.approvable)
    throw new RangeError("Critical contract failures block local approval.");
  const payload = {
    bundleVersion: 1,
    status: locallyApproved ? "locally-approved-review" : "draft-review",
    scope:
      "Independent local contract simulation. No Palantir integration, production approval, deployment or real operational action.",
    note,
    baseline: { sha256: await sha256(before), contract: clone(before) },
    proposal: { sha256: await sha256(after), contract: clone(after) },
    comparison,
  };
  return {
    ...payload,
    bundleSha256: await sha256(payload),
    digestMethod:
      "SHA-256 over canonical JSON (recursively sorted object keys, array order preserved); bundle digest excludes bundleSha256 and digestMethod.",
  };
}

const cases = {
  unit: "case",
  concept: "recordable_cases",
  grain: "establishment_year",
  aggregation: "additive",
};
const hours = {
  unit: "hour",
  concept: "hours_worked",
  grain: "establishment_year",
  aggregation: "additive",
};
const pooledCases = { ...cases, grain: "portfolio_year" },
  pooledHours = { ...hours, grain: "portfolio_year" };
const rate = {
  unit: "cases_per_200000_hours",
  concept: "recordable_incidence_rate",
  grain: "establishment_year",
  aggregation: "nonadditive",
  rateScale: 200000,
};
const ref = (object, field, expect) => ({
  object,
  field,
  expect: { ...expect },
});
const mref = (metric, expect) => ({ metric, expect: { ...expect } });
export const STARTER_CONTRACT = {
  contractVersion: 1,
  name: "Establishment-year denominator change review",
  provenance:
    "Constructed test fixture, not employer records or an empirical safety finding. Cases and hours illustrate the descriptive cases × 200,000 / hours convention. Review thresholds are arbitrary workflow assumptions, not validated risk limits.",
  units: {
    case: { dimensions: { case: 1 }, scale: 1 },
    hour: { dimensions: { time: 1 }, scale: 1 },
    minute: { dimensions: { time: 1 }, scale: 1 / 60 },
    year: { dimensions: { period: 1 }, scale: 1 },
    text: { dimensions: { label: 1 }, scale: 1 },
    cases_per_200000_hours: {
      dimensions: { case: 1, time: -1 },
      scale: 1 / 200000,
    },
  },
  ratioConcepts: {
    recordable_incidence_rate: {
      numerator: "recordable_cases",
      denominator: "hours_worked",
    },
  },
  types: [
    {
      id: "establishment",
      fields: {
        name: {
          kind: "string",
          unit: "text",
          concept: "establishment_name",
          grain: "establishment",
          aggregation: "nonadditive",
        },
      },
      links: {},
      uniqueBy: [],
    },
    {
      id: "annual_report",
      fields: {
        year: {
          kind: "number",
          unit: "year",
          concept: "reporting_year",
          grain: "establishment_year",
          aggregation: "nonadditive",
          min: 1900,
          integer: true,
        },
        cases: { kind: "number", ...cases, min: 0, integer: true },
        hours: { kind: "number", ...hours, min: 0 },
      },
      links: { establishment: { targetType: "establishment", required: true } },
      uniqueBy: ["year", "establishment"],
    },
  ],
  objects: [
    {
      id: "north",
      type: "establishment",
      fields: { name: "North facility" },
      links: {},
    },
    {
      id: "south",
      type: "establishment",
      fields: { name: "South facility" },
      links: {},
    },
    {
      id: "north_2024",
      type: "annual_report",
      fields: { year: 2024, cases: 3, hours: 240000 },
      links: { establishment: "north" },
    },
    {
      id: "south_2024",
      type: "annual_report",
      fields: { year: 2024, cases: 1, hours: 160000 },
      links: { establishment: "south" },
    },
  ],
  metrics: [
    {
      id: "north_rate",
      label: "North · recordable incidence rate",
      operation: "rate",
      critical: true,
      inputs: [
        ref("north_2024", "cases", cases),
        ref("north_2024", "hours", hours),
      ],
      scale: 200000,
      output: { ...rate },
    },
    {
      id: "south_rate",
      label: "South · recordable incidence rate",
      operation: "rate",
      critical: true,
      inputs: [
        ref("south_2024", "cases", cases),
        ref("south_2024", "hours", hours),
      ],
      scale: 200000,
      output: { ...rate },
    },
    {
      id: "pooled_cases",
      label: "Portfolio · recordable cases",
      operation: "sum",
      critical: true,
      preserveKeys: ["year"],
      inputs: [
        ref("north_2024", "cases", cases),
        ref("south_2024", "cases", cases),
      ],
      output: pooledCases,
    },
    {
      id: "pooled_hours",
      label: "Portfolio · hours worked",
      operation: "sum",
      critical: true,
      preserveKeys: ["year"],
      inputs: [
        ref("north_2024", "hours", hours),
        ref("south_2024", "hours", hours),
      ],
      output: pooledHours,
    },
    {
      id: "pooled_rate",
      label: "Portfolio · pooled incidence rate",
      operation: "rate",
      critical: true,
      inputs: [
        mref("pooled_cases", pooledCases),
        mref("pooled_hours", pooledHours),
      ],
      scale: 200000,
      output: { ...rate, grain: "portfolio_year" },
    },
  ],
  actions: [
    {
      id: "review_north",
      label: "North · manual review rule",
      metric: "north_rate",
      operator: "gte",
      threshold: 3,
      critical: true,
      expect: { ...rate },
    },
    {
      id: "review_south",
      label: "South · manual review rule",
      metric: "south_rate",
      operator: "gte",
      threshold: 3,
      critical: true,
      expect: { ...rate },
    },
    {
      id: "review_portfolio",
      label: "Portfolio · manual review rule",
      metric: "pooled_rate",
      operator: "gte",
      threshold: 2.2,
      critical: true,
      expect: { ...rate, grain: "portfolio_year" },
    },
  ],
};
export const CHANGE_PRESETS = [
  {
    id: "hours-correction",
    label: "Correct one hours denominator",
    description:
      "North hours change from 240,000 to 180,000. Case counts are unchanged; two review rules cross their declared thresholds.",
  },
  {
    id: "unit-drift",
    label: "Change hours contract to minutes",
    description:
      "The producer now declares minutes while consumers still require hours. The engine blocks evaluation instead of silently multiplying or relabeling.",
  },
  {
    id: "case-drift",
    label: "Relabel cases as days away",
    description:
      "The numeric unit remains “case”, but recordable cases become days-away cases. A semantic mismatch must be caught even when the arithmetic still runs.",
  },
  {
    id: "broken-reference",
    label: "Remove a referenced establishment",
    description:
      "North report still points to a deleted establishment. A valid number cannot repair a broken reporting-unit reference.",
  },
  {
    id: "cohort-mismatch",
    label: "Bind North cases to South hours",
    description:
      "Both fields have valid units and schemas. Their establishment-year cohorts differ, so the ratio is invalid.",
  },
  {
    id: "metadata-only",
    label: "Rename an establishment display label",
    description:
      "A harmless display-name edit has no path to the declared calculations. Recomputing every consumer would be unnecessary.",
  },
];
export function applyPreset(id, base = STARTER_CONTRACT) {
  const next = clone(base);
  const report = next.objects.find((o) => o.id === "north_2024"),
    type = next.types.find((t) => t.id === "annual_report");
  shape(
    report && type,
    "Starter presets require the starter object IDs. Use custom JSON for imported contracts.",
  );
  if (id === "hours-correction") report.fields.hours = 180000;
  else if (id === "unit-drift") type.fields.hours.unit = "minute";
  else if (id === "case-drift") type.fields.cases.concept = "days_away_cases";
  else if (id === "broken-reference")
    next.objects = next.objects.filter((o) => o.id !== "north");
  else if (id === "cohort-mismatch")
    next.metrics.find((m) => m.id === "north_rate").inputs[1].object =
      "south_2024";
  else if (id === "metadata-only")
    next.objects.find((o) => o.id === "north").fields.name =
      "North facility — revised label";
  else throw new RangeError("Unknown starter change.");
  return next;
}
