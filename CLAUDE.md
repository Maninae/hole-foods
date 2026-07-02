# CLAUDE.md — Bottomless

Endless single-player hole-swallowing web game (Hole.io genre, cozy/no-fail).
Static vanilla HTML/CSS/JS, ES modules, no build step, no runtime deps, no
binary assets — emoji are the art, WebAudio synthesizes the sound. Serve with
`npm run serve` (python http.server on 8137).

## Architecture

```
index.html           shell; ES module entry
css/base.css         design tokens, canvas scaffold, vignette
css/ui.css           HUD, overlays, buttons, micro-animations
js/config.js         ALL tuning numbers — change gameplay feel here only
js/rng.js            xmur3+mulberry32 seeded PRNG; chunkRng(seed,cx,cy,salt)
js/catalog.js        6 biomes × item tables (emoji, base radius, weight, hue),
                     band/cycle math, pointsFor
js/patterns.js       cluster layouts: ring/doubleRing/grid/spiral/arc/blob (pure)
js/world.js          chunk lifecycle, deterministic generation, eaten-set
                     persistence, padded spatial queries
js/hole.js           player state: easing movement, area-accumulation growth,
                     radius-milestone levels, sizeLabel
js/swallow.js        vacuum pull, tip-in fall state machine, combo + scoring;
                     emits events (pure — presentation reacts to events)
js/camera.js         eased follow + lookahead, size-driven zoom, shake (pure)
js/input.js          mouse hover-steer / touch drag / WASD → {x,y,mag}
js/audio.js          WebAudio synth: pop/gulp/combo/levelup/ambient; mute persists
js/sprites.js        emoji → offscreen-canvas cache, size buckets ≤1024px;
                     bigger draws fall back to direct fillText (stays crisp)
js/ground.js         ONE radial gradient from world origin per frame (bands are
                     radial ⇒ smooth biome blending), + per-biome dot tiles
js/particles.js      suck-burst / confetti / floaters / rings pools
js/render.js         scene order: ground → decals → hole(pit→falling(clipped)→rim)
                     → objects (y-sorted, shadows first) → fx
js/hud.js            DOM HUD + overlays + best-run localStorage
js/main.js           bootstrap, rAF loop, event wiring ONLY — no game rules
```

- **Engine modules are headless** (`rng`, `config`, `catalog`, `patterns`,
  `world`, `hole`, `swallow`, `camera`): no DOM, no `Math.random` (except
  injected), driven by tests and the browser through the same API.
- **Events, not calls:** `swallowUpdate` returns `{type: 'swallow'|'combo'|
  'comboEnd'|'levelup', ...}` events; `main.js` fans them out to audio/fx/HUD.
- **No monoliths:** split any file approaching ~300 lines.

## Invariants (break these and the world breaks)

- **Chunk generation must be deterministic** from `(seed, cx, cy)`. Consume
  the chunk RNG identically on every path — `tryPlace` consumes an id index
  even when placement is rejected, so ids stay stable.
- **Eaten persistence:** `world.eaten` (Map chunkKey→Set idx) outlives chunk
  unload; regenerated chunks filter against it. Never store eaten state on the
  chunk itself.
- **Padded queries:** objects can sit far outside their owning chunk's rect
  (cluster extents ≤ ~900 × cycle-size-mult world units). `padChunksAt` sizes
  the search window; both `forEachObjectNear` and `forEachChunkInRect` use it.
- **1 world unit = 1 cm** for the HUD size label. Hole starts r=22 (44 cm).
- Growth is scale-free: `r' = √(r² + 0.35·s²)`; points = `s²/8`. If you change
  one, the pacing tests will tell you.

## Testing

```
npm test           # 46 unit tests (node --test tests/unit/*.test.js)
npm run test:e2e   # 4 Playwright tests: real steering → swallow → growth,
                   # pause/mute/best persistence, mobile overflow (iPhone 13)
```

`window.__game` exposes live state (mode/world/hole/cam/sw + worldToScreen)
for e2e and debugging. `?seed=<x>` pins the world.

Method that works here: TDD the engine mechanic → build the presentation →
e2e → screenshot review at desktop AND mobile viewports (headless Chromium
renders Apple emoji fine; screenshot scripts live in the session scratchpad,
artifacts in tests/e2e/artifacts/ are gitignored).

## Gotchas

- Emoji rasters: `sprites.js` buckets at ≤1024px; beyond that it draws the
  glyph as text directly (a few giants on screen at most). Don't raise the
  bucket cap — memory.
- The ground must NEVER be painted per-chunk with flat colors — that reads as
  a checkerboard. It's one radial gradient (origin-centered) + dot tiles.
- Monochrome emoji (⚽🎲🎳) are legit color-font glyphs; don't "fix" them.
- Headless software rendering: ~76fps early game, ~31fps at the worst-case
  cycle boundary — GPU browsers run 60fps. Don't panic at headless numbers.
- Score floaters are capped (7 live) so ×5 combo frenzies don't wall the
  screen with text.
- launchd/daemon rules and heavy-asset policy: see the user-level CLAUDE.md
  (not applicable here — this repo has no assets).

## Design doc

`docs/superpowers/specs/2026-07-02-bottomless-design.md` — approaches
considered, tuning rationale, YAGNI list (no multiplayer, no shops/skins,
no backend, no mid-run world saves).
