// Bootstrap + game loop + event wiring. No game rules live here.

import { CONFIG } from './config.js';
import { createWorld, ensureChunksAround, bandAt } from './world.js';
import { createHole, updateHole } from './hole.js';
import { createSwallow, swallowUpdate } from './swallow.js';
import { createCamera, updateCamera, shake, worldToScreen } from './camera.js';
import { createRenderer, renderScene } from './render.js';
import { createFx, updateFx, suckBurst, floatText } from './particles.js';
import {
  createLevelFx, spawnLevelUp, updateLevelFx, intensityForLevel, isMilestone,
} from './levelfx.js';
import { createInput } from './input.js';
import { createHud, saveBest } from './hud.js';
import { themeAt, themeDisplayName } from './catalog.js';
import { fmtShort } from './format.js';
import * as audio from './audio.js';

const canvas = document.getElementById('game');
const R = createRenderer(canvas);
const input = createInput(canvas);
const hud = createHud();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = new URLSearchParams(location.search);
const pinnedSeed = params.get('seed');

function freshSeed() {
  return pinnedSeed
    ?? `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const game = {
  mode: 'menu', // menu | playing | paused
  world: null,
  hole: null,
  sw: null,
  fx: null,
  levelFx: null,
  cam: createCamera(),
  time: 0,
};

function newRun() {
  game.world = createWorld(freshSeed());
  game.hole = createHole();
  game.sw = createSwallow();
  game.fx = createFx();
  game.levelFx = createLevelFx();
  game.cam = createCamera();
  hud.shownBand = null;
  hud.displayScore = 0;
}
newRun();

function handleEvents(events) {
  const { hole, fx, cam } = game;
  for (const ev of events) {
    if (ev.type === 'swallow') {
      // Effects budget: past ~200 live particles, skip new bursts entirely.
      if (fx.parts.length < 200) {
        const n = Math.round(Math.min(18, 6 + (ev.r / hole.r) * 14));
        suckBurst(fx, Math.random, hole.x, hole.y, hole.r * 0.95, ev.hue, n);
      }
      // Cap point floaters so combo frenzies don't wall the screen with text.
      if (fx.floats.length < 7 || ev.big) {
        const jx = (Math.random() - 0.5) * hole.r * 1.6; // spread stacked floaters
        floatText(fx, hole.x + jx, hole.y - hole.r * 1.4, `+${fmtShort(ev.points)}`, {
          size: hole.r * 0.5,
          hue: ev.mult > 1 ? 43 : 0,
          sat: ev.mult > 1 ? 95 : 0,
          up: hole.r * 1.1,
        });
      }
      if (ev.big) {
        audio.gulp();
        if (!reducedMotion) shake(cam, Math.min(hole.r * 0.3, ev.r * 0.22));
      } else {
        audio.pop(ev.r / hole.r);
      }
    } else if (ev.type === 'combo') {
      audio.comboTick(ev.mult);
    } else if (ev.type === 'levelup') {
      audio.levelUp(intensityForLevel(ev.level), { milestone: isMilestone(ev.level) });
      spawnLevelUp(game.levelFx, ev.level, hole, { reducedMotion });
      if (!reducedMotion) shake(cam, Math.min(hole.r * 0.35, 24));
    }
  }
  hud.handleEvents(events);
}

let last = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;

  const { world, hole, sw, fx, cam } = game;

  if (game.mode === 'playing') {
    game.time += dt;
    const dir = input.getDirection(hole, cam, R.w, R.h);
    updateHole(hole, dt, dir);
    // Iso squash makes the visible world taller-narrower on screen: the y
    // extent divides by (zoom * ISO_Y), not just zoom.
    ensureChunksAround(
      world, hole.x, hole.y,
      R.w / cam.zoom, R.h / (cam.zoom * CONFIG.ISO_Y),
    );
    handleEvents(swallowUpdate(sw, dt, game.time, world, hole));
    updateCamera(cam, dt, hole);
    updateFx(fx, dt);
    updateLevelFx(game.levelFx, dt);
    hud.update(dt, hole);
    {
      const band = bandAt(hole.x, hole.y);
      const theme = themeAt(hole.x, hole.y);
      hud.setArea(`${band}|${theme.key}`, themeDisplayName(theme, band));
    }
  } else if (game.mode === 'menu') {
    // Attract mode: drift over the world behind the title.
    game.time += dt;
    cam.x = Math.cos(game.time * 0.07) * 300;
    cam.y = Math.sin(game.time * 0.07) * 300;
    cam.zoom = 0.9;
    ensureChunksAround(
      world, cam.x, cam.y,
      R.w / cam.zoom, R.h / (cam.zoom * CONFIG.ISO_Y),
    );
  }

  renderScene(R, { world, hole, cam, sw, fx, levelFx: game.levelFx, time: game.time });
}
requestAnimationFrame(frame);

// --- UI wiring -------------------------------------------------------------

function startRun() {
  audio.unlockAudio();
  audio.startAmbient();
  audio.uiClick();
  game.mode = 'playing';
  hud.hideStart();
  hud.hidePause();
}

function pauseGame() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  saveBest(game.hole);
  hud.showPause();
}

function resumeGame() {
  game.mode = 'playing';
  hud.hidePause();
  audio.uiClick();
}

input.onPause = () => {
  if (game.mode === 'playing') pauseGame();
  else if (game.mode === 'paused') resumeGame();
};
input.onAnyGesture = () => {
  if (game.mode === 'playing') audio.unlockAudio();
};

document.getElementById('btn-play').addEventListener('click', startRun);
document.getElementById('btn-pause').addEventListener('click', pauseGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);

const btnRestart = document.getElementById('btn-restart');
let restartArmed = false;
btnRestart.addEventListener('click', () => {
  if (!restartArmed) {
    restartArmed = true;
    btnRestart.textContent = 'Really? Tap again';
    setTimeout(() => {
      restartArmed = false;
      btnRestart.textContent = '↺ Restart run';
    }, 2000);
    return;
  }
  saveBest(game.hole);
  newRun();
  restartArmed = false;
  btnRestart.textContent = '↺ Restart run';
  resumeGame();
});

function toggleMute() {
  audio.setMuted(!audio.isMuted());
  hud.syncMute(audio.isMuted());
}
document.getElementById('btn-mute').addEventListener('click', toggleMute);
document.getElementById('btn-sound').addEventListener('click', toggleMute);
hud.syncMute(audio.isMuted());

window.addEventListener('resize', () => R.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});
window.addEventListener('beforeunload', () => saveBest(game.hole));
setInterval(() => {
  if (game.mode === 'playing') saveBest(game.hole);
}, 5000);

hud.showStart();

// Debug/e2e hook: read-only access to live state.
window.__game = {
  CONFIG,
  get mode() { return game.mode; },
  get world() { return game.world; },
  get hole() { return game.hole; },
  get cam() { return game.cam; },
  get sw() { return game.sw; },
  get fx() { return game.fx; },
  get levelFx() { return game.levelFx; },
  worldToScreen(x, y) {
    return worldToScreen(game.cam, R.w, R.h, x, y);
  },
};
