import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  BIOMES, bandIndex, biomeForBand, cycleForBand, sizeMultForBand, pointsFor,
} from '../../js/catalog.js';

test('there are exactly BANDS_PER_CYCLE biomes, each fully specified', () => {
  assert.equal(BIOMES.length, CONFIG.BANDS_PER_CYCLE);
  for (const b of BIOMES) {
    assert.ok(b.key && b.name, `biome missing key/name`);
    assert.match(b.ground, /^#[0-9a-f]{6}$/i, `${b.key} ground color`);
    assert.ok(Array.isArray(b.decals) && b.decals.length >= 2, `${b.key} decals`);
    assert.ok(b.items.length >= 8, `${b.key} needs a rich item table, has ${b.items.length}`);
    for (const it of b.items) {
      assert.ok(typeof it.e === 'string' && it.e.length > 0, `${b.key} item emoji`);
      assert.ok(it.r >= 5 && it.r <= 300, `${b.key} ${it.e} radius ${it.r}`);
      assert.ok(it.w > 0, `${b.key} ${it.e} weight`);
      assert.ok(Number.isFinite(it.hue), `${b.key} ${it.e} hue`);
    }
  }
});

test('every biome has food a fresh-to-the-band hole can eat, and aspirational giants', () => {
  // Rough arrival radius at band k: hole grows ~1.55x per band traversed.
  for (let k = 0; k < CONFIG.BANDS_PER_CYCLE; k++) {
    const arrivalR = CONFIG.HOLE_R0 * Math.pow(1.55, k);
    const items = BIOMES[k].items;
    const smallest = Math.min(...items.map((i) => i.r));
    const biggest = Math.max(...items.map((i) => i.r));
    assert.ok(smallest <= arrivalR * CONFIG.FIT_FACTOR,
      `${BIOMES[k].key}: smallest item ${smallest} inedible on arrival (hole ~${arrivalR.toFixed(0)})`);
    assert.ok(biggest >= arrivalR * 1.3,
      `${BIOMES[k].key}: biggest item ${biggest} not aspirational (hole ~${arrivalR.toFixed(0)})`);
  }
});

test('bandIndex maps distance to bands of BAND_WIDTH', () => {
  assert.equal(bandIndex(0), 0);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH - 1), 0);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH), 1);
  assert.equal(bandIndex(CONFIG.BAND_WIDTH * 7.5), 7);
});

test('biomes cycle and size multiplier compounds per cycle', () => {
  assert.equal(biomeForBand(0), BIOMES[0]);
  assert.equal(biomeForBand(CONFIG.BANDS_PER_CYCLE), BIOMES[0]);
  assert.equal(biomeForBand(CONFIG.BANDS_PER_CYCLE + 2), BIOMES[2]);
  assert.equal(cycleForBand(0), 0);
  assert.equal(cycleForBand(CONFIG.BANDS_PER_CYCLE * 2 + 1), 2);
  assert.equal(sizeMultForBand(3), 1);
  assert.equal(sizeMultForBand(CONFIG.BANDS_PER_CYCLE + 3), CONFIG.CYCLE_SIZE_MULT);
});

test('points scale with placed area, never below 1', () => {
  assert.equal(pointsFor(10), Math.round(100 / CONFIG.POINTS_DIV));
  assert.equal(pointsFor(2), 1);
  assert.ok(pointsFor(100) > pointsFor(50));
});
