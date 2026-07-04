// Achievements engine: headless. No DOM here — the engine ingests events
// and returns newly-unlocked entries. The UI layer reacts to those.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../../js/catalog.js';
import {
  ACHIEVEMENTS, THEMES_ORDER, BUILDING_EMOJI, VERSION,
  ACHIEVEMENT_BRANCHES,
  createProgress, ingest,
  serializeProgress, deserializeProgress,
  isAcyclic, achievementById,
} from '../../js/achievements.js';

// --- Table integrity ------------------------------------------------------

test('achievement table: unique ids, name, emoji, description, trigger', () => {
  const ids = new Set();
  for (const a of ACHIEVEMENTS) {
    assert.ok(typeof a.id === 'string' && a.id.length > 0, `bad id ${a.id}`);
    assert.ok(!ids.has(a.id), `duplicate id ${a.id}`);
    ids.add(a.id);
    assert.ok(a.name, `${a.id} missing name`);
    assert.ok(a.emoji, `${a.id} missing emoji`);
    assert.ok(a.description, `${a.id} missing description`);
    assert.ok(a.trigger && a.trigger.kind, `${a.id} missing trigger`);
    assert.ok(a.branch, `${a.id} missing branch`);
    assert.ok(Array.isArray(a.requires), `${a.id} missing requires array`);
    assert.equal(typeof a.col, 'number', `${a.id} missing col`);
    assert.equal(typeof a.row, 'number', `${a.id} missing row`);
  }
  // v1 ids that MUST still exist so live saves come through untouched.
  for (const id of [
    'size-1m', 'size-10m', 'size-100m', 'size-1km',
    'eat-100', 'eat-1000', 'eat-10000',
    'combo-x5', 'first-building', 'full-cycle', 'all-themes',
  ]) {
    assert.ok(ids.has(id), `missing v1 achievement ${id}`);
  }
  // New rungs the graph adds in v2.
  for (const id of [
    'size-10km', 'size-100km',
    'eat-100000',
    'combo-x2', 'combo-x3', 'combo-x4',
    'themes-3', 'themes-9',
    'cycle-2', 'cycle-3', 'cycle-5',
    'meadow-c1', 'meadow-c2', 'meadow-6c',
  ]) {
    assert.ok(ids.has(id), `missing new achievement ${id}`);
  }
});

test('achievement table has ~25 nodes across all six branches', () => {
  assert.ok(ACHIEVEMENTS.length >= 25, `expected >=25 nodes, got ${ACHIEVEMENTS.length}`);
  const seenBranches = new Set(ACHIEVEMENTS.map((a) => a.branch));
  for (const b of ACHIEVEMENT_BRANCHES) {
    assert.ok(seenBranches.has(b), `no achievement in branch ${b}`);
  }
});

test('every requires id resolves to a real achievement', () => {
  const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
  for (const a of ACHIEVEMENTS) {
    for (const r of a.requires) {
      assert.ok(ids.has(r), `${a.id} requires missing id ${r}`);
    }
  }
});

test('achievement graph is acyclic (isAcyclic() and dependency-forward-order sanity)', () => {
  assert.ok(isAcyclic(), 'graph contains a cycle');
  // Bonus: the authored order must also be a topological sort, so a single
  // ingest sweep (before the fixpoint retries) already unlocks in order.
  const seen = new Set();
  for (const a of ACHIEVEMENTS) {
    for (const r of a.requires) {
      assert.ok(seen.has(r), `${a.id} requires ${r} which appears later in the table`);
    }
    seen.add(a.id);
  }
});

test('layout coords (col, row) are unique per node', () => {
  const cells = new Set();
  for (const a of ACHIEVEMENTS) {
    const key = `${a.col}:${a.row}`;
    assert.ok(!cells.has(key), `duplicate layout cell ${key} at ${a.id}`);
    cells.add(key);
  }
});

test('discovery table covers all 18 themes in THEMES order', () => {
  assert.equal(THEMES_ORDER.length, 18);
  assert.equal(THEMES_ORDER.length, THEMES.length);
  for (let i = 0; i < THEMES.length; i++) {
    assert.equal(THEMES_ORDER[i].key, THEMES[i].key);
    assert.ok(THEMES_ORDER[i].name);
    assert.ok(THEMES_ORDER[i].sticker, `${THEMES[i].key} needs a sticker`);
  }
});

test('BUILDING_EMOJI is a non-empty Set covering common building glyphs', () => {
  assert.ok(BUILDING_EMOJI instanceof Set);
  assert.ok(BUILDING_EMOJI.size >= 8);
  for (const e of ['🏠', '🏢', '⛪', '🏭']) {
    assert.ok(BUILDING_EMOJI.has(e), `expected ${e} in BUILDING_EMOJI`);
  }
  for (const e of ['🍓', '🌳', '🎂', '🐙', '🎡']) {
    assert.ok(!BUILDING_EMOJI.has(e), `${e} should not be a building`);
  }
});

test('achievementById returns the node by id, null if unknown', () => {
  assert.equal(achievementById('size-1m').id, 'size-1m');
  assert.equal(achievementById('nope'), null);
});

// --- Fresh progress + basic ingest ---------------------------------------

test('fresh progress has empty discovered / unlocked / themeCycles', () => {
  const p = createProgress();
  assert.equal(p.discovered.size, 0);
  assert.equal(p.unlocked.size, 0);
  assert.equal(p.themeCycles.size, 0);
  assert.equal(p.v, VERSION);
});

test('themeVisit unlocks a discovery once; repeat is a no-op', () => {
  const p = createProgress();
  const first = ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  const disc = first.filter((u) => u.kind === 'discovery');
  assert.equal(disc.length, 1);
  assert.equal(disc[0].key, 'meadow');
  assert.ok(p.discovered.has('meadow'));
  const second = ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  assert.equal(second.filter((u) => u.kind === 'discovery').length, 0);
});

test('an unknown themeVisit key is ignored (no discovery event)', () => {
  const p = createProgress();
  const out = ingest(p, { type: 'themeVisit', key: 'nonexistent-biome' });
  assert.equal(out.filter((u) => u.kind === 'discovery').length, 0);
  assert.equal(p.discovered.size, 0);
});

// --- themeCycles + Homecoming branch -------------------------------------

test('themeVisit records (key, cycle) into progress.themeCycles', () => {
  const p = createProgress();
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  assert.ok(p.themeCycles.has('meadow:0'));
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 1 });
  assert.ok(p.themeCycles.has('meadow:1'));
  ingest(p, { type: 'themeVisit', key: 'orchard', cycle: 2 });
  assert.ok(p.themeCycles.has('orchard:2'));
  // No cycle field: still discovers, but themeCycles unchanged for that pair.
  const before = p.themeCycles.size;
  ingest(p, { type: 'themeVisit', key: 'ocean' });
  assert.ok(p.discovered.has('ocean'));
  assert.equal(p.themeCycles.size, before);
});

test('themeVisit ignores non-integer / negative cycle values', () => {
  const p = createProgress();
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 1.5 });
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: -3 });
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 'nope' });
  assert.equal(p.themeCycles.size, 0);
});

test('meadow-c1 stays locked until full-cycle is unlocked, then unlocks on next meadow visit', () => {
  const p = createProgress();
  // Visit meadow at cycle 1 before crossing a cycle boundary — the trigger
  // is technically satisfied but the requires-gate keeps it locked.
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 1 });
  assert.ok(!p.unlocked.has('meadow-c1'));
  // Cross a cycle → unlock full-cycle. Since meadow:1 is already recorded,
  // the fixpoint should cascade meadow-c1 in the same call.
  const u = ingest(p, { type: 'cycle', cycle: 1 });
  const ids = new Set(u.map((e) => e.id));
  assert.ok(ids.has('full-cycle'));
  assert.ok(ids.has('meadow-c1'), 'meadow-c1 should cascade in the cycle-1 event');
});

test('meadow-c1 and meadow-c2 both unlock in one call after a deep teleport', () => {
  // Simulates the exact scenario the spec calls out: full-cycle + two
  // meadow revisits are already recorded, then some event lands. All three
  // (full-cycle → meadow-c1 → meadow-c2) must unlock in dependency order.
  const p = createProgress();
  p.themeCycles.add('meadow:1');
  p.themeCycles.add('meadow:2');
  const u = ingest(p, { type: 'cycle', cycle: 2 });
  const ids = u.filter((e) => e.kind === 'achievement').map((e) => e.id);
  const iFull = ids.indexOf('full-cycle');
  const iC1 = ids.indexOf('meadow-c1');
  const iC2 = ids.indexOf('meadow-c2');
  assert.ok(iFull >= 0, 'full-cycle should unlock');
  assert.ok(iC1 > iFull, 'meadow-c1 should follow full-cycle in the returned list');
  assert.ok(iC2 > iC1, 'meadow-c2 should follow meadow-c1 in the returned list');
});

test('meadow-6c capstone requires 6 distinct cycles of meadow', () => {
  const p = createProgress();
  // Prime the chain up through meadow-c2.
  for (let c of [0, 1, 2, 3, 4]) {
    ingest(p, { type: 'themeVisit', key: 'meadow', cycle: c });
    ingest(p, { type: 'cycle', cycle: c });
  }
  assert.ok(!p.unlocked.has('meadow-6c'), '5 cycles is not enough');
  // Sixth cycle at meadow tips it over the threshold.
  const u = ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 5 });
  const ids = new Set(u.map((e) => e.id));
  assert.ok(ids.has('meadow-6c'), 'meadow-6c should unlock at 6 distinct cycles');
});

test('meadow-6c does NOT count non-meadow themes toward its total', () => {
  const p = createProgress();
  // Make prereqs available so the requires-gate isn't the blocker.
  p.unlocked.add('full-cycle');
  p.unlocked.add('meadow-c1');
  p.unlocked.add('meadow-c2');
  p.themeCycles.add('meadow:0');
  p.themeCycles.add('orchard:1');
  p.themeCycles.add('orchard:2');
  p.themeCycles.add('orchard:3');
  p.themeCycles.add('orchard:4');
  p.themeCycles.add('orchard:5');
  const u = ingest(p, { type: 'themeVisit', key: 'orchard', cycle: 6 });
  const ids = new Set(u.map((e) => e.id));
  assert.ok(!ids.has('meadow-6c'), 'orchard cycles should not count');
});

// --- Requires fixpoint cascades ------------------------------------------

test('capstone does NOT fire when only 17 of 18 are discovered', () => {
  const p = createProgress();
  for (let i = 0; i < 17; i++) ingest(p, { type: 'themeVisit', key: THEMES[i].key, cycle: 0 });
  assert.ok(!p.unlocked.has('all-themes'));
  // themes-3 and themes-9 have unlocked though — they're on the same branch.
  assert.ok(p.unlocked.has('themes-3'));
  assert.ok(p.unlocked.has('themes-9'));
});

test('discovering all 18 themes fires the whole explorer chain in one sweep', () => {
  const p = createProgress();
  for (const t of THEMES) ingest(p, { type: 'themeVisit', key: t.key, cycle: 0 });
  assert.ok(p.unlocked.has('themes-3'));
  assert.ok(p.unlocked.has('themes-9'));
  assert.ok(p.unlocked.has('all-themes'));
});

test('all-themes self-heals: 18 persisted discoveries without the unlock fire on any ingest', () => {
  // A save can hold all 18 discoveries but no all-themes unlock (partial
  // write, hand-edited storage). The themes trigger reads discovered on
  // every ingest, so the next event of ANY type repairs the chain.
  const p = createProgress();
  for (const t of THEMES) p.discovered.add(t.key);
  assert.ok(!p.unlocked.has('all-themes'));
  const u = ingest(p, { type: 'swallow', emoji: '🍓' });
  const ids = new Set(u.map((e) => e.id));
  assert.ok(ids.has('themes-3'));
  assert.ok(ids.has('themes-9'));
  assert.ok(ids.has('all-themes'));
});

test('first-building stays gated on size-10m', () => {
  const p = createProgress();
  // Before size-10m: swallowing a building does nothing.
  const early = ingest(p, { type: 'swallow', emoji: '🏠' });
  assert.equal(early.filter((u) => u.id === 'first-building').length, 0);
  assert.ok(!p.unlocked.has('first-building'));
  // Unlock size-1m + size-10m via a radius bump.
  ingest(p, { type: 'radius', r: 600 });
  assert.ok(p.unlocked.has('size-10m'));
  // NOW a building swallow fires first-building.
  const late = ingest(p, { type: 'swallow', emoji: '🏢' });
  assert.equal(late.filter((u) => u.id === 'first-building').length, 1);
  // A second building swallow does NOT re-unlock.
  const again = ingest(p, { type: 'swallow', emoji: '⛪' });
  assert.equal(again.filter((u) => u.id === 'first-building').length, 0);
});

test('size milestones cascade in dependency order on a single big-jump radius event', () => {
  const p = createProgress();
  const u = ingest(p, { type: 'radius', r: 5.5e6 });
  const achievements = u.filter((e) => e.kind === 'achievement').map((e) => e.id);
  // All six size rungs should be present, in ladder order.
  const expected = ['size-1m', 'size-10m', 'size-100m', 'size-1km', 'size-10km', 'size-100km'];
  for (let i = 0; i < expected.length; i++) {
    assert.ok(achievements.includes(expected[i]), `missing ${expected[i]} in cascade`);
  }
  // Each earlier rung comes before its successor.
  for (let i = 1; i < expected.length; i++) {
    const a = achievements.indexOf(expected[i - 1]);
    const b = achievements.indexOf(expected[i]);
    assert.ok(a < b, `${expected[i - 1]} should precede ${expected[i]}`);
  }
});

test('size milestones fire at 1m/10m/100m/1km/10km/100km diameters (r = 50 … 5e6)', () => {
  // Individual thresholds, in order — each step's requires is met by the prior.
  const p = createProgress();
  const cases = [
    { r: 50,       want: 'size-1m' },
    { r: 500,      want: 'size-10m' },
    { r: 5000,     want: 'size-100m' },
    { r: 50000,    want: 'size-1km' },
    { r: 500000,   want: 'size-10km' },
    { r: 5000000,  want: 'size-100km' },
  ];
  for (const c of cases) {
    const u = ingest(p, { type: 'radius', r: c.r });
    assert.ok(u.some((e) => e.id === c.want), `expected ${c.want} at r=${c.r}`);
  }
});

test('eaten count milestones cascade at 100 / 1k / 10k / 100k', () => {
  const p = createProgress();
  assert.equal(ingest(p, { type: 'eaten', count: 99 }).length, 0);
  const hit = ingest(p, { type: 'eaten', count: 100 });
  assert.equal(hit.filter((u) => u.id === 'eat-100').length, 1);
  const dupe = ingest(p, { type: 'eaten', count: 500 });
  assert.equal(dupe.filter((u) => u.id === 'eat-100').length, 0);
  // Big jump cascades the remaining tiers.
  const big = ingest(p, { type: 'eaten', count: 150000 });
  const ids = new Set(big.map((u) => u.id));
  for (const id of ['eat-1000', 'eat-10000', 'eat-100000']) {
    assert.ok(ids.has(id), `${id} should cascade at count=150000`);
  }
});

test('combo tiers cascade x2 → x5 on a single ×5 event', () => {
  const p = createProgress();
  const u = ingest(p, { type: 'combo', mult: 5 });
  const ids = u.filter((e) => e.kind === 'achievement').map((e) => e.id);
  for (const id of ['combo-x2', 'combo-x3', 'combo-x4', 'combo-x5']) {
    assert.ok(ids.includes(id), `${id} should cascade`);
  }
  const iX2 = ids.indexOf('combo-x2');
  const iX5 = ids.indexOf('combo-x5');
  assert.ok(iX2 < iX5, 'combo-x2 should unlock before combo-x5');
});

test('a ×2 combo unlocks only combo-x2; ×3 also gets combo-x3', () => {
  const p = createProgress();
  const u2 = ingest(p, { type: 'combo', mult: 2 });
  assert.equal(u2.filter((e) => e.id === 'combo-x2').length, 1);
  assert.equal(u2.filter((e) => e.id === 'combo-x3').length, 0);
  const u3 = ingest(p, { type: 'combo', mult: 3 });
  assert.equal(u3.filter((e) => e.id === 'combo-x3').length, 1);
});

test('cycle chain: full-cycle → cycle-2 → cycle-3 → cycle-5 cascades on a deep jump', () => {
  const p = createProgress();
  const u = ingest(p, { type: 'cycle', cycle: 5 });
  const ids = u.filter((e) => e.kind === 'achievement').map((e) => e.id);
  for (const id of ['full-cycle', 'cycle-2', 'cycle-3', 'cycle-5']) {
    assert.ok(ids.includes(id), `${id} should cascade at cycle=5`);
  }
});

test('crossing into cycle 1 unlocks full-cycle only; cycle 0 does not', () => {
  const p = createProgress();
  assert.equal(ingest(p, { type: 'cycle', cycle: 0 }).length, 0);
  const c1 = ingest(p, { type: 'cycle', cycle: 1 });
  const ids = new Set(c1.map((u) => u.id));
  assert.ok(ids.has('full-cycle'));
  assert.ok(!ids.has('cycle-2'));
});

test('themes-3 unlocks at the 3rd theme visit, not earlier', () => {
  const p = createProgress();
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  assert.ok(!p.unlocked.has('themes-3'));
  ingest(p, { type: 'themeVisit', key: 'orchard', cycle: 0 });
  assert.ok(!p.unlocked.has('themes-3'));
  const u = ingest(p, { type: 'themeVisit', key: 'ocean', cycle: 0 });
  assert.ok(u.some((e) => e.id === 'themes-3'));
});

// --- Persistence + migration --------------------------------------------

test('progress round-trips through serialize / deserialize (v2)', () => {
  const p = createProgress();
  ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  ingest(p, { type: 'themeVisit', key: 'ocean', cycle: 1 });
  ingest(p, { type: 'radius', r: 60 });
  ingest(p, { type: 'combo', mult: 5 });
  const str = serializeProgress(p);
  assert.ok(typeof str === 'string');
  const p2 = deserializeProgress(str);
  assert.deepEqual([...p2.discovered].sort(), ['meadow', 'ocean']);
  assert.ok(p2.unlocked.has('size-1m'));
  assert.ok(p2.unlocked.has('combo-x5'));
  assert.ok(p2.themeCycles.has('meadow:0'));
  assert.ok(p2.themeCycles.has('ocean:1'));
  assert.equal(p2.v, VERSION);
});

test('v1 saves migrate cleanly: themes + achievements come through, themeCycles empty', () => {
  const v1 = JSON.stringify({
    v: 1,
    themes: ['meadow', 'ocean', 'sakura'],
    achievements: ['size-1m', 'eat-100', 'full-cycle'],
  });
  const p = deserializeProgress(v1);
  assert.equal(p.v, VERSION);
  assert.deepEqual([...p.discovered].sort(), ['meadow', 'ocean', 'sakura']);
  assert.ok(p.unlocked.has('size-1m'));
  assert.ok(p.unlocked.has('eat-100'));
  assert.ok(p.unlocked.has('full-cycle'));
  assert.equal(p.themeCycles.size, 0, 'themeCycles must start empty on v1 migration');
});

test('deserialize is defensive against corrupt / empty / legacy / null payloads', () => {
  for (const raw of [
    '',
    'not-json{',
    '{"weird":true}',
    `{"v":999,"themes":[],"achievements":[]}`,
    'null',
    '[]',
    `{"v":${VERSION},"themes":"nope","achievements":null}`,
    `{"v":${VERSION}}`, // empty v2
    `{"v":1}`,          // empty v1
  ]) {
    const p = deserializeProgress(raw);
    assert.equal(p.discovered.size, 0, `raw=${raw && raw.length ? raw : '(empty)'}`);
    assert.equal(p.unlocked.size, 0);
    assert.equal(p.themeCycles.size, 0);
    assert.equal(p.v, VERSION);
  }
});

test('deserialize ignores unknown theme keys / achievement ids / themeCycles entries', () => {
  const raw = JSON.stringify({
    v: VERSION,
    themes: ['meadow', 'ocean', 'not-a-theme'],
    achievements: ['size-1m', 'not-an-achievement'],
    themeCycles: [
      'meadow:0', 'ocean:1',
      'bogus:2',            // unknown theme
      'meadow:notANum',     // bad cycle
      'meadow:-1',          // negative
      'meadow:',            // empty cycle
      ':1',                 // empty key
      42,                   // non-string
    ],
  });
  const p = deserializeProgress(raw);
  assert.deepEqual([...p.discovered].sort(), ['meadow', 'ocean']);
  assert.deepEqual([...p.unlocked], ['size-1m']);
  assert.deepEqual([...p.themeCycles].sort(), ['meadow:0', 'ocean:1']);
});

test('v1 themeCycles field (if present, unexpectedly) is ignored', () => {
  const raw = JSON.stringify({
    v: 1,
    themes: ['meadow'],
    achievements: [],
    themeCycles: ['meadow:0'],  // shouldn't exist on v1; must be dropped
  });
  const p = deserializeProgress(raw);
  assert.equal(p.themeCycles.size, 0);
});

test('ingest emits each unlock exactly once across many repeated events', () => {
  const p = createProgress();
  // First unlock size-10m so first-building can fire.
  ingest(p, { type: 'radius', r: 600 });
  for (let i = 0; i < 5; i++) {
    ingest(p, { type: 'combo', mult: 5 });
    ingest(p, { type: 'radius', r: 6000 });
    ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
    ingest(p, { type: 'swallow', emoji: '🏠' });
    ingest(p, { type: 'eaten', count: 100 });
  }
  const again1 = ingest(p, { type: 'combo', mult: 5 });
  const again2 = ingest(p, { type: 'swallow', emoji: '🏢' });
  const again3 = ingest(p, { type: 'themeVisit', key: 'meadow', cycle: 0 });
  assert.equal(again1.length + again2.length + again3.length, 0);
});
