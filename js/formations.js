// Formations: multi-column stacks that read as ONE object. Three families:
//
//   COLUMN   — single stack (the original tower). Not minted here; existing
//              worldgen path in world.js handles single-column towers directly.
//   PYRAMID  — 2k-1 columns with a triangular height profile [1..k..1],
//              oasis-tier centerpiece. Total units k^2.
//   PRISM    — W columns of equal height H, city/desert skyscraper landmark
//              (rarer than pyramids). Total units W*H, capped in worldgen.
//
// Each column of a formation is spawned as an ordinary stack (its own stackId,
// its own idx run in the chunk, its own avalanche when tipped). What binds
// them into a formation is a shared `formationId` (and `columnIdx`, `formationKind`,
// `formationTotalUnits`) written onto every unit at spawn.
//
// This module owns:
//   - Pure profile shape helpers (pyramidProfile, prismProfile) + column
//     offset math (formationColumnOffsets) — TDD'able without any world.
//   - A deterministic hash for chain destabilization rolls.
//   - The worldgen minter (mintFormation) that walks the profile and
//     spawns each column via stacks.spawnStackFromBase.
//
// Chain destabilization lives in collapse.js (which owns the avalanche
// simulation) — this module just supplies the hash function and the design
// constants live in config.js as FORMATION_CHAIN_*.

import { CONFIG } from './config.js';
import { spawnStackFromBase } from './stacks.js';

// --- Profile helpers -----------------------------------------------------

// Symmetric pyramid: peak k → [1, 2, ..., k, ..., 2, 1] with length 2k-1
// and total k^2. k=1 degenerates to a single column of height 1 (which
// worldgen won't mint — pyramids require k >= 2 by config).
export function pyramidProfile(peak) {
  if (peak < 1) return [];
  const out = [];
  for (let i = 1; i <= peak; i++) out.push(i);
  for (let i = peak - 1; i >= 1; i--) out.push(i);
  return out;
}

// Flat prism: W columns all at height H (a "skyscraper" — one silhouette).
export function prismProfile(width, height) {
  const out = [];
  for (let i = 0; i < width; i++) out.push(height);
  return out;
}

// Evenly-spaced 1D column offsets centered on 0. Returned in ascending order
// so columnIdx increases along the formation's axis.
//   K=3, spacing=20 → [-20, 0, 20]
//   K=4, spacing=20 → [-30, -10, 10, 30]
export function formationColumnOffsets(columns, spacing) {
  const out = new Array(columns);
  const half = (columns - 1) / 2;
  for (let i = 0; i < columns; i++) out[i] = (i - half) * spacing;
  return out;
}

// --- Chain-roll hash -----------------------------------------------------

// Deterministic hash → [0, 1). Used by chain destabilization to decide
// whether a still-standing neighbor column joins the cascade. FNV-1a over
// the formationId + Murmur3-flavored finalizer over (id-hash, columnIdx, salt).
// Different salts pull independent streams (chain prob vs. chain delay).
export function hashFormationRoll(formationId, columnIdx, salt) {
  let h = 2166136261;
  for (let i = 0; i < formationId.length; i++) {
    h ^= formationId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= Math.imul(columnIdx + 1, 0x9e3779b1);
  h ^= Math.imul(salt | 0, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// --- Worldgen minting ----------------------------------------------------

// tryPlaceStack signature (from world.js):
//   (item, x, y, height) -> void
// It handles idx bookkeeping internally (consumes 1 on rejection, height on
// accept). We call it once per column and bind them together after the fact:
// the units land in chunk.objects with stackId set, and we tag them with
// formationId/columnIdx here.
//
// Params:
//   ck: chunk key (used to derive a stable formationId)
//   rngSeed: monotonic-ish integer from the caller's rng (so different
//     formations in the same chunk get different ids)
//   axisAngle: radians; formation columns are laid out along (cos, sin)
//   spacing: world units between adjacent column bases
//   profile: array of column heights (from pyramidProfile / prismProfile)
//   item, cxWorld, cyWorld, mult: normal placement args
//   chunk: chunk to place into
//   tryPlaceStack: closure from world.js that mints one column
export function mintFormation({
  ck, rngSeed, kind, axisAngle, spacing, profile,
  item, cxWorld, cyWorld, chunk, tryPlaceStack,
}) {
  if (profile.length === 0) return;
  const formationId = `${ck}:F${rngSeed}`;
  const offsets = formationColumnOffsets(profile.length, spacing);
  const ax = Math.cos(axisAngle);
  const ay = Math.sin(axisAngle);
  const totalUnits = profile.reduce((a, b) => a + b, 0);

  // Snapshot the chunk's object length so we can find newly-placed units
  // after each column mint and tag them with formation metadata.
  for (let ci = 0; ci < profile.length; ci++) {
    const height = profile[ci];
    if (height < 1) continue;
    const off = offsets[ci];
    const tx = cxWorld + ax * off;
    const ty = cyWorld + ay * off;
    const before = chunk.objects.length;
    tryPlaceStack(item, tx, ty, height);
    // Tag every unit added by this column with the formation bindings.
    // (If placement was rejected, nothing was added — that's fine, the
    // formation just has a missing column, which reads as visual variety.)
    for (let i = before; i < chunk.objects.length; i++) {
      const o = chunk.objects[i];
      o.formationId = formationId;
      o.formationKind = kind;
      o.columnIdx = ci;
      o.formationTotalUnits = totalUnits;
    }
  }
}

// Called from world.js generateChunk for each oasis: decides whether to
// stage a pyramid centerpiece and (if the profile fits) mints it via the
// caller's tryPlaceStack. Returns true iff a formation was minted.
//
// RNG discipline: we always consume the same number of rng calls per
// invocation regardless of accept/reject so chunk determinism holds.
// Order: chance roll → axis roll → peak roll → item pick → center coords.
export function tryMintPyramid({
  rng, ck, biome, stackItems, mult, x0, y0, C, chunk, tryPlaceStack,
}) {
  const roll = rng.next();
  const axisRoll = rng.next();
  const peakRoll = rng.next();
  const cxRoll = rng.range(0.2, 0.8);
  const cyRoll = rng.range(0.2, 0.8);
  const itemIdx = pickWeightedIndex(rng, stackItems, (it) => it.w);

  if (roll >= CONFIG.FORMATION_PYRAMID_CHANCE) return false;
  if (stackItems.length === 0) return false;
  const peak = CONFIG.FORMATION_PYRAMID_PEAK_MIN
    + Math.floor(peakRoll * (CONFIG.FORMATION_PYRAMID_PEAK_MAX
                             - CONFIG.FORMATION_PYRAMID_PEAK_MIN + 1));
  const profile = pyramidProfile(peak);
  const item = stackItems[itemIdx];
  const placedR = item.r * mult;
  const spacing = 2 * placedR * CONFIG.FORMATION_SPACING_FRAC;
  // Footprint check: axis extent must fit inside the chunk (2 chunks slack
  // via PAD, but we don't want a pyramid straddling >1 chunk).
  const halfExtent = ((profile.length - 1) / 2) * spacing + placedR;
  if (halfExtent * 2 > 0.9 * C) return false;
  const axisAngle = axisRoll * Math.PI * 2;
  const cxWorld = x0 + cxRoll * C;
  const cyWorld = y0 + cyRoll * C;
  const rngSeed = chunk.objects.length; // stable per (chunk, insertion order)
  mintFormation({
    ck, rngSeed, kind: 'pyramid', axisAngle, spacing, profile,
    item, cxWorld, cyWorld, chunk, tryPlaceStack,
  });
  return true;
}

// Prism (skyscraper): fixed-width flat profile at desert/city landmark tier.
// Rarer than pyramids; footprint check is same as pyramid.
export function tryMintPrism({
  rng, ck, biome, stackItems, mult, x0, y0, C, chunk, tryPlaceStack,
}) {
  const roll = rng.next();
  const axisRoll = rng.next();
  const widthRoll = rng.next();
  const heightRoll = rng.next();
  const cxRoll = rng.range(0.2, 0.8);
  const cyRoll = rng.range(0.2, 0.8);
  const itemIdx = pickWeightedIndex(rng, stackItems, (it) => it.w);

  if (roll >= CONFIG.FORMATION_PRISM_CHANCE) return false;
  if (stackItems.length === 0) return false;
  const width = CONFIG.FORMATION_PRISM_WIDTH_MIN
    + Math.floor(widthRoll * (CONFIG.FORMATION_PRISM_WIDTH_MAX
                              - CONFIG.FORMATION_PRISM_WIDTH_MIN + 1));
  const height = CONFIG.FORMATION_PRISM_HEIGHT_MIN
    + Math.floor(heightRoll * (CONFIG.FORMATION_PRISM_HEIGHT_MAX
                               - CONFIG.FORMATION_PRISM_HEIGHT_MIN + 1));
  if (width * height > CONFIG.FORMATION_PRISM_MAX_UNITS) return false;
  const profile = prismProfile(width, height);
  const item = stackItems[itemIdx];
  const placedR = item.r * mult;
  const spacing = 2 * placedR * CONFIG.FORMATION_SPACING_FRAC;
  const halfExtent = ((profile.length - 1) / 2) * spacing + placedR;
  if (halfExtent * 2 > 0.9 * C) return false;
  const axisAngle = axisRoll * Math.PI * 2;
  const cxWorld = x0 + cxRoll * C;
  const cyWorld = y0 + cyRoll * C;
  const rngSeed = chunk.objects.length;
  mintFormation({
    ck, rngSeed, kind: 'prism', axisAngle, spacing, profile,
    item, cxWorld, cyWorld, chunk, tryPlaceStack,
  });
  return true;
}

// Same-shaped weighted picker as chunkRng.pickWeighted, but returns the
// INDEX instead of the item so callers can also read the item after having
// already pre-consumed the rng call (keeps consumption order stable).
function pickWeightedIndex(rng, arr, weightFn) {
  if (arr.length === 0) return 0;
  let total = 0;
  for (const it of arr) total += weightFn(it);
  let r = rng.next() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weightFn(arr[i]);
    if (r <= 0) return i;
  }
  return arr.length - 1;
}
