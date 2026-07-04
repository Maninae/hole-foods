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

// Distances scale with the (starter) hole radius so bumps to CONFIG.HOLE_R0
// keep these overhang scenarios exactly at the same fractions of the rim.
// The sim-tuned starter radius currently lands at 26.4 (see CLAUDE.md).

test('an object beyond the rim is completely inert — no vacuum', () => {
  // gap = 28 units past the rim (well outside).
  const obj = makeObj(0, CONFIG.HOLE_R0 + 28, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 1.0);
  assert.equal(obj.x, CONFIG.HOLE_R0 + 28, 'must not be attracted');
  assert.equal(obj.vx, 0);
  assert.equal(obj.tilt, 0);
  assert.equal(events.length, 0);
});

test('barely overlapping the rim: teeters (tilts, wobbles) but does not slide in', () => {
  // Place the object so that overhang = (r_hole + r_obj - d) / 2·r_obj = 0.15
  // — supported, tilts but shouldn't slide.
  const rObj = 10;
  const overhang = 0.15;
  const d = CONFIG.HOLE_R0 + rObj - overhang * 2 * rObj;
  const obj = makeObj(0, d, 0, rObj);
  const { world, hole, sw } = makeFixture([obj]);
  runSeconds(sw, world, hole, 1.0);
  assert.ok(obj.tilt > 0, `should tilt at the edge, tilt=${obj.tilt}`);
  assert.equal(obj.state, 'idle');
  assert.ok(obj.x > d - 1, `should hold its ground, x=${obj.x}`);
});

test('substantially overhung: slides over the edge and tips in', () => {
  // overhang = 0.35 — past the slide threshold.
  const rObj = 10;
  const overhang = 0.35;
  const d = CONFIG.HOLE_R0 + rObj - overhang * 2 * rObj;
  const obj = makeObj(0, d, 0, rObj);
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 3.0);
  const swallows = events.filter((e) => e.type === 'swallow');
  assert.equal(swallows.length, 1, 'should slide in and be consumed');
  assert.ok(hole.score > 0n);
});

test('center over the void: tips immediately', () => {
  // Center of object inside the hole's rim.
  const obj = makeObj(0, CONFIG.HOLE_R0 - 2, 0, 10);
  const { world, hole, sw } = makeFixture([obj]);
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(obj.state, 'falling');
});

test('tilt relaxes when the hole moves away', () => {
  const rObj = 10;
  const overhang = 0.15;
  const d = CONFIG.HOLE_R0 + rObj - overhang * 2 * rObj;
  const obj = makeObj(0, d, 0, rObj);
  const { world, hole, sw } = makeFixture([obj]);
  runSeconds(sw, world, hole, 0.5);
  assert.ok(obj.tilt > 0);
  hole.x = 5000; // hole drives off
  runSeconds(sw, world, hole, 1.0, 0.5);
  assert.ok(Math.abs(obj.tilt) < 0.02, `tilt should relax, tilt=${obj.tilt}`);
});

test('too-big objects never teeter or fall, even dead-center', () => {
  // r > hole_r * FIT_FACTOR — inedible regardless of position.
  const obj = makeObj(0, 0, 0, CONFIG.HOLE_R0 + 10);
  const { world, hole, sw } = makeFixture([obj]);
  const events = runSeconds(sw, world, hole, 1.0);
  assert.equal(obj.state, 'idle');
  assert.equal(obj.tilt, 0);
  assert.equal(events.length, 0);
});
