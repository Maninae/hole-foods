// Vertical stacks ("towers"): N identical units of one item at the same
// ground position, drawn as a vertical strip. Only the lowest alive unit is
// interactive ('idle'); the rest sit in state='stacked' so spatial queries
// skip them and the renderer treats them as belonging to a tower.
//
// This module owns the geometry helpers and small pure utilities. The
// spawning logic lives in world.js (chunk generation); the collapse
// state machine lives in swallow.js.
//
// Data model: every tower unit carries `stackId` (string, unique per chunk)
// and `stackIdx` (0 = base, increases upward). Height is the max stackIdx
// present at spawn; regeneration after eating filters via `world.eaten`, and
// the lowest surviving stackIdx becomes the new base.

import { CONFIG } from './config.js';

// Group objects by stackId. Non-stack objects are dropped. Returns a Map
// stackId -> list (unsorted). Callers sort by stackIdx if they need order.
export function groupStacks(objects) {
  const out = new Map();
  for (const o of objects) {
    if (!o.stackId) continue;
    let list = out.get(o.stackId);
    if (!list) { list = []; out.set(o.stackId, list); }
    list.push(o);
  }
  return out;
}

// Alive units of a specific tower, spanning any chunk (idle + stacked +
// tumbling all count). Used by the collapse code to size the avalanche.
export function aliveInStack(world, stackId) {
  const out = [];
  for (const chunk of world.chunks.values()) {
    for (const o of chunk.objects) {
      if (o.stackId === stackId) out.push(o);
    }
  }
  return out;
}

// The current base of a tower: lowest-stackIdx alive unit. Callers guarantee
// the list is non-empty.
export function currentBaseOf(list) {
  let base = list[0];
  for (const o of list) {
    if (o.stackIdx < base.stackIdx) base = o;
  }
  return base;
}

// After a chunk regenerates the lowest surviving 'stacked' unit needs to
// become 'idle'; higher units stay 'stacked'. Units mid-animation
// ('falling' base, 'tumbling' siblings) are untouched — they'll resolve
// on their own timeline.
export function normalizeBases(objects) {
  const groups = groupStacks(objects);
  for (const list of groups.values()) {
    const settled = list.filter(
      (o) => o.state === 'idle' || o.state === 'stacked',
    );
    if (settled.length === 0) continue;
    const base = currentBaseOf(settled);
    for (const o of settled) {
      o.state = o === base ? 'idle' : 'stacked';
    }
  }
}

// Lean applied to a stacked unit given the base's tilt — accumulates gently
// up the column, so the top sways more than the bottom without diverging.
export function unitLean(baseTilt, stackIdx) {
  return baseTilt * (1 + CONFIG.STACK_LEAN_ACCUM * stackIdx);
}

// Turn a successfully-placed base into a full tower: mint N-1 sibling
// units at the base's (x, y, r), all state='stacked' with contiguous
// stackIdx. Returns the next free idx after consuming H-1 more (base's
// idx was already consumed by placeObject). Placement determinism is
// preserved: same (seed, chunk) → same base attempt → same siblings.
export function spawnStackFromBase(chunk, base, startIdx, height) {
  const ck = base.ck;
  const stackId = `${ck}:s${base.idx}`;
  base.stackId = stackId;
  base.stackIdx = 0;
  // Full column height on every unit: the renderer's height-aware south
  // cull needs it without walking siblings (see columnCullExtraY).
  base.stackH = height;
  chunk.objects.push(base);
  let idx = startIdx;
  for (let k = 1; k < height; k++) {
    chunk.objects.push({
      id: `${ck}:${idx}`,
      idx,
      ck,
      x: base.x, y: base.y, r: base.r,
      e: base.e, hue: base.hue, up: base.up, rot: base.rot,
      points: base.points,
      state: 'stacked',
      vx: 0, vy: 0,
      stackId, stackIdx: k, stackH: height,
    });
    idx++;
  }
  return idx;
}
