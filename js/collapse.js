// Tower collapse: per-unit avalanche. When a tower base tips into the
// hole, its stacked units detach BOTTOM-UP with a small stagger (Jenga
// losing-balance beat first, on tall columns). Each detached unit
// becomes a ballistic body with a fake `z` height above the ground, a
// spin, and 1-2 damped local bounces. Its horizontal velocity is DERIVED
// so the parabolic hop lands ON the deterministic sunflower-spiral
// target: vx = (tx - x0) / T, vy = (ty - y0) / T where T is the flight
// time computed from z0, vz, gravity. Settle is then a no-op on x/y
// (unit is already at the target), which fixed the owner-reported
// "fling far, then teleport back" bug: nothing to snap because the
// flight aimed at the target from the first frame.
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

// Deterministic hash to a float in [-1, 1]. FNV-1a across stackId chars,
// then a Murmur3-flavored finalizer over the (stackId-hash, stackIdx, salt)
// tuple so consecutive stackIdx values map to WIDELY different outputs.
// (An earlier finalizer here left biasRoll and angle nearly monotonic
// across idx, giving the settle mound two visible rows.) Different salts
// give independent streams for angle, distance, spin, launch vz.
function hash01(stackId, stackIdx, salt) {
  let h = 2166136261;
  for (let i = 0; i < stackId.length; i++) {
    h ^= stackId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(stackIdx + 1, 0x9e3779b1);
  h ^= Math.imul(salt | 0, 0x85ebca6b);
  // Murmur3 finalizer: full 32-bit avalanche.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
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

  // Deterministic settle targets: a SUNFLOWER-SPIRAL heap around the base.
  //
  // Why not random-in-cone: any two settled targets that end up closer than
  // one unit diameter fuse into a caterpillar row on screen under the ISO_Y
  // squash — the y-sorted overlap of identical sprites merges them into a
  // horizontal strip no matter how random the raw angles were. Owner
  // playtest confirmed rows kept surfacing three times in a 48s run.
  //
  // Golden-angle sunflower placement enforces the minimum separation for
  // free: r_j = spacing * sqrt(j), angle_j = j * 137.5°. Adjacent points
  // sit ~spacing apart no matter which j indices you pick, dense at the
  // center thinning outward — exactly the pyramid-collapse pile shape.
  // Small hashed jitter breaks visual regularity without breaking the
  // spacing guarantee. Forward-shift (along the away-from-hole direction)
  // gives the owner's 60/40 forward bias organically.
  //
  // Slump path: same spiral with tight spacing so units mostly hop into
  // the hole (feeding the combo chain), and any leftover still gets the
  // no-row spacing.
  //
  // Cap awareness: if the natural spiral would exceed 2×chunkSize
  // (S1 invariant), compress spacing so the farthest target sits at
  // 0.9 × cap. The min-separation weakens for beacon-scale towers but
  // that's the tradeoff — the cap must hold or spatial queries lose
  // landed units.
  const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));
  const N = maxIdx; // spiral indices 0..N-1 for unit stackIdxs 1..N
  const naturalSpacing = isTall
    ? 2 * base.r * CONFIG.STACK_AVAL_SPIRAL_SPACING_TALL
    : 2 * base.r * CONFIG.STACK_AVAL_SPIRAL_SPACING_SLUMP;
  const naturalMaxRadius = naturalSpacing * Math.sqrt(Math.max(1, N));
  const capBudget = cap * 0.9;
  const spacing = naturalMaxRadius > capBudget
    ? capBudget / Math.sqrt(Math.max(1, N))
    : naturalSpacing;
  const forwardShift = isTall
    ? spacing * CONFIG.STACK_AVAL_FORWARD_SHIFT
    : 0;
  const targetRadius = cap; // used only as the safety clamp

  for (const u of units.values()) {
    const j = u.stackIdx - 1; // 0-indexed spiral position, bottom unit first
    // Small deterministic jitter — angular ±10% of a golden step, radial
    // ±15% of spacing. Small enough to preserve the min-separation
    // guarantee, large enough to break perfect-spiral regularity.
    const angleJitter = 0.1 * hash01(base.stackId, u.stackIdx, 0xa1) * GOLDEN_ANGLE_RAD;
    const radiusJitter = 0.15 * hash01(base.stackId, u.stackIdx, 0xa2);
    const localAngle = j * GOLDEN_ANGLE_RAD + angleJitter;
    const localRadius = spacing * Math.sqrt(j + 0.4) * (1 + radiusJitter);

    // Local frame: +x = away-from-hole direction. Apply forward shift
    // AFTER the spiral so the natural spiral's spacing is preserved.
    let lx = Math.cos(localAngle) * localRadius + forwardShift;
    const ly = Math.sin(localAngle) * localRadius;
    // Slight squash of the "behind" half so late spiral points that land
    // past the pivot still lean toward the hole-opposite side (a few
    // fully-behind units are fine — they're the "spilled sideways" case
    // the owner asked for).
    if (lx < 0) lx *= CONFIG.STACK_AVAL_BEHIND_SQUASH;

    // Safety clamp to the S1 cap (should rarely fire thanks to the
    // spacing compression above).
    const localDist = Math.hypot(lx, ly);
    const scale = localDist > targetRadius ? targetRadius / localDist : 1;
    const lxC = lx * scale;
    const lyC = ly * scale;

    // Rotate to world frame: (dirX, dirY) is the +x-local basis vector,
    // (-dirY, dirX) is the +y-local basis vector.
    u.tx = base.x + dirX * lxC + (-dirY) * lyC;
    u.ty = base.y + dirY * lxC + dirX * lyC;

    // Final resting rotation: random full-circle. Applied at settle so a
    // lying croissant/pretzel faces any angle, not the one accumulated by
    // physics spin (which correlates with flight time).
    u.finalRot = hash01(base.stackId, u.stackIdx, 0xe5e5) * Math.PI * 2;
  }

  if (!sw.avalanches) sw.avalanches = [];
  // Physics scale: linear multiplier on vz/gravity/settle-threshold so
  // flight time stays constant regardless of unit radius. Without this
  // scale, a cycle-2+ tower's flight time balloons past MAX_FLIGHT and
  // the settle epsilon slide fires with a huge miss (visible teleport).
  // Floor at 1: small towers (base.r < HOLE_R0) keep today's tuning so
  // the slump combo chain doesn't slow down. Only scale UP for oversize.
  const physicsScale = Math.max(1, base.r / CONFIG.HOLE_R0);

  sw.avalanches.push({
    stackId: base.stackId,
    ck: base.ck,
    baseX: base.x, baseY: base.y,
    unitR: base.r,
    physicsScale,
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

// Airborne physics: gravity + integration. On first touchdown the unit is
// at (tx, ty, 0) by construction (vx/vy were chosen to arrive there), so a
// bounce is a purely vertical hop with zeroed horizontal velocity. That's
// how "1-2 small hops" stays local and never re-flings the sprite.
// Returns true iff the unit bounced this tick (for dust/thump throttling).
function stepUnit(av, u, dt) {
  u.flightT += dt;
  u.vz -= CONFIG.STACK_AVAL_GRAVITY * av.physicsScale * dt;
  u.x += u.vx * dt;
  u.y += u.vy * dt;
  u.z += u.vz * dt;
  u.rot += u.spin * dt;
  let newlyLanded = false;
  if (u.z <= 0 && u.vz < 0) {
    if (u.bounces < CONFIG.STACK_AVAL_MAX_BOUNCES
        && Math.abs(u.vz) > CONFIG.STACK_AVAL_MIN_VZ_SETTLE * av.physicsScale
        && u.flightT < CONFIG.STACK_AVAL_MAX_FLIGHT) {
      u.bounces++;
      u.z = 0;
      u.vz *= CONFIG.STACK_AVAL_BOUNCE_VZ;
      // Zero horizontal on bounce so the unit hops IN PLACE at its target.
      // (The pre-bounce vx/vy already delivered it there.) This is the
      // "local decaying hop" the owner asked for.
      u.vx = 0; u.vy = 0;
      u.spin *= CONFIG.STACK_AVAL_BOUNCE_SPIN;
      newlyLanded = true;
    } else {
      settleUnit(av, u);
    }
  } else if (u.flightT >= CONFIG.STACK_AVAL_MAX_FLIGHT) {
    settleUnit(av, u);
  }
  return newlyLanded;
}

// Settle: hand the chunk object back to the idle pool at its current x/y.
// Because the flight was aimed to arrive at (tx, ty), the current x/y is
// (tx, ty) modulo float and bounce settling; no visible teleport. As a
// safety belt (dt-slop, integrator error) we correct positions that
// drifted further than EPSILON_R from the target — but the correction is
// always < 0.5 unit radius by construction, so it can't teleport.
function settleUnit(av, u) {
  u.phase = 'settled';
  u.z = 0;
  const eps = av.unitR * 0.5;
  const dxT = u.tx - u.x;
  const dyT = u.ty - u.y;
  if (Math.hypot(dxT, dyT) > eps) {
    // Ballistic drifted (usually from the max-flight hard cap firing
    // early). Slide the last bit rather than teleport.
    u.x = u.tx;
    u.y = u.ty;
  }
  u.vx = 0; u.vy = 0; u.vz = 0;
  const o = u.obj;
  o.x = u.x;
  o.y = u.y;
  o.state = 'idle';
  o.landed = true;
  o.tilt = 0;
  o.rot = u.finalRot ?? o.rot;
  o.vx = 0; o.vy = 0;
}

// Compute the ballistic flight time from (x0, y0, z0) to (tx, ty, 0) under
// gravity, given an initial vz. Solves 0 = z0 + vz*T - 0.5*g*T^2 for T > 0.
function flightTime(z0, vz, gravity) {
  // Positive root of the quadratic. Guard against tiny negatives in the
  // discriminant from float rounding.
  const disc = Math.max(0, vz * vz + 2 * gravity * z0);
  return (vz + Math.sqrt(disc)) / gravity;
}

function detachUnit(av, u) {
  const s = u.stackIdx;
  const stackId = av.stackId;
  // Position at detach: on-column, at this unit's stacked height.
  u.x = av.baseX;
  u.y = av.baseY;
  u.z = s * 2 * av.unitR;

  // Vertical impulse: hashed per-unit boost so top-of-column units arc
  // higher (their z0 is already tall; extra vz makes them peak higher).
  // vz and gravity both scale linearly with av.physicsScale, which keeps
  // the flight time invariant across cycles and slots (see initiateCollapse
  // for the derivation). Without the scale, tall cycle-2+ towers would
  // fly for >>MAX_FLIGHT and hit the settle epsilon slide as a visible
  // teleport.
  const vzBoost = 1 + 0.3 * hash01(stackId, s, 0xf00d);
  u.vz = (CONFIG.STACK_AVAL_LAUNCH_VZ + s * CONFIG.STACK_AVAL_LAUNCH_VZ_PER_IDX)
       * vzBoost * av.physicsScale;

  // Horizontal velocity is now DERIVED, not sampled. Aim the parabolic
  // hop AT the deterministic spiral target so the unit lands where it is
  // supposed to settle. This is the fix for the owner's two symptoms:
  // no more "flings super far" (vx is bounded by targetDist / T) and no
  // more "teleports back" (there's nothing to snap to).
  const T = flightTime(u.z, u.vz, CONFIG.STACK_AVAL_GRAVITY * av.physicsScale);
  u.vx = (u.tx - u.x) / T;
  u.vy = (u.ty - u.y) / T;

  // Spin: signed random, deterministic per unit.
  u.spin = hash01(stackId, s, 0xace0) * CONFIG.STACK_AVAL_SPIN_RATE_DEG * DEG;

  u.phase = 'tumbling';
  u.obj.state = 'tumbling';
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
