import { clamp, angleDiff, fromAngle } from '../core/math.js';

/**
 * An Intent is the entire vocabulary a controller has. The player's keyboard
 * and an enemy's behaviour tree both produce one of these and nothing else,
 * so every machine in the world is actuated by exactly the same code. An AI
 * that loses its thrusters handles badly for the same physical reason a player
 * does -- there is no separate "enemy movement" to keep in sync.
 */
export function makeIntent() {
  return {
    move: { x: 0, y: 0 },   // desired world-space travel direction (length 0..1)
    aim: { x: 0, y: 0 },    // world point to face
    fire: false,
    altFire: false,
    dash: false,
    brake: false,
  };
}

const TORQUE_GAIN = 7.5;
const MAX_TURN_RATE = 9;

/**
 * Drive one body for one step from its intent. Returns a small report used by
 * audio and FX (how hard the engines are working, whether anything fired).
 */
export function actuate(body, dt, ctx) {
  const intent = body.intent;
  const report = { thrust: 0, wheel: 0, fired: 0, brownout: 0 };
  if (!intent || body.parts.length === 0) return report;

  // --- energy budget ------------------------------------------------------
  let supply = 0;
  for (const p of body.parts) if (p.def.energy > 0) supply += p.def.energy;
  // Recharge at exactly the supply rate: cores and batteries are the sustained
  // budget, the stored charge is only a burst reserve on top of it.
  body.energy = Math.min(body.energyMax, body.energy + supply * dt);

  const moveMag = Math.hypot(intent.move.x, intent.move.y);
  const mx = moveMag > 0.001 ? intent.move.x / moveMag : 0;
  const my = moveMag > 0.001 ? intent.move.y / moveMag : 0;
  const throttle = clamp(moveMag, 0, 1);

  // --- rotation target ----------------------------------------------------
  const aimDx = intent.aim.x - body.pos.x;
  const aimDy = intent.aim.y - body.pos.y;
  let angErr = 0;
  if (aimDx * aimDx + aimDy * aimDy > 4) {
    angErr = angleDiff(body.angle, Math.atan2(aimDy, aimDx));
  }
  // PD controller: what angular acceleration would we like right now?
  const desiredAngVel = clamp(angErr * TORQUE_GAIN, -MAX_TURN_RATE, MAX_TURN_RATE);
  const angDemand = clamp((desiredAngVel - body.angVel) * 0.5, -1, 1);

  // --- pass 1: work out what each actuator wants and what it would cost ---
  let demand = 0;
  const plan = [];
  for (const p of body.parts) {
    const kind = p.def.kind;
    if (kind !== 'thruster' && kind !== 'cannon' && kind !== 'floatcore' && kind !== 'wheel') {
      p.activation *= 0.85;
      continue;
    }

    if (kind === 'thruster') {
      const dir = fromAngle(body.angle + p.angle);
      const linear = (dir.x * mx + dir.y * my) * throttle;
      // Torque this thruster would generate, in body units: r x f.
      const c = Math.cos(body.angle), s = Math.sin(body.angle);
      const rx = p.pos.x * c - p.pos.y * s;
      const ry = p.pos.x * s + p.pos.y * c;
      const torqueSign = rx * dir.y - ry * dir.x;
      const rotational = clamp(torqueSign * angDemand * 0.02, -1, 1);
      // A thruster cannot pull, only push -- so activation floors at zero.
      const act = clamp(linear + rotational * 0.9, 0, 1);
      if (act > 0.01) {
        const cost = -p.def.energy * act;
        demand += cost;
        plan.push({ part: p, kind, act, cost, dir });
      } else {
        p.activation *= 0.8;
      }
      continue;
    }

    if (kind === 'wheel') {
      // Wheels need something to push against. Over a chasm they freewheel.
      if (!body.grounded) { p.activation *= 0.8; continue; }
      const dir = fromAngle(body.angle + p.angle);
      const act = clamp((dir.x * mx + dir.y * my) * throttle, -1, 1);
      const cost = -p.def.energy * Math.abs(act);
      demand += cost;
      plan.push({ part: p, kind, act, cost, dir });
      continue;
    }

    if (kind === 'floatcore') {
      const cost = -p.def.energy;
      demand += cost;
      plan.push({ part: p, kind, act: 1, cost, dir: null });
      continue;
    }

    if (kind === 'cannon') {
      p.cooldown -= dt;
      const wantsFire = p.def.projectile === 'shell' ? intent.altFire : intent.fire;
      if (wantsFire && p.cooldown <= 0) {
        // A shot is a lump cost against stored energy, not a continuous draw,
        // so it is deliberately kept out of the rate-based demand total below.
        plan.push({ part: p, kind, act: 1, lump: -p.def.energy, dir: fromAngle(body.angle + p.angle) });
      }
    }
  }

  // --- energy rationing ---------------------------------------------------
  // Over-build your thrusters and the whole machine browns out. This is a
  // deliberate design pressure, not a failure: it forces real build tradeoffs.
  //
  // `body.energy` already had this frame's supply added to it above, so the
  // spendable rate is purely the stored charge over the timestep -- adding
  // `supply` again here would double-count it and let a drained chassis draw
  // twice what its cores actually produce.
  const available = body.energy / Math.max(dt, 1e-4);
  const scale = demand > available ? clamp(available / demand, 0, 1) : 1;
  report.brownout = 1 - scale;
  report.demand = demand;
  report.supply = supply;
  body.energy = Math.max(0, body.energy - demand * scale * dt);

  // --- pass 2: apply ------------------------------------------------------
  let hover = false;
  for (const item of plan) {
    const p = item.part;

    if (item.kind === 'thruster') {
      const act = item.act * scale;
      p.activation = act;
      report.thrust = Math.max(report.thrust, act);
      const f = p.def.force * act;
      body.applyForce(item.dir.x * f, item.dir.y * f, p.wpos.x, p.wpos.y);
      if (act > 0.15 && ctx.particles) {
        ctx.particles.thrusterPlume(p, item.dir, act, dt);
      }
      continue;
    }

    if (item.kind === 'wheel') {
      const act = item.act * scale;
      p.activation = Math.abs(act);
      report.wheel = Math.max(report.wheel, Math.abs(act));
      const f = p.def.force * act;
      body.applyForce(item.dir.x * f, item.dir.y * f, p.wpos.x, p.wpos.y);

      // Lateral grip: resist sideways slide at the contact point. This is what
      // makes wheeled builds corner instead of skating, and what lets a heavy
      // build drift when you overpower the tyres.
      const pv = body.pointVel(p.wpos.x, p.wpos.y);
      const latX = -item.dir.y, latY = item.dir.x;
      const vLat = pv.x * latX + pv.y * latY;
      const grip = p.def.grip * p.mass * 60;
      const fx = -latX * vLat * grip, fy = -latY * vLat * grip;
      body.applyForce(clamp(fx, -18000, 18000), clamp(fy, -18000, 18000), p.wpos.x, p.wpos.y);
      continue;
    }

    if (item.kind === 'floatcore') {
      if (scale > 0.5) { hover = true; p.activation = 1; }
      else p.activation = 0.2;
      continue;
    }

    if (item.kind === 'cannon') {
      // Firing is charged as a lump so a rapid cannon drains a small battery.
      if (body.energy < item.lump * 0.5) { p.cooldown = 0.12; continue; }
      body.energy = Math.max(0, body.energy - item.lump);
      p.cooldown = p.def.fireRate;
      p.heat = 1;
      const muzzleDist = p.def.extents.x + 8;
      const ox = p.wpos.x + item.dir.x * muzzleDist;
      const oy = p.wpos.y + item.dir.y * muzzleDist;
      ctx.spawnProjectile({
        type: p.def.projectile,
        x: ox, y: oy,
        dir: item.dir,
        owner: body,
        team: body.team,
        part: p,
      });
      // Real recoil: applied at the barrel, so a badly braced cannon spins you.
      body.applyImpulse(-item.dir.x * p.def.recoil, -item.dir.y * p.def.recoil, p.wpos.x, p.wpos.y);
      report.fired++;
      continue;
    }
  }

  body.hover = hover;

  // Blades charge up while the trigger is held; a hot blade hits much harder.
  for (const p of body.parts) {
    if (p.def.kind === 'blade') {
      const want = intent.fire ? 1 : 0;
      p.heat += (want - p.heat) * Math.min(1, dt * 6);
    } else if (p.def.kind === 'cannon') {
      p.heat *= Math.exp(-dt * 5);
    }
    if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3.2);
  }

  if (intent.brake) {
    body.vel.x -= body.vel.x * Math.min(1, dt * 5);
    body.vel.y -= body.vel.y * Math.min(1, dt * 5);
    body.angVel -= body.angVel * Math.min(1, dt * 8);
  }

  return report;
}

/** Shared dash: a burst impulse toward a direction, with brief invulnerability. */
export function dash(body, dirX, dirY, power = 1) {
  const l = Math.hypot(dirX, dirY) || 1;
  const j = 520 * body.mass * power;
  body.applyImpulse((dirX / l) * j, (dirY / l) * j);
  body.invuln = Math.max(body.invuln, 0.22);
  return true;
}

