/**
 * V-Bit profile — linear ramp from 0 (boundary) to maxDepth, slope set
 * by the V-bit angle. Caps at maxDepth at distIn = maxDepth/vSlope.
 *
 * For narrow features where R_eff < maxDepth/vSlope, the profile never
 * reaches maxDepth — physical depth limit of a real V-tool.
 */
export const vbit = {
  id: 'vbit',
  label: 'V-Bit (Linear)',

  Zp(ctx) {
    if (ctx.distIn <= 0) return 0;
    return Math.min(ctx.distIn * ctx.vSlope, ctx.maxDepth);
  },

  // Sloped wall — fillet straddles the boundary.
  hasVerticalWall: false,
  effectiveAngleRad(ctx) { return ctx.angleRad; },   // V-bit angle from slider

  // Z_p(0) = 0 — profile is already tangent to terrain at the boundary.
  boundaryDepth(_ctx) { return 0; },

  // Small bump bounded by fillet radius (same as flat — gives a visible
  // corner-rounding effect outside the boundary).
  filletBaseOutside(ctx, R) { return Math.min(R, ctx.maxDepth); },

  outsideExtent(_ctx) { return 0; },

  // Small rounded foot outside, height bounded by filletRadius.
  filletPart(_ctx, alpha) {
    return { bodyN: 0, filletN: alpha };
  },

  uiParams: ['stampVBitAngle'],
};
