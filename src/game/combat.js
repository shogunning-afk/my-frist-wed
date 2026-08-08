import { clamp } from '../core/math.js';

// Damage thresholds tuned against the mass scale in parts.js. A bare ram at
// walking pace does nothing; a loaded chassis at full boost caves in a plate.
const IMPACT_THRESHOLD = 620;
const IMPACT_SCALE = 0.012;
const WELD_FATIGUE = 0.5;

/**
 * Combat is deliberately thin. It does not know what a "player attack" is --
 * it knows that two parts collided hard, or that a projectile landed, and it
 * turns that into durability loss, weld fatigue, knockback and juice. Because
 * it is driven purely by physics events, an enemy crushed between a boulder and
 * a cliff dies through the exact same path as one you shot.
 */
export class Combat {
  constructor(ctx) {
    this.world = ctx.world;
    this.bus = ctx.bus;
    this.fx = ctx.fx;
    this.juice = ctx.juice;
    this.game = ctx.game;

    this.bus.on('impact', (ev) => this.onImpact(ev));
    this.bus.on('part:destroyed', (ev) => this.onPartDestroyed(ev));
  }

  /**
   * Core damage entry point. Everything -- bullets, blades, falls, explosions,
   * a dropped boulder -- funnels through here.
   */
  applyDamage(body, part, amount, opts = {}) {
    if (!body || !part || amount <= 0 || body.dead) return 0;
    if (body.invuln > 0 && opts.type !== 'void') return 0;
    if (part.hp <= 0) return 0;

    const dealt = Math.min(amount, part.hp);
    if (part.damage(amount)) body.needsStructureCheck = true;

    // Structural destruction: damage does not stay local. It fatigues every
    // weld holding the struck part, so sustained fire on one corner eventually
    // shears that corner off even if the part itself survives.
    for (const w of body.weldsOf(part.id)) {
      w.hp -= amount * WELD_FATIGUE;
      if (w.hp <= 0) body.needsStructureCheck = true;
    }

    body.wake();
    this.bus.emit('damage', {
      body, part, amount: dealt,
      point: opts.point || part.wpos,
      dir: opts.dir || { x: 0, y: -1 },
      type: opts.type || 'generic',
      source: opts.source || null,
    });
    return dealt;
  }

  /** Physics contact -> collision damage, blade strikes, sparks, hitstop. */
  onImpact(ev) {
    const { bodyA, partA, bodyB, partB, impulse, point, normal } = ev;
    if (impulse < IMPACT_THRESHOLD * 0.35) return;

    const va = bodyA.pointVel(point.x, point.y);
    const vb = bodyB.pointVel(point.x, point.y);
    const relSpeed = Math.hypot(vb.x - va.x, vb.y - va.y);

    const base = Math.max(0, (impulse - IMPACT_THRESHOLD) * IMPACT_SCALE);
    let dmgToA = base, dmgToB = base;

    // Blades convert their own momentum into concentrated damage. A blade that
    // is merely resting against you does almost nothing; one swung at speed on
    // a charged trigger is lethal.
    const bladeA = partA.def.kind === 'blade';
    const bladeB = partB.def.kind === 'blade';
    if (bladeA) {
      dmgToB += partA.def.damage * (0.35 + partA.heat) * (0.4 + relSpeed / 520);
      dmgToA *= 0.25;
    }
    if (bladeB) {
      dmgToA += partB.def.damage * (0.35 + partB.heat) * (0.4 + relSpeed / 520);
      dmgToB *= 0.25;
    }

    // Rate-limit repeat hits between the same pair so a blade resting on a hull
    // does not tick every frame.
    const key = partB.id;
    const now = this.game.time;
    const lastA = bodyA.contactCooldown.get(key) || -1;
    if (now - lastA < 0.11 && (bladeA || bladeB)) return;
    bodyA.contactCooldown.set(key, now);

    const dealtB = this.applyDamage(bodyB, partB, dmgToB, {
      point, dir: normal, type: 'impact', source: bodyA,
    });
    const dealtA = this.applyDamage(bodyA, partA, dmgToA, {
      point, dir: { x: -normal.x, y: -normal.y }, type: 'impact', source: bodyB,
    });

    // Extra knockback beyond the solver's own response, so a charged blade
    // visibly throws things rather than nudging them.
    if (bladeA || bladeB) {
      const blade = bladeA ? partA : partB;
      const victim = bladeA ? bodyB : bodyA;
      const s = bladeA ? 1 : -1;
      const j = blade.def.damage * (0.6 + blade.heat) * 26;
      victim.applyImpulse(normal.x * j * s, normal.y * j * s, point.x, point.y);
    }

    const total = dealtA + dealtB;
    this.reactToHit(point, normal, total, impulse, relSpeed, bodyA, bodyB);
  }

  /** All the "juice" for a hit lives in one place so every damage source gets it. */
  reactToHit(point, normal, damage, impulse, relSpeed, bodyA, bodyB) {
    const involvesPlayer = bodyA?.tag === 'player' || bodyB?.tag === 'player';
    const mag = clamp(impulse / 9000, 0, 1);

    if (damage > 0.5) {
      this.fx.sparks(point.x, point.y, normal, clamp(damage / 6, 2, 16), relSpeed);
    }
    if (mag > 0.06) {
      this.fx.shockRing(point.x, point.y, 12 + mag * 46, mag);
    }

    // Hitstop: freeze the world for a few milliseconds so heavy hits land with
    // weight. Scaled by damage and capped so it never feels like a stutter.
    if (damage > 6) {
      const stop = clamp(damage / 340, 0, 1) * 0.085;
      this.juice.hitstop(involvesPlayer ? stop * 1.35 : stop * 0.6);
    }

    if (damage > 2 || mag > 0.15) {
      this.juice.shakeAt(point.x, point.y, clamp(damage / 90 + mag * 0.35, 0, 0.85), normal);
    }

    this.bus.emit('sfx:impact', {
      x: point.x, y: point.y,
      power: clamp(impulse / 8000, 0.05, 1),
      damage,
      metallic: true,
    });
  }

  /** A destroyed part sheds salvage, and some parts go off when they die. */
  onPartDestroyed({ body, part }) {
    const def = part.def;
    this.fx.debris(part, 6 + Math.floor(def.hp / 40));
    this.fx.shockRing(part.wpos.x, part.wpos.y, def.reach * 2.4, 0.5);
    this.juice.shakeAt(part.wpos.x, part.wpos.y, 0.3, { x: 0, y: -1 });

    if (def.explodeOnDeath) {
      const e = def.explodeOnDeath;
      this.world.explode(part.wpos.x, part.wpos.y, e.radius, e.force, e.damage);
      this.fx.explosion(part.wpos.x, part.wpos.y, e.radius);
      this.juice.hitstop(0.06);
      this.juice.shakeAt(part.wpos.x, part.wpos.y, 0.8, { x: 0, y: -1 });
      this.bus.emit('sfx:explosion', { x: part.wpos.x, y: part.wpos.y, power: 1 });
    } else {
      this.bus.emit('sfx:break', { x: part.wpos.x, y: part.wpos.y, power: clamp(def.hp / 300, 0.2, 1) });
    }

    // Salvage: world material and enemy hardware alike drop usable modules.
    const drops = [];
    if (def.salvage) {
      const n = 1 + (Math.random() < 0.45 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        drops.push(def.salvage[Math.floor(Math.random() * def.salvage.length)]);
      }
    } else if (body.tag === 'enemy' && Math.random() < 0.55) {
      // Enemies drop the very module you just blew off them.
      drops.push(def.id);
    }
    for (const d of drops) {
      this.bus.emit('salvage:drop', {
        partId: d,
        x: part.wpos.x + (Math.random() - 0.5) * 24,
        y: part.wpos.y + (Math.random() - 0.5) * 24,
      });
    }
  }

  /** Projectile resolution, called by the game loop. */
  onProjectileHit(proj, hit) {
    if (!hit) {
      // Expired mid-air: shells still detonate.
      if (proj.def.explode) this.detonate(proj, proj.x, proj.y);
      return;
    }
    const { body, part, point } = hit;
    const dir = { x: proj.vx, y: proj.vy };
    const l = Math.hypot(dir.x, dir.y) || 1;
    dir.x /= l; dir.y /= l;

    if (proj.def.explode) {
      this.detonate(proj, point.x, point.y);
      return;
    }

    const dealt = this.applyDamage(body, part, proj.def.damage, {
      point, dir, type: 'projectile', source: proj.owner,
    });
    body.applyImpulse(dir.x * proj.def.knockback * 6, dir.y * proj.def.knockback * 6, point.x, point.y);

    this.fx.sparks(point.x, point.y, { x: -dir.x, y: -dir.y }, 7, 700);
    this.fx.shockRing(point.x, point.y, 16, 0.3);
    if (dealt > 0) this.juice.hitstop(0.018);
    this.juice.shakeAt(point.x, point.y, 0.12, dir);
    this.bus.emit('sfx:impact', { x: point.x, y: point.y, power: 0.35, damage: dealt, metallic: true });
  }

  detonate(proj, x, y) {
    const e = proj.def.explode;
    this.world.explode(x, y, e.radius, e.force, e.damage, {
      exclude: (b) => b === proj.owner && b.invuln > 0,
    });
    this.fx.explosion(x, y, e.radius);
    this.juice.hitstop(0.07);
    this.juice.shakeAt(x, y, 0.9, { x: 0, y: -1 });
    this.bus.emit('sfx:explosion', { x, y, power: 1 });
  }
}
