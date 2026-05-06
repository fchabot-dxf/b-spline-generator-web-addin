/**
 * V-Bit profile — linear ramp from 0 (boundary) to maxDepth.
 *
 * The slope is the user's vSlope by default, but auto-steepens when
 * the geometry is too narrow to reach maxDepth at that slope —
 * effective slope = max(vSlope_user, maxDepth / R_eff). This keeps
 * the depth slider responsive across its whole range on narrow
 * stamps (otherwise vbit caps at R_eff × vSlope and most of the
 * slider feels binary). Trade-off: on narrow geometry the rendered
 * "angle" is steeper than the slider asks for — but the slider's
 * visible effect tracks the user's intent at every value.
 *
 * On wide geometry (R_eff × vSlope ≥ maxDepth) the user's vSlope is
 * used as-is — the cap kicks in naturally at maxDepth, identical to
 * the original physical V-tool behavior.
 */
export const vbit = {
  id: 'vbit',
  label: 'V-Bit (Linear)',

  Zp(ctx) {
    if (ctx.distIn <= 0) return 0;
    const R_eff = Math.max(1e-6, ctx.R_eff);
    // Auto-steepen so the slider always reaches maxDepth at the
    // deepest interior point, even on narrow geometry.
    const minSlopeForFullDepth = ctx.maxDepth / R_eff;
    const effectiveSlope = Math.max(ctx.vSlope, minSlopeForFullDepth);
    return Math.min(ctx.distIn * effectiveSlope, ctx.maxDepth);
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
