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
  const syncRadius = ctx.bindNumberSlider('stampEdgeFilletRadius', 'stampEdgeFilletRadiusSlider', 'edgeFilletRadius');
  const syncPower  = ctx.bindNumberSlider('stampFilletPower',      'stampFilletPowerSlider',      'filletPower');
  return ctx.registerModule({
    id: 'fillet',
    syncFromLayer(layer) {
      syncRadius(layer);
      syncPower(layer);
    },
  });
}
