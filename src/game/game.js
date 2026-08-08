import { Bus } from '../core/events.js';
import { Input } from '../core/input.js';
import { Camera } from '../core/camera.js';
import { clamp, TAU } from '../core/math.js';
import { PhysicsWorld } from '../physics/world.js';
import { WorldGen } from '../world/worldgen.js';
import { Particles } from '../fx/particles.js';
import { Juice } from '../fx/juice.js';
import { Renderer } from '../render/renderer.js';
import { HUD } from '../ui/hud.js';
import { AudioEngine } from '../audio/audio.js';
import { Combat } from './combat.js';
import { Projectiles } from './projectiles.js';
import { PARTS, BUILDABLE, partDef } from './parts.js';
import { PLAYER_CHASSIS, ENEMIES } from './blueprints.js';
import { buildFromBlueprint, findSnap, attachPart, detachPart } from './assembly.js';
import { makeIntent, actuate, dash } from './actuation.js';
import { EnemyController } from '../ai/enemy.js';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;
const MAX_ENEMIES = 24;
const DESPAWN_RANGE = 3400;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d', { alpha: false });

    this.bus = new Bus();
    this.input = new Input(canvas);
    this.camera = new Camera();
    this.juice = new Juice(this.camera);
    this.fx = new Particles();
    this.physics = new PhysicsWorld(this.bus);
    this.audio = new AudioEngine(this.bus);

    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.worldgen = new WorldGen(this.seed, this.physics, this.bus);
    this.projectiles = new Projectiles(this.physics, this.bus);
    this.combat = new Combat({
      world: this.physics, bus: this.bus, fx: this.fx, juice: this.juice, game: this,
    });

    this.hud = new HUD(this);
    this.renderer = new Renderer(canvas, this.ctx2d, {
      camera: this.camera, worldgen: this.worldgen, physics: this.physics,
      fx: this.fx, juice: this.juice, game: this,
    });

    // --- run state ---
    this.time = 0;
    this.accumulator = 0;
    this.lastFrame = 0;
    this.started = false;
    this.paused = false;

    this.player = null;
    this.playerIntent = makeIntent();
    this.enemies = [];
    this.pickups = [];
    this.inventory = {};
    this.selectedIndex = 0;
    this.buildMode = false;
    this.buildPreview = null;
    this.buildTargetBody = null;
    this.hoverPart = null;
    this.buildAngle = 0;
    this.aimWorld = { x: 0, y: 0 };
    this.dashCooldown = 0;
    this.brownout = 0;
    this.thrustLoad = 0;
    this.combatIntensity = 0;
    this.biomeLabel = '';
    this.kills = 0;
    this.salvaged = 0;
    this.distanceTravelled = 0;
    this.lastPos = { x: 0, y: 0 };

    this.bindEvents();
    this.reset();
  }

  bindEvents() {
    this.bus.on('chunk:loaded', (chunk) => this.onChunkLoaded(chunk));
    this.bus.on('salvage:drop', (d) => this.dropPickup(d.partId, d.x, d.y));
    this.bus.on('damage', (d) => this.onDamage(d));
  }

  // --- lifecycle ----------------------------------------------------------

  reset(seed = null) {
    this.seed = seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.physics.bodies.length = 0;
    this.projectiles.clear();
    this.fx.clear();
    this.juice.reset();
    this.enemies.length = 0;
    this.pickups.length = 0;
    this.worldgen = new WorldGen(this.seed, this.physics, this.bus);
    this.renderer.worldgen = this.worldgen;

    this.inventory = {};
    for (const id of BUILDABLE) this.inventory[id] = 0;
    // A starting kit: enough to make one meaningful decision immediately.
    Object.assign(this.inventory, {
      plate: 4, strut: 3, thruster: 2, wheel: 2, blade: 1, cannon: 1, battery: 1, floatcore: 1,
    });

    this.time = 0;
    this.kills = 0;
    this.salvaged = 0;
    this.distanceTravelled = 0;
    this.buildMode = false;
    this.selectedIndex = 0;
    this.buildAngle = 0;
    this.combatIntensity = 0;

    this.spawnPlayer();
    this.worldgen.update(0, 0);
    this.camera.x = 0;
    this.camera.y = 0;
    this.camera.zoom = 1;
    this.juice.baseZoom = 1;
  }

  spawnPlayer() {
    const body = buildFromBlueprint(PLAYER_CHASSIS, {
      x: 0, y: 0, angle: 0, tag: 'player', team: 0,
      linearDamping: 1.5, angularDamping: 3.6, friction: 0.5, restitution: 0.1,
    });
    body.intent = this.playerIntent;
    body.showBar = false;
    this.player = body;
    this.lastPos = { x: 0, y: 0 };
    this.physics.add(body);
  }

  onChunkLoaded(chunk) {
    for (const s of chunk.spawns) {
      if (this.enemies.length >= MAX_ENEMIES && !s.boss) continue;
      if (this.player && !this.player.dead) {
        const d = Math.hypot(s.x - this.player.pos.x, s.y - this.player.pos.y);
        if (d < 850) continue;   // never materialise on top of the player
      }
      this.spawnEnemy(s.type, s.x, s.y);
    }
  }

  spawnEnemy(type, x, y) {
    const spec = ENEMIES[type];
    if (!spec) return null;
    const body = buildFromBlueprint(spec.blueprint, {
      x, y, angle: Math.random() * TAU, tag: 'enemy', team: 1,
      linearDamping: 1.7, angularDamping: 3.4, friction: 0.5,
    });
    body.hueShift = spec.hue;
    body.spec = spec;

    if (spec.boss) {
      // A boss is not a different system -- it is the same assembly with
      // hardened parts and welds, so it still sheds limbs as you break it down.
      for (const p of body.parts) { p.maxHp *= 2.4; p.hp = p.maxHp; }
      for (const w of body.welds) { w.maxHp *= 2.2; w.hp = w.maxHp; }
      body.bossName = spec.name;
      body.recompute();
    }

    const ctrl = new EnemyController(body, spec, {
      game: this, physics: this.physics, worldgen: this.worldgen,
      bus: this.bus, projectiles: this.projectiles,
    });
    body.controller = ctrl;
    this.enemies.push(ctrl);
    this.physics.add(body);
    return body;
  }

  dropPickup(partId, x, y) {
    if (!PARTS[partId]) return;
    // Only modules the player can actually mount are worth picking up.
    if (!BUILDABLE.includes(partId)) return;
    if (this.pickups.length > 90) this.pickups.shift();
    this.pickups.push({ partId, x, y, phase: Math.random() * TAU, life: 95 });
  }

  onDamage(d) {
    if (d.body === this.player && d.amount > 4) {
      this.juice.flash(clamp(d.amount / 90, 0.05, 0.5), '#ff3b3b');
      this.juice.zoomPunch(clamp(d.amount / 220, 0, 0.5));
    }
    if (d.source === this.player && d.amount > 14) {
      this.juice.zoomPunch(clamp(d.amount / 300, 0, 0.35));
    }
  }

  // --- frame --------------------------------------------------------------

  frame(now) {
    const realDt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0);
    this.lastFrame = now;

    if (!this.started) {
      this.handleTitleInput();
      this.juice.update(realDt);
      this.renderer.render();
      this.hud.draw(this.ctx2d, this.camera.viewW, this.camera.viewH);
      this.input.endFrame();
      return;
    }

    this.readInput();
    this.juice.update(realDt);

    const scaled = realDt * this.juice.timeScale;
    this.accumulator += scaled;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    this.fx.update(scaled);
    this.hud.update(realDt);

    if (this.player && !this.player.dead) {
      this.camera.follow(this.player.pos, this.aimWorld, realDt);
      this.worldgen.update(this.player.pos.x, this.player.pos.y);
      const b = this.worldgen.biomeAt(this.player.pos.x, this.player.pos.y);
      this.biomeLabel = b.name;
    } else {
      this.camera.follow({ x: this.camera.x, y: this.camera.y }, null, realDt);
    }

    this.physics.activeBounds = {
      minX: this.camera.x - 1900, minY: this.camera.y - 1900,
      maxX: this.camera.x + 1900, maxY: this.camera.y + 1900,
    };

    this.audio.update(realDt, {
      listener: this.player && !this.player.dead ? this.player.pos : { x: this.camera.x, y: this.camera.y },
      thrust: this.thrustLoad,
      brownout: this.brownout,
      combat: this.combatIntensity,
    });

    this.renderer.render();
    this.hud.draw(this.ctx2d, this.camera.viewW, this.camera.viewH);
    this.input.endFrame();
  }

  handleTitleInput() {
    if (this.input.mouseClicked(0) || this.input.pressed('Space') || this.input.pressed('Enter')) {
      this.started = true;
      this.audio.start();
      this.hud.say('Salvage parts. Weld them on. See what happens.', 4);
    }
  }

  // --- input --------------------------------------------------------------

  readInput() {
    const inp = this.input;
    this.aimWorld = this.camera.screenToWorld(inp.mouse);

    if (inp.pressed('KeyR') && this.player && this.player.dead) {
      this.reset();
      return;
    }
    if (inp.pressed('KeyM')) {
      this.audio.setEnabled(!this.audio.enabled);
      this.hud.say(this.audio.enabled ? 'Audio on' : 'Audio muted', 1.4);
    }
    if (inp.pressed('KeyB')) this.toggleBuildMode();

    // Part selection: number row, or the wheel while building.
    for (let i = 0; i < 10; i++) {
      const code = i === 9 ? 'Digit0' : `Digit${i + 1}`;
      if (inp.pressed(code) && i < BUILDABLE.length) {
        this.selectedIndex = i;
        this.bus.emit('ui:click');
      }
    }
    if (inp.wheel !== 0) {
      if (this.buildMode) {
        this.selectedIndex = (this.selectedIndex + inp.wheel + BUILDABLE.length) % BUILDABLE.length;
        this.bus.emit('ui:click');
      } else {
        this.juice.baseZoom = clamp(this.juice.baseZoom - inp.wheel * 0.08, 0.5, 1.5);
      }
    }
    if (inp.pressed('KeyQ')) this.buildAngle -= Math.PI / 4;
    if (inp.pressed('KeyE')) this.buildAngle += Math.PI / 4;

    if (this.buildMode) this.updateBuildMode();
  }

  toggleBuildMode() {
    if (!this.player || this.player.dead) return;
    this.buildMode = !this.buildMode;
    // Build mode is not a pause: the world keeps moving, slowly. Welding a
    // thruster on while a Skitter closes in is a real decision.
    this.juice.targetScale = this.buildMode ? 0.22 : 1;
    this.juice.baseZoom = this.buildMode ? 1.25 : 1;
    this.buildPreview = null;
    this.bus.emit('ui:click');
    this.hud.say(this.buildMode ? 'BUILD MODE — weld anything to anything' : 'Build mode off', 1.6);
  }

  updateBuildMode() {
    const inp = this.input;
    const p = this.player;
    if (!p || p.dead) return;

    // You can build onto any body in reach -- your own chassis, a wreck, or a
    // boulder you intend to turn into a rocket-propelled battering ram.
    const under = this.physics.queryPoint(this.aimWorld.x, this.aimWorld.y,
      (b) => b.tag !== 'pickup' && b.tag !== 'debris');
    let target = under ? under.body : p;
    const reach = Math.hypot(target.pos.x - p.pos.x, target.pos.y - p.pos.y);
    if (reach > 520) target = p;
    this.buildTargetBody = target;
    this.hoverPart = under && under.body === target ? under.part : null;

    const id = BUILDABLE[this.selectedIndex];
    const def = partDef(id);
    const have = (this.inventory[id] || 0) > 0;

    const snap = findSnap(target, def, this.aimWorld, this.buildAngle, 120);
    if (snap) {
      const world = target.localToWorld(snap.localPos.x, snap.localPos.y);
      this.buildPreview = {
        def, world,
        worldAngle: target.angle + this.buildAngle,
        valid: have,
        localPos: snap.localPos,
        localAngle: this.buildAngle,
        body: target,
      };
    } else {
      this.buildPreview = null;
    }

    if (inp.mouseClicked(0)) {
      if (!this.buildPreview) {
        this.bus.emit('ui:deny');
      } else if (!have) {
        this.bus.emit('ui:deny');
        this.hud.say(`No ${def.name} in inventory — salvage more`, 1.8);
      } else {
        const part = attachPart(target, def, this.buildPreview.localPos, this.buildPreview.localAngle);
        if (part) {
          this.inventory[id]--;
          target.touched = true;
          target.originalPartCount = Math.max(target.originalPartCount, target.parts.length);
          this.fx.sparks(part.wpos.x, part.wpos.y, { x: 0, y: -1 }, 10, 400);
          this.bus.emit('build:place', { x: part.wpos.x, y: part.wpos.y });
        } else {
          this.bus.emit('ui:deny');
        }
      }
    }

    if (inp.mouseClicked(2) && this.hoverPart) {
      const part = this.hoverPart;
      const partId = part.def.id;
      const pos = { x: part.wpos.x, y: part.wpos.y };
      if (detachPart(target, part)) {
        if (BUILDABLE.includes(partId)) {
          this.inventory[partId] = (this.inventory[partId] || 0) + 1;
        } else if (part.def.salvage) {
          for (const s of part.def.salvage.slice(0, 1)) this.dropPickup(s, pos.x, pos.y);
        }
        target.touched = true;
        this.fx.sparks(pos.x, pos.y, { x: 0, y: -1 }, 8, 300);
        this.bus.emit('build:remove', { x: pos.x, y: pos.y });
      } else {
        this.bus.emit('ui:deny');
      }
    }
  }

  /** Translate raw keys into the same Intent an AI produces. */
  buildPlayerIntent(dt) {
    const inp = this.input;
    const it = this.playerIntent;
    let mx = 0, my = 0;
    if (inp.down('KeyW') || inp.down('ArrowUp')) my -= 1;
    if (inp.down('KeyS') || inp.down('ArrowDown')) my += 1;
    if (inp.down('KeyA') || inp.down('ArrowLeft')) mx -= 1;
    if (inp.down('KeyD') || inp.down('ArrowRight')) mx += 1;
    const m = Math.hypot(mx, my);
    if (m > 0) { mx /= m; my /= m; }
    it.move.x = mx;
    it.move.y = my;
    it.aim.x = this.aimWorld.x;
    it.aim.y = this.aimWorld.y;
    it.fire = !this.buildMode && inp.mouseDown(0);
    it.altFire = !this.buildMode && inp.mouseDown(2);
    it.brake = inp.down('ControlLeft') || inp.down('ControlRight');

    this.dashCooldown -= dt;
    const wantsDash = inp.pressed('ShiftLeft') || inp.pressed('ShiftRight') || inp.pressed('Space');
    if (wantsDash && this.dashCooldown <= 0 && !this.buildMode && this.player && !this.player.dead) {
      const dx = m > 0 ? mx : Math.cos(this.player.angle);
      const dy = m > 0 ? my : Math.sin(this.player.angle);
      dash(this.player, dx, dy, 1);
      this.dashCooldown = 0.62;
      this.juice.zoomPunch(0.22);
      this.fx.sparks(this.player.pos.x, this.player.pos.y, { x: dx, y: dy }, 14, 500);
      this.bus.emit('sfx:dash', { x: this.player.pos.x, y: this.player.pos.y });
    }
  }

  // --- simulation ---------------------------------------------------------

  fixedUpdate(dt) {
    this.time += dt;
    this.buildPlayerIntent(dt);

    // AI thinks first, then every intent-carrying body is actuated identically.
    for (const ctrl of this.enemies) {
      if (ctrl.body.dead || ctrl.body.tag !== 'enemy') continue;
      ctrl.update(dt);
    }

    this.updateGrounding();

    let thrust = 0, brownout = 0;
    for (const b of this.physics.bodies) {
      if (!b.intent || b.dead) continue;
      if (!this.physics.isActive(b)) continue;
      const rep = actuate(b, dt, {
        spawnProjectile: (opts) => this.projectiles.spawn(opts),
        particles: this.fx,
        bus: this.bus,
      });
      if (b === this.player) {
        thrust = Math.max(rep.thrust, rep.wheel * 0.6);
        brownout = rep.brownout;
        this.lastDemand = rep.demand;
        this.lastSupply = rep.supply;
      }
    }
    this.thrustLoad = thrust;
    this.brownout = brownout;

    this.physics.step(dt);
    this.projectiles.update(dt, (proj, hit) => this.combat.onProjectileHit(proj, hit));

    this.updateVoid(dt);
    this.updatePickups(dt);
    this.updateEnemies(dt);
    this.updateCombatIntensity(dt);

    if (this.player && !this.player.dead) {
      this.distanceTravelled += Math.hypot(
        this.player.pos.x - this.lastPos.x, this.player.pos.y - this.lastPos.y);
      this.lastPos.x = this.player.pos.x;
      this.lastPos.y = this.player.pos.y;
    }
  }

  /** Wheels need ground; anything without it needs a float core. */
  updateGrounding() {
    for (const b of this.physics.bodies) {
      if (b.dead || b.isStatic) continue;
      if (!this.physics.isActive(b)) { b.grounded = true; continue; }
      b.grounded = this.worldgen.isSolid(b.pos.x, b.pos.y);
    }
  }

  /**
   * Falling into the void. A machine with a working float core simply flies
   * over; anything else slides in, shrinks away and is gone. The player gets a
   * short grace period to thrust back out, which turns a chasm into a real
   * risk/reward crossing rather than an instant kill.
   */
  updateVoid(dt) {
    for (let i = this.physics.bodies.length - 1; i >= 0; i--) {
      const b = this.physics.bodies[i];
      if (b.dead || b.isStatic || !this.physics.isActive(b)) continue;

      if (b.grounded || b.hover) {
        if (b.falling) b.falling = Math.max(0, b.falling - dt * 1.6);
        continue;
      }

      b.falling = (b.falling || 0) + dt * 0.55;
      // Sucked toward the middle of the gap and slowed, so escaping needs thrust.
      b.vel.x *= 1 - dt * 0.9;
      b.vel.y *= 1 - dt * 0.9;
      b.angVel += (Math.random() - 0.5) * dt * 4;

      if (Math.random() < dt * 22) this.fx.voidWisp(b.pos.x, b.pos.y + b.radius * 0.5);

      if (b.falling > 0.55 && b.parts.length) {
        // The void chews on the structure on the way down.
        const p = b.parts[Math.floor(Math.random() * b.parts.length)];
        this.combat.applyDamage(b, p, 60 * dt, { type: 'void', point: p.wpos, dir: { x: 0, y: 1 } });
      }

      if (b.falling >= 1) {
        if (b === this.player) {
          this.killPlayer('lost to the void');
        } else {
          this.fx.explosion(b.pos.x, b.pos.y, 40);
          this.bus.emit('sfx:break', { x: b.pos.x, y: b.pos.y, power: 0.5 });
          b.dead = true;
        }
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      if (pk.life <= 0) { this.pickups.splice(i, 1); continue; }
      if (!p || p.dead) continue;

      const dx = p.pos.x - pk.x, dy = p.pos.y - pk.y;
      const d = Math.hypot(dx, dy);
      if (d < 210) {
        // Magnetised: accelerates in the closer it gets, which feels great.
        const pull = (1 - d / 210) * 660 * dt;
        pk.x += (dx / d) * pull;
        pk.y += (dy / d) * pull;
      }
      if (d < 34) {
        this.inventory[pk.partId] = (this.inventory[pk.partId] || 0) + 1;
        this.salvaged++;
        this.pickups.splice(i, 1);
        this.fx.text(pk.x, pk.y - 10, `+${PARTS[pk.partId].name}`, '#ffd27a');
        this.bus.emit('salvage:pickup', { partId: pk.partId });
      }
    }
  }

  updateEnemies(dt) {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const ctrl = this.enemies[i];
      const b = ctrl.body;

      if (b.dead) { this.enemies.splice(i, 1); continue; }

      // Death is structural, not a hit-point counter: lose every core and the
      // machine stops being a machine.
      if (!b.hasKind('core')) {
        this.onEnemyDestroyed(b);
        this.enemies.splice(i, 1);
        continue;
      }

      if (this.player && !this.player.dead) {
        const d = Math.hypot(b.pos.x - this.player.pos.x, b.pos.y - this.player.pos.y);
        if (d > DESPAWN_RANGE && !b.bossName) {
          b.dead = true;
          this.enemies.splice(i, 1);
        }
      }
    }

    if (this.player && !this.player.dead && !this.player.hasKind('core')) {
      this.killPlayer('core destroyed');
    }
  }

  onEnemyDestroyed(b) {
    this.kills++;
    b.tag = 'debris';
    b.controller = null;
    b.intent = null;
    b.despawnAfter = b.age + 14;

    this.fx.explosion(b.pos.x, b.pos.y, 90 + b.radius);
    this.juice.hitstop(b.bossName ? 0.16 : 0.05);
    this.juice.shakeAt(b.pos.x, b.pos.y, b.bossName ? 1 : 0.45, { x: 0, y: -1 });
    this.juice.flash(b.bossName ? 0.5 : 0.12, '#ffd27a');
    this.bus.emit('sfx:explosion', { x: b.pos.x, y: b.pos.y, power: b.bossName ? 1 : 0.7 });
    this.physics.explode(b.pos.x, b.pos.y, 120 + b.radius, 320, b.bossName ? 60 : 12,
      { exclude: (x) => x === b });

    // The wreck pays out: modules scatter for salvage.
    const drops = b.bossName ? 9 : 2 + Math.floor(Math.random() * 3);
    const pool = b.parts.length
      ? b.parts.map((p) => p.def.id).filter((id) => BUILDABLE.includes(id))
      : [];
    for (let i = 0; i < drops; i++) {
      const id = pool.length && Math.random() < 0.7
        ? pool[Math.floor(Math.random() * pool.length)]
        : ['plate', 'strut', 'thruster', 'wheel'][Math.floor(Math.random() * 4)];
      const a = Math.random() * TAU, r = 20 + Math.random() * 70;
      this.dropPickup(id, b.pos.x + Math.cos(a) * r, b.pos.y + Math.sin(a) * r);
    }
    this.fx.text(b.pos.x, b.pos.y - 30, b.bossName ? 'COLOSSUS DOWN' : 'WRECKED',
      b.bossName ? '#ff5a7a' : '#ffd27a');
    if (b.bossName) this.hud.say('COLOSSUS DOWN — salvage the wreck', 4);
  }

  killPlayer(reason) {
    const p = this.player;
    if (!p || p.dead) return;
    this.fx.explosion(p.pos.x, p.pos.y, 160);
    this.juice.hitstop(0.2);
    this.juice.shakeAt(p.pos.x, p.pos.y, 1.1, { x: 0, y: -1 });
    this.juice.flash(0.7, '#ff3b3b');
    this.bus.emit('sfx:explosion', { x: p.pos.x, y: p.pos.y, power: 1 });
    p.dead = true;
    this.buildMode = false;
    this.juice.targetScale = 1;
    this.hud.say(`Chassis lost — ${reason}`, 4);
  }

  /** Music intensity: how much trouble is the player actually in right now. */
  updateCombatIntensity(dt) {
    let target = 0;
    if (this.player && !this.player.dead) {
      for (const ctrl of this.enemies) {
        if (!ctrl.aware) continue;
        const d = Math.hypot(ctrl.body.pos.x - this.player.pos.x, ctrl.body.pos.y - this.player.pos.y);
        if (d > 1500) continue;
        target += ctrl.body.bossName ? 1.2 : 0.34 * clamp(1 - d / 1500, 0.2, 1);
      }
    }
    target = clamp(target, 0, 1);
    const rate = target > this.combatIntensity ? 2.2 : 0.35;
    this.combatIntensity += (target - this.combatIntensity) * Math.min(1, dt * rate);
  }

  resize() {
    this.renderer.resize();
  }
}

