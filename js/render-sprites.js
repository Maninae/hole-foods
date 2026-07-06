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

// A tumbling (airborne) unit mid-avalanche. Position (u.x, u.y) is the
// unit's ground shadow center; the sprite lifts by u.z (a fake vertical
// height) and spins by u.rot. The shadow is drawn separately in the shadow
// pass so a later sprite doesn't cover a neighbor's shadow.
export function drawTumbling(ctx, u, av, t, dpr) {
  const rScreen = av.unitR * t.scale;
  const sx = u.x * t.scale + t.tx;
  const sy = u.y * t.scaleY + t.ty;
  // Screen-space lift: z is a world-Y-equivalent, projected the same way
  // ground-plane objects are (via t.scaleY / ISO squash) so the sprite
  // reads as truly airborne.
  const liftScreen = u.z * t.scaleY;
  drawEmoji(ctx, u.obj.e, sx, sy - liftScreen - rScreen * 0.22, rScreen, u.rot, dpr);
}

// Tumbling unit's ground shadow: shrinks and lightens with height so the
// eye reads the sprite as lifted off the plane. Called from render.js's
// shadow pass (before the airborne sprite itself is drawn).
export function drawTumblingShadow(ctx, u, av, t, baseAlpha) {
  const rScreen = av.unitR * t.scale;
  // z in world units — normalize by unit diameter for the falloff curve.
  const zNorm = u.z / (2 * av.unitR);
  const falloff = 1 / (1 + zNorm * 0.9);
  const alpha = baseAlpha * falloff;
  if (alpha <= 0.002) return;
  const sx = u.x * t.scale + t.tx;
  const sy = u.y * t.scaleY + t.ty;
  const rx = rScreen * 0.75 * falloff;
  const ry = rx * 0.38;
  ctx.fillStyle = `rgba(25, 20, 50, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

// A tower group as a vertical strip of upright sprites, bottom-up.
// State branches:
//   - idle/stacked: sits at pivot with lift, jitter, perspective, sway.
//   - pre-lean:     during an avalanche's Jenga beat, the whole column
//                   tilts by an interpolated angle away from the hole.
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

  // Any active avalanche for this tower? It supplies pre-lean angle and
  // authoritative pivot (the tower.baseX/Y already got seeded from it in
  // render.js if one exists).
  const av = sw.avalanches.find((a) => a.stackId === tw.stackId);

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
  const effectiveBase = baseStackIdx;

  // Collapse animation: the column keeps deforming for the full
  // STACK_AVAL_COLLAPSE_ANIM_TIME window (matches FALL_TIME so the sag
  // completes right as the base finalizes into the pit). Two axes:
  //   Lean grows from 0 to STACK_AVAL_COLLAPSE_LEAN_DEG over the window,
  //   with an early ease to STACK_AVAL_PRELEAN_DEG at PRELEAN_TIME so
  //   the Jenga "losing balance" read still lands crisp.
  //   Sink lifts the column downward (in screen-y) proportional to a
  //   fraction of a unit's height, matching the base's descent — the
  //   column follows its base into the pit instead of standing rigid.
  // Without this, still-stacked members froze at the PRELEAN pose from
  // t=0.15 onward while the base was being swallowed. Owner playtest.
  let preLeanAngle = 0;
  let preLeanSign = 0;
  let collapseSinkPx = 0;
  if (av && av.preLeanUntil > 0) {
    const k = Math.min(1, av.t / CONFIG.STACK_AVAL_COLLAPSE_ANIM_TIME);
    // Piecewise ease: linear to PRELEAN_DEG over PRELEAN_TIME, then
    // continue growing to COLLAPSE_LEAN_DEG over the rest of the window.
    const kBeat = Math.min(1, av.t / av.preLeanUntil);
    const preDeg = CONFIG.STACK_AVAL_PRELEAN_DEG * kBeat;
    const beatFrac = av.preLeanUntil / CONFIG.STACK_AVAL_COLLAPSE_ANIM_TIME;
    const post = Math.max(0, (k - beatFrac) / (1 - beatFrac));
    const postDeg = (CONFIG.STACK_AVAL_COLLAPSE_LEAN_DEG
                     - CONFIG.STACK_AVAL_PRELEAN_DEG) * post;
    preLeanAngle = (preDeg + postDeg) * DEG;
    // Sign follows the ON-SCREEN x-projection of the fall direction: an
    // east-west tip leans full, a pure north/south tip does not lean on
    // the screen-horizontal axis (its projection is nearly zero). Using
    // just sign(dirX) would make a pure-north tip lean right by mistake.
    preLeanSign = av.dirX;
    collapseSinkPx = k * CONFIG.STACK_AVAL_COLLAPSE_SINK_FRAC * unitHeightScreen;
  }

  // Idle sway: the column pivots as one body around its base. Amplitude
  // ramps with height. Phase per-stack from a stable hash. Reduced motion
  // cuts it entirely. Pre-lean overrides the sway (the column is losing
  // balance, not idling).
  let swayAngle = 0;
  if (!REDUCED_MOTION && !av) {
    const heightRamp = Math.min(1, aliveHeight / CONFIG.STACK_SWAY_HEIGHT_REF);
    const amp = CONFIG.STACK_SWAY_TOP_DEG * DEG * heightRamp;
    const phase = hash01(tw.stackId, 0, 0x5a17) * Math.PI * 2;
    swayAngle = amp * Math.sin((time * 2 * Math.PI) / CONFIG.STACK_SWAY_PERIOD + phase);
  }
  // Compose sway with pre-lean into one column-wide rotation.
  const columnAngle = swayAngle + preLeanAngle * preLeanSign;

  // Soft ambient-occlusion capsule behind the column — subtle dark shape
  // that binds the sprites into one silhouette. Skipped during an
  // avalanche (the column is fragmenting; the capsule would trail wrong).
  if (!av && aliveHeight >= 2) {
    const capsuleWidth = unitHeightScreen * CONFIG.STACK_CAPSULE_WIDTH;
    const capsuleHeight = (aliveHeight - 1) * step + unitHeightScreen;
    const capsuleTopLift = (topStackIdx - effectiveBase) * step + rScreen * 0.22 + rScreen;
    ctx.save();
    ctx.translate(baseScreenX, baseScreenY - rScreen * 0.22);
    ctx.rotate(columnAngle);
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

  // columnAngle is loop-invariant; hoist its sin/cos out of the per-unit
  // draw so a 20-tower scene doesn't spend thousands of trig calls per
  // frame in the hot path.
  const cosCol = Math.cos(columnAngle);
  const sinCol = Math.sin(columnAngle);

  // Draw bottom-up so later (upper) sprites overlap earlier ones.
  const sorted = [...tw.members].sort((a, b) => a.stackIdx - b.stackIdx);
  for (const o of sorted) {
    const stackIdx = o.stackIdx;
    // 'idle' or 'stacked': upright at the pivot, lifted by column position,
    // with per-unit jitter + perspective + column-wide rotation.
    const rowFromBase = stackIdx - baseStackIdx;
    const p = stackIdx - effectiveBase;
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

    // Position: local (jx, -lift) around the base, rotated by column angle
    // (sway + pre-lean, hoisted above).
    const lx = jx;
    const ly = -lift - rScreen * 0.22;
    const sx = baseScreenX + lx * cosCol - ly * sinCol;
    // Sink the column with the base's descent into the pit (avalanche only,
    // 0 otherwise). Applied in screen space post-rotation so the tilt pivot
    // stays at the ground plane.
    const sy = baseScreenY + collapseSinkPx + lx * sinCol + ly * cosCol;

    const unitTilt = unitLean(baseTilt, rowFromBase);
    const leanRot = unitTilt * leanSign;
    drawEmoji(ctx, o.e, sx, sy, rDraw, (o.rot || 0) + leanRot + jrot + columnAngle, dpr);
  }
}
