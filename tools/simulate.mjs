// Headless greedy-bot simulation of Hole Foods for balance tuning.
//
// The bot plays a full run at 30 Hz against the same engine modules the
// browser uses: each tick it picks the nearest edible (r <= hole.r * FIT_FACTOR)
// via forEachObjectNear, widening the search up to a few hole-radii; if
// nothing edible is nearby it steers radially outward to explore. The view
// is sized as the camera would frame the current hole radius, so chunks
// stream in the way they do in-game.
//
// Prints one CSV row every 30 sim-seconds, then a summary block:
//   simMin,holeR,sizeLabel,level,band,cycle,score,eaten,radiusDoublingTimeSec
//
// Usage: node tools/simulate.mjs [minutes=20] [seed=balance]

import { CONFIG } from '../js/config.js';
import { createWorld, ensureChunksAround, forEachObjectNear } from '../js/world.js';
import { createHole, updateHole, sizeLabel } from '../js/hole.js';
import { createSwallow, swallowUpdate } from '../js/swallow.js';
import { zoomForRadius } from '../js/camera.js';
import { bandIndex, biomeForBand, cycleForBand } from '../js/catalog.js';

const minutes = Number(process.argv[2] ?? 20);
const seed = process.argv[3] ?? 'balance';
const DT = 1 / 30;
const totalTime = minutes * 60;
const REPORT_EVERY = 30;
const HISTORY_EVERY = 1; // sample (t, r) at 1 Hz for doubling-time lookups
// Widening search radii, in multiples of the hole's radius. If a full-sweep
// finds nothing edible, the bot switches to radial-outward explore steering.
const SEARCH_MULTS = [3, 6, 12];

const world = createWorld(seed);
const hole = createHole();
const sw = createSwallow();

const rHistory = [];                 // { t, r } samples for doubling-time
const bandFirstReached = new Map();  // band -> sim seconds
const cycleFirstReached = new Map(); // cycle -> sim seconds
let eaten = 0;
let now = 0;
let lastReport = -REPORT_EVERY;
let lastHistoryT = -Infinity;

function pickTarget() {
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  for (const mult of SEARCH_MULTS) {
    const R = Math.max(hole.r * mult, 240);
    let best = null;
    let bestD2 = Infinity;
    forEachObjectNear(world, hole.x, hole.y, R, (o) => {
      if (o.r > fitLimit) return;
      const dx = o.x - hole.x;
      const dy = o.y - hole.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    });
    if (best) return best;
  }
  return null;
}

function doublingTimeSec() {
  if (rHistory.length === 0) return NaN;
  const half = hole.r / 2;
  if (half < CONFIG.HOLE_R0) return NaN; // has not doubled from birth yet
  for (let i = rHistory.length - 1; i >= 0; i--) {
    if (rHistory[i].r <= half) return now - rHistory[i].t;
  }
  return NaN;
}

function report() {
  const dist = Math.hypot(hole.x, hole.y);
  const band = bandIndex(dist);
  const cycle = cycleForBand(band);
  const dt = doublingTimeSec();
  console.log([
    (now / 60).toFixed(2),
    hole.r.toFixed(2),
    sizeLabel(hole.r),
    hole.level,
    band,
    cycle,
    hole.score,
    eaten,
    Number.isFinite(dt) ? dt.toFixed(1) : '',
  ].join(','));
}

console.log('simMin,holeR,sizeLabel,level,band,cycle,score,eaten,radiusDoublingTimeSec');

while (now < totalTime + 1e-9) {
  const zoom = zoomForRadius(hole.r);
  const viewW = 1600 / zoom;
  const viewH = 1000 / (zoom * CONFIG.ISO_Y);
  ensureChunksAround(world, hole.x, hole.y, viewW, viewH);

  const target = pickTarget();
  let dx;
  let dy;
  if (target) {
    dx = target.x - hole.x;
    dy = target.y - hole.y;
  } else {
    // Explore: push radially outward from the origin (toward bigger biomes).
    dx = hole.x;
    dy = hole.y;
    if (dx === 0 && dy === 0) {
      dx = 1;
      dy = 0;
    }
  }
  const mag = Math.hypot(dx, dy) || 1;
  updateHole(hole, DT, { x: dx / mag, y: dy / mag, mag: 1 });

  const events = swallowUpdate(sw, DT, now, world, hole);
  for (const ev of events) if (ev.type === 'swallow') eaten++;

  if (now - lastHistoryT >= HISTORY_EVERY) {
    rHistory.push({ t: now, r: hole.r });
    lastHistoryT = now;
  }

  const dist = Math.hypot(hole.x, hole.y);
  const band = bandIndex(dist);
  const cycle = cycleForBand(band);
  if (!bandFirstReached.has(band)) bandFirstReached.set(band, now);
  if (!cycleFirstReached.has(cycle)) cycleFirstReached.set(cycle, now);

  if (now - lastReport >= REPORT_EVERY - 1e-9) {
    report();
    lastReport = now;
  }
  now += DT;
}

console.log('');
console.log(`# Summary: ${minutes} min, seed=${seed}`);
console.log(`# Final: r=${hole.r.toFixed(2)} (${sizeLabel(hole.r)}), level=${hole.level}, score=${hole.score}, eaten=${eaten}`);
console.log('# First reached band:');
for (const [band, t] of [...bandFirstReached.entries()].sort((a, b) => a[0] - b[0])) {
  const biome = biomeForBand(band);
  const cycle = cycleForBand(band);
  console.log(`#   band ${band} (${biome.name}, cycle ${cycle}): ${t.toFixed(1)}s`);
}
console.log('# First reached cycle:');
for (const [cycle, t] of [...cycleFirstReached.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`#   cycle ${cycle}: ${t.toFixed(1)}s`);
}
