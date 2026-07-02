// Swallow state machine: vacuum pull on fitting objects, tip-in fall
// animation, scoring with combo multiplier. Emits events for the
// presentation layer (sfx / particles / HUD) — pure module, no DOM.

import { CONFIG } from './config.js';
import { forEachObjectNear, markEaten } from './world.js';
import { eat } from './hole.js';

export function createSwallow() {
  return {
    streak: 0,
    mult: 1,
    lastEat: -Infinity,
    falling: [], // { obj, t, fromX, fromY, spinDir }
  };
}

export function multForStreak(streak) {
  let mult = 1;
  for (const step of CONFIG.COMBO_STEPS) if (streak >= step) mult++;
  return mult;
}

function pullObjects(sw, dt, world, hole) {
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  const pullBase = hole.r * CONFIG.PULL_FACTOR;
  const accelScale = CONFIG.PULL_ACCEL * Math.pow(hole.r / CONFIG.HOLE_R0, 0.8);
  forEachObjectNear(world, hole.x, hole.y, pullBase, (o) => {
    if (o.r > fitLimit) return;
    const dx = hole.x - o.x;
    const dy = hole.y - o.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const range = pullBase + o.r;
    if (dist > range) return;

    const engulfDist = Math.max(hole.r * 0.3, hole.r * 0.9 - o.r * 0.5);
    if (dist < engulfDist) {
      o.state = 'falling';
      sw.falling.push({
        obj: o, t: 0, fromX: o.x, fromY: o.y,
        spinDir: (o.idx & 1) === 0 ? 1 : -1,
      });
      return;
    }

    const a = accelScale * (1 - dist / range);
    o.vx += (dx / dist) * a * dt;
    o.vy += (dy / dist) * a * dt;
    const damp = Math.max(0, 1 - 4 * dt);
    o.vx *= damp;
    o.vy *= damp;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
  });
}

function finalizeSwallow(sw, now, world, hole, obj, events) {
  markEaten(world, obj);
  sw.streak = now - sw.lastEat <= CONFIG.COMBO_WINDOW ? sw.streak + 1 : 1;
  sw.lastEat = now;
  const newMult = multForStreak(sw.streak);
  const comboUp = newMult > sw.mult;
  sw.mult = newMult;

  const big = obj.r > hole.r * 0.55;
  const points = obj.points * sw.mult;
  const { leveledUp, newLevel } = eat(hole, obj.r, points);

  events.push({
    type: 'swallow',
    x: hole.x, y: hole.y,
    r: obj.r, hue: obj.hue, e: obj.e,
    points, basePoints: obj.points, mult: sw.mult, big,
  });
  if (comboUp) events.push({ type: 'combo', mult: sw.mult, x: hole.x, y: hole.y });
  if (leveledUp) events.push({ type: 'levelup', level: newLevel, x: hole.x, y: hole.y });
}

function updateFalling(sw, dt, now, world, hole, events) {
  for (let i = sw.falling.length - 1; i >= 0; i--) {
    const f = sw.falling[i];
    f.t += dt / CONFIG.FALL_TIME;
    if (f.t >= 1) {
      sw.falling.splice(i, 1);
      finalizeSwallow(sw, now, world, hole, f.obj, events);
    }
  }
}

function decayCombo(sw, now, events) {
  if (sw.streak > 0 && now - sw.lastEat > CONFIG.COMBO_WINDOW) {
    const hadMult = sw.mult > 1;
    sw.streak = 0;
    sw.mult = 1;
    if (hadMult) events.push({ type: 'comboEnd' });
  }
}

// Advance one tick. `now` is seconds on the game clock. Returns events.
export function swallowUpdate(sw, dt, now, world, hole) {
  const events = [];
  pullObjects(sw, dt, world, hole);
  updateFalling(sw, dt, now, world, hole, events);
  decayCombo(sw, now, events);
  return events;
}

// For the renderer: current visual state of a falling object.
export function fallingVisual(f, hole) {
  const t = Math.min(1, f.t);
  const ease = t * t * (3 - 2 * t); // smoothstep toward the center
  return {
    x: f.fromX + (hole.x - f.fromX) * ease,
    y: f.fromY + (hole.y - f.fromY) * ease,
    scale: Math.pow(1 - t, 1.15),
    rot: (f.obj.rot || 0) + f.spinDir * t * 2.6,
    obj: f.obj,
  };
}
