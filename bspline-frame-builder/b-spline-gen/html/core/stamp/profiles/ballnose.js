/**
 * Ballnose profile — true half-sphere across the stamp footprint.
 *
 * Z_p curve: maxDepth × sqrt(1 − (1 − distIn / R_eff)²), capped at the
 * geometry depth limit `min(maxDepth, R_eff)` so ballnose and a 90°
 * vbit reach the same physical depth on the same stamp. Without the
 * cap, ballnose was always plunging the full maxDepth on narrow
 * features — sat ~3× taller than vbit.
 *
 * R_eff is the inscribed-circle radius (passed via ctx).
 */
export const ballnose = {
  id: 'ballnose',
  label: 'Ballnose (Round)',

  Zp(ctx) {
    if (ctx.distIn <= 0) return 0;
    const R_eff = Math.max(1e-6, ctx.R_eff);
    const reachable = Math.min(ctx.maxDepth, R_eff);
    const t = Math.min(1, ctx.distIn / R_eff);
    const u = 1 - t;
    return reachable * Math.sqrt(Math.max(0, 1 - u * u));
  },

  // Effectively no wall (curve is tangent to terrain at the boundary)
  // but historically treated as vertical for fillet bias = 1 so the
  // fillet sits entirely outside.
  hasVerticalWall: true,
  effectiveAngleRad(_ctx) { return Math.PI; },   // unused when hasVerticalWall

  boundaryDepth(_ctx) { return 0; },             // Z_p(0) = 0

  filletBaseOutside(ctx, R) { return Math.min(R, ctx.maxDepth); },

  outsideExtent(_ctx) { return 0; },

  // Same as flat: small rounded foot outside, height bounded by filletRadius.
  filletPart(_ctx, alpha) {
    return { bodyN: 0, filletN: alpha };
  },

  uiParams: [],
};
