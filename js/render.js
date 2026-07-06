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
import { drawSingle, drawTower, drawTumbling, drawTumblingShadow } from './render-sprites.js';

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

  // Visible objects — plain singles, tower groups (stacked+idle column
  // members), and airborne "tumbling" units (mid-avalanche ballistic
  // bodies drawn independently with their own ground shadows). Sub-pixel
  // objects are skipped for cheap LOD.
  const visible = [];             // {type: 'single'|'tower'|'tumbling', y, ...}
  const towerGroups = new Map();  // stackId -> {members, baseX, baseY, unitR, ...}
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    for (const o of chunk.objects) {
      if (o.r * t.scale < 1) continue;
      const m = o.r * 1.4;
      // Tumbling units may have flown off their chunk rect — skip the rect
      // filter for them (they get culled later by the airborne loop below).
      if (o.state !== 'tumbling') {
        if (o.x < x0 - m || o.x > x1 + m || o.y < y0 - m || o.y > y1 + m) continue;
      }
      const isColumnMember = o.stackId && !o.landed
        && (o.state === 'idle' || o.state === 'stacked');
      if (isColumnMember) {
        let tw = towerGroups.get(o.stackId);
        if (!tw) {
          tw = {
            stackId: o.stackId,
            members: [],
            baseX: o.x, baseY: o.y,
            unitR: o.r, e: o.e, hue: o.hue, rot: o.rot || 0,
            tilt: 0,
          };
          // If an avalanche is running for this tower (pre-lean phase),
          // use its cached pivot so the still-stacked units draw around
          // the authoritative pre-lean base, not whichever member
          // happened to iterate first.
          const av = sw.avalanches.find((a) => a.stackId === o.stackId);
          if (av) {
            tw.baseX = av.baseX;
            tw.baseY = av.baseY;
            tw.unitR = av.unitR;
          }
          towerGroups.set(o.stackId, tw);
        }
        tw.members.push(o);
        if (o.state === 'idle') tw.tilt = o.tilt || 0;
      } else if (o.state === 'idle') {
        // Plain single (includes landed post-avalanche units).
        visible.push({ type: 'single', y: o.y, obj: o });
      }
      // 'tumbling' units are handled below in the airborne loop.
    }
  });
  // Merge tower groups into the sortable list.
  for (const tw of towerGroups.values()) {
    visible.push({ type: 'tower', y: tw.baseY, tower: tw });
  }
  // Add airborne tumbling units by walking sw.avalanches directly — they
  // move independently of chunk objects during flight, so we pull real
  // positions off the avalanche's unit sim state.
  for (const av of sw.avalanches) {
    for (const u of av.units.values()) {
      if (u.phase !== 'tumbling') continue;
      // Rough cull: skip if visibly off-screen with generous padding.
      const m = av.unitR * 3;
      if (u.x < x0 - m || u.x > x1 + m || u.y < y0 - m || u.y > y1 + m) continue;
      visible.push({ type: 'tumbling', y: u.y, u, av });
    }
  }
  visible.sort((a, b) => a.y - b.y);

  drawHole(ctx, hole, sw, time, screenScale, t.scale);

  // Tease ring on almost-fitting singles — an arc here becomes an ellipse
  // on the ground plane, so it reads as a ring flat on the floor. Tower
  // bases can also tease if their base radius sits in the fit window.
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  for (const item of visible) {
    // Airborne (tumbling) units don't get a tease ring — they're already
    // committed to the mound; rendering a "just barely too big" flourish
    // over a body in flight reads as noise.
    if (item.type === 'tumbling') continue;
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
  // shadow instead of the reverse. Towers get a widened/darker base shadow
  // (Part A: the column reads as ONE object). Airborne tumbling units get
  // their OWN small shadow that stays on the ground while the sprite lifts
  // — the shadow-vs-sprite separation is the readability cue for height.
  const baseShadowAlpha = 0.18;
  for (const item of visible) {
    if (item.type === 'tumbling') {
      drawTumblingShadow(ctx, item.u, item.av, t, baseShadowAlpha);
      continue;
    }
    let cx; let cy; let cr; let alpha = baseShadowAlpha;
    let widen = 1;
    if (item.type === 'single') {
      const o = item.obj;
      cx = o.x; cy = o.y; cr = o.r;
    } else {
      cx = item.tower.baseX; cy = item.tower.baseY; cr = item.tower.unitR;
      widen = CONFIG.STACK_SHADOW_WIDEN;
      alpha = baseShadowAlpha * CONFIG.STACK_SHADOW_DARKEN;
      // Fade the tower's base shadow as an avalanche progresses: the
      // stacked column above the base shrinks unit-by-unit, so the wide
      // dark ellipse under the pivot becomes wrong. By the time every
      // unit has detached, the tower is gone — hide the shadow entirely.
      const av = sw.avalanches.find((a) => a.stackId === item.tower.stackId);
      if (av) {
        const remainingStacked = [...av.units.values()]
          .filter((u2) => u2.phase === 'stacked').length;
        const total = av.units.size;
        const frac = total ? remainingStacked / total : 0;
        alpha *= frac;
        if (alpha <= 0.001) continue;
      }
    }
    ctx.fillStyle = `rgba(25, 20, 50, ${alpha})`;
    const sx = cx * t.scale + t.tx;
    const sy = cy * t.scaleY + t.ty;
    const rx = cr * 0.8 * t.scale * widen;
    const ry = rx * 0.38;
    ctx.beginPath();
    ctx.ellipse(sx, sy + ry * 0.35, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sprites, y-sorted. Singles lift so they stand on the ground plane;
  // towers draw as a vertical strip of upright sprites with jitter,
  // perspective, and sway (Part A); airborne tumbling units render at
  // their (x, y) lifted by z with spin (Part B).
  for (const item of visible) {
    if (item.type === 'single') {
      drawSingle(ctx, item.obj, hole, t, dpr);
    } else if (item.type === 'tumbling') {
      drawTumbling(ctx, item.u, item.av, t, dpr);
    } else {
      drawTower(ctx, item.tower, hole, sw, t, dpr, time);
    }
  }

  // Score floaters last: upright, min-screen-size, straight onto CSS px.
  drawFxText(ctx, fx, t);

  // Level-up hero: pillar, sparkles, big title, milestone screen flash.
  // Drawn after floaters so the celebration reads on top of everything.
  if (levelFx) drawLevelFxBillboard(ctx, levelFx, t, w, h);
}
