import { Body } from './body.js';
import { collideParts, pointInPart, segmentPart, aabbOverlap } from './collision.js';

const SLOP = 0.35;
const BAUMGARTE = 0.22;
const MAX_CORRECTION = 90;

/**
 * The physics world: integration, broadphase, contact solving, and -- the part
 * that makes this game what it is -- structural maintenance. When welds or
 * parts fail, bodies are re-partitioned into their surviving connected pieces
 * mid-step, so a chassis coming apart is the same code path whether it happened
 * to the player, an enemy, or a boulder.
 */
export class PhysicsWorld {
  constructor(bus) {
    this.bus = bus;
    this.bodies = [];
    this.contacts = [];
    this.velocityIterations = 8;
    this.cellSize = 128;
    this.grid = new Map();
    this.activeBounds = null;   // bodies outside this box are not simulated
    this.stats = { bodies: 0, parts: 0, contacts: 0, pairs: 0 };
  }

  add(body) {
    if (body.structureDirty) body.recompute();
    body.updateTransforms();
    this.bodies.push(body);
    this.bus.emit('body:added', body);
    return body;
  }

  remove(body) {
    body.dead = true;
  }

  isActive(body) {
    if (!this.activeBounds) return true;
    if (body.tag === 'player') return true;
    return aabbOverlap(body.aabb, this.activeBounds);
  }

  step(dt) {
    const bodies = this.bodies;

    // --- integrate forces -> velocity -------------------------------------
    for (const b of bodies) {
      b.age += dt;
      if (b.invuln > 0) b.invuln -= dt;
      if (b.isStatic || !this.isActive(b)) { b.force.x = b.force.y = 0; b.torque = 0; continue; }
      b.vel.x += b.force.x * b.invMass * dt;
      b.vel.y += b.force.y * b.invMass * dt;
      b.angVel += b.torque * b.invInertia * dt;
      b.force.x = b.force.y = 0;
      b.torque = 0;

      // Top-down world: "gravity" is downward into the void, handled by the
      // game layer. What we model here is ground drag, which is what gives
      // wheels traction and thrusters a terminal velocity.
      const ld = Math.exp(-b.linearDamping * dt);
      const ad = Math.exp(-b.angularDamping * dt);
      b.vel.x *= ld; b.vel.y *= ld;
      b.angVel *= ad;

      // Hard clamps keep a runaway thruster stack from tunnelling.
      const sp = Math.hypot(b.vel.x, b.vel.y);
      if (sp > 2600) { b.vel.x *= 2600 / sp; b.vel.y *= 2600 / sp; }
      if (b.angVel > 26) b.angVel = 26;
      if (b.angVel < -26) b.angVel = -26;
    }

    // --- broadphase --------------------------------------------------------
    this.buildGrid();
    const pairs = this.findPairs();

    // --- narrowphase -------------------------------------------------------
    this.contacts.length = 0;
    for (const [a, b] of pairs) {
      for (const pa of a.parts) {
        for (const pb of b.parts) {
          const m = collideParts(a, pa, b, pb);
          if (m) {
            m.restitution = Math.max(a.restitution, b.restitution);
            m.friction = Math.sqrt(a.friction * b.friction);
            m.totalImpulse = 0;
            this.contacts.push(m);
          }
        }
      }
    }

    // --- solve -------------------------------------------------------------
    const invDt = dt > 0 ? 1 / dt : 0;
    for (let it = 0; it < this.velocityIterations; it++) {
      const last = it === this.velocityIterations - 1;
      for (const c of this.contacts) this.solveContact(c, invDt, last);
    }

    // --- integrate velocity -> position ------------------------------------
    for (const b of bodies) {
      if (b.isStatic || !this.isActive(b)) continue;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      b.angle += b.angVel * dt;
    }

    // Only bodies that could have moved need their world vertices rebuilt.
    // Static geometry and out-of-range props keep the transforms they were
    // added with, which is what lets a few hundred loaded props cost nothing.
    for (const b of bodies) {
      if (b.structureDirty) {
        b.recompute();
        b.updateTransforms();
      } else if (!b.isStatic && this.isActive(b)) {
        b.updateTransforms();
      }
    }

    // --- report impacts ----------------------------------------------------
    // Emitted after solving so listeners see the true accumulated impulse.
    for (const c of this.contacts) {
      if (c.totalImpulse > 1) {
        let px = 0, py = 0;
        for (const p of c.points) { px += p.x; py += p.y; }
        px /= c.points.length; py /= c.points.length;
        this.bus.emit('impact', {
          bodyA: c.bodyA, partA: c.partA,
          bodyB: c.bodyB, partB: c.partB,
          impulse: c.totalImpulse,
          point: { x: px, y: py },
          normal: c.normal,
        });
      }
    }

    // --- structural maintenance -------------------------------------------
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (!b.dead && b.needsStructureCheck) this.maintainStructure(b);
      if (b.age > b.despawnAfter) b.dead = true;
      if (b.dead || b.parts.length === 0) {
        bodies.splice(i, 1);
        this.bus.emit('body:removed', b);
      }
    }

    this.stats.bodies = bodies.length;
    this.stats.contacts = this.contacts.length;
    this.stats.pairs = pairs.length;
  }

  solveContact(c, invDt, isLast) {
    const A = c.bodyA, B = c.bodyB;
    if (A.invMass === 0 && B.invMass === 0) return;
    const n = c.normal;

    for (const p of c.points) {
      const rax = p.x - A.pos.x, ray = p.y - A.pos.y;
      const rbx = p.x - B.pos.x, rby = p.y - B.pos.y;

      // Relative velocity of the contact point, B measured against A.
      let rvx = (B.vel.x - B.angVel * rby) - (A.vel.x - A.angVel * ray);
      let rvy = (B.vel.y + B.angVel * rbx) - (A.vel.y + A.angVel * rax);
      const vn = rvx * n.x + rvy * n.y;

      const rnA = rax * n.y - ray * n.x;
      const rnB = rbx * n.y - rby * n.x;
      const kn = A.invMass + B.invMass + A.invInertia * rnA * rnA + B.invInertia * rnB * rnB;
      if (kn <= 0) continue;

      // Positional bias pushes overlap out over time instead of instantly,
      // which keeps stacked structures from exploding.
      const bias = BAUMGARTE * invDt * Math.min(MAX_CORRECTION, Math.max(0, p.penetration - SLOP));
      // Only bounce on genuinely fast impacts; slow contacts stay planted.
      const e = vn < -260 ? c.restitution : 0;
      let jn = (-(1 + e) * vn + bias) / kn;

      // Impulse accumulation, clamped so the total stays non-negative.
      const oldN = p.normalImpulse;
      p.normalImpulse = Math.max(0, oldN + jn);
      jn = p.normalImpulse - oldN;

      const jnx = n.x * jn, jny = n.y * jn;
      A.vel.x -= jnx * A.invMass; A.vel.y -= jny * A.invMass;
      A.angVel -= (rax * jny - ray * jnx) * A.invInertia;
      B.vel.x += jnx * B.invMass; B.vel.y += jny * B.invMass;
      B.angVel += (rbx * jny - rby * jnx) * B.invInertia;

      // --- friction along the contact tangent ---
      const tx = -n.y, ty = n.x;
      rvx = (B.vel.x - B.angVel * rby) - (A.vel.x - A.angVel * ray);
      rvy = (B.vel.y + B.angVel * rbx) - (A.vel.y + A.angVel * rax);
      const vt = rvx * tx + rvy * ty;
      const rtA = rax * ty - ray * tx;
      const rtB = rbx * ty - rby * tx;
      const kt = A.invMass + B.invMass + A.invInertia * rtA * rtA + B.invInertia * rtB * rtB;
      if (kt <= 0) continue;

      let jt = -vt / kt;
      const maxFriction = c.friction * p.normalImpulse;
      const oldT = p.tangentImpulse;
      p.tangentImpulse = Math.max(-maxFriction, Math.min(maxFriction, oldT + jt));
      jt = p.tangentImpulse - oldT;

      const jtx = tx * jt, jty = ty * jt;
      A.vel.x -= jtx * A.invMass; A.vel.y -= jty * A.invMass;
      A.angVel -= (rax * jty - ray * jtx) * A.invInertia;
      B.vel.x += jtx * B.invMass; B.vel.y += jty * B.invMass;
      B.angVel += (rbx * jty - rby * jtx) * B.invInertia;

      if (isLast) c.totalImpulse += p.normalImpulse;
    }
    A.wake(); B.wake();
  }

  // --- broadphase ----------------------------------------------------------

  buildGrid() {
    this.grid.clear();
    const cs = this.cellSize;
    for (const b of this.bodies) {
      if (b.dead || !this.isActive(b)) continue;
      const x0 = Math.floor(b.aabb.minX / cs), x1 = Math.floor(b.aabb.maxX / cs);
      const y0 = Math.floor(b.aabb.minY / cs), y1 = Math.floor(b.aabb.maxY / cs);
      // A body spanning a huge area would flood the grid; cap the footprint.
      if ((x1 - x0) * (y1 - y0) > 4096) continue;
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = x * 73856093 ^ y * 19349663;
          let cell = this.grid.get(k);
          if (!cell) this.grid.set(k, (cell = []));
          cell.push(b);
        }
      }
    }
  }

  findPairs() {
    const pairs = [];
    const seen = new Set();
    for (const cell of this.grid.values()) {
      for (let i = 0; i < cell.length; i++) {
        for (let j = i + 1; j < cell.length; j++) {
          const a = cell[i], b = cell[j];
          if (a.isStatic && b.isStatic) continue;
          if (!this.canCollide(a, b)) continue;
          const key = a.id < b.id ? a.id * 1e7 + b.id : b.id * 1e7 + a.id;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!aabbOverlap(a.aabb, b.aabb)) continue;
          pairs.push(a.id < b.id ? [a, b] : [b, a]);
        }
      }
    }
    return pairs;
  }

  canCollide(a, b) {
    if (a.dead || b.dead) return false;
    // Loose debris passing through other loose debris is invisible in practice
    // and costs a lot of pairs during a big structural collapse.
    if (a.tag === 'debris' && b.tag === 'debris') return false;
    if (a.tag === 'pickup' || b.tag === 'pickup') return false;
    return true;
  }

  // --- structural failure --------------------------------------------------

  /**
   * Strip destroyed parts and broken welds, then split the body along whatever
   * connectivity survives. Fragments inherit the correct velocity for their new
   * center of mass, so a torn-off wing keeps the spin it had at the moment it
   * came free.
   */
  maintainStructure(body) {
    body.needsStructureCheck = false;

    const destroyed = body.parts.filter((p) => p.hp <= 0);
    if (destroyed.length) {
      for (const p of destroyed) {
        this.bus.emit('part:destroyed', { body, part: p });
      }
      const gone = new Set(destroyed.map((p) => p.id));
      body.parts = body.parts.filter((p) => !gone.has(p.id));
      body.welds = body.welds.filter((w) => !gone.has(w.a) && !gone.has(w.b));
      body.structureDirty = true;
    }

    const broken = body.welds.filter((w) => w.hp <= 0);
    if (broken.length) {
      body.welds = body.welds.filter((w) => w.hp > 0);
      for (const w of broken) this.bus.emit('weld:broken', { body, weld: w });
    }

    if (body.parts.length === 0) { body.dead = true; return; }
    if (!destroyed.length && !broken.length) return;

    const groups = body.connectedComponents();
    if (groups.length <= 1) {
      body.recompute();
      return;
    }

    // The group holding the body's anchor (its core, or failing that its
    // heaviest chunk) stays the original body; the rest break off.
    const massOf = (ids) => ids.reduce((s, id) => s + (body.getPart(id)?.mass || 0), 0);
    let keepIndex = 0;
    let bestScore = -Infinity;
    groups.forEach((ids, i) => {
      const hasCore = ids.some((id) => body.getPart(id)?.def.kind === 'core');
      const score = massOf(ids) + (hasCore ? 1e6 : 0);
      if (score > bestScore) { bestScore = score; keepIndex = i; }
    });

    const fragments = [];
    groups.forEach((ids, i) => {
      if (i === keepIndex) return;
      const idSet = new Set(ids);
      const parts = body.parts.filter((p) => idSet.has(p.id));
      const welds = body.welds.filter((w) => idSet.has(w.a) && idSet.has(w.b));

      const frag = new Body({
        x: body.pos.x, y: body.pos.y, angle: body.angle,
        restitution: body.restitution, friction: body.friction,
        linearDamping: body.linearDamping, angularDamping: body.angularDamping,
      });
      // A fragment with no core is wreckage; one that kept a core is still a
      // functioning (if crippled) machine and keeps fighting.
      const stillAlive = parts.some((p) => p.def.kind === 'core');
      frag.tag = stillAlive ? body.tag : 'debris';
      frag.team = stillAlive ? body.team : -1;
      frag.despawnAfter = stillAlive ? Infinity : 22;
      frag.parts = parts;
      frag.welds = welds;

      const oldX = body.pos.x, oldY = body.pos.y;
      frag.recompute();
      // v_frag = v_body + ω x r, where r is the offset to the new center of mass.
      const rx = frag.pos.x - oldX, ry = frag.pos.y - oldY;
      frag.vel.x = body.vel.x - body.angVel * ry;
      frag.vel.y = body.vel.y + body.angVel * rx;
      frag.angVel = body.angVel;

      // A shove outward so the split reads as a break, not a dissolve.
      const d = Math.hypot(rx, ry) || 1;
      const kick = 55 + Math.random() * 70;
      frag.vel.x += (rx / d) * kick;
      frag.vel.y += (ry / d) * kick;
      frag.angVel += (Math.random() - 0.5) * 7;
      frag.updateTransforms();
      fragments.push(frag);
    });

    const keep = new Set(groups[keepIndex]);
    body.parts = body.parts.filter((p) => keep.has(p.id));
    body.welds = body.welds.filter((w) => keep.has(w.a) && keep.has(w.b));
    body.recompute();
    body.updateTransforms();

    for (const f of fragments) this.add(f);
    this.bus.emit('body:split', { body, fragments });
  }

  // --- queries -------------------------------------------------------------

  queryAABB(box, filter = null) {
    const out = [];
    for (const b of this.bodies) {
      if (b.dead) continue;
      if (filter && !filter(b)) continue;
      if (aabbOverlap(b.aabb, box)) out.push(b);
    }
    return out;
  }

  queryRadius(x, y, r, filter = null) {
    const box = { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r };
    const rr = r * r;
    return this.queryAABB(box, filter).filter((b) => {
      const dx = b.pos.x - x, dy = b.pos.y - y;
      return dx * dx + dy * dy <= (r + b.radius) * (r + b.radius) || dx * dx + dy * dy <= rr;
    });
  }

  queryPoint(x, y, filter = null) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.dead) continue;
      if (filter && !filter(b)) continue;
      if (x < b.aabb.minX || x > b.aabb.maxX || y < b.aabb.minY || y > b.aabb.maxY) continue;
      for (const p of b.parts) if (pointInPart(p, x, y)) return { body: b, part: p };
    }
    return null;
  }

  /** Nearest part hit along a segment. Returns null when nothing blocks it. */
  raycast(x0, y0, x1, y1, filter = null) {
    let best = null, bestT = 1.0001;
    const box = {
      minX: Math.min(x0, x1), minY: Math.min(y0, y1),
      maxX: Math.max(x0, x1), maxY: Math.max(y0, y1),
    };
    for (const b of this.bodies) {
      if (b.dead) continue;
      if (filter && !filter(b)) continue;
      if (!aabbOverlap(b.aabb, box)) continue;
      for (const p of b.parts) {
        const t = segmentPart(p, x0, y0, x1, y1);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = { t, body: b, part: p, point: { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t } };
        }
      }
    }
    return best;
  }

  /** Radial impulse + damage source. Explosions, shockwaves, boss slams. */
  explode(x, y, radius, force, damage, opts = {}) {
    const affected = this.queryAABB({ minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius });
    for (const b of affected) {
      if (b.isStatic) continue;
      if (opts.exclude && opts.exclude(b)) continue;
      for (const p of b.parts) {
        const dx = p.wpos.x - x, dy = p.wpos.y - y;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;
        const falloff = 1 - d / radius;
        const nx = d > 0.001 ? dx / d : 0, ny = d > 0.001 ? dy / d : 1;
        const j = force * falloff * p.mass * 0.02;
        b.applyImpulse(nx * j, ny * j, p.wpos.x, p.wpos.y);
        if (damage > 0) {
          const dmg = damage * falloff;
          if (p.damage(dmg)) b.needsStructureCheck = true;
          // Blast pressure also fatigues the welds around the part, so a near
          // miss loosens a chassis even when nothing outright breaks.
          for (const w of b.weldsOf(p.id)) {
            w.hp -= dmg * 0.55;
            if (w.hp <= 0) b.needsStructureCheck = true;
          }
        }
      }
    }
    this.bus.emit('explosion', { x, y, radius, force, damage });
  }
}

