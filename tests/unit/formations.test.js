// Formations: multi-column stacks (pyramid, prism) that share a formationId.
// Each column is an ordinary stack (own stackId + own idx run + own avalanche);
// the formation binds them for visual grouping and CHAIN DESTABILIZATION.
//
// Covers: worldgen determinism (same seed => same formation shapes),
// profile shapes (pyramid triangular, prism flat), chain rolls deterministic
// + bounded, one-topple-per-formation gating at the event layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createWorld, ensureChunksAround,
} from '../../js/world.js';
import { createHole } from '../../js/hole.js';
import { formationCapsuleBBox } from '../../js/render-sprites.js';
import { createSwallow, swallowUpdate } from '../../js/swallow.js';
import {
  pyramidProfile, prismProfile, formationColumnOffsets, hashFormationRoll,
} from '../../js/formations.js';

// --- Helpers --------------------------------------------------------------

function allObjects(world) {
  const out = [];
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) out.push(o);
  }
  return out;
}

function formationsIn(world) {
  const groups = new Map();
  for (const o of allObjects(world)) {
    if (!o.formationId) continue;
    let g = groups.get(o.formationId);
    if (!g) {
      g = { id: o.formationId, kind: o.formationKind, columns: new Map() };
      groups.set(o.formationId, g);
    }
    let col = g.columns.get(o.columnIdx);
    if (!col) { col = []; g.columns.set(o.columnIdx, col); }
    col.push(o);
  }
  return groups;
}

// --- Profile shape --------------------------------------------------------

test('pyramidProfile returns a symmetric triangular height profile', () => {
  // Peak k gives [1, 2, ..., k-1, k, k-1, ..., 2, 1], total k^2.
  assert.deepEqual(pyramidProfile(1), [1]);
  assert.deepEqual(pyramidProfile(2), [1, 2, 1]);
  assert.deepEqual(pyramidProfile(3), [1, 2, 3, 2, 1]);
  assert.deepEqual(pyramidProfile(4), [1, 2, 3, 4, 3, 2, 1]);
  for (const k of [2, 3, 4, 5, 6]) {
    const p = pyramidProfile(k);
    assert.equal(p.length, 2 * k - 1);
    assert.equal(p[0], 1);
    assert.equal(p[p.length - 1], 1);
    assert.equal(p[k - 1], k);
    // Total unit count = k^2 (triangular squared).
    assert.equal(p.reduce((a, b) => a + b, 0), k * k);
  }
});

test('prismProfile is flat: W columns all at height H, total W*H', () => {
  assert.deepEqual(prismProfile(3, 8), [8, 8, 8]);
  assert.deepEqual(prismProfile(4, 14), [14, 14, 14, 14]);
  const p = prismProfile(4, 14);
  assert.equal(p.reduce((a, b) => a + b, 0), 4 * 14);
});

test('formationColumnOffsets returns evenly-spaced 1D offsets centered on 0', () => {
  // K columns spaced by `spacing`, centered on 0.
  const offs = formationColumnOffsets(3, 20);
  assert.equal(offs.length, 3);
  assert.equal(offs[0], -20);
  assert.equal(offs[1], 0);
  assert.equal(offs[2], 20);
  const off2 = formationColumnOffsets(4, 20);
  // Even count: still centered on 0.
  assert.equal(off2.length, 4);
  const sum = off2.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) < 1e-9, `expected centered offsets, sum=${sum}`);
  // Adjacent spacing constant.
  for (let i = 1; i < off2.length; i++) {
    assert.ok(Math.abs((off2[i] - off2[i - 1]) - 20) < 1e-9);
  }
});

// --- Worldgen determinism ------------------------------------------------

test('worldgen: same seed produces identical formation shapes and columns', () => {
  const a = createWorld('formation-seed-a');
  const b = createWorld('formation-seed-a');
  ensureChunksAround(a, 0, 0, 6000, 6000);
  ensureChunksAround(b, 0, 0, 6000, 6000);
  const fa = formationsIn(a);
  const fb = formationsIn(b);
  assert.equal(fa.size, fb.size, `formation counts differ: ${fa.size} vs ${fb.size}`);
  // Same ids, same column shape per formation.
  for (const [id, ga] of fa) {
    const gb = fb.get(id);
    assert.ok(gb, `formation ${id} missing in b`);
    assert.equal(gb.kind, ga.kind);
    assert.equal(gb.columns.size, ga.columns.size);
    const heightsA = [...ga.columns.entries()].sort((x, y) => x[0] - y[0])
      .map(([, list]) => list.length);
    const heightsB = [...gb.columns.entries()].sort((x, y) => x[0] - y[0])
      .map(([, list]) => list.length);
    assert.deepEqual(heightsA, heightsB, `formation ${id} column heights diverged`);
  }
});

test('worldgen: different seeds diverge (at least one formation shape differs)', () => {
  const a = createWorld('formation-seed-a');
  const b = createWorld('formation-seed-b');
  ensureChunksAround(a, 0, 0, 6000, 6000);
  ensureChunksAround(b, 0, 0, 6000, 6000);
  const fa = formationsIn(a);
  const fb = formationsIn(b);
  // Either the id set diverges (very likely) or heights do.
  const idsA = [...fa.keys()].sort().join('|');
  const idsB = [...fb.keys()].sort().join('|');
  assert.notEqual(idsA, idsB);
});

// --- Chain rolls ---------------------------------------------------------

test('hashFormationRoll is deterministic and in [0, 1)', () => {
  const a1 = hashFormationRoll('F0:0,0:f7', 2, 0xdead);
  const a2 = hashFormationRoll('F0:0,0:f7', 2, 0xdead);
  assert.equal(a1, a2);
  assert.ok(a1 >= 0 && a1 < 1, `roll out of range: ${a1}`);
  // Different indices should almost always give different rolls.
  const b = hashFormationRoll('F0:0,0:f7', 3, 0xdead);
  assert.notEqual(a1, b);
});

// --- Chain destabilization (integration) --------------------------------

test('chain: eating a column base cascades adjacent still-standing columns', () => {
  // Seed a synthetic prism directly: 3 columns of 10 units each, arranged
  // along +x. Verify that after the middle column starts an avalanche,
  // the adjacent columns receive delayed initiateCollapse triggers.
  const w = createWorld('chain-fixture');
  ensureChunksAround(w, 0, 0, 6000, 6000);
  const groups = formationsIn(w);
  // Find any tall multi-column formation to exercise the chain path.
  let f = null;
  for (const g of groups.values()) {
    if (g.columns.size >= 2) { f = g; break; }
  }
  assert.ok(f, 'need at least one multi-column formation in the fixture world');

  // Grab the first column's base and tip it into a big hole.
  const cols = [...f.columns.entries()].sort((a, b) => a[0] - b[0]);
  const firstCol = cols[0][1];
  firstCol.sort((a, b) => a.stackIdx - b.stackIdx);
  const base = firstCol[0];

  const hole = createHole();
  hole.r = base.r * 4;
  hole.potential = hole.r;
  hole.level = 20;
  hole.x = base.x - 1; hole.y = base.y;
  const sw = createSwallow();

  // Tick until the first column's avalanche is running.
  let elapsed = 0;
  while (sw.avalanches.length === 0 && elapsed < 2) {
    swallowUpdate(sw, 1 / 60, elapsed, w, hole);
    elapsed += 1 / 60;
  }
  assert.ok(sw.avalanches.length >= 1, 'first column avalanche should have started');
  const startedIds = new Set(sw.avalanches.map((a) => a.stackId));

  // Let chain delays elapse (upper-bound the chain window).
  for (let i = 0; i < 60; i++) {
    swallowUpdate(sw, 1 / 60, elapsed, w, hole);
    elapsed += 1 / 60;
  }
  const afterIds = new Set(sw.avalanches.map((a) => a.stackId));
  // Also count columns that already finalized (avalanche removed).
  const eaten = w.eaten.get(base.ck) ?? new Set();
  const collapsedColumnIds = new Set();
  for (const [, col] of cols) {
    if (col.some((o) => eaten.has(o.idx))) {
      collapsedColumnIds.add(col[0].stackId);
    }
  }
  // At least one MORE column beyond the first should have been triggered.
  const triggered = new Set([...startedIds, ...afterIds, ...collapsedColumnIds]);
  assert.ok(triggered.size > startedIds.size,
    `chain did not fire: only ${triggered.size} column(s) triggered from ${cols.length}`);
});

// --- One-topple-per-formation gating -------------------------------------

test('achievement gating: only the first column of a formation emits an achievement-qualifying topple', () => {
  const w = createWorld('gating-fixture');
  ensureChunksAround(w, 0, 0, 6000, 6000);
  const groups = formationsIn(w);
  let f = null;
  for (const g of groups.values()) {
    // Need a formation whose columns are all tall enough that each
    // column would independently qualify (>= STACK_TOPPLE_MIN).
    let allTall = true;
    for (const col of g.columns.values()) {
      if (col.length < CONFIG.STACK_TOPPLE_MIN) { allTall = false; break; }
    }
    if (allTall && g.columns.size >= 2) { f = g; break; }
  }
  assert.ok(f, 'need a multi-column formation with all columns tall enough');

  const cols = [...f.columns.entries()].sort((a, b) => a[0] - b[0]);
  const firstBase = cols[0][1].sort((a, b) => a.stackIdx - b.stackIdx)[0];
  const hole = createHole();
  hole.r = firstBase.r * 4;
  hole.potential = hole.r;
  hole.level = 20;
  hole.x = firstBase.x - 1; hole.y = firstBase.y;
  const sw = createSwallow();

  // Drive the sim long enough for the entire formation to finish collapsing.
  const events = [];
  let t = 0;
  for (let i = 0; i < 60 * 12 && (sw.avalanches.length > 0 || t < 1); i++) {
    const step = swallowUpdate(sw, 1 / 60, t, w, hole);
    for (const ev of step) events.push(ev);
    t += 1 / 60;
  }
  const topples = events.filter((e) => e.type === 'topple');
  const qualifying = topples.filter((e) => e.achievement === true);
  assert.ok(topples.length >= 2, `expected >=2 topple events (all columns), got ${topples.length}`);
  assert.equal(qualifying.length, 1,
    `exactly one achievement-qualifying topple per formation, got ${qualifying.length}`);
  // The qualifying event carries the formation's full unit count (>= single column).
  assert.ok(qualifying[0].unitCount >= cols[0][1].length,
    'qualifying unitCount should reflect the whole formation, not one column');
});

// --- Capsule geometry (regression: reviewer-caught bbox-diagonal bug) -----

test('formationCapsuleBBox contains every column silhouette regardless of axis quadrant', () => {
  const t = { scale: 1, scaleY: 0.72, tx: 0, ty: 0 };
  const mkTower = (x, y, h, r) => ({
    baseX: x, baseY: y, unitR: r,
    members: Array.from({ length: h }, (_, i) => ({ state: i === 0 ? 'idle' : 'stacked', stackIdx: i })),
  });
  // Mixed-sign axis (dx > 0, dy < 0): the quadrant the old bbox-diagonal
  // formula reflected wrong.
  const towers = [
    mkTower(0, 0, 2, 20),
    mkTower(45, -18, 4, 20),
    mkTower(90, -36, 2, 20),
  ];
  const box = formationCapsuleBBox(towers, t);
  assert.ok(box, 'bbox exists');
  const unitH = 2 * 20 * t.scale;
  const step = unitH * CONFIG.STACK_UNIT_OVERLAP;
  const halfW = unitH * CONFIG.STACK_CAPSULE_WIDTH / 2;
  for (const tw of towers) {
    const sx = tw.baseX * t.scale + t.tx;
    const sy = tw.baseY * t.scaleY + t.ty;
    const top = sy - 20 * 0.22 - ((tw.members.length - 1) * step + unitH);
    assert.ok(sx - halfW >= box.x - 0.01 && sx + halfW <= box.x + box.w + 0.01,
      `column at ${tw.baseX} escapes capsule horizontally`);
    assert.ok(top >= box.y - 0.01, `column top at ${tw.baseX} escapes capsule`);
    assert.ok(sy <= box.y + box.h + 0.01, `column base at ${tw.baseX} escapes capsule`);
  }
  // Quadrant-free: mirroring the axis (dy sign flip) gives identical extents.
  const mirrored = towers.map((tw) => mkTower(tw.baseX, -tw.baseY, tw.members.length, 20));
  const box2 = formationCapsuleBBox(mirrored, t);
  assert.ok(Math.abs(box.w - box2.w) < 0.01 && Math.abs(box.h - box2.h) < 0.01,
    'capsule extents must not depend on axis quadrant');
});
