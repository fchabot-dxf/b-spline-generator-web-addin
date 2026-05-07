/**
 * Plunge Depth — single slider+number input controlling how far the
 * stamp carves into (or rises above) the terrain.
 *
 * The mask shape is technically depth-dependent for vbit/adaptive (the
 * slope cap moves with depth), so changing the slider needs a re-
 * rasterize. ctx.requestDepthChange handles the smart immediate-rebuild
 * + (immediate-or-debounced)-remask split based on whether fillet is
 * active.
 */
export function initDepth(ctx) {
  return ctx.registerSyncs('depth',
    ctx.bindNumberSlider('stampDepth', 'stampDepthSlider', 'depth'),
  );
}
