// Discovery log + achievements engine. Headless: no DOM, no game globals —
// the UI layer feeds events and reads back newly-unlocked entries. The
// achievement graph itself (nodes, edges, layout) lives in
// js/achievements-table.js — this module is the state machine.
//
// Persistence: one JSON blob at localStorage['holefoods.progress'], versioned.
// BigInt score never enters this module (progress is counts, radii, cycles).
// Writes happen only on unlock, pause, and beforeunload — never per-frame.
//
// The achievement table is a DAG: each entry may declare `requires: [ids]`.
// Ingest resolves cascades to a FIXPOINT within one event so a single big
// meal (radius=big, mult=6, etc.) can legitimately unlock a whole chain in
// dependency order — banners queue up sensibly.

import {
  ACHIEVEMENTS, ACHIEVEMENT_IDS, THEMES_ORDER, THEME_KEYS,
  BUILDING_EMOJI, ACHIEVEMENT_BRANCHES, achievementById,
} from './achievements-table.js';

export {
  ACHIEVEMENTS, THEMES_ORDER, BUILDING_EMOJI, ACHIEVEMENT_BRANCHES,
  achievementById,
} from './achievements-table.js';

export const STORAGE_KEY = 'holefoods.progress';
export const VERSION = 2;             // v2 adds progress.themeCycles

// --- State + persistence -------------------------------------------------

export function createProgress() {
  return {
    v: VERSION,
    discovered: new Set(),   // theme keys seen at least once (any cycle)
    unlocked: new Set(),     // achievement ids that have fired
    themeCycles: new Set(),  // "themeKey:cycle" pairs ever visited (any run)
  };
}

// v2 adds themeCycles; v1 saves migrate cleanly (themeCycles starts empty).
// Meadow spawn refires "meadow:0" on the next frame anyway, so nothing is lost.
export function serializeProgress(progress) {
  return JSON.stringify({
    v: VERSION,
    themes: [...progress.discovered],
    achievements: [...progress.unlocked],
    themeCycles: [...progress.themeCycles],
  });
}

// Parse a raw string. Defensive: any parse error, wrong shape, or unknown
// version yields a fresh progress (so upgrading the schema or hand-editing
// localStorage never crashes the boot). v1 saves are migrated in place —
// same discovered/unlocked come through, themeCycles starts empty.
export function deserializeProgress(raw) {
  const fresh = createProgress();
  if (typeof raw !== 'string' || raw.length === 0) return fresh;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return fresh; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fresh;
  if (parsed.v !== 1 && parsed.v !== VERSION) return fresh;
  if (Array.isArray(parsed.themes)) {
    for (const k of parsed.themes) if (THEME_KEYS.has(k)) fresh.discovered.add(k);
  }
  if (Array.isArray(parsed.achievements)) {
    for (const id of parsed.achievements) if (ACHIEVEMENT_IDS.has(id)) fresh.unlocked.add(id);
  }
  if (parsed.v === VERSION && Array.isArray(parsed.themeCycles)) {
    for (const s of parsed.themeCycles) {
      const pair = parseThemeCyclePair(s);
      if (pair) fresh.themeCycles.add(`${pair.key}:${pair.cycle}`);
    }
  }
  return fresh;
}

function parseThemeCyclePair(s) {
  if (typeof s !== 'string') return null;
  const idx = s.indexOf(':');
  if (idx <= 0) return null;
  const key = s.slice(0, idx);
  if (!THEME_KEYS.has(key)) return null;
  const cycle = Number(s.slice(idx + 1));
  if (!Number.isInteger(cycle) || cycle < 0) return null;
  return { key, cycle };
}

// Best-effort browser load: any storage error (private mode, quota, no DOM)
// falls back to fresh progress. The tests exercise deserializeProgress directly.
export function loadProgress(storage) {
  const s = storage ?? defaultStorage();
  if (!s) return createProgress();
  try {
    return deserializeProgress(s.getItem(STORAGE_KEY));
  } catch {
    return createProgress();
  }
}

export function saveProgress(progress, storage) {
  const s = storage ?? defaultStorage();
  if (!s) return;
  try {
    // Union with whatever is already stored before writing: unlocks are
    // monotonic, and a stale tab's blind setItem must never erase progress
    // another tab persisted after this one loaded. Merging into the live
    // progress also converges this tab's in-memory state.
    const prior = deserializeProgress(s.getItem(STORAGE_KEY));
    for (const k of prior.discovered) progress.discovered.add(k);
    for (const id of prior.unlocked) progress.unlocked.add(id);
    for (const tc of prior.themeCycles) progress.themeCycles.add(tc);
    s.setItem(STORAGE_KEY, serializeProgress(progress));
  } catch {
    /* storage full / disabled — nothing to do */
  }
}

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
}

// --- Event ingestion -----------------------------------------------------

// Ingest one event, mutating `progress` and returning any newly-unlocked
// entries. Callers translate game events into this API:
//   themeVisit {key, cycle?}  — hole entered a theme cell in a cycle
//   swallow    {emoji}        — one object was consumed
//   radius     {r}            — hole radius (fed on level-up)
//   eaten      {count}        — running eatenCount (fed after each swallow)
//   combo      {mult}         — a combo tier fired
//   cycle      {cycle}        — hole crossed into a new biome cycle
//
// Returned entries have {kind:'discovery', key, name, sticker} or
// {kind:'achievement', ...achievement definition}. Every unlock fires at most
// once — repeat events for an already-unlocked entry return [].
//
// A single event may cascade a chain (radius=huge unlocks size-1m→10m→…
// all at once); we resolve to a fixpoint so those all land in dependency
// order in the returned list, ready for the UI to queue as banners.
export function ingest(progress, event) {
  const out = [];
  if (event.type === 'themeVisit'
      && typeof event.key === 'string'
      && THEME_KEYS.has(event.key)) {
    if (!progress.discovered.has(event.key)) {
      progress.discovered.add(event.key);
      const meta = THEMES_ORDER.find((t) => t.key === event.key);
      out.push({ kind: 'discovery', key: meta.key, name: meta.name, sticker: meta.sticker });
    }
    if (typeof event.cycle === 'number'
        && Number.isInteger(event.cycle)
        && event.cycle >= 0) {
      progress.themeCycles.add(`${event.key}:${event.cycle}`);
    }
  }
  // Fixpoint over the DAG: keep sweeping until no new node unlocks. The
  // ACHIEVEMENTS array is authored in dependency order, so in practice one
  // sweep is enough, but the fixpoint form makes the invariant explicit and
  // lets authors reorder rows without silently breaking chains.
  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    for (const a of ACHIEVEMENTS) {
      if (progress.unlocked.has(a.id)) continue;
      if (a.requires && !a.requires.every((id) => progress.unlocked.has(id))) continue;
      if (matches(a.trigger, event, progress)) {
        progress.unlocked.add(a.id);
        out.push({ kind: 'achievement', ...a });
        cascaded = true;
      }
    }
  }
  return out;
}

function matches(trigger, event, progress) {
  switch (trigger.kind) {
    case 'radius':
      return event.type === 'radius'
        && typeof event.r === 'number'
        && event.r >= trigger.min;
    case 'eaten':
      return event.type === 'eaten'
        && typeof event.count === 'number'
        && event.count >= trigger.min;
    case 'combo':
      return event.type === 'combo'
        && typeof event.mult === 'number'
        && event.mult >= trigger.min;
    case 'emoji':
      return event.type === 'swallow'
        && typeof event.emoji === 'string'
        && trigger.set.has(event.emoji);
    case 'cycle':
      return event.type === 'cycle'
        && typeof event.cycle === 'number'
        && event.cycle >= trigger.min;
    case 'themes':
      // Reads progress, not event — any ingest can trip it once we cross
      // the threshold (the triggering event is usually the themeVisit that
      // pushed the count to `min`, but a swallow after a hand-edited save
      // will self-heal it).
      return progress.discovered.size >= trigger.min;
    case 'themeCycle':
      // Fires as soon as we have any record of (key, cycle) in the visited
      // set. Any event may trigger it, since it reads progress, not event.
      return progress.themeCycles.has(`${trigger.key}:${trigger.cycle}`);
    case 'themeCycleCount': {
      // Distinct cycles the given theme has been observed in. The prefix
      // scan is cheap — the set has one entry per (theme, cycle) pair, so
      // its size is bounded by 18·(deepest cycle reached) ≪ a few hundred.
      const prefix = `${trigger.key}:`;
      let count = 0;
      for (const s of progress.themeCycles) if (s.startsWith(prefix)) count++;
      return count >= trigger.min;
    }
    default:
      return false;
  }
}

// --- Graph helpers (used by the map UI + integrity tests) ---------------

// Depth-first cycle check — verifies the graph is a DAG. Table-integrity
// test consumes this; the UI never needs to call it.
export function isAcyclic() {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(ACHIEVEMENTS.map((a) => [a.id, WHITE]));
  function visit(id) {
    if (color.get(id) === GRAY) return false;   // back-edge → cycle
    if (color.get(id) === BLACK) return true;
    color.set(id, GRAY);
    const node = achievementById(id);
    for (const r of node.requires ?? []) if (!visit(r)) return false;
    color.set(id, BLACK);
    return true;
  }
  for (const a of ACHIEVEMENTS) if (!visit(a.id)) return false;
  return true;
}
