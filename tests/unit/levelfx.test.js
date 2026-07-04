import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLevelFx, spawnLevelUp, updateLevelFx, intensityForLevel, isMilestone,
  auraForLevel, AURA_TIERS,
} from '../../js/levelfx.js';

function hexToRgb(h) {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

test('createLevelFx returns an empty active pool', () => {
  const fx = createLevelFx();
  assert.deepEqual(fx.active, []);
});

test('spawn anchors on the hole and pushes onto the active pool', () => {
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

test('celebration follows the hole as it keeps moving (player-anchored, not ground-anchored)', () => {
  const fx = createLevelFx();
  const hole = { x: 10, y: -20, r: 42 };
  spawnLevelUp(fx, 3, hole);
  const c = fx.active[0];
  assert.equal(c.x, 10);
  // The player keeps steering (and can even level again) mid-celebration...
  hole.x = 500;
  hole.y = 300;
  hole.r = 51;
  updateLevelFx(fx, 0.2);
  // ...and the aura/pillar/text anchor rides along with the hole.
  assert.equal(c.x, 500);
  assert.equal(c.y, 300);
  assert.equal(c.r, 51);
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

test('auraForLevel returns exact tier colors at each threshold', () => {
  for (const tier of AURA_TIERS) {
    const aura = auraForLevel(tier.from);
    assert.deepEqual(aura.core, hexToRgb(tier.core),
      `core mismatch at threshold ${tier.from}`);
    assert.deepEqual(aura.glow, hexToRgb(tier.glow),
      `glow mismatch at threshold ${tier.from}`);
  }
});

test('auraForLevel interpolates smoothly between adjacent tiers', () => {
  // Between tier@from=1 (#bfe5ff sky blue) and tier@from=6 (#7ec3ff azure),
  // level 3 sits at t = (3-1)/(6-1) = 0.4. Midway ish; the returned RGB
  // must lie strictly between the two endpoints.
  const a = hexToRgb('#bfe5ff');
  const b = hexToRgb('#7ec3ff');
  const mid = auraForLevel(3);
  for (let i = 0; i < 3; i++) {
    const lo = Math.min(a[i], b[i]);
    const hi = Math.max(a[i], b[i]);
    assert.ok(mid.core[i] >= lo && mid.core[i] <= hi,
      `core channel ${i} out of interpolation range: ${mid.core[i]} not in [${lo}, ${hi}]`);
  }
  // Exact LERP at t=0.4.
  const expected = [
    Math.round(a[0] + (b[0] - a[0]) * 0.4),
    Math.round(a[1] + (b[1] - a[1]) * 0.4),
    Math.round(a[2] + (b[2] - a[2]) * 0.4),
  ];
  assert.deepEqual(mid.core, expected);
});

test('auraForLevel clamps at both ends of the ladder', () => {
  const first = AURA_TIERS[0];
  const last = AURA_TIERS[AURA_TIERS.length - 1];
  // Below the first threshold, colors clamp to the first tier.
  assert.deepEqual(auraForLevel(0).core, hexToRgb(first.core));
  assert.deepEqual(auraForLevel(-10).glow, hexToRgb(first.glow));
  // Above the last threshold, colors clamp to the last tier (stay emerald).
  assert.deepEqual(auraForLevel(60).core, hexToRgb(last.core));
  assert.deepEqual(auraForLevel(9999).glow, hexToRgb(last.glow));
});

test('celebrations at different tiers carry different aura colors', () => {
  const fx = createLevelFx();
  spawnLevelUp(fx, 3, { x: 0, y: 0, r: 22 }); // sky-blue tier
  spawnLevelUp(fx, 40, { x: 0, y: 0, r: 22 }); // gold tier
  const [low, high] = fx.active;
  // Different tiers must produce different core colors.
  assert.notDeepEqual(low.aura.core, high.aura.core);
});
