// Blueprints are just part lists in body-local coordinates. The player's
// starting chassis and every enemy archetype use the same format and the same
// constructor, which is what makes an enemy hull salvageable and a player build
// destructible under identical rules.

/** Mirror a set of entries across the X axis (y -> -y, angle -> -angle). */
function mirrorY(entries) {
  return entries.flatMap((e) => [
    e,
    { ...e, y: -(e.y || 0), angle: -(e.angle || 0) },
  ]);
}

export const PLAYER_CHASSIS = [
  { part: 'core', x: 0, y: 0 },
  { part: 'plate', x: -28, y: 0 },
  ...mirrorY([{ part: 'thruster', x: -54, y: 12, angle: 0 }]),
  ...mirrorY([{ part: 'wheel', x: 0, y: 28 }]),
  ...mirrorY([{ part: 'battery', x: -28, y: 25 }]),
  { part: 'cannon', x: 33, y: 0 },
];

/**
 * Enemy archetypes. `ai` tunes the shared behaviour tree rather than replacing
 * it -- a Lancer and a Bruiser run the identical tree with different numbers.
 */
export const ENEMIES = {
  skitter: {
    name: 'Skitter',
    threat: 1,
    hue: 12,
    blueprint: [
      { part: 'core', x: 0, y: 0 },
      ...mirrorY([{ part: 'wheel', x: 0, y: 28 }]),
      { part: 'blade', x: 35, y: 0 },
      { part: 'thruster', x: -30, y: 0 },
    ],
    ai: {
      sightRange: 900, engageRange: 60, preferredRange: 40,
      aggression: 1.1, flankBias: 0.25, fleeIntegrity: 0.3, speed: 1.15,
    },
  },

  lancer: {
    name: 'Lancer',
    threat: 2,
    hue: 300,
    blueprint: [
      { part: 'core', x: 0, y: 0 },
      { part: 'plate', x: -28, y: 0 },
      ...mirrorY([{ part: 'thruster', x: -54, y: 12 }]),
      ...mirrorY([{ part: 'strut', x: 0, y: 28, angle: Math.PI / 2 }]),
      ...mirrorY([{ part: 'cannon', x: 32, y: 28 }]),
      { part: 'battery', x: -28, y: -25 },
    ],
    ai: {
      sightRange: 1150, engageRange: 520, preferredRange: 400,
      aggression: 0.7, flankBias: 0.75, fleeIntegrity: 0.4, speed: 1.0,
    },
  },

  bruiser: {
    name: 'Bruiser',
    threat: 3,
    hue: 30,
    blueprint: [
      { part: 'core', x: 0, y: 0 },
      { part: 'plate', x: -28, y: 0 },
      ...mirrorY([{ part: 'plate', x: 0, y: 28 }]),
      ...mirrorY([{ part: 'plate', x: 28, y: 28 }]),
      ...mirrorY([{ part: 'blade', x: 52, y: 28 }]),
      ...mirrorY([{ part: 'wheel', x: -28, y: 28 }]),
      ...mirrorY([{ part: 'thruster', x: -54, y: 12 }]),
      { part: 'battery', x: -28, y: -25, angle: Math.PI / 2 },
      { part: 'mortar', x: 32, y: 0 },
    ],
    ai: {
      sightRange: 1000, engageRange: 300, preferredRange: 90,
      aggression: 1.0, flankBias: 0.1, fleeIntegrity: 0.22, speed: 0.85,
      throwsBoulders: true,
    },
  },

  colossus: {
    name: 'COLOSSUS',
    threat: 8,
    hue: 350,
    boss: true,
    blueprint: [
      { part: 'core', x: 0, y: 0 },
      ...mirrorY([{ part: 'core', x: 0, y: 34 }]),
      ...mirrorY([{ part: 'plate', x: 28, y: 17 }]),
      ...mirrorY([{ part: 'plate', x: -28, y: 17 }]),
      ...mirrorY([{ part: 'plate', x: 56, y: 17 }]),
      ...mirrorY([{ part: 'plate', x: -56, y: 17 }]),
      ...mirrorY([{ part: 'plate', x: 28, y: 60 }]),
      ...mirrorY([{ part: 'plate', x: -28, y: 60 }]),
      ...mirrorY([{ part: 'blade', x: 82, y: 17 }]),
      ...mirrorY([{ part: 'cannon', x: 52, y: 60 }]),
      ...mirrorY([{ part: 'thruster', x: -82, y: 17 }]),
      ...mirrorY([{ part: 'thruster', x: -54, y: 60 }]),
      ...mirrorY([{ part: 'wheel', x: 0, y: 88 }]),
      ...mirrorY([{ part: 'battery', x: -28, y: -8, angle: Math.PI / 2 }]),
      { part: 'mortar', x: 56, y: 0 },
      { part: 'floatcore', x: -28, y: 0 },
    ],
    ai: {
      sightRange: 1600, engageRange: 620, preferredRange: 260,
      aggression: 1.3, flankBias: 0.35, fleeIntegrity: 0, speed: 0.8,
      throwsBoulders: true, salvo: true,
    },
  },
};

/** Abandoned machines scattered in the world -- free parts if you break them. */
export const WRECKS = [
  [
    { part: 'scrapHull', x: 0, y: 0 },
    { part: 'wheel', x: 0, y: 26 },
    { part: 'plate', x: 30, y: 0 },
  ],
  [
    { part: 'scrapHull', x: 0, y: 0 },
    { part: 'scrapHull', x: 32, y: 0 },
    { part: 'thruster', x: -28, y: 0 },
    { part: 'plate', x: 32, y: 24 },
  ],
  [
    { part: 'scrapHull', x: 0, y: 0 },
    { part: 'cannon', x: 32, y: 0 },
    { part: 'battery', x: 0, y: 22 },
  ],
];
