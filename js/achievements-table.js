// Declarative achievement graph — the only file that gets edited when adding
// a new achievement. The engine (achievements.js) is data-driven off this.
//
// Node shape:
//   id / name / emoji / description — display
//   branch                          — which of 6 lanes the node belongs to
//   trigger { kind, ... }           — the event pattern that unlocks it
//   requires: [id, ...]             — DAG edges (all must be unlocked first)
//   col, row                        — grid coords for the map (col = tier
//                                     left→right; row = lane top→bottom;
//                                     fractional rows allow side offshoots)
//
// Adding a rung: append a row, choose `requires` from earlier ids, pick a
// vacant (col, row) cell. Every id below survives from v1 (persisted saves
// keep their unlocks intact) — never rename, never remove.

import { THEMES } from './catalog.js';

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

export const ACHIEVEMENT_BRANCHES = [
  'grandeur', 'appetite', 'combo', 'explorer', 'depth', 'homecoming',
];

export const ACHIEVEMENTS = [
  // --- GRANDEUR (size ladder) ---
  { id: 'size-1m', name: 'Bigger Than a Bagel', emoji: '🥯',
    description: 'Grow to 1 m across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 50 }, requires: [], col: 0, row: 0 },
  { id: 'size-10m', name: 'Room-Sized', emoji: '🛋️',
    description: 'Grow to 10 m across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 500 }, requires: ['size-1m'], col: 1, row: 0 },
  { id: 'size-100m', name: 'City Block', emoji: '🏙️',
    description: 'Grow to 100 m across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 5000 }, requires: ['size-10m'], col: 2, row: 0 },
  { id: 'size-1km', name: 'Continent Nibbler', emoji: '🌍',
    description: 'Grow to 1 km across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 50000 }, requires: ['size-100m'], col: 3, row: 0 },
  { id: 'size-10km', name: 'Sky-Scraping', emoji: '🌠',
    description: 'Grow to 10 km across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 500000 }, requires: ['size-1km'], col: 4, row: 0 },
  { id: 'size-100km', name: 'Planet-Sized', emoji: '🪐',
    description: 'Grow to 100 km across.', branch: 'grandeur',
    trigger: { kind: 'radius', min: 5000000 }, requires: ['size-10km'], col: 5, row: 0 },
  // Side node — hangs off size-10m as its own branch stub.
  { id: 'first-building', name: 'Neighborhood Watch', emoji: '🏢',
    description: 'Swallow your first whole building.', branch: 'grandeur',
    trigger: { kind: 'emoji', set: BUILDING_EMOJI }, requires: ['size-10m'],
    col: 1, row: 1 },

  // --- APPETITE (per-run eaten count) ---
  { id: 'eat-100', name: 'Snack Attack', emoji: '🍿',
    description: 'Swallow 100 things.', branch: 'appetite',
    trigger: { kind: 'eaten', min: 100 }, requires: [], col: 0, row: 2 },
  { id: 'eat-1000', name: 'Hearty Appetite', emoji: '🍔',
    description: 'Swallow 1,000 things.', branch: 'appetite',
    trigger: { kind: 'eaten', min: 1000 }, requires: ['eat-100'], col: 1, row: 2 },
  { id: 'eat-10000', name: 'Insatiable', emoji: '🥇',
    description: 'Swallow 10,000 things.', branch: 'appetite',
    trigger: { kind: 'eaten', min: 10000 }, requires: ['eat-1000'], col: 2, row: 2 },
  { id: 'eat-100000', name: 'Bottomless', emoji: '♾️',
    description: 'Swallow 100,000 things.', branch: 'appetite',
    trigger: { kind: 'eaten', min: 100000 }, requires: ['eat-10000'], col: 3, row: 2 },

  // --- COMBO (streak multipliers) ---
  { id: 'combo-x2', name: 'Double Up', emoji: '✌️',
    description: 'Hit a ×2 combo.', branch: 'combo',
    trigger: { kind: 'combo', min: 2 }, requires: [], col: 0, row: 3 },
  { id: 'combo-x3', name: 'Triple Threat', emoji: '🔥',
    description: 'Hit a ×3 combo.', branch: 'combo',
    trigger: { kind: 'combo', min: 3 }, requires: ['combo-x2'], col: 1, row: 3 },
  { id: 'combo-x4', name: 'Quadruple', emoji: '💥',
    description: 'Hit a ×4 combo.', branch: 'combo',
    trigger: { kind: 'combo', min: 4 }, requires: ['combo-x3'], col: 2, row: 3 },
  { id: 'combo-x5', name: 'Frenzy', emoji: '⚡',
    description: 'Hit a ×5 combo.', branch: 'combo',
    trigger: { kind: 'combo', min: 5 }, requires: ['combo-x4'], col: 3, row: 3 },

  // --- EXPLORER (distinct themes discovered) ---
  { id: 'themes-3', name: 'Wandering Eye', emoji: '👣',
    description: 'Discover 3 biomes.', branch: 'explorer',
    trigger: { kind: 'themes', min: 3 }, requires: [], col: 0, row: 4 },
  { id: 'themes-9', name: 'Well-Travelled', emoji: '🧭',
    description: 'Discover 9 biomes.', branch: 'explorer',
    trigger: { kind: 'themes', min: 9 }, requires: ['themes-3'], col: 1, row: 4 },
  { id: 'all-themes', name: 'Cartographer', emoji: '🗺️',
    description: 'Discover all 18 biomes.', branch: 'explorer',
    trigger: { kind: 'themes', min: 18 }, requires: ['themes-9'], col: 2, row: 4 },

  // --- DEPTH (cycles reached) ---
  { id: 'full-cycle', name: 'Around the World', emoji: '🔄',
    description: 'Cross a full biome cycle.', branch: 'depth',
    trigger: { kind: 'cycle', min: 1 }, requires: [], col: 0, row: 5 },
  { id: 'cycle-2', name: 'Twice Around', emoji: '🌀',
    description: 'Reach the second cycle.', branch: 'depth',
    trigger: { kind: 'cycle', min: 2 }, requires: ['full-cycle'], col: 1, row: 5 },
  { id: 'cycle-3', name: 'Deeper Still', emoji: '🌪️',
    description: 'Reach the third cycle.', branch: 'depth',
    trigger: { kind: 'cycle', min: 3 }, requires: ['cycle-2'], col: 2, row: 5 },
  { id: 'cycle-5', name: 'Abyssal', emoji: '🕳️',
    description: 'Reach the fifth cycle.', branch: 'depth',
    trigger: { kind: 'cycle', min: 5 }, requires: ['cycle-3'], col: 3, row: 5 },

  // --- HOMECOMING (visiting home biome at deeper scales) ---
  // Root edge to DEPTH: seeing your home meadow the second time only means
  // something once you know a full cycle has passed. This is the graph's
  // deliberate cross-link between branches.
  { id: 'meadow-c1', name: 'Meadow, Grown', emoji: '🌾',
    description: 'Revisit Berry Meadow at cycle II.', branch: 'homecoming',
    trigger: { kind: 'themeCycle', key: 'meadow', cycle: 1 },
    requires: ['full-cycle'], col: 1, row: 6 },
  { id: 'meadow-c2', name: 'Meadow, Massive', emoji: '🍓',
    description: 'Revisit Berry Meadow at cycle III.', branch: 'homecoming',
    trigger: { kind: 'themeCycle', key: 'meadow', cycle: 2 },
    requires: ['meadow-c1'], col: 2, row: 6 },
  { id: 'meadow-6c', name: 'Meadow, Forever', emoji: '🌻',
    description: 'Visit Berry Meadow across 6 distinct cycles.',
    branch: 'homecoming',
    trigger: { kind: 'themeCycleCount', key: 'meadow', min: 6 },
    requires: ['meadow-c2'], col: 3, row: 6 },
];

export const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));
export const THEME_KEYS = new Set(THEMES_ORDER.map((t) => t.key));

export function achievementById(id) {
  for (const a of ACHIEVEMENTS) if (a.id === id) return a;
  return null;
}
