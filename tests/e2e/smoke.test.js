// End-to-end smoke: boots a static server, drives the real game in Chromium.
// Desktop covers the full play loop (steer -> swallow -> grow); mobile covers
// boot, layout overflow, and the start flow.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 8143;
const URL = `http://localhost:${PORT}/?seed=e2e`;

let server;
let browser;

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server never came up');
}

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: ROOT, stdio: 'ignore',
  });
  await waitForServer(`http://localhost:${PORT}/index.html`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.kill();
});

function collectErrors(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });
  return errs;
}

test('desktop: boots clean, plays, swallows, grows', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const errs = collectErrors(page);
  await page.goto(URL);
  await page.waitForLoadState('networkidle');

  // Start screen is up; game is in menu mode.
  assert.equal(await page.evaluate(() => window.__game.mode), 'menu');
  await page.click('#btn-play');
  assert.equal(await page.evaluate(() => window.__game.mode), 'playing');
  const r0 = await page.evaluate(() => window.__game.hole.r);

  // Steer with real mouse moves toward the nearest edible object until fed.
  const deadline = Date.now() + 25000;
  let score = 0;
  while (Date.now() < deadline) {
    const target = await page.evaluate(() => {
      const g = window.__game;
      const { hole } = g;
      let best = null;
      let bestD = Infinity;
      for (const chunk of g.world.chunks.values()) {
        for (const o of chunk.objects) {
          if (o.state !== 'idle' || o.r > hole.r * g.CONFIG.FIT_FACTOR) continue;
          const d = Math.hypot(o.x - hole.x, o.y - hole.y);
          if (d < bestD) { bestD = d; best = { x: o.x, y: o.y }; }
        }
      }
      if (!best) return null;
      const s = g.worldToScreen(best.x, best.y);
      return { x: s.x, y: s.y, score: hole.score };
    });
    assert.ok(target, 'no edible object found anywhere');
    score = target.score;
    if (score > 0) break;
    await page.mouse.move(
      Math.min(1430, Math.max(10, target.x)),
      Math.min(890, Math.max(10, target.y)),
    );
    await page.waitForTimeout(120);
  }
  assert.ok(score > 0, 'never swallowed anything within 25s');

  const after1 = await page.evaluate(() => ({
    r: window.__game.hole.r,
    eaten: window.__game.hole.eatenCount,
  }));
  assert.ok(after1.r > r0, `hole did not grow: ${after1.r} <= ${r0}`);
  assert.ok(after1.eaten >= 1);

  // Pause via keyboard, resume via button.
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.__game.mode), 'paused');
  await page.click('#btn-resume');
  assert.equal(await page.evaluate(() => window.__game.mode), 'playing');

  assert.deepEqual(errs, [], `page errors:\n${errs.join('\n')}`);
  await page.close();
});

test('mute toggle persists across reload', async () => {
  const page = await browser.newPage();
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.click('#btn-mute');
  assert.equal(await page.evaluate(() => localStorage.getItem('holefoods.muted')), '1');
  await page.reload();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.textContent('#btn-mute'), '🔇');
  await page.evaluate(() => localStorage.removeItem('holefoods.muted'));
  await page.close();
});

test('best run is recorded after pausing', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  // Cheat a little: feed the engine directly (still exercises persistence).
  await page.evaluate(() => { window.__game.hole.score = 4321; });
  await page.keyboard.press('KeyP');
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('holefoods.best')));
  assert.equal(best.score, 4321);
  await page.close();
});

test('mobile (iPhone 13): boots clean, no horizontal overflow, play starts', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errs = collectErrors(page);
  await page.goto(URL);
  await page.waitForLoadState('networkidle');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(overflow <= 1, `horizontal overflow: ${overflow}px`);

  await page.tap('#btn-play');
  assert.equal(await page.evaluate(() => window.__game.mode), 'playing');
  const hudVisible = await page.evaluate(
    () => !document.getElementById('hud').classList.contains('hidden'),
  );
  assert.ok(hudVisible, 'HUD not shown after play');

  assert.deepEqual(errs, [], `page errors:\n${errs.join('\n')}`);
  await ctx.close();
});
