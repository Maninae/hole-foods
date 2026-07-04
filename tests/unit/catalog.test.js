import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  THEMES, BIOMES, SLOT_MULTS,
  bandIndex, biomeForBand, cycleForBand, slotForBand, sizeMultForBand,
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

test('theme rotation walks the 18-pool: classic six in cycle 0, wraps at 18 bands', () => {
  const N = CONFIG.BANDS_PER_CYCLE;
  // Cycle 0 (bands 0..5) is the classic six.
  for (let b = 0; b < N; b++) {
    assert.equal(biomeForBand(b), THEMES[b], `band ${b} should be THEMES[${b}]`);
  }
  // Cycle 1 slot 0 (band 6) is the 7th theme.
  assert.equal(biomeForBand(N), THEMES[N]);
  // Cycle 2 slot 0 (band 12) is the 13th theme.
  assert.equal(biomeForBand(2 * N), THEMES[2 * N]);
  // Cycle 3 slot 0 (band 18) wraps back to THEMES[0].
  assert.equal(biomeForBand(3 * N), THEMES[0]);
  // Deep wrap: band 108 = 18 cycles × N slots — again THEMES[0].
  assert.equal(biomeForBand(THEMES.length * N), THEMES[0]);
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
  assert.equal(biomeDisplayName(0), THEMES[0].name);
  const N = CONFIG.BANDS_PER_CYCLE;
  // Cycle 1 slot 0 → THEMES[6] with " II".
  assert.equal(biomeDisplayName(N), `${THEMES[N].name} II`);
});

test('points scale with placed area, never below 1', () => {
  assert.equal(pointsFor(10), BigInt(Math.round(100 / CONFIG.POINTS_DIV)));
  assert.equal(pointsFor(2), 1n);
  assert.ok(pointsFor(100) > pointsFor(50));
  assert.equal(typeof pointsFor(10), 'bigint');
});
