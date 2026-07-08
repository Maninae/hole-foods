// MapleStory-style level-up celebration: expanding glow + ring pulses on
// the ground plane, a tall vertical aura pillar in billboard space, a big
// overshoot "LEVEL UP! N" title, and rising sparkles inside the beam.
// Escalates with level; milestones every 10 add extra ring pulses and a
// brief full-screen flash. The aura COLOR climbs through a Super-Saiyan
// ladder as levels rise (see AURA_TIERS) — same shapes, new palette.

export function createLevelFx() {
  return { active: [] };
}

// Intensity formula: level 1 == 1.0, capped at 3.5 (reached around level 32).
export function intensityForLevel(level) {
  return 1 + Math.min(2.5, Math.max(0, level - 1) * 0.08);
}

// Every 10th level (10, 20, 30, ...) is a milestone.
export function isMilestone(level) {
  return level > 0 && level % 10 === 0;
}

// Aura color ladder — the celebration deepens through phases as the player
// climbs. `core` is the bright inner tone; `glow` is the richer outer
// tone. auraForLevel() LERPs between adjacent tiers so a level midway
// between "rich azure" and "lavender" reads as a smooth graduation, not a
// snap. Above the last tier, aura stays emerald.
export const AURA_TIERS = [
  { from: 1,  core: '#bfe5ff', glow: '#8ecdf7' }, // subtle sky blue
  { from: 6,  core: '#7ec3ff', glow: '#2f7fd6' }, // richer azure
  { from: 12, core: '#d9c4ff', glow: '#a78bfa' }, // lavender
  { from: 20, core: '#b18cff', glow: '#5b2ea6' }, // dark royal purple
  { from: 28, core: '#fff7c2', glow: '#ffe66b' }, // pale super-saiyan yellow
  { from: 36, core: '#ffd166', glow: '#e6a417' }, // rich gold
  { from: 45, core: '#d2f5d8', glow: '#7fe0a0' }, // pale green
  { from: 55, core: '#7de8a8', glow: '#0f9d58' }, // rich emerald
];

function parseHex(h) {
  const s = h.replace('#', '');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}
// Parsed once — AURA_TIERS is authoritative as hex; internals cache RGB.
const _TIER_RGB = AURA_TIERS.map((t) => ({
  from: t.from, core: parseHex(t.core), glow: parseHex(t.glow),
}));

// Returns {core: [r,g,b], glow: [r,g,b]} smoothly interpolated between
// adjacent aura tiers. Clamps to the endpoints outside the ladder range.
export function auraForLevel(level) {
  const first = _TIER_RGB[0];
  const last = _TIER_RGB[_TIER_RGB.length - 1];
  if (level <= first.from) return { core: first.core.slice(), glow: first.glow.slice() };
  if (level >= last.from) return { core: last.core.slice(), glow: last.glow.slice() };
  for (let i = 0; i < _TIER_RGB.length - 1; i++) {
    const a = _TIER_RGB[i];
    const b = _TIER_RGB[i + 1];
    if (level >= a.from && level < b.from) {
      const t = (level - a.from) / (b.from - a.from);
      return { core: lerpRgb(a.core, b.core, t), glow: lerpRgb(a.glow, b.glow, t) };
    }
  }
  // Unreachable given the clamps above.
  return { core: last.core.slice(), glow: last.glow.slice() };
}

function rgba([r, g, b], a) { return `rgba(${r}, ${g}, ${b}, ${a})`; }

const BASE_DURATION = 1.85;

// The celebration rides WITH the hole: x/y/r are live reads of the hole the
// player is steering, so the glow, pillar, and LEVEL UP! text follow the
// character instead of planting on the ground where the level-up happened
// (owner feedback — the ground-anchored version looked left behind).
export function spawnLevelUp(fx, level, hole, opts = {}) {
  const reducedMotion = !!opts.reducedMotion;
  const intensity = intensityForLevel(level);
  const milestone = isMilestone(level);
  const duration = BASE_DURATION + 0.25 * (intensity - 1) + (milestone ? 0.3 : 0);

  const celebration = {
    hole,
    get x() { return this.hole.x; },
    get y() { return this.hole.y; },
    get r() { return this.hole.r; },
    level,
    intensity,
    milestone,
    reducedMotion,
    duration,
    t: 0,
    aura: auraForLevel(level),
    ringSchedule: reducedMotion ? [] : buildRings(level, milestone),
    sparkles: [],
    // In reduced-motion mode we suppress pillar+sparkle+flash entirely.
    nextSparkleAt: reducedMotion ? Infinity : 0.05,
  };

  fx.active.push(celebration);
  return celebration;
}

function buildRings(level, milestone) {
  const rings = [
    { delay: 0.0, life: 0.7 },
    { delay: 0.14, life: 0.7 },
    { delay: 0.3, life: 0.78 },
  ];
  if (milestone) rings.push({ delay: 0.55, life: 0.9 });
  // Level 40+ gets two extra pulses for extra drama.
  if (level >= 40) {
    rings.push({ delay: 0.42, life: 0.75 });
    rings.push({ delay: 0.68, life: 0.85 });
  }
  return rings;
}

export function updateLevelFx(fx, dt) {
  for (let i = fx.active.length - 1; i >= 0; i--) {
    const c = fx.active[i];
    c.t += dt;
    if (c.t >= c.duration) { fx.active.splice(i, 1); continue; }
    if (c.reducedMotion) continue;

    // Spawn sparkles up through the pillar's rise + hold phase.
    const sparkleWindow = c.duration * 0.85;
    while (c.t >= c.nextSparkleAt && c.nextSparkleAt < sparkleWindow) {
      c.sparkles.push({
        // Angle around the beam center (0 = right).
        angle: Math.random() * Math.PI * 2,
        // Horizontal jitter as a fraction of pillar half-width.
        jitter: (Math.random() - 0.5) * 0.7,
        // Where along its own life this sparkle currently sits.
        birth: c.nextSparkleAt,
        life: 0.55 + Math.random() * 0.4,
        size: 0.6 + Math.random() * 0.8,
      });
      // Denser sparkle stream at higher intensity.
      c.nextSparkleAt += 0.05 / c.intensity;
    }
    // Drop expired sparkles.
    for (let j = c.sparkles.length - 1; j >= 0; j--) {
      const s = c.sparkles[j];
      if (c.t - s.birth >= s.life) c.sparkles.splice(j, 1);
    }
  }
}

// --- Drawing ---------------------------------------------------------------
//
// Ground pass runs under the renderer's Y-squashed world transform, so an
// arc drawn here reads as an ellipse flat on the plane. Billboard pass runs
// in CSS-pixel space with a manual world->screen transform.

export function drawLevelFxGround(ctx, fx, tr, w, h) {
  // Size everything in SCREEN space then divide by tr.scale to get the world
  // radius the shape is drawn at. Under the renderer's squashed transform an
  // arc becomes an ellipse for free; drawing in world coords keeps the shape
  // centered on the (world-anchored) celebration position.
  const viewMin = Math.min(w, h);
  for (const c of fx.active) {
    const k = c.t / c.duration;
    const rScreen = c.r * tr.scale;
    const { core, glow } = c.aura;

    // Local-px normalization: draw at the celebration center with one local
    // unit = one CSS px (y stays ISO-squashed). Deep-cycle radii pushed
    // through the CTM as raw path geometry facet under the rasterizer's
    // float32 flattening — same fix as drawHole in render-hole.js.
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(1 / tr.scale, 1 / tr.scale);

    // Expanding aura flash: bounded in screen space so it doesn't paint the
    // entire viewport at deep zoom-out (big holes). Inner tone = core, outer
    // = glow — the palette climbs the Super-Saiyan ladder as levels rise.
    const glowK = Math.max(0, 1 - k * 1.9);
    if (glowK > 0) {
      const flashScreen = Math.min(
        Math.max(rScreen * 3.2, viewMin * 0.14) * (1 + 0.35 * (c.intensity - 1)),
        viewMin * 0.5,
      );
      const rrScreen = flashScreen * (0.28 + 0.72 * Math.pow(1 - glowK, 0.55));
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rrScreen);
      g.addColorStop(0, rgba(core, 0.85 * glowK));
      g.addColorStop(0.28, rgba(glow, 0.55 * glowK));
      g.addColorStop(0.65, rgba(glow, 0.25 * glowK));
      g.addColorStop(1, rgba(glow, 0));
      const prevOp = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rrScreen, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = prevOp;
    }

    // Staggered ring pulses, sized in screen space too.
    const r0Screen = Math.max(rScreen * 1.05, viewMin * 0.03);
    const r1Screen = Math.min(
      Math.max(rScreen * 4.5, viewMin * 0.18) * (1 + 0.35 * (c.intensity - 1)),
      viewMin * 0.45,
    );
    for (const ring of c.ringSchedule) {
      const rt = c.t - ring.delay;
      if (rt < 0 || rt >= ring.life) continue;
      const rk = rt / ring.life;
      const rrScreen = r0Screen + (r1Screen - r0Screen) * (1 - Math.pow(1 - rk, 2.4));
      // Fade from glow -> core as the ring ages (rich edge, bright brink).
      const ringRgb = lerpRgb(glow, core, rk);
      ctx.globalAlpha = (1 - rk) * 0.9;
      ctx.strokeStyle = rgba(ringRgb, 1);
      ctx.lineWidth = Math.max(viewMin * 0.006 * (1 - rk * 0.5), 1.2);
      ctx.beginPath();
      ctx.arc(0, 0, rrScreen, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

export function drawLevelFxBillboard(ctx, fx, tr, w, h) {
  const viewMin = Math.min(w, h);
  for (const c of fx.active) {
    const k = c.t / c.duration;
    const sx = c.x * tr.scale + tr.tx;
    const sy = c.y * tr.scaleY + tr.ty;
    const rScreen = c.r * tr.scale;

    // Milestone full-screen wash: peaks early and fades over ~0.55s. Tinted
    // with the aura's core tone so the wash matches the current tier.
    if (c.milestone && !c.reducedMotion) {
      const peakAt = 0.14;
      const fade = 0.42;
      const flashK = Math.max(0, 1 - Math.abs(c.t - peakAt) / fade);
      if (flashK > 0) {
        ctx.fillStyle = rgba(c.aura.core, 0.34 * flashK);
        ctx.fillRect(0, 0, w, h);
      }
    }

    // Pillar geometry: sized off screen-space so a huge hole doesn't push
    // the pillar out of the viewport. Height caps at 65% of the shorter
    // viewport axis so the top and the title always stay on-screen.
    const heightMax = Math.min(
      Math.max(rScreen * 5, viewMin * 0.30) * (1 + 0.36 * (c.intensity - 1)),
      viewMin * 0.65,
    );
    const wOuter = Math.min(
      Math.max(rScreen * 1.6, viewMin * 0.075) * (0.9 + 0.12 * (c.intensity - 1)),
      viewMin * 0.18,
    );

    if (!c.reducedMotion) {
      drawPillar(ctx, sx, sy, wOuter, heightMax, k, c.aura);
      drawSparkles(ctx, sx, sy, wOuter, heightMax, viewMin, c);
    }
    drawLevelText(ctx, sx, sy, rScreen, heightMax, k, c.intensity, c.level, c.aura, w, h);
  }
  ctx.globalAlpha = 1;
}

function drawPillar(ctx, sx, sy, wOuter, heightMax, k, aura) {
  // Animation phases: rise → hold → dissolve-upward.
  let topY;
  let botY;
  let alpha;
  if (k < 0.18) {
    const p = k / 0.18;
    const ease = 1 - Math.pow(1 - p, 3);
    topY = sy - heightMax * ease;
    botY = sy;
    alpha = ease;
  } else if (k < 0.62) {
    topY = sy - heightMax;
    botY = sy;
    alpha = 1;
  } else {
    const p = (k - 0.62) / 0.38;
    topY = sy - heightMax * (1 + p * 0.25);
    botY = sy - heightMax * p * 0.9;
    alpha = 1 - p;
  }
  if (alpha <= 0) return;

  const prevOp = ctx.globalCompositeOperation;
  const prevFilter = ctx.filter;
  ctx.globalCompositeOperation = 'lighter';

  // Three vertical gradient rectangles at decreasing width and a canvas
  // blur filter for the horizontal fade — cheap and reads as a soft beam
  // without visible seams between concentric layers.
  //   outer wide layer = aura glow (rich edge tone)
  //   middle layer     = aura core (bright inner tone)
  //   center line      = white-hot (unchanged — the beam's spine reads as
  //                      pure light regardless of tier).
  const height = botY - topY;

  ctx.filter = `blur(${wOuter * 0.28}px)`;
  ctx.fillStyle = pillarGradient(ctx, botY, topY, aura.glow, 0.60 * alpha, 0.38 * alpha);
  ctx.fillRect(sx - wOuter * 0.55, topY, wOuter * 1.1, height);

  ctx.filter = `blur(${wOuter * 0.12}px)`;
  ctx.fillStyle = pillarGradient(ctx, botY, topY, aura.core, 0.80 * alpha, 0.55 * alpha);
  ctx.fillRect(sx - wOuter * 0.32, topY, wOuter * 0.64, height);

  ctx.filter = `blur(${Math.max(wOuter * 0.02, 1)}px)`;
  ctx.fillStyle = pillarGradient(ctx, botY, topY, [255, 255, 245], 0.98 * alpha, 0.6 * alpha);
  ctx.fillRect(sx - wOuter * 0.10, topY, wOuter * 0.20, height);

  ctx.filter = prevFilter;
  ctx.globalCompositeOperation = prevOp;
}

function pillarGradient(ctx, botY, topY, rgb, topA, midA) {
  const [r, g, b] = rgb;
  const grad = ctx.createLinearGradient(0, botY, 0, topY);
  grad.addColorStop(0.0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(0.12, `rgba(${r}, ${g}, ${b}, ${topA})`);
  grad.addColorStop(0.85, `rgba(${r}, ${g}, ${b}, ${midA})`);
  grad.addColorStop(1.0, `rgba(${r}, ${g}, ${b}, 0)`);
  return grad;
}

function drawSparkles(ctx, sx, sy, wOuter, heightMax, viewMin, c) {
  const { core, glow } = c.aura;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of c.sparkles) {
    const age = c.t - s.birth;
    const p = age / s.life;
    if (p < 0 || p >= 1) continue;
    const y = sy - heightMax * (1 - Math.pow(1 - p, 1.7)) * 0.95;
    const x = sx + s.jitter * wOuter * 0.4;
    const size = s.size * (viewMin * 0.008 + 3) * (1 - p * 0.4);
    const alpha = Math.min(1, p * 4) * (1 - p);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    // White-hot center, aura core midway, aura glow at the edge — three
    // stops so the sparkle reads the tier's palette at every distance.
    g.addColorStop(0, `rgba(255, 255, 245, ${alpha})`);
    g.addColorStop(0.5, rgba(core, alpha * 0.75));
    g.addColorStop(1, rgba(glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLevelText(ctx, sx, sy, rScreen, heightMax, k, intensity, level, aura, w, h) {
  // Base size scales with both the hole's on-screen radius AND the viewport
  // so the text is always big and readable — this is the hero element.
  const viewportRef = Math.min(w, h);
  const basePx = Math.max(rScreen * 1.1, viewportRef * 0.085) * (1 + 0.13 * (intensity - 1));
  const px0 = Math.min(basePx, viewportRef * 0.155);

  // Overshoot pop: 0 -> 1.25 -> 1.0, hold, then rise and fade out.
  let scale;
  let alpha;
  let rise;
  if (k < 0.08) {
    const p = k / 0.08;
    scale = p * 1.25;
    alpha = p;
    rise = 0;
  } else if (k < 0.22) {
    const p = (k - 0.08) / 0.14;
    scale = 1.25 - 0.25 * p;
    alpha = 1;
    rise = 0;
  } else if (k < 0.7) {
    scale = 1.0;
    alpha = 1;
    rise = 0;
  } else {
    const p = (k - 0.7) / 0.3;
    scale = 1 + p * 0.05;
    alpha = 1 - p;
    rise = p * viewportRef * 0.06;
  }
  if (alpha <= 0) return;

  const px = px0 * scale;
  // Sit above the pillar top during rise/hold; drift up on dissolve.
  // Clamp to stay in the viewport — at deep zoom the pillar can be tall
  // relative to the on-screen anchor and unclamped text lands off-screen.
  const wantY = sy - heightMax - px * 0.35 - rise;
  const minY = px * 0.55 + viewportRef * 0.02;
  const anchorY = Math.max(wantY, minY);
  const text = `LEVEL UP! ${level}`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${px}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  // Aura outer glow: a fat, blurred stroke in the tier's glow tone under
  // additive blending, so the title reads as radiating the aura's color.
  // Drawn under the dark outline so the letters stay crisp.
  const prevOp = ctx.globalCompositeOperation;
  const prevFilter = ctx.filter;
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${Math.max(px * 0.14, 2)}px)`;
  ctx.lineWidth = px * 0.42;
  ctx.strokeStyle = rgba(aura.glow, 0.9);
  ctx.strokeText(text, sx, anchorY);
  // Second, tighter glow layer in the brighter core tone.
  ctx.filter = `blur(${Math.max(px * 0.06, 1)}px)`;
  ctx.lineWidth = px * 0.22;
  ctx.strokeStyle = rgba(aura.core, 0.85);
  ctx.strokeText(text, sx, anchorY);
  ctx.filter = prevFilter;
  ctx.globalCompositeOperation = prevOp;

  // Dark outer outline for pop against any background.
  ctx.lineWidth = px * 0.16;
  ctx.strokeStyle = 'rgba(24, 10, 42, 0.92)';
  ctx.strokeText(text, sx, anchorY);

  // Bright inner outline hugging the letter shape.
  ctx.lineWidth = px * 0.05;
  ctx.strokeStyle = 'rgba(255, 250, 210, 0.9)';
  ctx.strokeText(text, sx, anchorY);

  // White-core fill — the aura color reads on the outside, letters stay
  // readable on the inside regardless of tier.
  const g = ctx.createLinearGradient(0, anchorY - px * 0.55, 0, anchorY + px * 0.55);
  g.addColorStop(0.0, '#ffffff');
  g.addColorStop(0.55, '#fff6dc');
  g.addColorStop(1.0, '#ffe6a8');
  ctx.fillStyle = g;
  ctx.fillText(text, sx, anchorY);

  ctx.restore();
}
