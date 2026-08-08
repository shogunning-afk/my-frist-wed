import { makeRng, hash2, fbm, ridge } from '../core/rng.js';
import { makeProp, buildFromBlueprint } from '../game/assembly.js';
import { WRECKS } from '../game/blueprints.js';

export const CHUNK = 1024;
const TILE = 16;               // terrain paint resolution
const SAFE_RADIUS = 760;       // spawn area is always walkable

/**
 * Biomes are pure data. Each one shifts how much of the ground is missing, what
 * grows on it, and which machines patrol it -- generation code below is shared.
 */
export const BIOMES = {
  plains: {
    name: 'Verdant Flats',
    ground: [38, 54, 44], ground2: [64, 88, 64], rim: '#7fe3a0',
    voidThreshold: 0.17, chasm: 0.93,
    props: [['timber', 3], ['rock', 2], ['crystal', 0.4]],
    density: 22, enemies: [['skitter', 3], ['lancer', 1]], enemyCount: [1, 3],
  },
  canyon: {
    name: 'Rust Canyons',
    ground: [56, 40, 32], ground2: [108, 78, 56], rim: '#ffb27a',
    voidThreshold: 0.26, chasm: 0.80,
    props: [['rock', 6], ['timber', 0.5]],
    density: 30, enemies: [['skitter', 2], ['bruiser', 2], ['lancer', 1]], enemyCount: [2, 4],
  },
  floating: {
    name: 'Drift Isles',
    ground: [32, 40, 72], ground2: [66, 82, 126], rim: '#8fb6ff',
    voidThreshold: 0.50, chasm: 0.99,
    props: [['crystal', 4], ['rock', 2]],
    density: 18, enemies: [['lancer', 3], ['skitter', 1]], enemyCount: [1, 3],
  },
  ashpits: {
    name: 'Cinder Pits',
    ground: [34, 30, 34], ground2: [76, 62, 62], rim: '#ff8a5c',
    voidThreshold: 0.33, chasm: 0.86,
    props: [['rock', 4], ['scrapHull', 1]],
    density: 26, enemies: [['bruiser', 3], ['lancer', 2], ['skitter', 1]], enemyCount: [2, 5],
  },
  crystal: {
    name: 'Shardlands',
    ground: [40, 34, 66], ground2: [86, 70, 122], rim: '#c9a6ff',
    voidThreshold: 0.22, chasm: 0.88,
    props: [['crystal', 7], ['rock', 1]],
    density: 28, enemies: [['lancer', 2], ['skitter', 2], ['bruiser', 1]], enemyCount: [2, 4],
  },
};

const BIOME_ORDER = ['plains', 'canyon', 'crystal', 'floating', 'ashpits'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pickWeighted(list, r) {
  let total = 0;
  for (const [, w] of list) total += w;
  let t = r * total;
  for (const [item, w] of list) {
    t -= w;
    if (t <= 0) return item;
  }
  return list[list.length - 1][0];
}

/**
 * Streaming procedural world. Chunks generate on demand around the player and
 * unload behind them; everything derives from the run seed so revisiting a
 * canyon gives you back the same canyon.
 */
export class WorldGen {
  constructor(seed, physics, bus) {
    this.seed = seed >>> 0;
    this.physics = physics;
    this.bus = bus;
    this.chunks = new Map();
    this.loadRadius = 2;
    this.unloadRadius = 3;
    this.bossChunks = new Set();
  }

  key(cx, cy) { return `${cx},${cy}`; }

  biomeAt(x, y) {
    const n = fbm(x / 5600, y / 5600, this.seed + 4177, 3);
    const idx = Math.min(BIOME_ORDER.length - 1, Math.floor(n * BIOME_ORDER.length * 1.0001));
    return BIOMES[BIOME_ORDER[idx]];
  }

  biomeNameAt(x, y) {
    const n = fbm(x / 5600, y / 5600, this.seed + 4177, 3);
    const idx = Math.min(BIOME_ORDER.length - 1, Math.floor(n * BIOME_ORDER.length * 1.0001));
    return BIOME_ORDER[idx];
  }

  /**
   * Is there ground here? Two fields combine: a broad "landmass" field that
   * carves out the big voids, and a ridged field that cuts narrow chasms across
   * them. Wheels need this; anything without a float core falls through it.
   */
  isSolid(x, y) {
    if (x * x + y * y < SAFE_RADIUS * SAFE_RADIUS) return true;
    const b = this.biomeAt(x, y);
    const land = fbm(x / 1500, y / 1500, this.seed + 17, 4);
    if (land < b.voidThreshold) return false;
    const cut = ridge(x / 1100, y / 1100, this.seed + 991, 3);
    if (cut > b.chasm) return false;
    return true;
  }

  /** How far into the void a point is, 0 at the edge. Drives the fall effect. */
  voidDepth(x, y) {
    const b = this.biomeAt(x, y);
    const land = fbm(x / 1500, y / 1500, this.seed + 17, 4);
    return Math.max(0, b.voidThreshold - land) * 4;
  }

  /** Difficulty scales with distance from the origin. */
  threatAt(x, y) {
    return 1 + Math.min(4, Math.hypot(x, y) / 4200);
  }

  update(px, py) {
    const pcx = Math.floor(px / CHUNK), pcy = Math.floor(py / CHUNK);
    for (let dx = -this.loadRadius; dx <= this.loadRadius; dx++) {
      for (let dy = -this.loadRadius; dy <= this.loadRadius; dy++) {
        const k = this.key(pcx + dx, pcy + dy);
        if (!this.chunks.has(k)) this.generateChunk(pcx + dx, pcy + dy);
      }
    }
    for (const [k, chunk] of this.chunks) {
      if (Math.abs(chunk.cx - pcx) > this.unloadRadius || Math.abs(chunk.cy - pcy) > this.unloadRadius) {
        this.unloadChunk(k, chunk);
      }
    }
  }

  unloadChunk(key, chunk) {
    for (const b of chunk.bodies) {
      // Anything the player has welded onto, damaged or dragged out of place is
      // left alone -- unloading it would erase the mark they left on the world.
      if (b.dead) continue;
      if (b.touched) continue;
      b.dead = true;
    }
    this.chunks.delete(key);
    this.bus.emit('chunk:unloaded', chunk);
  }

  generateChunk(cx, cy) {
    const k = this.key(cx, cy);
    const rng = makeRng((hash2(cx, cy, this.seed) * 4294967296) >>> 0);
    const ox = cx * CHUNK, oy = cy * CHUNK;
    const biomeName = this.biomeNameAt(ox + CHUNK / 2, oy + CHUNK / 2);
    const biome = BIOMES[biomeName];

    const chunk = {
      cx, cy, key: k, ox, oy,
      biome, biomeName,
      bodies: [],
      canvas: null,
      spawns: [],
    };
    this.chunks.set(k, chunk);

    this.paintChunk(chunk);

    // --- props ------------------------------------------------------------
    const count = Math.floor(biome.density * (0.6 + rng() * 0.8));
    for (let i = 0; i < count; i++) {
      const x = ox + rng() * CHUNK;
      const y = oy + rng() * CHUNK;
      if (!this.isSolid(x, y)) continue;
      if (x * x + y * y < 340 * 340) continue;   // keep the spawn pad clear
      const partId = pickWeighted(biome.props, rng());
      const scale = partId === 'rock' ? 0.7 + rng() * 1.5
        : partId === 'crystal' ? 0.6 + rng() * 0.9
          : 0.8 + rng() * 0.6;
      const body = makeProp(partId, x, y, rng() * Math.PI * 2, scale, {
        // Big rocks are heavy enough to be cover; small ones can be shoved
        // around or picked up and thrown by a Bruiser.
        linearDamping: 3.6, angularDamping: 4.6,
      });
      body.chunkKey = k;
      chunk.bodies.push(body);
      this.physics.add(body);
    }

    // --- wrecks: free salvage, and cover ----------------------------------
    if (rng() < 0.28) {
      const x = ox + rng() * CHUNK, y = oy + rng() * CHUNK;
      if (this.isSolid(x, y) && (x * x + y * y) > 500 * 500) {
        const bp = WRECKS[rng.int(0, WRECKS.length - 1)];
        const wreck = buildFromBlueprint(bp, {
          x, y, angle: rng() * Math.PI * 2, tag: 'prop',
          linearDamping: 3.2, angularDamping: 4.0,
        });
        wreck.chunkKey = k;
        chunk.bodies.push(wreck);
        this.physics.add(wreck);
      }
    }

    // --- enemy spawn descriptors -----------------------------------------
    const threat = this.threatAt(ox + CHUNK / 2, oy + CHUNK / 2);
    const [lo, hi] = biome.enemyCount;
    let n = rng.int(lo, hi) + Math.floor(threat - 1);
    // The chunk you start in stays quiet so the first thirty seconds are yours.
    if (Math.abs(cx) <= 0 && Math.abs(cy) <= 0) n = 0;

    for (let i = 0; i < n; i++) {
      const x = ox + rng() * CHUNK, y = oy + rng() * CHUNK;
      if (!this.isSolid(x, y)) continue;
      if (x * x + y * y < 900 * 900) continue;
      chunk.spawns.push({ type: pickWeighted(biome.enemies, rng()), x, y });
    }

    // A boss holds a rare arena chunk, far enough out that you meet it prepared.
    const far = Math.hypot(cx, cy) >= 3;
    if (far && hash2(cx, cy, this.seed + 5150) < 0.09 && !this.bossChunks.has(k)) {
      this.bossChunks.add(k);
      const x = ox + CHUNK / 2, y = oy + CHUNK / 2;
      if (this.isSolid(x, y)) chunk.spawns.push({ type: 'colossus', x, y, boss: true });
    }

    this.bus.emit('chunk:loaded', chunk);
    return chunk;
  }

  /**
   * Pre-render the chunk's ground into an offscreen canvas once, at load time.
   * Painting per-frame would cost thousands of fills; this way terrain is one
   * blit per chunk.
   *
   * Solidity is sampled per 16-unit tile (the expensive part -- it costs two
   * fractal noise fields), but colour is written per pixel through ImageData.
   * That buys fine-grained surface texture for free: a large flat plain reads
   * as ground rather than as a single brown rectangle, which matters because
   * the player has to be able to tell terrain from a rock they can shove.
   */
  paintChunk(chunk) {
    const size = CHUNK / TILE;                 // tiles per side
    const px = 4;                              // pixels per tile in the cached image
    const dim = size * px;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = dim;
    const g = canvas.getContext('2d');
    const b = chunk.biome;

    // --- pass 1: solidity + per-tile base tone ---
    const solid = new Uint8Array(size * size);
    const tone = new Float32Array(size * size);
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const wx = chunk.ox + tx * TILE + TILE / 2;
        const wy = chunk.oy + ty * TILE + TILE / 2;
        const i = ty * size + tx;
        solid[i] = this.isSolid(wx, wy) ? 1 : 0;
        if (solid[i]) tone[i] = fbm(wx / 210, wy / 210, this.seed + 71, 3);
      }
    }

    const rimRgb = hexToRgb(b.rim);
    const img = g.createImageData(dim, dim);
    const data = img.data;

    for (let y = 0; y < dim; y++) {
      const ty = (y / px) | 0;
      for (let x = 0; x < dim; x++) {
        const tx = (x / px) | 0;
        const ti = ty * size + tx;
        const o = (y * dim + x) * 4;
        if (!solid[ti]) { data[o + 3] = 0; continue; }

        // Blend the two biome tones by the tile's fractal value, then jitter
        // each pixel so the surface has grain instead of banding.
        const m = tone[ti] * tone[ti];
        const jitter = (hash2(chunk.ox + x, chunk.oy + y, this.seed + 3301) - 0.5) * 16;
        let r = b.ground[0] + (b.ground2[0] - b.ground[0]) * m + jitter;
        let gg = b.ground[1] + (b.ground2[1] - b.ground[1]) * m + jitter;
        let bb = b.ground[2] + (b.ground2[2] - b.ground[2]) * m + jitter;

        // Edge tiles get the biome's rim light. This is the single most
        // important readability cue in the game: it is what tells you, at a
        // glance and at speed, exactly where the ground stops.
        const edge = tx === 0 || ty === 0 || tx === size - 1 || ty === size - 1 ? 0
          : (solid[ti - 1] & solid[ti + 1] & solid[ti - size] & solid[ti + size]) ? 0 : 1;
        if (edge) {
          r = r * 0.25 + rimRgb[0] * 0.75;
          gg = gg * 0.25 + rimRgb[1] * 0.75;
          bb = bb * 0.25 + rimRgb[2] * 0.75;
        }

        data[o] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[o + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
        data[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        data[o + 3] = 255;
      }
    }

    g.putImageData(img, 0, 0);
    chunk.canvas = canvas;
  }

  /** Chunks overlapping a view box, for rendering. */
  visibleChunks(bounds) {
    const out = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.ox > bounds.maxX || chunk.ox + CHUNK < bounds.minX) continue;
      if (chunk.oy > bounds.maxY || chunk.oy + CHUNK < bounds.minY) continue;
      out.push(chunk);
    }
    return out;
  }

  reset() {
    for (const [k, c] of this.chunks) this.unloadChunk(k, c);
    this.chunks.clear();
    this.bossChunks.clear();
  }
}
