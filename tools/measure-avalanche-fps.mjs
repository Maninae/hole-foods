// Sanity-check headless FPS during a 24-unit avalanche.
// Stages a beacon-scale tower, triggers the collapse, then measures the
// frame rate over the full playout. Reports avg and min FPS.

import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8148/?seed=fps';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');

  // Baseline FPS with a normal running game (no avalanche).
  const measureBaseline = await page.evaluate(async () => {
    const samples = [];
    let prev = performance.now();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      samples.push(now - prev);
      prev = now;
    }
    return samples;
  });
  const baselineFps = 1000 / (measureBaseline.reduce((a, b) => a + b, 0) / measureBaseline.length);

  // Stage the beacon tower + trigger avalanche.
  await page.evaluate(() => {
    document.getElementById('btn-pause').click();
    document.getElementById('pause').style.display = 'none';
    const g = window.__game;
    const world = g.world;
    world.chunks.clear();
    world.eaten.clear();
    const objects = [];
    const H = 24;
    const unitR = 40;
    for (let k = 0; k < H; k++) {
      objects.push({
        id: `0:0,0:t${k}`, idx: k, ck: '0:0,0',
        x: 0, y: 0, r: unitR,
        e: '🍩', hue: 34, up: false, rot: 0,
        points: 1n,
        state: k === 0 ? 'idle' : 'stacked',
        vx: 0, vy: 0, tilt: 0,
        stackId: 'FPS', stackIdx: k,
      });
    }
    world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects, decals: [] });
    g.hole.r = unitR * 2;
    g.hole.potential = 0;
    g.hole.level = 10;
    g.hole.x = -unitR * 0.9; g.hole.y = 0;
    g.cam.x = 200; g.cam.y = 200;
    g.cam.zoom = 0.8;
    document.getElementById('btn-resume').click();
    document.getElementById('pause').style.display = 'none';
  });

  // Measure across the whole avalanche + settle window. Cover ~4 seconds.
  const avalancheSamples = await page.evaluate(async () => {
    const samples = [];
    let prev = performance.now();
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      samples.push(now - prev);
      prev = now;
    }
    return samples;
  });
  const avalancheFps = 1000 / (avalancheSamples.reduce((a, b) => a + b, 0) / avalancheSamples.length);
  const worstFrame = Math.max(...avalancheSamples);
  const minFps = 1000 / worstFrame;

  console.log(`Baseline (normal play):        avg ${baselineFps.toFixed(1)} fps`);
  console.log(`Avalanche (24-unit collapse):  avg ${avalancheFps.toFixed(1)} fps, min ${minFps.toFixed(1)} fps (worst frame ${worstFrame.toFixed(1)}ms)`);
} finally {
  await browser.close();
}
