// Visual effects: suck-in particle bursts, confetti, score floaters,
// expanding rings. Pools of plain objects; update is pure, draw needs ctx.

export function createFx() {
  return { parts: [], floats: [], rings: [] };
}

// Global particle budget — combo frenzies drop the oldest dots instead of
// walling the screen.
const MAX_PARTS = 280;
function trimParts(fx) {
  if (fx.parts.length > MAX_PARTS) fx.parts.splice(0, fx.parts.length - MAX_PARTS);
}

// Swallow burst: dots spawn on a ring and spiral INTO the center — reads as
// the hole slurping. (cx, cy) world center, r spawn radius, hue from the item.
export function suckBurst(fx, rand, cx, cy, r, hue, n) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = r * (0.7 + rand() * 0.5);
    const speed = r * (2.2 + rand() * 1.6);
    fx.parts.push({
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d,
      vx: -Math.cos(a + 0.6) * speed,
      vy: -Math.sin(a + 0.6) * speed,
      size: r * (0.10 + rand() * 0.10),
      hue: hue + (rand() * 24 - 12),
      light: 55 + rand() * 15,
      t: 0,
      life: 0.35 + rand() * 0.25,
      drag: 0.5,
    });
  }
  trimParts(fx);
}

// Level-up confetti: multicolor dots exploding outward.
export function confetti(fx, rand, cx, cy, r, n) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const speed = r * (3 + rand() * 5);
    fx.parts.push({
      x: cx, y: cy,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      size: r * (0.06 + rand() * 0.08),
      hue: rand() * 360,
      light: 60,
      t: 0,
      life: 0.7 + rand() * 0.5,
      drag: 2.2,
    });
  }
  trimParts(fx);
}

export function floatText(fx, x, y, text, { size = 20, hue = 0, sat = 0, up = 60 } = {}) {
  fx.floats.push({ x, y, text, size, hue, sat, up, t: 0, life: 0.9 });
}

export function ringPulse(fx, x, y, r0, r1, hue, width = 4) {
  fx.rings.push({ x, y, r0, r1, hue, width, t: 0, life: 0.55 });
}

export function updateFx(fx, dt) {
  for (let i = fx.parts.length - 1; i >= 0; i--) {
    const p = fx.parts[i];
    p.t += dt;
    if (p.t >= p.life) { fx.parts.splice(i, 1); continue; }
    const drag = Math.max(0, 1 - p.drag * dt);
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (let i = fx.floats.length - 1; i >= 0; i--) {
    const f = fx.floats[i];
    f.t += dt;
    if (f.t >= f.life) fx.floats.splice(i, 1);
  }
  for (let i = fx.rings.length - 1; i >= 0; i--) {
    const g = fx.rings[i];
    g.t += dt;
    if (g.t >= g.life) fx.rings.splice(i, 1);
  }
}

// Parts + rings live on the ground plane: draw under the renderer's squashed
// transform so arcs become ellipses for free.
export function drawFxWorld(ctx, fx) {
  for (const p of fx.parts) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = k;
    ctx.fillStyle = `hsl(${p.hue} 75% ${p.light}%)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(p.size * k, 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const g of fx.rings) {
    const k = g.t / g.life;
    const r = g.r0 + (g.r1 - g.r0) * (1 - Math.pow(1 - k, 2.2));
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.strokeStyle = `hsl(${g.hue} 80% 70%)`;
    ctx.lineWidth = g.width * (1 - k * 0.6);
    ctx.beginPath();
    ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Score floaters render UPRIGHT in the billboard pass — the renderer resets
// the transform to CSS-pixel space and we map each float manually via `t`.
// Text stays readable no matter how zoomed out the world is.
export function drawFxText(ctx, fx, t) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of fx.floats) {
    const k = f.t / f.life;
    const sx = f.x * t.scale + t.tx;
    const sy = f.y * t.scaleY + t.ty;
    const rise = f.up * (1 - Math.pow(1 - k, 2)) * t.scaleY;
    // Never smaller than ~15 CSS px, whatever the zoom.
    const px = Math.max(f.size * t.scale, 15);
    ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
    ctx.font = `800 ${px}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.lineWidth = px * 0.1;
    ctx.strokeStyle = 'rgba(30, 20, 40, 0.4)';
    ctx.strokeText(f.text, sx, sy - rise);
    ctx.fillStyle = f.sat > 0 ? `hsl(${f.hue} ${f.sat}% 72%)` : '#fff';
    ctx.fillText(f.text, sx, sy - rise);
  }
  ctx.globalAlpha = 1;
}
