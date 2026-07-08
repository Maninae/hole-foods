// ALL tuning numbers live here. Change gameplay feel in this file only.
// Pure module: no DOM.

export const CONFIG = {
  // World structure
  CHUNK: 480,             // world units per chunk side
  BAND_WIDTH: 2200,       // world units per biome band (distance from origin)
  BAND_BLEND: 500,        // ground-color blend zone at band edges
  STARTER_RADIUS: 700,    // within this distance of origin, force extra tiny food
  UNLOAD_CHUNKS: 14,      // unload generated chunks farther than this many chunks from camera

  // Hole
  HOLE_R0: 26.4,          // starting radius (world units)
  GROWTH_K: 0.0288,       // fraction of swallowed object area added to hole area
  FIT_FACTOR: 0.95,       // object fits if obj.r <= hole.r * FIT_FACTOR
  LEVEL_R_GROWTH: 1.22,   // level n at radius HOLE_R0 * LEVEL_R_GROWTH^(n-1)
  SPEED_BASE: 260,        // world units/sec at starting size
  SPEED_EXP: 0.85,        // speed ~ (r/r0)^SPEED_EXP — with ZOOM_EXP 0.8 this
                          // keeps on-screen speed near-constant at every scale
  ACCEL: 7,               // velocity easing rate (1/s)

  // Swallowing — support-based rim physics, no long-range attraction.
  // overhang = fraction of an object's footprint over the void (0.5 = its
  // center is on the rim). Objects teeter below SLIDE_START, creep in past
  // it, and tip the moment their center loses support (overhang >= 0.5).
  RIM_SLIDE_START: 0.3,   // overhang where the edge starts giving way
  RIM_SLIDE_ACCEL: 520,   // slide acceleration at full overhang (scales w/ hole)
  RIM_TILT_MAX: 0.55,     // radians of lean as overhang approaches tipping
  RIM_WOBBLE_FREQ: 9,     // teeter wobble (rad/s)
  RIM_WOBBLE_AMP: 0.07,   // teeter wobble amplitude (radians)
  FALL_TIME: 0.5,         // seconds for the tip-over + drop animation
  POINTS_DIV: 8,          // points = round(r^2 / POINTS_DIV)

  // Combo
  COMBO_WINDOW: 1.8,      // seconds between swallows to keep a streak alive
  COMBO_STEPS: [4, 8, 12, 16], // streak thresholds for x2, x3, x4, x5

  // Camera
  ZOOM_BASE: 1.1,
  ZOOM_EXP: 0.8,          // zoom ~ (r0/r)^ZOOM_EXP — grow on screen AND see more
  ZOOM_MIN: 1e-7,         // effectively unclamped — leveled chunks keep the
                          // per-frame work bounded at any zoom (fractal world)
  ISO_Y: 0.72,            // pseudo-3D squash: ground plane compressed in Y,
                          // objects billboarded upright on it
  ZOOM_MAX: 1.1,
  CAM_EASE: 4.5,          // camera follow easing (1/s)
  ZOOM_EASE: 1.6,         // zoom easing (1/s)

  // Biome cycling ("objects level up as you explore")
  BANDS_PER_CYCLE: 6,
  CYCLE_SIZE_MULT: 6,     // object size multiplier per full biome cycle

  // Vertical stacks ("towers"). A stackable item may spawn as N identical
  // units at one ground position; only the base is interactive, the units
  // above draw as a vertical strip. Eating the base kicks off a per-unit
  // AVALANCHE (see js/collapse.js): units detach bottom-up, tumble
  // ballistically, and settle as an ordinary-idle radial heap around the
  // base. Short piles (alive < TOPPLE_MIN) use the same system with a
  // tight target radius so units mostly hop into the hole, feeding the
  // combo chain.
  STACK_OASIS_CHANCE: 0.5,      // per oasis chunk: probability at least one tower spawns
  STACK_OASIS_MAX: 2,           // at most this many towers per oasis chunk
  STACK_DESERT_BEACON_PROB: 0.02, // per desert chunk: probability of a lone beacon tower
  STACK_HEIGHT_MIN: 6,          // shortest tower
  STACK_HEIGHT_MAX: 14,         // typical tallest tower
  STACK_BEACON_MIN: 12,         // desert beacons at least this tall
  STACK_BEACON_MAX: 24,
  STACK_UNIT_OVERLAP: 0.55,     // screen-Y step between stacked units (fraction of unit height).
                                // 0.55 = each unit visibly sits ON the one below (~half overlap),
                                // so a still tower reads unambiguously as vertical vs. a ground line.
  STACK_LEAN_ACCUM: 0.08,       // per-idx lean amplification up the column
  STACK_JITTER_X: 0.08,         // per-unit x-jitter, ±fraction of unit diameter (hand-stacked feel)
  STACK_JITTER_ROT_DEG: 3,      // per-unit rotation jitter (±degrees). Deterministic per (stackId, idx)
                                // so the column doesn't shimmer frame to frame.
  STACK_PERSPECTIVE: 0.015,     // scale gain per idx up the column (camera-above → higher = closer)
  STACK_PERSPECTIVE_CAP: 0.25,  // cap on total perspective scale gain (a 24-tall tower tops out here)
  STACK_SWAY_TOP_DEG: 2.5,      // idle-sway amplitude at the TIP of a tall column (degrees).
                                // Scales down with height so a 6-unit pile barely moves. THE cue
                                // that separates a live column from a ground line — ground never moves.
  STACK_SWAY_PERIOD: 3.2,       // seconds per sway cycle; phase from stackId hash
  STACK_SWAY_HEIGHT_REF: 10,    // sway hits full amplitude at this many units of height
  STACK_CAPSULE_ALPHA: 0.14,    // soft dark backdrop behind a column — ambient occlusion, binds units
  STACK_CAPSULE_WIDTH: 1.05,    // capsule width, multiples of unit diameter (slightly wider than sprite)
  STACK_SHADOW_WIDEN: 1.35,     // tower base shadow is wider than a single's (visually anchors the column)
  STACK_SHADOW_DARKEN: 1.5,     // and darker
  STACK_TOPPLE_MIN: 8,          // alive units required for the tall-tower avalanche path (else slump-avalanche)
  STACK_TOPPLE_FLOATER_CAP: 10, // temporarily raised score-floater cap during a collapse

  // --- Formations: multi-column stacks (pyramid, prism) ---
  // A formation binds K adjacent columns into ONE visual object with chain
  // destabilization: tipping one column rolls the neighbors to collapse
  // after a small delay. Each column is still an ordinary stack (own stackId,
  // own avalanche); the formation is a decoration + coordination layer.
  FORMATION_SPACING_FRAC: 1.0,          // column spacing as fraction of unit DIAMETER (1.0 = touching)
  FORMATION_PYRAMID_CHANCE: 0.28,       // per-oasis probability of a pyramid centerpiece
  FORMATION_PYRAMID_PEAK_MIN: 3,        // peak column height 3 → profile [1,2,3,2,1], 9 units
  FORMATION_PYRAMID_PEAK_MAX: 5,        // peak 5 → 25 units (roughly cluster-sized)
  FORMATION_PRISM_CHANCE: 0.06,         // per-oasis probability of a skyscraper (rarer than pyramids)
  FORMATION_PRISM_WIDTH_MIN: 3,
  FORMATION_PRISM_WIDTH_MAX: 4,
  FORMATION_PRISM_HEIGHT_MIN: 8,
  FORMATION_PRISM_HEIGHT_MAX: 14,
  FORMATION_PRISM_MAX_UNITS: 56,        // hard cap on prism total (W*H); reject beyond this
  FORMATION_CHAIN_PROB: 0.7,            // per-neighbor probability the chain fires from a collapsing column
  FORMATION_CHAIN_DELAY_MIN: 0.12,      // seconds; chain-triggered avalanches begin at this + hashed jitter
  FORMATION_CHAIN_DELAY_MAX: 0.28,
  FORMATION_MAX_AIRBORNE: 80,           // if total airborne units exceed this, delay further chain starts

  // --- Avalanche collapse (Part B) ---
  // On base tip, the column detaches BOTTOM-UP with a stagger; each unit
  // becomes a ballistic body with fake z (height above ground), horizontal
  // velocity out into a cone away from the hole, gravity + 1-2 damped
  // bounces, then settles as an ordinary idle. Deterministic final resting
  // positions (seeded per unit) let the landing-cap contract stay testable.
  STACK_AVAL_STAGGER: 0.03,       // seconds between successive unit detaches (bottom-up)
  STACK_AVAL_PRELEAN_TIME: 0.15,   // Jenga "losing balance" beat before first detach (tall columns only)
  STACK_AVAL_PRELEAN_DEG: 10,      // pre-lean angle (degrees) at t = PRELEAN_TIME (the Jenga read)
  STACK_AVAL_COLLAPSE_ANIM_TIME: 0.5,  // total anim window the column sags + sinks WITH the falling base.
                                       // Matches FALL_TIME so the column reaches its final crumble
                                       // pose right as the base finalizes into the pit. Without this,
                                       // still-stacked members froze at the 10-deg mark from t=0.15
                                       // onward and read as motionless while the base was swallowed.
  STACK_AVAL_COLLAPSE_LEAN_DEG: 25,    // final lean angle at anim end (grows past PRELEAN_DEG)
  STACK_AVAL_COLLAPSE_SINK_FRAC: 0.45, // fraction of a unit's screen height the column sinks by
                                       // anim end, matching the base's descent into the pit
  STACK_AVAL_GRAVITY: 4800,        // z-gravity in world-units / s². Heavy on purpose: collapses
                                   // should drop fast and become eatable quickly (owner feedback:
                                   // no floaty launches, no waiting out bounces). Units detach
                                   // with vz = 0 — a pure drop from their stacked height; any
                                   // upward impulse reads as the tower sprouting from its top.
  STACK_AVAL_SPIN_RATE_DEG: 540,   // max spin rate (deg/s), signed random per unit
  STACK_AVAL_BOUNCE_VZ: -0.25,      // vz multiplier on landing (elastic-ish)
  STACK_AVAL_BOUNCE_SPIN: 0.7,     // spin multiplier on bounce
  STACK_AVAL_MIN_VZ_SETTLE: 25,    // once |vz| drops below this on landing, unit is settled
  STACK_AVAL_MAX_BOUNCES: 1,       // fallback cap on bounces (in case damping picks a slow decay)
  STACK_AVAL_MAX_FLIGHT: 3.5,      // seconds, hard cap on airborne time so a stuck unit can't lock
  STACK_AVAL_DUST_INTERVAL: 0.06,  // min seconds between dust puffs during an avalanche (throttle)
  STACK_AVAL_THUMP_INTERVAL: 0.11, // min seconds between thump sfx during an avalanche (throttle)
  STACK_AVAL_SPIRAL_SPACING_TALL: 1.15, // sunflower spacing as fraction of unit DIAMETER (tall).
                                        // 1.15 places adjacent settle targets ~1.15 diameters apart,
                                        // above the min-separation threshold that keeps identical
                                        // sprites from fusing into a caterpillar row under ISO_Y.
  STACK_AVAL_SPIRAL_SPACING_SLUMP: 0.35, // sunflower spacing for short piles (fraction of unit
                                         // diameter). Tight so most units still sit inside rim
                                         // reach and the eat-through-tower combo chain fires.
  STACK_AVAL_FORWARD_SHIFT: 0.85,  // spiral pivot offset along the away-from-hole direction, in
                                   // units of spiral spacing. Combined with the behind-half squash
                                   // this delivers the owner-requested ~60/40 forward bias while
                                   // keeping the min-separation guarantee.
  STACK_AVAL_BEHIND_SQUASH: 0.55,  // multiplier applied to the local x of any target that lands
                                   // behind the pivot (post-shift). Keeps a few units on the
                                   // hole-adjacent side (the "spilled sideways/short" case).

  // --- Occlusion visibility (js/render-overlay.js) ---
  // The billboard pass draws sprites over the ground pass, so a big sprite
  // parked over the hole made it 100% invisible. We fade non-fittable
  // occluders and paint a small screen-space rim overlay when the hole
  // is covered. Fittable objects stay full alpha so teeter reads.
  OCCLUDER_ALPHA: 0.35,
  SPECK_FADE_MIN_PX: 1.5,          // screen radius (px) at/below which an object is culled
  SPECK_FADE_FULL_PX: 5,           // screen radius (px) at/above which it draws fully opaque;
                                   // between the two it fades — outgrown specks melt away
  DECAL_ALPHA: 0.28,               // ground-flavor decals: quiet texture, never mistaken for
                                   // an eatable item (owner feedback)   // alpha multiplier for a sprite/tower covering the hole
  OVERLAY_FADE_S: 0.15,   // seconds to fade the always-visible rim overlay in/out
};
