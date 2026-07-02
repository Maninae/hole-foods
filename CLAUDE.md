# CLAUDE.md — Hole Foods

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
js/world.js          FRACTAL chunk lifecycle: chunk size scales x6 per biome
                     cycle (leveled grids), deterministic generation, eaten-set
                     persistence, LOD level skipping, spatial queries
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

- **THE FRACTAL INVARIANT** (tests/unit/fractal.test.js): the game must look
  and play identically at every scale. Biome bands widen ×CYCLE_SIZE_MULT per
  cycle (`bandRange`/`bandIndex` in catalog.js are geometric), chunk size
  scales the same way (`chunkSizeAt(level)`), zoom is effectively unclamped,
  and SPEED/ZOOM exponents keep on-screen speed and hole size near-constant.
  Never reintroduce a meaningful ZOOM_MIN or fixed-size-only chunks — that's
  the bug where the hole filled the screen and particles walled the view.
- **Chunk generation must be deterministic** from `(seed, level, cx, cy)`.
  Consume the chunk RNG identically on every path — `tryPlace` consumes an id
  index even when placement is rejected, so ids stay stable.
- **Level ownership + LOD:** a grid cell exists only at the level matching
  its center's cycle (`cellOwned`); queries visit levels [L−1..L+1] but skip
  any level whose chunks span < 1/44th of the view (`levelsFor`) — that keeps
  loaded chunks bounded (<1800) at any zoom. Render also skips objects under
  1 screen px. Thin gap/overlap rings at cycle boundaries are expected and
  cosmetically invisible.
- **Eaten persistence:** `world.eaten` (Map chunkKey→Set idx) outlives chunk
  unload; regenerated chunks filter against it. Never store eaten state on the
  chunk itself.
- **Padded queries:** objects can sit outside their owning chunk's rect;
  PAD=3 chunks (in each level's own units) always covers cluster extents.
- **1 world unit = 1 cm** for the HUD size label. Hole starts r=22 (44 cm).
- Growth is scale-free: `r' = √(r² + 0.35·s²)`; points = `s²/8`. If you change
  one, the pacing tests will tell you.

## Testing

```
npm test           # 53 unit tests (node --test tests/unit/*.test.js)
npm run test:e2e   # 4 Playwright tests: real steering → swallow → growth,
                   # pause/mute/best persistence, mobile overflow (iPhone 13)
```

`window.__game` exposes live state (mode/world/hole/cam/sw + worldToScreen)
for e2e and debugging. `?seed=<x>` pins the world.

Method that works here: TDD the engine mechanic → build the presentation →
e2e → screenshot review at desktop AND mobile viewports (headless Chromium
renders Apple emoji fine; keep throwaway screenshot scripts outside the repo,
artifacts in tests/e2e/artifacts/ are gitignored).

## Gotchas

- Emoji rasters: `sprites.js` buckets at ≤1024px; beyond that it draws the
  glyph as text directly (a few giants on screen at most). Don't raise the
  bucket cap — memory.
- The ground must NEVER be painted per-chunk with flat colors — that reads as
  a checkerboard. It's one radial gradient (origin-centered) + dot tiles.
- Monochrome emoji (⚽🎲🎳) are legit color-font glyphs; don't "fix" them.
- Headless software rendering: ~76fps early game, ~25fps two cycles deep —
  GPU browsers run 60fps. Don't panic at headless numbers.
- Scores go compact past 1M (`fmtNum`: "56.0M") in HUD and floaters.
- Score floaters are capped (7 live) so ×5 combo frenzies don't wall the
  screen with text.

## Design doc

`docs/superpowers/specs/2026-07-02-hole-foods-design.md` — approaches
considered, tuning rationale, YAGNI list (no multiplayer, no shops/skins,
no backend, no mid-run world saves).
