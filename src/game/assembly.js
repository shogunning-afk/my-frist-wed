import { Body, Part } from '../physics/body.js';
import { PARTS, weldStrength, partDef } from './parts.js';

// The "Omni" assembly system. Attaching a part is a physical act: it changes
// the body's mass, its center of gravity and its rotational inertia, and it
// creates welds with finite durability that combat can later chew through.
// Nothing about a built machine is scripted -- how it drives falls out of where
// the player happened to bolt the thrusters.

const CARDINALS = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];

/** Half-width of a part's bounding box measured along a unit direction. */
export function obbSupport(def, angle, dir) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const ux = c, uy = s;         // part local +X in body space
  const vx = -s, vy = c;        // part local +Y in body space
  return def.extents.x * Math.abs(dir.x * ux + dir.y * uy)
       + def.extents.y * Math.abs(dir.x * vx + dir.y * vy);
}

/** True when two placed parts sit close enough to be welded together. */
function touching(defA, angA, posA, defB, angB, posB, tolerance = 6) {
  const dx = posB.x - posA.x, dy = posB.y - posA.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-4) return true;
  const dir = { x: dx / d, y: dy / d };
  const gap = d - obbSupport(defA, angA, dir) - obbSupport(defB, angB, dir);
  return gap < tolerance;
}

/** Weld a part to every neighbour it physically abuts. */
export function weldToNeighbours(body, part) {
  let count = 0;
  for (const other of body.parts) {
    if (other === part) continue;
    if (touching(part.def, part.angle, part.pos, other.def, other.angle, other.pos)) {
      body.weld(part.id, other.id, weldStrength(part.def, other.def));
      count++;
    }
  }
  return count;
}

/** Rebuild the full weld graph from part adjacency. Used after construction. */
export function autoWeld(body) {
  body.welds.length = 0;
  for (let i = 0; i < body.parts.length; i++) {
    for (let j = i + 1; j < body.parts.length; j++) {
      const a = body.parts[i], b = body.parts[j];
      if (touching(a.def, a.angle, a.pos, b.def, b.angle, b.pos)) {
        body.weld(a.id, b.id, weldStrength(a.def, b.def));
      }
    }
  }
}

/**
 * Candidate mounting points around the existing structure: for every part, the
 * four positions where a new part of the given def would sit flush against it.
 * Occupied slots are discarded, so the player cannot bury parts inside a hull.
 */
export function snapCandidates(body, def, newAngle) {
  const out = [];
  for (const host of body.parts) {
    for (const dir of CARDINALS) {
      // Rotate the cardinal into the host part's own frame so slots follow a
      // part that was mounted at an angle.
      const c = Math.cos(host.angle), s = Math.sin(host.angle);
      const d = { x: dir.x * c - dir.y * s, y: dir.x * s + dir.y * c };
      const reach = obbSupport(host.def, host.angle, d) + obbSupport(def, newAngle, d);
      const pos = { x: host.pos.x + d.x * reach, y: host.pos.y + d.y * reach };

      let blocked = false;
      for (const other of body.parts) {
        const dx = other.pos.x - pos.x, dy = other.pos.y - pos.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 1e-4) { blocked = true; break; }
        const nd = { x: dx / dd, y: dy / dd };
        // Overlap (rather than mere contact) means the slot is taken.
        if (dd - obbSupport(def, newAngle, nd) - obbSupport(other.def, other.angle, nd) < -3.5) {
          blocked = true; break;
        }
      }
      if (!blocked) out.push({ pos, host });
    }
  }
  return out;
}

/**
 * Best placement for `def` on `body` given a world-space cursor.
 * Returns null when the cursor is too far from any valid slot.
 */
export function findSnap(body, def, worldPoint, newAngle, maxDist = 90) {
  const local = body.worldToLocal(worldPoint.x, worldPoint.y);
  const cands = snapCandidates(body, def, newAngle);
  let best = null, bestD = maxDist * maxDist;
  for (const c of cands) {
    const dx = c.pos.x - local.x, dy = c.pos.y - local.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) { bestD = d2; best = c; }
  }
  if (!best) return null;
  return { localPos: best.pos, localAngle: newAngle, host: best.host };
}

/** Commit a snapped placement. Returns the new Part. */
export function attachPart(body, def, localPos, localAngle) {
  const part = new Part(def, localPos, localAngle);
  body.addPart(part);
  const n = weldToNeighbours(body, part);
  if (n === 0) {
    // Nothing to bond to -- refuse rather than leave a floating part that would
    // instantly split off on the next structure check.
    body.parts.pop();
    return null;
  }
  body.recompute();
  body.updateTransforms();
  return part;
}

/** Detach a part by hand (build mode). The body may split as a result. */
export function detachPart(body, part) {
  const i = body.parts.indexOf(part);
  if (i < 0) return false;
  if (body.parts.length === 1) return false;
  body.parts.splice(i, 1);
  body.welds = body.welds.filter((w) => w.a !== part.id && w.b !== part.id);
  body.structureDirty = true;
  body.needsStructureCheck = true;
  body.recompute();
  body.updateTransforms();
  return true;
}

/**
 * Instantiate a blueprint: a list of {part, x, y, angle} entries in body-local
 * units. Enemies, props and the player's starting chassis all come from these,
 * which is why an enemy falls apart under fire exactly like a player build.
 */
export function buildFromBlueprint(blueprint, opts = {}) {
  const body = new Body(opts);
  for (const entry of blueprint) {
    const def = typeof entry.part === 'string' ? partDef(entry.part) : entry.part;
    body.addPart(new Part(def, { x: entry.x || 0, y: entry.y || 0 }, entry.angle || 0));
  }
  autoWeld(body);
  body.recompute();
  body.originalPartCount = body.parts.length;
  body.energy = body.energyMax;
  body.updateTransforms();
  return body;
}

/** Single-part body: boulders, trees, crystals, loose debris. */
export function makeProp(partId, x, y, angle = 0, scale = 1, opts = {}) {
  const def = PARTS[partId];
  const scaled = scale === 1 ? def : {
    ...def,
    verts: def.verts.map((v) => ({ x: v.x * scale, y: v.y * scale })),
    hp: def.hp * scale * scale,
    extents: { x: def.extents.x * scale, y: def.extents.y * scale },
    reach: def.reach * scale,
  };
  const body = new Body({
    x, y, angle, tag: 'prop',
    linearDamping: opts.linearDamping ?? 3.4,
    angularDamping: opts.angularDamping ?? 4.2,
    friction: 0.6,
    ...opts,
  });
  body.addPart(new Part(scaled, { x: 0, y: 0 }, 0));
  body.recompute();
  body.originalPartCount = 1;
  body.updateTransforms();
  return body;
}
