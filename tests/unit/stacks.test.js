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

// --- Topple ---------------------------------------------------------------

test('topple: tall stacks (≥ TOPPLE_MIN alive) fall over on base swallow, landing as ordinary idles', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  // Give the base a specific direction to fall away from.
  hole.x = -10; hole.y = 0; // hole is to the left, so the tower topples to the right
  const events = runSeconds(sw, world, hole, CONFIG.STACK_TOPPLE_TIME + 0.5);
  // The base itself is consumed.
  const eaten = world.eaten.get('0:0,0');
  assert.ok(eaten && eaten.has(0), 'base must be recorded as eaten');
  // All non-base units are now idle (landed) and no longer share (x, y).
  const chunk = world.chunks.get('0:0,0');
  const survivors = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(survivors.length >= 1,
    `expected some landed units after topple, got ${survivors.length}`);
  for (const o of survivors) {
    assert.equal(o.state, 'idle', 'landed unit should be idle');
    assert.ok(!('stacked' === o.state), 'no unit should stay stacked after topple');
    // They should have moved horizontally away from the pivot.
    assert.ok(Math.abs(o.x) > 1 || Math.abs(o.y) > 1,
      `landed unit didn't move: (${o.x}, ${o.y})`);
  }
});

test('topple: landed units fall away from the hole', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  // Hole is to the LEFT. Landed line should extend to the RIGHT (positive x).
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, CONFIG.STACK_TOPPLE_TIME + 0.5);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  for (const o of landed) {
    assert.ok(o.x > 0.5, `landed unit should have moved right (away from hole), got x=${o.x}`);
  }
});

test('topple: landed units are eventually eaten normally, feeding combos', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  runSeconds(sw, world, hole, CONFIG.STACK_TOPPLE_TIME + 0.2);
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

// --- M2: eaten-stamp at topple START, not at landing ---------------------

test('topple: unload mid-topple does not resurrect stacked units', () => {
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

  // One tick — base tips, topple initiated.
  swallowUpdate(sw, 1 / 60, 0, w, hole);
  assert.equal(sw.topples.length, 1, 'expected a topple in flight');

  // Non-base member idxs must be persisted IMMEDIATELY (not at landing) —
  // otherwise an unload during the 0.5s topple resurrects them on regen.
  const eaten = w.eaten.get(base.ck);
  assert.ok(eaten, 'eaten set for base chunk must be created at topple start');
  for (const o of candidate.list) {
    if (o.stackIdx === 0) continue;
    assert.ok(eaten.has(o.idx),
      `unit at stackIdx ${o.stackIdx} (idx ${o.idx}) must be eaten-stamped at topple start`);
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

// --- S1: landing-line length must stay inside PAD ------------------------

test('topple: max-height max-slot tower lands inside 2× chunkSize of the base', () => {
  // Fabricate a beacon-scale tower: max height, big unitR (a slot-5 base
  // r=22 × SLOT_MULTS[5]=8.95 ≈ 197, times a tiny +8% jitter). Level-0
  // chunks are CONFIG.CHUNK wide (480). Uncompressed, the landing line
  // would run (2H−1)×unitR ≈ 9000+ world units — far outside PAD=3 chunks.
  // The fix caps the line at 2 × chunkSizeAt(level), so every landed unit
  // (and forEachObjectNear queried at the line's far end) sits inside the
  // padded query window of the base's chunk.
  const H = 24;
  const unitR = 200;
  const objects = [];
  for (let k = 0; k < H; k++) {
    objects.push(makeStackUnit('BEACON', k, 0, 0, unitR, k === 0 ? 'idle' : 'stacked'));
  }
  const world = createWorld('s1');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  const hole = createHole();
  // Pump the hole up so a beacon-scale base (r=200) is edible — this test
  // is about landing math, not rim physics: a real player reaching a
  // beacon this big has a hole even bigger.
  hole.r = unitR * 2;
  hole.potential = unitR * 2;
  hole.level = 20;
  const sw = createSwallow();
  // Hole to the left of the base so the topple falls to +x.
  hole.x = -1; hole.y = 0;
  const chunkSize = CONFIG.CHUNK; // level 0
  const cap = 2 * chunkSize;

  const events = runSeconds(sw, world, hole, CONFIG.STACK_TOPPLE_TIME + 0.2);

  // Every landed non-base unit is within cap of the pivot (0, 0).
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length > 0, 'expected some landed units');
  for (const o of landed) {
    const d = Math.hypot(o.x, o.y);
    assert.ok(d <= cap + 1e-6,
      `landed unit at (${o.x.toFixed(0)}, ${o.y.toFixed(0)}) — dist ${d.toFixed(0)} exceeds cap ${cap}`);
  }

  // The line's far end must still be reachable by forEachObjectNear.
  const farthest = landed.reduce((a, b) => (Math.hypot(a.x, a.y) > Math.hypot(b.x, b.y) ? a : b));
  let seen = 0;
  forEachObjectNear(world, farthest.x, farthest.y, unitR * 1.5, (o) => {
    if (o.stackIdx > 0) seen++;
  });
  assert.ok(seen >= 1, `forEachObjectNear at the line's far end returned no landed units`);
});
