// Collection overlay + unlock banner. All DOM lives here; the achievements
// engine (js/achievements.js) is headless. The overlay renders the current
// state of a passed-in `progress` object on every open, so the same reference
// stays live-updated by the engine.

import { ACHIEVEMENTS, THEMES_ORDER } from './achievements.js';
import { createProgressionMap } from './progression-map.js';

const BANNER_HOLD_MS = 2400;         // time each unlock stays visible
const BANNER_GAP_MS = 220;           // gap between queued unlocks

function el(id) { return document.getElementById(id); }

// Render the sticker grid and refresh the progression map from the current
// progress. Called on every open — cheap enough (~18 stickers, ~25 nodes).
function paint(refs, progress, map) {
  const grid = refs.stickerGrid;
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

  map.refresh();

  refs.progressThemes.textContent = `${progress.discovered.size} / ${THEMES_ORDER.length}`;
  refs.progressAchievements.textContent =
    `${progress.unlocked.size} / ${ACHIEVEMENTS.length}`;
}

// Escape/P-to-close is captured on document so it beats window-level pause
// handling (input.js listens on window). We only steal the keys while the
// overlay is open — otherwise both keep pausing / resuming as before. P must
// be stolen too: letting it bubble would toggle pause→playing with the modal
// still up, leaving the player steering underneath it.
function installEscapeCloser(overlay, closeFn) {
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
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
// `onPing`   fires when an unlock banner appears (audio cue hook).
// `onClose`  fires after the overlay is closed (main.js uses it to resume
//            play if the overlay was opened from the in-game HUD button).
// `reducedMotion` skips the ribbon-in animation.
export function createCollectionUI({
  progress, reducedMotion = false, onPing = null, onClose = null,
} = {}) {
  const refs = {
    overlay: el('collection'),
    stickerGrid: el('sticker-grid'),
    mapMount: el('achievement-map'),
    progressThemes: el('collection-progress-themes'),
    progressAchievements: el('collection-progress-achievements'),
    btnClose: el('btn-collection-close'),
    banner: el('unlock-banner'),
    bannerEmoji: el('unlock-banner').querySelector('.unlock-emoji'),
    bannerName: el('unlock-banner').querySelector('.unlock-name'),
    bannerEyebrow: el('unlock-banner').querySelector('.unlock-eyebrow'),
  };

  const map = createProgressionMap({ progress });
  refs.mapMount.appendChild(map.root);

  const state = {
    isOpen: false,
    queue: [],           // pending unlock banners
    activeTimer: null,   // clears the current banner
    gapTimer: null,      // starts the next queued banner
  };

  function open() {
    if (state.isOpen) return;
    paint(refs, progress, map);
    refs.overlay.classList.remove('hidden');
    refs.overlay.setAttribute('aria-hidden', 'false');
    state.isOpen = true;
  }

  function close() {
    if (!state.isOpen) return;
    map.closePopover();
    refs.overlay.classList.add('hidden');
    refs.overlay.setAttribute('aria-hidden', 'true');
    state.isOpen = false;
    onClose?.();
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
    // Refresh the map so newly unlocked nodes light up while the overlay
    // is open (banner-driven repaints during unlock cascades).
    if (state.isOpen) map.refresh();
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
