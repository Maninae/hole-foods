// Theme + object catalog: what the world is made of.
//
// Every theme's items live in ONE canonical base-radius range (~7..60). The
// ARRIVAL SCALE is not baked into the tables — it comes from the SLOT_MULTS
// ladder below, which multiplies base sizes by the band's slot within its
// cycle (slot = band % BANDS_PER_CYCLE). This way any theme can appear at
// any slot: pace at slot 0, cathedrals at slot 5, from the same raw table.
//
// `up: true` = never rotate (buildings, trees, standing figures). Pure
// module: no DOM.

import { CONFIG } from './config.js';

// Sizes step up by ~1.55x per slot inside a cycle — matches the arrival-
// pacing rule (hole grows roughly 1.55x per band traversed), so the slot-k
// item ladder is still edible when a hole reaches slot k.
export const SLOT_MULTS = [1, 1.55, 2.4, 3.72, 5.77, 8.95];

// The 18-theme pool. First six are the classic biomes in original order —
// cycle 0's rotation must land on them, and BIOMES stays exported as an
// alias for anything that used to import a 6-item array.
export const THEMES = [
  {
    key: 'meadow', name: 'Berry Meadow',
    ground: '#9fd483', groundAlt: '#93c977', decals: ['🌼', '🌿', '🦋'],
    items: [
      { e: '🫐', r: 7,  w: 10,  hue: 230 },
      { e: '🍇', r: 9,  w: 9,   hue: 280 },
      { e: '🍓', r: 11, w: 9,   hue: 350 },
      { e: '🍒', r: 12, w: 8,   hue: 345 },
      { e: '🍋', r: 14, w: 7,   hue: 55 },
      { e: '🥝', r: 16, w: 7,   hue: 90 },
      { e: '🍎', r: 18, w: 6,   hue: 355 },
      { e: '🍊', r: 20, w: 6,   hue: 30 },
      { e: '🍐', r: 22, w: 5,   hue: 80 },
      { e: '🍌', r: 25, w: 5,   hue: 50 },
      { e: '🍍', r: 32, w: 3,   hue: 45 },
      { e: '🍉', r: 42, w: 2,   hue: 140 },
      { e: '🧺', r: 52, w: 1.2, hue: 35 },
      { e: '⛱️', r: 60, w: 0.7, hue: 190, up: true },
    ],
  },
  {
    key: 'orchard', name: 'Orchard Grove',
    ground: '#6fb35f', groundAlt: '#66a857', decals: ['🍂', '🌱', '🍄'],
    items: [
      { e: '🌰', r: 8,  w: 10,  hue: 25 },
      { e: '🌷', r: 10, w: 9,   hue: 330 },
      { e: '🍑', r: 12, w: 8,   hue: 20 },
      { e: '🍏', r: 14, w: 8,   hue: 100 },
      { e: '🍄', r: 16, w: 7,   hue: 5 },
      { e: '🥥', r: 20, w: 6,   hue: 30 },
      { e: '🌻', r: 24, w: 5,   hue: 48 },
      { e: '🎃', r: 28, w: 4,   hue: 28 },
      { e: '🪵', r: 34, w: 3,   hue: 30 },
      { e: '🌳', r: 44, w: 2,   hue: 120, up: true },
      { e: '🌲', r: 52, w: 1.5, hue: 150, up: true },
      { e: '🛖', r: 60, w: 0.8, hue: 30,  up: true },
    ],
  },
  {
    key: 'bakery', name: 'Sugar Bakery',
    ground: '#f4cdbd', groundAlt: '#efc2b0', decals: ['✨', '🫧'],
    items: [
      { e: '🍬', r: 8,  w: 10,  hue: 320 },
      { e: '🍪', r: 10, w: 9,   hue: 35 },
      { e: '🍭', r: 12, w: 8,   hue: 300 },
      { e: '🍫', r: 14, w: 7,   hue: 25 },
      { e: '🥨', r: 16, w: 7,   hue: 35 },
      { e: '🧁', r: 18, w: 6,   hue: 330 },
      { e: '🥐', r: 20, w: 6,   hue: 40 },
      { e: '🍩', r: 22, w: 5,   hue: 315 },
      { e: '☕', r: 26, w: 4,   hue: 25 },
      { e: '🍰', r: 32, w: 4,   hue: 345 },
      { e: '🥞', r: 38, w: 3,   hue: 42 },
      { e: '🥧', r: 44, w: 2,   hue: 35 },
      { e: '🎂', r: 52, w: 1.5, hue: 335 },
      { e: '🚚', r: 60, w: 0.7, hue: 210, up: true },
    ],
  },
  {
    key: 'toybox', name: 'Toybox Town',
    ground: '#c9b4ea', groundAlt: '#bfa8e3', decals: ['⭐', '🎵'],
    items: [
      { e: '🎲', r: 8,  w: 10,  hue: 0 },
      { e: '🪀', r: 10, w: 9,   hue: 350 },
      { e: '⚽', r: 12, w: 8,   hue: 0 },
      { e: '🏀', r: 14, w: 7,   hue: 20 },
      { e: '🎈', r: 16, w: 7,   hue: 355 },
      { e: '🪁', r: 20, w: 6,   hue: 200 },
      { e: '🎁', r: 24, w: 5,   hue: 340 },
      { e: '🧸', r: 28, w: 5,   hue: 30 },
      { e: '🛴', r: 34, w: 4,   hue: 200 },
      { e: '🚲', r: 40, w: 3,   hue: 140 },
      { e: '🛝', r: 48, w: 2,   hue: 45,  up: true },
      { e: '🎠', r: 54, w: 1.2, hue: 330, up: true },
      { e: '🎪', r: 60, w: 0.7, hue: 0,   up: true },
    ],
  },
  {
    key: 'funfair', name: 'Funfair Boardwalk',
    ground: '#8fd0c6', groundAlt: '#83c6bb', decals: ['🎊', '✨'],
    items: [
      { e: '🍦', r: 8,  w: 10,  hue: 40 },
      { e: '🥤', r: 10, w: 9,   hue: 355 },
      { e: '🍟', r: 12, w: 8,   hue: 48 },
      { e: '🌭', r: 14, w: 7,   hue: 30 },
      { e: '🍔', r: 16, w: 7,   hue: 35 },
      { e: '🍕', r: 20, w: 6,   hue: 30 },
      { e: '🍿', r: 22, w: 5,   hue: 50 },
      { e: '🪑', r: 26, w: 4,   hue: 30 },
      { e: '🎳', r: 32, w: 3,   hue: 210 },
      { e: '🛶', r: 40, w: 2,   hue: 25 },
      { e: '⛲', r: 48, w: 1.5, hue: 200, up: true },
      { e: '🎢', r: 54, w: 1,   hue: 210, up: true },
      { e: '🎡', r: 60, w: 0.6, hue: 340, up: true },
    ],
  },
  {
    key: 'downtown', name: 'Downtown',
    ground: '#b9c0cc', groundAlt: '#aeb6c4', decals: ['🐦', '🍂'],
    items: [
      { e: '🛵', r: 8,  w: 10,  hue: 355 },
      { e: '🚏', r: 10, w: 9,   hue: 210, up: true },
      { e: '🚗', r: 14, w: 8,   hue: 0 },
      { e: '🚕', r: 16, w: 7,   hue: 48 },
      { e: '🚙', r: 18, w: 7,   hue: 210 },
      { e: '🌳', r: 22, w: 6,   hue: 120, up: true },
      { e: '⛲', r: 26, w: 5,   hue: 200, up: true },
      { e: '🚚', r: 30, w: 4,   hue: 25 },
      { e: '🚌', r: 34, w: 4,   hue: 45 },
      { e: '🏠', r: 42, w: 3,   hue: 25,  up: true },
      { e: '🏡', r: 46, w: 2,   hue: 100, up: true },
      { e: '⛪', r: 52, w: 1.2, hue: 220, up: true },
      { e: '🏢', r: 56, w: 0.8, hue: 215, up: true },
      { e: '🏬', r: 60, w: 0.6, hue: 200, up: true },
    ],
  },
  {
    key: 'haunt', name: 'Halloween Haunt',
    ground: '#a3663a', groundAlt: '#95593a', decals: ['🕸️', '🍂', '🌙'],
    items: [
      { e: '🍬', r: 7,  w: 10,  hue: 25 },
      { e: '🍭', r: 9,  w: 9,   hue: 310 },
      { e: '🕷️', r: 11, w: 8,   hue: 270 },
      { e: '🦇', r: 13, w: 8,   hue: 280 },
      { e: '🕸️', r: 15, w: 7,   hue: 0 },
      { e: '🎃', r: 18, w: 6,   hue: 25 },
      { e: '👻', r: 22, w: 5,   hue: 200 },
      { e: '🧙', r: 28, w: 4,   hue: 280, up: true },
      { e: '🪦', r: 32, w: 3,   hue: 0,   up: true },
      { e: '⚰️', r: 38, w: 2.5, hue: 25 },
      { e: '🧟', r: 44, w: 2,   hue: 110, up: true },
      { e: '🏚️', r: 60, w: 0.8, hue: 25,  up: true },
    ],
  },
  {
    key: 'ocean', name: 'Ocean Depths',
    ground: '#3a7ca5', groundAlt: '#326a95', decals: ['🫧', '💧', '🐚'],
    items: [
      { e: '🐚', r: 8,  w: 10,  hue: 45 },
      { e: '🦐', r: 10, w: 9,   hue: 15 },
      { e: '🦀', r: 12, w: 8,   hue: 10 },
      { e: '🐠', r: 14, w: 8,   hue: 45 },
      { e: '🐡', r: 16, w: 7,   hue: 48 },
      { e: '🐙', r: 20, w: 6,   hue: 340 },
      { e: '🦑', r: 22, w: 5,   hue: 340 },
      { e: '🪸', r: 26, w: 5,   hue: 350 },
      { e: '🐬', r: 32, w: 4,   hue: 210 },
      { e: '🦈', r: 40, w: 3,   hue: 215 },
      { e: '🐋', r: 46, w: 2,   hue: 220 },
      { e: '⚓', r: 52, w: 1.5, hue: 210, up: true },
      { e: '🚢', r: 60, w: 1,   hue: 210, up: true },
    ],
  },
  {
    key: 'savanna', name: 'Safari Savanna',
    ground: '#c9a066', groundAlt: '#bd9560', decals: ['🌾', '🌿', '🪨'],
    items: [
      { e: '🐁', r: 7,  w: 10,  hue: 25 },
      { e: '🐇', r: 9,  w: 9,   hue: 25 },
      { e: '🦔', r: 11, w: 8,   hue: 25 },
      { e: '🦎', r: 13, w: 7,   hue: 90 },
      { e: '🦊', r: 15, w: 7,   hue: 25 },
      { e: '🐒', r: 18, w: 6,   hue: 25 },
      { e: '🐆', r: 22, w: 5,   hue: 40 },
      { e: '🦓', r: 26, w: 5,   hue: 0 },
      { e: '🦁', r: 32, w: 4,   hue: 40 },
      { e: '🦒', r: 40, w: 3,   hue: 40,  up: true },
      { e: '🐘', r: 46, w: 2,   hue: 210 },
      { e: '🦏', r: 52, w: 1.5, hue: 210 },
      { e: '🌴', r: 60, w: 1,   hue: 100, up: true },
    ],
  },
  {
    key: 'cosmos', name: 'Cosmic Void',
    // Deep indigo, not black: the hole pit and dark object silhouettes
    // still need contrast against the ground.
    ground: '#3d3670', groundAlt: '#332c62', decals: ['✨', '⭐', '🌠'],
    items: [
      { e: '⭐', r: 7,  w: 10,  hue: 48 },
      { e: '✨', r: 9,  w: 9,   hue: 48 },
      { e: '☄️', r: 12, w: 7,   hue: 200 },
      { e: '💫', r: 14, w: 7,   hue: 48 },
      { e: '🌟', r: 16, w: 6,   hue: 48 },
      { e: '🌠', r: 20, w: 5,   hue: 200 },
      { e: '🌙', r: 24, w: 5,   hue: 48 },
      { e: '🪐', r: 32, w: 4,   hue: 200 },
      { e: '☀️', r: 36, w: 3,   hue: 48 },
      { e: '🌎', r: 42, w: 3,   hue: 200 },
      { e: '🛸', r: 50, w: 2,   hue: 280 },
      { e: '🌌', r: 60, w: 1,   hue: 280, up: true },
    ],
  },
  {
    key: 'academy', name: 'Chalkboard Academy',
    ground: '#3f6b4f', groundAlt: '#366145', decals: ['✏️', '📎', '⭐'],
    items: [
      { e: '✏️', r: 7,  w: 10,  hue: 48 },
      { e: '📎', r: 9,  w: 9,   hue: 0 },
      { e: '🖍️', r: 11, w: 8,   hue: 15 },
      { e: '📏', r: 13, w: 7,   hue: 45 },
      { e: '📐', r: 15, w: 7,   hue: 45 },
      { e: '🔢', r: 18, w: 6,   hue: 45 },
      { e: '🧮', r: 22, w: 5,   hue: 25 },
      { e: '📚', r: 26, w: 5,   hue: 25 },
      { e: '🎒', r: 32, w: 4,   hue: 15 },
      { e: '📓', r: 36, w: 3,   hue: 210 },
      { e: '🖥️', r: 42, w: 2,   hue: 200 },
      { e: '🎓', r: 48, w: 1.5, hue: 0 },
      { e: '🏫', r: 60, w: 0.8, hue: 340, up: true },
    ],
  },
  {
    key: 'winter', name: 'Winter Wonderland',
    ground: '#cfe4ee', groundAlt: '#c1d9e5', decals: ['❄️', '✨', '🌲'],
    items: [
      { e: '❄️', r: 7,  w: 10,  hue: 200 },
      { e: '🧊', r: 9,  w: 9,   hue: 200 },
      { e: '⛸️', r: 11, w: 8,   hue: 210 },
      { e: '🎿', r: 14, w: 7,   hue: 200 },
      { e: '🛷', r: 16, w: 7,   hue: 15 },
      { e: '🐧', r: 20, w: 6,   hue: 200 },
      { e: '⛄', r: 26, w: 5,   hue: 200 },
      { e: '🎁', r: 30, w: 4,   hue: 0 },
      { e: '🎅', r: 34, w: 3,   hue: 0,   up: true },
      { e: '⛷️', r: 40, w: 2.5, hue: 200, up: true },
      { e: '🎄', r: 48, w: 2,   hue: 120, up: true },
      { e: '🛖', r: 54, w: 1.2, hue: 200, up: true },
      { e: '🏔️', r: 60, w: 0.8, hue: 200, up: true },
    ],
  },
  {
    key: 'sakura', name: 'Sakura Garden',
    ground: '#f5cfd8', groundAlt: '#eebfcc', decals: ['🌸', '💮', '🍃'],
    items: [
      { e: '🌸', r: 7,  w: 10,  hue: 330 },
      { e: '💮', r: 9,  w: 9,   hue: 330 },
      { e: '🌷', r: 11, w: 8,   hue: 340 },
      { e: '🍡', r: 13, w: 7,   hue: 330 },
      { e: '🍵', r: 15, w: 7,   hue: 100 },
      { e: '🍶', r: 18, w: 6,   hue: 45 },
      { e: '🏮', r: 22, w: 5,   hue: 0 },
      { e: '🎐', r: 26, w: 4,   hue: 200 },
      { e: '🎎', r: 30, w: 3,   hue: 340 },
      { e: '🎋', r: 36, w: 3,   hue: 120, up: true },
      { e: '🌳', r: 44, w: 2,   hue: 340, up: true },
      { e: '⛩️', r: 54, w: 1,   hue: 0,   up: true },
      { e: '🏯', r: 60, w: 0.7, hue: 340, up: true },
    ],
  },
  {
    key: 'musichall', name: 'Music Hall',
    ground: '#7d3c4a', groundAlt: '#703440', decals: ['🎵', '🎶', '✨'],
    items: [
      { e: '🎵', r: 7,  w: 10,  hue: 0 },
      { e: '🎶', r: 9,  w: 9,   hue: 0 },
      { e: '🎼', r: 11, w: 8,   hue: 0 },
      { e: '🎤', r: 14, w: 7,   hue: 0 },
      { e: '🥁', r: 16, w: 7,   hue: 25 },
      { e: '🎧', r: 18, w: 6,   hue: 340 },
      { e: '📻', r: 22, w: 5,   hue: 25 },
      { e: '🎷', r: 26, w: 5,   hue: 45 },
      { e: '🎺', r: 30, w: 4,   hue: 45 },
      { e: '🎸', r: 34, w: 3,   hue: 25 },
      { e: '🎻', r: 40, w: 2.5, hue: 25 },
      { e: '🪗', r: 46, w: 2,   hue: 350 },
      { e: '🎹', r: 54, w: 1.2, hue: 0 },
      { e: '🎭', r: 60, w: 0.7, hue: 340, up: true },
    ],
  },
  {
    key: 'farm', name: 'Farm Country',
    ground: '#d4b370', groundAlt: '#c9a765', decals: ['🌾', '🌱', '🍂'],
    items: [
      { e: '🥚', r: 7,  w: 10,  hue: 40 },
      { e: '🐣', r: 9,  w: 9,   hue: 48 },
      { e: '🌾', r: 11, w: 8,   hue: 45 },
      { e: '🌽', r: 14, w: 8,   hue: 55 },
      { e: '🐔', r: 16, w: 7,   hue: 0 },
      { e: '🦆', r: 18, w: 6,   hue: 30 },
      { e: '🌻', r: 22, w: 5,   hue: 48 },
      { e: '🐑', r: 26, w: 5,   hue: 0 },
      { e: '🐖', r: 30, w: 4,   hue: 340 },
      { e: '🐄', r: 36, w: 3,   hue: 30 },
      { e: '🐴', r: 42, w: 2.5, hue: 25 },
      { e: '🚜', r: 48, w: 2,   hue: 25 },
      { e: '🛖', r: 60, w: 1,   hue: 25,  up: true },
    ],
  },
  {
    key: 'jungle', name: 'Jungle Ruins',
    ground: '#4a7845', groundAlt: '#416b3d', decals: ['🍃', '🌿', '🦋'],
    items: [
      { e: '🦋', r: 7,  w: 10,  hue: 280 },
      { e: '🐛', r: 9,  w: 9,   hue: 100 },
      { e: '🐜', r: 11, w: 8,   hue: 25 },
      { e: '🐸', r: 13, w: 8,   hue: 100 },
      { e: '🦎', r: 15, w: 7,   hue: 100 },
      { e: '🦜', r: 18, w: 6,   hue: 0 },
      { e: '🐍', r: 22, w: 5,   hue: 100 },
      { e: '🐊', r: 26, w: 5,   hue: 100 },
      { e: '🐆', r: 32, w: 4,   hue: 40 },
      { e: '🐅', r: 38, w: 3,   hue: 25 },
      { e: '🌴', r: 46, w: 2,   hue: 100, up: true },
      { e: '🛕', r: 54, w: 1.5, hue: 30,  up: true },
      { e: '🗿', r: 60, w: 0.8, hue: 0,   up: true },
    ],
  },
  {
    key: 'desert', name: 'Desert Bazaar',
    ground: '#d9b380', groundAlt: '#cea675', decals: ['🌵', '🪨', '🌰'],
    items: [
      { e: '🌰', r: 7,  w: 10,  hue: 25 },
      { e: '🪱', r: 9,  w: 9,   hue: 15 },
      { e: '🦂', r: 11, w: 8,   hue: 25 },
      { e: '🦎', r: 13, w: 7,   hue: 25 },
      { e: '🐍', r: 16, w: 6,   hue: 25 },
      { e: '🏺', r: 20, w: 6,   hue: 15 },
      { e: '🐪', r: 24, w: 5,   hue: 25 },
      { e: '🌵', r: 28, w: 5,   hue: 100, up: true },
      { e: '⛺', r: 34, w: 4,   hue: 25,  up: true },
      { e: '🐫', r: 40, w: 3,   hue: 25 },
      { e: '🛖', r: 46, w: 2,   hue: 25,  up: true },
      { e: '⛲', r: 52, w: 1.5, hue: 200, up: true },
      { e: '🕌', r: 60, w: 1,   hue: 30,  up: true },
    ],
  },
  {
    key: 'factory', name: 'Robot Factory',
    ground: '#7a8590', groundAlt: '#6f7a86', decals: ['⚙️', '🔩', '⚡'],
    items: [
      { e: '🔩', r: 7,  w: 10,  hue: 210 },
      { e: '⚙️', r: 9,  w: 9,   hue: 210 },
      { e: '🔋', r: 11, w: 8,   hue: 100 },
      { e: '💡', r: 13, w: 7,   hue: 48 },
      { e: '🧲', r: 15, w: 7,   hue: 0 },
      { e: '🔧', r: 18, w: 6,   hue: 210 },
      { e: '🛠️', r: 22, w: 5,   hue: 25 },
      { e: '📦', r: 26, w: 5,   hue: 25 },
      { e: '🦾', r: 30, w: 4,   hue: 210 },
      { e: '🤖', r: 34, w: 3,   hue: 210, up: true },
      { e: '🛰️', r: 40, w: 2.5, hue: 210 },
      { e: '🏗️', r: 48, w: 2,   hue: 45,  up: true },
      { e: '🏭', r: 60, w: 1,   hue: 210, up: true },
    ],
  },
];

// Back-compat alias: prior code and tests spoke of BIOMES.
export const BIOMES = THEMES;

// Bands are GEOMETRIC: cycle k's bands are each CYCLE_SIZE_MULT^k wider than
// cycle 0's, so the world is self-similar — at any scale, a band takes about
// as long to cross and the camera frames it the same way (the fractal
// invariant). Walked iteratively: exact, and cycle counts stay tiny.
export function bandIndex(dist) {
  const N = CONFIG.BANDS_PER_CYCLE;
  const M = CONFIG.CYCLE_SIZE_MULT;
  let start = 0;
  let width = CONFIG.BAND_WIDTH;
  let band = 0;
  while (dist >= start + N * width) {
    start += N * width;
    width *= M;
    band += N;
  }
  return band + Math.floor(Math.max(0, dist - start) / width);
}

// { start, width } of a band in world distance.
export function bandRange(band) {
  const N = CONFIG.BANDS_PER_CYCLE;
  const M = CONFIG.CYCLE_SIZE_MULT;
  const k = Math.floor(band / N);
  let start = 0;
  let width = CONFIG.BAND_WIDTH;
  for (let i = 0; i < k; i++) {
    start += N * width;
    width *= M;
  }
  return { start: start + (band - N * k) * width, width };
}

// --- Patchwork theme cells ---------------------------------------------
// Themes tile the world as roughly-square angular sectors within each band
// annulus, NOT as concentric rings — otherwise players notice the layered
// organization. Radial distance still decides SIZE (via sizeMultForBand);
// angle+distance together decide THEME. Band 0 is hard-coded to Berry
// Meadow so the spawn area and the world's starter guarantee stay stable.
// The mapping is deterministic and seed-independent — the ground painter
// must be able to compute it without any world seed in hand.

// xmur3-style 32-bit hash of `${band}:${sector}`. Same mixer/finalizer as
// rng.js but with a fixed prefix seed — the mapping must NOT depend on
// world.seed.
function cellHash(band, sector) {
  const str = `${band}:${sector}`;
  let h = 2246822519 ^ str.length; // fixed nothing-up-my-sleeve seed
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// How many angular sectors this band's annulus is split into. Chosen so
// each cell's arc-length ~= the band's radial width — cells are roughly
// square. Band 0 collapses to a single sector so the spawn area is one
// contiguous meadow.
export function sectorCount(band) {
  if (band <= 0) return 1;
  const { start, width } = bandRange(band);
  return Math.max(1, Math.round((2 * Math.PI * (start + width / 2)) / width));
}

// Sector index for an angle (radians) at a given band. Wraps modulo the
// sector count. Angle 0 is the +x axis, growing counter-clockwise, so a
// straight ray outward may cross sector boundaries as it moves through
// increasingly-fine annuli — which is what makes the world a patchwork
// instead of a set of pie wedges.
export function sectorForAngle(band, angle) {
  const n = sectorCount(band);
  if (n <= 1) return 0;
  let a = angle / (2 * Math.PI); // −0.5 .. 0.5 (atan2 range)
  a -= Math.floor(a);            // 0 .. 1
  return Math.floor(a * n) % n;
}

// Theme lookup by cell coordinates. Band 0 → meadow (spawn is home).
// Otherwise pick via cellHash mod THEMES.length. Sector is normalized so
// callers don't have to mod it themselves.
export function themeFor(band, sector) {
  if (band <= 0) return THEMES[0];
  const n = sectorCount(band);
  const s = ((sector % n) + n) % n;
  return THEMES[cellHash(band, s) % THEMES.length];
}

// Primary theme-lookup API for anything that has a world position — used
// by world.js during chunk generation and by ground.js during painting.
export function themeAt(x, y) {
  const dist = Math.hypot(x, y);
  const band = bandIndex(dist);
  if (band === 0) return THEMES[0];
  return themeFor(band, sectorForAngle(band, Math.atan2(y, x)));
}

// Band-only fallback for display code that only has a band (e.g. the HUD
// biome toast) — returns a stable sector-0 theme so the toast doesn't
// flicker as the hole moves inside one band's annulus. TODO: main.js
// should ideally key hud.setBand on (band, sector) so the toast follows
// the actual cell you're crossing into; leaving that to whoever wires HUD.
export function biomeForBand(band) {
  return themeFor(band, 0);
}

export function cycleForBand(band) {
  return Math.floor(band / CONFIG.BANDS_PER_CYCLE);
}

// Slot within the current cycle (0..BANDS_PER_CYCLE-1). The slot decides
// how big this band's items should be regardless of which theme sits here.
export function slotForBand(band) {
  const N = CONFIG.BANDS_PER_CYCLE;
  return ((band % N) + N) % N;
}

// Total size multiplier applied to placed items: cycle-scale × slot-scale.
// Themes carry canonical base radii (~7..60); the ladder inside a cycle is
// SLOT_MULTS, and every full cycle rescales by CYCLE_SIZE_MULT on top.
export function sizeMultForBand(band) {
  const cycleMult = Math.pow(CONFIG.CYCLE_SIZE_MULT, cycleForBand(band));
  return cycleMult * SLOT_MULTS[slotForBand(band)];
}

// Points scale with placed (post-multiplier) area — scale-free across cycles.
// Returns BigInt: the fractal world can produce scores well past 2^53, so the
// authoritative point value has to be exact-integer at any magnitude. The
// double-precision area math before conversion is fine — magnitude is what
// matters, not the last few digits of an already-huge number.
export function pointsFor(placedRadius) {
  return BigInt(Math.max(1, Math.round((placedRadius * placedRadius) / CONFIG.POINTS_DIV)));
}

const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

// Display name for a specific theme at a band's scale tier — the suffix marks
// the cycle ("Winter Wonderland II" = the x6-scale ring), not repeat visits.
export function themeDisplayName(theme, band) {
  const cycle = cycleForBand(band);
  const suffix = ROMAN[cycle] ?? ` ${cycle + 1}`;
  return theme.name + suffix;
}

export function biomeDisplayName(band) {
  return themeDisplayName(biomeForBand(band), band);
}
