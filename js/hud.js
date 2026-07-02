// DOM HUD: score, level ring, size label, combo indicator, biome toast,
// start/pause overlays, best-run persistence. No game rules here.

import { levelProgress, sizeLabel } from './hole.js';
import { biomeDisplayName } from './catalog.js';

const BEST_KEY = 'holefoods.best';

export function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBest(hole) {
  const prev = loadBest();
  if (prev && prev.score >= hole.score) return;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({
      score: hole.score,
      size: sizeLabel(hole.r),
      level: hole.level,
    }));
  } catch { /* ignore */ }
}

function el(id) {
  return document.getElementById(id);
}

function repop(node, cls = 'pop') {
  node.classList.remove(cls);
  void node.offsetWidth; // restart the CSS animation
  node.classList.add(cls);
}

export function createHud() {
  const refs = {
    hud: el('hud'),
    score: el('score'),
    levelBadge: el('level-badge'),
    levelFill: el('level-fill'),
    sizeLabel: el('size-label'),
    combo: el('combo'),
    toast: el('toast'),
    start: el('start'),
    pause: el('pause'),
    bestLine: el('best-line'),
    btnSound: el('btn-sound'),
    btnMute: el('btn-mute'),
  };

  const hud = {
    refs,
    displayScore: 0,
    shownBand: null,
    toastTimer: null,

    update(dt, hole) {
      hud.displayScore += (hole.score - hud.displayScore) * Math.min(1, 14 * dt);
      if (hole.score - hud.displayScore < 1) hud.displayScore = hole.score;
      refs.score.textContent = Math.round(hud.displayScore).toLocaleString();
      refs.levelBadge.textContent = hole.level;
      refs.levelFill.style.width = `${(levelProgress(hole.r) * 100).toFixed(1)}%`;
      refs.sizeLabel.textContent = sizeLabel(hole.r);
    },

    handleEvents(events) {
      for (const ev of events) {
        if (ev.type === 'combo') {
          refs.combo.textContent = `×${ev.mult}`;
          refs.combo.classList.remove('hidden');
          repop(refs.combo);
        } else if (ev.type === 'comboEnd') {
          refs.combo.classList.add('hidden');
        } else if (ev.type === 'levelup') {
          repop(refs.levelBadge);
        }
      }
    },

    setBand(band) {
      if (band === hud.shownBand) return;
      const isFirst = hud.shownBand === null;
      hud.shownBand = band;
      if (isFirst) return; // no toast for the spawn biome
      refs.toast.textContent = biomeDisplayName(band);
      refs.toast.classList.remove('hidden');
      repop(refs.toast, 'slide');
      clearTimeout(hud.toastTimer);
      hud.toastTimer = setTimeout(() => refs.toast.classList.add('hidden'), 2600);
    },

    showStart() {
      const best = loadBest();
      refs.bestLine.textContent = best
        ? `Best run: ${best.score.toLocaleString()} pts · ${best.size} wide · Lv ${best.level}`
        : 'Eat everything. Grow forever.';
      refs.start.classList.remove('hidden');
      refs.hud.classList.add('hidden');
    },
    hideStart() {
      refs.start.classList.add('hidden');
      refs.hud.classList.remove('hidden');
    },
    showPause() { refs.pause.classList.remove('hidden'); },
    hidePause() { refs.pause.classList.add('hidden'); },

    syncMute(muted) {
      refs.btnMute.textContent = muted ? '🔇' : '🔊';
      refs.btnSound.textContent = muted ? '🔇 Sound: off' : '🔊 Sound: on';
    },
  };

  return hud;
}
