/* ============================================================
   main.js — พฤติกรรมของหน้าเว็บ
   ได้แก่ เมนู, สถานะแถบนำทาง, scroll-spy, การเผยเนื้อหา และแท็บสายการเล่น
   ============================================================ */
(function () {
  "use strict";

  var nav       = document.getElementById("nav");
  var navToggle = document.getElementById("navToggle");
  var navMenu   = document.getElementById("navMenu");
  var links     = navMenu ? Array.prototype.slice.call(navMenu.querySelectorAll("a")) : [];

  /* ---------- แถบนำทาง: สถานะติดขอบบน ---------- */
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("is-stuck", window.scrollY > 12);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- เมนูบนมือถือ ---------- */
  function closeMenu() {
    if (!navMenu || !navToggle) return;
    navMenu.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "เปิดเมนู");
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      var open = navMenu.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "ปิดเมนู" : "เปิดเมนู");
    });

    links.forEach(function (a) { a.addEventListener("click", closeMenu); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    document.addEventListener("click", function (e) {
      if (!navMenu.contains(e.target) && !navToggle.contains(e.target)) closeMenu();
    });
  }

  /* ---------- scroll-spy: ไฮไลต์เมนูตามส่วนที่กำลังดู ---------- */
  var sections = links
    .map(function (a) {
      var id = a.getAttribute("href");
      return id && id.charAt(0) === "#" ? document.querySelector(id) : null;
    })
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          a.classList.toggle("is-current", a.getAttribute("href") === "#" + en.target.id);
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });

    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- เผยเนื้อหาเมื่อเลื่อนถึง ---------- */
  var revealables = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (!("IntersectionObserver" in window)) {
    revealables.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var revealer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        obs.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

    revealables.forEach(function (el) { revealer.observe(el); });
  }

  /* ---------- แท็บสายการเล่น ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".ptab"));

  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var active = t === tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
      t.tabIndex = active ? 0 : -1;

      var panel = document.getElementById(t.getAttribute("aria-controls"));
      if (panel) {
        panel.hidden = !active;
        panel.classList.toggle("is-active", active);
      }
    });
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, idx) {
    tab.addEventListener("click", function () { selectTab(tab, false); });

    tab.addEventListener("keydown", function (e) {
      var next = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = tabs[(idx + 1) % tabs.length];
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = tabs[(idx - 1 + tabs.length) % tabs.length];
      else if (e.key === "Home") next = tabs[0];
      else if (e.key === "End") next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      selectTab(next, true);
    });
  });

  /* ---------- ซ่อนคำใบ้ของ hero หลังผู้ใช้ลองเล่นแล้ว ---------- */
  var hint = document.getElementById("heroHint");
  if (hint) {
    document.addEventListener("omni:interact", function once() {
      hint.classList.add("is-hidden");
      document.removeEventListener("omni:interact", once);
    });
  }
})();
