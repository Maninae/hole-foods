// Vertical stacks ("towers"): worldgen determinism, base-only interactivity,
// slump promotion, topple threshold + landing, per-unit scoring, persistence
// through chunk unload + reload.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createWorld, ensureChunksAround, forEachObjectNear, markEaten, chunkKey,
} from '../../js/world.js';
import { createHole } from '../../js/hole.js';
import { pointsFor } from '../../js/catalog.js';
import { createSwallow, swallowUpdate } from '../../js/swallow.js';
import { groupStacks, aliveInStack, currentBaseOf } from '../../js/stacks.js';

// --- Helpers --------------------------------------------------------------

function allObjects(world) {
  const out = [];
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) out.push(o);
  }
  return out;
}

function towersIn(world) {
  const groups = new Map();
  for (const o of allObjects(world)) {
    if (!o.stackId) continue;
    let list = groups.get(o.stackId);
    if (!list) { list = []; groups.set(o.stackId, list); }
    list.push(o);
  }
  return groups;
}

function makeStackUnit(stackId, stackIdx, x, y, r, state) {
  return {
    id: `0:0,0:${stackIdx}`, idx: stackIdx, ck: '0:0,0', x, y, r,
    e: '🍎', hue: 0, up: false, rot: 0,
    points: pointsFor(r), state,
    vx: 0, vy: 0, tilt: 0,
    stackId, stackIdx,
  };
}

function makeStackFixture(height) {
  const objects = [];
  for (let k = 0; k < height; k++) {
    objects.push(makeStackUnit('S1', k, 0, 0, 10, k === 0 ? 'idle' : 'stacked'));
  }
  const world = createWorld('stack-test');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  return { world, hole: createHole(), sw: createSwallow() };
}

function runSeconds(sw, world, hole, seconds, startNow = 0) {
  const events = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    events.push(...swallowUpdate(sw, dt, startNow + t, world, hole));
  }
  return events;
}

// --- Worldgen determinism -------------------------------------------------

test('same seed generates identical towers; different seeds differ', () => {
  const a = createWorld('twr-alpha');
  const b = createWorld('twr-alpha');
  const c = createWorld('twr-beta');
  for (const w of [a, b, c]) ensureChunksAround(w, 0, 0, 3000, 3000);
  const asig = [...towersIn(a).entries()]
    .map(([id, list]) => `${id}:${list.length}:${list[0].e}:${list[0].x.toFixed(1)}:${list[0].y.toFixed(1)}`)
    .sort()
    .join('|');
  const bsig = [...towersIn(b).entries()]
    .map(([id, list]) => `${id}:${list.length}:${list[0].e}:${list[0].x.toFixed(1)}:${list[0].y.toFixed(1)}`)
    .sort()
    .join('|');
  const csig = [...towersIn(c).entries()]
    .map(([id, list]) => `${id}:${list.length}:${list[0].e}:${list[0].x.toFixed(1)}:${list[0].y.toFixed(1)}`)
    .sort()
    .join('|');
  assert.equal(asig, bsig);
  assert.notEqual(asig, csig);
});

test('towers spawn: at least one tower somewhere near the starter oasis', () => {
  // A newborn player should encounter a tower within a few oases.
  let found = 0;
  for (const seed of ['t1', 't2', 't3', 't4', 't5']) {
    const w = createWorld(seed);
    ensureChunksAround(w, 0, 0, 3000, 3000);
    const groups = towersIn(w);
    for (const list of groups.values()) {
      if (list.length >= 4) found++;
    }
  }
  assert.ok(found > 0, 'no towers generated across 5 seeds — worldgen is not spawning stacks');
});

test('within a tower, units share (x, y) and radius; stackIdx increases from 0', () => {
  const w = createWorld('twr-shape');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const groups = towersIn(w);
  assert.ok(groups.size > 0, 'need at least one tower');
  for (const list of groups.values()) {
    list.sort((a, b) => a.stackIdx - b.stackIdx);
    assert.equal(list[0].stackIdx, 0, 'stack must have an idx=0 base');
    for (let k = 1; k < list.length; k++) {
      assert.equal(list[k].stackIdx, k, 'stackIdx must be contiguous from 0');
      assert.ok(Math.abs(list[k].x - list[0].x) < 1e-6, 'stack units share x');
      assert.ok(Math.abs(list[k].y - list[0].y) < 1e-6, 'stack units share y');
      assert.ok(Math.abs(list[k].r - list[0].r) < 1e-6, 'stack units share r');
    }
  }
});

test('only the base of a fresh tower is idle; the rest are stacked', () => {
  const w = createWorld('twr-state');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const groups = towersIn(w);
  assert.ok(groups.size > 0, 'need at least one tower');
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.stackIdx - b.stackIdx);
    assert.equal(list[0].state, 'idle', 'base must be idle');
    for (let k = 1; k < list.length; k++) {
      assert.equal(list[k].state, 'stacked', `unit at idx ${k} must be stacked`);
    }
  }
});

// --- Base-only interactivity ---------------------------------------------

test('spatial queries yield only the base — stacked units are invisible to rim physics', () => {
  const { world, hole } = makeStackFixture(10);
  let hits = 0;
  forEachObjectNear(world, 0, 0, hole.r + 20, () => { hits++; });
  assert.equal(hits, 1, `only the base should be visible; got ${hits}`);
});

// --- Slump promotion ------------------------------------------------------

test('slump: eating the base promotes the next unit to idle after slump animation', () => {
  const { world, hole, sw } = makeStackFixture(4);
  // Tick once so the base tips (starts falling + slump). Then move the
  // hole away so the promoted next base doesn't get re-eaten by the
  // chain — the test isolates the "promoted base becomes idle" step.
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 5000; hole.y = 5000;
  // Enough time for the base fall and slump animation to fully finish.
  const events = runSeconds(sw, world, hole, CONFIG.FALL_TIME + 0.2, 1 / 60);
  const swallows = events.filter((e) => e.type === 'swallow');
  assert.equal(swallows.length, 1, 'exactly the base should be swallowed');
  const alive = aliveInStack(world, 'S1');
  assert.equal(alive.length, 3, '3 alive after eating base');
  const base = currentBaseOf(alive);
  assert.equal(base.stackIdx, 1, 'idx 1 is the new base');
  assert.equal(base.state, 'idle', 'new base must be idle');
});

test('slump: eating from the bottom feeds combos (chain of swallows)', () => {
  // A short-enough tower to slump repeatedly (below the topple threshold).
  const { world, hole, sw } = makeStackFixture(5);
  // Just long enough for the whole chain to eat through the tower, but
  // shorter than COMBO_WINDOW so the streak is still live at the end.
  const events = runSeconds(sw, world, hole, 1.5);
  const swallows = events.filter((e) => e.type === 'swallow');
  const comboEvents = events.filter((e) => e.type === 'combo');
  assert.ok(swallows.length >= 3, `expected several chained swallows, got ${swallows.length}`);
  assert.ok(comboEvents.length >= 1, 'no combo event fired during the chain');
  assert.ok(sw.streak >= CONFIG.COMBO_STEPS[0] || sw.mult >= 2,
    `expected a combo to be live, streak=${sw.streak} mult=${sw.mult}`);
});

// --- Avalanche collapse (Part B) -----------------------------------------
// Tall towers no longer topple as a rigid line — they detach unit-by-unit
// bottom-up, tumble ballistically, and land as a chaotic mound (still inside
// the landing cap). Short piles slump the same way with smaller impulses.

// Upper bound on the time an avalanche can take to fully settle. Used by
// tests to make sure they sim long enough for every unit to land.
function avalanchePlayoutSeconds(H) {
  return CONFIG.STACK_AVAL_PRELEAN_TIME
    + CONFIG.STACK_AVAL_STAGGER * H
    + CONFIG.STACK_AVAL_MAX_FLIGHT
    + 0.5;
}

test('avalanche: tall stacks (≥ TOPPLE_MIN alive) collapse into landed idles', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  // Hole to the left — mound should form to the right.
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));
  const eaten = world.eaten.get('0:0,0');
  assert.ok(eaten && eaten.has(0), 'base must be recorded as eaten');
  const chunk = world.chunks.get('0:0,0');
  const survivors = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(survivors.length >= 1,
    `expected some landed units after collapse, got ${survivors.length}`);
  for (const o of survivors) {
    assert.equal(o.state, 'idle', 'landed unit should be idle');
    assert.ok(Math.abs(o.x) > 1 || Math.abs(o.y) > 1,
      `landed unit didn't move: (${o.x}, ${o.y})`);
  }
});

test('avalanche: landed units fall away from the hole (mound cone)', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  // Hole to the LEFT. Mound extends to the RIGHT — every landed unit's x > 0.
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  for (const o of landed) {
    assert.ok(o.x > 0.5, `landed unit should have moved right (away from hole), got x=${o.x}`);
  }
});

test('avalanche: detaches are bottom-up with monotonic stagger', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  // First tick: base tips + avalanche kicks off (base itself is on sw.falling).
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(sw.avalanches?.length, 1, 'expected one active avalanche');
  const av = sw.avalanches[0];
  // Detach schedule is per unit above the base (idx 1..H-1). Times must be
  // monotonically increasing with stackIdx — bottom-up order.
  const stackedUnits = [...av.units.values()].filter((u) => u.stackIdx > 0);
  stackedUnits.sort((a, b) => a.stackIdx - b.stackIdx);
  for (let i = 1; i < stackedUnits.length; i++) {
    const prev = stackedUnits[i - 1];
    const curr = stackedUnits[i];
    assert.ok(curr.detachAt >= prev.detachAt,
      `detach order broken: idx ${curr.stackIdx} at ${curr.detachAt} < idx ${prev.stackIdx} at ${prev.detachAt}`);
    assert.ok(curr.detachAt - prev.detachAt >= CONFIG.STACK_AVAL_STAGGER * 0.5,
      `stagger too small between idx ${prev.stackIdx} and ${curr.stackIdx}`);
  }
});

test('avalanche: airborne units are in "tumbling" state, invisible to rim physics', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  // Run for a mid-avalanche moment — some units should be airborne.
  runSeconds(sw, world, hole, CONFIG.STACK_AVAL_PRELEAN_TIME + CONFIG.STACK_AVAL_STAGGER * 3);
  const chunk = world.chunks.get('0:0,0');
  const airborne = chunk.objects.filter((o) => o.state === 'tumbling');
  assert.ok(airborne.length > 0, 'expected some airborne units mid-avalanche');
  // Spatial queries never yield tumbling units — they'd otherwise get eaten
  // pre-landing, breaking the mound.
  const stillHere = new Set();
  forEachObjectNear(world, 0, 0, 5000, (o) => { stillHere.add(o.idx); });
  for (const o of airborne) {
    assert.ok(!stillHere.has(o.idx),
      `tumbling unit idx ${o.idx} appeared in spatial query — should be invisible`);
  }
});

test('avalanche: final resting positions spread as a mound, not a straight line', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length >= 5, `need enough units to test mound spread, got ${landed.length}`);
  // A rigid-line topple would put every unit at y=0. A mound spreads in y
  // too (the cone widens the fall direction). Require some y-variance.
  const ys = landed.map((o) => o.y);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  assert.ok(ymax - ymin > 2,
    `expected chaotic y-spread, got range ${(ymax - ymin).toFixed(2)}`);
});

test('avalanche: settles within a bounded sim time — no unit stuck airborne', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));
  // No unit left in a transitional state; no active avalanche left.
  const chunk = world.chunks.get('0:0,0');
  for (const o of chunk.objects) {
    if (o.stackIdx === 0) continue; // base is finalized separately via markEaten
    assert.ok(o.state === 'idle',
      `unit at idx ${o.stackIdx} stuck in state '${o.state}' past playout`);
  }
  assert.equal(sw.avalanches?.length ?? 0, 0, 'no active avalanche should remain');
});

test('avalanche: landed units are eventually eaten normally, feeding combos', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  // Drive the hole across each landed piece by teleporting on top.
  for (const o of landed) {
    hole.x = o.x; hole.y = o.y;
    runSeconds(sw, world, hole, CONFIG.FALL_TIME + 0.1);
  }
  const stillAlive = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.equal(stillAlive.length, 0, 'all landed units should be eaten');
  // Every unit (base + landed) should be marked eaten in persistence.
  const eaten = world.eaten.get('0:0,0');
  for (let k = 0; k < H; k++) assert.ok(eaten.has(k), `idx ${k} not persisted eaten`);
});

// --- Persistence through chunk unload -------------------------------------

test('partial tower survives chunk unload + reload via the eaten set', () => {
  // Fabricate a partially-eaten tower in world.eaten, then re-generate.
  const w = createWorld('twr-persist');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const groups = towersIn(w);
  assert.ok(groups.size > 0, 'need at least one tower');
  const [firstStackId, firstList] = [...groups.entries()][0];
  firstList.sort((a, b) => a.stackIdx - b.stackIdx);
  const originalHeight = firstList.length;
  assert.ok(originalHeight >= 3, 'need a tower with 3+ units for this test');
  // Simulate eating the two lowest units.
  markEaten(w, firstList[0]);
  markEaten(w, firstList[1]);
  // Wander away — chunks unload.
  ensureChunksAround(w, 100000, 100000, 1200, 900);
  // Come back — chunks regenerate.
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const afterGroups = towersIn(w);
  const afterList = afterGroups.get(firstStackId);
  assert.ok(afterList, 'the tower should still exist after regen');
  afterList.sort((a, b) => a.stackIdx - b.stackIdx);
  assert.equal(afterList.length, originalHeight - 2,
    `expected ${originalHeight - 2} alive units, got ${afterList.length}`);
  assert.equal(afterList[0].stackIdx, 2, 'new base after regen should be original idx 2');
  assert.equal(afterList[0].state, 'idle', 'new base after regen must be idle');
  for (let k = 1; k < afterList.length; k++) {
    assert.equal(afterList[k].state, 'stacked', 'higher units after regen must be stacked');
  }
});

// --- Stacks module helpers ------------------------------------------------

test('groupStacks buckets units by stackId', () => {
  const objs = [
    makeStackUnit('A', 0, 0, 0, 10, 'idle'),
    makeStackUnit('A', 1, 0, 0, 10, 'stacked'),
    makeStackUnit('B', 0, 100, 0, 8, 'idle'),
    { idx: 99, state: 'idle', x: 50, y: 50, r: 5 }, // not in any stack
  ];
  const grouped = groupStacks(objs);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('A').length, 2);
  assert.equal(grouped.get('B').length, 1);
});

test('currentBaseOf returns the lowest-stackIdx alive unit', () => {
  const list = [
    makeStackUnit('A', 5, 0, 0, 10, 'stacked'),
    makeStackUnit('A', 2, 0, 0, 10, 'idle'),
    makeStackUnit('A', 8, 0, 0, 10, 'stacked'),
  ];
  const base = currentBaseOf(list);
  assert.equal(base.stackIdx, 2);
});

// --- M2: eaten-stamp at collapse START, not at landing ------------------

test('avalanche: unload mid-collapse does not resurrect stacked units', () => {
  const w = createWorld('twr-topple-persist');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const groups = towersIn(w);
  let candidate = null;
  for (const [id, list] of groups) {
    if (list.length >= CONFIG.STACK_TOPPLE_MIN) { candidate = { id, list }; break; }
  }
  assert.ok(candidate, `need a real tower with ≥ ${CONFIG.STACK_TOPPLE_MIN} units`);
  candidate.list.sort((a, b) => a.stackIdx - b.stackIdx);
  const base = candidate.list[0];

  // Pump hole to eat the base (real gameplay would have a big-enough hole
  // by the time a beacon-scale tower shows up).
  const hole = createHole();
  hole.r = base.r * 2;
  hole.potential = base.r * 2;
  hole.level = 20;
  hole.x = base.x - 1; hole.y = base.y;
  const sw = createSwallow();

  // One tick — base tips, avalanche initiated.
  swallowUpdate(sw, 1 / 60, 0, w, hole);
  assert.equal(sw.avalanches?.length, 1, 'expected an avalanche in flight');

  // Non-base member idxs must be persisted IMMEDIATELY (not at landing) —
  // otherwise an unload during the collapse resurrects them on regen.
  const eaten = w.eaten.get(base.ck);
  assert.ok(eaten, 'eaten set for base chunk must be created at collapse start');
  for (const o of candidate.list) {
    if (o.stackIdx === 0) continue;
    assert.ok(eaten.has(o.idx),
      `unit at stackIdx ${o.stackIdx} (idx ${o.idx}) must be eaten-stamped at collapse start`);
  }

  // And the whole round-trip through unload+reload must leave no stacked
  // resurrection (base may or may not be there depending on finalize timing).
  ensureChunksAround(w, 100000, 100000, 1200, 900);
  ensureChunksAround(w, base.x, base.y, 3000, 3000);
  const rebornGroups = towersIn(w);
  const reborn = rebornGroups.get(base.stackId);
  if (reborn) {
    for (const o of reborn) {
      assert.notEqual(o.state, 'stacked',
        `unit at stackIdx ${o.stackIdx} resurrected as 'stacked' after unload+reload`);
    }
  }
});

// --- S1: mound extent must stay inside PAD ------------------------------

test('avalanche: max-height max-slot tower lands inside 2× chunkSize of the base', () => {
  // Fabricate a beacon-scale tower: max height, big unitR (a slot-5 base
  // r=22 × SLOT_MULTS[5]=8.95 ≈ 197). Level-0 chunks are CONFIG.CHUNK wide
  // (480). Uncompressed, an avalanche mound would fling units many chunks
  // past PAD — the cap keeps the mound inside 2 × chunkSizeAt(level), safely
  // inside PAD=3, so every landed unit stays reachable by forEachObjectNear.
  const H = 24;
  const unitR = 200;
  const objects = [];
  for (let k = 0; k < H; k++) {
    objects.push(makeStackUnit('BEACON', k, 0, 0, unitR, k === 0 ? 'idle' : 'stacked'));
  }
  const world = createWorld('s1');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  const hole = createHole();
  hole.r = unitR * 2;
  hole.potential = unitR * 2;
  hole.level = 20;
  const sw = createSwallow();
  hole.x = -1; hole.y = 0;
  const chunkSize = CONFIG.CHUNK; // level 0
  const cap = 2 * chunkSize;

  const events = runSeconds(sw, world, hole, avalanchePlayoutSeconds(H));

  // Every landed non-base unit is within cap of the pivot (0, 0).
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length > 0, 'expected some landed units');
  for (const o of landed) {
    const d = Math.hypot(o.x, o.y);
    assert.ok(d <= cap + 1e-6,
      `landed unit at (${o.x.toFixed(0)}, ${o.y.toFixed(0)}) — dist ${d.toFixed(0)} exceeds cap ${cap}`);
  }

  // The mound's far edge must still be reachable by forEachObjectNear.
  const farthest = landed.reduce((a, b) => (Math.hypot(a.x, a.y) > Math.hypot(b.x, b.y) ? a : b));
  let seen = 0;
  forEachObjectNear(world, farthest.x, farthest.y, unitR * 1.5, (o) => {
    if (o.stackIdx > 0) seen++;
  });
  assert.ok(seen >= 1, `forEachObjectNear at the mound's far edge returned no landed units`);
});
