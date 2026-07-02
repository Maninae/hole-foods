// Seeded, deterministic PRNG streams. xmur3 string hash -> mulberry32 generator.
// Pure module: no DOM, no Math.random.

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seedStr) {
  const next = mulberry32(xmur3(String(seedStr))());
  const rng = {
    next,
    range: (a, b) => a + next() * (b - a),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    pickWeighted(items, weightOf) {
      let total = 0;
      for (const it of items) total += weightOf(it);
      let roll = next() * total;
      for (const it of items) {
        roll -= weightOf(it);
        if (roll < 0) return it;
      }
      return items[items.length - 1];
    },
  };
  return rng;
}

export function chunkRng(seed, cx, cy, salt = '') {
  return makeRng(`${seed}|${cx},${cy}|${salt}`);
}
