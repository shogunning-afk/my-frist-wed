import { clamp, fromAngle } from '../core/math.js';

const MAX_PARTICLES = 2400;

/**
 * Pooled particle system. Everything is preallocated and recycled -- during a
 * Colossus fight this emits thousands of sparks a second and must never
 * allocate mid-frame.
 */
export class Particles {
  constructor() {
    this.pool = new Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool[i] = {
        active: false, type: 'spark',
        x: 0, y: 0, vx: 0, vy: 0,
        life: 0, maxLife: 1,
        size: 1, angle: 0, spin: 0,
        color: '#fff', drag: 2.4, glow: true,
        verts: null, text: null,
      };
    }
    this.cursor = 0;
    this.liveCount = 0;
  }

  /** Grab a slot; overwrites the oldest when saturated rather than dropping. */
  alloc() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      if (!p.active) { p.active = true; return p; }
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    return p;
  }

  reset(p) {
    p.verts = null; p.text = null; p.glow = true;
    p.drag = 2.4; p.spin = 0; p.angle = 0;
    return p;
  }

  // --- emitters ------------------------------------------------------------

  /** Metal-on-metal sparks, cone-sprayed back along the contact normal. */
  sparks(x, y, normal, count, speed = 600) {
    const base = Math.atan2(-normal.y, -normal.x);
    const n = Math.min(count, 26);
    for (let i = 0; i < n; i++) {
      const p = this.reset(this.alloc());
      const a = base + (Math.random() - 0.5) * 1.7;
      const s = (0.25 + Math.random() * 0.9) * clamp(speed, 180, 1400);
      p.type = 'spark';
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.16 + Math.random() * 0.34;
      p.size = 1.1 + Math.random() * 1.8;
      p.drag = 3.4;
      p.color = Math.random() < 0.25 ? '#fff6d8' : (Math.random() < 0.5 ? '#ffd27a' : '#ff9d45');
    }
  }

  /** Chunks torn off a destroyed part, using that part's own silhouette. */
  debris(part, count) {
    const n = Math.min(count, 14);
    for (let i = 0; i < n; i++) {
      const p = this.reset(this.alloc());
      const a = Math.random() * Math.PI * 2;
      const s = 90 + Math.random() * 320;
      p.type = 'debris';
      p.x = part.wpos.x + (Math.random() - 0.5) * part.radius;
      p.y = part.wpos.y + (Math.random() - 0.5) * part.radius;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.7 + Math.random() * 1.1;
      p.size = 0.16 + Math.random() * 0.34;
      p.angle = Math.random() * Math.PI * 2;
      p.spin = (Math.random() - 0.5) * 12;
      p.drag = 1.5;
      p.glow = false;
      p.color = part.def.color;
      p.verts = part.def.verts;
    }
    // A little heat with the wreckage.
    for (let i = 0; i < Math.ceil(n / 3); i++) {
      const p = this.reset(this.alloc());
      p.type = 'smoke';
      p.x = part.wpos.x; p.y = part.wpos.y;
      const a = Math.random() * Math.PI * 2;
      p.vx = Math.cos(a) * 40; p.vy = Math.sin(a) * 40;
      p.maxLife = p.life = 0.6 + Math.random() * 0.7;
      p.size = 10 + Math.random() * 22;
      p.drag = 1.1;
      p.glow = false;
      p.color = '#2b3040';
    }
  }

  /** Expanding shockwave ring. */
  shockRing(x, y, radius, strength) {
    const p = this.reset(this.alloc());
    p.type = 'ring';
    p.x = x; p.y = y;
    p.vx = p.vy = 0;
    p.maxLife = p.life = 0.16 + strength * 0.3;
    p.size = radius;
    p.color = strength > 0.6 ? '#ffd9a0' : '#9fdcff';
  }

  explosion(x, y, radius) {
    const p = this.reset(this.alloc());
    p.type = 'flash';
    p.x = x; p.y = y;
    p.maxLife = p.life = 0.16;
    p.size = radius * 0.75;
    p.color = '#fff2d0';

    this.shockRing(x, y, radius * 1.25, 1);
    for (let i = 0; i < 26; i++) {
      const q = this.reset(this.alloc());
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 620;
      q.type = 'spark';
      q.x = x; q.y = y;
      q.vx = Math.cos(a) * s; q.vy = Math.sin(a) * s;
      q.maxLife = q.life = 0.3 + Math.random() * 0.5;
      q.size = 1.6 + Math.random() * 2.6;
      q.drag = 2.2;
      q.color = Math.random() < 0.4 ? '#fff3cc' : '#ff8a3d';
    }
    for (let i = 0; i < 14; i++) {
      const q = this.reset(this.alloc());
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * 160;
      q.type = 'smoke';
      q.x = x; q.y = y;
      q.vx = Math.cos(a) * s; q.vy = Math.sin(a) * s;
      q.maxLife = q.life = 0.8 + Math.random() * 0.9;
      q.size = 18 + Math.random() * 40;
      q.drag = 1.0;
      q.glow = false;
      q.color = '#33261f';
    }
  }

  /** Continuous thruster exhaust. Rate-limited by dt so it is framerate-stable. */
  thrusterPlume(part, dir, activation, dt) {
    this.plumeAccum = (this.plumeAccum || 0) + activation * dt * 90;
    if (this.plumeAccum < 1) return;
    const n = Math.min(3, Math.floor(this.plumeAccum));
    this.plumeAccum -= n;
    const back = Math.atan2(-dir.y, -dir.x);
    for (let i = 0; i < n; i++) {
      const p = this.reset(this.alloc());
      const a = back + (Math.random() - 0.5) * 0.55;
      const s = 180 + Math.random() * 320 * activation;
      const off = part.def.extents.x + 3;
      p.type = 'spark';
      p.x = part.wpos.x - dir.x * off;
      p.y = part.wpos.y - dir.y * off;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.maxLife = p.life = 0.1 + Math.random() * 0.2;
      p.size = 1.4 + Math.random() * 2.2 * activation;
      p.drag = 5;
      p.color = Math.random() < 0.5 ? '#c9a8ff' : '#7de8ff';
    }
  }

  /** Ambient dust so the world does not feel like a vacuum. */
  dust(x, y, color = '#66708a') {
    const p = this.reset(this.alloc());
    p.type = 'smoke';
    p.x = x; p.y = y;
    const a = Math.random() * Math.PI * 2;
    p.vx = Math.cos(a) * 12; p.vy = Math.sin(a) * 12;
    p.maxLife = p.life = 1.6 + Math.random() * 2.2;
    p.size = 2 + Math.random() * 5;
    p.drag = 0.4;
    p.glow = false;
    p.color = color;
  }

  /** Floating combat text. */
  text(x, y, str, color = '#fff') {
    const p = this.reset(this.alloc());
    p.type = 'text';
    p.x = x; p.y = y;
    p.vx = (Math.random() - 0.5) * 40;
    p.vy = -80;
    p.maxLife = p.life = 0.75;
    p.size = 14;
    p.drag = 1.6;
    p.color = color;
    p.text = str;
  }

  /** Void fall: a part being pulled down into a chasm. */
  voidWisp(x, y) {
    const p = this.reset(this.alloc());
    p.type = 'spark';
    p.x = x; p.y = y;
    p.vx = (Math.random() - 0.5) * 30;
    p.vy = 60 + Math.random() * 120;
    p.maxLife = p.life = 0.5 + Math.random() * 0.5;
    p.size = 1.5 + Math.random() * 2;
    p.drag = 0.6;
    p.color = '#8f6bff';
  }

  update(dt) {
    let live = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.type === 'smoke') p.size += dt * 18;
      live++;
    }
    this.liveCount = live;
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}
