import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createHole, updateHole, eat, levelForRadius, levelProgress, holeSpeed, sizeLabel,
} from '../../js/hole.js';

test('a fresh hole has the configured starting radius, level 1, zero score', () => {
  const h = createHole();
  assert.equal(h.r, CONFIG.HOLE_R0);
  assert.equal(h.level, 1);
  assert.equal(h.score, 0n);
});

test('eating grows the hole by area accumulation', () => {
  const h = createHole();
  const s = 10;
  eat(h, s, 12n);
  const expected = Math.sqrt(CONFIG.HOLE_R0 ** 2 + CONFIG.GROWTH_K * s * s);
  assert.ok(Math.abs(h.r - expected) < 1e-9, `r=${h.r}, expected ${expected}`);
  assert.equal(h.score, 12n);
  assert.equal(h.eatenCount, 1);
});

test('growth is scale-free: eating ~3 own-size objects grows radius ~fixed ratio', () => {
  for (const startR of [22, 220, 2200]) {
    const h = createHole();
    h.r = startR;
    const before = h.r;
    for (let i = 0; i < 3; i++) eat(h, h.r * 0.8, 1n);
    const ratio = h.r / before;
    assert.ok(ratio > 1.25 && ratio < 1.45, `ratio ${ratio.toFixed(3)} at start ${startR}`);
  }
});

test('levels are radius milestones and progress stays in [0, 1)', () => {
  assert.equal(levelForRadius(CONFIG.HOLE_R0), 1);
  assert.equal(levelForRadius(CONFIG.HOLE_R0 * CONFIG.LEVEL_R_GROWTH), 2);
  assert.equal(levelForRadius(CONFIG.HOLE_R0 * CONFIG.LEVEL_R_GROWTH ** 4), 5);
  for (const r of [22, 30, 55, 130, 999]) {
    const p = levelProgress(r);
    assert.ok(p >= 0 && p < 1, `progress ${p} at r=${r}`);
  }
});

test('eat reports level-ups', () => {
  const h = createHole();
  let leveled = false;
  // Eat until we cross the first milestone.
  for (let i = 0; i < 100 && !leveled; i++) {
    leveled = eat(h, 10, 1n).leveledUp;
  }
  assert.ok(leveled, 'never leveled up');
  assert.equal(h.level, 2);
});

test('bigger holes move faster in world units', () => {
  assert.ok(holeSpeed(44) > holeSpeed(22));
  assert.ok(holeSpeed(22) === CONFIG.SPEED_BASE);
});

test('movement eases toward the input direction and respects dt', () => {
  const h = createHole();
  updateHole(h, 0.016, { x: 1, y: 0, mag: 1 });
  assert.ok(h.vx > 0 && h.x > 0, 'did not start moving right');
  assert.equal(h.vy, 0);
  const prevX = h.x;
  updateHole(h, 0.016, { x: 0, y: 0, mag: 0 });
  assert.ok(h.x > prevX, 'should coast briefly while easing down');
  // Long idling should bring it to a stop.
  for (let i = 0; i < 300; i++) updateHole(h, 0.016, { x: 0, y: 0, mag: 0 });
  assert.ok(Math.abs(h.vx) < 1, `still moving: vx=${h.vx}`);
});

test('speed never exceeds the size-scaled max', () => {
  const h = createHole();
  for (let i = 0; i < 200; i++) updateHole(h, 0.016, { x: 1, y: 0, mag: 1 });
  const speed = Math.hypot(h.vx, h.vy);
  assert.ok(speed <= holeSpeed(h.r) + 1e-6, `speed ${speed} > max ${holeSpeed(h.r)}`);
});

test('sizeLabel renders cm then meters', () => {
  assert.equal(sizeLabel(22), '44 cm');
  assert.equal(sizeLabel(80), '1.6 m');
  assert.equal(sizeLabel(2600), '52 m');
});
