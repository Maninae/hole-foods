// Input: mouse hover-steer, touch drag, WASD/arrow keys. Produces a single
// {x, y, mag} direction each frame; keyboard wins over pointer when held.

import { screenToWorld } from './camera.js';

const KEY_DIRS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function createInput(canvas) {
  const state = {
    px: 0, py: 0,          // pointer in CSS pixels
    hasPointer: false,
    touching: false,
    keys: new Set(),
    onPause: null,         // set by main
    onAnyGesture: null,    // set by main (audio unlock)
  };

  canvas.addEventListener('mousemove', (e) => {
    state.px = e.clientX;
    state.py = e.clientY;
    state.hasPointer = true;
  });

  const touch = (e) => {
    if (e.touches.length > 0) {
      state.px = e.touches[0].clientX;
      state.py = e.touches[0].clientY;
      state.hasPointer = true;
      state.touching = true;
    }
    if (e.cancelable) e.preventDefault();
    state.onAnyGesture?.();
  };
  canvas.addEventListener('touchstart', touch, { passive: false });
  canvas.addEventListener('touchmove', touch, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) state.touching = false;
  });

  // On macOS, browsers swallow keyup events for other keys while Meta (Cmd)
  // is held -- so Cmd+Tab can leave a "held" arrow key stuck in the Set even
  // after focus returns. Clear on any Meta-modified keydown, and skip adding
  // movement keys while Meta is held so we don't re-poison the Set.
  window.addEventListener('keydown', (e) => {
    if (e.metaKey) state.keys.clear();
    if (e.code in KEY_DIRS) {
      if (!e.metaKey) state.keys.add(e.code);
      e.preventDefault();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      state.onPause?.();
    }
    state.onAnyGesture?.();
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  // Belt-and-suspenders: clear on every event that means "we're no longer sure
  // which keys are physically held" -- blur (Cmd+Tab), tab hidden (visibility
  // change pauses the game and would otherwise resume with a stale key), and
  // focus regain (fresh start when the user returns).
  window.addEventListener('blur', () => state.keys.clear());
  window.addEventListener('focus', () => state.keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.keys.clear();
  });
  canvas.addEventListener('mousedown', () => state.onAnyGesture?.());

  state.getDirection = (hole, cam, w, h) => {
    // Keyboard: full throttle in the summed direction.
    if (state.keys.size > 0) {
      let x = 0;
      let y = 0;
      for (const code of state.keys) {
        x += KEY_DIRS[code][0];
        y += KEY_DIRS[code][1];
      }
      const len = Math.hypot(x, y);
      if (len > 0) return { x: x / len, y: y / len, mag: 1 };
    }
    // Pointer: steer toward it, throttle by distance (dead zone at center).
    if (state.hasPointer) {
      const target = screenToWorld(cam, w, h, state.px, state.py);
      const dx = target.x - hole.x;
      const dy = target.y - hole.y;
      const dist = Math.hypot(dx, dy);
      const dead = hole.r * 0.3;
      if (dist > dead) {
        const mag = Math.min(1, (dist - dead) / (hole.r * 1.6));
        return { x: dx / dist, y: dy / dist, mag };
      }
    }
    return { x: 0, y: 0, mag: 0 };
  };

  return state;
}
