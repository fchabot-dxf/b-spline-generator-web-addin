/**
 * Apply enabled stamp layers to a clean height field.
 *
 * Each stamp layer carries a two-channel mask:
 *   • body   — depth-normalized 0..1 contribution scaled by layerDepth
 *   • fillet — edge-rolloff 0..1 contribution scaled by filletAmplitude
 *   • isStamped (optional) — boolean mask of stamped pixels for suppression
 *
 * Older single-Float32Array masks (in-flight from before the two-channel
 * refactor) are accepted as a body-only mask.
 *
 * Per-layer suppression blends the underlying terrain toward a Gaussian-
 * smoothed copy of itself before adding the stamp; this prevents fine
 * detail from poking through deep stamps.
 *
 * Fillet amplitude must match the value the rasterizer baked into the
 * fillet channel (mask.metrics.effectiveFilletIn). Using the unclamped
 * slider value would scale the fillet larger than the channel was
 * normalized for — visible as a big lip on stamps where the rasterizer
 * had to clamp the fillet to the inscribed radius.
 */

import { gaussianSmooth } from '../gaussian.js';
import { dbg } from '../debug.js';

export function applyStampLayers(cleanHeights, layers, nx, nz, defaults = {}) {
  const { stampDepth = 0, stampEdgeFilletRadius = 0 } = defaults;
  const stampedHeights = new Float32Array(cleanHeights);
  if (!Array.isArray(layers)) return stampedHeights;

  // Step 2 unification: prefer tooling values from the matching editor
  // layer when one exists. Position-based mapping. Falls through to the
  // stamp layer's own field, then the global default.
  const editorLayers = (typeof window !== 'undefined'
                        && window.svgEditor
                        && Array.isArray(window.svgEditor._layers))
    ? window.svgEditor._layers : null;
  const editorAt = (idx) => (editorLayers ? (editorLayers[idx] || null) : null);

  layers.forEach((layer, layerIdx) => {
    if (!layer || !layer.enabled || !layer.svg || !layer.mask) return;

    const m         = layer.mask;
    const body      = ArrayBuffer.isView(m) ? m : m.body;
    const fillet    = ArrayBuffer.isView(m) ? null : m.fillet;
    const isStamped = ArrayBuffer.isView(m) ? null : m.isStamped;
    if (!body || body.length !== nx * nz) return;
    if (fillet && fillet.length !== nx * nz) return;

    const eLayer = editorAt(layerIdx) || {};
    const effectiveDepth = eLayer.depth ?? layer.depth ?? stampDepth;
    const effectiveSuppression = (typeof eLayer.suppression === 'number')
      ? eLayer.suppression
      : ((typeof layer.suppression === 'number') ? layer.suppression : 0);
    const effectiveSmoothing = eLayer.smoothing ?? layer.smoothing ?? 0;
    const effectiveProfile = eLayer.profile ?? layer.profile;

    dbg('STAMP DEBUG', `Applying stamp layer ${layerIdx} name=${layer.name} depth=${effectiveDepth} profile=${effectiveProfile} suppress=${effectiveSuppression}`);

    const suppressStrength = effectiveSuppression;
    const blurRadius = effectiveSmoothing || 0;
    const smoothedTerrain = suppressStrength > 0
      ? gaussianSmooth(cleanHeights, nx, nz, blurRadius)
      : null;

    const layerDepth = effectiveDepth;
    const layerSign  = layerDepth >= 0 ? 1 : -1;
    const filletRadius = (m && m.metrics && Number.isFinite(m.metrics.effectiveFilletIn))
      ? m.metrics.effectiveFilletIn
      : (eLayer.edgeFilletRadius ?? layer.edgeFilletRadius ?? stampEdgeFilletRadius);
    const filletAmplitude = layerSign * Math.min(filletRadius, Math.abs(layerDepth));

    for (let k = 0; k < nx * nz; k++) {
      const bodyVal   = body[k];
      const filletVal = fillet ? fillet[k] : 0;
      const stamped   = isStamped ? isStamped[k] : (bodyVal > 1e-6);
      if (!stamped && bodyVal < 1e-6 && filletVal < 1e-6) continue;

      if (suppressStrength > 0) {
        stampedHeights[k] = (stampedHeights[k] * (1 - suppressStrength))
                          + (smoothedTerrain[k] * suppressStrength);
      }
      stampedHeights[k] += bodyVal * layerDepth + filletVal * filletAmplitude;
    }
  });

  // NaN guard — fall back to the clean baseline (or 0).
  for (let k = 0; k < stampedHeights.length; k++) {
    if (isNaN(stampedHeights[k])) stampedHeights[k] = cleanHeights[k] || 0;
  }

  return stampedHeights;
}
