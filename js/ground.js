// Ground painting: themes tile the world as an angular patchwork within
// each band annulus, so the ground color varies with BOTH distance from
// origin AND angle around it. The old single-radial-gradient approach
// (color as a function of distance only) no longer works.
//
// We paint a low-res color buffer over the view rect and let the browser
// bilinear-scale it up: colorRgbAt smoothly blends theme grounds across
// band edges (radially) and sector edges (angularly), and the browser's
// image-smoothing turns the buffer into a seamless continuous field.
// The per-theme dot texture keeps its per-chunk rendering, keyed to each
// chunk's actual theme (which the world.js chunk generator picks via
// themeAt). DOM module.

import { CONFIG } from './config.js';
import {
  THEMES, bandIndex, bandRange, sectorCount, sectorForAngle, themeFor, themeAt,
} from './catalog.js';
import { forEachChunkInRect, chunkSizeAt } from './world.js';

// Fraction of a band's width used to blend into its neighbors — scales
// with the band itself, so transitions look identical at every cycle.
const RAD_BLEND_FRAC = CONFIG.BAND_BLEND / CONFIG.BAND_WIDTH;
// Fraction of a sector's arc used to blend into its angular neighbor.
// 10% keeps the sector body clearly recognizable while smoothing the seam.
const ANG_BLEND_FRAC = 0.10;
// Sample resolution for the color-field buffer. Enough to catch a sector
// boundary (blend zones are ~10% of a sector, which is a handful of pixels
// even at 96 samples across the view), cheap enough to compute per frame.
const BUF_SIDE = 96;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// [r, g, b] tuples for every theme, resolved once at module load.
const RGB = new Map(THEMES.map((t) => [t.key, hexToRgb(t.ground)]));

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// Blended ground RGB at a world position. The blend weight peaks at 0.5
// on a seam (equal share of both sides) and decays to 0 as you move a
// full blend-zone width into a single cell — so far from any boundary,
// colorRgbAt returns the pure cell color and adjacent cells' seams
// interpolate to the SAME midpoint value (C0-continuous, no checkerboard).
function colorRgbAt(x, y) {
  const dist = Math.hypot(x, y);
  const band = bandIndex(dist);
  const { start, width } = bandRange(band);
  const angle = Math.atan2(y, x);
  const sec = sectorForAngle(band, angle);
  let color = RGB.get(themeFor(band, sec).key);

  // Radial blend across band edges — the neighbor cell at the seam is
  // looked up at the SAME angle so both sides agree on which pair to
  // blend (the seam is a circle of constant radius).
  const radBlend = width * RAD_BLEND_FRAC;
  const toNext = start + width - dist;
  if (toNext < radBlend) {
    const nk = themeFor(band + 1, sectorForAngle(band + 1, angle)).key;
    color = mix(color, RGB.get(nk), 0.5 - (toNext / radBlend) * 0.5);
  } else if (band > 0) {
    const toPrev = dist - start;
    if (toPrev < radBlend) {
      const pk = themeFor(band - 1, sectorForAngle(band - 1, angle)).key;
      color = mix(color, RGB.get(pk), 0.5 - (toPrev / radBlend) * 0.5);
    }
  }

  // Angular blend across sector edges — only meaningful when the band
  // has more than one sector (band 0 is one contiguous meadow cell).
  const n = sectorCount(band);
  if (n > 1) {
    let a = angle / (2 * Math.PI);
    a -= Math.floor(a);
    const sf = a * n;
    const frac = sf - Math.floor(sf);
    if (frac < ANG_BLEND_FRAC) {
      const pk = themeFor(band, (sec - 1 + n) % n).key;
      color = mix(color, RGB.get(pk), 0.5 - (frac / ANG_BLEND_FRAC) * 0.5);
    } else if (frac > 1 - ANG_BLEND_FRAC) {
      const nk = themeFor(band, (sec + 1) % n).key;
      color = mix(color, RGB.get(nk), 0.5 - ((1 - frac) / ANG_BLEND_FRAC) * 0.5);
    }
  }

  return color;
}

// Cached scratch buffer for the color field — reallocating a 96×96
// ImageData every frame would be wasteful.
let bufCanvas = null;
let bufCtx = null;
let bufImg = null;

function ensureBuffer() {
  if (bufCanvas && bufCanvas.width === BUF_SIDE) return;
  bufCanvas = document.createElement('canvas');
  bufCanvas.width = BUF_SIDE;
  bufCanvas.height = BUF_SIDE;
  bufCtx = bufCanvas.getContext('2d');
  bufImg = bufCtx.createImageData(BUF_SIDE, BUF_SIDE);
  // Prime alpha to opaque; only RGB varies below.
  for (let i = 3; i < bufImg.data.length; i += 4) bufImg.data[i] = 255;
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

// Paint the visible ground. ctx is already in world transform. Two passes:
// (1) the color field, sampled onto a low-res buffer and bilinear-stretched
// to fill the rect (smooth blends across band + sector edges); (2) a subtle
// per-theme polka-dot texture applied chunk by chunk.
export function drawGround(ctx, world, x0, y0, x1, y1) {
  ensureBuffer();
  const W = x1 - x0;
  const H = y1 - y0;
  const data = bufImg.data;
  let p = 0;
  for (let py = 0; py < BUF_SIDE; py++) {
    const wy = y0 + ((py + 0.5) / BUF_SIDE) * H;
    for (let px = 0; px < BUF_SIDE; px++) {
      const wx = x0 + ((px + 0.5) / BUF_SIDE) * W;
      const c = colorRgbAt(wx, wy);
      data[p++] = c[0] | 0;
      data[p++] = c[1] | 0;
      data[p++] = c[2] | 0;
      p++; // alpha already primed to 255 in ensureBuffer
    }
  }
  bufCtx.putImageData(bufImg, 0, 0);
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bufCanvas, x0, y0, W, H);
  ctx.imageSmoothingEnabled = prevSmooth;

  // Subtle per-theme dot texture, chunk by chunk. Each chunk asks for the
  // theme at its own center so the pattern matches the ground it sits on
  // (seams between adjacent chunks are invisible at 4% ink density).
  forEachChunkInRect(world, x0, y0, x1, y1, (chunk) => {
    const C = chunkSizeAt(chunk.level);
    const cx0 = chunk.cx * C;
    const cy0 = chunk.cy * C;
    if (cx0 > x1 || cy0 > y1 || cx0 + C < x0 || cy0 + C < y0) return;
    const theme = themeAt(cx0 + C / 2, cy0 + C / 2);
    const tile = tileFor(theme.key, chunk.level);
    if (!tile.pattern) {
      tile.pattern = ctx.createPattern(tile.canvas, 'repeat');
      // 64px tile spans 130 world units at level 0; scales with the level.
      tile.pattern.setTransform(new DOMMatrix().scale((130 / 64) * (C / CONFIG.CHUNK)));
    }
    ctx.fillStyle = tile.pattern;
    ctx.fillRect(cx0, cy0, C, C);
  });
}
