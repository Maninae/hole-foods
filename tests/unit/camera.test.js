import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createCamera, updateCamera, zoomForRadius, shake, getTransform, screenToWorld,
} from '../../js/camera.js';

test('zoom shrinks as the hole grows, within clamps', () => {
  assert.ok(zoomForRadius(44) < zoomForRadius(22));
  assert.ok(zoomForRadius(22) <= CONFIG.ZOOM_MAX + 1e-9);
  assert.ok(zoomForRadius(1e9) >= CONFIG.ZOOM_MIN - 1e-9);
  assert.equal(zoomForRadius(1e9), CONFIG.ZOOM_MIN);
});

test('camera eases toward the hole and converges', () => {
  const cam = createCamera();
  const hole = { x: 500, y: -300, vx: 0, vy: 0, r: 22 };
  for (let i = 0; i < 600; i++) updateCamera(cam, 1 / 60, hole, () => 0.5);
  assert.ok(Math.abs(cam.x - 500) < 2, `cam.x=${cam.x}`);
  assert.ok(Math.abs(cam.y + 300) < 2, `cam.y=${cam.y}`);
});

test('screenToWorld inverts getTransform', () => {
  const cam = createCamera();
  cam.x = 123; cam.y = -456; cam.zoom = 0.7;
  const [w, h] = [1280, 720];
  const t = getTransform(cam, w, h);
  const wx = 200; const wy = -90;
  const sx = wx * t.scale + t.tx;
  const sy = wy * t.scale + t.ty;
  const back = screenToWorld(cam, w, h, sx, sy);
  assert.ok(Math.abs(back.x - wx) < 1e-6 && Math.abs(back.y - wy) < 1e-6);
});

test('shake decays away', () => {
  const cam = createCamera();
  shake(cam, 12);
  updateCamera(cam, 1 / 60, { x: 0, y: 0, vx: 0, vy: 0, r: 22 }, () => 1);
  assert.ok(Math.abs(cam.shakeX) + Math.abs(cam.shakeY) > 0, 'no shake offset');
  for (let i = 0; i < 120; i++) updateCamera(cam, 1 / 60, { x: 0, y: 0, vx: 0, vy: 0, r: 22 }, () => 1);
  assert.ok(Math.abs(cam.shakeX) + Math.abs(cam.shakeY) < 0.01, 'shake never died');
});
