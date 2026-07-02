// Cluster layout generators — the decorative arrangements (rings, grids,
// spirals) the world is dressed with. All return local {x, y} offsets around
// (0, 0); spacing derives from the item's radius. Pure module: no DOM.

const GOLDEN_ANGLE = 2.39996322972865332;

function ring(rng, itemR) {
  const n = rng.int(7, 12);
  const spacing = itemR * 2.35;
  const R = (n * spacing) / (2 * Math.PI);
  const phase = rng.range(0, Math.PI * 2);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * R, y: Math.sin(a) * R });
  }
  return pts;
}

function doubleRing(rng, itemR) {
  const spacing = itemR * 2.35;
  const n1 = rng.int(6, 8);
  const n2 = n1 + rng.int(5, 7);
  const R1 = Math.max((n1 * spacing) / (2 * Math.PI), spacing * 0.9);
  const R2 = Math.max((n2 * spacing) / (2 * Math.PI), R1 + spacing);
  const phase = rng.range(0, Math.PI * 2);
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < n1; i++) {
    const a = phase + (i / n1) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * R1, y: Math.sin(a) * R1 });
  }
  for (let i = 0; i < n2; i++) {
    const a = -phase + (i / n2) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * R2, y: Math.sin(a) * R2 });
  }
  return pts;
}

function grid(rng, itemR) {
  const spacing = itemR * 2.35;
  const cols = rng.int(3, 5);
  const rows = rng.int(2, 4);
  const pts = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pts.push({
        x: (c - (cols - 1) / 2) * spacing + rng.range(-0.12, 0.12) * spacing,
        y: (r - (rows - 1) / 2) * spacing + rng.range(-0.12, 0.12) * spacing,
      });
    }
  }
  return pts;
}

function spiral(rng, itemR) {
  const n = rng.int(10, 16);
  const c = itemR * 2.35 * 0.95;
  const phase = rng.range(0, Math.PI * 2);
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const r = c * Math.sqrt(i);
    const a = phase + i * GOLDEN_ANGLE;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

function arc(rng, itemR) {
  const n = rng.int(5, 9);
  const spacing = itemR * 2.35;
  const span = rng.range(Math.PI * 0.5, Math.PI * 1.2);
  const R = ((n - 1) * spacing) / span;
  const start = rng.range(0, Math.PI * 2);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = start + (i / (n - 1)) * span;
    pts.push({ x: Math.cos(a) * R, y: Math.sin(a) * R });
  }
  return pts;
}

function blob(rng, itemR) {
  const spacing = itemR * 2.35;
  const minDist = spacing * 0.95;
  const R = spacing * 2.4;
  const n = rng.int(6, 11);
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * R;
      const p = { x: Math.cos(a) * d, y: Math.sin(a) * d };
      if (pts.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= minDist)) {
        pts.push(p);
        break;
      }
    }
  }
  return pts;
}

const GENERATORS = { ring, doubleRing, grid, spiral, arc, blob };

export const PATTERN_KEYS = Object.keys(GENERATORS);

export function layoutCluster(rng, key, itemR) {
  return GENERATORS[key](rng, itemR);
}
