import { clamp, damp } from '../core/math.js';

/**
 * The feel layer: hitstop, directional screen shake, hit flash and zoom punch.
 * Every one of these is driven by a real number coming out of the simulation
 * (damage dealt, impulse magnitude, distance from the camera) rather than by a
 * canned animation, so a hit that *is* bigger automatically *feels* bigger.
 */
export class Juice {
  constructor(camera) {
    this.camera = camera;
    this.freeze = 0;          // remaining hitstop, in real seconds
    this.timeScale = 1;
    this.targetScale = 1;     // set to <1 for build-mode slow motion
    this.flashAmount = 0;
    this.flashColor = '#ffffff';
    this.vignette = 0;        // low-health pulse
    this.zoomPunchValue = 0;
    this.baseZoom = 1;
    this.frozen = false;
    this.budget = 0.16;       // spendable freeze time, refills continuously
  }

  /**
   * Micro-freeze on impact.
   *
   * Hitstop has to be rationed. A single heavy hit in open exploration should
   * get the full freeze, but a Colossus fight throws dozens of damage events a
   * second, and naively stacking them pins the simulation at 3% speed -- the
   * whole game turns into permanent slow motion. So freezes draw from a budget
   * that refills at a fixed rate, capping the long-run frozen fraction at
   * roughly 14% of wall time while leaving isolated impacts at full strength.
   */
  hitstop(seconds) {
    if (this.budget <= 0.002) return;
    const amount = Math.min(seconds, this.budget);
    this.budget -= amount;
    this.freeze = clamp(Math.max(this.freeze, amount), 0, 0.11);
  }

  /**
   * Shake with distance falloff and impact direction. Off-screen explosions
   * still register faintly, which sells the scale of a boss fight.
   */
  shakeAt(x, y, amount, dir = null) {
    const dx = x - this.camera.x, dy = y - this.camera.y;
    const d = Math.hypot(dx, dy);
    const falloff = clamp(1 - d / (900 / this.camera.zoom), 0, 1);
    if (falloff <= 0) return;
    // Shake pushes the frame *away* from the impact point.
    const bias = dir ? { x: -dir.x, y: -dir.y } : (d > 1 ? { x: dx / d, y: dy / d } : null);
    this.camera.shake(amount * falloff * falloff, bias);
  }

  flash(amount, color = '#ffffff') {
    if (amount > this.flashAmount) {
      this.flashAmount = clamp(amount, 0, 1);
      this.flashColor = color;
    }
  }

  zoomPunch(amount) {
    this.zoomPunchValue = Math.max(this.zoomPunchValue, amount);
  }

  update(realDt) {
    // Refill slower than freezes are spent in a heavy fight: sluggish controls
    // cost the player more than an under-punctuated hit does.
    this.budget = Math.min(0.16, this.budget + realDt * 0.11);
    if (this.freeze > 0) {
      this.freeze -= realDt;
      this.frozen = true;
      // Not a hard zero: a sliver of motion keeps particles from looking dead.
      this.timeScale = 0.035;
    } else {
      this.frozen = false;
      // Recover fast. A slow ramp out of hitstop sounds like a nice easing
      // curve but it compounds: at 60fps a rate of 14 spends ~200ms climbing
      // back to full speed, and with impacts arriving every few frames the
      // simulation never actually reaches 1x. Snap back instead -- the freeze
      // itself is what the player feels, not the tail.
      this.timeScale = damp(this.timeScale, this.targetScale, 45, realDt);
    }

    this.flashAmount = Math.max(0, this.flashAmount - realDt * 4.5);
    this.zoomPunchValue = damp(this.zoomPunchValue, 0, 9, realDt);
    this.camera.targetZoom = this.baseZoom * (1 + this.zoomPunchValue * 0.09);
    this.camera.update(realDt);
  }

  reset() {
    this.freeze = 0;
    this.timeScale = 1;
    this.targetScale = 1;
    this.flashAmount = 0;
    this.zoomPunchValue = 0;
    this.budget = 0.16;
  }
}
