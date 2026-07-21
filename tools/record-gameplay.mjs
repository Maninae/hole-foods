// Record a ~15s greedy-autoplay gameplay clip for social media.
//
// Warps to an "advanced" run (large hole, score in the millions, positioned
// in a dense cycle-0 cell where item sizes are comparable to the hole) via
// window.__game, then installs an in-page rAF autopilot that dispatches
// synthetic WASD keydown/keyup events to steer greedily toward the nearest
// edible object each frame (port of tools/simulate.mjs's `pickTarget`). The
// input path is unchanged: the game still runs its normal loop.
//
// Playwright's recordVideo finalises the .webm on context.close(); we then
// use ffmpeg (if available) to trim the middle to a punchy 10s and encode
// to H.264 mp4 for Threads/social compatibility.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO_ROOT, 'media');
fs.mkdirSync(OUT_DIR, { recursive: true });

const PORT = 8137;
const SEED = process.env.SEED ?? 'photogenic';
const URL = `http://127.0.0.1:${PORT}/?seed=${SEED}`;
const VIEW = { width: 1080, height: 1080 };
// Record longer than the final clip so we can trim to the densest window.
const RECORD_SECONDS = Number(process.env.RECORD_SECONDS ?? 15);
const TRIM_SECONDS = 10;
// Skip this many seconds from the start when trimming (settles the camera
// after the warp, avoids the first-eat sanity beat).
const TRIM_START = Number(process.env.TRIM_START ?? 3);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEW,
  recordVideo: { dir: OUT_DIR, size: VIEW },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(`console: ${m.text()}`);
});

await page.goto(URL);
await page.waitForLoadState('networkidle');
// Start the game via the real UI so main.js's play flow (mode='playing',
// joystick sync, etc.) runs the way it does for a human.
await page.click('#btn-play');
await page.evaluate(() => {
  document.getElementById('start').style.display = 'none';
});

// Warp to an advanced state and drop the hole into a dense mid-cycle cell.
// - Level 15 hole (r ≈ 464): big enough to gorge, camera zoom pulls back
//   nicely so lots of food is on screen at once.
// - Position at ~(9000, 3500), dist ≈ 9660: band 4 in cycle 0 — item mult
//   ≈ 5.77, so placed radii sit in ~40-350, all edible below the hole's
//   fit limit (0.95 × r ≈ 440) and each reads as a distinct sprite on
//   screen instead of a sub-pixel speck.
// - potential set just under the level-16 threshold, so a few swallows in
//   the video window will trigger a level-up celebration flash.
// - score is BigInt; setting to ~2.5M reads as "deep into a real run".
const warp = await page.evaluate(() => {
  const g = window.__game;
  const C = g.CONFIG;
  const TARGET_LEVEL = 15;
  const rN = C.HOLE_R0 * Math.pow(C.LEVEL_R_GROWTH, TARGET_LEVEL - 1);
  const rNext = C.HOLE_R0 * Math.pow(C.LEVEL_R_GROWTH, TARGET_LEVEL);
  g.hole.level = TARGET_LEVEL;
  g.hole.r = rN;
  // Sit at ~96% of the way to the next level — first solid meal triggers
  // the celebration during the recording window.
  g.hole.potential = rNext * 0.985;
  // BigInt literal via constructor because eval runs in browser JS.
  g.hole.score = 2500000n;
  g.hole.eatenCount = 1100;
  // Position in a mid-cycle-0 slot.
  g.hole.x = 9000;
  g.hole.y = 3500;
  g.hole.vx = 0; g.hole.vy = 0;
  // Preseed camera at the warp point so we don't watch a giant pan-across.
  g.cam.x = g.hole.x;
  g.cam.y = g.hole.y;
  // Zoom will ease to the natural zoomForRadius on its own.
  return { rN, holePos: [g.hole.x, g.hole.y] };
});
console.log('warped:', warp);

// Install the greedy-autoplay autopilot inside the page. It uses the same
// nearest-edible heuristic as tools/simulate.mjs, then discretises the
// desired direction into WASD components. Each rAF tick, we ensure the
// current keydown-Set matches the desired set: press missing keys, release
// extra ones. The game's input.js reads window keydown/keyup exactly the
// way a human's keyboard would drive it.
await page.evaluate(() => {
  const g = window.__game;
  const C = g.CONFIG;

  const SEARCH_MULTS = [3, 6, 12, 24];
  const STACK_ATTRACTION = 0.75;

  function pickTarget(hole, world) {
    const fitLimit = hole.r * C.FIT_FACTOR;
    for (const mult of SEARCH_MULTS) {
      const R = Math.max(hole.r * mult, 240);
      const R2 = R * R;
      let best = null;
      let bestScore = Infinity;
      for (const chunk of world.chunks.values()) {
        for (const o of chunk.objects) {
          if (o.state !== 'idle') continue;
          if (o.r > fitLimit) continue;
          const dx = o.x - hole.x;
          const dy = o.y - hole.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          const attract = o.stackId ? STACK_ATTRACTION : 1;
          const score = d2 * attract * attract;
          if (score < bestScore) {
            bestScore = score;
            best = o;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
  const held = new Set();

  function press(code) {
    if (held.has(code)) return;
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code, key: code, bubbles: true,
    }));
    held.add(code);
  }
  function release(code) {
    if (!held.has(code)) return;
    window.dispatchEvent(new KeyboardEvent('keyup', {
      code, key: code, bubbles: true,
    }));
    held.delete(code);
  }

  // Convert (dx, dy) → a set of WASD codes that steers roughly in that
  // direction. Threshold 0.35 gives 8-way steering (each of the 4
  // components active when |axis| > sin(~20°)); a slightly-off cardinal
  // gets both keys (diagonal), a nearly-cardinal drops the second key so
  // input.js's summed direction stays axis-aligned.
  function chooseKeys(dx, dy) {
    const need = new Set();
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-6) return need;
    const nx = dx / mag;
    const ny = dy / mag;
    const thresh = 0.35;
    if (nx > thresh) need.add('KeyD');
    if (nx < -thresh) need.add('KeyA');
    if (ny > thresh) need.add('KeyS');
    if (ny < -thresh) need.add('KeyW');
    return need;
  }

  // Sticky target: keep steering to the same object for a few ticks so we
  // don't jitter when two candidates are near-equidistant.
  let lastTarget = null;
  let stickyTicks = 0;
  const STICKY_MAX = 8;

  let running = true;
  function tick() {
    if (!running) return;
    const hole = g.hole;
    const world = g.world;
    let target = pickTarget(hole, world);
    if (target === null && lastTarget && stickyTicks < STICKY_MAX) {
      target = lastTarget;
      stickyTicks++;
    } else if (target === lastTarget) {
      stickyTicks = Math.min(STICKY_MAX, stickyTicks + 1);
    } else {
      lastTarget = target;
      stickyTicks = 0;
    }

    let dx;
    let dy;
    if (target) {
      dx = target.x - hole.x;
      dy = target.y - hole.y;
    } else {
      // No visible edible: nudge outward (like simulate.mjs's explore path).
      dx = hole.x || 1;
      dy = hole.y;
    }
    const need = chooseKeys(dx, dy);
    for (const c of KEYS) {
      if (need.has(c)) press(c);
      else release(c);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__autopilotStop = () => {
    running = false;
    for (const c of Array.from(held)) release(c);
  };
});

// Log level milestones so we can pick a good trim window. Runs a poll on the
// main-frame __game — cheap and safe.
const poll = setInterval(async () => {
  try {
    const s = await page.evaluate(() => ({
      t: performance.now(),
      lvl: window.__game.hole.level,
      r: window.__game.hole.r,
      score: String(window.__game.hole.score),
      eaten: window.__game.hole.eatenCount,
      x: window.__game.hole.x,
      y: window.__game.hole.y,
    }));
    console.log(
      `[t=${(s.t / 1000).toFixed(1)}s] lvl=${s.lvl} r=${s.r.toFixed(0)}`
      + ` score=${s.score} eaten=${s.eaten} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)})`,
    );
  } catch { /* page may be closing */ }
}, 1000);

// Let the run play out.
await page.waitForTimeout(RECORD_SECONDS * 1000);
clearInterval(poll);

// Stop autopilot, save best-state, finalise video.
await page.evaluate(() => {
  window.__autopilotStop?.();
});

if (errs.length) console.error('page errors:', errs);

const video = page.video();
await page.close();
await context.close();

const webmPath = await video.path();
const rawWebm = path.join(OUT_DIR, 'gameplay-raw.webm');
fs.copyFileSync(webmPath, rawWebm);
console.log('raw webm:', rawWebm);
await browser.close();

// --- Post-process with ffmpeg -----------------------------------------------
function hasFfmpeg() {
  const r = spawnSync('which', ['ffmpeg']);
  return r.status === 0;
}

function runFfmpeg(args) {
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg exit ${r.status}: ${args.join(' ')}`);
}

if (!hasFfmpeg()) {
  console.log('ffmpeg not found — leaving webm only at', rawWebm);
  process.exit(0);
}

// Trim to TRIM_SECONDS starting at TRIM_START seconds, encode as H.264 yuv420p.
const mp4Out = path.join(OUT_DIR, 'gameplay-clip.mp4');
runFfmpeg([
  '-y',
  '-ss', String(TRIM_START),
  '-i', rawWebm,
  '-t', String(TRIM_SECONDS),
  '-vf', 'fps=30,scale=1080:1080:flags=lanczos',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  '-an',
  mp4Out,
]);
console.log('mp4:', mp4Out);

// Sample 5 evenly-spaced frames across the final trim window for QA.
const N_FRAMES = 5;
for (let i = 0; i < N_FRAMES; i++) {
  // Bias: skip 5% at each end so we don't land on a fade-in/fade-out edge.
  const t = TRIM_START + TRIM_SECONDS * (0.08 + (0.84 * i) / (N_FRAMES - 1));
  const framePath = path.join(
    OUT_DIR, `clip-frame-${String(i + 1).padStart(2, '0')}.png`,
  );
  runFfmpeg([
    '-y',
    '-ss', String(t.toFixed(3)),
    '-i', rawWebm,
    '-frames:v', '1',
    '-update', '1',
    '-vf', 'scale=1080:1080:flags=lanczos',
    framePath,
  ]);
  console.log('frame:', framePath);
}
