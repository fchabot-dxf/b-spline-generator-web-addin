/**
 * Adaptive profile — flat plateau at maxDepth inside, fixed-angle 75°
 * tapered ramp outside. The 75° is the steepest a CNC tool can carve
 * cleanly; the ramp width auto-scales with depth to keep the angle
 * constant (= maxDepth / 1.3032).
 *
 * adaptSlope = 1 / tan(75°/2) ≈ 1.3032.
 */
const ADAPT_SLOPE = 1.3032;
const ADAPT_ANGLE_RAD = 75 * Math.PI / 180;

export const adaptive = {
  id: 'adaptive',
  label: 'Adaptive (Fine Detail)',

  Zp(ctx) {
    if (ctx.distIn >= 0) return ctx.maxDepth;
    return Math.max(0, ctx.maxDepth + ctx.distIn * ADAPT_SLOPE);
  },

  // Sloped wall (75° hardcoded) — fillet bias uses this angle, NOT the
  // V-bit slider (the V-bit angle has no effect on adaptive's ramp).
  hasVerticalWall: false,
  effectiveAngleRad(_ctx) { return ADAPT_ANGLE_RAD; },

  boundaryDepth(ctx) { return ctx.maxDepth; },   // Z_p(0) = maxDepth

  // Adaptive's natural 75° ramp is what defines the wall slope, so the
  // fillet softens the ramp's tail into terrain rather than replacing
  // it with a small bump (different choice from the other profiles).
  filletBaseOutside(ctx, _R) { return ctx.maxDepth; },

  // The natural ramp extends maxDepth/1.3032 past the boundary; the
  // sentinel uses this so terrain suppression covers the whole ramp.
  outsideExtent(ctx) { return ctx.maxDepth / ADAPT_SLOPE; },

  // Adaptive's fillet REPLACES the natural ramp (Z_base outside =
  // maxDepth, attenuated by alpha). So the fillet's contribution is
  // depth-scaling — goes into the body channel as `alpha`. At apply
  // time engine multiplies by layerDepth, giving the same scaling as
  // the natural plateau.
  filletPart(_ctx, alpha) {
    return { bodyN: alpha, filletN: 0 };
  },

  uiParams: [],
};
