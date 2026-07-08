import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../js/config.js';
import {
  createWorld, ensureChunksAround, forEachObjectNear, markEaten, chunkKey,
} from '../../js/world.js';

function snapshotChunk(world, cx, cy) {
  const chunk = world.chunks.get(chunkKey(0, cx, cy));
  assert.ok(chunk, `chunk ${cx},${cy} not generated`);
  return chunk.objects.map((o) => ({ id: o.id, x: o.x, y: o.y, r: o.r, e: o.e }));
}

test('same seed generates identical chunks; different seeds differ', () => {
  const a = createWorld('alpha');
  const b = createWorld('alpha');
  const c = createWorld('beta');
  for (const w of [a, b, c]) ensureChunksAround(w, 1200, 1200, 800, 600);
  assert.deepEqual(snapshotChunk(a, 2, 2), snapshotChunk(b, 2, 2));
  assert.notDeepEqual(snapshotChunk(a, 2, 2), snapshotChunk(c, 2, 2));
});

test('chunk object counts stay within sane bounds', () => {
  const w = createWorld('bounds');
  ensureChunksAround(w, 0, 0, 2000, 2000);
  let total = 0;
  let chunks = 0;
  for (const chunk of w.chunks.values()) {
    assert.ok(chunk.objects.length <= 80, `chunk has ${chunk.objects.length} objects`);
    total += chunk.objects.length;
    chunks++;
  }
  assert.ok(chunks > 9, 'expected several chunks generated');
  // Post-oasis, the average is lower because desert chunks are near-empty; a
  // world that hits 2 obj/chunk on average is still visibly alive up close
  // (starter chunks and oases are dense).
  assert.ok(total / chunks >= 2, `world feels empty: ${(total / chunks).toFixed(1)} obj/chunk`);
});

test('object density is oasis-and-desert: rich clusters between sparse stretches', () => {
  const w = createWorld('oasis');
  // Cover a wide swath of level-0 space away from the starter radius so the
  // starter guarantee does not skew the distribution. 30x30 chunks at
  // (~15*CHUNK, ~15*CHUNK) sits comfortably inside cycle 0.
  const C = CONFIG.CHUNK;
  ensureChunksAround(w, 15 * C, 15 * C, 30 * C, 30 * C);
  let rich = 0;
  let sparse = 0;
  let total = 0;
  for (const chunk of w.chunks.values()) {
    if (chunk.level !== 0) continue;
    const cd = Math.hypot((chunk.cx + 0.5) * C, (chunk.cy + 0.5) * C);
    if (cd < CONFIG.STARTER_RADIUS) continue;
    total++;
    if (chunk.objects.length >= 10) rich++;
    if (chunk.objects.length <= 2) sparse++;
  }
  assert.ok(total >= 200, `need a wide sample; only ${total} chunks inspected`);
  assert.ok(rich / total >= 0.05,
    `only ${rich}/${total} rich chunks (${(100 * rich / total).toFixed(1)}%) — no oases`);
  assert.ok(sparse / total >= 0.50,
    `only ${sparse}/${total} sparse chunks (${(100 * sparse / total).toFixed(1)}%) — no desert`);
});

test('the starter area always has food a newborn hole can eat', () => {
  for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
    const w = createWorld(seed);
    ensureChunksAround(w, 0, 0, 1200, 900);
    let edible = 0;
    forEachObjectNear(w, 0, 0, CONFIG.STARTER_RADIUS, (o) => {
      if (o.r <= CONFIG.HOLE_R0 * CONFIG.FIT_FACTOR) edible++;
    });
    assert.ok(edible >= 8, `seed ${seed}: only ${edible} edible starter objects`);
  }
});

test('no object sits on the spawn point', () => {
  for (const seed of ['s1', 's2', 's3']) {
    const w = createWorld(seed);
    ensureChunksAround(w, 0, 0, 1200, 900);
    forEachObjectNear(w, 0, 0, 200, (o) => {
      const d = Math.hypot(o.x, o.y);
      assert.ok(d - o.r > CONFIG.HOLE_R0 * 2, `${o.e} overlaps spawn (d=${d.toFixed(0)}, r=${o.r})`);
    });
  }
});

test('eaten objects stay eaten across unload and regeneration', () => {
  const w = createWorld('eaten');
  ensureChunksAround(w, 0, 0, 800, 600);
  // Chunk (0,0) is inside STARTER_RADIUS, so it is always an oasis with the
  // tiniest-item sprinkle — guaranteed non-empty.
  const before = snapshotChunk(w, 0, 0);
  assert.ok(before.length > 0, 'need a non-empty chunk for this test');
  const victim = w.chunks.get(chunkKey(0, 0, 0)).objects[0];
  markEaten(w, victim);

  // Simulate wandering far away (chunk unloads), then coming back.
  ensureChunksAround(w, 100000, 100000, 800, 600);
  assert.ok(!w.chunks.has(chunkKey(0, 0, 0)), 'chunk should have unloaded');
  ensureChunksAround(w, 0, 0, 800, 600);

  const after = snapshotChunk(w, 0, 0);
  assert.equal(after.length, before.length - 1);
  assert.ok(!after.some((o) => o.id === victim.id), 'eaten object came back');
});

test('objects a full cycle out are scaled up by CYCLE_SIZE_MULT', () => {
  const w = createWorld('faraway');
  const farDist = CONFIG.BAND_WIDTH * (CONFIG.BANDS_PER_CYCLE + 0.5); // band 6, cycle 1
  ensureChunksAround(w, farDist, 0, 1600, 1200);
  let maxR = 0;
  let count = 0;
  forEachObjectNear(w, farDist, 0, 2000, (o) => { maxR = Math.max(maxR, o.r); count++; });
  assert.ok(count > 0, 'no objects generated a cycle out');
  // Meadow-II smallest is blueberry 7 * 12 = 84; anything must exceed cycle-0 blueberry scale.
  assert.ok(maxR >= 7 * CONFIG.CYCLE_SIZE_MULT, `max radius ${maxR} not cycle-scaled`);
});

test('cluster+singles density scales down with slot mult (boundary crowding fix)', () => {
  // At high slot multipliers (slot 4-5), cluster items and singles counts drop
  // so a single chunk does not paint a wall of ~9x-scale objects at cycle
  // boundaries. Owner playtest at L12-13 near the cycle-0 boundary: the frame
  // was 2/3 filled by overlapping torii/pianos/buses/huts/cows/etc.
  //
  // Sample slot 0 (band 0-ish) and slot 5 (band 5) chunks and confirm slot 5
  // holds fewer objects than slot 0 on average. We deliberately sample a
  // grid of chunks per slot to average over oasis/desert rolls.
  const C = CONFIG.CHUNK;
  function avgObjectsAtSlot(slot, seed) {
    const w = createWorld(seed);
    // Distance to sit in target band: start of band = slot × BAND_WIDTH.
    const dist = (slot + 0.5) * CONFIG.BAND_WIDTH;
    // Sample a wide swath so oasis rolls average.
    ensureChunksAround(w, dist, 0, 24 * C, 24 * C);
    let total = 0; let n = 0;
    for (const chunk of w.chunks.values()) {
      if (chunk.level !== 0) continue;
      const cd = Math.hypot((chunk.cx + 0.5) * C, (chunk.cy + 0.5) * C);
      // Only sample chunks solidly inside the target band (skip band edges).
      const b = Math.floor(cd / CONFIG.BAND_WIDTH);
      if (b !== slot) continue;
      if (cd < CONFIG.STARTER_RADIUS) continue;
      total += chunk.objects.length;
      n++;
    }
    assert.ok(n > 20, `slot ${slot}: only ${n} chunks sampled`);
    return total / n;
  }
  const slot0 = avgObjectsAtSlot(0, 'crowd0');
  const slot5 = avgObjectsAtSlot(5, 'crowd5');
  // Slot 5 must be visibly emptier than slot 0. 0.7x is a soft target that
  // still leaves aspirational bigness readable; the point is to strip the wall.
  assert.ok(slot5 < slot0 * 0.7,
    `slot 5 chunks not sparser: avg ${slot5.toFixed(1)} vs slot 0 ${slot0.toFixed(1)}`);
});

test('cluster items filter out placed radii larger than 1/8 chunk side', () => {
  // At slot 5 (mult ~8.95), the ring/blob patterns would otherwise extend
  // ~7-9× the item's radius from center — vastly beyond the chunk side. The
  // filter caps cluster items so cluster extents stay within PAD=3.
  // A slot-5 chunk should not carry a CLUSTER (co-located same-emoji group)
  // of large items — scattered singles that happen to share an emoji are OK.
  const w = createWorld('cluster-cap');
  const C = CONFIG.CHUNK;
  const dist = 5.5 * CONFIG.BAND_WIDTH;      // slot 5, mult ~8.95
  ensureChunksAround(w, dist, 0, 12 * C, 12 * C);
  const cap = (C / 8) * 1.15;                // + tolerance for ±8% jitter
  for (const chunk of w.chunks.values()) {
    if (chunk.level !== 0) continue;
    const buckets = new Map();
    for (const o of chunk.objects) {
      // Skip tower members: N stacked units share one (x,y) by design and
      // would fake a cluster. Only pattern-placed idle objects count.
      if (o.stackId != null) continue;
      if (!buckets.has(o.e)) buckets.set(o.e, []);
      buckets.get(o.e).push(o);
    }
    for (const [emoji, arr] of buckets) {
      if (arr.length < 6) continue;
      // Distinguish a real cluster from scattered singles: cluster patterns
      // (ring/doubleRing/grid/spiral/arc/blob) all place at least ~6-22
      // members within ~4 r_avg of a shared centroid, while scattered
      // singles at slot 5 (~2-4 per chunk) can occasionally co-locate but
      // never reach that count. Threshold pinned at 6 so scattered singles
      // that happen to share an emoji don't false-positive.
      const cx = arr.reduce((s, o) => s + o.x, 0) / arr.length;
      const cy = arr.reduce((s, o) => s + o.y, 0) / arr.length;
      const rAvg = arr.reduce((s, o) => s + o.r, 0) / arr.length;
      const near = arr.filter((o) => Math.hypot(o.x - cx, o.y - cy) < 4 * rAvg);
      if (near.length < 6) continue;
      const anyLarge = near.some((o) => o.r > cap);
      assert.ok(!anyLarge,
        `slot-5 chunk placed cluster of ${emoji} (${near.length} co-located) with r > cap ${cap.toFixed(1)}`);
    }
  }
});

test('forEachObjectNear only yields objects near the query point', () => {
  const w = createWorld('near');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  forEachObjectNear(w, 0, 0, 300, (o) => {
    const d = Math.hypot(o.x, o.y);
    assert.ok(d <= 300 + o.r + 1e-6, `object ${o.e} at ${d.toFixed(0)} beyond query radius`);
  });
});
