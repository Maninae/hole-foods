// Pure predicates for the hole-occlusion fix: screen-space bbox math,
// fade decision for singles + tower groups (fittable objects exempt so
// teeter stays fully readable), and hole-overlay fade state advancement.
// The painting itself lives in render.js and is screenshot-verified —
// this file only covers the pure math.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  bboxIntersect,
  holeScreenBBox,
  singleScreenBBox,
  towerScreenBBox,
  shouldFadeSingle,
  shouldFadeTower,
  advanceOverlayFade,
  OCCLUDER_ALPHA,
  OVERLAY_FADE_S,
} from '../../js/render-overlay.js';

// Identity transform: 1 world unit = 1 css pixel, no offset. Y still gets
// squashed by ISO_Y so the hole/ground read as an ellipse.
function idTransform() {
  return { scale: 1, scaleY: CONFIG.ISO_Y, tx: 0, ty: 0 };
}

test('bboxIntersect: overlapping rects report true', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const b = { x0: 5, y0: 5, x1: 15, y1: 15 };
  assert.equal(bboxIntersect(a, b), true);
});

test('bboxIntersect: separated rects report false', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const b = { x0: 20, y0: 0, x1: 30, y1: 10 };
  assert.equal(bboxIntersect(a, b), false);
});

test('bboxIntersect: edge-touching rects report true (a shared edge overlaps)', () => {
  const a = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const b = { x0: 10, y0: 0, x1: 20, y1: 10 };
  assert.equal(bboxIntersect(a, b), true);
});

test('bboxIntersect: nested rect reports true', () => {
  const outer = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const inner = { x0: 40, y0: 40, x1: 50, y1: 50 };
  assert.equal(bboxIntersect(outer, inner), true);
});

test('holeScreenBBox: rx = r * scale, ry squashed by ISO_Y', () => {
  const hole = { x: 0, y: 0, r: 30 };
  const box = holeScreenBBox(hole, idTransform());
  assert.equal(box.rx, 30);
  assert.ok(Math.abs(box.ry - 30 * CONFIG.ISO_Y) < 1e-9);
  assert.equal(box.cx, 0);
  assert.equal(box.cy, 0);
});

test('singleScreenBBox extends up by ~2r (upright + lifted) and slightly below', () => {
  const o = { x: 0, y: 0, r: 20 };
  const b = singleScreenBBox(o, idTransform());
  // Width: about 2r wide, centered on sx.
  assert.ok(Math.abs(b.x0 + 20) < 1e-9);
  assert.ok(Math.abs(b.x1 - 20) < 1e-9);
  // Sprite reaches upward at least the 2r sprite height above the ground.
  assert.ok(b.y0 <= -2 * 20, `y0=${b.y0} should be at least -40 (upright + lift)`);
});

test('towerScreenBBox height scales with alive stack height', () => {
  const t = idTransform();
  const shortTw = {
    baseX: 0, baseY: 0, unitR: 15,
    members: [
      { state: 'idle', stackIdx: 0 },
      { state: 'stacked', stackIdx: 1 },
      { state: 'stacked', stackIdx: 2 },
    ],
  };
  const tallTw = {
    baseX: 0, baseY: 0, unitR: 15,
    members: Array.from({ length: 20 }, (_, i) => ({
      state: i === 0 ? 'idle' : 'stacked', stackIdx: i,
    })),
  };
  const sb = towerScreenBBox(shortTw, t);
  const tb = towerScreenBBox(tallTw, t);
  const sh = sb.y1 - sb.y0;
  const th = tb.y1 - tb.y0;
  assert.ok(th > sh * 2, `taller tower bbox must be taller: short=${sh} tall=${th}`);
});

test('towerScreenBBox ignores tumbling/falling members when counting alive units', () => {
  const t = idTransform();
  const tw = {
    baseX: 0, baseY: 0, unitR: 15,
    members: [
      { state: 'idle', stackIdx: 0 },
      { state: 'tumbling', stackIdx: 1 },
      { state: 'tumbling', stackIdx: 2 },
    ],
  };
  const b = towerScreenBBox(tw, t);
  // Only 1 alive unit; bbox height ~= one unit diameter, not three.
  const height = b.y1 - b.y0;
  assert.ok(height < 15 * 3, `height=${height} should reflect only the alive base unit`);
});

test('shouldFadeSingle: fittable object never fades (teeter must stay readable)', () => {
  const hole = { x: 0, y: 0, r: 50 };
  // r just under the fit limit — should be treated as swallowable.
  const fittable = { x: 0, y: 0, r: 50 * CONFIG.FIT_FACTOR - 0.5 };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeSingle(fittable, hole, holeBox, idTransform()),
    false,
    'fittable single overlapping the hole must NOT fade',
  );
});

test('shouldFadeSingle: too-big object over the hole fades', () => {
  const hole = { x: 0, y: 0, r: 26.4 };
  // Big building-like sprite parked right over the hole.
  const building = { x: 0, y: 0, r: 138 };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeSingle(building, hole, holeBox, idTransform()),
    true,
    'oversized single covering the hole must fade',
  );
});

test('shouldFadeSingle: too-big object off-screen from the hole does NOT fade', () => {
  const hole = { x: 0, y: 0, r: 26.4 };
  const farBuilding = { x: 10000, y: 10000, r: 138 };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeSingle(farBuilding, hole, holeBox, idTransform()),
    false,
    'oversized single far from the hole must NOT fade',
  );
});

test('shouldFadeTower: fittable base — whole tower stays full alpha', () => {
  const hole = { x: 0, y: 0, r: 100 };
  const tw = {
    baseX: 0, baseY: 0, unitR: 20, // 20 < 100 * FIT_FACTOR
    members: [
      { state: 'idle', stackIdx: 0 },
      { state: 'stacked', stackIdx: 1 },
      { state: 'stacked', stackIdx: 2 },
    ],
  };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeTower(tw, hole, holeBox, idTransform()),
    false,
    'tower whose base fits must NOT fade — the teeter needs to be readable',
  );
});

test('shouldFadeTower: non-fittable base overlapping the hole fades as a group', () => {
  const hole = { x: 0, y: 0, r: 26.4 };
  const tw = {
    baseX: 0, baseY: 0, unitR: 120,
    members: [
      { state: 'idle', stackIdx: 0 },
      { state: 'stacked', stackIdx: 1 },
    ],
  };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeTower(tw, hole, holeBox, idTransform()),
    true,
    'oversized tower over the hole must fade',
  );
});

test('shouldFadeTower: non-fittable base whose bbox misses the hole does NOT fade', () => {
  const hole = { x: 0, y: 0, r: 26.4 };
  const tw = {
    baseX: 5000, baseY: 5000, unitR: 120,
    members: [
      { state: 'idle', stackIdx: 0 },
      { state: 'stacked', stackIdx: 1 },
    ],
  };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeTower(tw, hole, holeBox, idTransform()),
    false,
  );
});

test('shouldFadeTower: tall tower reaching over the hole from beside it fades', () => {
  // The visual failure mode: a tall building sits just past the hole in Y
  // but its billboard column reaches back over the hole in screen space.
  const hole = { x: 0, y: 0, r: 26.4 };
  const tw = {
    baseX: 0, baseY: 40, unitR: 60, // base y=40 (below hole in world),
    members: Array.from({ length: 12 }, (_, i) => ({
      state: i === 0 ? 'idle' : 'stacked', stackIdx: i,
    })),
  };
  const holeBox = holeScreenBBox(hole, idTransform());
  assert.equal(
    shouldFadeTower(tw, hole, holeBox, idTransform()),
    true,
    'a tall column reaching back over the hole must fade',
  );
});

test('OCCLUDER_ALPHA is in the low-alpha range (<= 0.5)', () => {
  assert.ok(OCCLUDER_ALPHA > 0 && OCCLUDER_ALPHA <= 0.5,
    `alpha=${OCCLUDER_ALPHA} should be low but non-zero`);
});

test('advanceOverlayFade: eases toward 1 when occluded, toward 0 when not', () => {
  // dt = full fade window: fade should reach 1 (or close) from 0.
  const full = advanceOverlayFade(0, true, OVERLAY_FADE_S);
  assert.ok(full >= 0.95, `should be near 1 after a full-window dt when occluded, got ${full}`);
  // Symmetric: fade to 0 at the same rate.
  const drop = advanceOverlayFade(1, false, OVERLAY_FADE_S);
  assert.ok(drop <= 0.05, `should be near 0 after full-window dt not occluded, got ${drop}`);
});

test('advanceOverlayFade: partial dt yields partial fade', () => {
  const half = advanceOverlayFade(0, true, OVERLAY_FADE_S * 0.5);
  assert.ok(half > 0 && half < 1, `partial fade should be in (0,1), got ${half}`);
});

test('advanceOverlayFade: clamps to [0, 1]', () => {
  assert.equal(advanceOverlayFade(0, false, 10), 0);
  const overshot = advanceOverlayFade(0.99, true, 10);
  assert.ok(overshot <= 1);
});
