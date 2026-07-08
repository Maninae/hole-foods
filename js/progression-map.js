// Progression map — DOM nodes + one SVG edge layer, wrapped in a pannable
// viewport. Rendered inside the Collection overlay by collection-ui.js.
// State is derived on refresh() from a live `progress` object; nothing here
// mutates progress or the engine.
//
// Layout: each achievement carries (col, row) grid coordinates in the table.
// This module maps them to pixels via COL_W / ROW_H — nodes are absolutely
// positioned; edges are one <svg> underneath. Node size, spacing, and
// popover geometry all live at the top of the file so restyling doesn't
// mean chasing magic numbers.
//
// A11y: nodes are real <button>s (keyboard-focusable), each with an aria
// label describing its state. The popover uses role="dialog". Pan is
// browser-native (overflow: auto) so mobile touch drag "just works".

import { ACHIEVEMENTS } from './achievements-table.js';
import { THEMES } from './catalog.js';

const NODE_SIZE = 54;    // circle diameter (matches the ≥44px tap-target rule)
const COL_W = 130;       // horizontal spacing between tiers
const ROW_H = 92;        // vertical spacing between lanes — roomy enough that
                         // an AVAILABLE node's progress hint (label + hint
                         // lane below the badge) never reaches the next row
const PAD_X = 60;        // left/right padding inside the canvas
const PAD_Y = 44;        // top/bottom padding
const POPOVER_OFFSET = 6; // gap between node and popover

function pixelXY(node) {
  return {
    x: PAD_X + node.col * COL_W,
    y: PAD_Y + node.row * ROW_H,
  };
}

// Canvas extents cover every node with a bit of slack for the name label
// underneath and the popover-when-opened. We compute it from the table so
// authors can add rungs without touching this file.
function canvasSize() {
  let maxX = 0, maxY = 0;
  for (const a of ACHIEVEMENTS) {
    const { x, y } = pixelXY(a);
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    width: Math.ceil(maxX + PAD_X),
    height: Math.ceil(maxY + PAD_Y + 24), // extra for the label under the last row
  };
}

// A node is UNLOCKED once the engine has fired it, AVAILABLE when all its
// requires are unlocked but the trigger hasn't fired, and LOCKED otherwise.
function nodeState(node, progress) {
  if (progress.unlocked.has(node.id)) return 'unlocked';
  const reqsMet = node.requires.every((id) => progress.unlocked.has(id));
  return reqsMet ? 'available' : 'locked';
}

// Optional short progress hint on AVAILABLE nodes — only where the number
// is cheap and reads at a glance. Not shown on UNLOCKED / LOCKED nodes.
function progressText(node, progress) {
  const t = node.trigger;
  if (t.kind === 'themes') {
    return `${progress.discovered.size} / ${t.min}`;
  }
  if (t.kind === 'themeCycleCount') {
    const prefix = `${t.key}:`;
    let n = 0;
    for (const s of progress.themeCycles) if (s.startsWith(prefix)) n++;
    return `${n} / ${t.min} cycles`;
  }
  return '';
}

// Short label under each node — keep it tight so labels don't collide.
// The full name lives in the popover.
function shortLabel(node) {
  // Prefer explicit rung labels for the size ladder; otherwise the leading
  // words of the name.
  const idAliases = {
    'size-1m': '1 m',       'size-10m': '10 m',       'size-100m': '100 m',
    'size-1km': '1 km',     'size-10km': '10 km',     'size-100km': '100 km',
    'eat-100': '100',       'eat-1000': '1k',
    'eat-10000': '10k',     'eat-100000': '100k',
    'combo-x2': '×2',       'combo-x3': '×3',
    'combo-x4': '×4',       'combo-x5': '×5',
    'themes-3': '3 biomes', 'themes-9': '9 biomes',   'all-themes': `All ${THEMES.length}`,
    'full-cycle': 'Cycle I','cycle-2': 'Cycle II',
    'cycle-3': 'Cycle III', 'cycle-5': 'Cycle V',
    'meadow-c1': 'Meadow II', 'meadow-c2': 'Meadow III', 'meadow-6c': 'Meadow ×6',
    'first-building': 'Buildings',
    'topple-1': '1st',        'topple-10': '10',
    'topple-beacon': 'Beacon', 'topple-50': '50',
  };
  return idAliases[node.id] ?? node.name;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createProgressionMap({ progress } = {}) {
  const { width, height } = canvasSize();

  const root = document.createElement('div');
  root.className = 'map-viewport';

  const canvas = document.createElement('div');
  canvas.className = 'map-canvas';
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  root.appendChild(canvas);

  // Edges — one <svg> covering the whole canvas, one <line> per requires
  // relation. Rendered under the nodes (z-index in CSS). Note the cross-
  // branch edge full-cycle → meadow-c1 falls out of this automatically.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'map-edges');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  canvas.appendChild(svg);

  const edgeElements = [];
  for (const a of ACHIEVEMENTS) {
    for (const reqId of a.requires) {
      const req = ACHIEVEMENTS.find((x) => x.id === reqId);
      if (!req) continue;
      const from = pixelXY(req);
      const to = pixelXY(a);
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      line.setAttribute('class', 'map-edge');
      line.dataset.from = reqId;
      line.dataset.to = a.id;
      svg.appendChild(line);
      edgeElements.push(line);
    }
  }

  // Nodes — one <button> per achievement, absolutely positioned.
  const nodeElements = new Map();
  for (const a of ACHIEVEMENTS) {
    const { x, y } = pixelXY(a);
    const btn = document.createElement('button');
    btn.className = 'map-node';
    btn.type = 'button';
    btn.dataset.id = a.id;
    btn.dataset.branch = a.branch;
    btn.style.left = `${x - NODE_SIZE / 2}px`;
    btn.style.top = `${y - NODE_SIZE / 2}px`;
    btn.style.width = `${NODE_SIZE}px`;
    btn.style.height = `${NODE_SIZE}px`;

    const emoji = document.createElement('span');
    emoji.className = 'node-emoji';
    btn.appendChild(emoji);

    const label = document.createElement('span');
    label.className = 'node-name';
    label.textContent = shortLabel(a);
    btn.appendChild(label);

    const hint = document.createElement('span');
    hint.className = 'node-hint';
    btn.appendChild(hint);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPopover(a, btn);
    });
    canvas.appendChild(btn);
    nodeElements.set(a.id, btn);
  }

  // Popover — reused; positioned near whichever node was tapped.
  const popover = document.createElement('div');
  popover.className = 'map-popover hidden';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-hidden', 'true');
  popover.innerHTML = `
    <div class="pop-title"><span class="pop-emoji"></span><span class="pop-name"></span></div>
    <div class="pop-desc"></div>
    <div class="pop-req hidden"></div>
  `;
  // Clicks inside the popover shouldn't dismiss it.
  popover.addEventListener('click', (e) => e.stopPropagation());
  canvas.appendChild(popover);

  // Tap-away dismissal — one listener on the viewport, since the canvas is
  // the pannable area. `keydown` on the whole document handles Escape.
  root.addEventListener('click', () => closePopover());

  function openPopover(node, btn) {
    const state = nodeState(node, progress);
    popover.querySelector('.pop-emoji').textContent = state === 'locked' ? '🔒' : node.emoji;
    popover.querySelector('.pop-name').textContent = node.name;
    popover.querySelector('.pop-desc').textContent = node.description;
    const reqEl = popover.querySelector('.pop-req');
    if (state === 'locked' && node.requires.length > 0) {
      // Join with a middot, not a comma: if a display name ever carries a
      // comma again, a comma separator would read as two items.
      const missing = node.requires
        .filter((id) => !progress.unlocked.has(id))
        .map((id) => (ACHIEVEMENTS.find((x) => x.id === id) ?? { name: id }).name)
        .join(' · ');
      reqEl.textContent = `Requires: ${missing}`;
      reqEl.classList.remove('hidden');
    } else if (state === 'available') {
      const hint = progressText(node, progress);
      if (hint) {
        reqEl.textContent = `Progress: ${hint}`;
        reqEl.classList.remove('hidden');
      } else {
        reqEl.classList.add('hidden');
      }
    } else {
      reqEl.classList.add('hidden');
    }
    // Position above the node when there's room, otherwise below.
    const { x, y } = pixelXY(node);
    popover.classList.remove('hidden');
    popover.setAttribute('aria-hidden', 'false');
    // First reveal so we can measure.
    const pw = popover.offsetWidth || 220;
    const ph = popover.offsetHeight || 100;
    const canvasW = canvas.clientWidth;
    let px = x - pw / 2;
    let py = y - NODE_SIZE / 2 - ph - POPOVER_OFFSET;
    if (py < 4) py = y + NODE_SIZE / 2 + POPOVER_OFFSET;
    px = Math.max(4, Math.min(px, canvasW - pw - 4));
    popover.style.left = `${px}px`;
    popover.style.top = `${py}px`;
  }

  function closePopover() {
    popover.classList.add('hidden');
    popover.setAttribute('aria-hidden', 'true');
  }

  // Refresh redraws state markers for every node/edge. Cheap — ~25 nodes,
  // ~24 edges. Called on overlay open and after any newly-applied unlocks.
  function refresh() {
    for (const a of ACHIEVEMENTS) {
      const el = nodeElements.get(a.id);
      const state = nodeState(a, progress);
      el.classList.remove('unlocked', 'available', 'locked');
      el.classList.add(state);
      el.querySelector('.node-emoji').textContent = state === 'locked' ? '🔒' : a.emoji;
      el.setAttribute(
        'aria-label',
        `${a.name} — ${state === 'unlocked' ? 'unlocked'
          : state === 'available' ? 'available' : 'locked'}`,
      );
      const hintEl = el.querySelector('.node-hint');
      if (state === 'available') {
        const hint = progressText(a, progress);
        hintEl.textContent = hint;
        hintEl.classList.toggle('hidden', hint === '');
      } else {
        hintEl.textContent = '';
        hintEl.classList.add('hidden');
      }
    }
    for (const line of edgeElements) {
      const bothUnlocked = progress.unlocked.has(line.dataset.from)
        && progress.unlocked.has(line.dataset.to);
      line.classList.toggle('unlocked', bothUnlocked);
    }
    closePopover();
  }

  refresh();

  return {
    root,
    refresh,
    closePopover,
  };
}
