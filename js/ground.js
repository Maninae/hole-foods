// Ground painting: per-chunk theme colors blended smoothly across band
// boundaries, plus a subtle per-theme dot-pattern tile. DOM module.

import { CONFIG } from './config.js';
import { THEMES, bandIndex, bandRange, biomeForBand } from './catalog.js';
import { forEachChunkInRect, chunkSizeAt } from './world.js';

// Fraction of a band's width used to blend into its neighbors — scales with
// the band itself, so transitions look identical at every cycle.
const BLEND_FRAC = CONFIG.BAND_BLEND / CONFIG.BAND_WIDTH;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

// One RGB entry per theme in the pool — the rotation may land on any of
// them at any band, so all must be resolvable.
const RGB = new Map(THEMES.map((t) => [t.key, hexToRgb(t.ground)]));

// Blended ground color at a world distance from origin.
export function groundColorAt(dist) {
  const band = bandIndex(dist);
  const { start, width } = bandRange(band);
  const cur = RGB.get(biomeForBand(band).key);
  const blend = width * BLEND_FRAC;
  const into = start + width - dist; // distance to the next band's edge
  if (into < blend) {
    const next = RGB.get(biomeForBand(band + 1).key);
    return mix(cur, next, 0.5 - (into / blend) * 0.5);
  }
  const from = dist - start;
  if (band > 0 && from < blend) {
    const prev = RGB.get(biomeForBand(band - 1).key);
    return mix(cur, prev, 0.5 - (from / blend) * 0.5);
  }
  return mix(cur, cur, 0);
}

// One subtle 64px polka-dot tile per (theme, level), tiled in world space —
// the pattern scale follows the chunk level so texture reads at every zoom.
// Cached lazily: any of the 18 themes is a valid key here.
const tiles = new Map();
function tileFor(themeKey, level) {
  const key = `${themeKey}@${level}`;
  let t = tiles.get(key);
  if (t) return t;
  const alt = THEMES.find((th) => th.key === themeKey).groundAlt;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = alt;
  ctx.globalAlpha = 0.5;
  for (const [dx, dy] of [[16, 16], [48, 48]]) {
    ctx.beginPath();
    ctx.arc(dx, dy, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  t = { canvas: c, pattern: null, level };
  tiles.set(key, t);
  return t;
}

// Paint the visible ground. ctx is already in world transform.
// Bands are radial, so a single radial gradient centered on the world origin
// gives perfectly smooth biome transitions — no per-chunk color stepping.
export function drawGround(ctx, world, x0, y0, x1, y1) {
  const nearX = Math.min(Math.max(x0, 0), x1); // rect point nearest the origin
  const nearY = Math.min(Math.max(y0, 0), y1);
  const dMin = Math.hypot(nearX, nearY);
  const dMax = Math.max(
    Math.hypot(x0, y0), Math.hypot(x1, y0),
    Math.hypot(x0, y1), Math.hypot(x1, y1),
  );
  const grad = ctx.createRadialGradient(0, 0, dMin, 0, 0, dMax);
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    grad.addColorStop(i / steps, groundColorAt(dMin + (dMax - dMin) * (i / steps)));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

  // Subtle per-theme dot texture, chunk by chunk (seams invisible at 4% ink).
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    const C = chunkSizeAt(chunk.level);
    const cx0 = chunk.cx * C;
    const cy0 = chunk.cy * C;
    if (cx0 > x1 || cy0 > y1 || cx0 + C < x0 || cy0 + C < y0) return;
    const tile = tileFor(biomeForBand(chunk.band).key, chunk.level);
    if (!tile.pattern) {
      tile.pattern = ctx.createPattern(tile.canvas, 'repeat');
      // 64px tile spans 130 world units at level 0; scales with the level.
      tile.pattern.setTransform(new DOMMatrix().scale((130 / 64) * (C / CONFIG.CHUNK)));
    }
    ctx.fillStyle = tile.pattern;
    ctx.fillRect(cx0, cy0, C, C);
  });
}
