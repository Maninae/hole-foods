// Billboard sprite drawing: singles + tower groups. Called from render.js's
// billboard pass with the transform already reset to CSS-pixel space, so
// each helper maps world -> screen manually per sprite. Pure draw code —
// no state, no side effects beyond the ctx.
//
// Tower rendering (Part A cues):
//   - Tight unit overlap (~0.55) so units visibly SIT on each other.
//   - Deterministic per-unit x-jitter + rotation (hashed by stackId+idx) —
//     hand-stacked feel, stable frame to frame.
//   - Perspective scale (~+1.5%/idx, cap +25%) — higher = closer to camera.
//   - Idle sway around the base pivot: ~2-3° at the tip of a tall column,
//     ramped by height. THIS is the cue that separates a live column from a
//     ground line — the ground never moves.
//   - Soft dark capsule behind the column + widened base shadow — ambient
//     occlusion that binds the sprites into one silhouette.

import { CONFIG } from './config.js';
import { drawEmoji } from './sprites.js';
import { unitLean } from './stacks.js';

const DEG = Math.PI / 180;

// Prefers-reduced-motion: idle sway disabled. Cached at module load; a user
// toggling the OS setting mid-run keeps the current mode (matches
// levelfx's reducedMotion snapshot pattern in main.js).
const REDUCED_MOTION = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Deterministic FNV-1a-ish hash → float in [-1, 1]. Salt lets us pull
// independent streams for x-jitter, rotation, sway phase, etc. from the
// same (stackId, stackIdx) key.
function hash01(stackId, stackIdx, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < stackId.length; i++) {
    h ^= stackId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= stackIdx + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

// A plain-single sprite: upright, lifted so it stands on the ground plane,
// with the rim teeter lean applied horizontally toward the hole.
export function drawSingle(ctx, o, hole, t, dpr) {
  const sx = o.x * t.scale + t.tx;
  const sy = o.y * t.scaleY + t.ty;
  const rScreen = o.r * t.scale;
  const lift = rScreen * 0.22;
  const tilt = o.tilt || 0;
  let leanRot = 0;
  let sink = 0;
  if (tilt) {
    const dx = hole.x - o.x;
    const dy = hole.y - o.y;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    const sign = Math.max(-1, Math.min(1, dx / dist));
    leanRot = tilt * sign;
    sink = tilt * o.r * 0.25 * t.scale;
  }
  drawEmoji(ctx, o.e, sx, sy - lift + sink, rScreen, (o.rot || 0) + leanRot, dpr);
}

// A tower group as a vertical strip of upright sprites, bottom-up.
// State branches:
//   - idle/stacked: sits at pivot with lift, jitter, perspective, sway.
//   - toppling:     legacy rigid-rotation branch (used until Part B lands).
export function drawTower(ctx, tw, hole, sw, t, dpr, time) {
  const rScreen = tw.unitR * t.scale;
  const unitHeightScreen = 2 * rScreen; // billboard vertical diameter
  const step = unitHeightScreen * CONFIG.STACK_UNIT_OVERLAP;
  const baseScreenX = tw.baseX * t.scale + t.tx;
  const baseScreenY = tw.baseY * t.scaleY + t.ty;

  // Column-wide teeter lean direction: horizontal-only, toward the hole.
  let leanSign = 0;
  if (tw.tilt) {
    const dx = hole.x - tw.baseX;
    const dy = hole.y - tw.baseY;
    const dist = Math.max(Math.hypot(dx, dy), 1);
    leanSign = Math.max(-1, Math.min(1, dx / dist));
  }
  const baseTilt = tw.tilt || 0;

  // Any active slump / topple driving this tower?
  const slump = sw.slumps.find((s) => s.stackId === tw.stackId);
  const topple = sw.topples.find((tp) => tp.stackId === tw.stackId);

  // Determine baseStackIdx: lowest idle/stacked stackIdx among members
  // (the "effective ground" of the column). Tower height = max - base + 1
  // among alive members, used to scale the sway amplitude.
  let baseStackIdx = Infinity;
  let topStackIdx = -Infinity;
  for (const m of tw.members) {
    if (m.state === 'idle' || m.state === 'stacked') {
      if (m.stackIdx < baseStackIdx) baseStackIdx = m.stackIdx;
      if (m.stackIdx > topStackIdx) topStackIdx = m.stackIdx;
    }
  }
  if (!isFinite(baseStackIdx)) baseStackIdx = 0;
  if (!isFinite(topStackIdx)) topStackIdx = baseStackIdx;
  const aliveHeight = Math.max(1, topStackIdx - baseStackIdx + 1);

  const slumpProgress = slump ? Math.min(1, slump.t / slump.duration) : 0;
  const effectiveBase = slump ? slump.oldBaseStackIdx + slumpProgress : baseStackIdx;

  const toppleAngle = topple ? Math.min(1, topple.t / topple.duration) * (Math.PI / 2) : 0;

  // Idle sway: the column pivots as one body around its base. Amplitude
  // ramps with height (so 6-unit piles barely move, tall columns wave
  // noticeably at the tip). Phase per-stack from a stable hash. Reduced
  // motion cuts it entirely.
  let swayAngle = 0;
  if (!REDUCED_MOTION && !topple) {
    const heightRamp = Math.min(1, aliveHeight / CONFIG.STACK_SWAY_HEIGHT_REF);
    const amp = CONFIG.STACK_SWAY_TOP_DEG * DEG * heightRamp;
    const phase = hash01(tw.stackId, 0, 0x5a17) * Math.PI * 2;
    swayAngle = amp * Math.sin((time * 2 * Math.PI) / CONFIG.STACK_SWAY_PERIOD + phase);
  }

  // Soft ambient-occlusion capsule behind the column — subtle dark shape
  // that binds the sprites into one silhouette. Skipped during slump/topple
  // (the column is moving; the capsule would trail wrong).
  if (!slump && !topple && aliveHeight >= 2) {
    const capsuleWidth = unitHeightScreen * CONFIG.STACK_CAPSULE_WIDTH;
    const capsuleHeight = (aliveHeight - 1) * step + unitHeightScreen;
    const capsuleTopLift = (topStackIdx - effectiveBase) * step + rScreen * 0.22 + rScreen;
    ctx.save();
    ctx.translate(baseScreenX, baseScreenY - rScreen * 0.22);
    ctx.rotate(swayAngle);
    ctx.fillStyle = `rgba(20, 12, 34, ${CONFIG.STACK_CAPSULE_ALPHA})`;
    ctx.beginPath();
    const radius = Math.min(capsuleWidth * 0.5, capsuleHeight * 0.3);
    // Roundrect: manual path so we don't depend on ctx.roundRect (broad support).
    const x0 = -capsuleWidth / 2;
    const y0 = -capsuleTopLift;
    const w = capsuleWidth;
    const h = capsuleHeight;
    ctx.moveTo(x0 + radius, y0);
    ctx.lineTo(x0 + w - radius, y0);
    ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + radius);
    ctx.lineTo(x0 + w, y0 + h - radius);
    ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - radius, y0 + h);
    ctx.lineTo(x0 + radius, y0 + h);
    ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - radius);
    ctx.lineTo(x0, y0 + radius);
    ctx.quadraticCurveTo(x0, y0, x0 + radius, y0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Draw bottom-up so later (upper) sprites overlap earlier ones.
  const sorted = [...tw.members].sort((a, b) => a.stackIdx - b.stackIdx);
  for (const o of sorted) {
    const stackIdx = o.stackIdx;
    if (o.state === 'toppling') {
      // Legacy rigid-rotation branch (still active until Part B replaces it).
      const s = Math.sin(toppleAngle);
      const c = Math.cos(toppleAngle);
      const h = (stackIdx + 0.5) * unitHeightScreen;
      const dirX = topple ? topple.dirX : 1;
      const dirY = topple ? topple.dirY : 0;
      const spacingScale = topple ? topple.scale : 1;
      const worldHoriz = (stackIdx + 0.5) * 2 * tw.unitR * spacingScale * s;
      const worldX = tw.baseX + dirX * worldHoriz;
      const worldY = tw.baseY + dirY * worldHoriz;
      const sx = worldX * t.scale + t.tx;
      const sy = worldY * t.scaleY + t.ty - h * c;
      drawEmoji(ctx, o.e, sx, sy, rScreen, (o.rot || 0), dpr);
      continue;
    }

    // 'idle' or 'stacked': upright at the pivot, lifted by column position,
    // with per-unit jitter + perspective + sway rotation about the base.
    const rowFromBase = stackIdx - baseStackIdx;
    const p = stackIdx - effectiveBase; // takes into account slump progress
    const lift = p * step;

    // Deterministic per-unit jitter (never changes frame-to-frame).
    const jx = hash01(tw.stackId, stackIdx, 0x11) * CONFIG.STACK_JITTER_X * unitHeightScreen;
    const jrot = hash01(tw.stackId, stackIdx, 0x22) * CONFIG.STACK_JITTER_ROT_DEG * DEG;

    // Perspective: higher units are closer to the camera, so scale up.
    const persp = Math.min(
      CONFIG.STACK_PERSPECTIVE_CAP,
      CONFIG.STACK_PERSPECTIVE * Math.max(0, rowFromBase),
    );
    const rDraw = rScreen * (1 + persp);

    // Position: local (jx, -lift) around the base, rotated by sway.
    const cosS = Math.cos(swayAngle);
    const sinS = Math.sin(swayAngle);
    const lx = jx;
    const ly = -lift - rScreen * 0.22;
    const sx = baseScreenX + lx * cosS - ly * sinS;
    const sy = baseScreenY + lx * sinS + ly * cosS;

    const unitTilt = unitLean(baseTilt, rowFromBase);
    const leanRot = unitTilt * leanSign;
    drawEmoji(ctx, o.e, sx, sy, rDraw, (o.rot || 0) + leanRot + jrot + swayAngle, dpr);
  }
}
