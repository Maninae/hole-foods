// DOM HUD: score, level ring, size label, combo indicator, biome toast,
// start/pause overlays, best-run persistence. No game rules here.

import { levelProgress, sizeLabel } from './hole.js';
import { biomeDisplayName } from './catalog.js';

const BEST_KEY = 'holefoods.best';

// Big scores read as "56.0M", not a 9-digit wall. Accepts Number or BigInt.
// Ladder goes past standard NumberFormat (which caps at Q for quadrillion and
// gets flaky past ~1e21); we walk a suffix table and, past Dc (1e33), fall
// back to mantissa + exponent so any BigInt magnitude renders.
//
// Uses digit-string math throughout so BigInt tier selection is exact — never
// round-trip a huge BigInt through Number to pick its tier.
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

function fmtCompactFromDigits(digits) {
  const tier = Math.floor((digits.length - 1) / 3);
  if (tier >= SUFFIXES.length) {
    // Beyond Dc: mantissa (one decimal) + exponent, e.g. "3.4e38".
    const exp = digits.length - 1;
    const first = digits[0];
    const dec = digits[1] ?? '0';
    return `${first}.${dec}e${exp}`;
  }
  // Within a tier: 1–3 integer digits, then one truncated decimal, then suffix.
  const intLen = digits.length - tier * 3;
  const intPart = digits.slice(0, intLen);
  const decDigit = digits[intLen] ?? '0';
  return `${intPart}.${decDigit}${SUFFIXES[tier]}`;
}

export function fmtNum(n) {
  if (typeof n === 'bigint') {
    // Small enough to safely convert to Number for grouping.
    if (n >= 0n && n < 1000000n) return Number(n).toLocaleString('en-US');
    if (n < 0n && n > -1000000n) return Number(n).toLocaleString('en-US');
    // Negative BigInts aren't a scoring case, but handle them defensively.
    const sign = n < 0n ? '-' : '';
    const digits = (n < 0n ? -n : n).toString();
    return sign + fmtCompactFromDigits(digits);
  }
  if (n < 1e6) return Math.round(n).toLocaleString('en-US');
  // Take a fixed-notation digit string of the Number so the same value in
  // BigInt or Number form runs through the same tier logic and comes out the
  // same. `toFixed(0)` handles the >1e21 range where `.toString()` flips to
  // scientific — precision is display-only.
  return fmtCompactFromDigits(n.toFixed(0));
}

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
