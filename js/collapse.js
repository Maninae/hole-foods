// Tower collapse: per-unit avalanche. When a tower base tips into the hole,
// its stacked units detach BOTTOM-UP with a small stagger (Jenga-losing-
// balance beat first, on tall columns). Each detached unit becomes a
// ballistic body with a fake `z` height above the ground, horizontal
// velocity spread into a cone away from the hole, gravity + 1-2 damped
// bounces, and a spin — then it settles at a DETERMINISTIC target position
// (seeded per unit) as an ordinary 'idle' ground object. That determinism
// is what lets the S1 landing-cap invariant stay testable — the flight
// itself is randomized, only the resting spot is fixed.
//
// Data model:
//   sw.avalanches = [{
//     stackId, ck,
//     baseX, baseY, unitR,
//     dirX, dirY,                        // spread direction, away from hole
//     cap,                                // 2 × chunkSizeAt(level) — max mound radius
//     isTall,                             // pre-lean + big impulses vs. hop-in-place slump
//     preLeanUntil,                       // seconds; 0 for short piles
//     t,                                  // seconds since collapse start
//     dustLast, thumpLast,                // throttles for fx / sfx events
//     units: Map<stackIdx, { ...unit sim state }>,
//   }]
//
// A unit sim state carries: reference to the chunk object, detachAt,
// phase ('stacked' → 'tumbling' → 'settled'), airborne (x, y, z, vx, vy,
// vz, rot, spin, bounces, flightT), and its deterministic target (tx, ty).
// The renderer reads sw.avalanches directly — see render.js.
//
// The chunk object's `state` field mirrors the phase for the rest of the
// engine: 'stacked' (before detach), 'tumbling' (airborne), 'idle' + landed
// (settled). Rim physics never sees a 'tumbling' unit — it's out of the
// idle spatial-query fold until it lands.

import { CONFIG } from './config.js';
import { chunkSizeAt } from './world.js';
import { aliveInStack } from './stacks.js';

const DEG = Math.PI / 180;

// Deterministic FNV-1a-ish hash → float in [-1, 1]. Same shape as
// render-sprites.js's hash01 — different salts give independent streams
// for angle, distance, spin, cone jitter, launch vz.
function hash01(stackId, stackIdx, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < stackId.length; i++) {
    h ^= stackId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= stackIdx + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 16777619);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

// A tower's base has just started falling. Decide collapse mode and kick
// off the avalanche. The base itself is on sw.falling (rim physics owns
// its fall); this only stages the units above.
export function initiateCollapse(sw, world, hole, base) {
  const alive = aliveInStack(world, base.stackId);
  if (alive.length <= 1) return; // just the base — nothing to collapse

  const isTall = alive.length >= CONFIG.STACK_TOPPLE_MIN;

  // Spread direction: away from the hole. Dead-center is rare (a base right
  // on top of the hole is already tipping); pick a stable +x default.
  let dirX; let dirY;
  const dx = base.x - hole.x;
  const dy = base.y - hole.y;
  const mag = Math.hypot(dx, dy);
  if (mag < 1e-3) { dirX = 1; dirY = 0; }
  else { dirX = dx / mag; dirY = dy / mag; }

  // Landing cap: same S1 invariant as before — every settled unit must
  // sit within 2 × chunkSizeAt(baseLevel) of the pivot.
  const level = parseInt(base.ck.split(':')[0], 10);
  const chunkSize = chunkSizeAt(level);
  const cap = 2 * chunkSize;

  // Move all currently-stacked units into 'tumbling' bookkeeping — but the
  // chunk-object state stays 'stacked' until each unit actually detaches
  // (rim physics still ignores 'stacked' units, which is what we want).
  // Also stamp non-base idxs into world.eaten IMMEDIATELY (M2 invariant):
  // a chunk unload/reload mid-avalanche must not resurrect the tower.
  let toppleEaten = world.eaten.get(base.ck);
  if (!toppleEaten) {
    toppleEaten = new Set();
    world.eaten.set(base.ck, toppleEaten);
  }

  const units = new Map();
  let maxIdx = 0;
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) {
      if (o.stackId !== base.stackId) continue;
      if (o.stackIdx === 0) continue; // base handled by rim physics
      if (o.state !== 'stacked') continue;
      toppleEaten.add(o.idx);
      units.set(o.stackIdx, {
        obj: o,
        stackIdx: o.stackIdx,
        detachAt: 0, // filled below
        phase: 'stacked',
        // world-space position (initialized on detach)
        x: base.x, y: base.y, z: 0,
        vx: 0, vy: 0, vz: 0,
        rot: o.rot || 0, spin: 0,
        bounces: 0, flightT: 0,
        tx: base.x, ty: base.y,
      });
      if (o.stackIdx > maxIdx) maxIdx = o.stackIdx;
    }
  }
  if (units.size === 0) return;

  // Pre-lean beat: only tall columns get the visible "losing balance" tilt
  // before the first detach. Short piles start detaching immediately.
  const preLeanUntil = isTall ? CONFIG.STACK_AVAL_PRELEAN_TIME : 0;

  // Sort stackIdxs ascending — bottom-up detach order. Accumulate the
  // detach time so it's strictly monotonic per idx (small positive jitter
  // per step avoids mechanical lockstep without ever letting a higher
  // idx overtake a lower one).
  const sortedIdxs = [...units.keys()].sort((a, b) => a - b);
  let detachT = preLeanUntil;
  for (const k of sortedIdxs) {
    // Positive-only jitter [0, 0.2] so the delta is always >= STAGGER.
    const jitter = 0.1 * (1 + hash01(base.stackId, k, 0x7331));
    detachT += CONFIG.STACK_AVAL_STAGGER * (1 + jitter);
    units.get(k).detachAt = detachT;
  }

  // Deterministic final targets. Natural mound extent scales with tower
  // size (unit-radius × height), clamped to the cap × mound-spread. A
  // short-pile slump uses a much tighter radius so units mostly hop IN
  // PLACE — the tower crumbles into the hole one unit at a time and the
  // rim physics eats them normally, feeding the combo chain (the whole
  // point of a slump).
  const naturalMax = 2 * base.r * (maxIdx + 1);
  const targetRadius = isTall
    ? Math.min(cap * CONFIG.STACK_AVAL_MOUND_SPREAD, naturalMax)
    : Math.min(cap * CONFIG.STACK_AVAL_MOUND_SPREAD * 0.35,
               naturalMax * CONFIG.STACK_AVAL_SLUMP_RADIUS_MULT);
  const coneRad = CONFIG.STACK_AVAL_CONE_DEG * DEG;

  // Target distribution: cluster around a mound CENTER (fraction of the
  // targetRadius out from the base) with a smaller ± jitter, plus a wide
  // cone angle. Higher units still tend farther but not so much that the
  // mound reads as a line — the visual reference is a tight pile, not a
  // fan. Every position stays inside targetRadius (S1 cap invariant).
  for (const u of units.values()) {
    const stackFrac = (u.stackIdx + 0.5) / (maxIdx + 1);
    // Center distance around 0.55 of targetRadius, biased by stackFrac.
    const distCenter = targetRadius * (0.35 + 0.40 * stackFrac);
    const distJitter = 0.22 * targetRadius
      * hash01(base.stackId, u.stackIdx, 0xa5a5);
    const dist = Math.max(base.r * 0.4,
      Math.min(targetRadius, distCenter + distJitter));
    // Cone angle: wide enough (±35° default) that the mound has visible
    // y-spread and doesn't read as a rigid line.
    const angle = coneRad * hash01(base.stackId, u.stackIdx, 0xd0d0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dirX * cos - dirY * sin;
    const ry = dirX * sin + dirY * cos;
    u.tx = base.x + rx * dist;
    u.ty = base.y + ry * dist;
  }

  if (!sw.avalanches) sw.avalanches = [];
  sw.avalanches.push({
    stackId: base.stackId,
    ck: base.ck,
    baseX: base.x, baseY: base.y,
    unitR: base.r,
    dirX, dirY,
    cap,
    isTall,
    preLeanUntil,
    t: 0,
    dustLast: -1,
    thumpLast: -1,
    units,
  });
}

// Airborne physics for one unit: gravity, ground contact, damped bounces,
// spin, snap-to-target on settle. Returns true if the unit newly settled
// this tick (for dust/thump event throttling).
function stepUnit(av, u, dt) {
  u.flightT += dt;
  u.vz -= CONFIG.STACK_AVAL_GRAVITY * dt;
  u.x += u.vx * dt;
  u.y += u.vy * dt;
  u.z += u.vz * dt;
  u.rot += u.spin * dt;
  let newlyLanded = false;
  if (u.z <= 0 && u.vz < 0) {
    // Ground contact — bounce or settle.
    if (u.bounces < CONFIG.STACK_AVAL_MAX_BOUNCES
        && Math.abs(u.vz) > CONFIG.STACK_AVAL_MIN_VZ_SETTLE
        && u.flightT < CONFIG.STACK_AVAL_MAX_FLIGHT) {
      u.bounces++;
      u.z = 0;
      u.vz *= CONFIG.STACK_AVAL_BOUNCE_VZ;
      u.vx *= CONFIG.STACK_AVAL_BOUNCE_HORIZ;
      u.vy *= CONFIG.STACK_AVAL_BOUNCE_HORIZ;
      u.spin *= CONFIG.STACK_AVAL_BOUNCE_SPIN;
      newlyLanded = true; // dust puff on bounce
    } else {
      settleUnit(av, u);
    }
  } else if (u.flightT >= CONFIG.STACK_AVAL_MAX_FLIGHT) {
    // Hard cap — settle regardless. Prevents a stuck unit from locking the
    // avalanche (test: 'avalanche: settles within a bounded sim time').
    settleUnit(av, u);
  }
  return newlyLanded;
}

function settleUnit(av, u) {
  // Snap the chunk object to the deterministic target and hand it back to
  // the ordinary idle pool — rim physics eats it normally from here on.
  u.phase = 'settled';
  u.z = 0;
  u.x = u.tx;
  u.y = u.ty;
  u.vx = 0; u.vy = 0; u.vz = 0;
  const o = u.obj;
  o.x = u.tx;
  o.y = u.ty;
  o.state = 'idle';
  o.landed = true;
  o.tilt = 0;
  o.vx = 0; o.vy = 0;
}

function detachUnit(av, u) {
  const s = u.stackIdx;
  const stackId = av.stackId;
  // Position at detach: on-column, at this unit's stacked height.
  u.x = av.baseX;
  u.y = av.baseY;
  u.z = s * 2 * av.unitR;

  // Horizontal impulse: cone around the spread direction, magnitude scales
  // with stackIdx (higher units fling farther). Short-pile slumps use
  // reduced base speed so units "hop down" more than fling out.
  const spreadCone = CONFIG.STACK_AVAL_CONE_DEG * DEG;
  const angleJitter = spreadCone * hash01(stackId, s, 0xbeef);
  const cos = Math.cos(angleJitter);
  const sin = Math.sin(angleJitter);
  const dirX = av.dirX * cos - av.dirY * sin;
  const dirY = av.dirX * sin + av.dirY * cos;

  const baseSpeed = av.isTall
    ? CONFIG.STACK_AVAL_HSPEED_BASE + s * CONFIG.STACK_AVAL_HSPEED_PER_IDX
    : CONFIG.STACK_AVAL_SLUMP_HSPEED + s * CONFIG.STACK_AVAL_HSPEED_PER_IDX * 0.35;
  // Small ±25% speed jitter, deterministic.
  const speedJit = 1 + 0.25 * hash01(stackId, s, 0xcafe);
  const speed = baseSpeed * speedJit;
  u.vx = dirX * speed;
  u.vy = dirY * speed;

  // Vertical impulse: small upward toss, scaled with stackIdx so tall units
  // arc higher (matches the reference frame — tops of the column fly up).
  const vzBoost = 1 + 0.3 * hash01(stackId, s, 0xf00d);
  u.vz = (CONFIG.STACK_AVAL_LAUNCH_VZ + s * CONFIG.STACK_AVAL_LAUNCH_VZ_PER_IDX) * vzBoost;

  // Spin: signed random, deterministic per unit.
  u.spin = hash01(stackId, s, 0xace0) * CONFIG.STACK_AVAL_SPIN_RATE_DEG * DEG;

  u.phase = 'tumbling';
  u.obj.state = 'tumbling';
  // Renderer needs the airborne (x, y, z) — mirror onto the object so a
  // single query path (chunk.objects) is enough. Real position is authoritative
  // on `u`; we won't move it via chunk.objects while airborne.
}

// Drive one avalanche forward by dt. Returns event descriptors to bubble
// up (dust puffs, thumps) so the caller can decide whether to spawn.
function updateAvalanche(av, dt, events) {
  av.t += dt;

  // Pre-lean beat: no state changes, just visible in the renderer via
  // av.preLeanUntil / av.t. Handled entirely in render code.

  // Detach units whose time has come, bottom-up.
  for (const u of av.units.values()) {
    if (u.phase === 'stacked' && av.t >= u.detachAt) {
      detachUnit(av, u);
    }
  }

  // Step every airborne unit.
  let bouncedAny = false;
  let settledAny = false;
  for (const u of av.units.values()) {
    if (u.phase !== 'tumbling') continue;
    const wasBouncing = stepUnit(av, u, dt);
    if (wasBouncing) bouncedAny = true;
    if (u.phase === 'settled') settledAny = true;
  }

  // Throttle dust puffs + thump sfx so a 24-unit avalanche doesn't spam.
  if (bouncedAny || settledAny) {
    if (av.t - av.dustLast >= CONFIG.STACK_AVAL_DUST_INTERVAL) {
      events.push({
        type: 'avalancheDust',
        x: av.baseX + av.dirX * av.unitR * 2,
        y: av.baseY + av.dirY * av.unitR * 2,
        unitR: av.unitR,
      });
      av.dustLast = av.t;
    }
    if (av.t - av.thumpLast >= CONFIG.STACK_AVAL_THUMP_INTERVAL) {
      events.push({
        type: 'avalancheThump',
        x: av.baseX, y: av.baseY,
        unitR: av.unitR,
      });
      av.thumpLast = av.t;
    }
  }

  // Fully settled? All units 'settled' (no stacked, no tumbling remaining).
  for (const u of av.units.values()) {
    if (u.phase !== 'settled') return false;
  }
  return true;
}

export function updateAvalanches(sw, dt, world, events) {
  if (!sw.avalanches || sw.avalanches.length === 0) return;
  for (let i = sw.avalanches.length - 1; i >= 0; i--) {
    const av = sw.avalanches[i];
    const done = updateAvalanche(av, dt, events);
    if (done) {
      events.push({
        type: 'topple', // keep the historical event name — HUD/audio wire off it
        x: av.baseX, y: av.baseY,
        dirX: av.dirX, dirY: av.dirY,
        unitR: av.unitR,
      });
      sw.avalanches.splice(i, 1);
    }
  }
}
