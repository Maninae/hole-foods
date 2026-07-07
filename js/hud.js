// DOM HUD: score, level ring, size label, combo indicator, biome toast,
// start/pause overlays, best-run persistence. No game rules here.

import { holeProgress, sizeLabel } from './hole.js';

import { fmtNum } from './format.js';

// Re-export so existing importers (main.js, tests) keep working; the
// implementation lives in format.js alongside fmtShort for floaters.
export { fmtNum, fmtShort } from './format.js';

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
  // Score is BigInt; JSON serializes as a string. `BigInt(prev.score)` handles
  // both the string form we write here and any legacy Number-form stored best.
  if (prev && BigInt(prev.score) >= hole.score) return;
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({
      score: String(hole.score),
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
      // displayScore is a Number approximation used only for the score-ticker
      // easing animation — precision loss is display-only. Past 1e15 the ease
      // stops meaning anything visually (float steps get huge), so we snap.
      const targetN = Number(hole.score);
      if (targetN > 1e15) {
        hud.displayScore = targetN;
      } else {
        hud.displayScore += (targetN - hud.displayScore) * Math.min(1, 14 * dt);
        if (targetN - hud.displayScore < 1) hud.displayScore = targetN;
      }
      refs.score.textContent = fmtNum(hud.displayScore);
      refs.levelBadge.textContent = hole.level;
      refs.levelFill.style.width = `${(holeProgress(hole) * 100).toFixed(1)}%`;
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

    // Persistent region label under the score (owner request): always shows
    // the current area, popping on change. Keyed on the theme CELL (band +
    // theme), not just the band — the patchwork means walking sideways can
    // change areas too.
    setArea(key, name) {
      if (key === hud.shownBand) return;
      hud.shownBand = key;
      refs.toast.textContent = name;
      refs.toast.classList.remove('hidden');
      repop(refs.toast, 'slide');
    },

    showStart() {
      const best = loadBest();
      refs.bestLine.textContent = best
        ? `Best run: ${fmtNum(BigInt(best.score))} pts · ${best.size} wide · Lv ${best.level}`
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
