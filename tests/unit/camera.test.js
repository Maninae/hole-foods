import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createCamera, updateCamera, zoomForRadius, shake, getTransform,
  screenToWorld, worldToScreen,
} from '../../js/camera.js';

test('zoom shrinks as the hole grows, within clamps', () => {
  assert.ok(zoomForRadius(44) < zoomForRadius(22));
  assert.ok(zoomForRadius(22) <= CONFIG.ZOOM_MAX + 1e-9);
  assert.ok(zoomForRadius(1e12) >= CONFIG.ZOOM_MIN - 1e-12);
  assert.equal(zoomForRadius(1e12), CONFIG.ZOOM_MIN);
});

test('camera eases toward the hole and converges', () => {
  const cam = createCamera();
  const hole = { x: 500, y: -300, vx: 0, vy: 0, r: 22 };
  for (let i = 0; i < 600; i++) updateCamera(cam, 1 / 60, hole, () => 0.5);
  assert.ok(Math.abs(cam.x - 500) < 2, `cam.x=${cam.x}`);
  assert.ok(Math.abs(cam.y + 300) < 2, `cam.y=${cam.y}`);
});

test('the view is isometric: vertical scale is squashed by ISO_Y', () => {
  const cam = createCamera();
  const t = getTransform(cam, 1280, 720);
  assert.ok(Math.abs(t.scaleY - t.scale * CONFIG.ISO_Y) < 1e-9,
    `scaleY ${t.scaleY} should be scale ${t.scale} * ISO_Y`);
  assert.ok(CONFIG.ISO_Y > 0.5 && CONFIG.ISO_Y < 1, 'squash should be partial');
});

test('worldToScreen and screenToWorld are inverses (iso-aware)', () => {
  const cam = createCamera();
  cam.x = 123; cam.y = -456; cam.zoom = 0.7;
  const [w, h] = [1280, 720];
  const s = worldToScreen(cam, w, h, 200, -90);
  const back = screenToWorld(cam, w, h, s.x, s.y);
  assert.ok(Math.abs(back.x - 200) < 1e-6 && Math.abs(back.y + 90) < 1e-6);
  // And the y mapping really uses the squashed scale.
  const t = getTransform(cam, w, h);
  assert.ok(Math.abs(s.y - (-90 * t.scaleY + t.ty)) < 1e-9);
});

test('shake decays away', () => {
  const cam = createCamera();
  shake(cam, 12);
  updateCamera(cam, 1 / 60, { x: 0, y: 0, vx: 0, vy: 0, r: 22 }, () => 1);
  assert.ok(Math.abs(cam.shakeX) + Math.abs(cam.shakeY) > 0, 'no shake offset');
  for (let i = 0; i < 120; i++) updateCamera(cam, 1 / 60, { x: 0, y: 0, vx: 0, vy: 0, r: 22 }, () => 1);
  assert.ok(Math.abs(cam.shakeX) + Math.abs(cam.shakeY) < 0.01, 'shake never died');
});
