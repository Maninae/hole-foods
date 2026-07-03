// Rim physics: no gravitational vacuum. Objects are inert until the hole's
// edge is actually under them; then they teeter (tilt + wobble), slide once
// substantially overhung, and tip in when their center loses support.

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
    points: pointsFor(r), state: 'idle', vx: 0, vy: 0, tilt: 0,
  };
}

function makeFixture(objects) {
  const world = createWorld('rim-test');
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

test('an object beyond the rim is completely inert — no vacuum', () => {
  const obj = makeObj(0, 50, 0, 10); // hole r=22 at origin; gap of 18 units
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 1.0);
  assert.equal(obj.x, 50, 'must not be attracted');
  assert.equal(obj.vx, 0);
  assert.equal(obj.tilt, 0);
  assert.equal(events.length, 0);
});

test('barely overlapping the rim: teeters (tilts, wobbles) but does not slide in', () => {
  // d=29, r=10, hole r=22: overhang = (32-29)/20 = 0.15 — supported, unstable-looking
  const obj = makeObj(0, 29, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  runSeconds(sw, world, hole, 1.0);
  assert.ok(obj.tilt > 0, `should tilt at the edge, tilt=${obj.tilt}`);
  assert.equal(obj.state, 'idle');
  assert.ok(obj.x > 28, `should hold its ground, x=${obj.x}`);
});

test('substantially overhung: slides over the edge and tips in', () => {
  // d=25: overhang = (32-25)/20 = 0.35 — past the slide threshold
  const obj = makeObj(0, 25, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 3.0);
  const swallows = events.filter((e) => e.type === 'swallow');
  assert.equal(swallows.length, 1, 'should slide in and be consumed');
  assert.ok(hole.score > 0n);
});

test('center over the void: tips immediately', () => {
  const obj = makeObj(0, 20, 0, 10); // d=20 < hole r=22
  const { world, hole, sw } = makeFixture([obj]);
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(obj.state, 'falling');
});

test('tilt relaxes when the hole moves away', () => {
  const obj = makeObj(0, 29, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  runSeconds(sw, world, hole, 0.5);
  assert.ok(obj.tilt > 0);
  hole.x = 5000; // hole drives off
  runSeconds(sw, world, hole, 1.0, 0.5);
  assert.ok(Math.abs(obj.tilt) < 0.02, `tilt should relax, tilt=${obj.tilt}`);
});

test('too-big objects never teeter or fall, even dead-center', () => {
  const obj = makeObj(0, 0, 0, 30); // r=30 > 22 * FIT_FACTOR
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 1.0);
  assert.equal(obj.state, 'idle');
  assert.equal(obj.tilt, 0);
  assert.equal(events.length, 0);
});
