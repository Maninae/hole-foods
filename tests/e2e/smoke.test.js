// End-to-end smoke: boots a static server, drives the real game in Chromium.
// Desktop covers the full play loop (steer -> swallow -> grow); mobile covers
// boot, layout overflow, and the start flow.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../../js/catalog.js';
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

  // Steer with the arrow keys toward the nearest edible object until fed:
  // recompute the world-space direction each tick and hold whichever axes
  // dominate (two keys = diagonal). Release everything at the end so the
  // pause step and later tests start from a clean keyboard.
  const held = new Set();
  const setHeld = async (want) => {
    for (const k of held) {
      if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    }
    for (const k of want) {
      if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
    }
  };
  const releaseAll = async () => {
    for (const k of held) await page.keyboard.up(k);
    held.clear();
  };

  const deadline = Date.now() + 25000;
  let score = '0'; // BigInt lives page-side; we carry it out as a decimal string
  try {
    while (Date.now() < deadline) {
      const info = await page.evaluate(() => {
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
        // Score is BigInt in the page context; stringify to cross page.evaluate.
        return {
          hx: hole.x, hy: hole.y,
          tx: best.x, ty: best.y,
          score: String(hole.score),
        };
      });
      assert.ok(info, 'no edible object found anywhere');
      score = info.score;
      if (BigInt(score) > 0n) break;

      const dx = info.tx - info.hx;
      const dy = info.ty - info.hy;
      const mag = Math.hypot(dx, dy) || 1;
      const nx = dx / mag;
      const ny = dy / mag;
      const want = new Set();
      // Threshold ~cos(70°): axes within ~20° of pure diagonal press both keys.
      if (nx > 0.35) want.add('ArrowRight');
      else if (nx < -0.35) want.add('ArrowLeft');
      if (ny > 0.35) want.add('ArrowDown');
      else if (ny < -0.35) want.add('ArrowUp');
      // Fallback: near-axis targets still need at least one key held.
      if (want.size === 0) {
        if (Math.abs(nx) >= Math.abs(ny)) want.add(nx >= 0 ? 'ArrowRight' : 'ArrowLeft');
        else want.add(ny >= 0 ? 'ArrowDown' : 'ArrowUp');
      }
      await setHeld(want);
      await page.waitForTimeout(120);
    }
  } finally {
    await releaseAll();
  }
  assert.ok(BigInt(score) > 0n, 'never swallowed anything within 25s');

  const after1 = await page.evaluate(() => ({
    potential: window.__game.hole.potential,
    eaten: window.__game.hole.eatenCount,
  }));
  assert.ok(after1.potential > r0, `potential did not grow: ${after1.potential} <= ${r0}`);
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
  // Score is BigInt end-to-end and JSON-serializes as a decimal string.
  await page.evaluate(() => { window.__game.hole.score = 4321n; });
  await page.keyboard.press('KeyP');
  const best = await page.evaluate(() => JSON.parse(localStorage.getItem('holefoods.best')));
  assert.equal(best.score, '4321');
  await page.close();
});

test('Cmd+Tab does not leave a movement key stuck', async () => {
  // Regression for a macOS bug: hold ArrowDown, Cmd+Tab away, come back --
  // the hole would keep moving because Meta swallows the keyup and (depending
  // on ordering) the blur/visibilitychange clears wouldn't stick. We simulate
  // the exact event sequence a real Cmd+Tab produces.
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.waitForTimeout(100);

  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(200); // let the hole reach real speed
  const vyHeld = await page.evaluate(() => window.__game.hole.vy);
  assert.ok(vyHeld > 50, `expected clear downward motion while held, got vy=${vyHeld}`);

  // Cmd+Tab: browser sees Meta keydown, then loses focus, then regains it.
  // Playwright would emit a synthetic keyup for ArrowDown if we called
  // keyboard.up -- real macOS does not, because Meta swallows it. So we
  // never emit that keyup; the fix must clear the Set itself.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'MetaLeft', key: 'Meta', metaKey: true, bubbles: true,
    }));
    window.dispatchEvent(new Event('blur'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => ({
    vy: window.__game.hole.vy,
    mode: window.__game.mode,
  }));
  assert.equal(after.mode, 'playing');
  assert.ok(
    Math.abs(after.vy) < 5,
    `hole still moving after Cmd+Tab return: vy=${after.vy}`,
  );
  await page.close();
});

test('collection overlay opens from start screen and closes with Escape', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  // Fresh page each test — force no persisted progress so we get the
  // locked-state layout with 0 discovered stickers.
  await page.addInitScript(() => localStorage.removeItem('holefoods.progress'));
  await page.goto(URL);
  await page.waitForLoadState('networkidle');

  // Overlay starts hidden.
  assert.ok(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  ));
  await page.click('#btn-collection-start');
  assert.ok(!(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  )), 'overlay should be visible after clicking Collection');

  // One sticker slot per theme in the pool.
  const stickers = await page.evaluate(
    () => document.querySelectorAll('#sticker-grid .sticker').length,
  );
  assert.equal(stickers, THEMES.length);

  // Escape closes the overlay without triggering pause (game is in menu mode
  // anyway, so we assert mode stays 'menu' and overlay is hidden).
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  ));
  assert.equal(await page.evaluate(() => window.__game.mode), 'menu');
  await page.close();
});

test('P while the collection overlay is open closes it without resuming play', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.keyboard.press('KeyP');
  assert.equal(await page.evaluate(() => window.__game.mode), 'paused');

  await page.click('#btn-collection-pause');
  assert.ok(!(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  )), 'overlay should be visible after clicking Collection on pause screen');

  // P is the pause toggle; with the modal up it must close the modal and
  // leave the game paused — never resume play underneath the overlay.
  await page.keyboard.press('KeyP');
  assert.ok(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  ), 'overlay should close on P');
  assert.equal(await page.evaluate(() => window.__game.mode), 'paused');
  await page.close();
});

test('HUD 🗺️ button opens the collection over live play and closes back to playing', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  assert.equal(await page.evaluate(() => window.__game.mode), 'playing');

  // The HUD button lives in the top-right cluster next to mute/pause and
  // is visible during play only.
  const mapBtn = page.locator('#btn-map');
  assert.ok(await mapBtn.isVisible(), 'map button should be visible during play');
  await mapBtn.click();

  // Overlay is up; sim is paused; the pause panel stays hidden (the map
  // overlay is the modal).
  assert.equal(await page.evaluate(() => window.__game.mode), 'paused');
  assert.ok(!(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  )), 'collection should be visible after tapping the HUD map button');
  assert.ok(await page.evaluate(
    () => document.getElementById('pause').classList.contains('hidden'),
  ), 'pause panel must stay hidden when opened via the HUD map button');

  // Escape closes and returns to playing (auto-resume).
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(
    () => document.getElementById('collection').classList.contains('hidden'),
  ), 'collection should hide on Escape');
  assert.equal(await page.evaluate(() => window.__game.mode), 'playing');
  await page.close();
});

test('map renders every achievement node with an edge count that matches the graph', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  // Fresh save so most nodes are locked; the DOM count is what we care about.
  await page.addInitScript(() => localStorage.removeItem('holefoods.progress'));
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-collection-start');

  const counts = await page.evaluate(() => ({
    nodes: document.querySelectorAll('#achievement-map .map-node').length,
    edges: document.querySelectorAll('#achievement-map .map-edge').length,
    stickers: document.querySelectorAll('#sticker-grid .sticker').length,
  }));
  assert.ok(counts.nodes >= 25, `expected at least 25 map nodes, got ${counts.nodes}`);
  assert.ok(counts.edges >= 20, `expected at least 20 edges, got ${counts.edges}`);
  assert.equal(counts.stickers, THEMES.length);
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

test('mobile: virtual joystick shows in play, steers the hole, hides on pause', async () => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.waitForLoadState('networkidle');

  // Start screen: joystick is hidden even on a touch device.
  assert.ok(await page.evaluate(
    () => document.getElementById('joystick').classList.contains('hidden'),
  ), 'joystick should be hidden on the start screen');

  await page.tap('#btn-play');
  await page.waitForTimeout(150);

  assert.ok(!(await page.evaluate(
    () => document.getElementById('joystick').classList.contains('hidden'),
  )), 'joystick should be visible during play on a touch device');

  // Grab ring geometry, drag knob to the right rim, hold. Use pointer events
  // (touch pointer type) since Playwright's touchscreen API is tap-only and
  // we need a sustained drag on the knob element.
  const geom = await page.evaluate(() => {
    const ring = document.querySelector('#joystick .joystick-ring');
    const r = ring.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
  });
  const startX = await page.evaluate(() => window.__game.hole.x);
  const targetX = geom.cx + geom.r * 0.95;

  // Drive the knob with pointer events. hasTouch context means Chromium
  // treats these as touch pointers; the joystick's pointerdown/move path
  // is what a real finger would trigger.
  await page.evaluate(async ([cx, cy, tx]) => {
    const el = document.getElementById('joystick');
    const send = (type, x, y) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0,
    }));
    send('pointerdown', cx, cy);
    for (let i = 1; i <= 8; i++) {
      const x = cx + (tx - cx) * (i / 8);
      send('pointermove', x, cy);
      await new Promise((r) => setTimeout(r, 30));
    }
    // Hold at the right rim so the hole picks up sustained velocity.
    for (let i = 0; i < 12; i++) {
      send('pointermove', tx, cy);
      await new Promise((r) => setTimeout(r, 60));
    }
  }, [geom.cx, geom.cy, targetX]);

  const held = await page.evaluate(() => ({
    x: window.__game.hole.x,
    vx: window.__game.hole.vx,
    active: document.getElementById('joystick').classList.contains('joystick-active'),
  }));
  assert.ok(held.active, 'joystick should read as active while a finger is on the knob');
  assert.ok(held.vx > 30, `expected rightward velocity, got vx=${held.vx}`);
  assert.ok(held.x - startX > 5, `hole should have moved right: ${held.x} vs ${startX}`);

  // Release: knob snaps home, active class drops. Whether the hole comes to
  // a full stop depends on ease/friction, so we only assert the joystick
  // gave up its grip (steering vector goes zero).
  await page.evaluate(() => {
    const el = document.getElementById('joystick');
    el.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: 0, clientY: 0, bubbles: true, cancelable: true, button: 0,
    }));
  });
  await page.waitForTimeout(100);
  assert.ok(!(await page.evaluate(
    () => document.getElementById('joystick').classList.contains('joystick-active'),
  )), 'joystick should not be active after release');

  // Pause via keyboard: joystick hides.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80);
  assert.ok(await page.evaluate(
    () => document.getElementById('joystick').classList.contains('hidden'),
  ), 'joystick should hide when the game pauses');

  await ctx.close();
});

test('desktop: virtual joystick stays hidden (no coarse pointer, no touch)', async () => {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-play');
  await page.waitForTimeout(150);

  // The joystick must never appear on a desktop pointer:fine viewport.
  const shown = await page.evaluate(() => {
    const j = document.getElementById('joystick');
    if (!j) return false;
    if (j.classList.contains('hidden')) return false;
    const cs = getComputedStyle(j);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  });
  assert.ok(!shown, 'joystick should not be visible on a desktop viewport');

  await page.close();
});
