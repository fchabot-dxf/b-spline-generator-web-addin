/**
 * V-Bit profile — linear ramp from 0 (boundary) at the user's slope.
 *
 * Physical V-tool model: at horizontal distance d from the wall, the
 * tool reaches depth d × vSlope. The deepest reachable depth on a
 * stamp of inscribed radius R_eff is min(maxDepth, R_eff × vSlope) —
 * a tool can only carve as deep as its angle and the geometry allow.
 *
 * Trade-off: on narrow stamps with wide-angle bits the depth slider's
 * upper range produces no visible change (the cap absorbs it). The
 * metrics readout flags this with a yellow "Depth capped" warning so
 * the user knows what's going on.
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
  effectiveAngleRad(ctx) { return ctx.angleRad; },   // V-bit tip angle (legacy)
  // Wall angle from horizontal: tan(wall) = vSlope. For 90° tip this
  // is 45°; for sharper tips it approaches 90° (steeper wall). Used
  // for geometric tangent-arc fillet sizing.
  wallAngleRad(ctx) { return Math.atan(ctx.vSlope); },

  // Z_p(0) = 0 — profile is already tangent to terrain at the boundary.
  boundaryDepth(_ctx) { return 0; },

  // Small bump bounded by fillet radius (same as flat — gives a visible
  // corner-rounding effect outside the boundary).
  filletBaseOutside(ctx, R) { return Math.min(R, ctx.maxDepth); },

  outsideExtent(_ctx) { return 0; },

  // Vbit's wall is sloped, so the corner at the boundary is acute on
  // the wall side — the fillet has to extend INTO the wall to round
  // it off properly (otherwise it's just a tiny ridge sitting on
  // terrain). Mark filletExtendsInside so the rasterizer spans the
  // S-curve over [-outR, +inR] instead of [-outR, 0].
  filletExtendsInside: true,

  // True geometric tangent arc (not powerStep): a circle of radius rho
  // tangent to terrain at distIn = -outR (slope 0) AND tangent to the
  // sloped wall at distIn = +inR (slope vSlope). This eliminates the
  // slope-discontinuity ridge that powerStep creates at +inR (powerStep
  // is tangent-flat at both ends, but the wall has slope vSlope there).
  //
  //   rho = R / tan(wall/2) = R · (1 + cos(wall)) / sin(wall)
  //   z(distIn) = rho - sqrt(rho² - (distIn + outR)²)
  //
  // The engine multiplies filletN by `filletAmp = min(R, maxDepth)` at
  // apply time. To get the actual geometric height z (in inches), we
  // return z / filletAmp. We also cap z at maxDepth so the arc never
  // punches past the plunge-depth plateau on shallow stamps (where the
  // wall would itself be truncated at maxDepth before reaching +inR).
  filletPart(ctx, distIn, outR, _inR, _filletPower) {
    const wall = Math.atan(ctx.vSlope);
    const R = Math.max(1e-6, ctx.filletRadiusIn);
    const rho = R * (1 + Math.cos(wall)) / Math.sin(wall);
    const dx = distIn + outR;
    const z = rho - Math.sqrt(Math.max(0, rho * rho - dx * dx));
    const z_capped = Math.min(z, ctx.maxDepth);
    const filletAmp = Math.max(1e-6, Math.min(R, ctx.maxDepth));
    return { bodyN: 0, filletN: z_capped / filletAmp };
  },

  uiParams: ['stampVBitAngle'],
};
