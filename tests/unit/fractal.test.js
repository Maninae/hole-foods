// The fractal invariant: bands widen geometrically, chunks scale with their
// cycle level, so the world looks and plays the same at every scale and the
// camera can zoom out forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import { bandIndex, bandRange, cycleForBand } from '../../js/catalog.js';
import {
  createWorld, ensureChunksAround, forEachObjectNear, chunkKey, chunkSizeAt, levelAt,
} from '../../js/world.js';

const W = CONFIG.BAND_WIDTH;
const N = CONFIG.BANDS_PER_CYCLE;
const M = CONFIG.CYCLE_SIZE_MULT;

test('bands are geometric: each cycle is M times wider than the last', () => {
  assert.equal(bandIndex(0), 0);
  assert.equal(bandIndex(W - 1), 0);
  assert.equal(bandIndex(W), 1);
  // Cycle 0 spans N bands of width W; cycle 1 starts right after.
  const s1 = N * W;
  assert.equal(bandIndex(s1 - 1), N - 1);
  assert.equal(bandIndex(s1), N);
  // Band N (first of cycle 1) is M times wider than band 0.
  assert.equal(bandRange(N).width, W * M);
  assert.equal(bandRange(0).width, W);
  // Cycle 2 starts after cycle 1's N bands of width W*M.
  const s2 = s1 + N * W * M;
  assert.equal(bandIndex(s2), 2 * N);
  assert.equal(cycleForBand(bandIndex(s2)), 2);
});

test('bandRange tiles distance space with no gaps or overlaps', () => {
  for (let b = 0; b < N * 3; b++) {
    const cur = bandRange(b);
    const next = bandRange(b + 1);
    assert.ok(Math.abs(cur.start + cur.width - next.start) < 1e-6,
      `band ${b} ends at ${cur.start + cur.width}, band ${b + 1} starts at ${next.start}`);
    // bandIndex agrees with bandRange at interior points.
    assert.equal(bandIndex(cur.start + cur.width / 2), b);
  }
});

test('chunk size scales with cycle level', () => {
  assert.equal(chunkSizeAt(0), CONFIG.CHUNK);
  assert.equal(chunkSizeAt(1), CONFIG.CHUNK * M);
  assert.equal(chunkSizeAt(2), CONFIG.CHUNK * M * M);
});

test('a position deep in cycle 1 lives in a level-1 chunk with M-scaled objects', () => {
  const w = createWorld('fractal');
  const d = N * W * 1.8; // comfortably inside cycle 1
  assert.equal(levelAt(d, 0), 1);
  ensureChunksAround(w, d, 0, 1600, 1200);
  const C1 = chunkSizeAt(1);
  const key = chunkKey(1, Math.floor(d / C1), 0);
  assert.ok(w.chunks.has(key), `expected level-1 chunk ${key}`);

  let count = 0;
  let minR = Infinity;
  forEachObjectNear(w, d, 0, C1, (o) => { count++; minR = Math.min(minR, o.r); });
  assert.ok(count > 0, 'no objects generated in cycle 1');
  // Smallest cycle-1 item scaled by M. Themes' base radii bottom out at 6
  // (some dense-glyph shrinks land there — see catalog.js DENSE_R_SCALE);
  // the ±8% placement jitter accounts for the 0.9 floor.
  assert.ok(minR >= 6 * M * 0.9, `cycle-1 objects too small: ${minR}`);
});

test('the loaded chunk count stays bounded at any scale (the perf invariant)', () => {
  const w = createWorld('bounded');
  // View sized as the camera would frame a hole at each scale.
  for (const [dist, view] of [[400, 1600], [N * W * 1.8, 1600 * M], [N * W * (1 + M) * 1.2, 1600 * M * M]]) {
    ensureChunksAround(w, dist, 0, view, view * 0.66);
    assert.ok(w.chunks.size < 1800,
      `${w.chunks.size} chunks loaded at dist ${dist} — iteration would melt`);
  }
});

test('sub-pixel levels are not generated: a huge view skips the fine inner grids', () => {
  const w = createWorld('lod');
  // Deep in cycle 2, framed the way the camera would (view >> level-0 chunks).
  const d = N * W * (1 + M) * 1.5;
  const view = 1600 * M * M;
  ensureChunksAround(w, d, 0, view, view * 0.66);
  let level0 = 0;
  for (const chunk of w.chunks.values()) if (chunk.level === 0) level0++;
  assert.equal(level0, 0,
    `${level0} level-0 chunks generated — they would be sub-pixel at this zoom`);
});

test('queries spanning a cycle boundary return objects from both levels', () => {
  const w = createWorld('boundary');
  const s1 = N * W; // cycle 0 -> 1 boundary
  ensureChunksAround(w, s1, 0, chunkSizeAt(1) * 4, chunkSizeAt(1) * 3);
  const levels = new Set();
  forEachObjectNear(w, s1, 0, chunkSizeAt(1) * 1.5, (o) => {
    levels.add(o.ck.split(':')[0]);
  });
  assert.ok(levels.has('0') && levels.has('1'),
    `expected objects from levels 0 and 1, got ${[...levels]}`);
});
