# Hole Foods (né Bottomless) — Design Doc (2026-07-02)

## What & why

A single-player, endless, top-down **hole-swallowing game** for the web (Hole.io / Donut County genre, per Owen's reference screenshots). You are a hole. You roll over a candy-colored world eating everything that fits — berries, cakes, toys, cars, buildings — and grow. The world is **procedurally generated and infinite**: biomes band outward from spawn, and each full biome cycle scales object sizes and points up, so "objects level up as you explore." No death, no timer, no end — a mindless, satisfying growth loop.

Success criteria: publish-quality feel (juice, sound, polish), runs from a local static server, works with mouse / touch / keyboard, decomposed modules per Owen's no-monolith rule, engine covered by unit tests + Playwright e2e.

## Approaches considered

1. **Vanilla JS + Canvas 2D, ES modules, zero runtime deps** ← chosen. The mechanic is circles on a plane; Canvas 2D reaches polish fastest, no build step, hosts from `python3 -m http.server`, matches packet-run conventions exactly.
2. Phaser 3 — physics/scenes for free, but its main value (tilemaps, atlases) goes unused with emoji/vector art; adds a dependency and load weight.
3. Three.js pseudo-3D (closest to real Hole.io) — much larger art/asset scope, biggest risk to the quality bar.

Art: **emoji rendered to cached offscreen canvases** (crisp, colorful, huge variety, zero asset pipeline; Apple emoji look great on Owen's Mac) + code-drawn ground, shadows, hole, and particles. Sound: **WebAudio-synthesized**, zero asset files.

## Core loop

- Hole steers toward pointer (mouse or touch) or WASD/arrow direction; velocity eases in.
- An object **fits** if `obj.r ≤ hole.r × 0.95`. Fitting objects within the pull radius get vacuumed toward the hole; when their center is deep enough inside, they **tip in**: 0.45 s fall animation (shrink, spin, slide to center, clipped to the pit), then score + particles + pop sound pitched by size.
- **Growth**: the hole's area accumulates a fraction of each swallowed object's area — `r = √(r0² + k·Σs²)`, k ≈ 0.35. This is scale-free: at any size, ~3 objects of your own scale grow you ~50 % in area, so pacing never degrades across biome cycles. Points are `round(s²/8)` (also scale-free). Levels are radius milestones `r0 × 1.22^(n−1)` (feedback only — burst ring, jingle, "LEVEL N!" floater).
- **Combo**: swallows ≤ 1.8 s apart build a streak; multiplier ×2/×3/×4/×5 at streaks 4/8/12/16.
- **Camera** zooms out as you grow (`zoom ≈ 1.15 × (22/r)^0.8`, clamped) — you feel bigger *and* see more. Screen shake scales with swallowed size.

## Procedural world

- Infinite plane in **480-unit chunks**, generated deterministically from `hash(seed, cx, cy)` — same seed → same world. `?seed=` URL param for reproducible runs (e2e uses this).
- **Biome bands** by distance from origin (~2 200 units per band): Berry Meadow → Orchard Grove → Sugar Bakery → Toybox Town → Funfair Boardwalk → Downtown, then the cycle repeats as "II", "III", … with sizes ×6 per full cycle (item tables already ramp within a cycle; ×6 keeps the Downtown→Meadow-II boundary continuous — ×12 was tried and looked absurd) — endless progression. Points derive from placed area (`s²/8`), so they scale automatically.
- Each chunk rolls 0–2 **pattern clusters** (ring, double ring, grid, spiral, arc, blob — the decorative arrangements from the reference art) of one item type, plus scattered singles and non-collectible ground decals. Density drops as item size grows.
- **Eaten objects stay eaten**: per-chunk `Set` of consumed indices, kept for the whole run. Chunks far from camera unload (regenerate identically on return).
- Ground: per-chunk flat color lerped smoothly across band boundaries + subtle per-biome pattern tile.

## Module map (each < 300 lines, one responsibility)

```
index.html            shell, ES module entry
css/base.css          tokens, canvas, typography
css/ui.css            HUD, overlays, buttons
js/config.js          ALL tuning numbers in one place
js/rng.js             hash + seeded PRNG streams
js/catalog.js         biomes, items (emoji, radius, points, hue), decals, tier scaling
js/patterns.js        cluster layout generators (pure)
js/world.js           chunk lifecycle, object queries, eaten tracking
js/hole.js            hole state: movement, xp, radius, levels (pure update)
js/swallow.js         fit/pull/fall state machine, scoring, combo (pure update)
js/camera.js          smooth follow, zoom, shake, world↔screen (pure math)
js/input.js           mouse/touch/keys → direction vector (DOM)
js/audio.js           WebAudio synth sfx + ambient pad + mute persistence (DOM)
js/sprites.js         emoji → offscreen canvas cache (DOM)
js/ground.js          biome colors, pattern tiles, chunk fill (DOM)
js/particles.js       particle/floater/ring pools (pure update, canvas draw)
js/render.js          scene orchestration: ground→shadows→objects→hole→effects (DOM)
js/hud.js             DOM HUD: score, level ring, size, combo, biome toast, overlays
js/main.js            bootstrap, resize, fixed-step loop, start/pause — wiring only
```

Engine modules (`rng`, `catalog`, `patterns`, `world`, `hole`, `swallow`, `camera`) are **DOM-free and headless** — unit tests drive the same API the game does. `window.__game` exposes live state for e2e.

## UI / screens

- **Start overlay**: title, tagline, PLAY button, best-run badge (localStorage), control hints; game world idles behind.
- **HUD**: level badge + XP progress (top-left), score (top-center), size readout in cm→m (cute), mute/pause (top-right), combo popup, biome-name toast on band entry.
- **Pause overlay**: resume, restart (two-tap confirm), sound toggle. No game-over — endless.
- Mobile: touch steering, responsive layout, devicePixelRatio-aware canvas.

## Testing

- `npm test` — `node --test tests/unit/*.test.js`: rng determinism; catalog integrity; pattern geometry; world determinism + eaten persistence + banding; growth monotonicity + level math; swallow fit/pull/combo rules. TDD (red→green) for all engine modules.
- `npm run test:e2e` — Playwright (pinned 1.58.2, same as packet-run): page boots with zero console errors; PLAY starts; driving toward a seeded object swallows it (score > 0, radius grows); mute persists; screenshots at desktop + iPhone viewports reviewed before ship.

## Amendment (2026-07-02, post-playtest): the fractal invariant

Owen's playtest at ~level 28 exposed the scale break: `ZOOM_MIN 0.26` let the hole outgrow the screen, so swallow particles walled the view and the vacuum reached past the visible edge. Fix shipped the same day — **the world is now self-similar at every scale**:

- Biome bands widen geometrically (×`CYCLE_SIZE_MULT` per cycle) instead of linearly, so a band takes about as long to cross at any size.
- Chunks come in per-cycle levels (`chunk size = CHUNK × 6^cycle`); grids whose chunks would span < 1/44th of the view are skipped (LOD), keeping loaded chunks bounded (< 1800) at any zoom.
- Zoom is effectively unclamped (`ZOOM_MIN 0.002`); with `SPEED_EXP 0.85` vs `ZOOM_EXP 0.8`, on-screen hole size (~150–220 px) and speed stay near-constant forever.
- Particle pool capped at 280 with a per-swallow effects budget; scores format compact ("56.0M") past a million.

Covered by `tests/unit/fractal.test.js` (band geometry, level ownership, bounded chunk counts, LOD skipping, cross-boundary queries).

## Out of scope (YAGNI)

Multiplayer/AI holes, timers/quests/skins/shops, app-store packaging, backend anything, save-mid-run world state (only best-run + mute persist).
