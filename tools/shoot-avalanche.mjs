// Capture an avalanche collapse across four moments:
//   pre-lean  →  first detaches  →  mid-air chaos  →  settled mound
//
// Stages a 14-unit tower centered over the hole in the paused game, unpauses
// so rim physics can tip the base + kick off the avalanche, and snaps at
// four rAF-timed moments. Also captures a mobile viewport variant so the
// mid-air moment can be judged on iPhone 13 too.

import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '/tmp/tower-shots';
fs.mkdirSync(outDir, { recursive: true });

const URL = 'http://127.0.0.1:8148/?seed=avalanche';

async function stageAndShoot(page, prefix) {
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.evaluate(() => {
    document.getElementById('start').style.display = 'none';
    // Pause first so we can stage without ensureChunksAround stomping us.
    document.getElementById('btn-pause').click();
    document.getElementById('pause').style.display = 'none';
    const g = window.__game;
    const world = g.world;
    world.chunks.clear();
    world.eaten.clear();
    const objects = [];
    const H = 14;
    const unitR = 30;
    const emoji = '🍩';
    for (let k = 0; k < H; k++) {
      objects.push({
        id: `0:0,0:t${k}`, idx: k, ck: '0:0,0',
        x: 0, y: 0, r: unitR,
        e: emoji, hue: 34, up: false, rot: 0,
        points: 1n,
        state: k === 0 ? 'idle' : 'stacked',
        vx: 0, vy: 0, tilt: 0,
        stackId: 'DEMO', stackIdx: k,
      });
    }
    world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects, decals: [] });

    // Pump hole so the base is edible; position it so the tower topples
    // toward +x. Camera zoomed to fit the avalanche.
    g.hole.r = unitR * 2;
    g.hole.potential = 0;
    g.hole.level = 10;
    g.hole.x = -unitR * 0.9; g.hole.y = 0;
    g.cam.x = 100; g.cam.y = 100;
    g.cam.zoom = 1.4;
  });

  // Unpause so the sim ticks; the base immediately loses support and tips.
  await page.evaluate(() => {
    document.getElementById('btn-resume').click();
    document.getElementById('pause').style.display = 'none';
    document.getElementById('start').style.display = 'none';
  });

  // Camera-pinning hook so updateCamera doesn't chase the hole/tower off-screen.
  const pin = async () => {
    await page.evaluate(() => {
      const g = window.__game;
      g.cam.x = 100; g.cam.y = 100;
      g.cam.zoom = 1.4;
    });
  };

  const holdAndShoot = async (name, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await pin();
      await page.waitForTimeout(16);
    }
    const shot = path.join(outDir, name);
    await page.screenshot({ path: shot });
    console.log('wrote', shot);
  };

  // Timeline (roughly): rim physics tips the base immediately on unpause,
  // and the avalanche starts on that same tick. Pre-lean lasts 0.15s;
  // detaches stagger 45ms bottom-up; airborne flight ~0.5-0.9s per unit.
  await holdAndShoot(`${prefix}-01-pre-lean.png`, 150);       // Jenga losing-balance beat
  await holdAndShoot(`${prefix}-02-first-detaches.png`, 250); // first few units airborne
  await holdAndShoot(`${prefix}-03-midair-chaos.png`, 500);   // mid-air (multiple units in flight)
  await holdAndShoot(`${prefix}-04-settled-mound.png`, 3000); // fully settled

  return prefix;
}

const browser = await chromium.launch();
try {
  // Desktop
  {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
    await stageAndShoot(page, 'desktop');
    if (errs.length) console.error('desktop errors:', errs);
  }
  // Mobile — iPhone 13, primarily to judge readability of the mid-air moment.
  {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
    await stageAndShoot(page, 'mobile');
    if (errs.length) console.error('mobile errors:', errs);
  }
} finally {
  await browser.close();
}
