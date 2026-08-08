import { boxVerts, regularPoly, TAU } from '../core/math.js';

// Every object in the world -- player chassis, enemy hull, boulder, tree -- is
// built from these definitions. They are pure data: mass comes from density x
// area, center of gravity from the polygon centroid, durability from hp, and
// energy output from `energy` (positive supplies, negative draws). No system
// special-cases a specific part id; behaviour is dispatched off `kind`.

export const GRID = 26;   // snap spacing for assembly

/** An arrow-shaped nozzle so thrusters read directionally at a glance. */
function thrusterVerts() {
  return [
    { x: -13, y: -9 }, { x: 7, y: -11 }, { x: 13, y: -5 },
    { x: 13, y: 5 }, { x: 7, y: 11 }, { x: -13, y: 9 },
  ];
}

function bladeVerts() {
  return [
    { x: -13, y: -7 }, { x: 6, y: -9 }, { x: 26, y: -2 },
    { x: 26, y: 2 }, { x: 6, y: 9 }, { x: -13, y: 7 },
  ];
}

function cannonVerts() {
  return [
    { x: -15, y: -10 }, { x: 4, y: -10 }, { x: 20, y: -5 },
    { x: 20, y: 5 }, { x: 4, y: 10 }, { x: -15, y: 10 },
  ];
}

const defs = {
  // --- structural -------------------------------------------------------
  core: {
    name: 'Omni Core', kind: 'core', verts: regularPoly(17, 8, TAU / 16),
    density: 0.0016, hp: 320, weldHp: 260, energy: 7,
    color: '#39e6ff', accent: '#c9fbff', glow: 0.9,
    desc: 'Command module. Supplies energy. Lose every core and the machine dies.',
  },
  plate: {
    name: 'Armor Plate', kind: 'plate', verts: boxVerts(26, 26),
    density: 0.0019, hp: 220, weldHp: 210, energy: 0,
    color: '#6b7a99', accent: '#aebbd4', glow: 0,
    desc: 'Cheap mass. Soaks hits and adds inertia to a ram.',
  },
  strut: {
    name: 'Strut', kind: 'plate', verts: boxVerts(34, 12),
    density: 0.0011, hp: 120, weldHp: 150, energy: 0,
    color: '#556077', accent: '#96a3bd', glow: 0,
    desc: 'Light spacer. Extends reach without much mass.',
  },
  battery: {
    name: 'Battery', kind: 'battery', verts: boxVerts(22, 18),
    density: 0.0026, hp: 130, weldHp: 170, energy: 16,
    color: '#f2b03d', accent: '#ffe8a8', glow: 0.6,
    desc: 'Raises energy capacity and recharge. Explodes when destroyed.',
    explodeOnDeath: { radius: 120, force: 260, damage: 55 },
  },

  // --- propulsion -------------------------------------------------------
  thruster: {
    name: 'Thruster', kind: 'thruster', verts: thrusterVerts(),
    density: 0.0012, hp: 110, weldHp: 140, energy: -9,
    color: '#8e6bd8', accent: '#e0cfff', glow: 0.5,
    force: 5200, desc: 'Pushes along its nose. Off-center mounts create torque.',
  },
  wheel: {
    name: 'Drive Wheel', kind: 'wheel', verts: regularPoly(13, 10),
    density: 0.0018, hp: 150, weldHp: 160, energy: -2.5,
    color: '#3a4051', accent: '#7de08a', glow: 0.2,
    force: 4200, grip: 12, desc: 'Ground traction. Fast and cheap, useless over a void.',
  },
  floatcore: {
    name: 'Float Core', kind: 'floatcore', verts: regularPoly(14, 6),
    density: 0.0008, hp: 95, weldHp: 120, energy: -11,
    color: '#4fd6a0', accent: '#d5fff0', glow: 0.85,
    lift: 1, desc: 'Antigravity field. Carries the whole assembly over chasms.',
  },

  // --- weapons ----------------------------------------------------------
  blade: {
    name: 'Blade', kind: 'blade', verts: bladeVerts(),
    density: 0.0021, hp: 190, weldHp: 175, energy: -0.5,
    color: '#c9d4e8', accent: '#ff5f7e', glow: 0.35,
    damage: 30, desc: 'Contact weapon. Damage scales with impact speed and mass.',
  },
  cannon: {
    name: 'Cannon', kind: 'cannon', verts: cannonVerts(),
    density: 0.0022, hp: 160, weldHp: 165, energy: -7,
    color: '#4a5468', accent: '#ffc46b', glow: 0.4,
    fireRate: 0.17, projectile: 'bolt', recoil: 240,
    desc: 'Fires energy bolts along its barrel. Recoil is real -- brace it.',
  },
  mortar: {
    name: 'Mortar', kind: 'cannon', verts: boxVerts(24, 24),
    density: 0.0028, hp: 200, weldHp: 180, energy: -14,
    color: '#5d4a3a', accent: '#ff8a3d', glow: 0.5,
    fireRate: 1.15, projectile: 'shell', recoil: 1400,
    desc: 'Slow explosive shell. The recoil alone will spin a light frame.',
  },

  // --- world materials --------------------------------------------------
  rock: {
    name: 'Rock', kind: 'rock', verts: regularPoly(24, 7),
    density: 0.0034, hp: 300, weldHp: 240, energy: 0,
    color: '#5f646e', accent: '#a8b0bd', glow: 0,
    salvage: ['plate', 'plate', 'strut'],
  },
  crystal: {
    name: 'Crystal', kind: 'crystal', verts: regularPoly(17, 5, 0.4),
    density: 0.0012, hp: 110, weldHp: 90, energy: 0,
    color: '#5aa9ff', accent: '#cfe8ff', glow: 1,
    salvage: ['battery', 'thruster', 'floatcore'],
  },
  timber: {
    name: 'Timber', kind: 'timber', verts: regularPoly(15, 6),
    density: 0.0009, hp: 90, weldHp: 70, energy: 0,
    color: '#4f7a48', accent: '#93c98a', glow: 0,
    salvage: ['strut', 'wheel'],
  },
  scrapHull: {
    name: 'Wreck Hull', kind: 'plate', verts: boxVerts(30, 22),
    density: 0.0022, hp: 260, weldHp: 200, energy: 0,
    color: '#7d5a4a', accent: '#c69b83', glow: 0,
    salvage: ['plate', 'cannon', 'blade'],
  },
};

// Precompute the derived fields every system reads.
for (const [id, d] of Object.entries(defs)) {
  d.id = id;
  d.glow = d.glow ?? 0;
  d.salvage = d.salvage ?? null;
  let maxX = -Infinity, maxY = -Infinity, minX = Infinity, minY = Infinity;
  for (const v of d.verts) {
    maxX = Math.max(maxX, v.x); minX = Math.min(minX, v.x);
    maxY = Math.max(maxY, v.y); minY = Math.min(minY, v.y);
  }
  d.extents = { x: (maxX - minX) / 2, y: (maxY - minY) / 2 };
  d.reach = Math.hypot(d.extents.x, d.extents.y);
}

export const PARTS = defs;

/** Parts the player can hold in inventory and weld onto a structure. */
export const BUILDABLE = ['plate', 'strut', 'thruster', 'wheel', 'blade', 'cannon', 'battery', 'floatcore', 'mortar', 'core'];

/** Weld durability between two parts -- the weaker material governs. */
export function weldStrength(defA, defB) {
  return Math.min(defA.weldHp, defB.weldHp) * 0.85 + Math.abs(defA.weldHp - defB.weldHp) * 0.15;
}

export function partDef(id) {
  const d = defs[id];
  if (!d) throw new Error(`unknown part: ${id}`);
  return d;
}
