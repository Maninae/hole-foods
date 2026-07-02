// Emoji -> offscreen-canvas raster cache, bucketed by pixel size so glyphs
// stay crisp at any zoom without re-rasterizing every frame. DOM module.

const BUCKETS = [16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024];
const PAD = 1.3; // canvas side = fontPx * PAD, so glyph edges never clip
const FONT_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const cache = new Map();

function rasterize(emoji, fontPx) {
  const side = Math.ceil(fontPx * PAD);
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d');
  ctx.font = `${fontPx}px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, side / 2, side / 2 + fontPx * 0.04);
  return c;
}

function spriteFor(emoji, neededPx) {
  const bucket = BUCKETS.find((b) => b >= neededPx) ?? BUCKETS[BUCKETS.length - 1];
  const key = `${emoji}@${bucket}`;
  let c = cache.get(key);
  if (!c) {
    c = rasterize(emoji, bucket);
    cache.set(key, c);
  }
  return c;
}

// Draw an emoji centered at (x, y) in the CURRENT ctx transform (world
// space), spanning roughly `2 * r` world units. `screenScale` = zoom * dpr,
// used only to pick a crisp raster bucket.
export function drawEmoji(ctx, emoji, x, y, r, rot, screenScale) {
  const worldSpan = r * 2.15;               // em-box world size for visual diameter ~2r
  // Beyond the raster cap, draw the glyph directly — stays crisp at any size
  // and only a handful of such giants are ever on screen.
  if (worldSpan * screenScale > 1024) {
    ctx.font = `${Math.round(worldSpan)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillText(emoji, 0, worldSpan * 0.04);
      ctx.restore();
    } else {
      ctx.fillText(emoji, x, y + worldSpan * 0.04);
    }
    return;
  }
  const sprite = spriteFor(emoji, worldSpan * screenScale);
  const dw = worldSpan * PAD;
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite, -dw / 2, -dw / 2, dw, dw);
    ctx.restore();
  } else {
    ctx.drawImage(sprite, x - dw / 2, y - dw / 2, dw, dw);
  }
}
