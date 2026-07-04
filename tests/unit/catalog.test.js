import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  THEMES, BIOMES, SLOT_MULTS,
  bandIndex, bandRange, biomeForBand, cycleForBand, slotForBand, sizeMultForBand,
  sectorCount, sectorForAngle, themeFor, themeAt,
  pointsFor, biomeDisplayName,
} from '../../js/catalog.js';

// Canonical base-radius range every theme's item table lives in. Slot
// multipliers scale placed sizes into the actual arrival range.
const R_MIN = 6;
const R_MAX = 66;

test('the pool has 18 themes and the classic six lead cycle 0', () => {
  assert.equal(THEMES.length, 18);
  assert.equal(BIOMES, THEMES, 'BIOMES must alias THEMES for back-compat');
  const classic = ['meadow', 'orchard', 'bakery', 'toybox', 'funfair', 'downtown'];
  for (let i = 0; i < classic.length; i++) {
    assert.equal(THEMES[i].key, classic[i], `pool[${i}] must be ${classic[i]} (cycle 0 keeps the classics)`);
  }
});

test('every theme is fully specified — canonical range, dense ladder, valid colors', () => {
  for (const t of THEMES) {
    assert.ok(t.key && t.name, `theme missing key/name`);
    assert.match(t.ground, /^#[0-9a-f]{6}$/i, `${t.key} ground color`);
    assert.match(t.groundAlt, /^#[0-9a-f]{6}$/i, `${t.key} groundAlt color`);
    assert.ok(Array.isArray(t.decals) && t.decals.length >= 2, `${t.key} decals`);
    assert.ok(t.items.length >= 12, `${t.key} needs >= 12 items, has ${t.items.length}`);
    for (const it of t.items) {
      assert.ok(typeof it.e === 'string' && it.e.length > 0, `${t.key} item emoji`);
      assert.ok(it.r >= R_MIN && it.r <= R_MAX,
        `${t.key} ${it.e} base radius ${it.r} outside canonical [${R_MIN}, ${R_MAX}]`);
      assert.ok(it.w > 0, `${t.key} ${it.e} weight`);
      assert.ok(Number.isFinite(it.hue), `${t.key} ${it.e} hue`);
    }
    // Ladder must actually span the range — smallest ~7ish, biggest ~60ish.
    const sizes = t.items.map((i) => i.r);
    assert.ok(Math.min(...sizes) <= 10, `${t.key} lacks a tiny item (min r ${Math.min(...sizes)})`);
    assert.ok(Math.max(...sizes) >= 48, `${t.key} lacks a giant item (max r ${Math.max(...sizes)})`);
  }
});

test('SLOT_MULTS is the ~1.55^k ladder that matches arrival pacing', () => {
  assert.equal(SLOT_MULTS.length, CONFIG.BANDS_PER_CYCLE);
  assert.equal(SLOT_MULTS[0], 1);
  for (let k = 1; k < SLOT_MULTS.length; k++) {
    const ratio = SLOT_MULTS[k] / SLOT_MULTS[k - 1];
    assert.ok(Math.abs(ratio - 1.55) < 0.05,
      `slot ${k}/${k - 1} mult ratio ${ratio.toFixed(3)} strays from 1.55`);
  }
  // Every slot must have BOTH edible and aspirational food at cycle 0 given
  // the base ranges (smallest ~7, biggest ~60 across every theme). This
  // replaces the old per-theme arrival test — since theme<->slot is now
  // dynamic, the ladder itself must guarantee playability at every slot.
  for (let k = 0; k < SLOT_MULTS.length; k++) {
    const arrivalR = CONFIG.HOLE_R0 * Math.pow(1.55, k);
    const smallestPlaced = 7 * SLOT_MULTS[k];
    const biggestPlaced = 60 * SLOT_MULTS[k];
    assert.ok(smallestPlaced <= arrivalR * CONFIG.FIT_FACTOR,
      `slot ${k}: smallest placed ${smallestPlaced.toFixed(0)} inedible on arrival (hole ~${arrivalR.toFixed(0)})`);
    assert.ok(biggestPlaced >= arrivalR * 1.3,
      `slot ${k}: biggest placed ${biggestPlaced.toFixed(0)} not aspirational (hole ~${arrivalR.toFixed(0)})`);
  }
});

test('bandIndex maps distance to bands (geometric past cycle 0 — see fractal tests)', () => {
  assert.equal(bandIndex(0), 0);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH - 1), 0);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH), 1);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH * 5.5), 5);
});

test('band 0 is always Berry Meadow at every angle (spawn is home)', () => {
  // The whole first annulus must be one contiguous meadow so the spawn
  // radius + starter guarantee both stay stable.
  assert.equal(sectorCount(0), 1);
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * 2 * Math.PI - Math.PI;
    assert.equal(themeFor(0, sectorForAngle(0, angle)).key, 'meadow');
  }
  // Sample eight compass points inside band 0.
  const R = CONFIG.BAND_WIDTH * 0.4;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    assert.equal(themeAt(Math.cos(a) * R, Math.sin(a) * R).key, 'meadow');
  }
});

test('themeFor is deterministic and cells at the same band usually differ', () => {
  // Determinism: same inputs → same theme every call.
  for (const [b, s] of [[3, 0], [7, 4], [12, 11]]) {
    assert.equal(themeFor(b, s), themeFor(b, s), `themeFor(${b},${s}) must be stable`);
  }
  // Two different sectors in the same band SHOULD usually pick different
  // themes — with 18 themes and a healthy hash there is a ~1/18 chance
  // any given pair collides, but across a band with many sectors we
  // expect a wide spread.
  for (const band of [5, 8, 12]) {
    const n = sectorCount(band);
    const seen = new Set();
    for (let s = 0; s < n; s++) seen.add(themeFor(band, s).key);
    assert.ok(seen.size >= Math.min(n, 4),
      `band ${band} (${n} sectors) only reached ${seen.size} distinct themes`);
  }
});

test('themeAt agrees with themeFor(band, sectorForAngle(band, angle))', () => {
  // Randomish sampling of world positions — the position-based lookup
  // and the (band, sector) form must never disagree.
  const points = [
    [4000, 0], [-3000, 800], [500, -2500], [15000, 12000],
    [-45000, 30000], [80000, -1000],
  ];
  for (const [x, y] of points) {
    const band = bandIndex(Math.hypot(x, y));
    const sec = sectorForAngle(band, Math.atan2(y, x));
    assert.equal(themeAt(x, y), themeFor(band, sec),
      `(${x},${y}) band ${band} sector ${sec}`);
  }
});

test('sectorCount cells stay roughly square, grow within a cycle', () => {
  // sectorCount(band) ≈ 2π * mid_r / width. That ratio between cell arc
  // and cell radial width is the "squareness" — target 1, we accept
  // [0.5, 2.0] to allow the round() step.
  const N = CONFIG.BANDS_PER_CYCLE;
  for (let b = 1; b < 24; b++) {
    const n = sectorCount(b);
    const { start, width } = bandRange(b);
    const midR = start + width / 2;
    const arc = (2 * Math.PI * midR) / n;
    const ratio = arc / width;
    assert.ok(ratio >= 0.5 && ratio <= 2.0,
      `band ${b}: cell arc/width = ${ratio.toFixed(2)} (n=${n}, midR=${midR.toFixed(0)}, w=${width.toFixed(0)})`);
  }
  // Within a single cycle the width is constant, so sectorCount monotonically
  // grows as we move outward. (Between cycles it can drop, because the
  // band width jumps up by CYCLE_SIZE_MULT.)
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let s = 1; s < N; s++) {
      const b = cycle * N + s;
      assert.ok(sectorCount(b) >= sectorCount(b - 1),
        `within cycle ${cycle}, sectorCount(${b}) < sectorCount(${b - 1})`);
    }
  }
});

test('biomeForBand returns a stable sector-0 fallback for HUD display', () => {
  // The band-only API is a display fallback — main.js's HUD toast keys
  // on band today, so this must never throw and must be deterministic.
  for (let b = 0; b < 20; b++) {
    assert.ok(biomeForBand(b).key, `band ${b} has no fallback theme`);
    assert.equal(biomeForBand(b), themeFor(b, 0));
  }
});

test('cycle + slot decomposition tracks bands', () => {
  const N = CONFIG.BANDS_PER_CYCLE;
  assert.equal(cycleForBand(0), 0);
  assert.equal(slotForBand(0), 0);
  assert.equal(cycleForBand(N * 2 + 3), 2);
  assert.equal(slotForBand(N * 2 + 3), 3);
});

test('sizeMultForBand = cycle scale × slot scale', () => {
  const N = CONFIG.BANDS_PER_CYCLE;
  const M = CONFIG.CYCLE_SIZE_MULT;
  // Cycle 0 slot 0 is the fixed point.
  assert.equal(sizeMultForBand(0), 1);
  // Slot 3 within cycle 0 uses SLOT_MULTS[3] directly.
  assert.equal(sizeMultForBand(3), SLOT_MULTS[3]);
  // Cycle 1 slot 0 is exactly the cycle multiplier.
  assert.ok(Math.abs(sizeMultForBand(N) - M) < 1e-9);
  // Cycle 1 slot 3 stacks both.
  assert.ok(Math.abs(sizeMultForBand(N + 3) - M * SLOT_MULTS[3]) < 1e-9);
});

test('biomeDisplayName suffixes with Roman numerals by cycle', () => {
  // Band 0 is meadow, no suffix.
  assert.equal(biomeDisplayName(0), THEMES[0].name);
  const N = CONFIG.BANDS_PER_CYCLE;
  // Cycle 1 gets " II" appended to whichever theme sector 0 lands on.
  assert.equal(biomeDisplayName(N), `${biomeForBand(N).name} II`);
  // Cycle 2 gets " III".
  assert.equal(biomeDisplayName(2 * N), `${biomeForBand(2 * N).name} III`);
});

test('points scale with placed area, never below 1', () => {
  assert.equal(pointsFor(10), BigInt(Math.round(100 / CONFIG.POINTS_DIV)));
  assert.equal(pointsFor(2), 1n);
  assert.ok(pointsFor(100) > pointsFor(50));
  assert.equal(typeof pointsFor(10), 'bigint');
});
