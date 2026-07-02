import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../js/rng.js';
import { PATTERN_KEYS, layoutCluster } from '../../js/patterns.js';

const ITEM_R = 15;

function minPairDist(pts) {
  let min = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      min = Math.min(min, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    }
  }
  return min;
}

test('every pattern yields >= 5 finite positions', () => {
  for (const key of PATTERN_KEYS) {
    for (let s = 0; s < 5; s++) {
      const pts = layoutCluster(makeRng(`${key}-${s}`), key, ITEM_R);
      assert.ok(pts.length >= 5, `${key} seed ${s}: only ${pts.length} positions`);
      for (const p of pts) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${key}: non-finite position`);
      }
    }
  }
});

test('patterns do not overlap items heavily (min pairwise dist >= 1.6 * itemR)', () => {
  for (const key of PATTERN_KEYS) {
    for (let s = 0; s < 8; s++) {
      const pts = layoutCluster(makeRng(`${key}-dist-${s}`), key, ITEM_R);
      const d = minPairDist(pts);
      assert.ok(d >= ITEM_R * 1.6, `${key} seed ${s}: min dist ${d.toFixed(1)} < ${ITEM_R * 1.6}`);
    }
  }
});

test('layouts are deterministic for the same rng seed', () => {
  for (const key of PATTERN_KEYS) {
    const a = layoutCluster(makeRng('det'), key, ITEM_R);
    const b = layoutCluster(makeRng('det'), key, ITEM_R);
    assert.deepEqual(a, b, `${key} not deterministic`);
  }
});

test('cluster extent stays bounded (fits reasonable chunk placement)', () => {
  for (const key of PATTERN_KEYS) {
    for (let s = 0; s < 5; s++) {
      const pts = layoutCluster(makeRng(`${key}-ext-${s}`), key, ITEM_R);
      for (const p of pts) {
        const dist = Math.hypot(p.x, p.y);
        assert.ok(dist <= ITEM_R * 16, `${key}: position ${dist.toFixed(0)} too far from center`);
      }
    }
  }
});
