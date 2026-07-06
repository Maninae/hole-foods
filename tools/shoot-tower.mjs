// Screenshot the current tower rendering: a still tower next to a ground
// line of the same emoji. The comparison MUST be unambiguous at a glance.
//
// We stage in-browser by mutating window.__game state directly. The seeded
// URL boots a normal run, we swap in a fabricated world with one tall
// tower next to a line of ground copies of the same emoji, then screenshot.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '/tmp/tower-shots';
fs.mkdirSync(outDir, { recursive: true });

const URL = 'http://127.0.0.1:8148/?seed=towershot';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  // Pause the sim so ensureChunksAround / updateCamera stop overwriting our
  // staged world. Rendering still runs. We flip a private var to leave the
  // frame loop in a state where it only renders — cleanest way to freeze.
  await page.evaluate(() => {
    // Force paused mode via the HUD button so main.js's frame() skips update.
    document.getElementById('btn-pause').click();
    // Hide the pause overlay so it doesn't cover the screenshot.
    document.getElementById('pause').style.display = 'none';
    document.getElementById('start').style.display = 'none';
  });

  // Stage a comparison: one tower at (+300, 0), one ground line of the same
  // emoji at (-500..-50, 0). Pause the sim so ensureChunksAround/camera
  // stop overwriting the fabricated state.
  await page.evaluate(() => {
    const g = window.__game;
    const world = g.world;
    world.chunks.clear();
    world.eaten.clear();
    const objects = [];
    const H = 10;
    const unitR = 40;
    const emoji = '🍩';
    // Tower: base at (250, 250)
    for (let k = 0; k < H; k++) {
      objects.push({
        id: `0:0,0:t${k}`, idx: k, ck: '0:0,0',
        x: 250, y: 250, r: unitR,
        e: emoji, hue: 34, up: false, rot: 0,
        points: 1n,
        state: k === 0 ? 'idle' : 'stacked',
        vx: 0, vy: 0, tilt: 0,
        stackId: 'DEMO', stackIdx: k,
      });
    }
    // Ground line: y = 250, from x = -350..+50 stepping by 2*unitR
    for (let i = 0; i < H; i++) {
      const idx = 100 + i;
      objects.push({
        id: `0:0,0:g${i}`, idx, ck: '0:0,0',
        x: -350 + i * 2 * unitR, y: 250, r: unitR,
        e: emoji, hue: 34, up: false, rot: 0,
        points: 1n,
        state: 'idle',
        vx: 0, vy: 0, tilt: 0,
      });
    }
    world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects, decals: [] });
    g.hole.x = 0; g.hole.y = -2000;
    g.cam.x = 0; g.cam.y = 200;
    g.cam.zoom = 1.05;
  });

  // Frame runs once more after we tick — patch cam every tick by hooking rAF.
  // Simpler: keep re-writing cam via page.evaluate in a loop, then snapshot.
  const snap = async (name, delayMs) => {
    const end = Date.now() + delayMs;
    while (Date.now() < end) {
      await page.evaluate(() => {
        const g = window.__game;
        g.hole.x = 0; g.hole.y = -2000;
        g.cam.x = 0; g.cam.y = 200;
        g.cam.zoom = 1.05;
      });
      await page.waitForTimeout(30);
    }
    const shot = path.join(outDir, name);
    await page.screenshot({ path: shot });
    console.log('wrote', shot);
  };

  await snap('compare-tower-vs-line.png', 400);
  await snap('compare-tower-vs-line-later.png', 1600);

  if (errs.length) {
    console.error('errors during shoot:', errs);
    process.exit(1);
  }
} finally {
  await browser.close();
}
