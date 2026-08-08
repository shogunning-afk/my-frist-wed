/* ============================================================
   physics-hero.js
   ฉาก Hero ที่ใช้ระบบฟิสิกส์จริง (แรงโน้มถ่วง + การชน + แรงเสียดทาน)
   เพื่อสื่อถึงแก่นของเกม: ทุกอย่างตอบสนองตามฟิสิกส์
   - ลากเมาส์/นิ้ว = ผลักเศษวัตถุ
   - คลิก/แตะ = ระเบิดกระจาย
   ============================================================ */
(function () {
  "use strict";

  var canvas = document.getElementById("physicsCanvas");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  var hero = canvas.closest(".hero") || canvas.parentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- ค่าคงที่ของโลกฟิสิกส์ ---------- */
  var GRAVITY      = 520;    // px / s^2 (เบากว่าโลกจริง ให้เศษวัตถุลอยลงมาแบบอวกาศ)
  var RESTITUTION  = 0.5;    // ความเด้ง
  var FRICTION     = 0.18;   // แรงเสียดทานตอนชน (ทำให้เกิดการหมุน)
  var LINEAR_DAMP  = 0.9975;
  var ANGULAR_DAMP = 0.99;
  var FIXED_DT     = 1 / 120;
  var MAX_STEPS    = 5;
  var REST_LIMIT   = 2.6;    // วินาทีที่หยุดนิ่งก่อนถูกส่งกลับขึ้นไปใหม่

  var PALETTE = [
    { fill: "rgba(255, 122,  61, .16)", line: "rgba(255, 150, 90, .85)" },
    { fill: "rgba(255, 194,  92, .15)", line: "rgba(255, 210, 130, .8)" },
    { fill: "rgba( 70, 224, 208, .13)", line: "rgba(120, 235, 222, .75)" },
    { fill: "rgba(139,  92, 246, .16)", line: "rgba(172, 140, 250, .8)" }
  ];

  var dpr = 1, W = 0, H = 0;
  var bodies = [];
  var stars = [];
  var pointer = { x: -9999, y: -9999, active: false };
  var running = false, rafId = 0, last = 0, acc = 0;

  /* ---------- helpers ---------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

  function makeBody(seeded) {
    var r = rand(9, 26);
    return {
      x: rand(r, Math.max(r + 1, W - r)),
      y: seeded ? rand(-H * 0.9, H * 0.55) : rand(-260, -40),
      vx: rand(-50, 50),
      vy: rand(10, 60),
      r: r,
      m: r * r,
      a: rand(0, Math.PI * 2),
      va: rand(-2.2, 2.2),
      sides: randInt(3, 6),
      color: PALETTE[randInt(0, PALETTE.length - 1)],
      rest: 0
    };
  }

  function respawn(b) {
    b.x = rand(b.r, Math.max(b.r + 1, W - b.r));
    b.y = -rand(60, 320);
    b.vx = rand(-60, 60);
    b.vy = rand(10, 60);
    b.va = rand(-2.2, 2.2);
    b.rest = 0;
  }

  function targetCount() {
    var area = W * H;
    return Math.max(14, Math.min(46, Math.round(area / 26000)));
  }

  function buildStars() {
    stars.length = 0;
    var n = Math.round((W * H) / 14000);
    for (var i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        s: Math.random() < 0.85 ? 1 : 2,
        o: rand(0.12, 0.55)
      });
    }
  }

  /* ---------- resize ---------- */
  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    buildStars();

    var want = targetCount();
    while (bodies.length < want) bodies.push(makeBody(true));
    if (bodies.length > want) bodies.length = want;

    // กันวัตถุหลุดขอบเมื่อจอเล็กลง
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      b.x = Math.max(b.r, Math.min(W - b.r, b.x));
      if (b.y > H + 200) b.y = H - b.r;
    }
  }

  /* ---------- physics ---------- */
  function step(dt) {
    var i, j, b;

    // แรงโน้มถ่วง + แรงจากตัวชี้
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];
      b.vy += GRAVITY * dt;

      if (pointer.active) {
        var dx = b.x - pointer.x;
        var dy = b.y - pointer.y;
        var d2 = dx * dx + dy * dy;
        var R = 140;
        if (d2 < R * R && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var force = (1 - d / R) * 1900;
          b.vx += (dx / d) * force * dt;
          b.vy += (dy / d) * force * dt;
          b.va += (dx / d) * 0.9 * dt;
          b.rest = 0;
        }
      }

      b.vx *= LINEAR_DAMP;
      b.vy *= LINEAR_DAMP;
      b.va *= ANGULAR_DAMP;

      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += b.va * dt;
    }

    // การชนระหว่างวัตถุ (ประมาณด้วยทรงกลม)
    for (i = 0; i < bodies.length; i++) {
      var A = bodies[i];
      for (j = i + 1; j < bodies.length; j++) {
        var B = bodies[j];
        var nx = B.x - A.x;
        var ny = B.y - A.y;
        var minD = A.r + B.r;
        var dist2 = nx * nx + ny * ny;
        if (dist2 >= minD * minD || dist2 === 0) continue;

        var dist = Math.sqrt(dist2);
        nx /= dist; ny /= dist;

        var overlap = minD - dist;
        var invA = 1 / A.m, invB = 1 / B.m, invSum = invA + invB;
        A.x -= nx * overlap * (invA / invSum);
        A.y -= ny * overlap * (invA / invSum);
        B.x += nx * overlap * (invB / invSum);
        B.y += ny * overlap * (invB / invSum);

        var rvx = B.vx - A.vx;
        var rvy = B.vy - A.vy;
        var vn = rvx * nx + rvy * ny;
        if (vn > 0) continue;

        var imp = -(1 + RESTITUTION) * vn / invSum;
        A.vx -= imp * invA * nx;
        A.vy -= imp * invA * ny;
        B.vx += imp * invB * nx;
        B.vy += imp * invB * ny;

        // แรงเสียดทานตามแนวสัมผัส -> ทำให้วัตถุหมุน
        var tx = -ny, ty = nx;
        var vt = rvx * tx + rvy * ty;
        A.va -= vt * FRICTION / A.r * 0.05;
        B.va += vt * FRICTION / B.r * 0.05;

        A.rest = 0; B.rest = 0;
      }
    }

    // ขอบเขตของโลก
    for (i = 0; i < bodies.length; i++) {
      b = bodies[i];

      if (b.x < b.r)      { b.x = b.r;     b.vx = Math.abs(b.vx) * RESTITUTION; b.va += 0.4; }
      else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * RESTITUTION; b.va -= 0.4; }

      var floor = H - 6;
      if (b.y > floor - b.r) {
        b.y = floor - b.r;
        if (b.vy > 0) b.vy = -b.vy * RESTITUTION;
        b.vx *= 0.92;
        b.va = b.va * 0.9 - b.vx * 0.002;
      }

      // นับเวลาที่หยุดนิ่ง แล้วส่งกลับขึ้นไปใหม่เพื่อให้ฉากไม่หยุดนิ่ง
      var speed = Math.abs(b.vx) + Math.abs(b.vy);
      if (speed < 22 && b.y > H * 0.55) {
        b.rest += dt;
        if (b.rest > REST_LIMIT) respawn(b);
      } else {
        b.rest = 0;
      }

      if (b.y > H + 400) respawn(b);
    }
  }

  /* ---------- render ---------- */
  function drawBody(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.beginPath();
    for (var k = 0; k < b.sides; k++) {
      var ang = (k / b.sides) * Math.PI * 2 - Math.PI / 2;
      var px = Math.cos(ang) * b.r;
      var py = Math.sin(ang) * b.r;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();

    ctx.fillStyle = b.color.fill;
    ctx.fill();

    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = b.color.line;
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);

    // ดาวพื้นหลัง
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      ctx.fillStyle = "rgba(255,255,255," + st.o + ")";
      ctx.fillRect(st.x, st.y, st.s, st.s);
    }
    ctx.restore();

    // เส้นพื้น
    var grad = ctx.createLinearGradient(0, H - 60, 0, H);
    grad.addColorStop(0, "rgba(255,122,61,0)");
    grad.addColorStop(1, "rgba(255,122,61,.10)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 60, W, 60);

    for (var i = 0; i < bodies.length; i++) drawBody(bodies[i]);
    ctx.globalCompositeOperation = "source-over";
  }

  /* ---------- loop ---------- */
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    var dt = (now - last) / 1000;
    last = now;
    if (!isFinite(dt) || dt <= 0) return;
    if (dt > 0.25) dt = 0.25;

    acc += dt;
    var steps = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS) {
      step(FIXED_DT);
      acc -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;

    render();
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    last = performance.now();
    acc = 0;
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ---------- input ---------- */
  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  var interacted = false;
  function signalInteract() {
    if (interacted) return;
    interacted = true;
    document.dispatchEvent(new CustomEvent("omni:interact"));
  }

  function onMove(e) {
    var p = pointerPos(e);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.active = true;
    signalInteract();
  }

  function onLeave() { pointer.active = false; pointer.x = pointer.y = -9999; }

  function burst(e) {
    var p = pointerPos(e);
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var dx = b.x - p.x, dy = b.y - p.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var R = 300;
      if (d < R) {
        var f = (1 - d / R) * 620;
        b.vx += (dx / d) * f;
        b.vy += (dy / d) * f - 90;
        b.va += rand(-6, 6);
        b.rest = 0;
      }
    }
    signalInteract();
  }

  if (hero) {
    hero.addEventListener("pointermove", onMove, { passive: true });
    hero.addEventListener("pointerleave", onLeave, { passive: true });
    hero.addEventListener("pointerdown", function (e) {
      onMove(e);
      burst(e);
    }, { passive: true });
  }

  /* ---------- lifecycle ---------- */
  window.addEventListener("resize", function () {
    clearTimeout(resize._t);
    resize._t = setTimeout(resize, 140);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  if ("IntersectionObserver" in window && hero) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.isIntersecting ? start() : stop(); });
    }, { threshold: 0.02 }).observe(hero);
  }

  resize();

  if (reduceMotion) {
    // ไม่เคลื่อนไหว: กระจายวัตถุให้ทั่วฉาก แยกส่วนที่ซ้อนกันออก แล้ววาดเพียงเฟรมเดียว
    bodies.length = Math.max(8, Math.round(bodies.length * 0.55)); // เบาตาลง เพราะไม่มีการเคลื่อนไหวมาช่วยแยกชั้น
    for (var n = 0; n < bodies.length; n++) {
      var sb = bodies[n];
      sb.y = rand(H * 0.08, H * 0.92);
      sb.vx = sb.vy = sb.va = 0;
    }
    var g = GRAVITY;
    GRAVITY = 0;
    for (var k = 0; k < 40; k++) step(FIXED_DT);
    GRAVITY = g;
    render();
  } else {
    start();
  }
})();
