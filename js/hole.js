// The player: position, easing movement, area-accumulation growth, levels.
// Radius is the single source of truth; levels/speed/labels derive from it.
// Pure module: no DOM.

import { CONFIG } from './config.js';

export function createHole() {
  return {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: CONFIG.HOLE_R0,
    level: 1,
    score: 0,
    eatenCount: 0,
  };
}

export function levelForRadius(r) {
  return 1 + Math.max(0, Math.floor(
    Math.log(r / CONFIG.HOLE_R0) / Math.log(CONFIG.LEVEL_R_GROWTH) + 1e-9,
  ));
}

export function levelProgress(r) {
  const t = Math.log(r / CONFIG.HOLE_R0) / Math.log(CONFIG.LEVEL_R_GROWTH) + 1e-9;
  const frac = t - Math.floor(t);
  return Math.min(0.999999, Math.max(0, frac));
}

export function holeSpeed(r) {
  return CONFIG.SPEED_BASE * Math.pow(r / CONFIG.HOLE_R0, CONFIG.SPEED_EXP);
}

// dir: {x, y, mag} — unit direction and 0..1 throttle.
export function updateHole(hole, dt, dir) {
  const max = holeSpeed(hole.r);
  const tx = dir.x * dir.mag * max;
  const ty = dir.y * dir.mag * max;
  const ease = Math.min(1, CONFIG.ACCEL * dt);
  hole.vx += (tx - hole.vx) * ease;
  hole.vy += (ty - hole.vy) * ease;
  hole.x += hole.vx * dt;
  hole.y += hole.vy * dt;
}

// Swallow an object of placed radius s worth `points`. Returns level-up info.
export function eat(hole, s, points) {
  hole.r = Math.sqrt(hole.r * hole.r + CONFIG.GROWTH_K * s * s);
  hole.score += points;
  hole.eatenCount++;
  const newLevel = levelForRadius(hole.r);
  const leveledUp = newLevel > hole.level;
  hole.level = newLevel;
  return { leveledUp, newLevel };
}

// Hole diameter as a friendly size: 1 world unit = 1 cm.
export function sizeLabel(r) {
  const cm = Math.round(2 * r);
  if (cm < 100) return `${cm} cm`;
  const m = cm / 100;
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}
