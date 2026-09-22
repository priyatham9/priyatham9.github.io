/* Shared site kit: mobile menu, contents bar (scrollspy + reading progress),
   count-up numbers. No dependencies; every feature is optional per page. */
(function () {
  "use strict";
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
      if (fill) fill.style.width = (p * 100).toFixed(1) + "%";
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
