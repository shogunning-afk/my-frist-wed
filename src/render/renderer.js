import { clamp, TAU } from '../core/math.js';
import { CHUNK } from '../world/worldgen.js';
import { PARTS, GRID } from '../game/parts.js';

// Clean, high-contrast, flat-shaded rendering. Readability is a combat feature:
// during a Colossus fight there can be forty bodies, six hundred particles and a
// dozen projectiles on screen, and the player still has to see which weld is
// about to fail.

const colorCache = new Map();

/** Cheap hue rotation used to give each enemy faction its own palette. */
function tint(hex, hueShift) {
  if (!hueShift) return hex;
  const key = hex + '|' + hueShift;
  const hit = colorCache.get(key);
  if (hit) return hit;

  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  h = (h + hueShift / 360) % 1;

  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  r = hue2rgb(p, q, h + 1 / 3);
  g = hue2rgb(p, q, h);
  b = hue2rgb(p, q, h - 1 / 3);

  const out = '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  colorCache.set(key, out);
  return out;
}

export class Renderer {
  constructor(canvas, ctx2d, deps) {
    this.canvas = canvas;
    this.ctx = ctx2d;
    this.camera = deps.camera;
    this.worldgen = deps.worldgen;
    this.physics = deps.physics;
    this.fx = deps.fx;
    this.juice = deps.juice;
    this.game = deps.game;

    this.glowSprite = this.makeGlowSprite();
    this.stars = this.makeStars();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  makeGlowSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.42)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 96, 96);
    return c;
  }

  /** Parallax star layer visible through the voids. */
  makeStars() {
    const out = [];
    for (let i = 0; i < 260; i++) {
      out.push({
        x: Math.random() * 2400 - 1200,
        y: Math.random() * 2400 - 1200,
        z: 0.15 + Math.random() * 0.35,
        r: 0.6 + Math.random() * 1.7,
        a: 0.25 + Math.random() * 0.6,
      });
    }
    return out;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.resize(w, h);
  }

  render() {
    const ctx = this.ctx;
    const cam = this.camera;
    const W = cam.viewW, H = cam.viewH;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // The void: what you fall into.
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, 0, W, H);
    this.drawStars(ctx);

    ctx.save();
    cam.applyTransform(ctx);
    const bounds = cam.viewBounds(220);

    this.drawTerrain(ctx, bounds);
    this.drawShadows(ctx, bounds);
    this.drawPickups(ctx);
    this.drawBodies(ctx, bounds);
    this.drawProjectiles(ctx);
    this.drawParticles(ctx);
    if (this.game.buildMode) this.drawBuildOverlay(ctx);
    this.drawTargeting(ctx);
    ctx.restore();

    this.drawPostEffects(ctx, W, H);
  }

  drawStars(ctx) {
    const cam = this.camera;
    ctx.save();
    for (const s of this.stars) {
      // Wrap the star field around the camera so it never runs out.
      const px = ((s.x - cam.x * s.z) % 2400 + 3600) % 2400 - 1200 + cam.viewW / 2;
      const py = ((s.y - cam.y * s.z) % 2400 + 3600) % 2400 - 1200 + cam.viewH / 2;
      if (px < -10 || py < -10 || px > cam.viewW + 10 || py > cam.viewH + 10) continue;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#9fb4ff';
      ctx.fillRect(px, py, s.r, s.r);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawTerrain(ctx, bounds) {
    const chunks = this.worldgen.visibleChunks(bounds);
    ctx.imageSmoothingEnabled = false;
    for (const c of chunks) {
      if (!c.canvas) continue;
      ctx.drawImage(c.canvas, c.ox, c.oy, CHUNK, CHUNK);
    }
    ctx.imageSmoothingEnabled = true;
  }

  /** A single offset silhouette pass gives the whole scene depth cheaply. */
  drawShadows(ctx, bounds) {
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = '#000';
    ctx.translate(6, 9);
    for (const b of this.physics.bodies) {
      if (b.dead || b.aabb.maxX < bounds.minX || b.aabb.minX > bounds.maxX) continue;
      if (b.aabb.maxY < bounds.minY || b.aabb.minY > bounds.maxY) continue;
      for (const p of b.parts) {
        ctx.beginPath();
        const v = p.worldVerts;
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawBodies(ctx, bounds) {
    const glows = [];
    for (const b of this.physics.bodies) {
      if (b.dead) continue;
      if (b.aabb.maxX < bounds.minX || b.aabb.minX > bounds.maxX) continue;
      if (b.aabb.maxY < bounds.minY || b.aabb.minY > bounds.maxY) continue;
      this.drawBody(ctx, b, glows);
    }

    // Additive glow pass last, so nothing draws over the light.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of glows) {
      ctx.globalAlpha = g.a;
      const s = g.r * 2;
      ctx.drawImage(this.glowSprite, g.x - g.r, g.y - g.r, s, s);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawBody(ctx, body, glows) {
    const hue = body.hueShift || 0;
    const falling = body.falling || 0;

    if (falling > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - falling, 0, 1);
      ctx.translate(body.pos.x, body.pos.y);
      const s = clamp(1 - falling * 0.75, 0.05, 1);
      ctx.scale(s, s);
      ctx.translate(-body.pos.x, -body.pos.y);
    }

    for (const p of body.parts) {
      const def = p.def;
      const v = p.worldVerts;
      const wear = clamp(p.hp / p.maxHp, 0, 1);

      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();

      let fill = tint(def.color, hue);
      if (p.flash > 0.02) {
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.globalAlpha = clamp(p.flash, 0, 1) * 0.9;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = fill;
        ctx.fill();
        // Damage reads as the part going dark and dead.
        if (wear < 0.98) {
          ctx.globalAlpha = (1 - wear) * 0.55;
          ctx.fillStyle = '#0b0d14';
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      ctx.lineWidth = 2;
      ctx.strokeStyle = wear < 0.35 ? '#ff5a5a' : tint(def.accent, hue);
      ctx.stroke();

      // Actuator tells: a firing thruster, a hot blade, a charged cannon.
      if (def.kind === 'thruster' && p.activation > 0.05) {
        this.drawFlame(ctx, p);
      }
      if (def.glow > 0 || p.heat > 0.05) {
        glows.push({
          x: p.wpos.x, y: p.wpos.y,
          r: def.reach * (1.5 + p.heat * 1.4),
          a: clamp(def.glow * 0.5 + p.heat * 0.5, 0, 1) * (0.35 + wear * 0.4),
        });
      }
      if (def.kind === 'blade' && p.heat > 0.1) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = p.heat * 0.7;
        ctx.strokeStyle = def.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    this.drawWeldStress(ctx, body);

    if (falling > 0) ctx.restore();

    if ((body.tag === 'enemy' || body.showBar) && body.parts.length) {
      this.drawIntegrityBar(ctx, body);
    }
  }

  drawFlame(ctx, part) {
    const a = part.wangle;
    const back = a + Math.PI;
    const len = (10 + part.activation * 30) * (0.75 + Math.random() * 0.5);
    const w = 6 + part.activation * 4;
    const ox = part.wpos.x + Math.cos(back) * (part.def.extents.x + 1);
    const oy = part.wpos.y + Math.sin(back) * (part.def.extents.x + 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(back + 1.57) * w * 0.5, oy + Math.sin(back + 1.57) * w * 0.5);
    ctx.lineTo(ox + Math.cos(back) * len, oy + Math.sin(back) * len);
    ctx.lineTo(ox + Math.cos(back - 1.57) * w * 0.5, oy + Math.sin(back - 1.57) * w * 0.5);
    ctx.closePath();
    ctx.fillStyle = part.activation > 0.7 ? '#9fe8ff' : '#c9a8ff';
    ctx.globalAlpha = 0.65 + part.activation * 0.35;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Stressed welds are drawn as glowing seams that redden as they fail. This is
   * the player's only warning that a wing is about to come off -- and their cue
   * that an enemy is one good hit from losing its gun arm.
   */
  drawWeldStress(ctx, body) {
    if (body.welds.length === 0) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const w of body.welds) {
      const ratio = w.hp / w.maxHp;
      if (ratio > 0.8) continue;
      const a = body.getPart(w.a), b = body.getPart(w.b);
      if (!a || !b) continue;
      const t = clamp(1 - ratio, 0, 1);
      ctx.globalAlpha = clamp(t * 1.1, 0, 0.95);
      ctx.strokeStyle = ratio < 0.35 ? '#ff3b3b' : '#ffb547';
      ctx.lineWidth = 1.5 + t * 2.5;
      ctx.beginPath();
      ctx.moveTo(a.wpos.x, a.wpos.y);
      ctx.lineTo(b.wpos.x, b.wpos.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawIntegrityBar(ctx, body) {
    const w = clamp(body.radius * 1.8, 34, 150);
    const x = body.pos.x - w / 2;
    const y = body.aabb.minY - 14;
    const v = clamp(body.integrity, 0, 1);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#11141f';
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = v > 0.5 ? '#7de08a' : v > 0.25 ? '#ffc857' : '#ff5a5a';
    ctx.fillRect(x, y, w * v, 4);
    ctx.globalAlpha = 1;
    if (body.bossName) {
      ctx.font = '600 12px ui-monospace, monospace';
      ctx.fillStyle = '#ffd0d0';
      ctx.textAlign = 'center';
      ctx.fillText(body.bossName, body.pos.x, y - 6);
      ctx.textAlign = 'left';
    }
  }

  drawPickups(ctx) {
    const t = this.game.time;
    for (const p of this.game.pickups) {
      const def = PARTS[p.partId];
      const bob = Math.sin(t * 3 + p.phase) * 3;
      ctx.save();
      ctx.translate(p.x, p.y + bob);
      ctx.rotate(t * 0.8 + p.phase);
      ctx.scale(0.62, 0.62);
      ctx.beginPath();
      const v = def.verts;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = def.accent;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + Math.sin(t * 5 + p.phase) * 0.12;
      const r = 26;
      ctx.drawImage(this.glowSprite, p.x - r, p.y + bob - r, r * 2, r * 2);
      ctx.restore();
    }
  }

  drawProjectiles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of this.game.projectiles.list) {
      const d = p.def;
      // Motion-stretched trail: the faster it moves, the longer it reads.
      ctx.strokeStyle = d.trail;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = d.radius * 1.6;
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      ctx.fillStyle = d.color;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, d.radius, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.glowSprite, p.x - d.glow, p.y - d.glow, d.glow * 2, d.glow * 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx) {
    const pool = this.fx.pool;

    // Non-additive pass: debris chunks, smoke, floating text.
    for (const p of pool) {
      if (!p.active || p.glow) continue;
      const t = p.life / p.maxLife;
      if (p.type === 'debris') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.scale(p.size, p.size);
        ctx.globalAlpha = clamp(t * 1.4, 0, 1);
        ctx.beginPath();
        const v = p.verts;
        ctx.moveTo(v[0].x, v[0].y);
        for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
        ctx.closePath();
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
      } else if (p.type === 'smoke') {
        ctx.globalAlpha = clamp(t, 0, 1) * 0.35;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      } else if (p.type === 'text') {
        ctx.globalAlpha = clamp(t * 1.6, 0, 1);
        ctx.font = '700 15px ui-monospace, monospace';
        ctx.fillStyle = p.color;
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.textAlign = 'left';
      }
    }
    ctx.globalAlpha = 1;

    // Additive pass: sparks, rings, flashes.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const p of pool) {
      if (!p.active || !p.glow) continue;
      const t = clamp(p.life / p.maxLife, 0, 1);
      if (p.type === 'spark') {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.stroke();
      } else if (p.type === 'ring') {
        const grow = 1 - t;
        ctx.globalAlpha = t * 0.75;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2 + t * 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.25 + grow), 0, TAU);
        ctx.stroke();
      } else if (p.type === 'flash') {
        ctx.globalAlpha = t;
        ctx.drawImage(this.glowSprite, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /** Build mode: the snap ghost, the host highlight, and the grid. */
  drawBuildOverlay(ctx) {
    const g = this.game;
    const preview = g.buildPreview;

    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#7de8ff';
    ctx.lineWidth = 1;
    const b = this.camera.viewBounds(0);
    const step = GRID;
    ctx.beginPath();
    for (let x = Math.floor(b.minX / step) * step; x < b.maxX; x += step) {
      ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY);
    }
    for (let y = Math.floor(b.minY / step) * step; y < b.maxY; y += step) {
      ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y);
    }
    ctx.stroke();
    ctx.restore();

    if (g.buildTargetBody) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#7de8ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      const a = g.buildTargetBody.aabb;
      ctx.strokeRect(a.minX - 6, a.minY - 6, a.maxX - a.minX + 12, a.maxY - a.minY + 12);
      ctx.restore();
    }

    if (g.hoverPart) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#ff5a7a';
      ctx.lineWidth = 3;
      const v = g.hoverPart.worldVerts;
      ctx.beginPath();
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    if (preview) {
      const def = preview.def;
      ctx.save();
      ctx.translate(preview.world.x, preview.world.y);
      ctx.rotate(preview.worldAngle);
      ctx.beginPath();
      const v = def.verts;
      ctx.moveTo(v[0].x, v[0].y);
      for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
      ctx.closePath();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = preview.valid ? def.color : '#ff3b5c';
      ctx.fill();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = preview.valid ? '#9fffe0' : '#ff3b5c';
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Aim reticle plus a soft lock indicator on whatever is under the cursor. */
  drawTargeting(ctx) {
    const g = this.game;
    if (!g.player || g.player.dead) return;
    const a = g.aimWorld;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = g.buildMode ? '#7de8ff' : '#ffd27a';
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 9, 0, TAU);
    ctx.moveTo(a.x - 15, a.y); ctx.lineTo(a.x - 5, a.y);
    ctx.moveTo(a.x + 5, a.y); ctx.lineTo(a.x + 15, a.y);
    ctx.moveTo(a.x, a.y - 15); ctx.lineTo(a.x, a.y - 5);
    ctx.moveTo(a.x, a.y + 5); ctx.lineTo(a.x, a.y + 15);
    ctx.stroke();
    ctx.restore();
  }

  drawPostEffects(ctx, W, H) {
    const j = this.juice;

    if (j.flashAmount > 0.005) {
      ctx.save();
      ctx.globalAlpha = j.flashAmount * 0.55;
      ctx.fillStyle = j.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Vignette: always a touch, heavier as the player's chassis fails.
    const hurt = this.game.player && !this.game.player.dead
      ? clamp(1 - this.game.player.integrity, 0, 1) : 0.65;
    const grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(${hurt > 0.5 ? '60,0,10' : '0,0,0'},${0.45 + hurt * 0.35})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (j.frozen) {
      // A single scanline tick during hitstop -- subliminal, but you feel it.
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }
}
