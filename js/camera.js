// Camera: eased follow with velocity lookahead, size-driven zoom, screen
// shake, and world<->screen transforms. Pure math: no DOM. `rand` is
// injected so tests stay deterministic.

import { CONFIG } from './config.js';

export function createCamera() {
  return {
    x: 0, y: 0,
    zoom: CONFIG.ZOOM_BASE,
    shakeAmp: 0, shakeX: 0, shakeY: 0,
  };
}

export function zoomForRadius(r) {
  const z = CONFIG.ZOOM_BASE * Math.pow(CONFIG.HOLE_R0 / r, CONFIG.ZOOM_EXP);
  return Math.min(CONFIG.ZOOM_MAX, Math.max(CONFIG.ZOOM_MIN, z));
}

export function shake(cam, amp) {
  cam.shakeAmp = Math.max(cam.shakeAmp, amp);
}

export function updateCamera(cam, dt, hole, rand = Math.random) {
  const lookX = hole.x + hole.vx * 0.22;
  const lookY = hole.y + hole.vy * 0.22;
  const ease = Math.min(1, CONFIG.CAM_EASE * dt);
  cam.x += (lookX - cam.x) * ease;
  cam.y += (lookY - cam.y) * ease;

  const zEase = Math.min(1, CONFIG.ZOOM_EASE * dt);
  cam.zoom += (zoomForRadius(hole.r) - cam.zoom) * zEase;

  cam.shakeAmp *= Math.max(0, 1 - 6 * dt);
  if (cam.shakeAmp < 0.05) cam.shakeAmp = 0;
  cam.shakeX = (rand() * 2 - 1) * cam.shakeAmp;
  cam.shakeY = (rand() * 2 - 1) * cam.shakeAmp;
}

// Screen = world * scale + t, with the Y axis squashed by ISO_Y for the
// pseudo-3D view. CSS-pixel space; the renderer layers DPR on top.
export function getTransform(cam, w, h) {
  const scale = cam.zoom;
  const scaleY = scale * CONFIG.ISO_Y;
  return {
    scale,
    scaleY,
    tx: w / 2 - (cam.x + cam.shakeX) * scale,
    ty: h / 2 - (cam.y + cam.shakeY) * scaleY,
  };
}

export function worldToScreen(cam, w, h, x, y) {
  const t = getTransform(cam, w, h);
  return { x: x * t.scale + t.tx, y: y * t.scaleY + t.ty };
}

export function screenToWorld(cam, w, h, sx, sy) {
  const t = getTransform(cam, w, h);
  return { x: (sx - t.tx) / t.scale, y: (sy - t.ty) / t.scaleY };
}
