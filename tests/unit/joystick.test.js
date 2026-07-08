// Pure math for the touch joystick: knob offset -> {x, y, mag} steering
// contract. The rest of the joystick (DOM, pointer capture, visibility) is
// covered end-to-end in tests/e2e/smoke.test.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { steerFromOffset } from '../../js/joystick.js';

test('steerFromOffset is zero inside the deadzone', () => {
  const r = steerFromOffset(3, 4, 100, 0.12);
  assert.equal(r.mag, 0);
  assert.equal(r.x, 0);
  assert.equal(r.y, 0);
});

test('steerFromOffset returns a unit direction along the knob offset', () => {
  const r = steerFromOffset(50, 0, 100, 0.12);
  assert.ok(Math.abs(r.x - 1) < 1e-9);
  assert.ok(Math.abs(r.y) < 1e-9);
  assert.ok(r.mag > 0 && r.mag < 1);
});

test('steerFromOffset caps magnitude at 1 at the ring rim', () => {
  const r = steerFromOffset(100, 0, 100, 0.12);
  assert.equal(r.mag, 1);
});

test('steerFromOffset caps magnitude at 1 past the ring rim', () => {
  const r = steerFromOffset(300, 0, 100, 0.12);
  assert.equal(r.mag, 1);
  assert.ok(Math.abs(r.x - 1) < 1e-9);
});

test('steerFromOffset diagonal direction is unit length', () => {
  const r = steerFromOffset(70, 70, 100, 0.12);
  assert.ok(Math.abs(Math.hypot(r.x, r.y) - 1) < 1e-9);
  assert.ok(r.mag > 0 && r.mag <= 1);
});

test('steerFromOffset scales linearly from deadzone edge to rim', () => {
  // With zero deadzone, mag is offset / ringR.
  const r1 = steerFromOffset(30, 0, 100, 0);
  assert.ok(Math.abs(r1.mag - 0.3) < 1e-9);
  const r2 = steerFromOffset(60, 0, 100, 0);
  assert.ok(Math.abs(r2.mag - 0.6) < 1e-9);
});

test('steerFromOffset points along all four cardinal directions', () => {
  const right = steerFromOffset(80, 0, 100, 0.12);
  assert.ok(right.x > 0.99 && Math.abs(right.y) < 1e-9);
  const left = steerFromOffset(-80, 0, 100, 0.12);
  assert.ok(left.x < -0.99 && Math.abs(left.y) < 1e-9);
  const down = steerFromOffset(0, 80, 100, 0.12);
  assert.ok(down.y > 0.99 && Math.abs(down.x) < 1e-9);
  const up = steerFromOffset(0, -80, 100, 0.12);
  assert.ok(up.y < -0.99 && Math.abs(up.x) < 1e-9);
});

test('steerFromOffset returns zero on invalid ring radius', () => {
  const r = steerFromOffset(30, 0, 0, 0.12);
  assert.equal(r.mag, 0);
});
