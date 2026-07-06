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
import { holeProgress } from './hole.js';
import { drawFxWorld, drawFxText } from './particles.js';
import { drawLevelFxGround, drawLevelFxBillboard } from './levelfx.js';
import { CONFIG } from './config.js';
import { drawSingle, drawTower } from './render-sprites.js';

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

function drawHole(ctx, hole, sw, time, screenScale, zoom) {
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
  const progress = holeProgress(hole);
  // Never thinner than ~4.5 CSS px, whatever the zoom — a just-leveled hole
  // must still show a readable (mostly empty) meter.
  const meterW = Math.max(lw * 1.1, r * 0.075, 4.5 / zoom);
  const meterR = r + lw * 1.2 + meterW * 1.4;
  ctx.strokeStyle = 'rgba(20, 10, 32, 0.3)';
  ctx.lineWidth = meterW * 1.5;
  ctx.beginPath();
  ctx.arc(x, y, meterR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = meterW;
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
  const { world, hole, cam, sw, fx, levelFx, time } = state;
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

  // Visible objects — plain singles (state='idle') plus tower groups
  // (columns of stacked/toppling units drawn as one thing, sorted by the
  // pivot y). Sub-pixel objects/towers are skipped for cheap LOD.
  const visible = [];             // plain singles: {type: 'single', y, obj}
  const towerGroups = new Map();  // stackId -> {members, baseX, baseY, unitR, e, hue, rot, tilt, sortY}
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const o of chunk.objects) {
      if (o.r * t.scale < 1) continue;
      const m = o.r * 1.4;
      if (o.x < x0 - m || o.x > x1 + m || o.y < y0 - m || o.y > y1 + m) continue;
      const isColumnMember = o.stackId && !o.landed
        && (o.state === 'idle' || o.state === 'stacked' || o.state === 'toppling');
      if (isColumnMember) {
        let tw = towerGroups.get(o.stackId);
        if (!tw) {
          tw = {
            stackId: o.stackId,
            members: [],
            // Pivot is the base's ground position. If a topple record
            // exists for this stackId, use its cached baseX/Y/unitR (the
            // authoritative pre-topple pivot); otherwise seed from the
            // first-iterated member. Toppling units don't move until
            // they land, so the two happen to agree today — the cache
            // makes that no longer load-bearing.
            baseX: o.x, baseY: o.y,
            unitR: o.r, e: o.e, hue: o.hue, rot: o.rot || 0,
            tilt: 0,
          };
          const tpForSeed = sw.topples.find((tp) => tp.stackId === o.stackId);
          if (tpForSeed) {
            tw.baseX = tpForSeed.baseX;
            tw.baseY = tpForSeed.baseY;
            tw.unitR = tpForSeed.unitR;
          }
          towerGroups.set(o.stackId, tw);
        }
        tw.members.push(o);
        if (o.state === 'idle') tw.tilt = o.tilt || 0;
      } else if (o.state === 'idle') {
        // Plain single (includes landed post-topple units).
        visible.push({ type: 'single', y: o.y, obj: o });
      }
    }
  });
  // Merge tower groups into the sortable list.
  for (const tw of towerGroups.values()) {
    visible.push({ type: 'tower', y: tw.baseY, tower: tw });
  }
  visible.sort((a, b) => a.y - b.y);

  drawHole(ctx, hole, sw, time, screenScale, t.scale);

  // Tease ring on almost-fitting singles — an arc here becomes an ellipse
  // on the ground plane, so it reads as a ring flat on the floor. Tower
  // bases can also tease if their base radius sits in the fit window.
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  for (const item of visible) {
    const o = item.type === 'single' ? item.obj : null;
    const twBase = item.type === 'tower'
      ? { x: item.tower.baseX, y: item.tower.baseY, r: item.tower.unitR }
      : null;
    const target = o || twBase;
    if (target.r <= fitLimit || target.r >= fitLimit * 1.45) continue;
    const d = Math.hypot(target.x - hole.x, target.y - hole.y);
    if (d >= hole.r * 3.2 + target.r) continue;
    ctx.globalAlpha = 0.28 + 0.18 * Math.sin(time * 5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.5, target.r * 0.06);
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r * 1.12, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  drawFxWorld(ctx, fx);

  // Level-up ground effects: expanding gold glow + staggered ring pulses.
  // Drawn last on the ground plane so they read over decals/tease rings.
  // Ground shapes are sized in screen units and converted to world coords,
  // so the ring/glow radius stays sane at any zoom.
  if (levelFx) drawLevelFxGround(ctx, levelFx, t, w, h);

  // --- Billboard pass (upright) ---
  // Sprites and shadows go straight to CSS-pixel space so nothing gets
  // vertically squished; we manually map world -> screen per draw.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Elliptical contact shadows first, so a later sprite covers a neighbor's
  // shadow instead of the reverse. Towers only get a single shadow at the
  // base pivot — no shadow per stacked unit. A toppling tower fades its
  // shadow with topple progress: at t=0 the whole column still stands
  // over the pivot, but by t=1 the base is gone and the strip has fallen
  // sideways, so the stationary shadow at the pivot is a visual lie
  // (also, it would pop out abruptly the frame the topple completes).
  const baseShadowAlpha = 0.18;
  for (const item of visible) {
    let cx; let cy; let cr; let alpha = baseShadowAlpha;
    if (item.type === 'single') {
      const o = item.obj;
      cx = o.x; cy = o.y; cr = o.r;
    } else {
      cx = item.tower.baseX; cy = item.tower.baseY; cr = item.tower.unitR;
      const tp = sw.topples.find((t2) => t2.stackId === item.tower.stackId);
      if (tp) {
        const k = Math.min(1, tp.t / tp.duration);
        alpha = baseShadowAlpha * (1 - k);
        if (alpha <= 0.001) continue; // fully faded — skip the ellipse entirely
      }
    }
    ctx.fillStyle = `rgba(25, 20, 50, ${alpha})`;
    const sx = cx * t.scale + t.tx;
    const sy = cy * t.scaleY + t.ty;
    const rx = cr * 0.8 * t.scale;
    const ry = rx * 0.38;
    ctx.beginPath();
    ctx.ellipse(sx, sy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sprites, y-sorted. Singles are lifted so they stand on the ground plane;
  // towers draw as a vertical strip of upright sprites, bottom-up, with the
  // base's teeter lean amplifying up the column.
  for (const item of visible) {
    if (item.type === 'single') {
      drawSingle(ctx, item.obj, hole, t, dpr);
    } else {
      drawTower(ctx, item.tower, hole, sw, t, dpr);
    }
  }

  // Score floaters last: upright, min-screen-size, straight onto CSS px.
  drawFxText(ctx, fx, t);

  // Level-up hero: pillar, sparkles, big title, milestone screen flash.
  // Drawn after floaters so the celebration reads on top of everything.
  if (levelFx) drawLevelFxBillboard(ctx, levelFx, t, w, h);
}
