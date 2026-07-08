// Hole-occlusion visibility layer.
//
// The bug this fixes: the ground pass draws the hole (pit + rim + progress
// meter). The billboard pass then paints every sprite on top — the hole
// never participates in the y-sort. Driving under a building sprite whose
// base radius is much larger than the hole made the hole 100% invisible
// for the full length of the sprite pass.
//
// Two mechanisms, cheap and pure:
//   1. Occluder fade — any billboard sprite (or tower group) that CANNOT
//      be swallowed (base r > hole.r * FIT_FACTOR) and whose screen bbox
//      overlaps the hole's screen ellipse-bbox is drawn at reduced alpha
//      (~0.35). Fittable objects are exempt so the teeter animation
//      always plays at full alpha. This module supplies the decision
//      predicate; the alpha wrap happens in render.js.
//   2. Overlay rim — when the hole is occluded, draw a screen-space
//      ellipse (rim) plus a gold progress arc AFTER the billboard pass,
//      so the level cue never vanishes even at odd alpha stacks. Fades
//      in over OVERLAY_FADE_S so it never pops. Invisible when nothing
//      is covering the hole.
//
// Pure module: no DOM references except in drawHoleOverlay, which receives
// its ctx from the renderer. Predicates and math are testable in Node.

import { CONFIG } from './config.js';
import { holeProgress } from './hole.js';

// Re-exported so render.js has one import site for the whole feature.
// The values live in config.js like every other tuning knob.
export const OCCLUDER_ALPHA = CONFIG.OCCLUDER_ALPHA;
export const OVERLAY_FADE_S = CONFIG.OVERLAY_FADE_S;

// Screen-space AABB intersection (edge-touching counts as overlap; the
// hole tangent to a sprite still needs the fade to kick in).
export function bboxIntersect(a, b) {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

// Hole's screen ellipse bbox. The ground pass squashes Y by ISO_Y, so a
// world circle of radius r becomes an ellipse rx = r*scale, ry = r*scaleY.
export function holeScreenBBox(hole, t) {
  const cx = hole.x * t.scale + t.tx;
  const cy = hole.y * t.scaleY + t.ty;
  const rx = hole.r * t.scale;
  const ry = hole.r * t.scaleY;
  return { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry, cx, cy, rx, ry };
}

// A single billboard sprite's screen bbox. The sprite is drawn upright
// (unsquashed) at (sx, sy - lift), with radius rScreen = o.r * scale.
// So it spans ~2*rScreen vertically upward from (sy - lift) and the
// contact-shadow ellipse sits just below sy.
export function singleScreenBBox(o, t) {
  const sx = o.x * t.scale + t.tx;
  const sy = o.y * t.scaleY + t.ty;
  const rScreen = o.r * t.scale;
  const lift = rScreen * 0.22;
  return {
    x0: sx - rScreen,
    x1: sx + rScreen,
    y0: sy - lift - 2 * rScreen,
    y1: sy + rScreen * 0.4,
  };
}

// Tower's screen bbox: column reaches from the base upward by
// (aliveHeight-1) * unit overlap step + one unit. Width padded a bit
// for jitter + perspective slop. Alive units are 'idle' or 'stacked' —
// tumbling / falling members are already handled elsewhere and their
// position isn't at the base.
export function towerScreenBBox(tw, t) {
  const baseScreenX = tw.baseX * t.scale + t.tx;
  const baseScreenY = tw.baseY * t.scaleY + t.ty;
  const rScreen = tw.unitR * t.scale;
  const unitHeightScreen = 2 * rScreen;
  const step = unitHeightScreen * CONFIG.STACK_UNIT_OVERLAP;
  let alive = 0;
  for (const m of tw.members) {
    if (m.state === 'idle' || m.state === 'stacked') alive++;
  }
  if (alive < 1) alive = 1;
  const columnHeight = (alive - 1) * step + unitHeightScreen;
  const widthScale = 1.15; // jitter + perspective + capsule slop
  const halfW = rScreen * widthScale;
  return {
    x0: baseScreenX - halfW,
    x1: baseScreenX + halfW,
    y0: baseScreenY - columnHeight - rScreen * 0.22,
    y1: baseScreenY + rScreen * 0.4,
  };
}

// A single object fades when it's an occluder — too big to swallow AND
// its screen bbox overlaps the hole's screen bbox. The fit test uses
// FIT_FACTOR (same threshold as the swallow logic), so anything the
// player can teeter onto stays full alpha.
export function shouldFadeSingle(o, hole, holeBox, t) {
  if (o.r <= hole.r * CONFIG.FIT_FACTOR) return false;
  return bboxIntersect(singleScreenBBox(o, t), holeBox);
}

// A tower fades if its BASE unit is too big to swallow AND the whole
// column's screen bbox overlaps the hole. Fittable-base towers stay
// full-alpha so the eat-through-tower combo chain reads.
export function shouldFadeTower(tw, hole, holeBox, t) {
  if (tw.unitR <= hole.r * CONFIG.FIT_FACTOR) return false;
  return bboxIntersect(towerScreenBBox(tw, t), holeBox);
}

// Ease the overlay alpha toward 1 (occluded) or 0 (clear). Linear in dt
// over OVERLAY_FADE_S — symmetric and snappy. Clamped to [0, 1].
export function advanceOverlayFade(current, occluded, dt) {
  const step = dt / OVERLAY_FADE_S;
  const target = occluded ? 1 : 0;
  if (current === target) return target;
  const delta = target > current ? step : -step;
  const next = current + delta;
  if (delta > 0) return next >= target ? target : next;
  return next <= target ? target : next;
}

// Always-visible hole overlay: a crisp screen-space rim ellipse plus the
// gold progress arc, drawn AFTER the billboard pass so it survives
// whatever painted over the ground-pass hole. Alpha is the current fade
// (0 = invisible, 1 = full).
//
// The rim ellipse uses the same rx/ry the ground pass computes, so it
// aligns with the pit underneath — no double-image when the overlay
// fades in during a partial occlusion.
export function drawHoleOverlay(ctx, hole, t, alpha) {
  if (alpha <= 0.001) return;
  const cx = hole.x * t.scale + t.tx;
  const cy = hole.y * t.scaleY + t.ty;
  const rx = hole.r * t.scale;
  const ry = hole.r * t.scaleY;
  ctx.save();
  // Rim: crisp off-white line so the mouth stays readable through any
  // sprite alpha. Thin (~2 CSS px) — we don't want to double-draw against
  // the ground-pass rim during a partial fade.
  ctx.globalAlpha = alpha * 0.95;
  ctx.strokeStyle = 'rgba(255, 248, 236, 1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Progress arc: the level cue that would otherwise vanish under a
  // building. Same 12-o'clock start as the ground-pass meter.
  const p = holeProgress(hole);
  if (p > 0.005) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}

// Alpha for near-cull specks: objects whose screen radius approaches the
// sub-pixel cull melt out smoothly instead of lingering as crisp, worthless
// dots (outgrown lower-cycle leftovers) or popping when their level drops
// out of the LOD set. 0 at/below minPx (caller skips the draw), 1 at/above
// fullPx, linear in between.
export function sizeFadeAlpha(screenR, minPx, fullPx) {
  if (screenR <= minPx) return 0;
  if (screenR >= fullPx) return 1;
  return (screenR - minPx) / (fullPx - minPx);
}

// Extra SOUTH cull margin, in ground-plane world-y units, for a standing
// column member. Columns are upright billboards: a base south of the
// screen bottom can still have its top peeking into view, so the render
// cull must accept bases up to the column's screen height below the edge
// (without this, a skyscraper popped in whole the moment its base crossed
// the edge — owner feedback). The column extends (stackH−1) overlap-steps
// plus ~1.5 sprite radii (half-height + base lift + perspective) above the
// base; screen-vertical px divide by scaleY, so world-y divides by ISO_Y.
// Every member shares (x, y) and stackH, so a column passes or fails the
// cull as one unit and drawTower always sees the full alive column.
// Chunk visits are already covered: PAD=3 padded queries reach farther
// south than any column is tall.
export function columnCullExtraY(o) {
  if (!o.stackId || o.landed) return 0;
  if (o.state !== 'idle' && o.state !== 'stacked') return 0;
  const stackH = o.stackH || 1;
  const columnScreenExtent = (stackH - 1) * 2 * o.r * CONFIG.STACK_UNIT_OVERLAP
    + 1.5 * o.r;
  return columnScreenExtent / CONFIG.ISO_Y;
}
