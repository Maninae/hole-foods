// Ground-pass hole drawing. The pit + rim + progress meter that lives
// beneath the sprite billboards; drawn in the ISO-squashed ground-plane
// transform so its arcs come out as ellipses for free. Pure draw code.
//
// The always-on screen-space overlay that survives sprite occlusion is
// a different function — see drawHoleOverlay in js/render-overlay.js.

import { drawEmoji } from './sprites.js';
import { fallingVisual } from './swallow.js';
import { holeProgress } from './hole.js';

export function drawHole(ctx, hole, sw, time, screenScale, zoom) {
  const { x, y, r } = hole;

  // Soft ambient-occlusion halo so the pit sits "into" the ground.
  const halo = ctx.createRadialGradient(x, y, r * 0.85, x, y, r * 1.35);
  halo.addColorStop(0, 'rgba(18, 8, 34, 0.32)');
  halo.addColorStop(1, 'rgba(18, 8, 34, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();

  // The pit.
  const pit = ctx.createRadialGradient(x, y - r * 0.12, r * 0.1, x, y, r);
  pit.addColorStop(0, '#050310');
  pit.addColorStop(0.75, '#150a2b');
  pit.addColorStop(1, '#241243');
  ctx.fillStyle = pit;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // Anything mid-fall renders clipped inside the pit.
  if (sw.falling.length) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.99, 0, Math.PI * 2);
    ctx.clip();
    for (const f of sw.falling) {
      const v = fallingVisual(f, hole);
      ctx.globalAlpha = 0.55 + 0.45 * v.scale;
      drawEmoji(ctx, v.obj.e, v.x, v.y, v.obj.r * v.scale, v.rot, screenScale);
    }
    ctx.globalAlpha = 1;
    // Depth shading over the falling items, toward the pit edge.
    const depth = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
    depth.addColorStop(0, 'rgba(5, 3, 16, 0)');
    depth.addColorStop(1, 'rgba(5, 3, 16, 0.6)');
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Slow-rotating shimmer inside the rim — keeps the hole feeling alive.
  ctx.save();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
  ctx.lineWidth = Math.max(1.5, r * 0.05);
  ctx.setLineDash([r * 0.4, r * 0.55]);
  ctx.lineDashOffset = -time * r * 0.35;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rim: dark lip then a bright ring.
  const lw = Math.max(2.5, r * 0.055);
  ctx.strokeStyle = 'rgba(12, 6, 24, 0.85)';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.arc(x, y, r - lw * 0.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 248, 236, 0.95)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(x, y, r + lw * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  // Level-progress meter around the mouth: fills clockwise from 12 o'clock
  // as the hole approaches its next size milestone. Drawn in the ground pass
  // so it hugs the rim ellipse like everything else. Width scales with the
  // hole so it stays ~4-6 screen px at any zoom (like the rim itself).
  const progress = holeProgress(hole);
  // Never thinner than ~4.5 CSS px, whatever the zoom — a just-leveled hole
  // must still show a readable (mostly empty) meter.
  const meterW = Math.max(lw * 1.1, r * 0.075, 4.5 / zoom);
  const meterR = r + lw * 1.2 + meterW * 1.4;
  ctx.strokeStyle = 'rgba(20, 10, 32, 0.3)';
  ctx.lineWidth = meterW * 1.5;
  ctx.beginPath();
  ctx.arc(x, y, meterR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = meterW;
  ctx.beginPath();
  ctx.arc(x, y, meterR, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.005) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = meterW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y, meterR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
}
