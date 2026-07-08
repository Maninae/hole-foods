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
                     kicks the tower avalanche off when a base tips; emits
                     events (pure — presentation reacts to events)
js/collapse.js       tower collapse state machine: per-unit avalanche.
                     Bottom-up detach with a Jenga pre-lean beat, ballistic
                     bodies (fake z / vz / spin / gravity + damped bounces),
                     and deterministic settle targets (the S1 cap invariant
                     still holds). Owns sw.avalanches; called each tick.
js/stacks.js         pure helpers for vertical stacks ("towers"): grouping
                     by stackId, current-base promotion, sibling minting
                     (spawnStackFromBase — called from world.js chunk
                     generation). Only the lowest alive unit of a tower is
                     interactive; the rest sit in state='stacked' until an
                     avalanche detaches them into state='tumbling'.
js/camera.js         eased follow + lookahead, size-driven zoom, shake (pure)
js/input.js          keyboard steer (WASD/arrows) + virtual joystick +
                     whole-canvas touch drag → {x,y,mag}
js/joystick.js       corner-anchored virtual joystick for touch devices:
                     translucent ring + knob DOM in bottom-right, pointer-
                     capture drag, {x,y,mag} steering that plugs into
                     input.getDirection. Visible only on touch devices
                     (pointer:coarse or first-touch belt-and-suspenders)
                     during 'playing' mode. Pure steerFromOffset math
                     unit-tested; wiring covered by e2e on iPhone 13.
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
js/achievements.js   headless achievements engine: ingest() + fixpoint
                     over the DAG, versioned localStorage persistence
                     (v2 = themes/unlocked/themeCycles). Table lives in
                     js/achievements-table.js — ~25 nodes across 6
                     branches (GRANDEUR/APPETITE/COMBO/EXPLORER/DEPTH/
                     HOMECOMING) with requires:[] edges and (col,row)
                     layout coords for the map
js/achievements-table.js  the declarative graph: add a row here to
                     add an achievement, nothing else to wire
js/collection-ui.js  collection overlay + unlock banner DOM; queued
                     banners, Escape/P capture while open, mounts the
                     progression map
js/progression-map.js  DOM node buttons + one SVG edge layer inside a
                     pannable viewport; unlocked/available/locked states,
                     click for popover with description + requires
js/render.js         two passes for the pseudo-3D view:
                     GROUND (squashed by ISO_Y): ground → decals → hole
                     (pit→falling(clipped)→rim) → tease rings → fxWorld.
                     BILLBOARD (upright): shadows → sprites y-sorted (lifted,
                     tilt-lean toward hole) → hole overlay (rim + gold arc,
                     fades in when the hole is occluded) → score floaters.
                     Occluders (non-fittable sprites/towers whose screen bbox
                     covers the hole) draw at OCCLUDER_ALPHA so the hole
                     stays visible through a building.
js/render-hole.js    ground-pass hole draw: pit gradient, falling clip,
                     shimmer, rim, progress meter. Pure draw code — the
                     billboard-pass overlay lives in js/render-overlay.js.
js/render-overlay.js occlusion visibility layer: shouldFadeSingle /
                     shouldFadeTower predicates (fit-exempt), holeScreenBBox
                     + bboxIntersect, advanceOverlayFade, drawHoleOverlay
                     (screen-space rim ellipse + gold progress arc that
                     eases in when the hole is covered). Pure math + draw.
js/render-sprites.js drawSingle + drawTower + drawTumbling — pure
                     per-item billboard draw code. Tower rendering carries
                     the Part A verticality cues (tight overlap, per-unit
                     jitter/perspective, idle sway, capsule + widened base
                     shadow). drawTumbling handles airborne avalanche
                     units (z-lift + spin + separated ground shadow).
                     Called from render.js's billboard pass.
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
- **Height-aware south cull** (columnCullExtraY in render-overlay.js):
  the render cull accepts a stack member whose base is up to its column's
  screen height below the bottom edge, so a tall tower's top peeks into
  view instead of popping in whole when the base crosses the edge. Every
  minted unit carries `stackH` (full column height) for this; all members
  share (x, y) + stackH so a column passes or fails the cull as one unit.
- **1 world unit = 1 cm** for the HUD size label. Hole starts r=26.4 (53 cm)
  — the starter radius was sim-tuned up +20% (from 22) after owner feedback
  that L1→L3 felt gated by too many oversized nearby items.
- **Rim physics, not vacuum:** objects are inert until the hole's edge is
  under them (overhang > 0), teeter below 0.5, tip at 0.5. Never reintroduce
  long-range attraction — it was removed on purpose (owner feedback).
- **Hole is always visible** (js/render-overlay.js): the ground pass draws
  the hole, then the billboard pass paints sprites on top. Without help,
  driving under a big sprite (a downtown building, r ~138 vs an L1 hole
  r 26.4) hid the hole 100%. Two-part fix: (1) any non-fittable sprite or
  tower group whose screen bbox overlaps the hole's screen ellipse is
  drawn at `OCCLUDER_ALPHA` (both shadow and sprite). Fittable objects
  are exempt so teeter stays fully readable; tumbling avalanche units
  are exempt too. (2) After the billboard pass, a crisp screen-space rim
  ellipse + gold progress arc paints on top, fading in over
  `OVERLAY_FADE_S` when anything faded this frame and out at the same
  rate. In open-field play (no occluders) the overlay is invisible, so
  it never double-draws against the ground-pass rim.
- **Score is BigInt** end-to-end (pointsFor → events → hole.score → storage
  as string). Never mix it into Number arithmetic; format via js/format.js.
- **Discrete size ladder:** hole.r is always exactly radiusForLevel(level) =
  HOLE_R0·1.22^(level−1) with HOLE_R0=26.4; eating grows hole.potential, and
  level-up snaps r to the next rung (possibly several at once). Never let r
  drift off-ladder.
- **Patchwork themes:** themeAt(x,y) is deterministic and seed-independent;
  band 0 is always Berry Meadow. Scale tier comes from distance (bands),
  theme from angle — don't couple them.
- **Dense-glyph size normalization:** face-close-up emojis (lion, frog),
  buildings, and other visually dense fills ink more of their em-square
  than typical fruit silhouettes, so at equal `r` they read visibly
  bigger than their neighbors. `catalog.js` shrinks the canonical r of
  such glyphs (bboxFrac >= 0.72 measured via `tools/glyph-coverage.mjs`)
  by DENSE_R_SCALE=0.80 at module load, floored at 6. `item.r` remains
  the single source of truth for both visual and physics footprint (no
  split hitbox). When new emoji join the catalog, re-run the coverage
  tool and update the DENSE_GLYPHS set. Fractal test's cycle-1 min-r
  floor uses 6×M as the theoretical lower bound.
- **Slot-density taper (world.js):** oasis clusters use a PLACED-radius
  cap (item.r * mult <= min(CLUSTER_MAX_BASE_R * mult, C / 8)), so
  cluster extents stay within ~two chunks at every slot. Singles count
  tapers with mult (`Math.round(8 / mult^0.35)`) so slot-5 chunks read
  airy instead of packed. Cycle-boundary crowding regressions are
  guarded in tests/unit/world.test.js.
- **Meta-progression:** achievements/discoveries persist in localStorage
  `holefoods.progress` (versioned JSON, no BigInt inside). newRun() must NOT
  reset it; saves happen on unlock/pause/beforeunload, never per frame. The
  current schema is v3 — {themes, achievements, themeCycles, counters}.
  v1/v2 saves migrate cleanly (missing fields start empty). counters are
  whitelisted (KNOWN_COUNTERS) monotonic meta-counters (topples) and merge
  by MAX in the union-on-save. Only tall-path avalanches (>= TOPPLE_MIN
  units) count as topples — main.js gates on ev.unitCount. Never
  rename/remove an achievement id — live saves in the wild refer to them.
- **Requires-fixpoint:** the achievement graph is a DAG; each node can list
  `requires: [ids]` and only unlocks once all prereqs are unlocked AND its
  trigger fires. A single ingest sweeps to a fixpoint so a big event
  (radius=huge, combo=×5) cascades a whole chain in dependency order. Keep
  the ACHIEVEMENTS array in topological order — the table-integrity test
  enforces both acyclicity and forward-only requires references.
- **Tower invariants** (tests/unit/stacks.test.js): a tower is N units of
  ONE item at ONE ground position, each with `stackId` (unique per chunk)
  and `stackIdx` (0 = base, increases upward). ONLY the lowest alive unit
  is 'idle' — the rest sit in 'stacked' so spatial queries and rim
  physics skip them; the renderer draws the column as a bottom-up
  vertical strip pinned to the base's (x, y) with several verticality
  cues so a still tower reads unambiguously vs. a ground line of the
  same emoji:
  - Tight unit overlap (`STACK_UNIT_OVERLAP` = 0.55 of unit height) —
    each unit visibly sits ON the one below.
  - Deterministic per-unit x-jitter + rotation, hashed by (stackId,
    stackIdx) — hand-stacked feel, stable frame-to-frame.
  - Perspective scale up the column (~+1.5%/idx, capped at +25%) —
    higher = closer to the camera-above-scene.
  - Idle sway around the base pivot (~2.5° at the tip of a tall column,
    ramped by alive height, phased per stackId). Disabled under
  `prefers-reduced-motion`. This is THE motion cue the ground can't fake.
  - Soft dark capsule + widened base shadow — ambient occlusion that
    binds the sprites into one silhouette.
- **Avalanche collapse** (js/collapse.js): when a tower base tips into the
  hole, its stacked units detach BOTTOM-UP with a small stagger. Tall
  towers (alive ≥ `STACK_TOPPLE_MIN` = 8) also get a Jenga "losing-balance"
  pre-lean beat (~0.15 s, ~10°) before the first detach. Each detached
  unit becomes a ballistic body with fake `z` height, spin, and 1–2 damped
  LOCAL bounces (zeroed horizontal on bounce), then settles as an ordinary
  'idle' ground object at a **deterministic target** on a sunflower spiral
  (angle_j = j × 137.5° with hashed jitter, r_j = spacing × √j; hashed by
  stackId + stackIdx). Units detach with **vz = 0** — a pure drop from
  their RENDERED stacked height (`detachDropZ`: step/ISO_Y per row above
  the effective base, plus a continuity floor for the lowest unit). Never
  reintroduce an upward launch impulse: it read as the tower "sprouting"
  from its top (owner feedback). Horizontal velocity is DERIVED from the
  target: we solve the ballistic z-arc for flight time T, then set
  `vx = (tx − x) / T`, `vy = (ty − y) / T`, so the fall LANDS on the
  target (with sub-frame touchdown interpolation in stepUnit so the
  landing never overruns it). Settle is a no-op on x/y (the unit is already there), which is
  what makes the collapse read as a real crumble instead of a fling
  followed by a snap. Airborne units
  live in a new `'tumbling'` state that rim physics ignores, and the
  renderer draws them via `drawTumbling` with a smaller ground shadow
  offset from the sprite (the shadow-vs-sprite separation is the height
  cue). Short-pile slumps use the same system with tight target radii so
  units mostly hop into the hole, feeding the eat-through-tower combo
  chain. **Non-base member idxs are stamped into world.eaten at collapse
  START** — a chunk that unloads and regenerates mid-collapse must not
  resurrect the tower. markEaten is idempotent, and no live query path
  filters by world.eaten, so landed units stay eatable by rim physics
  while their chunk is loaded. **Every settled position stays within
  `2 × chunkSizeAt(level)` of the base's chunk** — a deep-cycle beacon
  (24 units × unitR ≈ 200) would otherwise scatter outside PAD=3 and be
  invisible to every spatial query. Presentation-only fx: throttled dust
  puffs (`avalancheDust`) + soft thumps (`avalancheThump`) on bounce
  clusters; the historical `topple` event still fires once when the
  avalanche fully settles (chunky payoff SFX + screen shake).
  Partially-eaten towers survive unload via world.eaten alone —
  `normalizeBases` (in stacks.js, called after the eaten-filter) promotes
  the lowest surviving 'stacked' unit to 'idle' on regen. Stack units'
  idxs consume the chunk RNG deterministically: base attempt takes 1 idx
  whether accepted or rejected; a successful base then consumes H−1 more
  for its siblings via `spawnStackFromBase`. Skipping 'falling'/'tumbling'
  in `normalizeBases` is load-bearing — otherwise the falling base would
  get re-marked 'idle' mid-fall and re-tip.
- **Formations (multi-column stacks):** `js/formations.js` mints pyramids
  (2k−1 columns with a triangular height profile, oasis centerpieces) and
  prisms (W=3-4 × H=8-14 skyscrapers, rare landmarks) at worldgen time.
  Each column is an ORDINARY stack (own stackId, own idx run, own avalanche);
  units share `formationId`/`columnIdx`/`formationKind`/`formationTotalUnits`
  as visual + coordination bindings. Rendering: columns share a sway phase
  keyed on formationId so a skyscraper reads as ONE building instead of a
  picket fence. Formation columns draw NO AO capsule (neither per-column
  nor formation-wide) — a backdrop big enough to span a pyramid reads as
  a grey slab (owner feedback); touching columns + unison sway carry the
  grouping. Lone towers keep their per-column capsule. Chain destabilization: when a
  column tips, adjacent standing columns roll `hashFormationRoll` <
  `FORMATION_CHAIN_PROB` (0.7) and schedule delayed initiateCollapse
  triggers (`FORMATION_CHAIN_DELAY_MIN..MAX`). `FORMATION_MAX_AIRBORNE`
  bounds concurrency so a full skyscraper demolition holds framerate.
  Achievement gating: `sw.formationClaims` tracks the first-collapsing
  column per formation; only that column's `topple` event carries
  `achievement=true` with the formation's total unit count, so the
  demolition counter bumps once per skyscraper, not once per column.
- **Balance is sim-tuned:** HOLE_R0 (26.4), GROWTH_K (0.0288), and the oasis
  density constants were set by greedy-bot simulation
  (`npm run sim -- 12 <seed>`; L3 reached in 20–45 s greedy, cycle 1
  completion ≈ 3.5–6 min greedy ≈ 5-10 min human, ~1.4-1.8x per cycle after).
  HOLE_R0 and GROWTH_K are locked together — bumping HOLE_R0 by factor f
  scales starter-hole area by f², so K must also scale by f² to preserve
  bites-per-level. World generation also biases the starter oasis (inside
  STARTER_RADIUS) to place clusters only from items with base radius ≤ 25,
  keeping the L1 view from being walled off by watermelon clusters. Re-run
  sims on 3+ seeds before changing these.
- Growth is scale-free: `r' = √(r² + GROWTH_K·s²)`; points = `s²/8`. If you change
  one, the pacing tests will tell you.

## Testing

```
npm test           # 202 unit tests (node --test tests/unit/*.test.js)
npm run test:e2e   # 11 Playwright tests: real steering → swallow → growth,
                   # pause/mute/best persistence, Cmd+Tab stuck-key,
                   # collection overlay (Escape + P capture), HUD map
                   # button flow, map DOM shape, mobile boot, mobile
                   # virtual joystick steers + hides on pause, desktop
                   # confirms the joystick stays absent
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
