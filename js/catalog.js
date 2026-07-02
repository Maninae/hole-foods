// Biome + object catalog: what the world is made of.
// Radii are base sizes for cycle 0; sizeMultForBand compounds per full biome cycle.
// `up: true` = never rotate (buildings, trees, rides). Pure module: no DOM.

import { CONFIG } from './config.js';

export const BIOMES = [
  {
    key: 'meadow', name: 'Berry Meadow',
    ground: '#9fd483', groundAlt: '#93c977', decals: ['🌼', '🌿', '🦋'],
    items: [
      { e: '🫐', r: 7, w: 10, hue: 230 },
      { e: '🍇', r: 9, w: 9, hue: 280 },
      { e: '🍓', r: 10, w: 9, hue: 350 },
      { e: '🍒', r: 11, w: 8, hue: 345 },
      { e: '🍋', r: 13, w: 7, hue: 55 },
      { e: '🥝', r: 14, w: 7, hue: 90 },
      { e: '🍎', r: 15, w: 6, hue: 355 },
      { e: '🍊', r: 15, w: 6, hue: 30 },
      { e: '🍐', r: 16, w: 5, hue: 80 },
      { e: '🍌', r: 17, w: 5, hue: 50 },
      { e: '🍍', r: 26, w: 3, hue: 45 },
      { e: '🍉', r: 34, w: 2, hue: 140 },
      { e: '🧺', r: 42, w: 1.2, hue: 35 },
      { e: '⛱️', r: 54, w: 0.7, hue: 190, up: true },
    ],
  },
  {
    key: 'orchard', name: 'Orchard Grove',
    ground: '#6fb35f', groundAlt: '#66a857', decals: ['🍂', '🌱', '🍄'],
    items: [
      { e: '🌰', r: 12, w: 10, hue: 25 },
      { e: '🌷', r: 14, w: 8, hue: 330 },
      { e: '🍑', r: 15, w: 8, hue: 20 },
      { e: '🍏', r: 16, w: 7, hue: 100 },
      { e: '🍄', r: 18, w: 7, hue: 5 },
      { e: '🥥', r: 20, w: 5, hue: 30 },
      { e: '🌻', r: 22, w: 5, hue: 48 },
      { e: '🎃', r: 32, w: 3, hue: 28 },
      { e: '🪵', r: 38, w: 2, hue: 30 },
      { e: '🌳', r: 58, w: 1.5, hue: 120, up: true },
      { e: '🌲', r: 66, w: 1.2, hue: 150, up: true },
      { e: '🛖', r: 90, w: 0.5, hue: 30, up: true },
    ],
  },
  {
    key: 'bakery', name: 'Sugar Bakery',
    ground: '#f4cdbd', groundAlt: '#efc2b0', decals: ['✨', '🫧'],
    items: [
      { e: '🍬', r: 12, w: 10, hue: 320 },
      { e: '🍪', r: 15, w: 9, hue: 35 },
      { e: '🍭', r: 17, w: 8, hue: 300 },
      { e: '🍫', r: 19, w: 7, hue: 25 },
      { e: '🥨', r: 21, w: 6, hue: 35 },
      { e: '🧁', r: 22, w: 6, hue: 330 },
      { e: '🥐', r: 23, w: 6, hue: 40 },
      { e: '🍩', r: 24, w: 6, hue: 315 },
      { e: '☕', r: 26, w: 4, hue: 25 },
      { e: '🍰', r: 30, w: 4, hue: 345 },
      { e: '🥞', r: 32, w: 3, hue: 42 },
      { e: '🥧', r: 36, w: 3, hue: 35 },
      { e: '🎂', r: 52, w: 1.5, hue: 335 },
      { e: '🚚', r: 85, w: 0.5, hue: 210, up: true },
    ],
  },
  {
    key: 'toybox', name: 'Toybox Town',
    ground: '#c9b4ea', groundAlt: '#bfa8e3', decals: ['⭐', '🎵'],
    items: [
      { e: '🎲', r: 16, w: 9, hue: 0 },
      { e: '🪀', r: 18, w: 8, hue: 350 },
      { e: '⚽', r: 20, w: 8, hue: 0 },
      { e: '🏀', r: 22, w: 7, hue: 20 },
      { e: '🎈', r: 24, w: 7, hue: 355 },
      { e: '🪁', r: 26, w: 6, hue: 200 },
      { e: '🎁', r: 30, w: 5, hue: 340 },
      { e: '🧸', r: 34, w: 5, hue: 30 },
      { e: '🛴', r: 40, w: 3, hue: 200 },
      { e: '🚲', r: 46, w: 2.5, hue: 140 },
      { e: '🛝', r: 70, w: 1.2, hue: 45, up: true },
      { e: '🎠', r: 95, w: 0.7, hue: 330, up: true },
      { e: '🎪', r: 120, w: 0.5, hue: 0, up: true },
    ],
  },
  {
    key: 'funfair', name: 'Funfair Boardwalk',
    ground: '#8fd0c6', groundAlt: '#83c6bb', decals: ['🎊', '✨'],
    items: [
      { e: '🍦', r: 20, w: 9, hue: 40 },
      { e: '🥤', r: 22, w: 8, hue: 355 },
      { e: '🍟', r: 24, w: 8, hue: 48 },
      { e: '🌭', r: 26, w: 7, hue: 30 },
      { e: '🍔', r: 28, w: 6, hue: 35 },
      { e: '🍕', r: 32, w: 5, hue: 30 },
      { e: '🪑', r: 36, w: 4, hue: 30 },
      { e: '🎳', r: 44, w: 3, hue: 210 },
      { e: '🛶', r: 60, w: 2, hue: 25 },
      { e: '⛲', r: 95, w: 1, hue: 200, up: true },
      { e: '🎢', r: 150, w: 0.6, hue: 210, up: true },
      { e: '🎡', r: 190, w: 0.5, hue: 340, up: true },
    ],
  },
  {
    key: 'downtown', name: 'Downtown',
    ground: '#b9c0cc', groundAlt: '#aeb6c4', decals: ['🐦', '🍂'],
    items: [
      { e: '🛵', r: 45, w: 8, hue: 355 },
      { e: '🚏', r: 55, w: 6, hue: 210, up: true },
      { e: '🚗', r: 65, w: 7, hue: 0 },
      { e: '🚕', r: 65, w: 6, hue: 48 },
      { e: '🚙', r: 70, w: 6, hue: 210 },
      { e: '🌳', r: 80, w: 5, hue: 120, up: true },
      { e: '⛲', r: 90, w: 3, hue: 200, up: true },
      { e: '🚚', r: 105, w: 3, hue: 25 },
      { e: '🚌', r: 110, w: 3, hue: 45 },
      { e: '🏠', r: 150, w: 2, hue: 25, up: true },
      { e: '🏡', r: 160, w: 1.5, hue: 100, up: true },
      { e: '⛪', r: 190, w: 0.8, hue: 220, up: true },
      { e: '🏢', r: 230, w: 0.7, hue: 215, up: true },
      { e: '🏬', r: 260, w: 0.5, hue: 200, up: true },
    ],
  },
];

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

export function biomeForBand(band) {
  return BIOMES[((band % CONFIG.BANDS_PER_CYCLE) + CONFIG.BANDS_PER_CYCLE) % CONFIG.BANDS_PER_CYCLE];
}

export function cycleForBand(band) {
  return Math.floor(band / CONFIG.BANDS_PER_CYCLE);
}

export function sizeMultForBand(band) {
  return Math.pow(CONFIG.CYCLE_SIZE_MULT, cycleForBand(band));
}

// Points scale with placed (post-multiplier) area — scale-free across cycles.
export function pointsFor(placedRadius) {
  return Math.max(1, Math.round((placedRadius * placedRadius) / CONFIG.POINTS_DIV));
}

// Roman-numeral suffix for cycled biome names: "Berry Meadow II".
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
export function biomeDisplayName(band) {
  const cycle = cycleForBand(band);
  const suffix = ROMAN[cycle] ?? ` ${cycle + 1}`;
  return biomeForBand(band).name + suffix;
}
