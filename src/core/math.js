// Small 2D math library. Vectors are plain {x, y} objects; hot loops inline the
// arithmetic directly rather than calling through these helpers.

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const smoothstep = (t) => t * t * (3 - 2 * t);

export const vec = (x = 0, y = 0) => ({ x, y });
export const clone = (v) => ({ x: v.x, y: v.y });

export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;

// 2D "cross products": vector x vector yields a scalar, scalar x vector rotates.
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const crossSV = (s, v) => ({ x: -s * v.y, y: s * v.x });
export const crossVS = (v, s) => ({ x: s * v.y, y: -s * v.x });

export const lenSq = (v) => v.x * v.x + v.y * v.y;
export const len = (v) => Math.hypot(v.x, v.y);
export const distSq = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const perp = (v) => ({ x: -v.y, y: v.x });

export function norm(v) {
  const l = Math.hypot(v.x, v.y);
  return l < EPS ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

export function rot(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export const fromAngle = (a, m = 1) => ({ x: Math.cos(a) * m, y: Math.sin(a) * m });
export const angleOf = (v) => Math.atan2(v.y, v.x);

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed rotation taking angle `from` to angle `to`. */
export const angleDiff = (from, to) => wrapAngle(to - from);

/** Framerate-independent exponential approach. `rate` is the halving speed. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

/** Move `a` toward `b` by at most `step`. */
export function approach(a, b, step) {
  const d = b - a;
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

/** Area and centroid of a convex polygon given in CCW order. */
export function polyMassData(verts, density) {
  let area = 0, cx = 0, cy = 0, inertia = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const p0 = verts[i], p1 = verts[(i + 1) % n];
    const c = p0.x * p1.y - p1.x * p0.y;
    area += c;
    cx += (p0.x + p1.x) * c;
    cy += (p0.y + p1.y) * c;
    const intx = p0.x * p0.x + p1.x * p0.x + p1.x * p1.x;
    const inty = p0.y * p0.y + p1.y * p0.y + p1.y * p1.y;
    inertia += c * (intx + inty);
  }
  area *= 0.5;
  const invA6 = 1 / (6 * area);
  const centroid = { x: cx * invA6, y: cy * invA6 };
  const mass = Math.abs(area) * density;
  // Parallel-axis shift from the origin to the centroid.
  const I = Math.abs(inertia) * density / 12 - mass * lenSq(centroid);
  return { mass, centroid, inertia: Math.max(I, 1e-4) };
}

export function boxVerts(w, h) {
  const hw = w / 2, hh = h / 2;
  return [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
}

export function regularPoly(radius, sides, phase = 0) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * TAU;
    out.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return out;
}
