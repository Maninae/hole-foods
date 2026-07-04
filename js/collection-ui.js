// Collection overlay + unlock banner. All DOM lives here; the achievements
// engine (js/achievements.js) is headless. The overlay renders the current
// state of a passed-in `progress` object on every open, so the same reference
// stays live-updated by the engine.

import { ACHIEVEMENTS, THEMES_ORDER } from './achievements.js';

const BANNER_HOLD_MS = 2400;         // time each unlock stays visible
const BANNER_GAP_MS = 220;           // gap between queued unlocks

function el(id) { return document.getElementById(id); }

// Render the sticker grid and achievement list from the current progress.
function paint(refs, progress) {
  const grid = refs.stickerGrid;
  const list = refs.achievementList;

  // Diff-free: it's an 18-slot grid and ~11 achievements — a total rerender
  // is cheaper (in reasoning) than tracking per-cell state. It runs only
  // when the overlay opens, not per frame.
  grid.textContent = '';
  for (const theme of THEMES_ORDER) {
    const unlocked = progress.discovered.has(theme.key);
    const cell = document.createElement('div');
    cell.className = `sticker ${unlocked ? 'unlocked' : 'locked'}`;
    const emoji = document.createElement('div');
    emoji.className = 'sticker-emoji';
    emoji.textContent = unlocked ? theme.sticker : '❓';
    const name = document.createElement('div');
    name.className = 'sticker-name';
    name.textContent = unlocked ? theme.name : '— — —';
    cell.append(emoji, name);
    grid.append(cell);
  }

  list.textContent = '';
  for (const a of ACHIEVEMENTS) {
    const unlocked = progress.unlocked.has(a.id);
    const li = document.createElement('li');
    li.className = `achievement ${unlocked ? 'unlocked' : 'locked'}`;
    const em = document.createElement('div');
    em.className = 'achievement-emoji';
    em.textContent = unlocked ? a.emoji : '🔒';
    const body = document.createElement('div');
    body.className = 'achievement-body';
    const name = document.createElement('div');
    name.className = 'achievement-name';
    name.textContent = a.name;
    const desc = document.createElement('div');
    desc.className = 'achievement-desc';
    desc.textContent = a.description;
    body.append(name, desc);
    li.append(em, body);
    list.append(li);
  }

  refs.progressThemes.textContent = `${progress.discovered.size} / ${THEMES_ORDER.length}`;
  refs.progressAchievements.textContent = `${progress.unlocked.size} / ${ACHIEVEMENTS.length}`;
}

// Escape-to-close is captured on document so it beats window-level pause
// handling (input.js listens on window). We only steal the key while the
// overlay is open — otherwise Escape keeps pausing / resuming as before.
function installEscapeCloser(overlay, closeFn) {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    if (overlay.classList.contains('hidden')) return;
    e.stopPropagation();
    e.preventDefault();
    closeFn();
  }, true);
}

// Build the collection overlay + unlock banner. `progress` is a live
// reference (from achievements.createProgress / loadProgress) that the
// engine mutates as events land — we simply repaint on open.
//
// `onPing` fires when an unlock banner appears (audio cue hook).
// `reducedMotion` skips the ribbon-in animation.
export function createCollectionUI({ progress, reducedMotion = false, onPing = null } = {}) {
  const refs = {
    overlay: el('collection'),
    stickerGrid: el('sticker-grid'),
    achievementList: el('achievement-list'),
    progressThemes: el('collection-progress-themes'),
    progressAchievements: el('collection-progress-achievements'),
    btnClose: el('btn-collection-close'),
    banner: el('unlock-banner'),
    bannerEmoji: el('unlock-banner').querySelector('.unlock-emoji'),
    bannerName: el('unlock-banner').querySelector('.unlock-name'),
    bannerEyebrow: el('unlock-banner').querySelector('.unlock-eyebrow'),
  };

  const state = {
    isOpen: false,
    queue: [],           // pending unlock banners
    activeTimer: null,   // clears the current banner
    gapTimer: null,      // starts the next queued banner
  };

  function open() {
    if (state.isOpen) return;
    paint(refs, progress);
    refs.overlay.classList.remove('hidden');
    refs.overlay.setAttribute('aria-hidden', 'false');
    state.isOpen = true;
  }

  function close() {
    if (!state.isOpen) return;
    refs.overlay.classList.add('hidden');
    refs.overlay.setAttribute('aria-hidden', 'true');
    state.isOpen = false;
  }

  function nextBanner() {
    const entry = state.queue.shift();
    if (!entry) return;
    refs.bannerEyebrow.textContent = entry.kind === 'discovery'
      ? 'Discovered'
      : 'Achievement Unlocked';
    refs.bannerEmoji.textContent = entry.kind === 'discovery'
      ? entry.sticker
      : entry.emoji;
    refs.bannerName.textContent = entry.name;
    refs.banner.classList.remove('hidden');
    if (!reducedMotion) {
      refs.banner.classList.remove('ribbon-in');
      // Force reflow so the animation restarts on rapid successive banners.
      void refs.banner.offsetWidth;
      refs.banner.classList.add('ribbon-in');
    }
    onPing?.(entry);

    clearTimeout(state.activeTimer);
    state.activeTimer = setTimeout(() => {
      refs.banner.classList.add('hidden');
      state.activeTimer = null;
      if (state.queue.length > 0) {
        state.gapTimer = setTimeout(nextBanner, BANNER_GAP_MS);
      }
    }, BANNER_HOLD_MS);
  }

  function showUnlock(entry) {
    state.queue.push(entry);
    // Kick the drain if nothing is currently on-screen.
    if (state.activeTimer == null && state.gapTimer == null) nextBanner();
  }

  refs.btnClose.addEventListener('click', close);
  // Click on the backdrop (but not the panel) closes.
  refs.overlay.addEventListener('click', (e) => {
    if (e.target === refs.overlay) close();
  });
  installEscapeCloser(refs.overlay, close);

  return {
    open,
    close,
    isOpen: () => state.isOpen,
    showUnlock,
  };
}
