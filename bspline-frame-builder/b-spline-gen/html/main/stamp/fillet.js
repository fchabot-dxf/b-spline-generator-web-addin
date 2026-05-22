/**
 * Edge Fillet — pair of controls (Radius + Sharpness) shaping the same
 * curve. Sharpness only matters when Radius > 0. Both are mask-shape
 * params, so changing either re-rasterizes.
 *
 * The fillet's per-profile behavior (vertical wall vs sloped, what
 * Z_base sits at outside the boundary) is owned by the profile modules
 * in core/stamp/profiles/* — this UI module just owns the two inputs.
 */
export function initFillet(ctx) {
  return ctx.registerSyncs('fillet',
    ctx.bindNumberSlider('stampEdgeFilletRadius', 'stampEdgeFilletRadiusSlider', 'edgeFilletRadius'),
    ctx.bindNumberSlider('stampFilletPower',      'stampFilletPowerSlider',      'filletPower'),
  );
}
