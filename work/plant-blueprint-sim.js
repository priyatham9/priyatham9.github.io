/* Seeded, deterministic simulation core for work/plant-blueprint.html.
 * Pure functions only (no DOM, no Date, no Math.random), so the same seed and
 * parameters always give the same event log. Works in the browser (window.PlantSim)
 * and in node (module.exports) for tests/plant_sim_determinism.js.
 *
 * Statistical inputs (incident rates, release-source and release-type shares,
 * implausible-filing share) come only from the embedded data block, which is
 * generated from committed outputs of ehs-chemical-peers and ehs-osha-analysis.
 * Everything else here (nominal values, noise, thresholds, durations, response
 * delays) is a model parameter and is labelled as such on the page.
 */
(function (root) {
  "use strict";

  var HOURS_PER_YEAR = 8760;
  var MODEL = {
    releaseDurationH: 8,         // model parameter
    rampH: 1,                    // model parameter
    decayH: 2,                   // model parameter
    filingHourOfYear: 1440,      // model parameter: a filing review lands on day 61
    scanStepH: 0.25,             // alert-detection resolution
    ackDelayH: [0.25, 2.0],      // model parameter (auto-operator)
    workOrderDelayH: [0.5, 3.0], // model parameter (auto-operator)
    warnFraction: 0.75           // warn when a value is 75% of the way to its limit
  };

  /* ---------- seeded randomness ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash01(seed, a, b) {
    var h = Math.imul(seed | 0, 0x9E3779B1) ^ Math.imul(a | 0, 0x85EBCA77) ^ Math.imul(b | 0, 0xC2B2AE3D);
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function strHash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }

  /* ---------- the synthetic site (model parameters) ---------- */
  var SIGNALS = {
    reactor:   [S("temp", "Temperature", "C", 180, 4, 200, null), S("pressure", "Pressure", "bar", 12, 0.5, 15, 8.5), S("level", "Level", "%", 60, 3, 80, 40), S("gas", "Gas detector", "%LEL", 0.5, 0.3, 20, null)],
    column:    [S("temp", "Overhead temp", "C", 95, 2, 110, null), S("pressure", "Pressure", "bar", 1.8, 0.1, 2.6, 1.2), S("level", "Reflux drum level", "%", 50, 3, 80, 25), S("gas", "Gas detector", "%LEL", 0.5, 0.3, 20, null)],
    tank:      [S("level", "Level", "%", 70, 4, 90, 50), S("temp", "Temperature", "C", 25, 2, 45, null), S("gas", "Gas detector", "%LEL", 0.5, 0.3, 20, null)],
    exchanger: [S("tout", "Outlet temp", "C", 60, 2, 80, null), S("flow", "Flow", "m3/h", 120, 5, null, 80), S("dp", "Pressure drop", "bar", 0.6, 0.05, 1.2, null)],
    pump:      [S("flow", "Flow", "m3/h", 80, 3, null, 50), S("pressure", "Discharge pressure", "bar", 6, 0.2, null, 4), S("vib", "Vibration", "mm/s", 2, 0.4, 4.5, null), S("gas", "Gas detector", "%LEL", 0.5, 0.3, 20, null)],
    piperack:  [S("flow", "Header flow", "m3/h", 150, 6, null, 100), S("pressure", "Header pressure", "bar", 8, 0.4, 10.5, 5.5), S("gas", "Gas detector", "%LEL", 0.5, 0.3, 20, null)],
    flare:     [S("flow", "Relief flow", "t/h", 2, 0.3, 6, null), S("pilot", "Pilot temp", "C", 850, 20, null, 700)],
    control:   []
  };
  function S(key, label, unit, nom, amp, hi, lo) { return { key: key, label: label, unit: unit, nom: nom, amp: amp, hi: hi, lo: lo }; }

  var UNITS = [
    { id: "R-101", type: "reactor", name: "Reactor R-101" },
    { id: "R-102", type: "reactor", name: "Reactor R-102" },
    { id: "C-201", type: "column", name: "Column C-201" },
    { id: "C-202", type: "column", name: "Column C-202" },
    { id: "T-301", type: "tank", name: "Tank T-301" },
    { id: "T-302", type: "tank", name: "Tank T-302" },
    { id: "T-303", type: "tank", name: "Tank T-303" },
    { id: "E-401", type: "exchanger", name: "Exchanger E-401" },
    { id: "E-402", type: "exchanger", name: "Exchanger E-402" },
    { id: "E-403", type: "exchanger", name: "Exchanger E-403" },
    { id: "P-501", type: "pump", name: "Pump P-501" },
    { id: "P-502", type: "pump", name: "Pump P-502" },
    { id: "P-503", type: "pump", name: "Pump P-503" },
    { id: "P-504", type: "pump", name: "Pump P-504" },
    { id: "PR-601", type: "piperack", name: "Pipe rack PR-601" },
    { id: "F-701", type: "flare", name: "Flare F-701" },
    { id: "CB-801", type: "control", name: "Control building CB-801" }
  ];
  var UNIT_BY_ID = {}; UNITS.forEach(function (u) { UNIT_BY_ID[u.id] = u; });

  /* Which schematic unit types an RMP "where from" flag maps to (model choice). */
  var SOURCE_MAP = {
    "Process vessel or reactor": "reactor", "Storage tank": "tank", "Pump": "pump",
    "Piping": "piperack", "Valve": "piperack", "Joint or flange": "piperack", "Transfer hose": "piperack"
  };
  /* Effects of a release on its source unit (model parameters, absolute deltas). */
  var RELEASE_SIGNATURE = {
    reactor:  [["gas", 55], ["pressure", -4.5]],
    tank:     [["gas", 45], ["level", -25]],
    pump:     [["gas", 30], ["flow", -35], ["vib", 4]],
    piperack: [["gas", 40], ["pressure", -5], ["flow", -60]]
  };
  var RUNAWAY_EXTRA = [["temp", 35]];
  var FLARE_RESPONSE = [["flow", 8]];

  /* ---------- parameters ---------- */
  function defaultParams(data) {
    return { seed: 7, horizonYears: 50, band: "100k-1M lb", rateMode: "point", autoOperator: true };
  }
  function rateFor(data, p) {
    var b = null, bands = data.sim_rates.release_per_plant_year.bands;
    for (var i = 0; i < bands.length; i++) if (bands[i].label === p.band) b = bands[i];
    if (!b) throw new Error("unknown band " + p.band);
    var pct = p.rateMode === "lower" ? b.wilson_pct[0] : p.rateMode === "upper" ? b.wilson_pct[1] : b.rate_pct;
    var pYear = pct / 100;
    return { pct: pct, pYear: pYear, lambdaPerYear: -Math.log(1 - pYear), band: b };
  }

  /* ---------- signals ---------- */
  function valueNoise(seed, k, t) {
    var i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
    var a = hash01(seed, k, i) * 2 - 1, b = hash01(seed, k, i + 1) * 2 - 1;
    return a + (b - a) * s;
  }
  function baseValue(seed, unit, sig, t) {
    var k = strHash(unit.id + ":" + sig.key);
    var ph = hash01(seed, k, 99) * 6.283185307, per = 6 + hash01(seed, k, 98) * 30;
    var n = 0.6 * valueNoise(seed, k, t) + 0.4 * Math.sin(6.283185307 * t / per + ph);
    return sig.nom + sig.amp * n; /* |deviation| <= amp by construction */
  }
  function shape(tau, dur) {
    if (tau < 0) return 0;
    if (tau < MODEL.rampH) return tau / MODEL.rampH;
    if (tau < dur) return 1;
    if (tau < dur + MODEL.decayH) return 1 - (tau - dur) / MODEL.decayH;
    return 0;
  }
  function sigDef(unit, key) { var l = SIGNALS[unit.type]; for (var i = 0; i < l.length; i++) if (l[i].key === key) return l[i]; return null; }

  function eventEffects(ev) {
    /* returns [{unit, key, delta}] */
    var out = [];
    if (ev.kind === "release") {
      var u = UNIT_BY_ID[ev.unit], sig = RELEASE_SIGNATURE[u.type] || [];
      sig.forEach(function (e) { out.push({ unit: ev.unit, key: e[0], delta: e[1] }); });
      if (ev.flags.indexOf("Runaway reaction") >= 0 && u.type === "reactor") RUNAWAY_EXTRA.forEach(function (e) { out.push({ unit: ev.unit, key: e[0], delta: e[1] }); });
      if (u.type === "reactor") FLARE_RESPONSE.forEach(function (e) { out.push({ unit: "F-701", key: e[0], delta: e[1] }); });
    } else if (ev.kind === "test") {
      var sg = sigDef(UNIT_BY_ID[ev.unit], ev.key);
      if (sg) {
        var over = sg.hi != null ? (sg.hi - sg.nom) * 1.25 : -(sg.nom - sg.lo) * 1.25;
        out.push({ unit: ev.unit, key: ev.key, delta: over });
      }
    }
    return out;
  }
  function eventDur(ev) { return ev.kind === "release" ? MODEL.releaseDurationH : 6; }

  function valueAt(seed, events, unitId, key, t) {
    var unit = UNIT_BY_ID[unitId], sig = sigDef(unit, key);
    var v = baseValue(seed, unit, sig, t);
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.kind === "filing" || t < ev.t0 || t > ev.t0 + eventDur(ev) + MODEL.decayH) continue;
      var fx = ev._fx || (ev._fx = eventEffects(ev));
      for (var j = 0; j < fx.length; j++) if (fx[j].unit === unitId && fx[j].key === key) v += fx[j].delta * shape(t - ev.t0, eventDur(ev));
    }
    if (sig.key === "gas" && v < 0) v = 0;
    return v;
  }
  function limitState(sig, v) {
    var w = MODEL.warnFraction;
    if (sig.hi != null && v >= sig.hi) return "alarm";
    if (sig.lo != null && v <= sig.lo) return "alarm";
    if (sig.hi != null && v >= sig.nom + w * (sig.hi - sig.nom)) return "warn";
    if (sig.lo != null && v <= sig.nom - w * (sig.nom - sig.lo)) return "warn";
    return "ok";
  }

  /* ---------- incident schedule ---------- */
  function buildSchedule(data, p) {
    var rate = rateFor(data, p), events = [];
    var horizon = p.horizonYears * HOURS_PER_YEAR;
    /* release stream: Poisson process, one RNG stream per purpose */
    var rng = mulberry32((p.seed * 1000003 + 11) | 0);
    var flags = data.release_flags, tot = flags.total;
    var srcW = {}; flags.source.forEach(function (s) { var t = SOURCE_MAP[s.label]; if (t) srcW[t] = (srcW[t] || 0) + s.n; });
    var srcTypes = Object.keys(srcW).sort();
    var srcTotal = srcTypes.reduce(function (a, k) { return a + srcW[k]; }, 0);
    var perYear = rate.lambdaPerYear / HOURS_PER_YEAR, t = 0, n = 0;
    while (true) {
      t += -Math.log(1 - rng()) / perYear;
      if (t >= horizon) break;
      var r = rng() * srcTotal, ty = srcTypes[srcTypes.length - 1];
      for (var i = 0; i < srcTypes.length; i++) { if (r < srcW[srcTypes[i]]) { ty = srcTypes[i]; break; } r -= srcW[srcTypes[i]]; }
      var cands = UNITS.filter(function (u) { return u.type === ty; });
      var unit = cands[Math.floor(rng() * cands.length)];
      var fl = [];
      flags.type.forEach(function (f) { if (rng() < f.n / tot) fl.push(f.label); });
      n++;
      events.push({ id: "INC-" + pad(n, 3), kind: "release", t0: round3(t), unit: unit.id, flags: fl,
        basis: "release_per_plant_year " + rate.pct + "% (" + p.rateMode + ", " + p.band + ")" });
    }
    /* annual filing stream */
    var rng2 = mulberry32((p.seed * 999983 + 5) | 0), share = data.sim_rates.filing_implausible.share;
    for (var y = 0; y < p.horizonYears; y++) {
      if (rng2() < share) events.push({ id: "FIL-Y" + pad(y + 1, 3), kind: "filing", t0: y * HOURS_PER_YEAR + MODEL.filingHourOfYear, unit: "CB-801", flags: [],
        basis: "implausible_share " + share });
    }
    events.sort(function (a, b) { return a.t0 - b.t0 || (a.id < b.id ? -1 : 1); });
    return events;
  }
  function round3(x) { return Math.round(x * 1000) / 1000; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = "0" + s; return s; }

  /* ---------- alert detection + ontology actions ---------- */
  var ONTOLOGY = {
    name: "Synthetic-site alert ontology (Foundry-style pattern after ehs-osha-analysis src/ehs_osha/ontology/spec.json)",
    object_types: [
      { api_name: "Unit", primary_key: "unit_id", properties: ["unit_id", "type", "isolated"] },
      { api_name: "Alert", primary_key: "alert_id", properties: ["alert_id", "unit_id", "variable", "limit", "severity", "status", "incident_id"] },
      { api_name: "Incident", primary_key: "incident_id", properties: ["incident_id", "kind", "unit_id", "flags", "basis"] },
      { api_name: "WorkOrder", primary_key: "work_order_id", properties: ["work_order_id", "alert_id", "priority", "note"] },
      { api_name: "Filing", primary_key: "filing_id", properties: ["filing_id", "analyst_flag"] }
    ],
    link_types: [
      { api_name: "alert_unit", source: "Alert", target: "Unit", cardinality: "many_to_one", foreign_key: "unit_id" },
      { api_name: "alert_incident", source: "Alert", target: "Incident", cardinality: "many_to_one", foreign_key: "incident_id" },
      { api_name: "workorder_alert", source: "WorkOrder", target: "Alert", cardinality: "many_to_one", foreign_key: "alert_id" },
      { api_name: "filing_alert", source: "Alert", target: "Filing", cardinality: "many_to_one", foreign_key: "incident_id" }
    ],
    action_types: [
      { api_name: "raise_alert", display_name: "Raise alert", system: true, parameters: ["unit", "variable", "limit", "severity"], criteria: ["value crosses limit"] },
      { api_name: "acknowledge_alert", display_name: "Acknowledge", parameters: ["alert", "note?"], criteria: ["alert.status == open"], edits: { status: "acknowledged" } },
      { api_name: "isolate_unit", display_name: "Isolate unit", parameters: ["alert", "reason in {leak_suspected, sensor_trip, precaution}"], criteria: ["alert.status in {open, acknowledged}", "unit.isolated == false", "unit.type != control"], edits: { "unit.isolated": true } },
      { api_name: "raise_work_order", display_name: "Raise work order", parameters: ["alert", "priority in {routine, urgent}", "note (min 10 chars)"], criteria: ["alert.status == acknowledged", "alert has no work order"], edits: { create: "WorkOrder" } },
      { api_name: "flag_filing_implausible", display_name: "Flag filing as implausible", parameters: ["alert", "note (min 10 chars)"], criteria: ["alert.kind == filing"], edits: { "filing.analyst_flag": true } }
    ]
  };

  function severityFor(sig, key) { return key === "gas" ? "high" : "medium"; }

  function detectAlerts(seed, events) {
    var alerts = [];
    events.forEach(function (ev) {
      if (ev.kind === "filing") {
        alerts.push({ t: ev.t0, alert_id: "ALT-" + ev.id, unit: "CB-801", variable: "OSHA 300A filing", limit: "implausible_share screen", severity: "medium", incident_id: ev.id, kind: "filing", value: null });
        return;
      }
      var fx = ev._fx || (ev._fx = eventEffects(ev)), seen = {};
      var end = ev.t0 + eventDur(ev) + MODEL.decayH;
      for (var t = ev.t0; t <= end; t += MODEL.scanStepH) {
        for (var j = 0; j < fx.length; j++) {
          var f = fx[j], id = f.unit + ":" + f.key;
          if (seen[id]) continue;
          var sig = sigDef(UNIT_BY_ID[f.unit], f.key), v = valueAt(seed, [ev], f.unit, f.key, t);
          if (limitState(sig, v) === "alarm") {
            seen[id] = true;
            alerts.push({ t: round3(t), alert_id: "ALT-" + ev.id + "-" + f.unit + "-" + f.key, unit: f.unit, variable: sig.label,
              limit: (sig.hi != null && v >= sig.hi ? "high " + sig.hi : "low " + sig.lo) + " " + sig.unit, severity: severityFor(sig, f.key), incident_id: ev.id, kind: "threshold", value: round3(v) });
          }
        }
      }
    });
    alerts.sort(function (a, b) { return a.t - b.t || (a.alert_id < b.alert_id ? -1 : 1); });
    return alerts;
  }

  /* Deterministic system log: incidents, raised alerts, and (optionally) the simulated operator's responses. */
  function systemLog(data, p, events) {
    events = events || buildSchedule(data, p);
    var log = [], alerts = detectAlerts(p.seed, events);
    events.forEach(function (ev) {
      log.push({ at_h: ev.t0, actor: "model:incident-generator", action: "open_incident", objects: { incident: ev.id, unit: ev.unit },
        params: { kind: ev.kind, flags: ev.flags, basis: ev.basis }, result: "applied" });
    });
    var rng = mulberry32((p.seed * 7919 + 3) | 0);
    alerts.forEach(function (a) {
      log.push({ at_h: a.t, actor: "monitor:threshold", action: "raise_alert", objects: { alert: a.alert_id, unit: a.unit, incident: a.incident_id },
        params: { variable: a.variable, limit: a.limit, severity: a.severity, kind: a.kind, value: a.value }, result: "applied" });
      var ra = rng(), rb = rng();
      if (p.autoOperator) {
        var tAck = round3(a.t + MODEL.ackDelayH[0] + ra * (MODEL.ackDelayH[1] - MODEL.ackDelayH[0]));
        log.push({ at_h: tAck, actor: "operator:auto (model)", action: "acknowledge_alert", objects: { alert: a.alert_id, unit: a.unit }, params: {}, result: "applied" });
        if (a.severity === "high") {
          var tW = round3(tAck + MODEL.workOrderDelayH[0] + rb * (MODEL.workOrderDelayH[1] - MODEL.workOrderDelayH[0]));
          log.push({ at_h: tW, actor: "operator:auto (model)", action: "raise_work_order", objects: { alert: a.alert_id, unit: a.unit, work_order: "WO-" + a.alert_id },
            params: { priority: "urgent", note: "Auto-raised for high-severity gas alarm (model rule)" }, result: "applied" });
        }
      }
    });
    return sortLog(log);
  }
  var ORDER = { open_incident: 0, raise_alert: 1, acknowledge_alert: 2, isolate_unit: 3, raise_work_order: 4, flag_filing_implausible: 5 };
  function sortLog(log) {
    log = log.slice().sort(function (a, b) { return a.at_h - b.at_h || (ORDER[a.action] - ORDER[b.action]) || (JSON.stringify(a.objects) < JSON.stringify(b.objects) ? -1 : 1); });
    log.forEach(function (e, i) { e.seq = i + 1; });
    return log;
  }

  /* Fold a log up to hour t into ontology object state. */
  function foldState(log, t) {
    var st = { alerts: {}, isolated: {}, workOrders: {}, filings: {} };
    log.forEach(function (e) {
      if (e.at_h > t || e.result !== "applied") return;
      var o = e.objects;
      if (e.action === "raise_alert") st.alerts[o.alert] = { alert_id: o.alert, unit: o.unit, incident: o.incident, variable: e.params.variable, limit: e.params.limit, severity: e.params.severity, kind: e.params.kind, status: "open", t: e.at_h };
      else if (e.action === "acknowledge_alert" && st.alerts[o.alert]) st.alerts[o.alert].status = "acknowledged";
      else if (e.action === "isolate_unit") st.isolated[o.unit] = e.at_h;
      else if (e.action === "raise_work_order") { st.workOrders[o.alert] = { id: o.work_order, priority: e.params.priority, note: e.params.note }; if (st.alerts[o.alert]) st.alerts[o.alert].workOrder = o.work_order; }
      else if (e.action === "flag_filing_implausible") { st.filings[o.alert] = true; if (st.alerts[o.alert]) st.alerts[o.alert].status = "closed"; }
    });
    return st;
  }

  /* Governed action: validates submission criteria against state at t, returns an audit entry. */
  function applyAction(log, name, args, t, actor) {
    var st = foldState(log, t), a = st.alerts[args.alert], fail = null;
    var entry = { at_h: Math.floor(t * 1000) / 1000, actor: actor || "you (analyst)", action: name, objects: { alert: args.alert, unit: a ? a.unit : null }, params: {}, result: "applied" };
    if (!a) fail = "Alert does not exist yet at this time.";
    else if (name === "acknowledge_alert") { if (a.status !== "open") fail = "Alert is not open."; else if (args.note) entry.params.note = args.note; }
    else if (name === "isolate_unit") {
      var reasons = ["leak_suspected", "sensor_trip", "precaution"];
      if (reasons.indexOf(args.reason) < 0) fail = "Reason must be one of " + reasons.join(", ") + ".";
      else if (a.status === "closed") fail = "Alert is closed.";
      else if (st.isolated[a.unit] != null) fail = "Unit is already isolated.";
      else if (UNIT_BY_ID[a.unit].type === "control") fail = "The control building cannot be isolated.";
      else entry.params.reason = args.reason;
    } else if (name === "raise_work_order") {
      if (a.status !== "acknowledged") fail = "Alert must be acknowledged first.";
      else if (st.workOrders[a.alert_id]) fail = "Alert already has a work order.";
      else if (["routine", "urgent"].indexOf(args.priority) < 0) fail = "Priority must be routine or urgent.";
      else if (!args.note || args.note.length < 10) fail = "Note must be at least 10 characters.";
      else { entry.params.priority = args.priority; entry.params.note = args.note; entry.objects.work_order = "WO-" + a.alert_id; }
    } else if (name === "flag_filing_implausible") {
      if (a.kind !== "filing") fail = "Alert is not about a filing.";
      else if (st.filings[a.alert_id]) fail = "Filing is already flagged.";
      else if (!args.note || args.note.length < 10) fail = "Note must be at least 10 characters.";
      else entry.params.note = args.note;
    } else fail = "Unknown action.";
    if (fail) { entry.result = "rejected"; entry.failure_message = fail; }
    return entry;
  }

  /* Test excursion injected by the viewer (a model event, not a statistic). */
  function testEvent(unitId, key, t0, n) {
    return { id: "TEST-" + pad(n, 3), kind: "test", t0: round3(t0), unit: unitId, key: key, flags: [], basis: "manual test excursion (model, not a statistic)" };
  }

  /* ---------- per-unit state for rendering ---------- */
  function unitState(seed, events, log, t) {
    var st = foldState(log, t), out = {};
    UNITS.forEach(function (u) {
      var vals = {}, status = "ok", sigs = SIGNALS[u.type];
      sigs.forEach(function (s) {
        var v = valueAt(seed, events, u.id, s.key, t), ls = limitState(s, v);
        vals[s.key] = { v: v, state: ls };
        if (ls === "alarm") status = "alarm"; else if (ls === "warn" && status !== "alarm") status = "warn";
      });
      if (u.type === "control") {
        var open = 0; Object.keys(st.alerts).forEach(function (k) { if (st.alerts[k].status === "open") open++; });
        if (open) status = "warn";
      }
      var iso = st.isolated[u.id] != null;
      out[u.id] = { vals: vals, status: iso ? "isolated" : status, isolated: iso };
    });
    return out;
  }

  /* ---------- export ---------- */
  function exportLog(data, p, log) {
    var rate = rateFor(data, p);
    return {
      schema: "plant-blueprint-event-log/1",
      banner: "Simulated digital twin of a synthetic site. No real facility or live telemetry; incident rates are drawn from public statistics, behaviour is a model.",
      seed: p.seed, params: { horizonYears: p.horizonYears, band: p.band, rateMode: p.rateMode, autoOperator: !!p.autoOperator },
      rates: {
        release_per_plant_year_pct: rate.pct, interval_wilson_pct: rate.band.wilson_pct, source: data.sim_rates.release_per_plant_year.src,
        columns: "rate_pct, wilson_pct (group rel-inv-" + p.band + ")", conversion: "lambda_per_year = -ln(1 - p)",
        implausible_filing_share: data.sim_rates.filing_implausible.share, implausible_filing_source: data.sim_rates.filing_implausible.src + " column implausible_share"
      },
      ontology: ONTOLOGY,
      log: log.map(function (e, i) { var c = JSON.parse(JSON.stringify(e)); c.seq = i + 1; c.when = hourLabel(e.at_h); return c; })
    };
  }
  function hourLabel(h) {
    var y = Math.floor(h / HOURS_PER_YEAR), r = h - y * HOURS_PER_YEAR, d = Math.floor(r / 24), hh = r - d * 24;
    var H = Math.floor(hh), M = Math.floor((hh - H) * 60);
    return "Y" + (y + 1) + " D" + pad(d + 1, 3) + " " + pad(H, 2) + ":" + pad(M, 2);
  }

  var api = { HOURS_PER_YEAR: HOURS_PER_YEAR, MODEL: MODEL, UNITS: UNITS, UNIT_BY_ID: UNIT_BY_ID, SIGNALS: SIGNALS, ONTOLOGY: ONTOLOGY,
    SOURCE_MAP: SOURCE_MAP, RELEASE_SIGNATURE: RELEASE_SIGNATURE, defaultParams: defaultParams, rateFor: rateFor, buildSchedule: buildSchedule,
    detectAlerts: detectAlerts, systemLog: systemLog, sortLog: sortLog, foldState: foldState, applyAction: applyAction, testEvent: testEvent,
    unitState: unitState, valueAt: valueAt, limitState: limitState, sigDef: sigDef, exportLog: exportLog, hourLabel: hourLabel, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.PlantSim = api;
})(typeof window !== "undefined" ? window : globalThis);
