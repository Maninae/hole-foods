// Scene renderer: two passes.
//  1. Ground plane (squashed by ISO_Y): ground, decals, hole pit/rim/falling,
//     tease rings, and fx particles/rings. Arcs drawn here become ellipses
//     for free — that's what sells the pseudo-3D.
//  2. Billboard (unsquashed): contact shadows, sprites drawn upright and
//     lifted so they stand on the plane, and score floaters at screen size.
//     Sprites (and their shadows) that CANNOT be swallowed and cover the
//     hole are drawn at reduced alpha (OCCLUDER_ALPHA) so the hole never
//     disappears behind a building. Fittable objects are exempt so the
//     teeter animation always plays at full alpha.
//  3. Screen-space overlay: when anything faded this frame, an off-white
//     rim ellipse + gold progress arc is painted on top so the level cue
//     survives even the most stubborn stack. Fades in over OVERLAY_FADE_S
//     and is invisible in open-field play.
// Owns the canvas + DPR; camera math comes from camera.js.

import { getTransform } from './camera.js';
import { drawGround } from './ground.js';
import { forEachChunkInRect } from './world.js';
import { drawEmoji } from './sprites.js';
import { drawFxWorld, drawFxText } from './particles.js';
import { drawLevelFxGround, drawLevelFxBillboard } from './levelfx.js';
import { CONFIG } from './config.js';
import { drawSingle, drawTower, drawTumbling, drawTumblingShadow } from './render-sprites.js';
import { drawHole } from './render-hole.js';
import {
  holeScreenBBox, shouldFadeSingle, shouldFadeTower,
  advanceOverlayFade, drawHoleOverlay, OCCLUDER_ALPHA,
} from './render-overlay.js';

export function createRenderer(canvas) {
  const R = {
    canvas,
    ctx: canvas.getContext('2d'),
    w: 0, h: 0, dpr: 1,
    // Overlay-fade state: eases 0..1 as the hole becomes occluded and
    // back to 0 when nothing covers it. Persists across frames so the
    // rim overlay can't pop in/out.
    overlayFade: 0,
    lastTime: 0,
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

  // Occlusion fade decisions. A single or tower is an occluder if it
  // can't be swallowed (base r > hole.r * FIT_FACTOR) AND its screen
  // bbox overlaps the hole's screen ellipse-bbox. Fittable items are
  // exempt so teeter stays fully readable; tumbling units are exempt
  // (mid-collapse, already committed to the mound). The predicate is
  // pure — see js/render-overlay.js.
  const holeBox = holeScreenBBox(hole, t);
  let anyOccluded = false;
  for (const item of visible) {
    if (item.type === 'single') {
      item.fade = shouldFadeSingle(item.obj, hole, holeBox, t);
    } else if (item.type === 'tower') {
      item.fade = shouldFadeTower(item.tower, hole, holeBox, t);
    } else {
      item.fade = false;
    }
    if (item.fade) anyOccluded = true;
  }

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
  // Occluder shadows also fade — a full-alpha shadow through a faded sprite
  // reads as a floating puddle.
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
    if (item.fade) alpha *= OCCLUDER_ALPHA;
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
  // their (x, y) lifted by z with spin (Part B). Occluders (item.fade)
  // draw at OCCLUDER_ALPHA so the hole's pit + rim beneath remain
  // readable — the genre-standard "big thing in front becomes see-through".
  for (const item of visible) {
    if (item.fade) {
      ctx.save();
      ctx.globalAlpha = OCCLUDER_ALPHA;
    }
    if (item.type === 'single') {
      drawSingle(ctx, item.obj, hole, t, dpr);
    } else if (item.type === 'tumbling') {
      drawTumbling(ctx, item.u, item.av, t, dpr);
    } else {
      drawTower(ctx, item.tower, hole, sw, t, dpr, time);
    }
    if (item.fade) ctx.restore();
  }

  // Screen-space hole overlay: rim ellipse + gold progress arc. Fades
  // in over OVERLAY_FADE_S when the hole is occluded, out at the same
  // rate. Invisible in open-field play (fade=0) so it never double-
  // draws against the ground-pass rim.
  const dt = Math.max(0, Math.min(0.1, time - R.lastTime));
  R.lastTime = time;
  R.overlayFade = advanceOverlayFade(R.overlayFade, anyOccluded, dt);
  drawHoleOverlay(ctx, hole, t, R.overlayFade);

  // Score floaters last: upright, min-screen-size, straight onto CSS px.
  drawFxText(ctx, fx, t);

  // Level-up hero: pillar, sparkles, big title, milestone screen flash.
  // Drawn after floaters so the celebration reads on top of everything.
  if (levelFx) drawLevelFxBillboard(ctx, levelFx, t, w, h);
}
