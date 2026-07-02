// Infinite chunked world: deterministic generation, eaten-object persistence,
// spatial queries. Chunks regenerate identically from (seed, cx, cy); eaten
// sets survive chunk unload for the whole run. Pure module: no DOM.

import { CONFIG } from './config.js';
import { chunkRng } from './rng.js';
import {
  bandIndex, biomeForBand, sizeMultForBand, pointsFor,
} from './catalog.js';
import { PATTERN_KEYS, layoutCluster } from './patterns.js';

const C = CONFIG.CHUNK;
// Largest reach of any object from its owning chunk's rect: cluster extents
// stay under ~13x a (<=70-unit) item radius, singles under the biggest base
// radius. Used to pad spatial queries so cross-chunk footprints are found.
const BASE_EXTENT = 900;
const CLUSTER_MAX_BASE_R = 70;

export function chunkKey(cx, cy) {
  return `${cx},${cy}`;
}

export function createWorld(seed) {
  return {
    seed: String(seed),
    chunks: new Map(),   // key -> { cx, cy, band, objects: [], decals: [] }
    eaten: new Map(),    // key -> Set of object indices, persists across unload
  };
}

export function bandAt(x, y) {
  return bandIndex(Math.hypot(x, y));
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
    id: `${chunkKey(chunk.cx, chunk.cy)}:${idx}`,
    idx,
    ck: chunkKey(chunk.cx, chunk.cy),
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

function generateChunk(world, cx, cy) {
  const rng = chunkRng(world.seed, cx, cy);
  const x0 = cx * C;
  const y0 = cy * C;
  const centerDist = Math.hypot(x0 + C / 2, y0 + C / 2);
  const band = bandIndex(centerDist);
  const biome = biomeForBand(band);
  const mult = sizeMultForBand(band);
  const chunk = { cx, cy, band, objects: [], decals: [] };
  let idx = 0;

  const tryPlace = (item, x, y) => {
    const o = placeObject(chunk, rng, item, mult, x, y, idx);
    idx++; // consume the index even on rejection so ids stay deterministic
    if (o) chunk.objects.push(o);
  };

  // Pattern clusters (the decorative rings/grids/spirals) — small/mid items only.
  const clusterItems = biome.items.filter((it) => it.r <= CLUSTER_MAX_BASE_R);
  const clusterRoll = rng.next();
  const nClusters = clusterItems.length === 0 ? 0 : clusterRoll < 0.18 ? 0 : clusterRoll < 0.72 ? 1 : 2;
  for (let ci = 0; ci < nClusters; ci++) {
    const item = rng.pickWeighted(clusterItems, (it) => it.w);
    const pattern = rng.pick(PATTERN_KEYS);
    const cxw = x0 + rng.range(0.2, 0.8) * C;
    const cyw = y0 + rng.range(0.2, 0.8) * C;
    for (const p of layoutCluster(rng, pattern, item.r * mult)) {
      tryPlace(item, cxw + p.x, cyw + p.y);
    }
  }

  // Scattered singles — full item table, so the giants show up here.
  const nSingles = rng.int(3, 7);
  for (let i = 0; i < nSingles; i++) {
    const item = rng.pickWeighted(biome.items, (it) => it.w);
    tryPlace(item, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
  }

  // Starter guarantee: near spawn, sprinkle extra tiniest items.
  if (centerDist < CONFIG.STARTER_RADIUS) {
    const tiniest = biome.items.reduce((a, b) => (a.r < b.r ? a : b));
    for (let i = 0; i < 6; i++) {
      tryPlace(tiniest, x0 + rng.range(0.05, 0.95) * C, y0 + rng.range(0.05, 0.95) * C);
    }
  }

  // Non-collectible ground decals.
  const drng = chunkRng(world.seed, cx, cy, 'decals');
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
  const eatenSet = world.eaten.get(chunkKey(cx, cy));
  if (eatenSet) chunk.objects = chunk.objects.filter((o) => !eatenSet.has(o.idx));

  return chunk;
}

function padChunksAt(world, x, y) {
  const mult = sizeMultForBand(bandAt(x, y) + 1);
  return Math.min(30, Math.ceil((BASE_EXTENT * mult) / C) + 1);
}

// Generate all chunks covering the padded view rect, and unload far ones.
export function ensureChunksAround(world, x, y, viewW, viewH) {
  const pad = padChunksAt(world, x, y);
  const cx0 = Math.floor((x - viewW / 2) / C) - pad;
  const cx1 = Math.floor((x + viewW / 2) / C) + pad;
  const cy0 = Math.floor((y - viewH / 2) / C) - pad;
  const cy1 = Math.floor((y + viewH / 2) / C) + pad;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const key = chunkKey(cx, cy);
      if (!world.chunks.has(key)) world.chunks.set(key, generateChunk(world, cx, cy));
    }
  }
  // Unload chunks far outside the active window (eaten sets are kept).
  const ccx = Math.floor(x / C);
  const ccy = Math.floor(y / C);
  const keep = Math.max(CONFIG.UNLOAD_CHUNKS, pad + Math.ceil(viewW / 2 / C) + 2);
  for (const [key, chunk] of world.chunks) {
    if (Math.abs(chunk.cx - ccx) > keep || Math.abs(chunk.cy - ccy) > keep) {
      world.chunks.delete(key);
    }
  }
}

// Iterate idle objects whose footprint intersects the circle (x, y, radius).
export function forEachObjectNear(world, x, y, radius, fn) {
  const pad = padChunksAt(world, x, y);
  const cx0 = Math.floor((x - radius) / C) - pad;
  const cx1 = Math.floor((x + radius) / C) + pad;
  const cy0 = Math.floor((y - radius) / C) - pad;
  const cy1 = Math.floor((y + radius) / C) + pad;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const chunk = world.chunks.get(chunkKey(cx, cy));
      if (!chunk) continue;
      for (const o of chunk.objects) {
        if (o.state !== 'idle') continue;
        if (Math.hypot(o.x - x, o.y - y) <= radius + o.r) fn(o);
      }
    }
  }
}

// Iterate loaded chunks overlapping the rect, padded so objects with
// cross-chunk footprints are included. For the renderer.
export function forEachChunkInRect(world, x0, y0, x1, y1, fn) {
  const pad = padChunksAt(world, (x0 + x1) / 2, (y0 + y1) / 2);
  const cx0 = Math.floor(x0 / C) - pad;
  const cx1 = Math.floor(x1 / C) + pad;
  const cy0 = Math.floor(y0 / C) - pad;
  const cy1 = Math.floor(y1 / C) + pad;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const chunk = world.chunks.get(chunkKey(cx, cy));
      if (chunk) fn(chunk);
    }
  }
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
