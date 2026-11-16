/* Shared site kit: mobile menu, contents bar (scrollspy + reading progress),
   count-up numbers. No dependencies; every feature is optional per page. */
(function () {
  "use strict";
  var reduced = (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
    /[?&]reduced=1\b/.test(location.search);
  var docEl = document.documentElement;
  docEl.classList.add(reduced ? "motion-reduced" : "motion-ok");
  var header = document.querySelector("header.topbar");

  /* ---- mobile menu ---- */
  var btn = document.querySelector(".menu-btn");
  var nav = btn && document.getElementById(btn.getAttribute("aria-controls"));
  if (btn && nav) {
    var setOpen = function (open) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      nav.classList.toggle("open", open);
    };
    btn.addEventListener("click", function () { setOpen(btn.getAttribute("aria-expanded") !== "true"); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { setOpen(false); btn.focus(); }
    });
    document.addEventListener("click", function (e) {
      if (btn.getAttribute("aria-expanded") === "true" && !nav.contains(e.target) && !btn.contains(e.target)) setOpen(false);
    });
    window.matchMedia("(min-width: 901px)").addEventListener("change", function (m) { if (m.matches) setOpen(false); });
  }

  /* ---- keep anchor targets clear of the sticky header ---- */
  function syncOffset() {
    if (header) document.documentElement.style.setProperty("--sticky-h", (header.offsetHeight + 14) + "px");
  }
  syncOffset();
  window.addEventListener("resize", syncOffset);

  /* ---- contents bar: highlight current section, show reading progress ---- */
  var bar = document.querySelector(".storybar");
  if (bar) {
    var links = Array.prototype.slice.call(bar.querySelectorAll(".sb-list a[href^='#']"));
    var list = bar.querySelector(".sb-list");
    var fill = bar.querySelector(".sb-progress");
    var pct = bar.querySelector(".sb-pct");
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute("href").slice(1)); });
    var current = -1, ticking = false;
    var update = function () {
      ticking = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (fill) fill.style.transform = "scaleX(" + p.toFixed(4) + ")";
      if (pct) pct.textContent = Math.round(p * 100) + "%";
      var line = (header ? header.offsetHeight : 0) + 60, idx = -1;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].getBoundingClientRect().top <= line) idx = i;
      }
      if (p > 0.995 && targets.length) idx = targets.length - 1;
      if (idx !== current) {
        current = idx;
        links.forEach(function (a, j) {
          if (j === idx) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
        });
        var a = links[idx];
        if (a && list && list.scrollWidth > list.clientWidth) {
          var left = a.offsetLeft - list.offsetLeft - 24;
          if (list.scrollTo) list.scrollTo({ left: left, behavior: reduced ? "auto" : "smooth" }); else list.scrollLeft = left;
        }
      }
    };
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---- scroll-revealed beats: sections fade and rise in once as they enter ---- */
  var beats = document.querySelectorAll("[data-beat]");
  /* arriving at #id: that section and everything above it shows in its final state */
  var hashEl = null;
  try { hashEl = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null; } catch (e) {}
  /* late layout (web fonts, count-ups) can move the target after the browser's jump: settle it once more */
  if (hashEl) {
    var userMoved = false;
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (t) { window.addEventListener(t, function () { userMoved = true; }, { once: true, passive: true }); });
    var settle = function () { if (!userMoved) hashEl.scrollIntoView({ block: "start", behavior: "auto" }); };
    window.addEventListener("load", function () { setTimeout(settle, 60); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(settle, 30); });
  }
  var hashAbove = function (el) {
    return !!hashEl && (el === hashEl || el.contains(hashEl) || !!(el.compareDocumentPosition(hashEl) & Node.DOCUMENT_POSITION_FOLLOWING));
  };
  if (beats.length && !reduced && "IntersectionObserver" in window) {
    docEl.classList.add("beats-on");
    var bio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("beat-in"); bio.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(beats, function (el) {
      /* anything already above the fold shows at once */
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9 || hashAbove(el)) el.classList.add("beat-in");
      else bio.observe(el);
    });
  }

  /* ---- depth: cards tilt toward the pointer and catch an accent light ---- */
  var fine = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!reduced && fine) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tilt]"), function (card) {
      var raf = 0, px = 0, py = 0;
      var apply = function () {
        raf = 0;
        var r = card.getBoundingClientRect();
        var x = (px - r.left) / r.width, y = (py - r.top) / r.height;
        card.style.setProperty("--tilt-x", ((0.5 - y) * 5).toFixed(2) + "deg");
        card.style.setProperty("--tilt-y", ((x - 0.5) * 6).toFixed(2) + "deg");
        card.style.setProperty("--glow-x", (x * 100).toFixed(1) + "%");
        card.style.setProperty("--glow-y", (y * 100).toFixed(1) + "%");
      };
      card.classList.add("tilt");
      card.addEventListener("pointermove", function (e) {
        px = e.clientX; py = e.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      card.addEventListener("pointerleave", function () {
        card.style.setProperty("--tilt-x", "0deg"); card.style.setProperty("--tilt-y", "0deg");
      });
    });
  }


  /* ---- shareable headings: every section heading gets a copy-link button ---- */
  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div"); toastEl.className = "kit-toast";
      toastEl.setAttribute("role", "status"); toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  window.kitToast = toast;
  function copyText(txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", "");
      ta.style.position = "absolute"; ta.style.left = "-9999px"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? res() : rej(); } catch (e) { rej(e); } document.body.removeChild(ta);
    });
  }
  var LINK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  Array.prototype.forEach.call(document.querySelectorAll("main section[id], main [data-anchor][id]"), function (sec) {
    if (sec.id === "main" || sec.hasAttribute("data-noanchor")) return;
    var h = sec.querySelector("h2");
    if (!h || h.closest("section[id]") !== sec || h.querySelector(".h-anchor")) return;
    var name = (h.getAttribute("aria-label") || h.textContent || "").replace(/\s+/g, " ").trim();
    var b = document.createElement("button");
    b.type = "button"; b.className = "h-anchor"; b.innerHTML = LINK_SVG;
    b.setAttribute("aria-label", "Copy link to section: " + name);
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var url = location.origin + location.pathname + location.search + "#" + sec.id;
      try { history.replaceState(null, "", "#" + sec.id); } catch (err) {}
      copyText(url).then(function () { toast("Link copied"); }, function () { toast("Link: " + url); });
      b.classList.add("copied"); setTimeout(function () { b.classList.remove("copied"); }, 1600);
    });
    h.appendChild(b);
  });

  /* ---- count-up: markup holds the final value; animate only with motion allowed ---- */
  var nums = document.querySelectorAll("[data-countup]");
  if (nums.length && !reduced && "IntersectionObserver" in window) {
    var run = function (el) {
      var raw = el.getAttribute("data-countup");
      var target = parseFloat(raw);
      var dec = (raw.split(".")[1] || "").length;
      var pre = el.getAttribute("data-prefix") || "", suf = el.getAttribute("data-suffix") || "";
      var start = performance.now(), dur = 1000;
      var step = function (now) {
        var t = Math.min((now - start) / dur, 1), e = 1 - Math.pow(1 - t, 3);
        el.textContent = pre + (target * e).toFixed(dec) + suf;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); run(en.target); } });
    }, { threshold: 0.6 });
    Array.prototype.forEach.call(nums, function (el) { io.observe(el); });
  }
})();
