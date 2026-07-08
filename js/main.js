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
import { createJoystick } from './joystick.js';
import { createHud, saveBest } from './hud.js';
import { themeAt, themeDisplayName, cycleForBand } from './catalog.js';
import { fmtShort } from './format.js';
import * as audio from './audio.js';
import { loadProgress, saveProgress, ingest } from './achievements.js';
import { createCollectionUI } from './collection-ui.js';

const canvas = document.getElementById('game');
const R = createRenderer(canvas);
const joystick = createJoystick({ onAnyGesture: () => audio.unlockAudio() });
const input = createInput(canvas, joystick);
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
  progress: loadProgress(),  // meta-progression — survives newRun() and reload
  shownThemeCycle: null,     // last "theme:cycle" we notified the engine of
  shownCycle: -1,            // last cycle we notified the engine of
  // Set when the HUD 🗺️ button pauses play to open the collection —
  // closing the overlay auto-resumes instead of dropping to the pause panel.
  resumeAfterCollection: false,
};

// Persist meta-progression whenever a new unlock lands (writes are cheap and
// rare) and on pause / unload. Never per-frame.
function saveMeta() { saveProgress(game.progress); }

const collectionUI = createCollectionUI({
  progress: game.progress,
  reducedMotion,
  onPing: () => audio.unlockPing(),
  onClose: () => {
    // Only auto-resume when the overlay was opened over live play via the
    // HUD map button. Opened from start/pause, we drop back into that
    // screen — no mode change needed here.
    if (game.resumeAfterCollection) {
      game.resumeAfterCollection = false;
      game.mode = 'playing';
      audio.uiClick();
    }
    syncJoystick();
  },
});

// Feed a batch of unlock entries: banner + persist. `applyUnlocks` never
// throws; if the UI isn't ready (test/head env), we still save progress.
function applyUnlocks(unlocks) {
  if (unlocks.length === 0) return;
  for (const u of unlocks) collectionUI.showUnlock(u);
  saveMeta();
}

function newRun() {
  game.world = createWorld(freshSeed());
  game.hole = createHole();
  game.sw = createSwallow();
  game.fx = createFx();
  game.levelFx = createLevelFx();
  game.cam = createCamera();
  hud.shownBand = null;
  hud.displayScore = 0;
  // Meta-progression (progress) is intentionally NOT touched here — it's the
  // whole point of the discovery log surviving run restarts.
  game.shownThemeCycle = null;
  game.shownCycle = -1;
}
newRun();

function handleEvents(events) {
  const { hole, fx, cam, sw, progress } = game;
  const unlocks = [];
  // During a tower avalanche the swallow cascade fires many "+points"
  // chips in quick succession — raise the floater cap so the "chip pile"
  // reads as intended instead of getting muted after 7.
  const collapsing = sw && sw.avalanches.length > 0;
  const floaterCap = collapsing ? CONFIG.STACK_TOPPLE_FLOATER_CAP : 7;
  for (const ev of events) {
    if (ev.type === 'swallow') {
      // Effects budget: past ~200 live particles, skip new bursts entirely.
      if (fx.parts.length < 200) {
        const n = Math.round(Math.min(18, 6 + (ev.r / hole.r) * 14));
        suckBurst(fx, Math.random, hole.x, hole.y, hole.r * 0.95, ev.hue, n);
      }
      // Cap point floaters so combo frenzies don't wall the screen with text.
      if (fx.floats.length < floaterCap || ev.big) {
        const jx = (Math.random() - 0.5) * hole.r * 1.6; // spread stacked floaters
        floatText(fx, hole.x + jx, hole.y - hole.r * 1.4, `+${fmtShort(ev.points)}`, {
          size: hole.r * 0.5,
          hue: ev.mult > 1 ? 43 : 0,
          sat: ev.mult > 1 ? 95 : 0,
          up: hole.r * 1.1,
        });
      }
      // No shake on swallows, even big ones: feeding frenzies rumbled the
      // screen constantly and read as overstimulating (owner feedback).
      // Shake is reserved for payoffs: level-ups and tower-topple settles.
      if (ev.big) {
        audio.gulp();
      } else {
        audio.pop(ev.r / hole.r);
      }
      // Achievements: first-building + running eaten-count milestones.
      unlocks.push(...ingest(progress, { type: 'swallow', emoji: ev.e }));
      unlocks.push(...ingest(progress, { type: 'eaten', count: hole.eatenCount }));
    } else if (ev.type === 'combo') {
      audio.comboTick(ev.mult);
      unlocks.push(...ingest(progress, { type: 'combo', mult: ev.mult }));
    } else if (ev.type === 'levelup') {
      audio.levelUp(intensityForLevel(ev.level), { milestone: isMilestone(ev.level) });
      spawnLevelUp(game.levelFx, ev.level, hole, { reducedMotion });
      if (!reducedMotion) shake(cam, Math.min(hole.r * 0.35, 24));
      // Radius milestones are cheapest to check on level-up (hole.r only
      // changes then), so we ingest the current radius here.
      unlocks.push(...ingest(progress, { type: 'radius', r: hole.r }));
    } else if (ev.type === 'avalancheDust') {
      // Throttled dust puff on bounce clusters (see js/collapse.js).
      if (fx.parts.length < 220) {
        const n = 6;
        suckBurst(fx, Math.random, ev.x, ev.y, ev.unitR * 1.6, 30, n);
      }
    } else if (ev.type === 'avalancheThump') {
      // Throttled soft thump — subtler than the old one-shot topple sfx.
      audio.pop(0.6);
    } else if (ev.type === 'topple') {
      // Fired once when an avalanche fully settles — big chunky thump and
      // a screen shake to reward the payoff moment.
      audio.topple();
      if (fx.parts.length < 220) {
        const n = 22;
        suckBurst(fx, Math.random, ev.x, ev.y, ev.unitR * 2.6, 30, n);
      }
      if (!reducedMotion) shake(cam, Math.min(hole.r * 0.28, ev.unitR * 0.9));
      // Achievements: only tall-path avalanches (>= STACK_TOPPLE_MIN units)
      // count as topples for the DEMOLITION branch. Slump avalanches still
      // emit the event for fx/audio; they just don't bump the counter.
      // For formations, only the FIRST column's topple carries
      // achievement=true, so a chained skyscraper is one topple, not four.
      if (ev.achievement !== false
          && typeof ev.unitCount === 'number'
          && ev.unitCount >= CONFIG.STACK_TOPPLE_MIN) {
        unlocks.push(...ingest(progress, {
          type: 'topple', unitCount: ev.unitCount,
        }));
      }
    }
  }
  hud.handleEvents(events);
  applyUnlocks(unlocks);
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
      const cycle = cycleForBand(band);
      hud.setArea(`${band}|${theme.key}`, themeDisplayName(theme, band));
      // Achievements: re-emit themeVisit whenever EITHER the theme OR the
      // cycle changes — the engine records the (theme, cycle) pair, and
      // the HOMECOMING branch reacts to meadow at higher cycles even when
      // the raw theme key hasn't changed.
      const themeCycleKey = `${theme.key}:${cycle}`;
      if (themeCycleKey !== game.shownThemeCycle) {
        game.shownThemeCycle = themeCycleKey;
        applyUnlocks(ingest(game.progress, {
          type: 'themeVisit', key: theme.key, cycle,
        }));
      }
      if (cycle !== game.shownCycle) {
        game.shownCycle = cycle;
        applyUnlocks(ingest(game.progress, { type: 'cycle', cycle }));
      }
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

// Joystick visibility follows live-play mode: hidden on start / pause /
// collection overlay, visible during 'playing' on touch devices.
function syncJoystick() {
  joystick.setPlayMode(game.mode === 'playing');
}

function startRun() {
  audio.unlockAudio();
  audio.startAmbient();
  audio.uiClick();
  game.mode = 'playing';
  hud.hideStart();
  hud.hidePause();
  syncJoystick();
}

function pauseGame() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  saveBest(game.hole);
  saveMeta();
  hud.showPause();
  syncJoystick();
}

function resumeGame() {
  game.mode = 'playing';
  hud.hidePause();
  audio.uiClick();
  syncJoystick();
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

// Collection overlay is reachable from three places:
//   - start / pause screens: opening from menu or paused mode leaves the
//     mode alone, and closing drops back into that screen naturally.
//   - HUD 🗺️ button during live play: pause the sim (best-run save
//     included, but WITHOUT showing the pause panel), and set the
//     resume-flag so closing the overlay returns straight to playing.
for (const id of ['btn-collection-start', 'btn-collection-pause']) {
  document.getElementById(id).addEventListener('click', () => {
    audio.uiClick();
    collectionUI.open();
  });
}

document.getElementById('btn-map').addEventListener('click', () => {
  audio.uiClick();
  if (game.mode === 'playing') {
    // Pause without showing the pause panel — the collection overlay is
    // the visible modal instead. Keep best-run + progress writes in sync.
    game.mode = 'paused';
    saveBest(game.hole);
    saveMeta();
    game.resumeAfterCollection = true;
    syncJoystick();
  }
  collectionUI.open();
});

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
window.addEventListener('beforeunload', () => { saveBest(game.hole); saveMeta(); });
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
  get progress() { return game.progress; },
  worldToScreen(x, y) {
    return worldToScreen(game.cam, R.w, R.h, x, y);
  },
  // e2e-only: force an unlock banner to check the queue + ribbon anim.
  __showUnlock(entry) { collectionUI.showUnlock(entry); },
};
