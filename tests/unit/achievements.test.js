// Achievements engine: headless. No DOM here — the engine ingests events
// and returns newly-unlocked entries. The UI layer reacts to those.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../../js/catalog.js';
import {
  ACHIEVEMENTS, THEMES_ORDER, BUILDING_EMOJI, VERSION,
  createProgress, ingest,
  serializeProgress, deserializeProgress,
} from '../../js/achievements.js';

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
  }
  // The eight non-discovery milestones the spec calls out.
  for (const id of [
    'size-1m', 'size-10m', 'size-100m', 'size-1km',
    'eat-100', 'eat-1000', 'eat-10000',
    'combo-x5', 'first-building', 'full-cycle', 'all-themes',
  ]) {
    assert.ok(ids.has(id), `missing achievement ${id}`);
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
  // A few sanity picks — all appear in the catalog's tables.
  for (const e of ['🏠', '🏢', '⛪', '🏭']) {
    assert.ok(BUILDING_EMOJI.has(e), `expected ${e} in BUILDING_EMOJI`);
  }
  // Non-buildings must NOT count as buildings.
  for (const e of ['🍓', '🌳', '🎂', '🐙', '🎡']) {
    assert.ok(!BUILDING_EMOJI.has(e), `${e} should not be a building`);
  }
});

test('fresh progress has nothing discovered or unlocked', () => {
  const p = createProgress();
  assert.equal(p.discovered.size, 0);
  assert.equal(p.unlocked.size, 0);
  assert.equal(p.v, VERSION);
});

test('themeVisit unlocks a discovery once; repeat is a no-op', () => {
  const p = createProgress();
  const first = ingest(p, { type: 'themeVisit', key: 'meadow' });
  const disc = first.filter((u) => u.kind === 'discovery');
  assert.equal(disc.length, 1);
  assert.equal(disc[0].key, 'meadow');
  assert.ok(p.discovered.has('meadow'));
  const second = ingest(p, { type: 'themeVisit', key: 'meadow' });
  assert.equal(second.filter((u) => u.kind === 'discovery').length, 0);
});

test('an unknown themeVisit key is ignored (no discovery event)', () => {
  const p = createProgress();
  const out = ingest(p, { type: 'themeVisit', key: 'nonexistent-biome' });
  assert.equal(out.filter((u) => u.kind === 'discovery').length, 0);
  assert.equal(p.discovered.size, 0);
});

test('discovering all 18 themes fires the capstone exactly once', () => {
  const p = createProgress();
  let capstoneHits = 0;
  for (const t of THEMES) {
    const u = ingest(p, { type: 'themeVisit', key: t.key });
    for (const e of u) if (e.id === 'all-themes') capstoneHits += 1;
  }
  assert.equal(capstoneHits, 1);
  assert.ok(p.unlocked.has('all-themes'));
  // A repeat visit doesn't re-fire it.
  const again = ingest(p, { type: 'themeVisit', key: THEMES[0].key });
  assert.equal(again.filter((u) => u.id === 'all-themes').length, 0);
});

test('capstone does NOT fire when only 17 of 18 are discovered', () => {
  const p = createProgress();
  for (let i = 0; i < 17; i++) ingest(p, { type: 'themeVisit', key: THEMES[i].key });
  assert.ok(!p.unlocked.has('all-themes'));
});

test('swallowing a building emoji fires first-building; second building does not re-unlock', () => {
  const p = createProgress();
  const notBldg = ingest(p, { type: 'swallow', emoji: '🍓' });
  assert.equal(notBldg.filter((u) => u.id === 'first-building').length, 0);
  const bldg = ingest(p, { type: 'swallow', emoji: '🏠' });
  assert.equal(bldg.filter((u) => u.id === 'first-building').length, 1);
  const again = ingest(p, { type: 'swallow', emoji: '⛪' });
  assert.equal(again.filter((u) => u.id === 'first-building').length, 0);
});

test('size milestones fire at 1 m / 10 m / 100 m / 1 km diameters (r = 50/500/5000/50000)', () => {
  // 1 world unit = 1 cm. Diameter = 2r.
  const p1 = createProgress();
  const u1 = ingest(p1, { type: 'radius', r: 60 });
  assert.equal(u1.filter((u) => u.id === 'size-1m').length, 1);
  // Same radius again: no re-unlock.
  const dupe = ingest(p1, { type: 'radius', r: 60 });
  assert.equal(dupe.filter((u) => u.id === 'size-1m').length, 0);
  // Below 10 m — no size-10m yet.
  const u2 = ingest(p1, { type: 'radius', r: 100 });
  assert.equal(u2.length, 0);

  // Jump above all thresholds at once — remaining tiers unlock in the same event.
  const p2 = createProgress();
  const big = ingest(p2, { type: 'radius', r: 60000 });
  const ids = new Set(big.map((u) => u.id));
  for (const id of ['size-1m', 'size-10m', 'size-100m', 'size-1km']) {
    assert.ok(ids.has(id), `missing ${id} in big-jump unlocks`);
  }
});

test('exactly-at-threshold radii unlock (r = 50 → 1 m)', () => {
  const p = createProgress();
  const u = ingest(p, { type: 'radius', r: 50 });
  assert.equal(u.filter((u) => u.id === 'size-1m').length, 1);
});

test('eaten count milestones fire at 100 / 1,000 / 10,000', () => {
  const p = createProgress();
  assert.equal(ingest(p, { type: 'eaten', count: 99 }).length, 0);
  const hit = ingest(p, { type: 'eaten', count: 100 });
  assert.equal(hit.filter((u) => u.id === 'eat-100').length, 1);
  const dupe = ingest(p, { type: 'eaten', count: 500 });
  assert.equal(dupe.filter((u) => u.id === 'eat-100').length, 0);
  const big = ingest(p, { type: 'eaten', count: 15000 });
  const ids = new Set(big.map((u) => u.id));
  assert.ok(ids.has('eat-1000'));
  assert.ok(ids.has('eat-10000'));
});

test('combo ×5 unlocks combo-x5; a smaller mult does not', () => {
  const p = createProgress();
  assert.equal(ingest(p, { type: 'combo', mult: 2 }).length, 0);
  const hit = ingest(p, { type: 'combo', mult: 5 });
  assert.equal(hit.filter((u) => u.id === 'combo-x5').length, 1);
});

test('crossing into cycle 1 unlocks full-cycle; cycle 0 does not', () => {
  const p = createProgress();
  assert.equal(ingest(p, { type: 'cycle', cycle: 0 }).length, 0);
  const c1 = ingest(p, { type: 'cycle', cycle: 1 });
  assert.equal(c1.filter((u) => u.id === 'full-cycle').length, 1);
});

test('progress round-trips through serialize / deserialize', () => {
  const p = createProgress();
  ingest(p, { type: 'themeVisit', key: 'meadow' });
  ingest(p, { type: 'themeVisit', key: 'ocean' });
  ingest(p, { type: 'radius', r: 60 });
  ingest(p, { type: 'combo', mult: 5 });
  const str = serializeProgress(p);
  assert.ok(typeof str === 'string');
  const p2 = deserializeProgress(str);
  assert.deepEqual([...p2.discovered].sort(), ['meadow', 'ocean']);
  assert.ok(p2.unlocked.has('size-1m'));
  assert.ok(p2.unlocked.has('combo-x5'));
  assert.equal(p2.v, VERSION);
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
    `{"v":${VERSION}}`, // legacy empty
  ]) {
    const p = deserializeProgress(raw);
    assert.equal(p.discovered.size, 0, `raw=${raw && raw.length ? raw : '(empty)'}`);
    assert.equal(p.unlocked.size, 0);
    assert.equal(p.v, VERSION);
  }
});

test('deserialize ignores unknown theme keys / achievement ids gracefully', () => {
  const raw = JSON.stringify({
    v: VERSION,
    themes: ['meadow', 'ocean', 'not-a-theme'],
    achievements: ['size-1m', 'not-an-achievement'],
  });
  const p = deserializeProgress(raw);
  assert.deepEqual([...p.discovered].sort(), ['meadow', 'ocean']);
  assert.deepEqual([...p.unlocked], ['size-1m']);
});

test('ingest emits each unlock exactly once across many repeated events', () => {
  const p = createProgress();
  for (let i = 0; i < 5; i++) {
    ingest(p, { type: 'combo', mult: 5 });
    ingest(p, { type: 'radius', r: 6000 });
    ingest(p, { type: 'themeVisit', key: 'meadow' });
    ingest(p, { type: 'swallow', emoji: '🏠' });
    ingest(p, { type: 'eaten', count: 100 });
  }
  // A final volley must produce zero deltas.
  const again = ingest(p, { type: 'combo', mult: 5 });
  const again2 = ingest(p, { type: 'swallow', emoji: '🏢' });
  const again3 = ingest(p, { type: 'themeVisit', key: 'meadow' });
  assert.equal(again.length + again2.length + again3.length, 0);
});
