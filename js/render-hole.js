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
  // HOLE-LOCAL px coordinates: translate to the hole's world center, then
  // scale by 1/zoom so one local unit is one CSS px (y stays ISO-squashed
  // by the ground-pass transform). Deep-cycle holes have world radii in
  // the millions at zooms near 1e-5; feeding those through the CTM as raw
  // path geometry hits the rasterizer's float32 curve flattening and the
  // rim + progress meter render as visible facets and wobble (owner-
  // reported at 16T+). The big numbers must live ONLY in the matrix; all
  // path radii below are screen-sized.
  const rs = hole.r * zoom;
  ctx.save();
  ctx.translate(hole.x, hole.y);
  ctx.scale(1 / zoom, 1 / zoom);

  // Soft ambient-occlusion halo so the pit sits "into" the ground.
  const halo = ctx.createRadialGradient(0, 0, rs * 0.85, 0, 0, rs * 1.35);
  halo.addColorStop(0, 'rgba(18, 8, 34, 0.32)');
  halo.addColorStop(1, 'rgba(18, 8, 34, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, rs * 1.35, 0, Math.PI * 2);
  ctx.fill();

  // The pit.
  const pit = ctx.createRadialGradient(0, -rs * 0.12, rs * 0.1, 0, 0, rs);
  pit.addColorStop(0, '#050310');
  pit.addColorStop(0.75, '#150a2b');
  pit.addColorStop(1, '#241243');
  ctx.fillStyle = pit;
  ctx.beginPath();
  ctx.arc(0, 0, rs, 0, Math.PI * 2);
  ctx.fill();

  // Anything mid-fall renders clipped inside the pit (positions/radii
  // converted to hole-local px; the emoji raster bucket wants the true
  // device scale, which is screenScale with the zoom factored back out).
  if (sw.falling.length) {
    const dprScale = screenScale / zoom;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rs * 0.99, 0, Math.PI * 2);
    ctx.clip();
    for (const f of sw.falling) {
      const v = fallingVisual(f, hole);
      ctx.globalAlpha = 0.55 + 0.45 * v.scale;
      drawEmoji(ctx, v.obj.e, (v.x - hole.x) * zoom, (v.y - hole.y) * zoom,
        v.obj.r * v.scale * zoom, v.rot, dprScale);
    }
    ctx.globalAlpha = 1;
    // Depth shading over the falling items, toward the pit edge.
    const depth = ctx.createRadialGradient(0, 0, rs * 0.5, 0, 0, rs);
    depth.addColorStop(0, 'rgba(5, 3, 16, 0)');
    depth.addColorStop(1, 'rgba(5, 3, 16, 0.6)');
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.arc(0, 0, rs, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Slow-rotating shimmer inside the rim — keeps the hole feeling alive.
  ctx.save();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.22)';
  ctx.lineWidth = Math.max(1.5, rs * 0.05);
  ctx.setLineDash([rs * 0.4, rs * 0.55]);
  ctx.lineDashOffset = -time * rs * 0.35;
  ctx.beginPath();
  ctx.arc(0, 0, rs * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Rim: dark lip then a bright ring.
  const lw = Math.max(2.5, rs * 0.055);
  ctx.strokeStyle = 'rgba(12, 6, 24, 0.85)';
  ctx.lineWidth = lw * 0.9;
  ctx.beginPath();
  ctx.arc(0, 0, rs - lw * 0.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 248, 236, 0.95)';
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(0, 0, rs + lw * 0.55, 0, Math.PI * 2);
  ctx.stroke();

  // Level-progress meter around the mouth: fills clockwise from 12 o'clock
  // as the hole approaches its next size milestone. Drawn in the ground pass
  // so it hugs the rim ellipse like everything else. Widths are CSS px;
  // never thinner than ~4.5 px so a just-leveled hole still shows a
  // readable (mostly empty) meter.
  const progress = holeProgress(hole);
  const meterW = Math.max(lw * 1.1, rs * 0.075, 4.5);
  const meterR = rs + lw * 1.2 + meterW * 1.4;
  ctx.strokeStyle = 'rgba(20, 10, 32, 0.3)';
  ctx.lineWidth = meterW * 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, meterR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = meterW;
  ctx.beginPath();
  ctx.arc(0, 0, meterR, 0, Math.PI * 2);
  ctx.stroke();
  if (progress > 0.005) {
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = meterW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, meterR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  ctx.restore();
}
