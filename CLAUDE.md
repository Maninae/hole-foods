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
css/collection.css   collection overlay + unlock banner styles
js/config.js         ALL tuning numbers — change gameplay feel here only
js/rng.js            xmur3+mulberry32 seeded PRNG; chunkRng(seed,cx,cy,salt)
js/catalog.js        18 themes × slot-normalized item tables (emoji, radius,
                     weight, hue), geometric band/cycle math, angular
                     patchwork tiling (themeAt/sectorCount), pointsFor→BigInt
js/patterns.js       cluster layouts: ring/doubleRing/grid/spiral/arc/blob (pure)
js/world.js          FRACTAL chunk lifecycle: chunk size scales x6 per biome
                     cycle (leveled grids), deterministic generation, eaten-set
                     persistence, LOD level skipping, spatial queries
js/hole.js           player state: easing movement, DISCRETE size ladder
                     (r snaps to radiusForLevel; potential accumulates
                     between rungs), holeProgress, sizeLabel
js/swallow.js        vacuum pull, tip-in fall state machine, combo + scoring;
                     emits events (pure — presentation reacts to events)
js/camera.js         eased follow + lookahead, size-driven zoom, shake (pure)
js/input.js          keyboard steer (WASD/arrows) + touch drag → {x,y,mag}
js/audio.js          WebAudio synth: pop/gulp/combo/levelup/ambient; mute persists
js/sprites.js        emoji → offscreen-canvas cache, size buckets ≤1024px;
                     bigger draws fall back to direct fillText (stays crisp)
js/ground.js         ONE radial gradient from world origin per frame (bands are
                     radial ⇒ smooth biome blending), + per-biome dot tiles
js/particles.js      suck-burst / confetti / floaters / rings pools;
                     drawFxWorld (parts+rings, ground plane) / drawFxText
                     (floaters, billboard/screen space) split for iso view
js/levelfx.js        MapleStory-style level-up celebration: ground glow +
                     ring pulses (world), pillar + sparkles + big overshoot
                     "LEVEL UP! N" text (screen). Escalates with level;
                     every 10 levels adds a full-screen wash. AURA_TIERS
                     color ladder (sky→azure→lavender→royal→yellow→gold→
                     pale-green→emerald, lerped). Celebrations FOLLOW the
                     hole (live x/y/r getters) — never re-anchor them to
                     the ground; owner feedback.
js/format.js         fmtNum (HUD, compact ≥1e6) / fmtShort (floaters,
                     compact ≥1e4); BigInt-safe suffix ladder K…Dc
js/achievements.js   headless achievements engine: declarative table
                     (11 milestones + 18-theme discovery log), ingest(),
                     versioned localStorage persistence
js/collection-ui.js  collection overlay + unlock banner DOM; queued
                     banners, Escape/P capture while open
js/render.js         two passes for the pseudo-3D view:
                     GROUND (squashed by ISO_Y): ground → decals → hole
                     (pit→falling(clipped)→rim) → tease rings → fxWorld.
                     BILLBOARD (upright): shadows → sprites y-sorted (lifted,
                     tilt-lean toward hole) → score floaters
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
- **Rim physics, not vacuum:** objects are inert until the hole's edge is
  under them (overhang > 0), teeter below 0.5, tip at 0.5. Never reintroduce
  long-range attraction — it was removed on purpose (owner feedback).
- **Score is BigInt** end-to-end (pointsFor → events → hole.score → storage
  as string). Never mix it into Number arithmetic; format via js/format.js.
- **Discrete size ladder:** hole.r is always exactly radiusForLevel(level) =
  22·1.22^(level−1); eating grows hole.potential, and level-up snaps r to the
  next rung (possibly several at once). Never let r drift off-ladder.
- **Patchwork themes:** themeAt(x,y) is deterministic and seed-independent;
  band 0 is always Berry Meadow. Scale tier comes from distance (bands),
  theme from angle — don't couple them.
- **Meta-progression:** achievements/discoveries persist in localStorage
  `holefoods.progress` (versioned JSON, no BigInt inside). newRun() must NOT
  reset it; saves happen on unlock/pause/beforeunload, never per frame.
- **Balance is sim-tuned:** GROWTH_K and the oasis density constants were set
  by greedy-bot simulation (`npm run sim -- 12 <seed>`; cycle 1 ≈ 4 min
  greedy ≈ 5-8 min human, ~1.4-1.8x per cycle after). Re-run sims on 2-3
  seeds before changing them.
- Growth is scale-free: `r' = √(r² + GROWTH_K·s²)`; points = `s²/8`. If you change
  one, the pacing tests will tell you.

## Testing

```
npm test           # 109 unit tests (node --test tests/unit/*.test.js)
npm run test:e2e   # 7 Playwright tests: real steering → swallow → growth,
                   # pause/mute/best persistence, Cmd+Tab stuck-key,
                   # collection overlay (Escape + P capture), mobile
npm run sim -- 12  # headless greedy-bot balance sim (minutes, seed args)
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
- GitHub Pages: keep `.nojekyll` — without it Pages runs a Jekyll build that
  errors/wedges on this repo and deploys stall for hours.

## Design doc

`docs/superpowers/specs/2026-07-02-hole-foods-design.md` — approaches
considered, tuning rationale, YAGNI list (no multiplayer, no shops/skins,
no backend, no mid-run world saves).
