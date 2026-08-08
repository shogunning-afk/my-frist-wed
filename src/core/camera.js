import { clamp, damp, lerp } from './math.js';

// Camera owns the world<->screen transform plus the two pieces of "feel" that
// live in that transform: lookahead toward the aim point, and directional
// screen shake whose magnitude scales with the damage that caused it.

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.viewW = 1280;
    this.viewH = 720;

    // Shake is stored as a decaying trauma value plus a bias direction, so a
    // hit from the left shakes the frame along that axis instead of jittering
    // uniformly. That reads as impact direction rather than generic noise.
    this.trauma = 0;
    this.biasX = 0;
    this.biasY = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.shakeAngle = 0;
    this.time = 0;
  }

  resize(w, h) {
    this.viewW = w;
    this.viewH = h;
  }

  /**
   * @param {number} amount 0..1-ish trauma to add
   * @param {{x:number,y:number}} [dir] normalised direction the impact pushed
   */
  shake(amount, dir = null) {
    this.trauma = clamp(this.trauma + amount, 0, 1.2);
    if (dir) {
      this.biasX = lerp(this.biasX, dir.x, 0.6);
      this.biasY = lerp(this.biasY, dir.y, 0.6);
    }
  }

  follow(target, aim, dt) {
    // Lead the camera toward where the player is looking, capped so fast aim
    // flicks do not yank the frame around.
    let lookX = 0, lookY = 0;
    if (aim) {
      lookX = clamp(aim.x - target.x, -260, 260) * 0.28;
      lookY = clamp(aim.y - target.y, -260, 260) * 0.28;
    }
    const velLead = target.vel ? { x: target.vel.x * 0.16, y: target.vel.y * 0.16 } : { x: 0, y: 0 };
    const gx = target.x + lookX + clamp(velLead.x, -220, 220);
    const gy = target.y + lookY + clamp(velLead.y, -220, 220);
    this.x = damp(this.x, gx, 6, dt);
    this.y = damp(this.y, gy, 6, dt);
    this.zoom = damp(this.zoom, this.targetZoom, 4, dt);
  }

  update(dt) {
    this.time += dt;
    // Quadratic falloff makes small hits subtle and big ones violent.
    const t = this.trauma * this.trauma;
    const f = this.time * 47;
    const n1 = Math.sin(f * 1.7) * Math.sin(f * 0.63);
    const n2 = Math.sin(f * 2.3 + 1.7) * Math.sin(f * 0.41 + 0.5);
    const mag = t * 34;
    // Bias 70% of the motion along the impact axis, keep 30% omnidirectional.
    this.shakeX = mag * (n1 * 0.3 + this.biasX * n2 * 0.7);
    this.shakeY = mag * (n2 * 0.3 + this.biasY * n1 * 0.7);
    this.shakeAngle = t * 0.035 * n1;
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
  }

  worldToScreen(p) {
    const z = this.zoom;
    return {
      x: (p.x - this.x) * z + this.viewW / 2 + this.shakeX,
      y: (p.y - this.y) * z + this.viewH / 2 + this.shakeY,
    };
  }

  screenToWorld(p) {
    const z = this.zoom;
    return {
      x: (p.x - this.viewW / 2 - this.shakeX) / z + this.x,
      y: (p.y - this.viewH / 2 - this.shakeY) / z + this.y,
    };
  }

  /** Half-extents of the visible world region, padded for culling. */
  viewBounds(pad = 160) {
    const hw = this.viewW / 2 / this.zoom + pad;
    const hh = this.viewH / 2 / this.zoom + pad;
    return { minX: this.x - hw, minY: this.y - hh, maxX: this.x + hw, maxY: this.y + hh };
  }

  applyTransform(ctx) {
    ctx.translate(this.viewW / 2 + this.shakeX, this.viewH / 2 + this.shakeY);
    ctx.rotate(this.shakeAngle);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }
}
