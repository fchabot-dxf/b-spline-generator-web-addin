import { powerStep } from '../sdf.js';

/**
 * Flat profile — vertical wall + flat plateau at maxDepth.
 *
 * Z_p = maxDepth (inside), 0 (outside). The fillet creates a small
 * rounded foot outside the boundary whose height is bounded by the
 * fillet radius (NOT maxDepth) — without that bound, large fillet
 * radii produce a full-stamp-height "offset outline" ring around the
 * stamp.
 */
export const flat = {
  id: 'flat',
  label: 'Flat Endmill (Hard)',

  Zp(ctx) {
    return ctx.distIn > 0 ? ctx.maxDepth : 0;
  },

  // Vertical wall at the boundary → fillet sits entirely outside.
  hasVerticalWall: true,
  effectiveAngleRad(_ctx) { return Math.PI; },   // unused when hasVerticalWall
  // Wall angle from horizontal — used by the rasterizer to compute
  // geometric tangent-arc fillet extents (outR = R·tan(wall/2),
  // inR = outR·cos(wall)). 90° = vertical = quarter-arc fillet.
  wallAngleRad(_ctx) { return Math.PI / 2; },

  // Z_p evaluated at distIn = 0+, used for tangent matching.
  boundaryDepth(ctx) { return ctx.maxDepth; },

  // What Z_base should be in the fillet zone outside the boundary.
  // Bounded by filletRadius so the fillet is a small rounded foot, not a
  // full-height halo.
  filletBaseOutside(ctx, R) { return Math.min(R, ctx.maxDepth); },

  // How far outside the boundary the profile naturally extends (used by
  // the sentinel mask, not Z_p — flat doesn't extend outside on its own).
  outsideExtent(_ctx) { return 0; },

  // Fillet zone is OUTSIDE-only for flat — the wall is vertical, the
  // S-curve only needs to bridge terrain → wall foot at the boundary.
  // No interior fillet, so filletExtendsInside = false.
  filletExtendsInside: false,
  filletPart(_ctx, distIn, outR, _inR, filletPower) {
    const alpha = powerStep(-outR, 0, distIn, filletPower);
    return { bodyN: 0, filletN: alpha };
  },

  // Conditional UI inputs this profile needs from the panel.
  uiParams: [],
};
