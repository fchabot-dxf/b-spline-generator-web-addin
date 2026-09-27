/**
 * Per-layer Transform — position (tx, ty), rotation, scale, and mirror
 * flips. These are LAYER-ONLY fields (not in global P) so they're
 * wired with bindLayerOnlyNumber/Checkbox helpers that write directly
 * to the active layer and trigger a remask.
 *
 * Applied at rasterize time by core/stamp/transform.js — wraps the
 * SVG content in a `<g transform="...">` before rasterization.
 */
import { STAMP_TRANSFORM_FIELDS, stampTransformScope } from '../formula-fields.js';

export function initTransform(ctx) {
  const formulaScope = stampTransformScope(ctx.activeLayer); // F15: formulas over the active layer's own values
  return ctx.registerSyncs('transform',
    ...STAMP_TRANSFORM_FIELDS.map((f) => ctx.bindLayerOnlyNumber(f.id, `${f.id}Slider`, f.field, { formulaScope })),
    ctx.bindLayerOnlyCheckbox('stampMirrorX', 'mirrorX'),
    ctx.bindLayerOnlyCheckbox('stampMirrorY', 'mirrorY'),
  );
}
