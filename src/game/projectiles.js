import { fromAngle } from '../core/math.js';

export const PROJECTILE_TYPES = {
  bolt: {
    speed: 1750, damage: 26, life: 1.1, radius: 3.5, knockback: 120,
    color: '#ffd27a', trail: '#ff8a3d', glow: 12,
  },
  shell: {
    speed: 820, damage: 30, life: 2.6, radius: 7, knockback: 200,
    color: '#ff9a3d', trail: '#ff5a2b', glow: 20,
    explode: { radius: 165, force: 620, damage: 70 },
  },
  slug: {
    speed: 1250, damage: 46, life: 1.6, radius: 5, knockback: 320,
    color: '#ff6b8a', trail: '#ff2d55', glow: 16,
  },
};

/**
 * Projectiles are swept points rather than rigid bodies: they raycast from
 * their previous position to their next one, so nothing tunnels through a thin
 * plate at 1750 units/sec. They still deliver real impulses, so getting shot
 * shoves your chassis around and can tear welds loose.
 */
export class Projectiles {
  constructor(world, bus) {
    this.world = world;
    this.bus = bus;
    this.list = [];
  }

  spawn({ type, x, y, dir, owner, team, part, speedScale = 1, spread = 0 }) {
    const def = PROJECTILE_TYPES[type] || PROJECTILE_TYPES.bolt;
    let dx = dir.x, dy = dir.y;
    if (spread) {
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * spread;
      const d = fromAngle(a);
      dx = d.x; dy = d.y;
    }
    // Inherit the shooter's velocity so firing while boosting feels connected.
    const ov = owner ? owner.pointVel(x, y) : { x: 0, y: 0 };
    const speed = def.speed * speedScale;
    this.list.push({
      type, def, x, y,
      px: x, py: y,
      vx: dx * speed + ov.x * 0.35,
      vy: dy * speed + ov.y * 0.35,
      life: def.life,
      owner, team,
      sourcePart: part,
    });
    this.bus.emit('weapon:fired', { x, y, type, dir: { x: dx, y: dy }, owner });
    return this.list[this.list.length - 1];
  }

  update(dt, onHit) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      // Friendly fire is intentionally allowed against everything except the
      // shooter itself: a Lancer's stray bolt shattering a Bruiser's hull is
      // exactly the kind of accident this game is built to produce.
      const hit = this.world.raycast(p.px, p.py, p.x, p.y, (b) => b !== p.owner && b.tag !== 'pickup');

      if (hit) {
        onHit(p, hit);
        this.list.splice(i, 1);
        continue;
      }
      if (p.life <= 0) {
        onHit(p, null);
        this.list.splice(i, 1);
      }
    }
  }

  clear() { this.list.length = 0; }
}
