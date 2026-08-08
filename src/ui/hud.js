import { clamp } from '../core/math.js';
import { PARTS, BUILDABLE } from '../game/parts.js';

const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * Screen-space HUD. Everything here answers a question the player asks under
 * pressure: how broken am I, what can I still build, and where is the fight.
 */
export class HUD {
  constructor(game) {
    this.game = game;
    this.minimap = document.createElement('canvas');
    this.minimap.width = this.minimap.height = 168;
    this.minimapTimer = 0;
    this.minimapOrigin = { x: 0, y: 0 };
    this.toast = null;
    this.toastTime = 0;
  }

  say(text, seconds = 2.6) {
    this.toast = text;
    this.toastTime = seconds;
  }

  update(dt) {
    if (this.toastTime > 0) this.toastTime -= dt;
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.5;
      this.paintMinimap();
    }
  }

  /** Terrain layer of the minimap, repainted twice a second. */
  paintMinimap() {
    const g = this.minimap.getContext('2d');
    const S = this.minimap.width;
    const range = 2200;
    const samples = 42;
    const step = (range * 2) / samples;
    const px = S / samples;
    const p = this.game.player;
    const cx = p && !p.dead ? p.pos.x : this.game.camera.x;
    const cy = p && !p.dead ? p.pos.y : this.game.camera.y;
    this.minimapOrigin = { x: cx, y: cy, range };

    g.clearRect(0, 0, S, S);
    g.fillStyle = '#080a12';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < samples; j++) {
        const wx = cx - range + i * step;
        const wy = cy - range + j * step;
        if (!this.game.worldgen.isSolid(wx, wy)) continue;
        const b = this.game.worldgen.biomeAt(wx, wy);
        g.fillStyle = `rgb(${b.ground[0]},${b.ground[1]},${b.ground[2]})`;
        g.fillRect(i * px, j * px, px + 1, px + 1);
      }
    }
  }

  draw(ctx, W, H) {
    const g = this.game;
    ctx.save();
    ctx.textBaseline = 'top';

    this.drawStatus(ctx, W, H);
    this.drawHotbar(ctx, W, H);
    this.drawMinimap(ctx, W, H);
    if (g.buildMode) this.drawBuildPanel(ctx, W, H);
    this.drawToast(ctx, W, H);
    if (g.player && g.player.dead) this.drawDeath(ctx, W, H);
    if (!g.started) this.drawTitle(ctx, W, H);

    ctx.restore();
  }

  bar(ctx, x, y, w, h, value, color, bg = 'rgba(8,10,18,0.75)') {
    ctx.fillStyle = bg;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(value, 0, 1), h);
  }

  drawStatus(ctx, W, H) {
    const g = this.game;
    const p = g.player;
    const x = 20, y = 20;

    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = '#8ea3c9';
    ctx.fillText('STRUCTURAL INTEGRITY', x, y);

    const integrity = p && !p.dead ? p.integrity : 0;
    this.bar(ctx, x, y + 16, 230, 12, integrity,
      integrity > 0.5 ? '#7de08a' : integrity > 0.25 ? '#ffc857' : '#ff5a5a');

    ctx.fillStyle = '#8ea3c9';
    ctx.fillText('ENERGY', x, y + 40);
    const energy = p && p.energyMax > 0 ? p.energy / p.energyMax : 0;
    this.bar(ctx, x, y + 56, 230, 8, energy, g.brownout > 0.15 ? '#ff8a3d' : '#39e6ff');

    ctx.font = `500 11px ${FONT}`;
    const parts = p && !p.dead ? p.parts.length : 0;
    const mass = p && !p.dead ? p.mass.toFixed(1) : '0.0';
    // Draw vs supply is the number that decides a build. Showing it live is
    // what turns "why is my machine sluggish" into "I need another battery".
    const draw = Math.round(g.lastDemand || 0);
    const supply = Math.round(g.lastSupply || 0);
    ctx.fillStyle = draw > supply ? '#ff8a3d' : '#5f6f8f';
    ctx.fillText(`DRAW ${draw}/${supply}`, x + 152, y + 72);
    ctx.fillStyle = '#5f6f8f';
    ctx.fillText(`PARTS ${parts}   MASS ${mass}`, x, y + 72);
    ctx.fillText(g.biomeLabel.toUpperCase(), x, y + 88);

    if (g.brownout > 0.15) {
      ctx.fillStyle = '#ff8a3d';
      ctx.fillText('! POWER BROWNOUT - actuators exceed supply', x, y + 104);
    }
    if (p && !p.dead && !p.grounded && !p.hover) {
      ctx.fillStyle = '#c9a8ff';
      ctx.fillText('! OVER THE VOID - no float core', x, y + (g.brownout > 0.15 ? 120 : 104));
    }

    // Run stats, right-aligned under the minimap.
    ctx.textAlign = 'right';
    ctx.font = `600 12px ${FONT}`;
    ctx.fillStyle = '#8ea3c9';
    ctx.fillText(`WRECKED ${g.kills}`, W - 20, 210);
    ctx.fillText(`SALVAGED ${g.salvaged}`, W - 20, 226);
    ctx.fillText(`${Math.floor(g.distanceTravelled / 100)}m TRAVELLED`, W - 20, 242);
    ctx.textAlign = 'left';
  }

  drawHotbar(ctx, W, H) {
    const g = this.game;
    const slot = 54, gap = 6;
    const n = BUILDABLE.length;
    const total = n * slot + (n - 1) * gap;
    const x0 = (W - total) / 2;
    const y = H - slot - 22;

    for (let i = 0; i < n; i++) {
      const id = BUILDABLE[i];
      const def = PARTS[id];
      const count = g.inventory[id] || 0;
      const selected = g.selectedIndex === i;
      const x = x0 + i * (slot + gap);

      ctx.fillStyle = selected ? 'rgba(57,230,255,0.16)' : 'rgba(8,10,18,0.72)';
      ctx.fillRect(x, y, slot, slot);
      ctx.strokeStyle = selected ? '#39e6ff' : 'rgba(140,160,200,0.28)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, slot - 1, slot - 1);

      // Draw the part's real silhouette as its icon.
      ctx.save();
      ctx.translate(x + slot / 2, y + slot / 2 - 4);
      const s = clamp(17 / def.reach, 0.35, 1.05);
      ctx.scale(s, s);
      ctx.globalAlpha = count > 0 ? 1 : 0.25;
      ctx.beginPath();
      const v = def.verts;
      ctx.moveTo(v[0].x, v[0].y);
      for (let k = 1; k < v.length; k++) ctx.lineTo(v[k].x, v[k].y);
      ctx.closePath();
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = 2 / s;
      ctx.strokeStyle = def.accent;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = count > 0 ? '#e8f0ff' : '#5f6f8f';
      ctx.textAlign = 'center';
      ctx.fillText(`${count}`, x + slot / 2, y + slot - 15);
      ctx.font = `500 9px ${FONT}`;
      ctx.fillStyle = '#5f6f8f';
      ctx.fillText(`${i + 1 <= 9 ? i + 1 : '0'}`, x + 8, y + 5);
      ctx.textAlign = 'left';
    }

    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = g.buildMode ? '#39e6ff' : '#5f6f8f';
    ctx.textAlign = 'center';
    ctx.fillText(
      g.buildMode
        ? 'BUILD MODE  ·  LMB weld  ·  RMB salvage part  ·  Q/E rotate  ·  wheel cycle  ·  B exit'
        : 'WASD move  ·  mouse aim  ·  LMB fire  ·  RMB mortar  ·  SHIFT dash  ·  B build',
      W / 2, y - 20,
    );
    ctx.textAlign = 'left';
  }

  drawMinimap(ctx, W, H) {
    const S = this.minimap.width;
    const x = W - S - 20, y = 20;
    const g = this.game;
    const o = this.minimapOrigin;

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(this.minimap, x, y);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(140,160,200,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);

    const toMap = (wx, wy) => ({
      x: x + ((wx - o.x + o.range) / (o.range * 2)) * S,
      y: y + ((wy - o.y + o.range) / (o.range * 2)) * S,
    });

    // Live overlay: enemies, pickups, the player.
    for (const b of g.physics.bodies) {
      if (b.dead) continue;
      let color = null, size = 2;
      if (b.tag === 'enemy') { color = b.bossName ? '#ff3b5c' : '#ff8a5c'; size = b.bossName ? 5 : 3; }
      else if (b.tag === 'player') { color = '#39e6ff'; size = 4; }
      if (!color) continue;
      const m = toMap(b.pos.x, b.pos.y);
      if (m.x < x || m.y < y || m.x > x + S || m.y > y + S) continue;
      ctx.fillStyle = color;
      ctx.fillRect(m.x - size / 2, m.y - size / 2, size, size);
    }
    ctx.fillStyle = '#ffd27a';
    for (const p of g.pickups) {
      const m = toMap(p.x, p.y);
      if (m.x < x || m.y < y || m.x > x + S || m.y > y + S) continue;
      ctx.fillRect(m.x - 1, m.y - 1, 2, 2);
    }
    ctx.restore();
  }

  drawBuildPanel(ctx, W, H) {
    const g = this.game;
    const id = BUILDABLE[g.selectedIndex];
    const def = PARTS[id];
    const x = 20, y = H - 250, w = 340;

    ctx.fillStyle = 'rgba(8,10,18,0.82)';
    ctx.fillRect(x, y, w, 132);
    ctx.strokeStyle = 'rgba(57,230,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 131);

    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#39e6ff';
    ctx.fillText(def.name.toUpperCase(), x + 14, y + 14);

    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = '#8ea3c9';
    wrapText(ctx, def.desc || '', x + 14, y + 36, w - 28, 14);

    const stats = [
      ['MASS', (def.density * areaOf(def.verts)).toFixed(2)],
      ['HP', String(def.hp)],
      ['WELD', String(def.weldHp)],
      ['ENERGY', def.energy > 0 ? `+${def.energy}` : String(def.energy)],
    ];
    ctx.font = `600 11px ${FONT}`;
    stats.forEach((s, i) => {
      const sx = x + 14 + (i % 4) * 82;
      ctx.fillStyle = '#5f6f8f';
      ctx.fillText(s[0], sx, y + 96);
      ctx.fillStyle = s[1].startsWith('-') ? '#ff8a3d' : '#e8f0ff';
      ctx.fillText(s[1], sx, y + 110);
    });
  }

  drawToast(ctx, W, H) {
    if (this.toastTime <= 0 || !this.toast) return;
    const a = clamp(this.toastTime, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `600 15px ${FONT}`;
    ctx.textAlign = 'center';
    const wpx = ctx.measureText(this.toast).width + 32;
    ctx.fillStyle = 'rgba(8,10,18,0.8)';
    ctx.fillRect(W / 2 - wpx / 2, 96, wpx, 32);
    ctx.fillStyle = '#e8f0ff';
    ctx.fillText(this.toast, W / 2, 105);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawDeath(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,14,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = `700 44px ${FONT}`;
    ctx.fillStyle = '#ff5a5a';
    ctx.fillText('CHASSIS LOST', W / 2, H / 2 - 70);
    ctx.font = `500 15px ${FONT}`;
    ctx.fillStyle = '#8ea3c9';
    ctx.fillText(`${this.game.kills} machines wrecked  ·  ${this.game.salvaged} modules salvaged`, W / 2, H / 2 - 12);
    ctx.fillText(`${Math.floor(this.game.distanceTravelled / 100)}m of frontier crossed`, W / 2, H / 2 + 10);
    ctx.font = `700 17px ${FONT}`;
    ctx.fillStyle = '#39e6ff';
    ctx.fillText('PRESS  R  TO REBUILD', W / 2, H / 2 + 60);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawTitle(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,14,0.82)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = '#39e6ff';
    ctx.fillText('T H E   G R A N D   F R O N T I E R', W / 2, H / 2 - 150);
    ctx.font = `700 76px ${FONT}`;
    ctx.fillStyle = '#e8f0ff';
    ctx.fillText('OMNI', W / 2, H / 2 - 120);

    ctx.font = `500 14px ${FONT}`;
    ctx.fillStyle = '#8ea3c9';
    const lines = [
      'Break the world apart. Weld it back together as something meaner.',
      '',
      'WASD thrust      MOUSE aim      LMB fire      RMB mortar      SHIFT dash',
      'B build mode     1-0 select part     Q/E rotate     WHEEL cycle',
      '',
      'Everything is physics. Mount thrusters off-center and you will spin.',
      'Bolt on too much and you will brown out. Welds fail before parts do.',
    ];
    lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 - 20 + i * 22));

    ctx.font = `700 18px ${FONT}`;
    ctx.fillStyle = '#ffd27a';
    ctx.fillText('CLICK TO DEPLOY', W / 2, H / 2 + 170);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

function areaOf(verts) {
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p0 = verts[i], p1 = verts[(i + 1) % verts.length];
    a += p0.x * p1.y - p1.x * p0.y;
  }
  return Math.abs(a / 2);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let ly = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, ly);
      line = w;
      ly += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, ly);
}
