// Swallow state machine: vacuum pull on fitting objects, tip-in fall
// animation, scoring with combo multiplier. Emits events for the
// presentation layer (sfx / particles / HUD) — pure module, no DOM.

import { CONFIG } from './config.js';
import { forEachObjectNear, markEaten } from './world.js';
import { eat } from './hole.js';
import {
  aliveInStack, normalizeBases, landedPosition,
} from './stacks.js';

export function createSwallow() {
  return {
    streak: 0,
    mult: 1,
    lastEat: -Infinity,
    falling: [],          // { obj, t, fromX, fromY, spinDir }
    disturbed: new Set(), // objects the rim has engaged; updated until settled
    // Vertical stack collapse animations:
    slumps: [],           // { stackId, ck, t, duration } — column drops one unit-height
    topples: [],          // { stackId, ck, baseX, baseY, dirX, dirY, unitR, t, duration }
  };
}

export function multForStreak(streak) {
  let mult = 1;
  for (const step of CONFIG.COMBO_STEPS) if (streak >= step) mult++;
  return mult;
}

// Support-based rim physics. An object is inert until the hole's opening is
// actually under part of it. overhang = fraction of its footprint over the
// void: teeter (tilt + wobble) below RIM_SLIDE_START, creep over the edge
// past it, tip the moment the center loses support (overhang >= 0.5).
// Engaged objects live in sw.disturbed until they settle — so a teetering
// object still relaxes after the hole drives away and stops visiting it.
function rimPhysics(sw, dt, now, world, hole) {
  const fitLimit = hole.r * CONFIG.FIT_FACTOR;
  forEachObjectNear(world, hole.x, hole.y, hole.r * 1.02, (o) => {
    if (o.r <= fitLimit) sw.disturbed.add(o);
  });

  const slideScale = CONFIG.RIM_SLIDE_ACCEL * Math.pow(hole.r / CONFIG.HOLE_R0, 0.85);
  for (const o of sw.disturbed) {
    if (o.state !== 'idle') {
      sw.disturbed.delete(o);
      continue;
    }
    if (o.tilt === undefined) o.tilt = 0;
    const dx = hole.x - o.x;
    const dy = hole.y - o.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    const overhang = (hole.r + o.r - dist) / (2 * o.r);

    if (overhang <= 0) {
      // Fully supported again: relax the lean, bleed off slide momentum.
      o.tilt *= Math.max(0, 1 - 6 * dt);
      o.vx *= Math.max(0, 1 - 8 * dt);
      o.vy *= Math.max(0, 1 - 8 * dt);
      if (Math.abs(o.tilt) < 1e-3 && Math.hypot(o.vx, o.vy) < 0.5) {
        o.tilt = 0;
        o.vx = 0;
        o.vy = 0;
        sw.disturbed.delete(o);
      }
      continue;
    }

    if (overhang >= 0.5) {
      // Center of mass over the void: nothing holds it up.
      o.state = 'falling';
      sw.falling.push({
        obj: o, t: 0, fromX: o.x, fromY: o.y,
        spinDir: (o.idx & 1) === 0 ? 1 : -1,
      });
      sw.disturbed.delete(o);
      // Tower base tipping? Kick off the tower-wide collapse (slump for
      // short towers, topple for tall ones). The base's fall proceeds
      // normally on the falling list — the collapse animates in parallel.
      if (o.stackId) initiateCollapse(sw, world, hole, o);
      continue;
    }

    // Teeter: lean toward the void, wobbling, more as support shrinks.
    const lean = CONFIG.RIM_TILT_MAX * (overhang / 0.5) ** 2
      + CONFIG.RIM_WOBBLE_AMP * overhang * Math.sin(now * CONFIG.RIM_WOBBLE_FREQ + o.idx);
    o.tilt += (lean - o.tilt) * Math.min(1, 10 * dt);

    // Past the slide threshold, the edge gives way and it creeps in.
    if (overhang > CONFIG.RIM_SLIDE_START) {
      const a = slideScale * (overhang - CONFIG.RIM_SLIDE_START) / (0.5 - CONFIG.RIM_SLIDE_START);
      o.vx += (dx / dist) * a * dt;
      o.vy += (dy / dist) * a * dt;
    }
    const damp = Math.max(0, 1 - 3 * dt);
    o.vx *= damp;
    o.vy *= damp;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
  }
}

function finalizeSwallow(sw, now, world, hole, obj, events) {
  markEaten(world, obj);
  sw.streak = now - sw.lastEat <= CONFIG.COMBO_WINDOW ? sw.streak + 1 : 1;
  sw.lastEat = now;
  const newMult = multForStreak(sw.streak);
  const comboUp = newMult > sw.mult;
  sw.mult = newMult;

  const big = obj.r > hole.r * 0.55;
  // Points math stays in BigInt land: obj.points is BigInt, sw.mult is a
  // small Number multiplier we widen for the multiply.
  const points = obj.points * BigInt(sw.mult);
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

// A tower's base has just started falling. Decide collapse mode: tall
// towers topple over sideways, shorter ones slump straight down. The base
// itself is already on the falling list; this only affects units above.
function initiateCollapse(sw, world, hole, base) {
  const alive = aliveInStack(world, base.stackId);
  if (alive.length <= 1) return; // just the base — nothing to collapse
  if (alive.length >= CONFIG.STACK_TOPPLE_MIN) {
    startTopple(sw, world, hole, base);
  } else {
    startSlump(sw, base);
  }
}

function startSlump(sw, base) {
  sw.slumps.push({
    stackId: base.stackId,
    ck: base.ck,
    t: 0,
    duration: CONFIG.STACK_SLUMP_TIME,
  });
}

function startTopple(sw, world, hole, base) {
  const dx = base.x - hole.x;
  const dy = base.y - hole.y;
  const mag = Math.hypot(dx, dy) || 1;
  const dirX = dx / mag;
  const dirY = dy / mag;
  // Move all currently-stacked units of this tower into 'toppling'; rim
  // physics ignores them mid-rotation. The base stays 'falling' (already).
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) {
      if (o.stackId === base.stackId && o.state === 'stacked') {
        o.state = 'toppling';
      }
    }
  }
  sw.topples.push({
    stackId: base.stackId,
    ck: base.ck,
    baseX: base.x, baseY: base.y,
    dirX, dirY,
    unitR: base.r,
    t: 0,
    duration: CONFIG.STACK_TOPPLE_TIME,
  });
}

function updateSlumps(sw, dt, world, events) {
  for (let i = sw.slumps.length - 1; i >= 0; i--) {
    const s = sw.slumps[i];
    s.t += dt;
    if (s.t < s.duration) continue;
    // Slump complete: promote the next unit to 'idle'. normalizeBases
    // picks the lowest surviving 'stacked' unit and marks it 'idle' —
    // rim physics starts acting on it next tick.
    const chunk = world.chunks.get(s.ck);
    if (chunk) normalizeBases(chunk.objects);
    events.push({ type: 'slumpEnd', stackId: s.stackId });
    sw.slumps.splice(i, 1);
  }
}

function updateTopples(sw, dt, world, events) {
  for (let i = sw.topples.length - 1; i >= 0; i--) {
    const tp = sw.topples[i];
    tp.t += dt;
    if (tp.t < tp.duration) continue;
    // Topple complete: land each toppling unit on the ground at its
    // stackIdx-th step along the fall direction. State becomes 'idle' so
    // rim physics can eat them normally; their idxs are also stamped into
    // world.eaten so the chunk can't respawn them if it unloads mid-chase.
    const chunk = world.chunks.get(tp.ck);
    if (chunk) {
      let set = world.eaten.get(tp.ck);
      if (!set) { set = new Set(); world.eaten.set(tp.ck, set); }
      for (const o of chunk.objects) {
        if (o.stackId !== tp.stackId || o.state !== 'toppling') continue;
        const p = landedPosition(tp.baseX, tp.baseY, o.stackIdx, tp.unitR, tp.dirX, tp.dirY);
        o.x = p.x;
        o.y = p.y;
        o.state = 'idle';
        o.tilt = 0;
        o.vx = 0; o.vy = 0;
        set.add(o.idx);
      }
    }
    events.push({
      type: 'topple',
      x: tp.baseX, y: tp.baseY,
      dirX: tp.dirX, dirY: tp.dirY,
      unitR: tp.unitR,
    });
    sw.topples.splice(i, 1);
  }
}

// Advance one tick. `now` is seconds on the game clock. Returns events.
export function swallowUpdate(sw, dt, now, world, hole) {
  const events = [];
  rimPhysics(sw, dt, now, world, hole);
  updateFalling(sw, dt, now, world, hole, events);
  updateSlumps(sw, dt, world, events);
  updateTopples(sw, dt, world, events);
  decayCombo(sw, now, events);
  return events;
}

// For the renderer: current visual state of a falling object. Two phases:
// a short tip-over at the rim (holds position, rotates over the edge), then
// a gravity slide down the funnel toward the center while shrinking.
export function fallingVisual(f, hole) {
  const t = Math.min(1, f.t);
  const TIP = 0.28;
  if (t < TIP) {
    const k = t / TIP;
    return {
      x: f.fromX + (hole.x - f.fromX) * 0.08 * k,
      y: f.fromY + (hole.y - f.fromY) * 0.08 * k,
      scale: 1 - 0.1 * k,
      rot: (f.obj.rot || 0) + (f.obj.tilt || 0) + f.spinDir * 1.1 * k * k,
      obj: f.obj,
    };
  }
  const q = (t - TIP) / (1 - TIP);
  const ease = q * q; // gravity: accelerates down the funnel
  return {
    x: f.fromX + (hole.x - f.fromX) * (0.08 + 0.92 * ease),
    y: f.fromY + (hole.y - f.fromY) * (0.08 + 0.92 * ease),
    scale: 0.9 * Math.pow(1 - q, 1.2),
    rot: (f.obj.rot || 0) + (f.obj.tilt || 0) + f.spinDir * (1.1 + q * 2.2),
    obj: f.obj,
  };
}
