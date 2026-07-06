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
  // units at one ground position — only the base is interactive; the units
  // above draw as a vertical strip. Eating the base slumps the tower down
  // one unit; a tall enough tower (alive >= TOPPLE_MIN) topples over
  // instead and its units land as ordinary ground items in a line.
  STACK_OASIS_CHANCE: 0.5,      // per oasis chunk: probability at least one tower spawns
  STACK_OASIS_MAX: 2,           // at most this many towers per oasis chunk
  STACK_DESERT_BEACON_PROB: 0.02, // per desert chunk: probability of a lone beacon tower
  STACK_HEIGHT_MIN: 6,          // shortest tower
  STACK_HEIGHT_MAX: 14,         // typical tallest tower
  STACK_BEACON_MIN: 12,         // desert beacons at least this tall
  STACK_BEACON_MAX: 24,
  STACK_UNIT_OVERLAP: 0.85,     // screen-Y offset between stacked units (fraction of unit height)
  STACK_LEAN_ACCUM: 0.08,       // per-idx lean amplification up the column
  STACK_SLUMP_TIME: 0.12,       // seconds for the column to drop one unit-height
  STACK_TOPPLE_TIME: 0.5,       // seconds for a 90° topple (matches FALL_TIME)
  STACK_TOPPLE_MIN: 8,          // alive units required for the tall-tower topple path
  STACK_TOPPLE_FLOATER_CAP: 10, // temporarily raised score-floater cap during a collapse
};
