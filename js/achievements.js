// Discovery log + milestone achievements. Headless engine: no DOM, no game
// globals — the UI layer feeds it events and reacts to newly-unlocked entries.
// Progress is meta-progression: it survives run restarts and page reloads.
//
// Persistence: one JSON blob at localStorage['holefoods.progress'], versioned.
// BigInt score never enters this module (progress is counts, radii, cycles).
// Writes happen only on unlock, pause, and beforeunload — never per-frame.

import { THEMES } from './catalog.js';

export const STORAGE_KEY = 'holefoods.progress';
export const VERSION = 1;

// 18 architectural-structure emojis that live in the catalog's item tables.
// "First building swallowed" fires the moment one of these is eaten. Tents,
// fairground rides, and trees are deliberately excluded — the achievement is
// about swallowing a REAL building, not just a large object.
export const BUILDING_EMOJI = new Set([
  '🛖', '🏠', '🏡', '⛪', '🏢', '🏬', '🏚️',
  '🏫', '⛩️', '🏯', '🕌', '🛕', '🏭', '🏗️',
]);

// One sticker emoji per theme for the discovery grid. Curated (not just the
// theme's biggest item) so each slot reads at a glance. Keys must match every
// entry in catalog.THEMES — the table-integrity test enforces that.
const THEME_STICKERS = {
  meadow:    '🍓',
  orchard:   '🌳',
  bakery:    '🎂',
  toybox:    '🧸',
  funfair:   '🎡',
  downtown:  '🏢',
  haunt:     '🎃',
  ocean:     '🐙',
  savanna:   '🦁',
  cosmos:    '🌌',
  academy:   '🎓',
  winter:    '⛄',
  sakura:    '🌸',
  musichall: '🎹',
  farm:      '🐄',
  jungle:    '🐆',
  desert:    '🐫',
  factory:   '🤖',
};

// Discovery slots, in the fixed pool order — same layout every session so the
// grid feels like a memorized keepsake, not a shuffled list.
export const THEMES_ORDER = THEMES.map((t) => ({
  key: t.key,
  name: t.name,
  sticker: THEME_STICKERS[t.key],
}));

const THEME_KEYS = new Set(THEMES_ORDER.map((t) => t.key));

// Declarative achievement definitions. `trigger.kind` decides which ingest
// event unlocks it; other fields (`min`, `set`) parameterize the check. Every
// non-discovery unlock in the game is one entry here — add a row, wire nothing
// else. Order in this array drives the display order in the collection UI.
export const ACHIEVEMENTS = [
  {
    id: 'size-1m',
    name: 'Bigger Than a Bagel',
    emoji: '🥯',
    description: 'Grow to 1 m across.',
    trigger: { kind: 'radius', min: 50 },
  },
  {
    id: 'size-10m',
    name: 'Room-Sized',
    emoji: '🛋️',
    description: 'Grow to 10 m across.',
    trigger: { kind: 'radius', min: 500 },
  },
  {
    id: 'size-100m',
    name: 'City Block',
    emoji: '🏙️',
    description: 'Grow to 100 m across.',
    trigger: { kind: 'radius', min: 5000 },
  },
  {
    id: 'size-1km',
    name: 'Continent Nibbler',
    emoji: '🌍',
    description: 'Grow to 1 km across.',
    trigger: { kind: 'radius', min: 50000 },
  },
  {
    id: 'eat-100',
    name: 'Snack Attack',
    emoji: '🍿',
    description: 'Swallow 100 things.',
    trigger: { kind: 'eaten', min: 100 },
  },
  {
    id: 'eat-1000',
    name: 'Hearty Appetite',
    emoji: '🍔',
    description: 'Swallow 1,000 things.',
    trigger: { kind: 'eaten', min: 1000 },
  },
  {
    id: 'eat-10000',
    name: 'Insatiable',
    emoji: '🥇',
    description: 'Swallow 10,000 things.',
    trigger: { kind: 'eaten', min: 10000 },
  },
  {
    id: 'combo-x5',
    name: 'Frenzy',
    emoji: '⚡',
    description: 'Hit a ×5 combo.',
    trigger: { kind: 'combo', min: 5 },
  },
  {
    id: 'first-building',
    name: 'Neighborhood Watch',
    emoji: '🏢',
    description: 'Swallow your first whole building.',
    trigger: { kind: 'emoji', set: BUILDING_EMOJI },
  },
  {
    id: 'full-cycle',
    name: 'Around the World',
    emoji: '🔄',
    description: 'Cross a full biome cycle.',
    trigger: { kind: 'cycle', min: 1 },
  },
  {
    id: 'all-themes',
    name: 'Cartographer',
    emoji: '🗺️',
    description: 'Discover all 18 biomes.',
    trigger: { kind: 'themes', min: 18 },
  },
];

const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

// --- State + persistence -------------------------------------------------

export function createProgress() {
  return {
    v: VERSION,
    discovered: new Set(),
    unlocked: new Set(),
  };
}

export function serializeProgress(progress) {
  return JSON.stringify({
    v: VERSION,
    themes: [...progress.discovered],
    achievements: [...progress.unlocked],
  });
}

// Parse a raw string. Defensive: any parse error, wrong shape, wrong version,
// or unknown ids yields a fresh progress (so upgrading the schema or hand-
// editing localStorage never crashes the boot).
export function deserializeProgress(raw) {
  const fresh = createProgress();
  if (typeof raw !== 'string' || raw.length === 0) return fresh;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return fresh; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fresh;
  if (parsed.v !== VERSION) return fresh;
  if (Array.isArray(parsed.themes)) {
    for (const k of parsed.themes) if (THEME_KEYS.has(k)) fresh.discovered.add(k);
  }
  if (Array.isArray(parsed.achievements)) {
    for (const id of parsed.achievements) if (ACHIEVEMENT_IDS.has(id)) fresh.unlocked.add(id);
  }
  return fresh;
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
//   themeVisit {key}       — hole entered a theme cell
//   swallow    {emoji}     — one object was consumed
//   radius     {r}         — hole radius (fed on level-up)
//   eaten      {count}     — running eatenCount (fed after each swallow)
//   combo      {mult}      — a combo tier fired
//   cycle      {cycle}     — hole crossed into a new biome cycle
//
// The returned entries have {kind:'discovery', key, name, sticker} or
// {kind:'achievement', ...achievement definition}. Every unlock fires at most
// once — repeat events for an already-unlocked entry return [].
export function ingest(progress, event) {
  const out = [];
  if (event.type === 'themeVisit'
      && typeof event.key === 'string'
      && THEME_KEYS.has(event.key)
      && !progress.discovered.has(event.key)) {
    progress.discovered.add(event.key);
    const meta = THEMES_ORDER.find((t) => t.key === event.key);
    out.push({ kind: 'discovery', key: meta.key, name: meta.name, sticker: meta.sticker });
  }
  for (const a of ACHIEVEMENTS) {
    if (progress.unlocked.has(a.id)) continue;
    if (matches(a.trigger, event, progress)) {
      progress.unlocked.add(a.id);
      out.push({ kind: 'achievement', ...a });
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
      // The capstone: whenever ANY event lands and the discovery count has
      // reached the threshold, fire once. In practice the triggering event
      // is the themeVisit that pushed the count to `min`.
      return progress.discovered.size >= trigger.min;
    default:
      return false;
  }
}
