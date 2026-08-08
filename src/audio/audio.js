import { clamp } from '../core/math.js';

// Everything you hear is synthesised at runtime with the Web Audio API -- there
// are no audio files in this project. Impacts are noise bursts shaped by
// bandpass filters, explosions are pitch-swept sines under filtered noise, and
// the soundtrack is a sequencer that rewrites its own arrangement as combat
// heats up.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Am - F - C - G, the backbone of every synthwave track ever written.
const PROGRESSION = [
  { root: 45, chord: [45, 48, 52] },   // Am
  { root: 41, chord: [41, 45, 48] },   // F
  { root: 48, chord: [48, 52, 55] },   // C
  { root: 43, chord: [43, 47, 50] },   // G
];

export class AudioEngine {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.listener = { x: 0, y: 0 };
    this.combat = 0;          // 0..1, drives the arrangement
    this.voices = 0;
    this.maxVoices = 26;

    this.bpm = 126;
    this.step = 0;            // 16th-note counter
    this.nextNoteTime = 0;
    this.lookahead = 0.12;

    this.bindEvents();
  }

  bindEvents() {
    const b = this.bus;
    b.on('sfx:impact', (e) => this.impact(e));
    b.on('sfx:explosion', (e) => this.explosion(e));
    b.on('sfx:break', (e) => this.breakage(e));
    b.on('sfx:dash', (e) => this.whoosh(e, 1));
    b.on('sfx:throw', (e) => this.whoosh(e, 0.7));
    b.on('sfx:charge', (e) => this.charge(e));
    b.on('weapon:fired', (e) => this.shot(e));
    b.on('enemy:alert', (e) => this.alert(e));
    b.on('salvage:pickup', (e) => this.pickup(e));
    b.on('build:place', (e) => this.weldSound(e, 1));
    b.on('build:remove', (e) => this.weldSound(e, 0.6));
    b.on('ui:click', () => this.blip(880, 0.05));
    b.on('ui:deny', () => this.blip(160, 0.09, 'square'));
  }

  /** Must be called from a user gesture -- browsers refuse audio otherwise. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    // A limiter keeps a dozen simultaneous explosions from clipping.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 9;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.36;

    // Shared delay for leads and impacts -- glue, and it costs one node.
    this.delay = ctx.createDelay(0.6);
    this.delay.delayTime.value = 60 / this.bpm * 0.75;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.34;
    this.delayFilter = ctx.createBiquadFilter();
    this.delayFilter.type = 'lowpass';
    this.delayFilter.frequency.value = 2200;
    this.delay.connect(this.delayFb).connect(this.delayFilter).connect(this.delay);
    this.delay.connect(this.musicBus);

    this.sfxBus.connect(this.comp);
    this.musicBus.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);

    this.noiseBuffer = this.makeNoise(2.0);
    this.startThrusterVoice();

    this.nextNoteTime = ctx.currentTime + 0.08;
    this.ready = true;
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // --- routing helpers -----------------------------------------------------

  /** Positional gain + stereo pan relative to the listener. */
  place(x, y, baseGain) {
    const ctx = this.ctx;
    const dx = x - this.listener.x;
    const dy = y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const atten = clamp(1 - d / 1600, 0, 1);
    if (atten <= 0.01) return null;

    const g = ctx.createGain();
    g.gain.value = baseGain * atten * atten;
    let node = g;
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp(dx / 900, -0.85, 0.85);
      g.connect(pan);
      node = pan;
    }
    node.connect(this.sfxBus);
    return g;
  }

  noiseSource(duration, playbackRate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = playbackRate;
    src.loop = true;
    src.start(this.ctx.currentTime, Math.random() * 1.5);
    src.stop(this.ctx.currentTime + duration);
    return src;
  }

  budget() {
    if (!this.ready || !this.enabled) return false;
    if (this.voices > this.maxVoices) return false;
    this.voices++;
    setTimeout(() => { this.voices--; }, 320);
    return true;
  }

  // --- sound effects -------------------------------------------------------

  /** Crisp metallic hit: filtered noise transient plus a struck-metal ping. */
  impact({ x, y, power, damage }) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.5 * (0.35 + power));
    if (!out) return;

    const dur = 0.14 + power * 0.16;
    const noise = this.noiseSource(dur, 1 + power);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600 + Math.random() * 2200, t);
    bp.frequency.exponentialRampToValueAtTime(700 + Math.random() * 500, t + dur);
    bp.Q.value = 3.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
    noise.connect(bp).connect(ng).connect(out);

    // Two detuned partials give the "struck plate" character.
    const base = 320 + Math.random() * 620 - power * 120;
    for (const [mult, gain] of [[1, 0.5], [2.41, 0.26], [3.83, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(base * mult, t);
      o.frequency.exponentialRampToValueAtTime(base * mult * 0.82, t + dur * 1.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.6);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur * 1.7);
    }

    // Real damage adds a low thud underneath the tink.
    if (damage > 8) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(clamp(damage / 120, 0.1, 0.7), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.22);
    }
  }

  /** Deep bass explosion: sub sweep, filtered roar, transient crack. */
  explosion({ x, y, power = 1 }) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.95 * power);
    if (!out) return;

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, t);
    sub.frequency.exponentialRampToValueAtTime(26, t + 0.75);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(1.0, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
    sub.connect(sg).connect(out);
    sub.start(t); sub.stop(t + 0.9);

    const roar = this.noiseSource(0.9, 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 0.8);
    lp.Q.value = 1.2;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.85, t);
    rg.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    roar.connect(lp).connect(rg).connect(out);

    const crack = this.noiseSource(0.06, 2.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.7, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    crack.connect(hp).connect(cg).connect(out);
  }

  /** Structural failure: a short crunch of scraping grains. */
  breakage({ x, y, power = 0.5 }) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.5 * power);
    if (!out) return;
    for (let i = 0; i < 4; i++) {
      const at = t + i * (0.012 + Math.random() * 0.03);
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuffer;
      n.playbackRate.value = 0.6 + Math.random() * 1.4;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500 + Math.random() * 2500;
      bp.Q.value = 5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
      n.connect(bp).connect(g).connect(out);
      n.start(at, Math.random()); n.stop(at + 0.1);
    }
  }

  shot({ x, y, type }) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const heavy = type === 'shell';
    const out = this.place(x, y, heavy ? 0.75 : 0.34);
    if (!out) return;

    const o = ctx.createOscillator();
    o.type = heavy ? 'sawtooth' : 'square';
    const f0 = heavy ? 420 : 1150;
    const f1 = heavy ? 70 : 240;
    const dur = heavy ? 0.3 : 0.13;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(f0 * 1.4, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    bp.Q.value = 2.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(bp).connect(g).connect(out);
    o.start(t); o.stop(t + dur + 0.02);

    const click = this.noiseSource(0.05, 1.8);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(heavy ? 0.5 : 0.3, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    click.connect(cg).connect(out);
  }

  whoosh({ x, y }, power = 1) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.4 * power);
    if (!out) return;
    const n = this.noiseSource(0.34, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(320, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    bp.frequency.exponentialRampToValueAtTime(280, t + 0.34);
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.8, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    n.connect(bp).connect(g).connect(out);
  }

  charge({ x, y }) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.35);
    if (!out) return;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.55, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(lp).connect(g).connect(out);
    o.start(t); o.stop(t + 0.52);
  }

  alert({ body }) {
    if (!this.budget()) return;
    const t = this.ctx.currentTime;
    this.blipAt(body.pos.x, body.pos.y, 660, t, 0.07);
    this.blipAt(body.pos.x, body.pos.y, 880, t + 0.09, 0.07);
  }

  pickup() {
    if (!this.budget()) return;
    const t = this.ctx.currentTime;
    this.blip(1320, 0.05, 'triangle', t);
    this.blip(1760, 0.06, 'triangle', t + 0.05);
  }

  weldSound({ x, y }, power) {
    if (!this.budget()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this.place(x, y, 0.4 * power);
    if (!out) return;
    const n = this.noiseSource(0.16, 1.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.16);
    bp.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(bp).connect(g).connect(out);
    this.blip(power > 0.8 ? 1046 : 523, 0.07, 'square', t + 0.02);
  }

  blipAt(x, y, freq, when, dur = 0.06, type = 'square') {
    const ctx = this.ctx;
    const out = this.place(x, y, 0.3);
    if (!out) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    o.connect(g).connect(out);
    o.start(when); o.stop(when + dur + 0.01);
  }

  blip(freq, dur = 0.06, type = 'square', when = null) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.01);
  }

  // --- continuous thruster hum --------------------------------------------

  startThrusterVoice() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 62;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 31;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;

    this.thrustFilter = ctx.createBiquadFilter();
    this.thrustFilter.type = 'lowpass';
    this.thrustFilter.frequency.value = 220;
    this.thrustFilter.Q.value = 3.5;

    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;

    osc.connect(this.thrustFilter);
    sub.connect(this.thrustFilter);
    noise.connect(this.thrustFilter);
    this.thrustFilter.connect(this.thrustGain).connect(this.sfxBus);

    osc.start(t); sub.start(t); noise.start(t);
    this.thrustOsc = osc;
    this.thrustSub = sub;
  }

  /** Called every frame with the player's engine load and combat pressure. */
  update(dt, state) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    this.listener = state.listener || this.listener;

    // Engine hum tracks actual thruster activation and energy brownout.
    const load = clamp(state.thrust || 0, 0, 1);
    const target = load * 0.16;
    this.thrustGain.gain.setTargetAtTime(target, ctx.currentTime, 0.08);
    this.thrustFilter.frequency.setTargetAtTime(180 + load * 900, ctx.currentTime, 0.1);
    this.thrustOsc.frequency.setTargetAtTime(56 + load * 46 - (state.brownout || 0) * 18, ctx.currentTime, 0.15);

    this.combat += (clamp(state.combat || 0, 0, 1) - this.combat) * Math.min(1, dt * 1.2);
    this.musicBus.gain.setTargetAtTime(state.musicOn === false ? 0 : 0.3 + this.combat * 0.16, ctx.currentTime, 0.4);

    this.scheduleMusic();
  }

  // --- the sequencer -------------------------------------------------------

  /**
   * Lookahead scheduler. Every 16th note it decides what the arrangement should
   * be *right now* based on combat intensity: calm exploration is bass and pad
   * only; a fight adds drums, hats and a delayed arpeggio lead, and pushes the
   * filter open.
   */
  scheduleMusic() {
    const ctx = this.ctx;
    const secondsPerStep = (60 / (this.bpm + this.combat * 16)) / 4;
    while (this.nextNoteTime < ctx.currentTime + this.lookahead) {
      this.playStep(this.step, this.nextNoteTime);
      this.nextNoteTime += secondsPerStep;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, when) {
    const bar = Math.floor(step / 16) % PROGRESSION.length;
    const beat = step % 16;
    const chord = PROGRESSION[bar];
    const intensity = this.combat;

    // --- bass: driving 8ths, the constant of the genre ---
    if (beat % 2 === 0) {
      const note = chord.root + (beat === 8 ? 12 : 0) + (beat === 14 ? 7 : 0);
      this.synthNote({
        freq: midi(note), when, dur: 0.16,
        type: 'sawtooth', gain: 0.22 + intensity * 0.06,
        filterFrom: 380 + intensity * 900, filterTo: 160, q: 7,
      });
    }

    // --- pad: one long chord per bar ---
    if (beat === 0) {
      for (const n of chord.chord) {
        this.synthNote({
          freq: midi(n + 12), when, dur: (60 / this.bpm) * 3.6,
          type: 'sawtooth', gain: 0.045 + intensity * 0.02,
          filterFrom: 700 + intensity * 1400, filterTo: 500,
          attack: 0.35, q: 1.2, detune: 7,
        });
      }
    }

    // --- drums: only once things get dangerous ---
    if (intensity > 0.12) {
      if (beat === 0 || beat === 6 || beat === 10) this.kick(when, 0.5 + intensity * 0.5);
      if (beat === 4 || beat === 12) this.snare(when, 0.35 + intensity * 0.45);
      if (intensity > 0.4 && beat % 2 === 1) this.hat(when, 0.10 + intensity * 0.13);
    }

    // --- lead arpeggio: the "we are in trouble" layer ---
    if (intensity > 0.45 && beat % 2 === 0) {
      const idx = (step / 2) % 4;
      const n = chord.chord[idx % chord.chord.length] + 24 + (idx === 3 ? 3 : 0);
      const g = this.synthNote({
        freq: midi(n), when, dur: 0.12,
        type: 'square', gain: 0.06 * (intensity - 0.35),
        filterFrom: 3200, filterTo: 1400, q: 3,
        send: this.delay,
      });
      void g;
    }
  }

  synthNote({ freq, when, dur, type, gain, filterFrom, filterTo, q = 1, attack = 0.006, detune = 0, send = null }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (detune) o.detune.value = (Math.random() - 0.5) * detune * 2;

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(filterFrom, when);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, filterTo), when + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

    o.connect(f).connect(g).connect(this.musicBus);
    if (send) g.connect(send);
    o.start(when);
    o.stop(when + dur + 0.03);
    return g;
  }

  kick(when, amp) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp * 0.7, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.24);
    o.connect(g).connect(this.musicBus);
    o.start(when); o.stop(when + 0.26);
  }

  snare(when, amp) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.playbackRate.value = 1.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp * 0.32, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.17);
    n.connect(bp).connect(g).connect(this.musicBus);
    n.start(when, Math.random()); n.stop(when + 0.18);
  }

  hat(when, amp) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.playbackRate.value = 2.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp * 0.2, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    n.connect(hp).connect(g).connect(this.musicBus);
    n.start(when, Math.random()); n.stop(when + 0.06);
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }
}
