import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, chunkRng } from '../../js/rng.js';

test('same seed produces the same sequence', () => {
  const a = makeRng('hello');
  const b = makeRng('hello');
  for (let i = 0; i < 50; i++) assert.equal(a.next(), b.next());
});

test('different seeds produce different sequences', () => {
  const a = makeRng('hello');
  const b = makeRng('world');
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('next() stays in [0, 1)', () => {
  const r = makeRng('bounds');
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('range(a, b) stays within [a, b)', () => {
  const r = makeRng('range');
  for (let i = 0; i < 500; i++) {
    const v = r.range(-3, 7);
    assert.ok(v >= -3 && v < 7, `out of range: ${v}`);
  }
});

test('int(a, b) is inclusive on both ends and hits both', () => {
  const r = makeRng('int');
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = r.int(2, 5);
    assert.ok(Number.isInteger(v) && v >= 2 && v <= 5, `bad int: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4, 5]);
});

test('pick returns a member of the array', () => {
  const r = makeRng('pick');
  const arr = ['a', 'b', 'c'];
  for (let i = 0; i < 100; i++) assert.ok(arr.includes(r.pick(arr)));
});

test('weighted pick respects zero weights', () => {
  const r = makeRng('weighted');
  const items = [{ w: 0 }, { w: 1 }, { w: 0 }];
  for (let i = 0; i < 200; i++) {
    assert.equal(r.pickWeighted(items, (it) => it.w), items[1]);
  }
});

test('chance(p) is deterministic and roughly calibrated', () => {
  const r = makeRng('chance');
  let hits = 0;
  for (let i = 0; i < 5000; i++) if (r.chance(0.3)) hits++;
  assert.ok(hits > 1200 && hits < 1800, `0.3 chance hit ${hits}/5000`);
});

test('chunkRng is deterministic per (seed, cx, cy, salt) and independent across chunks', () => {
  const a = chunkRng('world1', 3, -2);
  const b = chunkRng('world1', 3, -2);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());

  const c = chunkRng('world1', 4, -2);
  const d = chunkRng('world1', 3, -2, 'decals');
  const base = chunkRng('world1', 3, -2);
  assert.notEqual(c.next(), base.next());
  assert.notEqual(d.next(), chunkRng('world1', 3, -2).next());
});

test('negative chunk coords do not collide with positive ones', () => {
  const a = chunkRng('s', -1, 1);
  const b = chunkRng('s', 1, -1);
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});
