import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLevelFx, spawnLevelUp, updateLevelFx, intensityForLevel, isMilestone,
} from '../../js/levelfx.js';

test('createLevelFx returns an empty active pool', () => {
  const fx = createLevelFx();
  assert.deepEqual(fx.active, []);
});

test('spawn snapshots the hole and pushes onto the active pool', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 3, { x: 10, y: -20, r: 42 });
  assert.equal(fx.active.length, 1);
  const c = fx.active[0];
  assert.equal(c.level, 3);
  assert.equal(c.x, 10);
  assert.equal(c.y, -20);
  assert.equal(c.r, 42);
  // Duration is positive and finite.
  assert.ok(c.duration > 1 && c.duration < 4);
});

test('update advances t and expires the celebration by its duration', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 2, { x: 0, y: 0, r: 22 });
  const c = fx.active[0];
  const dur = c.duration;
  updateLevelFx(fx, dur / 2);
  assert.equal(fx.active.length, 1);
  assert.ok(c.t >= dur / 2 - 1e-9 && c.t <= dur / 2 + 1e-9);
  // One more step past the end and it should be gone.
  updateLevelFx(fx, dur);
  assert.equal(fx.active.length, 0);
});

test('intensity: level 1 == 1.0, capped at 3.5 for very high levels', () => {
  assert.equal(intensityForLevel(1), 1.0);
  assert.ok(Math.abs(intensityForLevel(2) - 1.08) < 1e-9);
  assert.ok(Math.abs(intensityForLevel(11) - (1 + 10 * 0.08)) < 1e-9);
  assert.equal(intensityForLevel(50), 3.5);
  assert.equal(intensityForLevel(500), 3.5);
  // Guard against negative-level nonsense (shouldn't happen but be safe).
  assert.equal(intensityForLevel(0), 1.0);
  assert.equal(intensityForLevel(-5), 1.0);
});

test('milestone detection fires every 10 levels only', () => {
  assert.equal(isMilestone(1), false);
  assert.equal(isMilestone(9), false);
  assert.equal(isMilestone(10), true);
  assert.equal(isMilestone(11), false);
  assert.equal(isMilestone(20), true);
  assert.equal(isMilestone(30), true);
  // Zero should not count as a milestone.
  assert.equal(isMilestone(0), false);
});

test('milestone celebrations schedule extra ring pulses', () => {
  const fx1 = createLevelFx();
  spawnLevelUp(fx1, 9, { x: 0, y: 0, r: 22 });
  const c9 = fx1.active[0];
  const fx2 = createLevelFx();
  spawnLevelUp(fx2, 10, { x: 0, y: 0, r: 22 });
  const c10 = fx2.active[0];
  assert.ok(c10.ringSchedule.length > c9.ringSchedule.length,
    `milestone level 10 should have more rings than level 9 (${c10.ringSchedule.length} vs ${c9.ringSchedule.length})`);
});

test('level 40+ adds two more ring pulses on top of the milestone bump', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 40, { x: 0, y: 0, r: 22 });
  const c40 = fx.active[0];
  // 3 base + 1 milestone + 2 for level>=40 = 6.
  assert.equal(c40.ringSchedule.length, 6);
});

test('reduced-motion spawns no pillar/sparkle-eligible elements', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 5, { x: 0, y: 0, r: 22 }, { reducedMotion: true });
  const c = fx.active[0];
  assert.equal(c.reducedMotion, true);
  // Ring pulses on the ground are suppressed in reduced motion.
  assert.deepEqual(c.ringSchedule, []);
  // No sparkles get spawned no matter how far we tick.
  updateLevelFx(fx, 0.5);
  updateLevelFx(fx, 0.5);
  assert.equal(c.sparkles.length, 0);
  // The celebration still expires normally.
  updateLevelFx(fx, c.duration);
  assert.equal(fx.active.length, 0);
});

test('regular celebrations spawn sparkles during the pillar life', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 5, { x: 0, y: 0, r: 22 });
  const c = fx.active[0];
  updateLevelFx(fx, 0.3);
  // Enough time has passed to spawn multiple sparkles.
  assert.ok(c.sparkles.length > 0, 'expected sparkles to spawn by t=0.3');
});
