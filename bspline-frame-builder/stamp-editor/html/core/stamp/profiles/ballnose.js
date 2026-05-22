import { powerStep } from '../sdf.js';

/**
 * Ballnose profile — true half-sphere across the stamp footprint.
 *
 * Z_p curve: maxDepth × sqrt(1 − (1 − distIn / R_eff)²). The half-
 * sphere always reaches maxDepth at the deepest interior point, so
 * the depth slider is responsive across its whole range on any
 * geometry (matches the new vbit "scale-to-fit" behavior — both
 * profiles reach the same depth on the same stamp).
 *
 * R_eff is the inscribed-circle radius (passed via ctx); it sets the
 * curve's horizontal extent, not its peak.
 */
export const ballnose = {
  id: 'ballnose',
  label: 'Ballnose (Round)',

  Zp(ctx) {
    if (ctx.distIn <= 0) return 0;
    const R_eff = Math.max(1e-6, ctx.R_eff);
    const t = Math.min(1, ctx.distIn / R_eff);
    const u = 1 - t;
    return ctx.maxDepth * Math.sqrt(Math.max(0, 1 - u * u));
  },

  // Effectively no wall (curve is tangent to terrain at the boundary)
  // but historically treated as vertical for fillet bias = 1 so the
  // fillet sits entirely outside.
  hasVerticalWall: true,
  effectiveAngleRad(_ctx) { return Math.PI; },   // unused when hasVerticalWall
  // Half-sphere is vertically tangent at the boundary → wall angle 90°.
  wallAngleRad(_ctx) { return Math.PI / 2; },

  boundaryDepth(_ctx) { return 0; },             // Z_p(0) = 0

  filletBaseOutside(ctx, R) { return Math.min(R, ctx.maxDepth); },

  outsideExtent(_ctx) { return 0; },

  // Ballnose is vertically-tangent at the boundary (the half-sphere
  // has infinite slope at distIn=0), so it's geometrically equivalent
  // to flat for fillet purposes — outside-only S-curve.
  filletExtendsInside: false,
  filletPart(_ctx, distIn, outR, _inR, filletPower) {
    const alpha = powerStep(-outR, 0, distIn, filletPower);
    return { bodyN: 0, filletN: alpha };
  },

  uiParams: [],
};
