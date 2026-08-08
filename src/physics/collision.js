// Convex polygon collision: separating-axis test for the normal and depth, then
// reference/incident face clipping for a proper two-point manifold. Two points
// is what stops a welded chassis from wobbling when it grinds along a canyon
// wall, which matters a lot when the whole game is stacked physics assemblies.

const MAX_MANIFOLD_POINTS = 2;

/** Deepest separation of B from A across all of A's face normals. */
function maxSeparation(partA, partB) {
  let bestSep = -Infinity;
  let bestIndex = 0;
  const nA = partA.worldVerts.length;
  const bVerts = partB.worldVerts;

  for (let i = 0; i < nA; i++) {
    const n = partA.worldNormals[i];
    const v = partA.worldVerts[i];
    // Support point of B in the -n direction.
    let minProj = Infinity;
    for (let j = 0; j < bVerts.length; j++) {
      const proj = bVerts[j].x * n.x + bVerts[j].y * n.y;
      if (proj < minProj) minProj = proj;
    }
    const sep = minProj - (v.x * n.x + v.y * n.y);
    if (sep > bestSep) { bestSep = sep; bestIndex = i; }
    if (bestSep > 0) break;   // early out: found a separating axis
  }
  return { sep: bestSep, index: bestIndex };
}

/** The face of `inc` most anti-parallel to the reference normal. */
function incidentFace(inc, refNormal) {
  let minDot = Infinity;
  let index = 0;
  for (let i = 0; i < inc.worldNormals.length; i++) {
    const d = inc.worldNormals[i].x * refNormal.x + inc.worldNormals[i].y * refNormal.y;
    if (d < minDot) { minDot = d; index = i; }
  }
  const n = inc.worldVerts.length;
  return [
    { x: inc.worldVerts[index].x, y: inc.worldVerts[index].y },
    { x: inc.worldVerts[(index + 1) % n].x, y: inc.worldVerts[(index + 1) % n].y },
  ];
}

/** Clip a segment against the half-space dot(n, p) <= offset. */
function clipSegment(face, n, offset) {
  const out = [];
  const d0 = n.x * face[0].x + n.y * face[0].y - offset;
  const d1 = n.x * face[1].x + n.y * face[1].y - offset;
  if (d0 <= 0) out.push(face[0]);
  if (d1 <= 0) out.push(face[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({
      x: face[0].x + t * (face[1].x - face[0].x),
      y: face[0].y + t * (face[1].y - face[0].y),
    });
  }
  return out;
}

/**
 * Build a contact manifold between two parts, or return null if they are apart.
 * The returned normal always points from A toward B.
 */
export function collideParts(bodyA, partA, bodyB, partB) {
  // Cheap radius reject before the full SAT.
  const dx = partB.wpos.x - partA.wpos.x;
  const dy = partB.wpos.y - partA.wpos.y;
  const rr = partA.radius + partB.radius;
  if (dx * dx + dy * dy > rr * rr) return null;

  const a = maxSeparation(partA, partB);
  if (a.sep > 0) return null;
  const b = maxSeparation(partB, partA);
  if (b.sep > 0) return null;

  // Prefer A as reference unless B is meaningfully deeper (hysteresis avoids
  // flip-flopping between frames on near-parallel faces).
  let refPart, incPart, refIndex, flip;
  if (b.sep > a.sep + 0.05) {
    refPart = partB; incPart = partA; refIndex = b.index; flip = true;
  } else {
    refPart = partA; incPart = partB; refIndex = a.index; flip = false;
  }

  const refNormal = refPart.worldNormals[refIndex];
  const rn = refPart.worldVerts.length;
  const v1 = refPart.worldVerts[refIndex];
  const v2 = refPart.worldVerts[(refIndex + 1) % rn];

  // Reference face tangent, used for the two side planes.
  let tx = v2.x - v1.x, ty = v2.y - v1.y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl; ty /= tl;

  let face = incidentFace(incPart, refNormal);
  face = clipSegment(face, { x: -tx, y: -ty }, -(tx * v1.x + ty * v1.y));
  if (face.length < 2) return null;
  face = clipSegment(face, { x: tx, y: ty }, tx * v2.x + ty * v2.y);
  if (face.length < 2) return null;

  const refOffset = refNormal.x * v1.x + refNormal.y * v1.y;
  const points = [];
  let maxPen = 0;
  for (const p of face) {
    const sep = refNormal.x * p.x + refNormal.y * p.y - refOffset;
    if (sep <= 0.001) {
      points.push({ x: p.x, y: p.y, penetration: -sep, normalImpulse: 0, tangentImpulse: 0 });
      if (-sep > maxPen) maxPen = -sep;
    }
    if (points.length >= MAX_MANIFOLD_POINTS) break;
  }
  if (points.length === 0) return null;

  // Normalise the outward direction to always run A -> B.
  const normal = flip
    ? { x: -refNormal.x, y: -refNormal.y }
    : { x: refNormal.x, y: refNormal.y };

  return { bodyA, partA, bodyB, partB, normal, points, penetration: maxPen };
}

/** Point-in-convex-polygon test against a part's cached world vertices. */
export function pointInPart(part, x, y) {
  const n = part.worldVerts.length;
  for (let i = 0; i < n; i++) {
    const v = part.worldVerts[i];
    const nm = part.worldNormals[i];
    if ((x - v.x) * nm.x + (y - v.y) * nm.y > 0) return false;
  }
  return true;
}

/**
 * Segment vs convex polygon (slab clipping). Returns the entry fraction along
 * the segment, or -1. Used by projectiles and by AI line-of-sight.
 */
export function segmentPart(part, x0, y0, x1, y1) {
  let lo = 0, hi = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const n = part.worldVerts.length;
  for (let i = 0; i < n; i++) {
    const v = part.worldVerts[i];
    const nm = part.worldNormals[i];
    const denom = nm.x * dx + nm.y * dy;
    const numer = nm.x * (v.x - x0) + nm.y * (v.y - y0);
    if (Math.abs(denom) < 1e-9) {
      if (numer < 0) return -1;   // parallel and outside
      continue;
    }
    const t = numer / denom;
    if (denom > 0) { if (t < hi) hi = t; }
    else { if (t > lo) lo = t; }
    if (lo > hi) return -1;
  }
  return lo;
}

export function aabbOverlap(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}
