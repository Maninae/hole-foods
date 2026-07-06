// Record a 14-unit tower avalanche as a .webm for the coordinator.
// Uses Playwright's recordVideo mode: video is finalized on context close,
// so we grab the final path via video().path() afterward.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2] ?? '/tmp/tower-shots';
fs.mkdirSync(outDir, { recursive: true });

const URL = 'http://127.0.0.1:8148/?seed=avalanche-vid';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  recordVideo: { dir: outDir, size: { width: 1200, height: 900 } },
});
try {
  const page = await context.newPage();
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.evaluate(() => {
    document.getElementById('start').style.display = 'none';
    document.getElementById('btn-pause').click();
    document.getElementById('pause').style.display = 'none';
    const g = window.__game;
    const world = g.world;
    world.chunks.clear();
    world.eaten.clear();
    const objects = [];
    const H = 14;
    const unitR = 30;
    for (let k = 0; k < H; k++) {
      objects.push({
        id: `0:0,0:t${k}`, idx: k, ck: '0:0,0',
        x: 0, y: 0, r: unitR,
        e: '🍩', hue: 34, up: false, rot: 0,
        points: 1n,
        state: k === 0 ? 'idle' : 'stacked',
        vx: 0, vy: 0, tilt: 0,
        stackId: 'VID', stackIdx: k,
      });
    }
    world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects, decals: [] });
    g.hole.r = unitR * 2;
    g.hole.potential = 0;
    g.hole.level = 10;
    g.hole.x = -unitR * 0.9; g.hole.y = 0;
    g.cam.x = 100; g.cam.y = 100;
    g.cam.zoom = 1.3;
  });

  // Show a brief tower-idle beat before triggering the collapse: pin cam
  // for ~0.8s while still paused (rendering continues), then unpause.
  const pin = () => page.evaluate(() => {
    const g = window.__game;
    g.cam.x = 100; g.cam.y = 100;
    g.cam.zoom = 1.3;
  });

  for (let i = 0; i < 30; i++) { await pin(); await page.waitForTimeout(16); }
  // Unpause — base tips, avalanche begins.
  await page.evaluate(() => {
    document.getElementById('btn-resume').click();
    document.getElementById('pause').style.display = 'none';
  });
  // Let the entire collapse + settle play out (~4s), pinning cam every frame.
  for (let i = 0; i < 240; i++) { await pin(); await page.waitForTimeout(16); }
  // Small settle beat.
  for (let i = 0; i < 60; i++) { await pin(); await page.waitForTimeout(16); }

  const video = page.video();
  await page.close();
  await context.close();
  const src = await video.path();
  const dst = path.join(outDir, 'avalanche.webm');
  fs.copyFileSync(src, dst);
  console.log('video:', dst);
} finally {
  await browser.close();
}
