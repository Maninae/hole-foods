// Reproduce the null-read pageerror and capture its stack.
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8148/?seed=dbg';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.evaluate(() => {
    document.getElementById('start').style.display = 'none';
    document.getElementById('btn-pause').click();
    document.getElementById('pause').style.display = 'none';
    const g = window.__game;
    g.world.chunks.clear();
    g.world.eaten.clear();
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
        stackId: 'DEMO', stackIdx: k,
      });
    }
    g.world.chunks.set('0:0,0', { level: 0, cx: 0, cy: 0, band: 0, objects, decals: [] });
    g.hole.r = unitR * 2;
    g.hole.potential = 0;
    g.hole.level = 10;
    g.hole.x = -unitR * 0.9; g.hole.y = 0;
    g.cam.x = 100; g.cam.y = 100;
    g.cam.zoom = 1.4;
    document.getElementById('btn-resume').click();
    document.getElementById('pause').style.display = 'none';
  });
  await page.waitForTimeout(1500);
  console.log('errors:');
  console.log(errs.slice(0, 2).join('\n---\n'));
} finally {
  await browser.close();
}
