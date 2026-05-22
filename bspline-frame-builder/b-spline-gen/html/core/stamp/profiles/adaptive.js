import { powerStep } from '../sdf.js';

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
  // Wall angle from horizontal: 75°.
  wallAngleRad(_ctx) { return ADAPT_ANGLE_RAD; },

  boundaryDepth(ctx) { return ctx.maxDepth; },   // Z_p(0) = maxDepth

  // Adaptive's natural 75° ramp is what defines the wall slope, so the
  // fillet softens the ramp's tail into terrain rather than replacing
  // it with a small bump (different choice from the other profiles).
  filletBaseOutside(ctx, _R) { return ctx.maxDepth; },

  // The natural ramp extends maxDepth/1.3032 past the boundary; the
  // sentinel uses this so terrain suppression covers the whole ramp.
  outsideExtent(ctx) { return ctx.maxDepth / ADAPT_SLOPE; },

  // Adaptive's wall is the natural 75° ramp — same sloped-wall
  // structure as vbit, so the fillet should extend inside the
  // boundary. Without filletExtendsInside, the S-curve was pinned to
  // the boundary and didn't actually round the corner.
  filletExtendsInside: true,

  // Adaptive's fillet REPLACES the natural ramp (the alpha-shaped
  // body contribution fades the maxDepth plateau out into terrain).
  // Goes in the body channel since adaptive's plateau is depth-
  // scaling. At apply time the engine multiplies by layerDepth.
  // S-curve spans [-outR, +inR] because filletExtendsInside = true.
  filletPart(_ctx, distIn, outR, inR, filletPower) {
    const alpha = powerStep(-outR, inR, distIn, filletPower);
    return { bodyN: alpha, filletN: 0 };
  },

  uiParams: [],
};
