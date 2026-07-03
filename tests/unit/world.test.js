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

test('forEachObjectNear only yields objects near the query point', () => {
  const w = createWorld('near');
  ensureChunksAround(w, 0, 0, 3000, 3000);
  forEachObjectNear(w, 0, 0, 300, (o) => {
    const d = Math.hypot(o.x, o.y);
    assert.ok(d <= 300 + o.r + 1e-6, `object ${o.e} at ${d.toFixed(0)} beyond query radius`);
  });
});
