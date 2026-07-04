// Static edibility diagnostic: for each seed × hole level in {1, 2, 3},
// generates the starting region and reports the fraction of items a hole
// of that level could swallow.
//
// Three cuts per region: by COUNT (raw), by AREA (r^2 — matches subjective
// "what dominates my view"), and by COUNT excluding each biome's tiniest
// item (the starter sprinkle otherwise inflates count-fraction well above
// what the player actually feels).
//
// Two regions per level:
//   - starter oasis   : circle of radius STARTER_RADIUS around origin
//   - spawn viewport  : the 1440×900 world-rect the camera frames at the
//                       hole's zoom, centered on origin
//
// Usage: node tools/diagnose.mjs [seedList...]

import { CONFIG } from '../js/config.js';
import { createWorld, ensureChunksAround, forEachChunkInRect } from '../js/world.js';
import { radiusForLevel } from '../js/hole.js';
import { zoomForRadius } from '../js/camera.js';
import { THEMES } from '../js/catalog.js';

const seeds = process.argv.slice(2).length ? process.argv.slice(2) : ['balance', 's1', 's2', 's3'];

function viewportAt(holeR) {
  const zoom = zoomForRadius(holeR);
  return {
    viewW: 1440 / zoom,
    viewH: 900 / (zoom * CONFIG.ISO_Y),
  };
}

function forEachInRect(world, x0, y0, x1, y1, fn) {
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const o of chunk.objects) {
      if (o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) fn(o);
    }
  });
}

function forEachInCircle(world, cx, cy, r, fn) {
  const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const o of chunk.objects) {
      if (Math.hypot(o.x - cx, o.y - cy) <= r) fn(o);
    }
  });
}

// Each theme's smallest item is what the starter sprinkle uses; filter it
// out for the "excluding tiniest" cut so raw sprinkle abundance doesn't
// mask how the *interesting* items sit against the fit limit.
const TINIEST_EMOJIS = new Set();
for (const t of THEMES) {
  const tiny = t.items.reduce((a, b) => (a.r < b.r ? a : b));
  TINIEST_EMOJIS.add(tiny.e);
}

function edibilityStats(items, holeR) {
  const fit = holeR * CONFIG.FIT_FACTOR;
  let count = 0, edibleCount = 0, area = 0, edibleArea = 0;
  let countExT = 0, edibleCountExT = 0;
  for (const o of items) {
    const edible = o.r <= fit;
    const a = o.r * o.r;
    count++;
    area += a;
    if (edible) { edibleCount++; edibleArea += a; }
    if (!TINIEST_EMOJIS.has(o.e)) {
      countExT++;
      if (edible) edibleCountExT++;
    }
  }
  return {
    count, edibleCount,
    fracByCount: count === 0 ? 0 : edibleCount / count,
    fracByArea: area === 0 ? 0 : edibleArea / area,
    fracExT: countExT === 0 ? 0 : edibleCountExT / countExT,
  };
}

const rows = { 1: [], 2: [], 3: [] };
const viewRows = { 1: [], 2: [], 3: [] };

console.log('seed,level,holeR,fitLimit,oasisN,oasisEd,oCountF,oAreaF,oExTF,viewN,viewEd,vCountF,vAreaF,vExTF');
for (const seed of seeds) {
  for (const level of [1, 2, 3]) {
    const holeR = radiusForLevel(level);
    const fit = holeR * CONFIG.FIT_FACTOR;
    const world = createWorld(seed);
    const { viewW, viewH } = viewportAt(holeR);
    const load = Math.max(viewW, viewH, CONFIG.STARTER_RADIUS * 2 + 400);
    ensureChunksAround(world, 0, 0, load, load);

    const oasisItems = [];
    forEachInCircle(world, 0, 0, CONFIG.STARTER_RADIUS, (o) => oasisItems.push(o));
    const oasis = edibilityStats(oasisItems, holeR);
    rows[level].push(oasis);

    const viewItems = [];
    forEachInRect(world, -viewW / 2, -viewH / 2, viewW / 2, viewH / 2,
      (o) => viewItems.push(o));
    const view = edibilityStats(viewItems, holeR);
    viewRows[level].push(view);

    console.log([
      seed, level, holeR.toFixed(2), fit.toFixed(2),
      oasis.count, oasis.edibleCount,
      (100 * oasis.fracByCount).toFixed(1) + '%',
      (100 * oasis.fracByArea).toFixed(1) + '%',
      (100 * oasis.fracExT).toFixed(1) + '%',
      view.count, view.edibleCount,
      (100 * view.fracByCount).toFixed(1) + '%',
      (100 * view.fracByArea).toFixed(1) + '%',
      (100 * view.fracExT).toFixed(1) + '%',
    ].join(','));
  }
}

console.log('');
console.log('# aggregate across seeds');
console.log('level,oCountF,oAreaF,oExTF,vCountF,vAreaF,vExTF');
for (const level of [1, 2, 3]) {
  const oa = rows[level], va = viewRows[level];
  const mean = (arr, k) => arr.reduce((a, b) => a + b[k], 0) / arr.length;
  console.log([
    level,
    (100 * mean(oa, 'fracByCount')).toFixed(1) + '%',
    (100 * mean(oa, 'fracByArea')).toFixed(1) + '%',
    (100 * mean(oa, 'fracExT')).toFixed(1) + '%',
    (100 * mean(va, 'fracByCount')).toFixed(1) + '%',
    (100 * mean(va, 'fracByArea')).toFixed(1) + '%',
    (100 * mean(va, 'fracExT')).toFixed(1) + '%',
  ].join(','));
}
