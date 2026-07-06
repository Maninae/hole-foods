// Tower collapse state machine: called when a tower base tips into the hole.
// Splits into two modes today (slump vs topple); Part B unifies both into a
// per-unit avalanche. This module keeps that logic out of swallow.js so the
// swallow state machine can stay a scoring/rim-physics story.
//
// Exports: initiateCollapse (kick off when the base starts falling),
// updateSlumps / updateTopples (drive per-tick advance from swallowUpdate).
// The animations mutate world state directly (o.state on units, world.eaten)
// but emit events via the caller's `events` array — presentation stays out.

import { CONFIG } from './config.js';
import { chunkSizeAt } from './world.js';
import { aliveInStack, normalizeBases, landedPosition } from './stacks.js';

// A tower's base has just started falling. Decide collapse mode: tall
// towers topple over sideways, shorter ones slump straight down. The base
// itself is already on sw.falling; this only affects units above.
export function initiateCollapse(sw, world, hole, base) {
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
    oldBaseStackIdx: base.stackIdx,
    t: 0,
    duration: CONFIG.STACK_SLUMP_TIME,
  });
}

function startTopple(sw, world, hole, base) {
  let dx = base.x - hole.x;
  let dy = base.y - hole.y;
  const mag = Math.hypot(dx, dy);
  let dirX; let dirY;
  if (mag < 1e-3) {
    // Hole is dead-center under the base (rare — but avoid a 0/0 direction).
    dirX = 1; dirY = 0;
  } else {
    dirX = dx / mag;
    dirY = dy / mag;
  }
  // Move all currently-stacked units of this tower into 'toppling'; rim
  // physics ignores them mid-rotation. The base stays 'falling' (already).
  // Also find the tower's max alive stackIdx — the tip of the column and
  // therefore the far end of the landing line.
  //
  // Stamp each toppling unit's idx into world.eaten IMMEDIATELY, at topple
  // start (not at landing). This closes the unload-mid-topple window: a
  // chunk that unloads and regens during the 0.5s topple animation must
  // not resurrect the tower. markEaten is idempotent — rim physics still
  // eats the landed units normally and their finalizeSwallow call is a
  // no-op on the eaten set. No live path filters queries by world.eaten,
  // so the landed units stay eatable while their chunk is loaded.
  let maxIdx = 0;
  let toppleEaten = world.eaten.get(base.ck);
  if (!toppleEaten) {
    toppleEaten = new Set();
    world.eaten.set(base.ck, toppleEaten);
  }
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) {
      if (o.stackId !== base.stackId) continue;
      if (o.state === 'stacked') {
        o.state = 'toppling';
        toppleEaten.add(o.idx);
      }
      if (o.stackIdx > maxIdx) maxIdx = o.stackIdx;
    }
  }
  // Compress the landing line so it fits inside the base chunk's padded
  // query window. landedPosition places unit k at (k+0.5)·2·unitR from the
  // pivot, so uncompressed the line reaches (2·maxIdx+1)·unitR — for a
  // deep-cycle beacon this is many chunks past PAD, hiding landed loot
  // from every spatial query. Cap the line at 2 × chunkSizeAt(level) (safely
  // inside PAD=3) by scaling the per-unit spacing; the emoji sizes are
  // untouched so the units read as dense fallen dominoes at the extreme.
  const level = parseInt(base.ck.split(':')[0], 10);
  const chunkSize = chunkSizeAt(level);
  const idealMaxDist = (2 * maxIdx + 1) * base.r;
  const cap = 2 * chunkSize;
  const scale = idealMaxDist > cap ? cap / idealMaxDist : 1;
  sw.topples.push({
    stackId: base.stackId,
    ck: base.ck,
    baseX: base.x, baseY: base.y,
    dirX, dirY,
    unitR: base.r,
    scale,
    t: 0,
    duration: CONFIG.STACK_TOPPLE_TIME,
  });
}

export function updateSlumps(sw, dt, world, events) {
  for (let i = sw.slumps.length - 1; i >= 0; i--) {
    const s = sw.slumps[i];
    s.t += dt;
    if (s.t < s.duration) continue;
    // Slump complete: promote the next unit to 'idle'. normalizeBases picks
    // the lowest surviving 'stacked' unit and marks it 'idle' — rim physics
    // starts acting on it next tick.
    const chunk = world.chunks.get(s.ck);
    if (chunk) normalizeBases(chunk.objects);
    events.push({ type: 'slumpEnd', stackId: s.stackId });
    sw.slumps.splice(i, 1);
  }
}

export function updateTopples(sw, dt, world, events) {
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
      for (const o of chunk.objects) {
        if (o.stackId !== tp.stackId || o.state !== 'toppling') continue;
        // Apply the landing-line compression factor: same visual size for
        // each unit, but they overlap along the fall line so the whole line
        // stays inside the base chunk's padded query window. (Idxs already
        // stamped in world.eaten at topple start — see M2.)
        const p = landedPosition(
          tp.baseX, tp.baseY, o.stackIdx, tp.unitR * tp.scale, tp.dirX, tp.dirY,
        );
        o.x = p.x;
        o.y = p.y;
        o.state = 'idle';
        o.landed = true; // renderer draws landed units as ordinary singles
        o.tilt = 0;
        o.vx = 0; o.vy = 0;
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
