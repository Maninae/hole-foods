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
import { detachDropZ } from '../../js/collapse.js';

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

test('every minted tower unit carries stackH = full column height', () => {
  // stackH feeds the renderer's height-aware south cull (a column whose
  // base is below the screen must still draw when its top peeks in), so
  // every unit — base and siblings, lone towers and formation columns —
  // must know how tall its column is.
  const w = createWorld('twr-stackh');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  const groups = towersIn(w);
  assert.ok(groups.size > 0, 'need at least one tower');
  for (const list of groups.values()) {
    for (const o of list) {
      assert.equal(o.stackH, list.length,
        `unit ${o.stackId}#${o.stackIdx} stackH=${o.stackH}, column height ${list.length}`);
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

test('avalanche: mound is biased away from the hole (radial heap, not a fan)', () => {
  const H = Math.max(CONFIG.STACK_TOPPLE_MIN, 10);
  const { world, hole, sw } = makeStackFixture(H);
  // Hole to the LEFT. Mound is a haphazard radial heap: most units end
  // up on the +x side (away from the hole), but a fraction spill
  // sideways or behind (the "haphazard pyramid" the owner asked for).
  hole.x = -10; hole.y = 0;
  // One tick kicks the avalanche off; move the hole away so rim physics
  // doesn't consume the mound during playout.
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length > 0, 'expected landed units');
  // Majority forward (+x): at least 55% of units land with x > 0.
  const forwardCount = landed.filter((o) => o.x > 0).length;
  const forwardFrac = forwardCount / landed.length;
  assert.ok(forwardFrac >= 0.55,
    `expected majority-forward mound, got ${forwardCount}/${landed.length} (${(forwardFrac * 100).toFixed(0)}%)`);
  // Centroid is on the forward side too.
  const cx = landed.reduce((s, o) => s + o.x, 0) / landed.length;
  assert.ok(cx > 0, `mound centroid should be on the away side, got x=${cx.toFixed(2)}`);
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

test('avalanche: units tumble DOWN from their rendered column height, never launch up', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(sw.avalanches?.length, 1, 'expected one active avalanche');
  const av = sw.avalanches[0];
  const firstZ = new Map(); // stackIdx -> z one frame into flight
  const firstVz = new Map();
  const peakZ = new Map();
  const dt = 1 / 60;
  let t = dt;
  for (let i = 0; i < 60 * 8 && sw.avalanches.length > 0; i++) {
    swallowUpdate(sw, dt, t, world, hole);
    t += dt;
    for (const u of av.units.values()) {
      if (u.phase !== 'tumbling') continue;
      if (!firstZ.has(u.stackIdx)) {
        firstZ.set(u.stackIdx, u.z);
        firstVz.set(u.stackIdx, u.vz);
      }
      peakZ.set(u.stackIdx, Math.max(peakZ.get(u.stackIdx) ?? -Infinity, u.z));
    }
  }
  assert.equal(firstZ.size, H - 1, 'every stacked unit must pass through tumbling');
  // Two frames of free fall is the observation slack (detach and this
  // check don't share a frame boundary).
  const slack = CONFIG.STACK_AVAL_GRAVITY * (2 * dt) * (2 * dt);
  for (const u of av.units.values()) {
    const s = u.stackIdx;
    const targetDist = Math.hypot(u.tx - av.baseX, u.ty - av.baseY);
    const expected = detachDropZ(av.unitR, s, targetDist, av.physicsScale);
    const z1 = firstZ.get(s);
    assert.ok(z1 <= expected + 1e-6,
      `unit ${s} detached ABOVE its stacked height: z=${z1.toFixed(1)} > ${expected.toFixed(1)}`);
    assert.ok(z1 >= expected - slack,
      `unit ${s} detached far below its stacked height: z=${z1.toFixed(1)} < ${expected.toFixed(1)}`);
    assert.ok(firstVz.get(s) <= 0,
      `unit ${s} has UPWARD velocity at detach: vz=${firstVz.get(s).toFixed(1)}`);
    assert.ok(peakZ.get(s) <= expected + 1e-6,
      `unit ${s} rose above its detach height mid-flight: peak=${peakZ.get(s).toFixed(1)}`);
    // The rendered-height contract itself: above the continuity floor, the
    // drop starts one overlap-step per row above the effective base.
    const stepZ = (2 * av.unitR * CONFIG.STACK_UNIT_OVERLAP) / CONFIG.ISO_Y;
    if (s >= 3) {
      assert.ok(Math.abs(expected - (s - 1) * stepZ) < 1e-6,
        `unit ${s} drop height is not its rendered column height`);
    }
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
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length >= 5, `need enough units to test mound spread, got ${landed.length}`);
  // A rigid-line topple would put every unit at y=0. A radial heap has
  // real y-spread (both sides of the fall direction populated).
  const ys = landed.map((o) => o.y);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  assert.ok(ymax - ymin > 2,
    `expected chaotic y-spread, got range ${(ymax - ymin).toFixed(2)}`);
  // Distances from base cover a range too (density near base, some units
  // farther): the max distance should be at least 3x the min distance.
  const dists = landed.map((o) => Math.hypot(o.x, o.y));
  const dmin = Math.min(...dists);
  const dmax = Math.max(...dists);
  assert.ok(dmax >= dmin * 3 || dmax - dmin > 4 * 10 /* unitR */,
    `expected spread of distances, got min=${dmin.toFixed(2)} max=${dmax.toFixed(2)}`);
});

// --- Row-signature killer: sector coverage + min-separation -------------
// The prior random-in-cone target picker had a failure mode where any two
// settled targets closer than one unit diameter fused into a caterpillar
// row on screen under the ISO_Y squash. Owner's recorded playtest surfaced
// this three times in a 48s run. The sunflower-spiral heap enforces min
// separation for free; these tests guard against a regression.

test('avalanche: settled targets occupy ≥4 of 8 sectors with no sector >50%', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length >= 8, `need enough units, got ${landed.length}`);
  const counts = new Array(8).fill(0);
  for (const o of landed) {
    const a = Math.atan2(o.y, o.x);
    const s = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 8) % 8;
    counts[s]++;
  }
  const occupied = counts.filter((c) => c > 0).length;
  assert.ok(occupied >= 4,
    `expected mound to cover >=4 of 8 angular sectors, got ${occupied} (${counts.join(',')})`);
  const maxSector = Math.max(...counts);
  assert.ok(maxSector <= Math.floor(landed.length / 2),
    `no sector should hold more than half the units; got max=${maxSector} of ${landed.length}`);
});

test('avalanche: minimum pairwise distance between settled targets ≥ 1.0 × unit diameter', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length >= 5, `need enough units, got ${landed.length}`);
  const unitDiameter = 2 * 10; // fixture unitR = 10
  let minSep = Infinity;
  let closestPair = null;
  for (let i = 0; i < landed.length; i++) {
    for (let j = i + 1; j < landed.length; j++) {
      const d = Math.hypot(landed[i].x - landed[j].x, landed[i].y - landed[j].y);
      if (d < minSep) { minSep = d; closestPair = [landed[i].stackIdx, landed[j].stackIdx]; }
    }
  }
  assert.ok(minSep >= unitDiameter,
    `min pairwise separation ${minSep.toFixed(2)} < 1.0 × unit diameter ${unitDiameter} (idxs ${closestPair})`);
});

// --- Owner bug: flight must ARRIVE at the settle target ------------------
// A prior model launched units with impulses independent of their target
// and snapped x/y to the deterministic spiral target on settle. Owner
// playtest surfaced two symptoms: "flings super far", then "teleports
// back to my current location". Root cause is one thing: flight and
// target are decoupled. The fix aims flight AT the target so there is
// nothing to snap. These two tests are the guards.

test('avalanche: max mid-flight distance stays within 1.2× the spiral max target radius', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  const av = sw.avalanches[0];
  const targets = [...av.units.values()];
  const maxTargetR = Math.max(
    ...targets.map((u) => Math.hypot(u.tx - av.baseX, u.ty - av.baseY)),
  );
  let maxFlightR = 0;
  const dt = 1 / 60;
  const total = avalanchePlayoutSeconds(H);
  for (let t = 1 / 60; t < total; t += dt) {
    swallowUpdate(sw, dt, t, world, hole);
    if (!av.units) continue;
    for (const u of av.units.values()) {
      if (u.phase !== 'tumbling') continue;
      const d = Math.hypot(u.x - av.baseX, u.y - av.baseY);
      if (d > maxFlightR) maxFlightR = d;
    }
  }
  assert.ok(maxFlightR <= 1.2 * maxTargetR,
    `mid-flight excursion ${maxFlightR.toFixed(1)} exceeds 1.2× max spiral target ${maxTargetR.toFixed(1)} — units are launching past where they'll settle`);
});

test('avalanche: no per-frame teleport at settle — displacement stays under 0.5× unit diameter', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  const av = sw.avalanches[0];
  const unitR = 10; // fixture
  const threshold = 0.5 * 2 * unitR;
  const chunk = world.chunks.get('0:0,0');
  const byIdx = new Map();
  for (const u of av.units.values()) {
    byIdx.set(u.stackIdx, { prevX: u.x, prevY: u.y, worst: 0 });
  }
  const dt = 1 / 60;
  const total = avalanchePlayoutSeconds(H);
  for (let t = 1 / 60; t < total; t += dt) {
    swallowUpdate(sw, dt, t, world, hole);
    for (const [stackIdx, rec] of byIdx) {
      let x; let y;
      const u = av.units.get(stackIdx);
      if (u && u.phase === 'tumbling') { x = u.x; y = u.y; }
      else {
        const o = chunk.objects.find((c) => c.stackIdx === stackIdx);
        if (!o) continue;
        x = o.x; y = o.y;
      }
      const d = Math.hypot(x - rec.prevX, y - rec.prevY);
      if (d > rec.worst) rec.worst = d;
      rec.prevX = x; rec.prevY = y;
    }
  }
  const bad = [...byIdx.entries()].filter(([, r]) => r.worst > threshold);
  if (bad.length) {
    const details = bad.map(([k, r]) => `idx${k}=${r.worst.toFixed(1)}`).join(', ');
    assert.fail(`per-frame ground displacement > ${threshold}: ${details} — settle is teleporting`);
  }
});

test('avalanche: no snap even at large-unit towers (physics scales with unitR)', () => {
  // Cycle 2 slot 3 has unitR around 3000. With fixed vz/gravity the top
  // unit's flight time exceeds MAX_FLIGHT by a wide margin, so the
  // epsilon slide fires with a large miss (visible teleport). Physics
  // constants must scale with unitR so flight time stays under the
  // hard cap regardless of cycle or slot.
  const H = 24;
  const R = 3000;
  const objects = [];
  for (let k = 0; k < H; k++) {
    objects.push(makeStackUnit('BIG', k, 0, 0, R, k === 0 ? 'idle' : 'stacked'));
  }
  const world = createWorld('stack-scale-test');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  const hole = createHole();
  // Big enough to actually swallow an R=3000 base under FIT_FACTOR.
  hole.r = R * 1.5; hole.potential = hole.r; hole.level = 30;
  hole.x = -R * 0.6; hole.y = 0; // rim overlaps the base to trigger tip-in
  const sw = createSwallow();
  // Drive rim physics until the base tips and the avalanche spawns.
  for (let ti = 0; ti < 60 && !sw.avalanches?.length; ti++) {
    swallowUpdate(sw, 1 / 60, ti / 60, world, hole);
  }
  hole.x = 1e9; hole.y = 1e9; // move hole far away so rim doesn't re-eat units
  const av = sw.avalanches[0];
  assert.ok(av, 'avalanche should have been triggered by the base tipping');
  const unitDiameter = 2 * R;
  const teleThreshold = 0.5 * unitDiameter;
  const prev = new Map();
  for (const u of av.units.values()) prev.set(u.stackIdx, { x: u.x, y: u.y, worst: 0 });
  const dt = 1 / 60;
  const total = avalanchePlayoutSeconds(H);
  const chunk = world.chunks.get('0:0,0');
  for (let t = 1 / 60; t < total; t += dt) {
    swallowUpdate(sw, dt, t, world, hole);
    for (const [stackIdx, rec] of prev) {
      let x; let y;
      const u = av.units.get(stackIdx);
      if (u && u.phase === 'tumbling') { x = u.x; y = u.y; }
      else {
        const o = chunk.objects.find((c) => c.stackIdx === stackIdx);
        if (!o) continue;
        x = o.x; y = o.y;
      }
      const d = Math.hypot(x - rec.x, y - rec.y);
      if (d > rec.worst) rec.worst = d;
      rec.x = x; rec.y = y;
    }
  }
  const bad = [...prev.entries()].filter(([, r]) => r.worst > teleThreshold);
  if (bad.length) {
    const details = bad.map(([k, r]) => `idx${k}=${r.worst.toFixed(0)}`).join(', ');
    assert.fail(`large-unit tower teleport > ${teleThreshold} at idxs: ${details}`);
  }
});

test('avalanche: mid-air flight headings span multiple quadrants around the base', () => {
  // With arrival velocities aimed at each unit's radial spiral target,
  // flight headings should scatter around the base, not all point in the
  // shared spread direction. Guard against a regression to a single-cone
  // launch.
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  const av = sw.avalanches[0];
  // Advance a couple of ticks so every unit passes through detach and
  // has a real (vx, vy) sampled.
  runSeconds(sw, world, hole, 0.8, 1 / 60);
  const quadrants = new Set();
  for (const u of av.units.values()) {
    // Snapshot vx/vy from the pre-settled tumbling window if still airborne,
    // otherwise derive from the settled displacement (which is the ballistic
    // arrival direction).
    let dx; let dy;
    if (u.phase === 'tumbling' && (u.vx || u.vy)) {
      dx = u.vx; dy = u.vy;
    } else {
      dx = u.tx - av.baseX;
      dy = u.ty - av.baseY;
    }
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) continue;
    const q = (dx >= 0 ? 0 : 1) + (dy >= 0 ? 0 : 2); // 0..3 quadrant
    quadrants.add(q);
  }
  assert.ok(quadrants.size >= 3,
    `flight headings clustered in ${quadrants.size} quadrant(s); avalanche looks one-directional`);
});

test('avalanche: settled sprite rotations vary across the full circle', () => {
  const H = 14;
  const { world, hole, sw } = makeStackFixture(H);
  hole.x = -10; hole.y = 0;
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);
  const chunk = world.chunks.get('0:0,0');
  const landed = chunk.objects.filter((o) => o.stackIdx > 0);
  assert.ok(landed.length >= 5, 'need enough units to test rotation variety');
  const rots = landed.map((o) => o.rot);
  const rmin = Math.min(...rots);
  const rmax = Math.max(...rots);
  // A tight physics-driven spin correlates with flight time (all similar).
  // With deterministic final-rot per unit, the range should span most of
  // ±π so lying sprites face every angle.
  assert.ok(rmax - rmin > Math.PI,
    `expected settled rotations to span >π, got range ${(rmax - rmin).toFixed(2)}`);
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
  // Pick any tower with >= 3 units (a formation column of height 1 or 2
  // isn't a useful fixture for the persistence round-trip).
  let firstStackId = null;
  let firstList = null;
  for (const [id, list] of groups) {
    if (list.length >= 3) { firstStackId = id; firstList = list; break; }
  }
  assert.ok(firstList, 'need at least one tower with 3+ units');
  firstList.sort((a, b) => a.stackIdx - b.stackIdx);
  const originalHeight = firstList.length;
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

test('slump-avalanche: unload mid-collapse does not resurrect stacked units (H=4 short pile)', () => {
  // Mirror of the tall-tower unload test, exercising the SLUMP path
  // (alive < STACK_TOPPLE_MIN). Same M2 invariant: non-base idxs are
  // stamped at collapse start, not at landing, so a chunk unload+reload
  // mid-slump cannot resurrect them as 'stacked' on regen.
  const H = 4;
  const objects = [];
  for (let k = 0; k < H; k++) {
    objects.push(makeStackUnit('SLUMPY', k, 0, 0, 10, k === 0 ? 'idle' : 'stacked'));
  }
  const world = createWorld('slumpy');
  world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects });
  const hole = createHole();
  hole.x = -1; hole.y = 0;
  const sw = createSwallow();

  swallowUpdate(sw, 1 / 60, 0, world, hole);
  assert.equal(sw.avalanches?.length, 1, 'expected an avalanche in flight (slump path)');
  assert.equal(sw.avalanches[0].isTall, false, 'expected the slump path (isTall=false)');

  const eaten = world.eaten.get('0:0,0');
  assert.ok(eaten, 'eaten set for base chunk must be created at collapse start');
  for (let k = 1; k < H; k++) {
    assert.ok(eaten.has(k),
      `unit at stackIdx ${k} must be eaten-stamped at slump-avalanche start`);
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

  // One tick: base tips + avalanche kicks off + all non-base units go
  // into the tumbling bookkeeping with deterministic targets. Then move
  // the hole far away so rim physics doesn't consume the landed mound
  // during playout — the test is about landing math, not eatability.
  swallowUpdate(sw, 1 / 60, 0, world, hole);
  hole.x = 1e6; hole.y = 1e6;
  runSeconds(sw, world, hole, avalanchePlayoutSeconds(H), 1 / 60);

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
