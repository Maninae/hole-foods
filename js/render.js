// Scene renderer: two passes.
//  1. Ground plane (squashed by ISO_Y): ground, decals, hole pit/rim/falling,
//     tease rings, and fx particles/rings. Arcs drawn here become ellipses
//     for free — that's what sells the pseudo-3D.
//  2. Billboard (unsquashed): contact shadows, sprites drawn upright and
//     lifted so they stand on the plane, and score floaters at screen size.
// Owns the canvas + DPR; camera math comes from camera.js.

import { getTransform } from './camera.js';
import { drawGround } from './ground.js';
import { forEachChunkInRect } from './world.js';
import { drawEmoji } from './sprites.js';
import { fallingVisual } from './swallow.js';
import { levelProgress } from './hole.js';
import { drawFxWorld, drawFxText } from './particles.js';
import { CONFIG } from './config.js';

export function createRenderer(canvas) {
  const R = {
    canvas,
    ctx: canvas.getContext('2d'),
    w: 0, h: 0, dpr: 1,
    resize() {
      R.dpr = Math.min(2, window.devicePixelRatio || 1);
      R.w = canvas.clientWidth;
      R.h = canvas.clientHeight;
      canvas.width = Math.round(R.w * R.dpr);
      canvas.height = Math.round(R.h * R.dpr);
    },
  };
  R.resize();
  return R;
}

function drawHole(ctx, hole, sw, time, screenScale) {
  const { x, y, r } = hole;

  // Soft ambient-occlusion halo so the pit sits "into" the ground.
  const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.35);
  halo.addColorStop(0, 'rgba(18, 8, 34, 0.32)');
  halo.addColorStop(1, 'rgba(18, 8, 34, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();

  // The pit.
  const pit = ctx.createRadialGradient(x, y - r * 0.12, r * 0.1, x, y, r);
  pit.addColorStop(0, '#050310');
  pit.addColorStop(0.75, '#150a2b');
  pit.addColorStop(1, '#241243');
  ctx.fillStyle = pit;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Anything mid-fall renders clipped inside the pit.
  if (sw.falling.length) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.99, 0, Math.PI * 2);
    ctx.clip();
    for (const f of sw.falling) {
      const v = fallingVisual(f, hole);
      ctx.globalAlpha = 0.55 + 0.45 * v.scale;
      drawEmoji(ctx, v.obj.e, v.x, v.y, v.obj.r * v.scale, v.rot, screenScale);
    }
    ctx.globalAlpha = 1;
    // Depth shading over the falling items, toward the pit edge.
    const depth = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    depth.addColorStop(0, 'rgba(5, 3, 16, 0)');
    depth.addColorStop(1, 'rgba(5, 3, 16, 0.6)');
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Slow-rotating shimmer inside the rim — keeps the hole feeling alive.
  ctx.save();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.setLineDash([r * 0.4, r * 0.55]);
  ctx.lineDashOffset = -time * r * 0.35;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rim: dark lip then a bright ring.
  const lw = Math.max(2.5, r * 0.055);
  ctx.strokeStyle = 'rgba(12, 6, 24, 0.85)';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r - lw * 0.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 248, 236, 0.95)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r + lw * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  // Level-progress meter around the mouth: fills clockwise from 12 o'clock
  // as the hole approaches its next size milestone. Drawn in the ground pass
  // so it hugs the rim ellipse like everything else. Width scales with the
  // hole so it stays ~4-6 screen px at any zoom (like the rim itself).
  const progress = levelProgress(r);
  const meterW = Math.max(lw * 1.1, r * 0.075);
  const meterR = r + lw * 1.2 + meterW * 1.4;
  ctx.strokeStyle = 'rgba(20, 10, 32, 0.28)';
  ctx.lineWidth = meterW + r * 0.02;
  ctx.beginPath();
  ctx.arc(x, y, meterR, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.005) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = meterW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, meterR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}

export function renderScene(R, state) {
  const { world, hole, cam, sw, fx, time } = state;
  const { ctx, w, h, dpr } = R;
  const t = getTransform(cam, w, h);
  const screenScale = t.scale * dpr;

  // --- Ground-plane pass (squashed by ISO_Y) ---
  ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scaleY, dpr * t.tx, dpr * t.ty);
  const x0 = -t.tx / t.scale;
  const x1 = x0 + w / t.scale;
  const y0 = -t.ty / t.scaleY;
  const y1 = y0 + h / t.scaleY;

  drawGround(ctx, world, x0, y0, x1, y1);

  // Ground decals (flat).
  ctx.globalAlpha = 0.5;
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const d of chunk.decals) {
      if (d.x < x0 - d.r || d.x > x1 + d.r || d.y < y0 - d.r || d.y > y1 + d.r) continue;
      drawEmoji(ctx, d.e, d.x, d.y, d.r, d.rot, screenScale);
    }
  });
  ctx.globalAlpha = 1;

  // Collect visible idle objects; sub-pixel skips deep-inner cycles cheaply.
  const visible = [];
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const o of chunk.objects) {
      if (o.state !== 'idle' || o.r * t.scale < 1) continue;
      const m = o.r * 1.4;
      if (o.x < x0 - m || o.x > x1 + m || o.y < y0 - m || o.y > y1 + m) continue;
      visible.push(o);
    }
  });
  visible.sort((a, b) => a.y - b.y);

  drawHole(ctx, hole, sw, time, screenScale);

  // Tease ring on almost-fitting objects — an arc here becomes an ellipse
  // on the ground plane, so it reads as a ring flat on the floor.
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  for (const o of visible) {
    if (o.r <= fitLimit || o.r >= fitLimit * 1.45) continue;
    const d = Math.hypot(o.x - hole.x, o.y - hole.y);
    if (d >= hole.r * 3.2 + o.r) continue;
    ctx.globalAlpha = 0.28 + 0.18 * Math.sin(time * 5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, o.r * 0.06);
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r * 1.12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawFxWorld(ctx, fx);

  // --- Billboard pass (upright) ---
  // Sprites and shadows go straight to CSS-pixel space so nothing gets
  // vertically squished; we manually map world -> screen per draw.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Elliptical contact shadows first, so a later sprite covers a neighbor's
  // shadow instead of the reverse.
  ctx.fillStyle = 'rgba(25, 20, 50, 0.18)';
  for (const o of visible) {
    const sx = o.x * t.scale + t.tx;
    const sy = o.y * t.scaleY + t.ty;
    const rx = o.r * 0.8 * t.scale;
    const ry = rx * 0.38;
    ctx.beginPath();
    ctx.ellipse(sx, sy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sprites, y-sorted, upright, lifted so they stand on the ground plane.
  for (const o of visible) {
    const sx = o.x * t.scale + t.tx;
    const sy = o.y * t.scaleY + t.ty;
    const rScreen = o.r * t.scale;
    const lift = rScreen * 0.22;

    // Teeter lean: horizontal-only, sign follows the hole direction; the
    // sprite also sinks a touch as if losing its footing over the void.
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

  // Score floaters last: upright, min-screen-size, straight onto CSS px.
  drawFxText(ctx, fx, t);
}
