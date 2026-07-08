// Corner-anchored virtual joystick for touch devices. Emits the same
// {x, y, mag} steering contract that input.js already consumes, so hole
// physics is untouched.
//
// Coexistence with the whole-canvas touch drag in input.js: the joystick
// root sits above the canvas with pointer-events: auto, so touches on the
// ring/knob fire pointer events on the joystick alone; touches that begin
// outside the joystick continue to hit canvas.touchstart and drive the
// existing drag-steer. When both would be active, the joystick wins in
// input.getDirection (it is the deliberate control surface).
//
// Visibility: shown only during live 'playing' mode AND when the device
// is touch-capable. Touch capability = (pointer: coarse) media query OR
// a first-touch belt-and-suspenders one-shot listener.

import { CONFIG } from './config.js';

// Pure math: given knob offset in screen pixels (dx, dy) relative to the
// ring center, the ring radius, and a normalized deadzone fraction, return
// the steering vector {x, y, mag}. Direction is the unit offset; magnitude
// ramps linearly from 0 at the deadzone edge to 1 at (or beyond) the rim.
export function steerFromOffset(dx, dy, ringR, deadzoneFrac) {
  if (!(ringR > 0)) return { x: 0, y: 0, mag: 0 };
  const dist = Math.hypot(dx, dy);
  const deadR = ringR * deadzoneFrac;
  if (dist <= deadR) return { x: 0, y: 0, mag: 0 };
  const span = Math.max(1e-9, ringR - deadR);
  const mag = Math.min(1, (dist - deadR) / span);
  return { x: dx / dist, y: dy / dist, mag };
}

// Bind the DOM element, wire pointer events, and return a small handle:
//   direction()      -> current {x, y, mag}
//   setPlayMode(on)  -> show/hide with live-play gating
//   root             -> the container element (or null in test/head env)
export function createJoystick({ onAnyGesture } = {}) {
  const root = document.getElementById('joystick');
  const ring = root?.querySelector('.joystick-ring');
  const knob = root?.querySelector('.joystick-knob');

  const state = {
    direction: { x: 0, y: 0, mag: 0 },
    pointerId: null,
    modeVisible: false,
    touchEligible: false,
  };

  // Head/test environment safety: if the DOM isn't present, expose a
  // no-op handle so input.js can still call direction() safely.
  if (!root || !ring || !knob) {
    return {
      direction: () => state.direction,
      setPlayMode: () => {},
      root: null,
    };
  }

  // Configurable size + opacity: the CSS reads these as custom properties.
  root.style.setProperty('--joystick-ring-px', `${CONFIG.JOYSTICK_RING_PX}px`);
  root.style.setProperty(
    '--joystick-knob-px',
    `${Math.round(CONFIG.JOYSTICK_RING_PX * CONFIG.JOYSTICK_KNOB_FRAC)}px`,
  );
  root.style.setProperty('--joystick-margin-px', `${CONFIG.JOYSTICK_MARGIN_PX}px`);
  root.style.setProperty('--joystick-opacity-idle', String(CONFIG.JOYSTICK_OPACITY_IDLE));
  root.style.setProperty('--joystick-opacity-active', String(CONFIG.JOYSTICK_OPACITY_ACTIVE));

  state.touchEligible = window.matchMedia('(pointer: coarse)').matches;

  // Belt-and-suspenders: some hybrid tablets and desktop-emulated mobile
  // contexts don't report pointer:coarse until the first touch lands.
  // A single passive touchstart flips eligibility so the joystick can show.
  window.addEventListener('touchstart', () => {
    if (state.touchEligible) return;
    state.touchEligible = true;
    applyVisibility();
  }, { passive: true, once: true });

  function applyVisibility() {
    if (state.modeVisible && state.touchEligible) {
      root.classList.remove('hidden');
    } else {
      root.classList.add('hidden');
      // Ensure released state so a hidden joystick doesn't keep steering.
      resetKnob();
    }
  }

  function ringCenter() {
    const rect = ring.getBoundingClientRect();
    return {
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
      r: rect.width / 2,
    };
  }

  function resetKnob() {
    state.direction = { x: 0, y: 0, mag: 0 };
    state.pointerId = null;
    knob.style.transform = 'translate(-50%, -50%)';
    root.classList.remove('joystick-active');
  }

  // Update knob visual + steering vector from a pointer at (clientX, clientY).
  // The knob visually clamps so its outer edge kisses the ring's inner rim
  // (never crosses the screen corner); the steering vector saturates at
  // mag=1 at that same reachable rim, so drag-past-rim keeps steering full.
  function updateKnob(clientX, clientY) {
    const { cx, cy, r } = ringCenter();
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    // Knob half-diameter in the same units as `r` (ring bounding rect).
    const knobHalf = (r * 2 * CONFIG.JOYSTICK_KNOB_FRAC) / 2;
    const maxTravel = Math.max(0, r - knobHalf);
    const clamped = Math.min(dist, maxTravel);
    const kx = dist > 0 ? (dx / dist) * clamped : 0;
    const ky = dist > 0 ? (dy / dist) * clamped : 0;
    knob.style.transform =
      `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    state.direction = steerFromOffset(
      dx, dy, maxTravel, CONFIG.JOYSTICK_DEADZONE_FRAC,
    );
  }

  root.addEventListener('pointerdown', (e) => {
    // A second finger elsewhere must not steal the knob.
    if (state.pointerId !== null) return;
    state.pointerId = e.pointerId;
    root.setPointerCapture?.(e.pointerId);
    root.classList.add('joystick-active');
    updateKnob(e.clientX, e.clientY);
    // Prevent this touch from also triggering hybrid mouse events on the
    // canvas below (defensive; hit testing already routes touches here).
    e.preventDefault();
    onAnyGesture?.();
  });

  root.addEventListener('pointermove', (e) => {
    if (e.pointerId !== state.pointerId) return;
    updateKnob(e.clientX, e.clientY);
    e.preventDefault();
  });

  const endPointer = (e) => {
    if (e.pointerId !== state.pointerId) return;
    resetKnob();
    // Some browsers auto-release capture on pointerup; be idempotent.
    if (root.hasPointerCapture?.(e.pointerId)) {
      root.releasePointerCapture(e.pointerId);
    }
  };
  root.addEventListener('pointerup', endPointer);
  root.addEventListener('pointercancel', endPointer);
  // A lost capture (e.g. dialog appears, tab switches) must also snap home.
  root.addEventListener('lostpointercapture', endPointer);

  return {
    direction: () => state.direction,
    setPlayMode(isPlaying) {
      state.modeVisible = !!isPlaying;
      applyVisibility();
    },
    root,
  };
}
