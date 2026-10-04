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
import { fitPlane } from '../bricks/plane-fit.js';

/**
 * F35 item 18 (1), brick top FLAT: per grid point, the height of the plane its brick sits on --
 * NaN where no brick covers it. `brickOf` comes from the brick mask (editor-brick-height-mask.js);
 * each brick's plane is the least-squares fit (core/bricks/plane-fit.js) of `heights` over EVERY
 * grid point the brick covers -- the terrain as it is at THIS rebuild, so a terrain/sculpt change
 * that rebuilds without re-rasterizing the mask still lands each brick on the new ground. Fitted
 * in grid units centred on the brick (well conditioned at any resolution); a brick covering fewer
 * than 3 non-collinear points falls back to fitPlane's level plane at its mean height.
 */
export function flatBrickPlaneHeights(heights, brickOf, count, nx) {
  const out = new Float32Array(heights.length).fill(NaN);
  if (!brickOf || !(count > 0)) return out;
  const members = Array.from({ length: count }, () => []);
  for (let k = 0; k < brickOf.length; k++) {
    const b = brickOf[k];
    if (b >= 0 && b < count) members[b].push(k);
  }
  for (const ks of members) {
    if (!ks.length) continue;
    let mi = 0, mj = 0;
    for (const k of ks) { mi += k % nx; mj += Math.floor(k / nx); }
    mi /= ks.length; mj /= ks.length;
    const plane = fitPlane(ks.map((k) => ({ x: (k % nx) - mi, y: Math.floor(k / nx) - mj, z: heights[k] })));
    for (const k of ks) out[k] = plane.eval((k % nx) - mi, Math.floor(k / nx) - mj);
  }
  return out;
}

export function applyStampLayers(cleanHeights, layers, nx, nz, defaults = {}) {
  const { stampDepth = 0, stampEdgeFilletRadius = 0 } = defaults;
  const stampedHeights = new Float32Array(cleanHeights);
  if (!Array.isArray(layers)) return stampedHeights;

  // Step 2 unification: prefer tooling values from the matching editor
  // layer when one exists. Falls through to the stamp layer's own field,
  // then the global default.
  //
  // H22 item 2 (Fred, via H22 item 1's flagged finding): joined BY ID, not
  // position. `layers` is already filtered (isCarved) by _collectStampPasses
  // (rebuild.js), so its own forEach index never lines up with the full,
  // unfiltered _layers array once any earlier layer is hidden/non-carved —
  // a positional lookup silently read a DIFFERENT layer's settings.
  const editorLayers = (typeof window !== 'undefined'
                        && window.svgEditor
                        && Array.isArray(window.svgEditor._layers))
    ? window.svgEditor._layers : null;
  const editorById = editorLayers
    ? new Map(editorLayers.filter(l => l && l.id != null).map(l => [String(l.id), l]))
    : null;
  const editorFor = (pass) => (editorById && pass.id != null ? (editorById.get(String(pass.id)) || null) : null);

  layers.forEach((layer, layerIdx) => {
    if (!layer || !layer.enabled || !layer.svg || !layer.mask) return;

    const m         = layer.mask;
    const body      = ArrayBuffer.isView(m) ? m : m.body;
    const fillet    = ArrayBuffer.isView(m) ? null : m.fillet;
    const isStamped = ArrayBuffer.isView(m) ? null : m.isStamped;
    if (!body || body.length !== nx * nz) return;
    if (fillet && fillet.length !== nx * nz) return;

    const eLayer = editorFor(layer) || {};
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
    // Flat brick tops: fitted against the heights BELOW this layer (terrain + earlier layers), the
    // same base an Organic brick drapes onto
    const flatTop = (m && m.flatTop && m.flatTop.brickOf && m.flatTop.brickOf.length === nx * nz) ? m.flatTop : null;
    const planeZ = flatTop ? flatBrickPlaneHeights(stampedHeights, flatTop.brickOf, flatTop.count, nx) : null;

    for (let k = 0; k < nx * nz; k++) {
      const bodyVal   = body[k];
      const filletVal = fillet ? fillet[k] : 0;
      // a Flat brick point: its brick's plane REPLACES the terrain under it (suppression is moot);
      // grout (NaN) falls through and stays draped, exactly as in Organic
      if (planeZ && !Number.isNaN(planeZ[k])) {
        stampedHeights[k] = planeZ[k] + bodyVal * layerDepth + filletVal * filletAmplitude;
        continue;
      }
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
