import { polyMassData, lenSq } from '../core/math.js';

let nextPartId = 1;
let nextBodyId = 1;

/**
 * A Part is one convex chunk of matter: a plate, a thruster, a rock, a blade.
 * It carries the four properties the design calls for -- mass (via density and
 * area), a center of gravity (its centroid), durability (hp) and energy output
 * (def.energy) -- and it is the unit that both collision and destruction act on.
 */
export class Part {
  constructor(def, localPos = { x: 0, y: 0 }, localAngle = 0) {
    this.id = nextPartId++;
    this.def = def;
    this.pos = { x: localPos.x, y: localPos.y };   // relative to body origin (= center of mass)
    this.angle = localAngle;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.verts = def.verts;                        // convex, CCW, part-local

    // Transform + shape caches, refreshed once per physics step.
    this.wpos = { x: 0, y: 0 };
    this.wangle = 0;
    this.worldVerts = def.verts.map(() => ({ x: 0, y: 0 }));
    this.worldNormals = def.verts.map(() => ({ x: 0, y: 0 }));

    const md = polyMassData(def.verts, def.density);
    this.mass = md.mass;
    this.localInertia = md.inertia;
    this.centroid = md.centroid;
    this.radius = Math.sqrt(Math.max(...def.verts.map(lenSq))) || 1;

    // Per-part runtime state used by actuators and FX.
    this.cooldown = 0;
    this.heat = 0;          // 0..1 visual/impact charge, drives glow and blade damage
    this.activation = 0;    // 0..1 how hard this actuator is currently working
    this.flash = 0;         // damage flash timer
    this.dead = false;
  }

  get destroyed() { return this.hp <= 0; }

  damage(amount) {
    this.hp -= amount;
    this.flash = Math.min(1, this.flash + amount / this.maxHp + 0.15);
    return this.hp <= 0;
  }
}

/**
 * A Body is a rigid assembly of welded Parts. The player, every enemy, every
 * boulder and every piece of debris is one of these -- there is no separate
 * "vehicle" or "creature" class. Welds have their own durability, so a body
 * splits into smaller bodies when the structure holding it together fails.
 */
export class Body {
  constructor(opts = {}) {
    this.id = nextBodyId++;
    this.parts = [];
    this.welds = [];          // {a: partId, b: partId, hp, maxHp}

    this.pos = { x: opts.x || 0, y: opts.y || 0 };
    this.angle = opts.angle || 0;
    this.vel = { x: 0, y: 0 };
    this.angVel = 0;
    this.force = { x: 0, y: 0 };
    this.torque = 0;

    this.isStatic = !!opts.isStatic;
    this.restitution = opts.restitution ?? 0.12;
    this.friction = opts.friction ?? 0.45;
    this.linearDamping = opts.linearDamping ?? 1.6;   // top-down: ground drag
    this.angularDamping = opts.angularDamping ?? 3.2;

    // Gameplay metadata. Kept on the body so any system can reason about any
    // body uniformly -- an AI-thrown boulder and a player chassis are peers.
    this.tag = opts.tag || 'prop';   // 'player' | 'enemy' | 'prop' | 'debris' | 'pickup'
    this.team = opts.team ?? -1;
    this.controller = null;
    this.intent = null;
    this.energy = 0;
    this.energyMax = 0;
    this.hover = false;
    this.dead = false;
    this.invuln = 0;
    this.age = 0;
    this.despawnAfter = opts.despawnAfter ?? Infinity;
    this.structureDirty = false;
    this.needsStructureCheck = false;  // set when a part or weld has failed
    this.originalPartCount = 0;
    this.contactCooldown = new Map();  // partId -> time, throttles blade re-hits

    this.mass = 0; this.invMass = 0;
    this.inertia = 0; this.invInertia = 0;
    this.radius = 0;
    this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.awake = true;
    this.sleepTimer = 0;
  }

  addPart(part) {
    this.parts.push(part);
    this.structureDirty = true;
    return part;
  }

  getPart(id) {
    for (const p of this.parts) if (p.id === id) return p;
    return null;
  }

  weld(aId, bId, hp = 100) {
    if (aId === bId) return null;
    for (const w of this.welds) {
      if ((w.a === aId && w.b === bId) || (w.a === bId && w.b === aId)) return w;
    }
    const w = { a: aId, b: bId, hp, maxHp: hp };
    this.welds.push(w);
    return w;
  }

  /** Welds attached to a part, used to spread structural stress. */
  weldsOf(partId) {
    return this.welds.filter((w) => w.a === partId || w.b === partId);
  }

  /**
   * Recompute mass, center of mass and rotational inertia from the current part
   * list, then re-origin the body on its new center of mass. Called whenever the
   * structure changes: a part welded on, shot off, or torn away.
   */
  recompute() {
    this.structureDirty = false;
    if (this.parts.length === 0) {
      this.mass = this.invMass = this.inertia = this.invInertia = 0;
      this.dead = true;
      return;
    }

    let m = 0, cx = 0, cy = 0;
    for (const p of this.parts) {
      // The part's own centroid, rotated into body space.
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      const gx = p.pos.x + (p.centroid.x * c - p.centroid.y * s);
      const gy = p.pos.y + (p.centroid.x * s + p.centroid.y * c);
      m += p.mass;
      cx += gx * p.mass;
      cy += gy * p.mass;
    }
    cx /= m; cy /= m;

    // Shift every part so the body origin sits exactly on the center of mass,
    // then move the body transform to compensate. This keeps rotation visually
    // correct when a wing gets blown off and the balance point jumps.
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    this.pos.x += cx * ca - cy * sa;
    this.pos.y += cx * sa + cy * ca;
    for (const p of this.parts) { p.pos.x -= cx; p.pos.y -= cy; }

    let I = 0, rad = 0;
    for (const p of this.parts) {
      const c = Math.cos(p.angle), s = Math.sin(p.angle);
      const gx = p.pos.x + (p.centroid.x * c - p.centroid.y * s);
      const gy = p.pos.y + (p.centroid.x * s + p.centroid.y * c);
      I += p.localInertia + p.mass * (gx * gx + gy * gy);
      rad = Math.max(rad, Math.hypot(p.pos.x, p.pos.y) + p.radius);
    }

    this.mass = m;
    this.inertia = Math.max(I, 1e-3);
    this.radius = rad;
    if (this.isStatic) {
      this.invMass = 0; this.invInertia = 0;
    } else {
      this.invMass = 1 / m;
      this.invInertia = 1 / this.inertia;
    }

    // Energy budget: cores and batteries supply, actuators draw. The buffer is
    // deliberately small relative to draw -- a few seconds of everything at
    // once -- so that over-building is felt within one engagement rather than
    // being absorbed silently by an oversized battery.
    let cap = 0;
    for (const p of this.parts) if (p.def.energy > 0) cap += p.def.energy * 4;
    this.energyMax = cap;
    if (this.energy > cap) this.energy = cap;
    if (this.originalPartCount < this.parts.length) this.originalPartCount = this.parts.length;
  }

  updateTransforms() {
    const ca = Math.cos(this.angle), sa = Math.sin(this.angle);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const p of this.parts) {
      p.wpos.x = this.pos.x + p.pos.x * ca - p.pos.y * sa;
      p.wpos.y = this.pos.y + p.pos.x * sa + p.pos.y * ca;
      p.wangle = this.angle + p.angle;
      const c = Math.cos(p.wangle), s = Math.sin(p.wangle);
      const n = p.verts.length;
      for (let i = 0; i < n; i++) {
        const v = p.verts[i], wv = p.worldVerts[i];
        wv.x = p.wpos.x + v.x * c - v.y * s;
        wv.y = p.wpos.y + v.x * s + v.y * c;
        if (wv.x < minX) minX = wv.x;
        if (wv.y < minY) minY = wv.y;
        if (wv.x > maxX) maxX = wv.x;
        if (wv.y > maxY) maxY = wv.y;
      }
      for (let i = 0; i < n; i++) {
        const a = p.worldVerts[i], b = p.worldVerts[(i + 1) % n];
        const ex = b.x - a.x, ey = b.y - a.y;
        const l = Math.hypot(ex, ey) || 1;
        // Outward normal for counter-clockwise winding.
        p.worldNormals[i].x = ey / l;
        p.worldNormals[i].y = -ex / l;
      }
    }
    this.aabb.minX = minX; this.aabb.minY = minY;
    this.aabb.maxX = maxX; this.aabb.maxY = maxY;
  }

  applyImpulse(jx, jy, px, py) {
    if (this.invMass === 0) return;
    this.vel.x += jx * this.invMass;
    this.vel.y += jy * this.invMass;
    if (px !== undefined) {
      const rx = px - this.pos.x, ry = py - this.pos.y;
      this.angVel += (rx * jy - ry * jx) * this.invInertia;
    }
    this.wake();
  }

  applyForce(fx, fy, px, py) {
    this.force.x += fx;
    this.force.y += fy;
    if (px !== undefined) {
      const rx = px - this.pos.x, ry = py - this.pos.y;
      this.torque += rx * fy - ry * fx;
    }
    this.wake();
  }

  /** Velocity of the world-space point p, including rotation. */
  pointVel(px, py) {
    const rx = px - this.pos.x, ry = py - this.pos.y;
    return { x: this.vel.x - this.angVel * ry, y: this.vel.y + this.angVel * rx };
  }

  localToWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x: this.pos.x + lx * c - ly * s, y: this.pos.y + lx * s + ly * c };
  }

  worldToLocal(wx, wy) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    const dx = wx - this.pos.x, dy = wy - this.pos.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  wake() { this.awake = true; this.sleepTimer = 0; }

  /** Count parts of a given kind -- drives AI morale and actuator budgets. */
  countKind(kind) {
    let n = 0;
    for (const p of this.parts) if (p.def.kind === kind) n++;
    return n;
  }

  /** Structural integrity 0..1: how much of the original build survives. */
  get integrity() {
    if (!this.originalPartCount) return 1;
    let hp = 0, max = 0;
    for (const p of this.parts) { hp += Math.max(0, p.hp); max += p.maxHp; }
    const partRatio = this.parts.length / this.originalPartCount;
    const hpRatio = max > 0 ? hp / max : 0;
    return Math.min(1, partRatio * 0.5 + hpRatio * 0.5);
  }

  hasKind(kind) {
    for (const p of this.parts) if (p.def.kind === kind) return true;
    return false;
  }

  /**
   * Partition the parts into weld-connected groups. Anything past the first
   * group has physically come loose and becomes its own body.
   */
  connectedComponents() {
    const adj = new Map();
    for (const p of this.parts) adj.set(p.id, []);
    for (const w of this.welds) {
      if (adj.has(w.a) && adj.has(w.b)) {
        adj.get(w.a).push(w.b);
        adj.get(w.b).push(w.a);
      }
    }
    const seen = new Set();
    const groups = [];
    for (const p of this.parts) {
      if (seen.has(p.id)) continue;
      const group = [];
      const stack = [p.id];
      seen.add(p.id);
      while (stack.length) {
        const id = stack.pop();
        group.push(id);
        for (const n of adj.get(id)) {
          if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      groups.push(group);
    }
    return groups;
  }
}

