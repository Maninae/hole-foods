// Infinite FRACTAL chunked world: chunk size scales with the biome cycle
// (x CYCLE_SIZE_MULT per cycle), matching how object sizes scale — so the
// number of loaded chunks and on-screen objects stays bounded at ANY zoom.
// Chunks generate deterministically from (seed, level, cx, cy); eaten sets
// survive chunk unload for the whole run. Pure module: no DOM.

import { CONFIG } from './config.js';
import { chunkRng } from './rng.js';
import {
  bandIndex, biomeForBand, cycleForBand, sizeMultForBand, pointsFor,
} from './catalog.js';
import { PATTERN_KEYS, layoutCluster } from './patterns.js';

// Cluster extents stay under ~2x a chunk side at every level (spacing scales
// with item size, item size scales with the level) — 3 chunks of padding
// always suffices for cross-chunk footprints.
const PAD = 3;
const CLUSTER_MAX_BASE_R = 70;
// Chunks are grouped into 3x3 regions that share an oasis-or-desert fate.
// A region is an oasis with this probability; the rest is sparse desert.
// Regions inside the starter radius are always oases regardless of the roll.
const REGION_SIZE = 3;
const OASIS_PROB = 0.35;
// Desert chunks' crumbs are drawn from a biome's smallest few items.
const DESERT_ITEM_TIER = 4;
// A desert chunk still gets a single full-table surprise this often — a rare
// giant sighting between oases.
const DESERT_SURPRISE_PROB = 0.06;

export function chunkSizeAt(level) {
  return CONFIG.CHUNK * Math.pow(CONFIG.CYCLE_SIZE_MULT, level);
}

export function bandAt(x, y) {
  return bandIndex(Math.hypot(x, y));
}

export function levelAt(x, y) {
  return cycleForBand(bandAt(x, y));
}

export function chunkKey(level, cx, cy) {
  return `${level}:${cx},${cy}`;
}

// Levels whose chunks matter around a position: the local cycle and its
// neighbors (boundary regions) — but a level is skipped when its chunks
// would span less than 1/44th of the view: at that zoom its contents are
// sub-pixel specks, and generating/iterating them is what melts frames.
function levelsFor(x, y, spanW) {
  const L = levelAt(x, y);
  const candidates = L === 0 ? [0, 1] : [L - 1, L, L + 1];
  const kept = candidates.filter((lv) => chunkSizeAt(lv) >= spanW / 44);
  return kept.length ? kept : [L];
}

export function createWorld(seed) {
  return {
    seed: String(seed),
    chunks: new Map(),   // key -> { level, cx, cy, band, objects: [], decals: [] }
    eaten: new Map(),    // key -> Set of object indices, persists across unload
  };
}

function placeObject(chunk, rng, item, mult, x, y, idx) {
  const r = item.r * mult * rng.range(0.92, 1.08);
  // Keep the spawn point clear so the hole never starts under an object.
  if (Math.hypot(x, y) - r < CONFIG.HOLE_R0 * 2 + 30) return null;
  // Light overlap rejection against what's already placed in this chunk.
  for (const o of chunk.objects) {
    if (Math.hypot(o.x - x, o.y - y) < (o.r + r) * 0.85) return null;
  }
  return {
    id: `${chunkKey(chunk.level, chunk.cx, chunk.cy)}:${idx}`,
    idx,
    ck: chunkKey(chunk.level, chunk.cx, chunk.cy),
    x, y, r,
    e: item.e,
    hue: item.hue,
    up: !!item.up,
    rot: item.up ? 0 : rng.range(-0.22, 0.22),
    points: pointsFor(r),
    state: 'idle',
    vx: 0, vy: 0,
  };
}

// The biome's smallest-N items (by base radius), used to seed desert crumbs.
function smallestItems(biome, n) {
  const sorted = [...biome.items].sort((a, b) => a.r - b.r);
  const cutoffR = sorted[Math.min(n, sorted.length) - 1].r;
  return biome.items.filter((it) => it.r <= cutoffR);
}

function generateChunk(world, level, cx, cy) {
  const C = chunkSizeAt(level);
  const rng = chunkRng(world.seed, cx, cy, `L${level}`);
  const x0 = cx * C;
  const y0 = cy * C;
  const centerDist = Math.hypot(x0 + C / 2, y0 + C / 2);
  const band = bandIndex(centerDist);
  const biome = biomeForBand(band);
  const mult = sizeMultForBand(band);
  const chunk = { level, cx, cy, band, objects: [], decals: [] };
  let idx = 0;

  const tryPlace = (item, x, y) => {
    const o = placeObject(chunk, rng, item, mult, x, y, idx);
    idx++; // consume the index even on rejection so ids stay deterministic
    if (o) chunk.objects.push(o);
  };

  // Region-scale oasis roll: 3x3 chunks share a fate, so richness comes in
  // patches you can find and clear — a lot of food, then a few crumbs
  // sparsely here and there before the next cluster. Rolled on a separate
  // RNG stream so it does not disturb the chunk stream's placement pattern.
  // Chunks inside the starter radius are always oases (a newborn hole must
  // have food nearby regardless of which region it lands in).
  const regionRng = chunkRng(
    world.seed,
    Math.floor(cx / REGION_SIZE),
    Math.floor(cy / REGION_SIZE),
    `L${level}oasis`,
  );
  const isOasis = centerDist < CONFIG.STARTER_RADIUS
    || regionRng.next() < OASIS_PROB;

  if (isOasis) {
    // Rich: several decorative clusters plus a bunch of scattered singles.
    const clusterItems = biome.items.filter((it) => it.r <= CLUSTER_MAX_BASE_R);
    const nClusters = clusterItems.length === 0 ? 0 : rng.int(3, 5);
    for (let ci = 0; ci < nClusters; ci++) {
      const item = rng.pickWeighted(clusterItems, (it) => it.w);
      const pattern = rng.pick(PATTERN_KEYS);
      const cxw = x0 + rng.range(0.2, 0.8) * C;
      const cyw = y0 + rng.range(0.2, 0.8) * C;
      for (const p of layoutCluster(rng, pattern, item.r * mult)) {
        tryPlace(item, cxw + p.x, cyw + p.y);
      }
    }
    const nSingles = rng.int(7, 13);
    for (let i = 0; i < nSingles; i++) {
      const item = rng.pickWeighted(biome.items, (it) => it.w);
      tryPlace(item, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
    }
  } else {
    // Desert: a scattering of crumbs from the biome's smallest few items,
    // with a rare full-table surprise to keep exploration interesting.
    const crumbItems = smallestItems(biome, DESERT_ITEM_TIER);
    const nCrumbs = rng.int(0, 2);
    for (let i = 0; i < nCrumbs; i++) {
      const item = rng.pickWeighted(crumbItems, (it) => it.w);
      tryPlace(item, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
    }
    if (rng.next() < DESERT_SURPRISE_PROB) {
      const item = rng.pickWeighted(biome.items, (it) => it.w);
      tryPlace(item, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
    }
  }

  // Starter guarantee: near spawn, sprinkle extra tiniest items.
  if (centerDist < CONFIG.STARTER_RADIUS) {
    const tiniest = biome.items.reduce((a, b) => (a.r < b.r ? a : b));
    for (let i = 0; i < 6; i++) {
      tryPlace(tiniest, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
    }
  }

  // Non-collectible ground decals.
  const drng = chunkRng(world.seed, cx, cy, `L${level}decals`);
  const nDecals = drng.int(2, 5);
  for (let i = 0; i < nDecals; i++) {
    chunk.decals.push({
      x: x0 + drng.range(0.05, 0.95) * C,
      y: y0 + drng.range(0.05, 0.95) * C,
      e: drng.pick(biome.decals),
      r: drng.range(9, 16) * mult,
      rot: drng.range(-0.5, 0.5),
    });
  }

  // Apply persisted eaten set.
  const eatenSet = world.eaten.get(chunkKey(level, cx, cy));
  if (eatenSet) chunk.objects = chunk.objects.filter((o) => !eatenSet.has(o.idx));

  return chunk;
}

// A grid cell only "exists" at the level matching its center's cycle —
// every region of the world is owned by exactly one level.
function cellOwned(level, cx, cy) {
  const C = chunkSizeAt(level);
  return cycleForBand(bandIndex(Math.hypot((cx + 0.5) * C, (cy + 0.5) * C))) === level;
}

// Generate all owned chunks covering the padded view rect; unload far ones.
export function ensureChunksAround(world, x, y, viewW, viewH) {
  for (const level of levelsFor(x, y, viewW)) {
    const C = chunkSizeAt(level);
    const cx0 = Math.floor((x - viewW / 2) / C) - PAD;
    const cx1 = Math.floor((x + viewW / 2) / C) + PAD;
    const cy0 = Math.floor((y - viewH / 2) / C) - PAD;
    const cy1 = Math.floor((y + viewH / 2) / C) + PAD;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = chunkKey(level, cx, cy);
        if (world.chunks.has(key) || !cellOwned(level, cx, cy)) continue;
        world.chunks.set(key, generateChunk(world, level, cx, cy));
      }
    }
  }
  // Unload chunks that left the active window or whose level dropped out of
  // relevance at this zoom (eaten sets are kept; regeneration is identical).
  const keptLevels = new Set(levelsFor(x, y, viewW));
  for (const [key, chunk] of world.chunks) {
    const C = chunkSizeAt(chunk.level);
    const keep = Math.max(CONFIG.UNLOAD_CHUNKS, PAD + Math.ceil(viewW / 2 / C) + 2);
    if (!keptLevels.has(chunk.level)
      || Math.abs(chunk.cx - Math.floor(x / C)) > keep
      || Math.abs(chunk.cy - Math.floor(y / C)) > keep) {
      world.chunks.delete(key);
    }
  }
}

// Iterate loaded chunks (any nearby level) overlapping the padded rect.
export function forEachChunkInRect(world, x0, y0, x1, y1, fn) {
  for (const level of levelsFor((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0)) {
    const C = chunkSizeAt(level);
    const gx0 = Math.floor(x0 / C) - PAD;
    const gx1 = Math.floor(x1 / C) + PAD;
    const gy0 = Math.floor(y0 / C) - PAD;
    const gy1 = Math.floor(y1 / C) + PAD;
    for (let cy = gy0; cy <= gy1; cy++) {
      for (let cx = gx0; cx <= gx1; cx++) {
        const chunk = world.chunks.get(chunkKey(level, cx, cy));
        if (chunk) fn(chunk);
      }
    }
  }
}

// Iterate idle objects whose footprint intersects the circle (x, y, radius).
export function forEachObjectNear(world, x, y, radius, fn) {
  forEachChunkInRect(world, x - radius, y - radius, x + radius, y + radius, (chunk) => {
    for (const o of chunk.objects) {
      if (o.state !== 'idle') continue;
      if (Math.hypot(o.x - x, o.y - y) <= radius + o.r) fn(o);
    }
  });
}

// Permanently consume an object (falling finalization). Safe if the chunk
// has been unloaded mid-fall: the eaten set is what persists.
export function markEaten(world, obj) {
  let set = world.eaten.get(obj.ck);
  if (!set) {
    set = new Set();
    world.eaten.set(obj.ck, set);
  }
  set.add(obj.idx);
  const chunk = world.chunks.get(obj.ck);
  if (chunk) {
    const i = chunk.objects.indexOf(obj);
    if (i >= 0) chunk.objects.splice(i, 1);
  }
}
