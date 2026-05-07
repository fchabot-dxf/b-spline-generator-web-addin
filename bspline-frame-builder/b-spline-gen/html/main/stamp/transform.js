/**
 * Per-layer Transform — position (tx, ty), rotation, scale, and mirror
 * flips. These are LAYER-ONLY fields (not in global P) so they're
 * wired with bindLayerOnlyNumber/Checkbox helpers that write directly
 * to the active layer and trigger a remask.
 *
 * Applied at rasterize time by core/stamp/transform.js — wraps the
 * SVG content in a `<g transform="...">` before rasterization.
 */
export function initTransform(ctx) {
  return ctx.registerSyncs('transform',
    ctx.bindLayerOnlyNumber('stampTx',       'stampTxSlider',       'tx'),
    ctx.bindLayerOnlyNumber('stampTy',       'stampTySlider',       'ty'),
    ctx.bindLayerOnlyNumber('stampRotation', 'stampRotationSlider', 'rotation'),
    ctx.bindLayerOnlyNumber('stampScale',    'stampScaleSlider',    'scale'),
    ctx.bindLayerOnlyCheckbox('stampMirrorX', 'mirrorX'),
    ctx.bindLayerOnlyCheckbox('stampMirrorY', 'mirrorY'),
  );
}
