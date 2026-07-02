// Scene renderer: ground -> decals -> hole (pit, falling, rim) -> objects
// -> effects. Owns the canvas + DPR; camera math comes from camera.js.

import { getTransform } from './camera.js';
import { drawGround } from './ground.js';
import { forEachChunkInRect } from './world.js';
import { drawEmoji } from './sprites.js';
import { fallingVisual } from './swallow.js';
import { drawFx } from './particles.js';
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
}

export function renderScene(R, state) {
  const { world, hole, cam, sw, fx, time } = state;
  const { ctx, w, h, dpr } = R;
  const t = getTransform(cam, w, h);
  const screenScale = t.scale * dpr;

  ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, dpr * t.tx, dpr * t.ty);
  const x0 = -t.tx / t.scale;
  const y0 = -t.ty / t.scale;
  const x1 = x0 + w / t.scale;
  const y1 = y0 + h / t.scale;

  drawGround(ctx, world, x0, y0, x1, y1);

  // Ground decals.
  ctx.globalAlpha = 0.5;
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const d of chunk.decals) {
      if (d.x < x0 - d.r || d.x > x1 + d.r || d.y < y0 - d.r || d.y > y1 + d.r) continue;
      drawEmoji(ctx, d.e, d.x, d.y, d.r, d.rot, screenScale);
    }
  });
  ctx.globalAlpha = 1;

  drawHole(ctx, hole, sw, time, screenScale);

  // Collect visible idle objects, painter-sorted by y. Sub-pixel objects
  // (deep-inner cycles seen from far out) aren't worth a draw call.
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

  // Shadows first so they never land on a neighbor's sprite.
  ctx.fillStyle = 'rgba(25, 20, 50, 0.16)';
  for (const o of visible) {
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + o.r * 0.55, o.r * 0.78, o.r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  for (const o of visible) {
    // Tease ring on almost-fitting objects near the hole: "grow a bit more".
    if (o.r > fitLimit && o.r < fitLimit * 1.45) {
      const d = Math.hypot(o.x - hole.x, o.y - hole.y);
      if (d < hole.r * 3.2 + o.r) {
        ctx.globalAlpha = 0.28 + 0.18 * Math.sin(time * 5);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(1.5, o.r * 0.06);
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r * 1.12, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    drawEmoji(ctx, o.e, o.x, o.y, o.r, o.rot, screenScale);
  }

  drawFx(ctx, fx, cam.zoom);
}
