// Billboard sprite drawing: singles + tower groups. Called from render.js's
// billboard pass with the transform already reset to CSS-pixel space, so
// each helper maps world -> screen manually per sprite. Pure draw code —
// no state, no side effects beyond the ctx.

import { CONFIG } from './config.js';
import { drawEmoji } from './sprites.js';
import { unitLean } from './stacks.js';

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
//   - static/idle: units at stackIdx k render at lift = (k - baseIdx) * step
//   - slumping:    lift = (k - baseIdx - progress) * step  (smooth drop)
//   - toppling:    each unit rotates about the base pivot 0..90°
// The base's teeter tilt drives the whole column's lean, amplified up.
export function drawTower(ctx, tw, hole, sw, t, dpr) {
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
  // (the "effective ground" of the column).
  let baseStackIdx = Infinity;
  for (const m of tw.members) {
    if (m.state === 'idle' || m.state === 'stacked') {
      if (m.stackIdx < baseStackIdx) baseStackIdx = m.stackIdx;
    }
  }
  if (!isFinite(baseStackIdx)) baseStackIdx = 0;

  const slumpProgress = slump ? Math.min(1, slump.t / slump.duration) : 0;
  const effectiveBase = slump ? slump.oldBaseStackIdx + slumpProgress : baseStackIdx;

  const toppleAngle = topple ? Math.min(1, topple.t / topple.duration) * (Math.PI / 2) : 0;

  // Draw bottom-up so later (upper) sprites overlap earlier ones.
  const sorted = [...tw.members].sort((a, b) => a.stackIdx - b.stackIdx);
  for (const o of sorted) {
    const stackIdx = o.stackIdx;
    let sx; let sy; let leanRot;
    if (o.state === 'toppling') {
      const s = Math.sin(toppleAngle);
      const c = Math.cos(toppleAngle);
      const h = (stackIdx + 0.5) * unitHeightScreen;
      const dirX = topple ? topple.dirX : 1;
      const dirY = topple ? topple.dirY : 0;
      const spacingScale = topple ? topple.scale : 1;
      // Rotate the unit's up-vector by toppleAngle: horizontal displacement
      // along the fall direction (compressed by the landing-line cap so a
      // deep-cycle giant fits inside the base chunk's PAD window), vertical
      // compression by cos. The column's rotation about the base pivot is
      // the whole visual — no per-sprite lean here (a near-vertical fall
      // where dirX≈0 would otherwise flip sign arbitrarily on the sprite).
      const worldHoriz = (stackIdx + 0.5) * 2 * tw.unitR * spacingScale * s;
      const worldX = tw.baseX + dirX * worldHoriz;
      const worldY = tw.baseY + dirY * worldHoriz;
      sx = worldX * t.scale + t.tx;
      sy = worldY * t.scaleY + t.ty - h * c;
      leanRot = 0;
    } else {
      // 'idle' or 'stacked' — upright at the pivot, lifted by column position.
      const p = stackIdx - effectiveBase;
      const lift = p * step;
      const unitTilt = unitLean(baseTilt, stackIdx - baseStackIdx);
      leanRot = unitTilt * leanSign;
      sx = baseScreenX;
      sy = baseScreenY - lift - rScreen * 0.22;
    }
    drawEmoji(ctx, o.e, sx, sy, rScreen, (o.rot || 0) + leanRot, dpr);
  }
}
