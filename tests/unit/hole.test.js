import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createHole, updateHole, eat, levelForRadius, levelProgress, radiusForLevel,
  holeProgress, holeSpeed, sizeLabel,
} from '../../js/hole.js';

test('a fresh hole has the configured starting radius, level 1, zero score', () => {
  const h = createHole();
  assert.equal(h.r, CONFIG.HOLE_R0);
  assert.equal(h.potential, CONFIG.HOLE_R0);
  assert.equal(h.level, 1);
  assert.equal(h.score, 0n);
});

test('the radius is DISCRETE: eating builds potential but r holds until level-up', () => {
  const h = createHole();
  const s = 10;
  eat(h, s, 12n);
  assert.equal(h.r, CONFIG.HOLE_R0, 'radius must not creep between levels');
  const expected = Math.sqrt(CONFIG.HOLE_R0 ** 2 + CONFIG.GROWTH_K * s * s);
  assert.ok(Math.abs(h.potential - expected) < 1e-9, `potential=${h.potential}`);
  assert.equal(h.score, 12n);
  assert.equal(h.eatenCount, 1);
});

test('level-up snaps the radius to the next predetermined ladder size', () => {
  const h = createHole();
  let res = { leveledUp: false };
  for (let i = 0; i < 400 && !res.leveledUp; i++) res = eat(h, 10, 1n);
  assert.ok(res.leveledUp, 'never leveled');
  assert.equal(h.level, 2);
  assert.ok(Math.abs(h.r - radiusForLevel(2)) < 1e-9,
    `r=${h.r} should snap exactly to ladder size ${radiusForLevel(2)}`);
  // And it holds there until the NEXT milestone.
  eat(h, 5, 1n);
  assert.equal(h.r, radiusForLevel(2));
});

test('a huge meal can jump multiple levels at once', () => {
  const h = createHole();
  eat(h, 400, 1n); // way more area than one milestone step
  assert.ok(h.level > 2, `level=${h.level}`);
  assert.ok(Math.abs(h.r - radiusForLevel(h.level)) < 1e-9);
});

test('growth potential is scale-free: ~3 own-size meals raise potential a fixed ratio', () => {
  // Ratio = sqrt(1 + 3·GROWTH_K·0.64); bounds bracket the current GROWTH_K
  // wide enough to survive small tuning nudges without hiding a real change.
  for (const startR of [22, 220, 2200]) {
    const h = createHole();
    h.r = startR;
    h.potential = startR;
    const before = h.potential;
    for (let i = 0; i < 3; i++) eat(h, h.r * 0.8, 1n);
    const ratio = h.potential / before;
    assert.ok(ratio > 1.01 && ratio < 1.05, `ratio ${ratio.toFixed(3)} at start ${startR}`);
  }
});

test('holeProgress reports area-fraction toward the next ladder size', () => {
  const h = createHole();
  assert.equal(holeProgress(h), 0);
  eat(h, 10, 1n);
  const p = holeProgress(h);
  assert.ok(p > 0 && p < 1, `progress ${p}`);
  // Right after a level-up, progress resets near zero.
  let res = { leveledUp: false };
  for (let i = 0; i < 400 && !res.leveledUp; i++) res = eat(h, 10, 1n);
  assert.ok(holeProgress(h) < 0.35, `post-levelup progress ${holeProgress(h)}`);
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
  // Eat until we cross the first milestone. Loop count scales with GROWTH_K:
  // at K=0.02 it takes ~120 s=10 eats to cross the level-2 threshold.
  for (let i = 0; i < 300 && !leveled; i++) {
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
