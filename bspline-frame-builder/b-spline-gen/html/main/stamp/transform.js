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
  const syncTx = ctx.bindLayerOnlyNumber('stampTx',       'stampTxSlider',       'tx');
  const syncTy = ctx.bindLayerOnlyNumber('stampTy',       'stampTySlider',       'ty');
  const syncRot = ctx.bindLayerOnlyNumber('stampRotation', 'stampRotationSlider', 'rotation');
  const syncScale = ctx.bindLayerOnlyNumber('stampScale',   'stampScaleSlider',   'scale');
  const syncMx = ctx.bindLayerOnlyCheckbox('stampMirrorX', 'mirrorX');
  const syncMy = ctx.bindLayerOnlyCheckbox('stampMirrorY', 'mirrorY');

  return ctx.registerModule({
    id: 'transform',
    syncFromLayer(layer) {
      syncTx(layer);
      syncTy(layer);
      syncRot(layer);
      syncScale(layer);
      syncMx(layer);
      syncMy(layer);
    },
  });
}
