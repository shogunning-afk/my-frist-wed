import { sequence, selector, condition, action, cooldown, commit, SUCCESS, FAILURE, RUNNING } from './behaviortree.js';
import { makeIntent, dash } from '../game/actuation.js';
import { clamp, fromAngle, angleOf } from '../core/math.js';

const BOLT_SPEED = 1750;

/**
 * Enemy AI. The tree produces nothing but an Intent -- the same struct the
 * player's keyboard produces -- so an enemy that loses a thruster genuinely
 * handles worse, and a Bruiser that shoves a boulder is using the same physics
 * the player would. There is no cheating movement and no scripted damage.
 *
 * States follow the design: Patrol -> Detect -> Charge/Flank -> Special ->
 * Fall back on structural loss.
 */
export class EnemyController {
  constructor(body, spec, ctx) {
    this.body = body;
    this.spec = spec;
    this.ai = spec.ai;
    this.ctx = ctx;             // { game, physics, worldgen, bus, projectiles }
    this.intent = makeIntent();
    body.intent = this.intent;

    this.aware = false;
    this.alertTimer = 0;
    this.patrolTarget = null;
    this.patrolTimer = 0;
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.state = 'patrol';
    this.lastKnown = null;
    this.tree = this.buildTree();
  }

  buildTree() {
    return selector(
      // --- fall back when the chassis is coming apart ---------------------
      sequence(
        condition('crippled', (bb) => bb.self.integrity < bb.ai.fleeIntegrity),
        action('flee', (bb, dt) => this.doFlee(bb, dt)),
      ),

      // --- engaged --------------------------------------------------------
      sequence(
        condition('hasTarget', (bb) => !!bb.target),
        condition('detected', (bb) => this.doDetect(bb)),
        selector(
          // Signature move, on a recharge. Bruisers hurl scenery, the boss
          // opens up with everything it still has bolted on.
          cooldown(this.ai.salvo ? 6.5 : 5.0,
            commit(this.ai.salvo ? 2.2 : 0.9,
              action('special', (bb, dt) => this.doSpecial(bb, dt)))),
          // Too far: close the gap.
          sequence(
            condition('tooFar', (bb) => bb.dist > bb.ai.engageRange),
            action('charge', (bb, dt) => this.doCharge(bb, dt)),
          ),
          // In range: circle and shoot.
          action('flank', (bb, dt) => this.doFlank(bb, dt)),
        ),
      ),

      // --- nothing to do --------------------------------------------------
      action('patrol', (bb, dt) => this.doPatrol(bb, dt)),
    );
  }

  update(dt) {
    const body = this.body;
    const target = this.ctx.game.player && !this.ctx.game.player.dead ? this.ctx.game.player : null;

    const bb = {
      self: body,
      ai: this.ai,
      target,
      dist: target ? Math.hypot(target.pos.x - body.pos.x, target.pos.y - body.pos.y) : Infinity,
      dt,
    };

    // Reset the intent every tick; whatever the tree writes is the whole order.
    this.intent.move.x = 0;
    this.intent.move.y = 0;
    this.intent.fire = false;
    this.intent.altFire = false;
    this.intent.dash = false;
    this.intent.brake = false;
    this.intent.aim.x = body.pos.x + Math.cos(body.angle) * 100;
    this.intent.aim.y = body.pos.y + Math.sin(body.angle) * 100;

    this.tree.tick(bb, dt);
    this.state = bb.activeAction || 'idle';

    // Nothing steers into a chasm on purpose. Any machine without a float core
    // checks the ground ahead and veers off.
    this.avoidVoid(dt);
  }

  // --- perception ---------------------------------------------------------

  doDetect(bb) {
    if (!bb.target) return false;
    if (bb.dist > bb.ai.sightRange) {
      if (this.aware) { this.aware = false; this.lastKnown = null; }
      return false;
    }
    // Line of sight: a boulder or hull between us breaks the lock, which is
    // what makes cover matter.
    const hit = this.ctx.physics.raycast(
      this.body.pos.x, this.body.pos.y, bb.target.pos.x, bb.target.pos.y,
      (b) => b !== this.body && b !== bb.target && b.tag !== 'pickup' && b.tag !== 'debris',
    );
    const visible = !hit;

    if (visible) {
      this.lastKnown = { x: bb.target.pos.x, y: bb.target.pos.y };
      if (!this.aware) {
        this.aware = true;
        this.alertTimer = 0.35;   // brief reaction delay before it commits
        this.ctx.bus.emit('enemy:alert', { body: this.body, spec: this.spec });
      }
    }
    if (this.alertTimer > 0) {
      this.alertTimer -= bb.dt;
      this.faceToward(bb.target.pos.x, bb.target.pos.y);
      return false;
    }
    return this.aware;
  }

  /** Predictive aim: lead the shot by the target's own velocity. */
  aimAt(target, projectileSpeed = BOLT_SPEED) {
    if (!target || target.dead) return;
    const dx = target.pos.x - this.body.pos.x;
    const dy = target.pos.y - this.body.pos.y;
    const d = Math.hypot(dx, dy);
    const t = clamp(d / projectileSpeed, 0, 0.7);
    this.intent.aim.x = target.pos.x + target.vel.x * t;
    this.intent.aim.y = target.pos.y + target.vel.y * t;
  }

  faceToward(x, y) {
    this.intent.aim.x = x;
    this.intent.aim.y = y;
  }

  moveToward(x, y, throttle = 1) {
    const dx = x - this.body.pos.x, dy = y - this.body.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    this.intent.move.x = (dx / d) * throttle;
    this.intent.move.y = (dy / d) * throttle;
  }

  // --- behaviours ---------------------------------------------------------

  doPatrol(bb, dt) {
    this.patrolTimer -= dt;
    if (!this.patrolTarget || this.patrolTimer <= 0) {
      // Wander to somewhere that actually has ground under it.
      for (let tries = 0; tries < 6; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 260 + Math.random() * 520;
        const x = this.body.pos.x + Math.cos(a) * r;
        const y = this.body.pos.y + Math.sin(a) * r;
        if (this.ctx.worldgen.isSolid(x, y) || this.body.hasKind('floatcore')) {
          this.patrolTarget = { x, y };
          break;
        }
      }
      this.patrolTimer = 3 + Math.random() * 3;
    }
    if (this.patrolTarget) {
      const d = Math.hypot(this.patrolTarget.x - this.body.pos.x, this.patrolTarget.y - this.body.pos.y);
      if (d < 70) { this.patrolTarget = null; this.patrolTimer = 0; return SUCCESS; }
      this.moveToward(this.patrolTarget.x, this.patrolTarget.y, 0.45 * this.ai.speed);
      this.faceToward(this.patrolTarget.x, this.patrolTarget.y);
    }
    return RUNNING;
  }

  doCharge(bb, dt) {
    const t = bb.target;
    if (!t) return FAILURE;
    this.aimAt(t);
    // Aim slightly off-axis so a pack does not collapse into a single line.
    const ang = angleOf({ x: t.pos.x - this.body.pos.x, y: t.pos.y - this.body.pos.y });
    const off = this.ai.flankBias * this.strafeDir * 0.5;
    const dir = fromAngle(ang + off);
    this.intent.move.x = dir.x * this.ai.speed;
    this.intent.move.y = dir.y * this.ai.speed;

    // Ranged units keep firing while they close.
    if (bb.dist < this.ai.sightRange * 0.8 && this.body.hasKind('cannon')) {
      this.intent.fire = Math.sin(this.ctx.game.time * 7 + this.body.id) > -0.2;
    }
    // Melee builds commit with a burst once they are nearly on top of you.
    if (bb.dist < 240 && this.body.hasKind('blade') && Math.random() < dt * 1.4) {
      dash(this.body, t.pos.x - this.body.pos.x, t.pos.y - this.body.pos.y, 0.7);
      this.ctx.bus.emit('sfx:dash', { x: this.body.pos.x, y: this.body.pos.y });
    }
    return bb.dist <= this.ai.engageRange ? SUCCESS : RUNNING;
  }

  doFlank(bb, dt) {
    const t = bb.target;
    if (!t) return FAILURE;
    this.aimAt(t);
    this.intent.fire = true;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeDir *= -1;
      this.strafeTimer = 1.4 + Math.random() * 1.8;
    }

    // Hold the preferred range: push in when too far, back off when too close,
    // and orbit the rest of the time.
    const dx = t.pos.x - this.body.pos.x, dy = t.pos.y - this.body.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const radial = clamp((d - this.ai.preferredRange) / 160, -1, 1);
    const tx = -ny * this.strafeDir, ty = nx * this.strafeDir;
    const orbit = 1 - Math.abs(radial) * 0.6;

    this.intent.move.x = (nx * radial + tx * orbit) * this.ai.speed;
    this.intent.move.y = (ny * radial + ty * orbit) * this.ai.speed;

    // Blades want contact; keep pressing rather than orbiting at a distance.
    if (this.body.hasKind('blade') && d > 90) {
      this.intent.move.x = nx * this.ai.speed;
      this.intent.move.y = ny * this.ai.speed;
    }
    return RUNNING;
  }

  /**
   * Special attacks are physics, not animation. A Bruiser finds a real boulder
   * lying nearby and throws it -- if it misses you it may well flatten one of
   * its own allies, or knock a chunk out of a cliff.
   */
  doSpecial(bb, dt) {
    const t = bb.target;
    if (!t) return FAILURE;
    this.aimAt(t);

    if (this.ai.salvo) {
      // Boss: dump everything downrange while advancing.
      this.intent.fire = true;
      this.intent.altFire = Math.sin(this.ctx.game.time * 3) > 0.4;
      this.moveToward(t.pos.x, t.pos.y, 0.6 * this.ai.speed);
      return RUNNING;
    }

    if (this.ai.throwsBoulders) {
      if (!this.throwState) {
        const rock = this.findBoulder();
        if (!rock) return FAILURE;
        this.throwState = { rock, wind: 0.45 };
        this.ctx.bus.emit('sfx:charge', { x: this.body.pos.x, y: this.body.pos.y });
      }
      const st = this.throwState;
      st.wind -= dt;
      this.intent.brake = true;

      if (st.rock.dead || st.rock.parts.length === 0) { this.throwState = null; return FAILURE; }

      // Wind-up: drag the rock in close so the throw reads before it lands.
      const dx = this.body.pos.x - st.rock.pos.x, dy = this.body.pos.y - st.rock.pos.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = st.rock.mass * 260;
      st.rock.applyForce((dx / d) * pull, (dy / d) * pull);
      st.rock.touched = true;

      if (st.wind <= 0) {
        const ax = this.intent.aim.x - st.rock.pos.x;
        const ay = this.intent.aim.y - st.rock.pos.y;
        const ad = Math.hypot(ax, ay) || 1;
        const power = st.rock.mass * 1250;
        st.rock.applyImpulse((ax / ad) * power, (ay / ad) * power);
        st.rock.angVel += (Math.random() - 0.5) * 12;
        st.rock.thrownBy = this.body;
        this.ctx.bus.emit('sfx:throw', { x: this.body.pos.x, y: this.body.pos.y });
        this.throwState = null;
        return SUCCESS;
      }
      return RUNNING;
    }

    // Default special: a hard closing dash with the trigger down.
    this.intent.fire = true;
    this.moveToward(t.pos.x, t.pos.y, this.ai.speed);
    if (!this.dashed) {
      dash(this.body, t.pos.x - this.body.pos.x, t.pos.y - this.body.pos.y, 0.9);
      this.dashed = true;
      this.ctx.bus.emit('sfx:dash', { x: this.body.pos.x, y: this.body.pos.y });
      return SUCCESS;
    }
    this.dashed = false;
    return SUCCESS;
  }

  doFlee(bb, dt) {
    const t = bb.target;
    if (!t) return FAILURE;
    const dx = this.body.pos.x - t.pos.x, dy = this.body.pos.y - t.pos.y;
    const d = Math.hypot(dx, dy) || 1;
    this.intent.move.x = (dx / d) * this.ai.speed;
    this.intent.move.y = (dy / d) * this.ai.speed;
    // Still dangerous while retreating -- it fires over its shoulder.
    this.aimAt(t);
    this.intent.fire = Math.sin(this.ctx.game.time * 4 + this.body.id) > 0.5;
    return d > this.ai.sightRange * 1.2 ? SUCCESS : RUNNING;
  }

  // --- helpers ------------------------------------------------------------

  findBoulder() {
    const near = this.ctx.physics.queryRadius(this.body.pos.x, this.body.pos.y, 420,
      (b) => b.tag === 'prop' && !b.isStatic && b.parts.length === 1 && b.parts[0].def.kind === 'rock');
    let best = null, bestD = Infinity;
    for (const b of near) {
      const d = Math.hypot(b.pos.x - this.body.pos.x, b.pos.y - this.body.pos.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  avoidVoid(dt) {
    if (this.body.hasKind('floatcore')) return;
    const look = 130;
    const mx = this.intent.move.x, my = this.intent.move.y;
    const m = Math.hypot(mx, my);
    if (m < 0.05) return;
    const ax = this.body.pos.x + (mx / m) * look;
    const ay = this.body.pos.y + (my / m) * look;
    if (this.ctx.worldgen.isSolid(ax, ay)) return;

    // Sample left and right until something solid turns up.
    for (const sweep of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const a = Math.atan2(my, mx) + sweep;
      const sx = this.body.pos.x + Math.cos(a) * look;
      const sy = this.body.pos.y + Math.sin(a) * look;
      if (this.ctx.worldgen.isSolid(sx, sy)) {
        this.intent.move.x = Math.cos(a) * m;
        this.intent.move.y = Math.sin(a) * m;
        return;
      }
    }
    this.intent.move.x = 0;
    this.intent.move.y = 0;
    this.intent.brake = true;
  }
}
