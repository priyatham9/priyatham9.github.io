/* Scene, UI and glue for work/plant-blueprint.html.
 * three.js r160 comes from cdnjs (pinned in the page). If WebGL or the script is
 * unavailable, a Canvas2D isometric view is drawn instead. All simulation logic
 * lives in plant-blueprint-sim.js (PlantSim); all statistics come from the
 * embedded #plant-data JSON block. */
(function () {
  "use strict";
  var Sim = window.PlantSim;
  var DATA = JSON.parse(document.getElementById("plant-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (x, d) { return Number(x).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }); };
  var E = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  /* ---------------- layout of the synthetic site (drawing units) ---------------- */
  var POS = {
    "R-101": [-22, -8], "R-102": [-14, -8], "C-201": [-4, -8], "C-202": [5, -8],
    "E-401": [-22, 2], "E-402": [-12, 2], "E-403": [0, 2],
    "P-501": [-24, 9], "P-502": [-8, 9], "P-503": [6, 9], "P-504": [14, 9],
    "T-301": [22, -10], "T-302": [22, 0], "T-303": [22, 10],
    "PR-601": [0, 19], "F-701": [38, -20], "CB-801": [-14, 30]
  };
  var RACK_Y = 5.3;
  var PIPES = [
    ["T-301", "P-501"], ["P-501", "E-401"], ["E-401", "R-101"], ["R-101", "R-102", "direct"], ["R-102", "E-402"],
    ["E-402", "C-201"], ["C-201", "P-502"], ["P-502", "C-202"], ["C-202", "E-403"], ["E-403", "P-503"], ["P-503", "T-302"],
    ["C-202", "P-504"], ["P-504", "T-303"]
  ];
  var TOP = { reactor: 9, column: 15, tank: 6.5, exchanger: 2.2, pump: 1.8, flare: 24, piperack: 6, control: 6 };
  var NOZ = { reactor: 4, column: 3, tank: 1.2, exchanger: 1.6, pump: 1.0, flare: 1, piperack: 5, control: 2 };

  var params = Sim.defaultParams(DATA); params.seed = 3;
  var S = { t: 0, playing: false, speed: 24, autoSlow: true, selected: "R-101", events: [], baseLog: [], testLogs: [], manual: [], testN: 0, log: [], uState: null, lastLogSig: "" };
  var horizonH = function () { return params.horizonYears * Sim.HOURS_PER_YEAR; };

  function rebuild(resetManual) {
    S.events = Sim.buildSchedule(DATA, params);
    S.baseLog = Sim.systemLog(DATA, params, S.events);
    if (resetManual) { S.testLogs = []; S.manual = []; S.testN = 0; S.testEvents = []; }
    S.testEvents = S.testEvents || [];
    mergeLog();
    if (S.t > horizonH()) S.t = horizonH();
  }
  function mergeLog() {
    var all = S.baseLog.concat.apply(S.baseLog.slice(), S.testLogs).concat(S.manual);
    S.log = Sim.sortLog(all);
  }
  function allEvents() { return S.events.concat(S.testEvents || []); }

  /* ---------------- insight panel (data-driven) ---------------- */
  function statLine(s) {
    var o = "", a = DATA.interval_alpha;
    if (s.of != null && s.n != null && s.rate_pct == null) o = "<b>" + fmt(s.n) + "</b> of " + fmt(s.of) + " records (" + fmt(100 * s.n / s.of, 1) + "%)";
    else if (s.rate_pct != null) o = "<b>" + fmt(s.rate_pct, 2) + "%</b> (" + fmt(s.events) + " / " + fmt(s.plant_years) + " plant-years); " + fmt((1 - a) * 100) + "% Wilson interval " + fmt(s.wilson_pct[0], 2) + "% to " + fmt(s.wilson_pct[1], 2) + "%";
    else if (s.value_pct != null) o = "<b>" + fmt(s.value_pct, 2) + "%</b>";
    else if (s.values) o = s.values.map(function (v, i) { return "<b>" + fmt(v, 3) + "</b> " + E(s.value_labels[i]); }).join(" vs ");
    else if (s.value != null) o = "<b>" + fmt(s.value, 3) + "</b>";
    if (s.of != null && s.n != null && s.rate_pct == null && s.label.indexOf("filings") >= 0) o += "; " + "share " + fmt(100 * s.n / s.of, 2) + "%";
    if (s.n != null && s.rate_pct == null && s.of == null && s.values) o += " (n=" + fmt(s.n) + ")";
    return o;
  }
  function srcLink(src) {
    var p = src.split(":"), repo = p[0], path = p[1];
    return '<a href="https://github.com/priyatham9/' + repo + '/blob/main/' + path + '" target="_blank" rel="noopener noreferrer">' + E(repo + "/" + path) + "</a>";
  }
  function renderInsight() {
    var u = Sim.UNIT_BY_ID[S.selected], info = DATA.units[u.type];
    var h = '<p class="ins-kick">' + E(u.id) + " &middot; " + E(info.title) + '</p><h3 class="ins-t">What public data can say about this kind of unit</h3>';
    h += '<p class="ins-warn">Illustrative schematic. These figures describe US NAICS 325 chemical plants in public records, not this drawing.</p><ul class="ins-list">';
    info.stats.forEach(function (s) {
      h += "<li><span class=\"ins-l\">" + E(s.label) + "</span><span class=\"ins-v\">" + statLine(s) + '</span><span class="ins-s">Source: ' + srcLink(s.src) + " &middot; <code>" + E(s.key) + "</code></span></li>";
    });
    h += '</ul><p class="ins-note">' + E(info.note) + "</p>";
    h += '<p class="ins-note">No causal claim is made: the records show how often something was flagged, not why it happened or whether a change would prevent it.</p>';
    $("tab-insight").innerHTML = h;
  }
  function select(id, openTab) {
    if (!Sim.UNIT_BY_ID[id]) return;
    S.selected = id; renderInsight(); renderSensors(true); if (scene) scene.setSelected(id);
    if (openTab !== false) showTab("insight");
  }
  function showTab(name) {
    ["insight", "sensors", "log"].forEach(function (n) {
      var on = n === name; $("tabbtn-" + n).setAttribute("aria-selected", on); $("tab-" + n).hidden = !on;
    });
  }

  /* ---------------- sensors ---------------- */
  var spark = {};
  function sparkWindow() { return Math.min(8760, Math.max(72, S.speed * 6)); }
  function renderSensors(rebuildDom) {
    var u = Sim.UNIT_BY_ID[S.selected], sigs = Sim.SIGNALS[u.type], st = S.uState[u.id], root = $("tab-sensors");
    if (rebuildDom || root.dataset.unit !== u.id) {
      root.dataset.unit = u.id;
      var h = '<p class="ins-kick">' + E(u.id) + ' &middot; live model values</p><div class="ov" id="overview"></div>';
      if (!sigs.length) h += '<p class="ins-note">The control building has no process signals. It shows the count of open alerts and the filing review.</p>';
      sigs.forEach(function (s) {
        h += '<div class="sig" data-k="' + s.key + '"><div class="sig-h"><span>' + E(s.label) + '</span><span class="sig-v" id="sv-' + s.key + '"></span></div><canvas class="spark" id="sp-' + s.key + '" width="300" height="46"></canvas></div>';
      });
      h += '<p class="ins-note" id="sparkcap"></p><p class="ins-note">Nominal values, noise and limits are model parameters, not data. Dashed lines are the model limits.</p>';
      root.innerHTML = h; spark = {};
      var ov = ""; Sim.UNITS.forEach(function (x) { ov += '<button type="button" class="ovb" data-u="' + x.id + '" title="' + E(x.name) + '"><i></i>' + x.id + "</button>"; });
      $("overview").innerHTML = ov;
      $("overview").onclick = function (e) { var b = e.target.closest("button"); if (b) select(b.dataset.u, false); };
    }
    Array.prototype.forEach.call(document.querySelectorAll(".ovb"), function (b) { b.className = "ovb s-" + S.uState[b.dataset.u].status; });
    var W = sparkWindow();
    sigs.forEach(function (s) {
      var v = st.vals[s.key]; var el = $("sv-" + s.key);
      el.textContent = fmt(st.isolated && (s.key === "flow") ? 0 : v.v, s.nom < 10 ? 2 : 1) + " " + s.unit; el.className = "sig-v s-" + v.state;
      var c = $("sp-" + s.key), g = c.getContext("2d"), w = c.width, hh = c.height, n = 60, pts = [], lo = Infinity, hi = -Infinity, i;
      for (i = 0; i < n; i++) { var tt = Math.max(0, S.t - W + W * i / (n - 1)); var val = Sim.valueAt(params.seed, allEvents(), u.id, s.key, tt); pts.push(val); if (val < lo) lo = val; if (val > hi) hi = val; }
      if (s.hi != null) hi = Math.max(hi, s.hi); if (s.lo != null) lo = Math.min(lo, s.lo);
      var pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
      var Y = function (x) { return hh - 3 - (x - lo) / (hi - lo) * (hh - 6); };
      var css = getComputedStyle(document.documentElement);
      g.clearRect(0, 0, w, hh); g.lineWidth = 1; g.setLineDash([3, 3]); g.strokeStyle = "#E0554B";
      [s.hi, s.lo].forEach(function (L) { if (L != null) { g.beginPath(); g.moveTo(0, Y(L)); g.lineTo(w, Y(L)); g.stroke(); } });
      g.setLineDash([]); g.strokeStyle = css.getPropertyValue("--accent-2").trim() || "#0B5C3E"; g.lineWidth = 1.6; g.beginPath();
      pts.forEach(function (p, j) { var x = j / (n - 1) * w; if (j) g.lineTo(x, Y(p)); else g.moveTo(x, Y(p)); }); g.stroke();
    });
    var cap = $("sparkcap"); if (cap) cap.textContent = "Trailing window: " + fmt(W) + " simulated hours";
  }

  /* ---------------- event log + ontology actions ---------------- */
  var logSig = "";
  function renderLog(force) {
    var t = S.t, st = Sim.foldState(S.log, t);
    var visible = S.log.filter(function (e) { return e.at_h <= t; });
    var sig = visible.length + ":" + (S.log.length) + ":" + Object.keys(st.alerts).map(function (k) { return st.alerts[k].status + (st.alerts[k].workOrder || ""); }).join(",") + ":" + Object.keys(st.isolated).join(",");
    if (!force && sig === logSig) return; logSig = sig;
    var alerts = Object.keys(st.alerts).map(function (k) { return st.alerts[k]; }).sort(function (a, b) { return b.t - a.t; });
    var open = alerts.filter(function (a) { return a.status !== "closed"; });
    var h = '<div class="act-form"><label>Reason <select id="f-reason"><option>leak_suspected</option><option>sensor_trip</option><option>precaution</option></select></label>' +
      '<label>Priority <select id="f-prio"><option>routine</option><option>urgent</option></select></label>' +
      '<label class="wide">Note <input id="f-note" type="text" maxlength="500" placeholder="min 10 characters for work orders and filing flags" /></label></div>';
    h += '<h3 class="ins-t">Alerts (' + open.length + ' open or acknowledged)</h3>';
    if (!alerts.length) h += '<p class="ins-note">No alerts at this simulated time. Use Next incident to jump to the next drawn event, or inject a test excursion.</p>';
    alerts.slice(0, 12).forEach(function (a) {
      h += '<div class="alert sev-' + a.severity + '"><div class="al-h"><b>' + E(a.alert_id) + '</b><span class="chip">' + E(a.status) + "</span></div><div>" + E(a.unit) + " &middot; " + E(a.variable) + " &middot; " + E(a.limit) + (a.workOrder ? " &middot; " + E(a.workOrder) : "") + (st.isolated[a.unit] != null ? " &middot; unit isolated" : "") + "</div>" +
        '<div class="al-b">' +
        '<button type="button" data-a="acknowledge_alert" data-id="' + E(a.alert_id) + '">Acknowledge</button>' +
        (a.kind === "filing" ? '<button type="button" data-a="flag_filing_implausible" data-id="' + E(a.alert_id) + '">Flag filing</button>' :
          '<button type="button" data-a="isolate_unit" data-id="' + E(a.alert_id) + '">Isolate unit</button>') +
        '<button type="button" data-a="raise_work_order" data-id="' + E(a.alert_id) + '">Raise work order</button></div></div>';
    });
    h += '<h3 class="ins-t">Audit log (' + visible.length + ')</h3><div class="logwrap"><table class="logt"><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Object</th></tr></thead><tbody>';
    visible.slice(-60).reverse().forEach(function (e) {
      h += '<tr class="' + (e.result === "rejected" ? "rej" : "") + '"><td>' + e.seq + "</td><td>" + E(Sim.hourLabel(e.at_h)) + "</td><td>" + E(e.actor) + "</td><td>" + E(e.action) + (e.result === "rejected" ? " (rejected: " + E(e.failure_message) + ")" : "") + "</td><td>" + E(e.objects.alert || e.objects.incident || "") + (e.objects.unit ? " / " + E(e.objects.unit) : "") + "</td></tr>";
    });
    h += "</tbody></table></div>";
    $("tab-log").innerHTML = h;
        $("tab-log").onclick = function (ev) {
      var b = ev.target.closest("button[data-a]"); if (!b) return;
      var args = { alert: b.dataset.id, reason: $("f-reason").value, priority: $("f-prio").value, note: $("f-note").value };
      var entry = Sim.applyAction(S.log, b.dataset.a, args, S.t, "you (analyst)");
      S.manual.push(entry); mergeLog(); renderLog(true); S.uState = Sim.unitState(params.seed, allEvents(), S.log, S.t);
      $("status").textContent = entry.result === "applied" ? entry.action + " applied to " + args.alert : "Rejected: " + entry.failure_message;
    };
    $("logcount").textContent = visible.length;
  }

  function exportJson() {
    var obj = Sim.exportLog(DATA, params, S.log);
    obj.test_excursions = (S.testEvents || []).map(function (e) { return { id: e.id, unit: e.unit, variable: e.key, at_h: e.t0 }; });
    var blob = new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "plant-blueprint-log-seed" + params.seed + ".json";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------------- time control ---------------- */
  function nextIncidentTime(after) {
    var best = null; allEvents().forEach(function (e) { if (e.t0 > after + 0.001 && (best == null || e.t0 < best)) best = e.t0; }); return best;
  }
  function advance(dt) {
    if (!S.playing) return;
    var step = dt * S.speed, H = horizonH();
    if (S.autoSlow) {
      var near = false, evs = allEvents(), prevStart = null;
      for (var i = 0; i < evs.length; i++) {
        var e = evs[i], s0 = e.t0 - 12, e1 = e.t0 + 8 + 2 + 6;
        if (S.t >= s0 && S.t <= e1) near = true;
        else if (S.t < s0 && S.t + step > s0) { S.t = s0; step = 0; near = true; }
      }
      if (near) step = Math.min(step, dt * 6);
    }
    S.t += step;
    if (S.t >= H) { S.t = H; S.playing = false; syncPlay(); }
  }
  function syncPlay() { $("play").textContent = S.playing ? "Pause" : "Play"; $("play").setAttribute("aria-pressed", S.playing); }

  /* ---------------- three.js scene ---------------- */
  var scene = null;
  function buildScene(THREE, canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var sc = new THREE.Scene(); sc.background = new THREE.Color(0x061a36); sc.fog = new THREE.Fog(0x061a36, 90, 220);
    var cam = new THREE.PerspectiveCamera(42, 1, 0.5, 500);
    var CYAN = 0x39d5f7, AMBER = 0xffb02e, RED = 0xff4d4d, GREY = 0x7a8aa0, FILL = 0x0a2a52, SAFE = 0xff7ad9;
    var groups = {}, layers = { units: [], piping: [], safety: [], notes: [] }, edgeMats = {}, pick = [], dyn = {};

    /* grid */
    var grid = new THREE.GridHelper(120, 120, 0x1e5a9a, 0x0f3566); grid.position.set(6, 0, 4); sc.add(grid);
    var major = new THREE.GridHelper(120, 12, 0x3b8fd8, 0x3b8fd8); major.position.set(6, 0.01, 4); major.material.transparent = true; major.material.opacity = 0.55; sc.add(major);

    function mats(id) {
      var edge = new THREE.LineBasicMaterial({ color: CYAN }); edgeMats[id] = edgeMats[id] || []; edgeMats[id].push(edge);
      var fill = new THREE.MeshBasicMaterial({ color: FILL, transparent: true, opacity: 0.72, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      return { edge: edge, fill: fill };
    }
    function solid(geo, id, parent, x, y, z, opt) {
      var m = mats(id), mesh = new THREE.Mesh(geo, m.fill); mesh.position.set(x || 0, y || 0, z || 0);
      var ed = new THREE.LineSegments(new THREE.EdgesGeometry(geo, (opt && opt.angle) || 25), m.edge); mesh.add(ed);
      parent.add(mesh); if (!(opt && opt.nopick)) { mesh.userData.unitId = id; pick.push(mesh); } return mesh;
    }
    function label(text, size, color) {
      var c = document.createElement("canvas"), g = c.getContext("2d"); c.width = 256; c.height = 64;
      g.font = "600 26px 'IBM Plex Mono', monospace"; g.fillStyle = color || "#9fe8ff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 128, 32);
      var tex = new THREE.CanvasTexture(c), sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })); sp.scale.set(size * 4, size, 1); sp.renderOrder = 10; return sp;
    }
    function line(pts, color, parent, dashed) {
      var geo = new THREE.BufferGeometry().setFromPoints(pts.map(function (p) { return new THREE.Vector3(p[0], p[1], p[2]); }));
      var l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color })); parent.add(l); return l;
    }
    function dim(a, b, off, text, parent) {
      var A = [a[0] + off[0], a[1] + off[1], a[2] + off[2]], B = [b[0] + off[0], b[1] + off[1], b[2] + off[2]];
      line([a, A], 0xffd24d, parent); line([b, B], 0xffd24d, parent); line([A, B], 0xffd24d, parent);
      var m = label(text, 0.9, "#ffd24d"); m.position.set((A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 0.7, (A[2] + B[2]) / 2); parent.add(m);
    }
    function makeGroup(id) { var g = new THREE.Group(); g.position.set(POS[id][0], 0, POS[id][1]); groups[id] = g; sc.add(g); return g; }
    function tag(id, y, parent) { var l = label(id, 1.2); l.position.set(0, y, 0); parent.add(l); }

    var U = Sim.UNIT_BY_ID;
    Sim.UNITS.forEach(function (u) {
      var g = makeGroup(u.id), id = u.id, T = THREE;
      if (u.type === "reactor") {
        solid(new T.CylinderGeometry(2, 2, 6, 28), id, g, 0, 4, 0);
        solid(new T.SphereGeometry(2, 20, 10, 0, 6.283, 0, 1.5708), id, g, 0, 7, 0);
        solid(new T.SphereGeometry(2, 20, 10, 0, 6.283, 1.5708, 1.5708), id, g, 0, 1, 0);
        solid(new T.CylinderGeometry(2.25, 2.25, 0.5, 28, 1, true), id, g, 0, 3, 0);
        solid(new T.BoxGeometry(1.2, 1, 1.2), id, g, 0, 9.5, 0); solid(new T.CylinderGeometry(0.12, 0.12, 6, 8), id, g, 0, 5.3, 0, { nopick: true });
        [[1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]].forEach(function (p) { solid(new T.BoxGeometry(0.25, 1.4, 0.25), id, g, p[0], 0.7, p[1]); });
        var f = new T.Mesh(new T.CylinderGeometry(1.7, 1.7, 1, 24), new T.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.28, depthWrite: false })); f.position.set(0, 1, 0); g.add(f); dyn[id] = { fill: f, base: 1, height: 6 };
        tag(id, 11.5, g);
      } else if (u.type === "column") {
        solid(new T.CylinderGeometry(1.3, 1.3, 13, 24), id, g, 0, 7.5, 0);
        solid(new T.SphereGeometry(1.3, 16, 8, 0, 6.283, 0, 1.5708), id, g, 0, 14, 0); solid(new T.SphereGeometry(1.3, 16, 8, 0, 6.283, 1.5708, 1.5708), id, g, 0, 1, 0);
        for (var k = 0; k < 9; k++) solid(new T.CylinderGeometry(1.36, 1.36, 0.12, 24), id, g, 0, 2.6 + k * 1.2, 0, { nopick: true });
        solid(new T.BoxGeometry(0.1, 12, 0.1), id, g, 1.6, 7.5, 0, { nopick: true });
        solid(new T.CylinderGeometry(0.7, 0.7, 2.6, 16), id, g, 3.2, 14.6, 0); line([[0, 14.6, 0], [3.2, 14.6, 0]], CYAN, g);
        var rd = solid(new T.CylinderGeometry(0.8, 0.8, 3, 16), id, g, 3.4, 2.2, 0); rd.rotation.z = Math.PI / 2;
        var f2 = new T.Mesh(new T.CylinderGeometry(0.62, 0.62, 1, 14), new T.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.3, depthWrite: false })); f2.position.set(3.4, 2.2, 0); f2.rotation.z = Math.PI / 2; g.add(f2); dyn[id] = { fill: f2, drum: true };
        tag(id, 17.5, g);
      } else if (u.type === "tank") {
        solid(new T.CylinderGeometry(3.5, 3.5, 5.2, 32), id, g, 0, 2.6, 0);
        solid(new T.ConeGeometry(3.6, 1.1, 32), id, g, 0, 5.75, 0);
        solid(new T.CylinderGeometry(3.6, 3.6, 0.25, 32, 1, true), id, g, 0, 5.2, 0, { nopick: true });
        solid(new T.BoxGeometry(0.2, 5.5, 0.2), id, g, 3.65, 2.7, 0, { nopick: true });
        var f3 = new T.Mesh(new T.CylinderGeometry(3.35, 3.35, 1, 28), new T.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.26, depthWrite: false })); f3.position.set(0, 0.1, 0); g.add(f3); dyn[id] = { fill: f3, base: 0.1, height: 5 };
        tag(id, 8.4, g);
      } else if (u.type === "exchanger") {
        var sh = solid(new T.CylinderGeometry(1, 1, 6, 24), id, g, 0, 1.9, 0); sh.rotation.z = Math.PI / 2;
        var hd = solid(new T.CylinderGeometry(1.25, 1.25, 0.8, 24), id, g, 3.5, 1.9, 0); hd.rotation.z = Math.PI / 2;
        var hd2 = solid(new T.CylinderGeometry(1.1, 1.1, 0.5, 24), id, g, -3.2, 1.9, 0); hd2.rotation.z = Math.PI / 2;
        solid(new T.CylinderGeometry(0.3, 0.3, 1, 10), id, g, -1.2, 3.2, 0); solid(new T.CylinderGeometry(0.3, 0.3, 1, 10), id, g, 1.2, 0.5, 0);
        solid(new T.BoxGeometry(0.4, 1, 1.6), id, g, -1.6, 0.5, 0); solid(new T.BoxGeometry(0.4, 1, 1.6), id, g, 1.6, 0.5, 0);
        tag(id, 5, g);
      } else if (u.type === "pump") {
        solid(new T.BoxGeometry(3.4, 0.3, 1.6), id, g, 0, 0.15, 0);
        var vo = solid(new T.CylinderGeometry(0.7, 0.7, 0.8, 18), id, g, -0.9, 0.9, 0); vo.rotation.x = Math.PI / 2;
        var mo = solid(new T.CylinderGeometry(0.6, 0.6, 1.6, 18), id, g, 0.9, 0.9, 0); mo.rotation.z = Math.PI / 2;
        var imp = new THREE.Group(); imp.position.set(-0.9, 0.9, 0.46);
        var im = mats(id); for (var q = 0; q < 6; q++) { var bl = new T.Mesh(new T.BoxGeometry(0.62, 0.07, 0.07), im.fill); bl.rotation.z = q * Math.PI / 3; bl.add(new T.LineSegments(new T.EdgesGeometry(bl.geometry), im.edge)); imp.add(bl); }
        g.add(imp); dyn[id] = { imp: imp };
        tag(id, 3, g);
      } else if (u.type === "piperack") {
        var len = 52, W = 6;
        for (var xi = -26; xi <= 26; xi += 6.5) {
          solid(new T.BoxGeometry(0.3, RACK_Y, 0.3), id, g, xi, RACK_Y / 2, -W / 2); solid(new T.BoxGeometry(0.3, RACK_Y, 0.3), id, g, xi, RACK_Y / 2, W / 2);
          solid(new T.BoxGeometry(0.3, 0.3, W + 0.3), id, g, xi, RACK_Y, 0);
        }
        solid(new T.BoxGeometry(len, 0.2, 0.2), id, g, 0, RACK_Y, -W / 2); solid(new T.BoxGeometry(len, 0.2, 0.2), id, g, 0, RACK_Y, W / 2);
        tag(id, 8, g);
      } else if (u.type === "flare") {
        solid(new T.CylinderGeometry(0.35, 0.5, 22, 12), id, g, 0, 11, 0);
        var ko = solid(new T.CylinderGeometry(1.6, 1.6, 6, 20), id, g, -9, 1.8, 0); ko.rotation.z = Math.PI / 2;
        solid(new T.BoxGeometry(0.3, 1.6, 0.3), id, g, -10.5, 0.8, 0); solid(new T.BoxGeometry(0.3, 1.6, 0.3), id, g, -7.5, 0.8, 0);
        var flame = new T.Mesh(new T.ConeGeometry(0.9, 3, 12, 1, true), new T.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.75, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
        flame.position.set(0, 23.5, 0); g.add(flame);
        var inner = new T.Mesh(new T.ConeGeometry(0.45, 2, 12, 1, true), new T.MeshBasicMaterial({ color: 0xffe36b, transparent: true, opacity: 0.85, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide })); inner.position.set(0, 23.1, 0); g.add(inner);
        dyn[id] = { flame: flame, inner: inner }; tag(id, 27, g);
      } else if (u.type === "control") {
        solid(new T.BoxGeometry(10, 4.4, 5), id, g, 0, 2.2, 0, { angle: 10 });
        solid(new T.BoxGeometry(10.4, 0.3, 5.4), id, g, 0, 4.55, 0);
        for (var wx = -3.6; wx <= 3.6; wx += 1.8) solid(new T.BoxGeometry(1.0, 0.8, 0.06), id, g, wx, 2.9, 2.53, { nopick: true });
        solid(new T.BoxGeometry(1.1, 2.1, 0.06), id, g, 4.2, 1.05, 2.53, { nopick: true });
        solid(new T.CylinderGeometry(0.08, 0.08, 4, 6), id, g, -4, 6.6, 0); tag(id, 8.6, g);
      }
      layers[u.type === "flare" ? "safety" : "units"].push(g);
      if (u.type === "piperack") { layers.units.pop(); layers.piping.push(g); }
    });

    /* process piping with flow particles */
    var pipeRoot = new THREE.Group(); sc.add(pipeRoot); layers.piping.push(pipeRoot);
    var pipes = [];
    PIPES.forEach(function (pp, i) {
      var A = pp[0], B = pp[1], ua = U[A], ub = U[B], lane = 16.6 + (i % 9) * 0.6 + Math.floor(i / 9) * 0, ya = NOZ[ua.type], yb = NOZ[ub.type];
      var a = POS[A], b = POS[B], path;
      var ox = ua.type === "tank" ? -3.5 : 0, ix = ub.type === "tank" ? -3.5 : 0;
      if (pp[2] === "direct") path = [[a[0] + 2, 5.5, a[1]], [b[0] - 2, 5.5, b[1]]];
      else path = [[a[0] + ox, ya, a[1]], [a[0] + ox, RACK_Y + 0.1 + (i % 4) * 0.25, a[1]], [a[0] + ox, RACK_Y + 0.1 + (i % 4) * 0.25, lane], [b[0] + ix, RACK_Y + 0.1 + (i % 4) * 0.25, lane], [b[0] + ix, RACK_Y + 0.1 + (i % 4) * 0.25, b[1]], [b[0] + ix, yb, b[1]]];
      line(path, 0x39d5f7, pipeRoot);
      var segs = [], total = 0;
      for (var s = 1; s < path.length; s++) { var d = Math.hypot(path[s][0] - path[s - 1][0], path[s][1] - path[s - 1][1], path[s][2] - path[s - 1][2]); segs.push(d); total += d; }
      var n = Math.max(6, Math.round(total / 2.2)), pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x9ff3ff, size: 0.55, transparent: true, opacity: 0.95, depthWrite: false }));
      pts.frustumCulled = false; pipeRoot.add(pts);
      pipes.push({ path: path, segs: segs, total: total, n: n, geo: geo, pos: pos, a: A, b: B, phase: i * 0.137, pts: pts });
    });

    /* safety systems: relief header to flare, PSVs, gas detectors, ESD valves, dike */
    var safeRoot = new THREE.Group(); sc.add(safeRoot); layers.safety.push(safeRoot);
    [["R-101", 9.4], ["R-102", 9.4], ["C-201", 15.4], ["C-202", 15.4]].forEach(function (r, i) {
      var p = POS[r[0]], zlane = -18 + i * 0.5;
      var psv = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 4), new THREE.MeshBasicMaterial({ color: SAFE })); psv.position.set(p[0] + 0.9, r[1] + 0.3, p[1]); safeRoot.add(psv);
      line([[p[0] + 0.9, r[1] + 0.7, p[1]], [p[0] + 0.9, 18 + i * 0.3, p[1]], [p[0] + 0.9, 18 + i * 0.3, zlane], [POS["F-701"][0] - 12, 18 + i * 0.3, zlane], [POS["F-701"][0] - 12, 18 + i * 0.3, POS["F-701"][1]], [POS["F-701"][0] - 9, 3.4, POS["F-701"][1]]], SAFE, safeRoot);
    });
    line([[POS["F-701"][0] - 9, 3.4, POS["F-701"][1]], [POS["F-701"][0], 3.4, POS["F-701"][1]], [POS["F-701"][0], 21, POS["F-701"][1]]], SAFE, safeRoot);
    var gasSpheres = {};
    Sim.UNITS.forEach(function (u) {
      if (!Sim.SIGNALS[u.type].some(function (s) { return s.key === "gas"; })) return;
      var p = POS[u.id], h = { reactor: 8, column: 3, tank: 5.5, pump: 2.4, piperack: 6.2 }[u.type];
      var det = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: 0x8dff9a })); det.position.set(p[0] + (u.type === "tank" ? 3.9 : 2.6), h, p[1] + (u.type === "piperack" ? 3.5 : 0)); safeRoot.add(det);
      var plume = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff5a4d, transparent: true, opacity: 0.0, depthWrite: false })); plume.position.set(p[0], h * 0.8, p[1]); safeRoot.add(plume); gasSpheres[u.id] = { det: det, plume: plume, base: new THREE.Color(0x8dff9a) };
    });
    [["T-301", 0], ["T-302", 0], ["T-303", 0]].forEach(function (t) { var p = POS[t[0]]; var esd = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: SAFE })); esd.position.set(p[0] - 3.9, 1.2, p[1]); safeRoot.add(esd); });
    var dike = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(14, 1.4, 34)), new THREE.LineBasicMaterial({ color: SAFE })); dike.position.set(22, 0.7, 0); safeRoot.add(dike);
    var sl = label("RELIEF HEADER", 1.0, "#ff9be6"); sl.position.set(14, 19.2, -18); safeRoot.add(sl);
    var dl = label("DIKE", 1.0, "#ff9be6"); dl.position.set(22, 2.4, -18.3); safeRoot.add(dl);
    layers.safety.push(groups["F-701"]);

    /* dimension-style annotations (drawing units, not engineering data) */
    var noteRoot = new THREE.Group(); sc.add(noteRoot); layers.notes.push(noteRoot);
    dim([-22, 0, -4], [-22, 9, -4], [-4.4, 0, 0], "H 9u", noteRoot);
    dim([-24, 0, -8], [-20, 0, -8], [0, 0, 3.6], "D 4u", noteRoot);
    dim([-4, 0, -9.6], [-4, 14.6, -9.6], [-3.6, 0, 0], "H 14.6u", noteRoot);
    dim([18.5, 0.1, -10], [25.5, 0.1, -10], [0, 0, -5.2], "D 7u", noteRoot);
    dim([-26, RACK_Y, 22], [26, RACK_Y, 22], [0, 0, 3], "L 52u", noteRoot);
    dim([38, 0, -23], [38, 22, -23], [0, 0, -2.5], "H 22u", noteRoot);
    var scl = label("ALL DIMENSIONS IN DRAWING UNITS (u), ILLUSTRATIVE", 0.9, "#ffd24d"); scl.scale.set(18, 1.6, 1); scl.position.set(0, 0.3, 26); noteRoot.add(scl);

    /* orbit controls (own implementation) */
    var target = new THREE.Vector3(6, 4, 2), sph = { r: 122, th: 0.78, ph: 1.0 }, v = { th: 0, ph: 0, r: 0 }, home = JSON.stringify(sph);
    function updateCam() {
      sph.ph = Math.max(0.12, Math.min(1.5, sph.ph)); sph.r = Math.max(12, Math.min(190, sph.r));
      cam.position.set(target.x + sph.r * Math.sin(sph.ph) * Math.sin(sph.th), target.y + sph.r * Math.cos(sph.ph), target.z + sph.r * Math.sin(sph.ph) * Math.cos(sph.th));
      cam.lookAt(target);
    }
    var ptrs = {}, dragMode = null, moved = 0, lastPinch = 0, down = null;
    canvas.style.touchAction = "none";
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    canvas.addEventListener("pointerdown", function (e) {
      canvas.setPointerCapture(e.pointerId); ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; moved = 0; down = { x: e.clientX, y: e.clientY };
      dragMode = (e.button === 2 || e.shiftKey || e.button === 1) ? "pan" : "orbit"; lastPinch = 0;
    });
    canvas.addEventListener("pointermove", function (e) {
      var p = ptrs[e.pointerId];
      if (!p) { hover(e); return; }
      var dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
      var ids = Object.keys(ptrs);
      if (ids.length >= 2) {
        var o = ptrs[ids[0] === String(e.pointerId) ? ids[1] : ids[0]], d = Math.hypot(e.clientX - o.x, e.clientY - o.y);
        if (lastPinch) sph.r *= lastPinch / d; lastPinch = d;
      } else if (dragMode === "pan") {
        var k = sph.r * 0.0016, rx = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0), fz = new THREE.Vector3().crossVectors(rx, new THREE.Vector3(0, 1, 0));
        target.addScaledVector(rx, -dx * k).addScaledVector(fz, -dy * k);
      } else { sph.th -= dx * 0.006; sph.ph -= dy * 0.006; }
      p.x = e.clientX; p.y = e.clientY;
    });
    function up(e) {
      var wasClick = moved < 5 && ptrs[e.pointerId] && Object.keys(ptrs).length === 1; delete ptrs[e.pointerId];
      if (wasClick) { var id = pickAt(e); if (id) select(id); }
    }
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", function (e) { delete ptrs[e.pointerId]; });
    canvas.addEventListener("wheel", function (e) { e.preventDefault(); sph.r *= Math.exp(e.deltaY * 0.001); }, { passive: false });
    canvas.addEventListener("keydown", function (e) {
      var k = { ArrowLeft: [0.08, 0], ArrowRight: [-0.08, 0], ArrowUp: [0, 0.08], ArrowDown: [0, -0.08] }[e.key];
      if (k) { sph.th += k[0]; sph.ph += k[1]; e.preventDefault(); } else if (e.key === "+" || e.key === "=") sph.r *= 0.9; else if (e.key === "-") sph.r *= 1.1;
    });
    var ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    function pickAt(e) {
      var r = canvas.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, cam); var vis = pick.filter(function (m) { return m.visible && isVisible(m); });
      var hit = ray.intersectObjects(vis, false)[0]; return hit ? hit.object.userData.unitId : null;
    }
    function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
    function hover(e) { var id = pickAt(e); canvas.style.cursor = id ? "pointer" : "grab"; scene.hover = id; $("hovertip").textContent = id ? Sim.UNIT_BY_ID[id].name + " (click for insight)" : ""; }

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
      if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); }
    }

    var selBox = new THREE.Box3Helper(new THREE.Box3(), 0xffffff); selBox.visible = false; sc.add(selBox);
    var boxTmp = new THREE.Box3();
    function setSelected(id) {
      boxTmp.makeEmpty(); groups[id].traverse(function (o) { if (o.isMesh) boxTmp.expandByObject(o); });
      if (boxTmp.isEmpty()) boxTmp.setFromObject(groups[id]); selBox.box.copy(boxTmp); selBox.visible = true;
    }

    var flick = 0, clock = 0;
    function frame(dt) {
      clock += dt; resize();
      var uS = S.uState;
      Object.keys(groups).forEach(function (id) {
        var st = uS[id], col = CYAN;
        if (st.status === "warn") col = AMBER; else if (st.status === "alarm") col = (Math.floor(clock * 3) % 2) ? RED : 0xff9a9a; else if (st.status === "isolated") col = GREY;
        (edgeMats[id] || []).forEach(function (m) { m.color.setHex(id === S.selected && st.status === "ok" ? 0xcffaff : col); });
        var d = dyn[id];
        if (d && d.fill) {
          var lv = st.vals.level ? st.vals.level.v : 50, H = d.height || 1;
          if (d.drum) { d.fill.scale.set(1, 1, Math.max(0.05, lv / 100) * 1); d.fill.scale.y = 1; d.fill.scale.x = 1; d.fill.scale.z = 0.4 + lv / 100 * 0.6; }
          else { var hh = Math.max(0.05, H * lv / 100); d.fill.scale.y = hh; d.fill.position.y = d.base + hh / 2; }
        }
        if (d && d.imp) { var fl = st.vals.flow ? st.vals.flow.v / 80 : 1; d.imp.rotation.z -= st.isolated ? 0 : dt * 9 * fl; }
        if (d && d.flame) {
          var fr = st.vals.flow.v, k = 0.55 + fr / 6 * 1.4; flick = Math.sin(clock * 23) * 0.12 + Math.sin(clock * 37.3) * 0.08;
          d.flame.scale.set(k * (1 + flick), k * (1.1 + flick * 2), k * (1 + flick)); d.flame.position.y = 22 + 1.5 * d.flame.scale.y;
          d.inner.scale.set(k * 0.9, k * (1 + flick * 3), k * 0.9); d.inner.position.y = 22 + 1 * d.inner.scale.y; d.flame.visible = d.inner.visible = true;
        }
        var gs = gasSpheres[id];
        if (gs) { var gv = st.vals.gas.v, a = Math.max(0, Math.min(0.55, (gv - 3) / 60)); gs.plume.material.opacity = a; gs.plume.scale.setScalar(1 + gv / 14); gs.det.material.color.setHex(st.vals.gas.state === "alarm" ? RED : st.vals.gas.state === "warn" ? AMBER : 0x8dff9a); }
      });
      /* particles */
      pipes.forEach(function (pp) {
        var a = uS[pp.a], b = uS[pp.b], f = 1;
        [a, b, uS["PR-601"]].forEach(function (x, i) { if (x.vals.flow) { var nom = Sim.sigDef(Sim.UNIT_BY_ID[i < 2 ? (i ? pp.b : pp.a) : "PR-601"], "flow").nom; f = Math.min(f, Math.max(0, x.vals.flow.v / nom)); } });
        if (a.isolated || b.isolated) f = 0;
        pp.phase = (pp.phase + dt * 0.09 * f) % 1;
        for (var i = 0; i < pp.n; i++) {
          var dd = ((i / pp.n + pp.phase) % 1) * pp.total, s = 0;
          while (s < pp.segs.length - 1 && dd > pp.segs[s]) { dd -= pp.segs[s]; s++; }
          var u0 = pp.path[s], u1 = pp.path[s + 1], tt = pp.segs[s] ? dd / pp.segs[s] : 0;
          pp.pos[i * 3] = u0[0] + (u1[0] - u0[0]) * tt; pp.pos[i * 3 + 1] = u0[1] + (u1[1] - u0[1]) * tt; pp.pos[i * 3 + 2] = u0[2] + (u1[2] - u0[2]) * tt;
        }
        pp.geo.attributes.position.needsUpdate = true; pp.pts.material.color.setHex(f === 0 ? GREY : 0x9ff3ff);
      });
      selBox.visible = !!S.selected && groups[S.selected].visible;
      /* damping */
      updateCam(); renderer.render(sc, cam);
    }
    function setLayer(name, on) { layers[name].forEach(function (o) { o.visible = on; }); }
    function resetView() { var h = JSON.parse(home); sph.r = h.r; sph.th = h.th; sph.ph = h.ph; target.set(6, 4, 2); }
    function focus(id) { var p = POS[id]; target.set(p[0], 4, p[1]); sph.r = Math.min(sph.r, 55); }
    updateCam();
    scene = { frame: frame, setLayer: setLayer, setSelected: setSelected, resetView: resetView, focus: focus, renderer: renderer, hover: null, THREE: THREE };
    setSelected(S.selected);
    canvas.tabIndex = 0; canvas.setAttribute("aria-label", "3D schematic of a generic chemical plant. Drag to orbit, shift-drag or right-drag to pan, scroll to zoom, arrow keys rotate. Use the unit buttons in the Sensors tab to select units.");
    return scene;
  }

  /* ---------------- Canvas2D isometric fallback ---------------- */
  function buildFallback(canvas) {
    var g = canvas.getContext("2d"), boxes = [];
    var SZ = { reactor: [4, 9, 4], column: [3, 15, 3], tank: [7, 6, 7], exchanger: [7, 3, 3], pump: [3, 2, 2], piperack: [52, 6, 6], flare: [2, 24, 2], control: [10, 6, 5] };
    function iso(x, y, z) { return [(x - z) * 0.866, (x + z) * 0.5 - y]; }
    function frame() {
      var w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
      g.fillStyle = "#061a36"; g.fillRect(0, 0, w, h);
      var sc = Math.min(w / 110, h / 70), ox = w * 0.5 + 6 * sc, oy = h * 0.55; boxes = [];
      g.strokeStyle = "#0f3566"; g.lineWidth = 1;
      for (var i = -50; i <= 50; i += 5) { var a = iso(i, 0, -50), b = iso(i, 0, 50), c = iso(-50, 0, i), d = iso(50, 0, i); g.beginPath(); g.moveTo(ox + a[0] * sc, oy + a[1] * sc); g.lineTo(ox + b[0] * sc, oy + b[1] * sc); g.moveTo(ox + c[0] * sc, oy + c[1] * sc); g.lineTo(ox + d[0] * sc, oy + d[1] * sc); g.stroke(); }
      Sim.UNITS.slice().sort(function (p, q) { return (POS[p.id][0] + POS[p.id][1]) - (POS[q.id][0] + POS[q.id][1]); }).forEach(function (u) {
        var p = POS[u.id], s = SZ[u.type], x0 = p[0] - s[0] / 2, z0 = p[1] - s[2] / 2, st = S.uState[u.id].status;
        var col = st === "alarm" ? "#ff4d4d" : st === "warn" ? "#ffb02e" : st === "isolated" ? "#7a8aa0" : u.id === S.selected ? "#cffaff" : "#39d5f7";
        var P = function (x, y, z) { var q = iso(x, y, z); return [ox + q[0] * sc, oy + q[1] * sc]; };
        var top = [P(x0, s[1], z0), P(x0 + s[0], s[1], z0), P(x0 + s[0], s[1], z0 + s[2]), P(x0, s[1], z0 + s[2])];
        var fr = [P(x0, 0, z0 + s[2]), P(x0 + s[0], 0, z0 + s[2]), P(x0 + s[0], s[1], z0 + s[2]), P(x0, s[1], z0 + s[2])];
        var rt = [P(x0 + s[0], 0, z0), P(x0 + s[0], 0, z0 + s[2]), P(x0 + s[0], s[1], z0 + s[2]), P(x0 + s[0], s[1], z0)];
        [[fr, "#0a2a52"], [rt, "#0c3566"], [top, "#12407a"]].forEach(function (f) { g.beginPath(); f[0].forEach(function (q, j) { j ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.closePath(); g.fillStyle = f[1]; g.fill(); g.strokeStyle = col; g.lineWidth = u.id === S.selected ? 2.4 : 1.4; g.stroke(); });
        var xs = fr.concat(top, rt).map(function (q) { return q[0]; }), ys = fr.concat(top, rt).map(function (q) { return q[1]; });
        boxes.push({ id: u.id, x0: Math.min.apply(0, xs), x1: Math.max.apply(0, xs), y0: Math.min.apply(0, ys), y1: Math.max.apply(0, ys) });
        g.fillStyle = "#9fe8ff"; g.font = "600 11px monospace"; g.textAlign = "center"; g.fillText(u.id, (Math.min.apply(0, xs) + Math.max.apply(0, xs)) / 2, Math.min.apply(0, ys) - 4);
      });
    }
    canvas.addEventListener("click", function (e) { var r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; for (var i = boxes.length - 1; i >= 0; i--) { var b = boxes[i]; if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { select(b.id); return; } } });
    return { frame: frame, setLayer: function () {}, setSelected: function () {}, resetView: function () {}, focus: function () {}, fallback: true };
  }

  /* ---------------- boot ---------------- */
  function webglOk() { try { var c = document.createElement("canvas"); return !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl"))); } catch (e) { return false; } }
  function boot() {
    rebuild(true); S.uState = Sim.unitState(params.seed, allEvents(), S.log, S.t);
    var glCanvas = $("gl"), fbCanvas = $("fb"), mode = "webgl", fallbackWhy = "";
    if (!window.THREE) fallbackWhy = "The three.js script did not load."; else if (!webglOk()) fallbackWhy = "WebGL is not available in this browser.";
    if (!fallbackWhy) { try { buildScene(window.THREE, glCanvas); } catch (err) { fallbackWhy = "The 3D renderer failed to start (" + err.message + ")."; scene = null; } }
    if (fallbackWhy) {
      mode = "canvas2d"; glCanvas.hidden = true; fbCanvas.hidden = false; $("fallbackMsg").hidden = false; $("fallbackMsg").textContent = fallbackWhy + " Showing a flat isometric view; the simulation, insight panels and event log work the same.";
      scene = buildFallback(fbCanvas); $("layers").hidden = true;
    }
    document.body.dataset.render = mode;
    wire(); renderInsight(); renderSensors(true); renderLog(true); syncPlay(); updateTimeUi();
    var last = null;
    function loop(ts) {
      var dt = last == null ? 0.016 : Math.min(0.1, (ts - last) / 1000); last = ts;
      advance(dt); S.uState = Sim.unitState(params.seed, allEvents(), S.log, S.t);
      scene.frame(dt); updateTimeUi(); window.__plantFrames = (window.__plantFrames || 0) + 1;
      sensTick += dt; if (sensTick > 0.25) { sensTick = 0; renderSensors(false); renderLog(false); }
      requestAnimationFrame(loop);
    }
    var sensTick = 0; requestAnimationFrame(loop);
    window.__plant = { S: S, params: params, Sim: Sim, rebuild: rebuild, mode: mode };
  }
  function updateTimeUi() {
    var sc = $("scrub"); if (document.activeElement !== sc) sc.value = String(S.t / horizonH() * 10000);
    $("timelabel").textContent = Sim.hourLabel(S.t) + " of " + params.horizonYears + " y";
    var inc = S.events.filter(function (e) { return e.t0 <= S.t; }).length;
    $("evcount").textContent = S.events.length + " drawn in horizon (" + inc + " so far)";
  }
  function wire() {
    $("play").onclick = function () { if (S.t >= horizonH()) S.t = 0; S.playing = !S.playing; syncPlay(); };
    $("speed").onchange = function () { S.speed = Number($("speed").value); };
    $("autoslow").onchange = function () { S.autoSlow = $("autoslow").checked; };
    $("scrub").oninput = function () { S.t = Number($("scrub").value) / 10000 * horizonH(); S.playing = false; syncPlay(); renderLog(true); };
    var reparam = function () {
      params.seed = Math.max(1, Math.floor(Number($("seed").value) || 1)); $("seed").value = params.seed;
      params.band = $("band").value; params.rateMode = $("ratemode").value; params.horizonYears = Number($("horizon").value); params.autoOperator = $("autoop").checked;
      rebuild(true); S.t = Math.min(S.t, horizonH()); logSig = ""; renderLog(true); renderRates(); $("status").textContent = "Re-seeded: " + S.events.length + " event(s) drawn for seed " + params.seed + ".";
    };
    ["seed", "band", "ratemode", "horizon", "autoop"].forEach(function (id) { $(id).onchange = reparam; });
    $("seedprev").onclick = function () { $("seed").value = Math.max(1, params.seed - 1); reparam(); };
    $("seednext").onclick = function () { $("seed").value = params.seed + 1; reparam(); };
    $("nextinc").onclick = function () { var tt = nextIncidentTime(S.t + 1.001);
      if (tt == null) { $("status").textContent = "No further drawn incident in this horizon. Change the seed or horizon."; return; }
      S.t = Math.max(0, tt - 1); S.playing = false; syncPlay(); var ev = allEvents().filter(function (e) { return e.t0 === tt; })[0]; select(ev.unit, false); if (scene) scene.focus(ev.unit); renderLog(true);
      $("status").textContent = "Jumped to " + ev.id + " (" + ev.kind + ") at " + Sim.hourLabel(tt) + " on " + ev.unit + "."; };
    $("testexc").onclick = function () {
      var u = Sim.UNIT_BY_ID[S.selected], sg = Sim.SIGNALS[u.type][0];
      if (!sg) { $("status").textContent = "Select a unit with process signals first."; return; }
      S.testN++; var ev = Sim.testEvent(u.id, sg.key, S.t + 0.5, S.testN); S.testEvents.push(ev);
      S.testLogs.push(Sim.systemLog(DATA, params, [ev]).map(function (e) { if (e.actor.indexOf("operator") === 0) e.actor = "operator:auto (model)"; return e; }));
      mergeLog(); logSig = ""; S.playing = true; syncPlay(); S.speed = Math.min(S.speed, 6); $("speed").value = String(S.speed); renderLog(true);
      $("status").textContent = "Injected a model test excursion on " + u.id + " " + sg.label + " (not a statistic).";
    };
    $("export").onclick = exportJson;
    $("resetview").onclick = function () { scene.resetView(); };
    ["units", "piping", "safety", "notes"].forEach(function (n) { $("ly-" + n).onchange = function () { scene.setLayer(n, $("ly-" + n).checked); }; });
    ["insight", "sensors", "log"].forEach(function (n) { $("tabbtn-" + n).onclick = function () { showTab(n); if (n === "log") renderLog(true); }; });
    renderRates(); renderDocs();
  }
  function renderRates() {
    var r = Sim.rateFor(DATA, params), f = DATA.sim_rates.filing_implausible;
    $("ratebox").innerHTML = "Release stream: <b>" + fmt(r.pct, 4) + "%</b> per plant-year (" + params.rateMode + "; " + fmt(r.band.events) + " / " + fmt(r.band.plant_years) + " plant-years, Wilson " + fmt(r.band.wilson_pct[0], 4) + "% to " + fmt(r.band.wilson_pct[1], 4) + "%), column <code>rate_pct</code>/<code>wilson_pct</code> in " + srcLink(DATA.sim_rates.release_per_plant_year.src) +
      ". Filing stream: <b>" + fmt(f.share * 100, 4) + "%</b> of filings implausible (" + fmt(f.n_implausible) + " / " + fmt(f.n_filings) + "), column <code>implausible_share</code> in " + srcLink(f.src) + ".";
  }

  function renderDocs() {
    var b = DATA.sim_rates.release_per_plant_year.bands, h = "";
    b.forEach(function (x) { h += "<tr><th scope=\"row\">" + E(x.label) + "</th><td data-h=\"Plant-years\">" + fmt(x.plant_years) + "</td><td data-h=\"Releases\">" + fmt(x.events) + "</td><td data-h=\"rate_pct\">" + fmt(x.rate_pct, 4) + "%</td><td data-h=\"wilson_pct\">" + fmt(x.wilson_pct[0], 4) + "% to " + fmt(x.wilson_pct[1], 4) + "%</td><td data-h=\"exact_pct\">" + fmt(x.exact_pct[0], 4) + "% to " + fmt(x.exact_pct[1], 4) + "%</td></tr>"; });
    $("doc-rates").innerHTML = h;
    var m = "", tot = DATA.release_flags.total, w = {};
    DATA.release_flags.source.forEach(function (x) { var t = Sim.SOURCE_MAP[x.label]; m += "<tr><th scope=\"row\">" + E(x.label) + "</th><td data-h=\"Records flagged\">" + fmt(x.n) + " of " + fmt(tot) + "</td><td data-h=\"Schematic unit type\">" + (t || "none") + "</td></tr>"; if (t) w[t] = (w[t] || 0) + x.n; });
    $("doc-src").innerHTML = m;
    var tw = 0; Object.keys(w).forEach(function (k) { tw += w[k]; });
    $("doc-w").innerHTML = Object.keys(w).sort().map(function (k) { return k + " " + fmt(100 * w[k] / tw, 1) + "%"; }).join("; ");
    $("doc-types").innerHTML = DATA.release_flags.type.map(function (x) { return E(x.label) + " " + fmt(100 * x.n / tot, 1) + "% (" + fmt(x.n) + ")"; }).join("; ");
    $("doc-fil").innerHTML = fmt(DATA.sim_rates.filing_implausible.share * 100, 4) + "% (" + fmt(DATA.sim_rates.filing_implausible.n_implausible) + " of " + fmt(DATA.sim_rates.filing_implausible.n_filings) + ")";
    var o = Sim.ONTOLOGY, oh = "";
    o.action_types.forEach(function (a) { oh += "<tr><th scope=\"row\">" + E(a.api_name) + "</th><td data-h=\"Parameters\">" + E(a.parameters.join(", ")) + "</td><td data-h=\"Submission criteria\">" + E(a.criteria.join("; ")) + "</td></tr>"; });
    $("doc-actions").innerHTML = oh;
    var sg = "";
    Object.keys(Sim.SIGNALS).forEach(function (t) { Sim.SIGNALS[t].forEach(function (x) { sg += "<tr><th scope=\"row\">" + t + "</th><td data-h=\"Signal\">" + E(x.label) + " (" + E(x.unit) + ")</td><td data-h=\"Nominal +/- noise\">" + x.nom + " +/- " + x.amp + "</td><td data-h=\"Limits\">" + (x.lo != null ? "low " + x.lo : "") + (x.lo != null && x.hi != null ? ", " : "") + (x.hi != null ? "high " + x.hi : "") + "</td></tr>"; }); });
    $("doc-sig").innerHTML = sg;
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
