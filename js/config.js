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
  HOLE_R0: 22,            // starting radius (world units)
  GROWTH_K: 0.35,         // fraction of swallowed object area added to hole area
  FIT_FACTOR: 0.95,       // object fits if obj.r <= hole.r * FIT_FACTOR
  LEVEL_R_GROWTH: 1.22,   // level n at radius HOLE_R0 * LEVEL_R_GROWTH^(n-1)
  SPEED_BASE: 260,        // world units/sec at starting size
  SPEED_EXP: 0.85,        // speed ~ (r/r0)^SPEED_EXP — with ZOOM_EXP 0.8 this
                          // keeps on-screen speed near-constant at every scale
  ACCEL: 7,               // velocity easing rate (1/s)

  // Swallowing
  PULL_FACTOR: 1.9,       // pull range = hole.r * PULL_FACTOR + obj.r
  PULL_ACCEL: 1400,       // peak pull acceleration (world units/s^2)
  FALL_TIME: 0.45,        // seconds for the tip-in animation
  POINTS_DIV: 8,          // points = round(r^2 / POINTS_DIV)

  // Combo
  COMBO_WINDOW: 1.8,      // seconds between swallows to keep a streak alive
  COMBO_STEPS: [4, 8, 12, 16], // streak thresholds for x2, x3, x4, x5

  // Camera
  ZOOM_BASE: 1.1,
  ZOOM_EXP: 0.8,          // zoom ~ (r0/r)^ZOOM_EXP — grow on screen AND see more
  ZOOM_MIN: 0.002,        // effectively unclamped — leveled chunks keep the
                          // per-frame work bounded at any zoom (fractal world)
  ZOOM_MAX: 1.1,
  CAM_EASE: 4.5,          // camera follow easing (1/s)
  ZOOM_EASE: 1.6,         // zoom easing (1/s)

  // Biome cycling ("objects level up as you explore")
  BANDS_PER_CYCLE: 6,
  CYCLE_SIZE_MULT: 6,     // object size multiplier per full biome cycle
};
