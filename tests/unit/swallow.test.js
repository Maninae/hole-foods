import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import { createWorld } from '../../js/world.js';
import { createHole } from '../../js/hole.js';
import { pointsFor } from '../../js/catalog.js';
import { createSwallow, swallowUpdate } from '../../js/swallow.js';

function makeObj(idx, x, y, r) {
  return {
    id: `0:0,0:${idx}`, idx, ck: '0:0,0', x, y, r,
    e: '🍓', hue: 350, up: false, rot: 0,
    points: pointsFor(r), state: 'idle', vx: 0, vy: 0,
  };
}

function makeFixture(objects) {
  const world = createWorld('swallow-test');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  return { world, hole: createHole(), sw: createSwallow() };
}

function runSeconds(sw, world, hole, seconds, startNow = 0) {
  const events = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    events.push(...swallowUpdate(sw, dt, startNow + t, world, hole));
  }
  return events;
}

// Rim/teeter behavior lives in rim.test.js; this file covers the fall
// state machine, scoring, combos, and persistence.

test('an object over the hole tips in and is consumed after FALL_TIME', () => {
  const obj = makeObj(0, 0, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  const r0 = hole.r;

  const first = swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(obj.state, 'falling');
  assert.equal(first.length, 0, 'no swallow event until the fall finishes');

  const events = runSeconds(sw, world, hole, CONFIG.FALL_TIME + 0.1, 1 / 60);
  const swallowEvents = events.filter((e) => e.type === 'swallow');
  assert.equal(swallowEvents.length, 1);
  assert.equal(swallowEvents[0].points, obj.points);
  assert.equal(hole.score, obj.points);
  assert.ok(hole.potential > r0, 'growth potential should rise');
  assert.ok(world.eaten.get('0:0,0').has(0), 'eaten set should record it');
  assert.equal(world.chunks.get('0:0,0').objects.length, 0);
});

test('fast consecutive swallows build a combo multiplier; a gap resets it', () => {
  const objs = Array.from({ length: 6 }, (_, i) => makeObj(i, 0, 0, 8));
  const { world, hole, sw } = makeFixture(objs);

  // Everything is on the hole; they all tip in within the combo window.
  const events = runSeconds(sw, world, hole, CONFIG.FALL_TIME + 0.1);
  const comboEvents = events.filter((e) => e.type === 'combo');
  assert.ok(sw.streak >= CONFIG.COMBO_STEPS[0], `streak ${sw.streak}`);
  assert.ok(sw.mult >= 2, `multiplier ${sw.mult}`);
  assert.ok(comboEvents.length >= 1, 'combo event should fire');

  // Long quiet gap: streak collapses.
  const later = CONFIG.FALL_TIME + 0.1 + CONFIG.COMBO_WINDOW + 0.5;
  swallowUpdate(sw, 1 / 60, later, world, hole);
  assert.equal(sw.mult, 1);
  assert.equal(sw.streak, 0);
});

test('combo multiplier actually multiplies points', () => {
  const objs = Array.from({ length: 8 }, (_, i) => makeObj(i, 0, 0, 8));
  const base = pointsFor(objs[0].r);
  const { world, hole, sw } = makeFixture(objs);
  const events = runSeconds(sw, world, hole, 6.0);
  const swallows = events.filter((e) => e.type === 'swallow');
  assert.ok(swallows.some((e) => e.points > e.basePoints), 'no multiplied swallow seen');
  const boosted = swallows.find((e) => e.points > e.basePoints);
  // Any combo boost hits ×2 minimum. base and points are BigInt.
  assert.ok(boosted.points >= base * 2n, 'boosted points should reflect multiplier');
});

test('a level-up event fires when enough is eaten', () => {
  // Object size and count sized against the current GROWTH_K: enough
  // fitting objects to cross the level-2 threshold within FALL_TIME.
  const objs = Array.from({ length: 60 }, (_, i) => makeObj(i, 0, 0, 20));
  const { world, hole, sw } = makeFixture(objs);
  const events = runSeconds(sw, world, hole, 20);
  assert.ok(events.some((e) => e.type === 'levelup'), 'no levelup event');
  assert.ok(hole.level >= 2);
});

test('a fall finishes safely even if the chunk unloaded mid-fall', () => {
  const obj = makeObj(0, 0, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(obj.state, 'falling');
  world.chunks.delete('0:0,0'); // simulate unload
  const events = runSeconds(sw, world, hole, CONFIG.FALL_TIME + 0.1, 1 / 60);
  assert.equal(events.filter((e) => e.type === 'swallow').length, 1);
  assert.ok(world.eaten.get('0:0,0').has(0), 'eaten set must persist past unload');
});
