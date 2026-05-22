import { P, setStampLayerMask } from '../core/state.js';
import { rasterizeSvg } from '../core/stamp.js';
import { applyLayerTransform } from '../core/stamp/transform.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';

// Monotonic counter incremented on every refresh. Each in-flight
// rasterize captures the value at start; if it doesn't match at finish,
// a newer refresh has superseded it and we drop the result. Without this
// rapid slider drags can land an OLD mask after a newer one and paint
// stale stamps for one frame.
let _refreshGeneration = 0;

export async function updateStampMasks(nx, nz) {
  if (!P.stampLayers) return;
  const myGeneration = ++_refreshGeneration;
  const promises = P.stampLayers.map(async (layer, idx) => {
    if (!layer.svg || !layer.enabled) return;
    const blurIn = layer.blur ?? 0;
    const stampProfile = layer.profile ?? P.stampProfile;
    const stampDepth = layer.depth ?? P.stampDepth;
    const stampVBitAngle = layer.angle ?? P.stampVBitAngle;
    const edgeFilletRadius = layer.edgeFilletRadius ?? P.stampEdgeFilletRadius ?? 0;
    const filletPower = layer.filletPower ?? P.stampFilletPower ?? 2.2;
    // Apply the layer's per-layer transform (tx/ty/rotation/scale/
    // mirror) before rasterization. Falls through to the original SVG
    // when the transform is identity.
    const layerTransform = {
      tx: layer.tx ?? 0,
      ty: layer.ty ?? 0,
      rotation: layer.rotation ?? 0,
      scale: layer.scale ?? 1,
      mirrorX: !!layer.mirrorX,
      mirrorY: !!layer.mirrorY,
    };
    const transformedSvg = applyLayerTransform(layer.svg, layerTransform, P.widthIn, P.heightIn);
    const result = await rasterizeSvg(
      transformedSvg,
      nx,
      nz,
      blurIn,
      P.widthIn,
      P.heightIn,
      stampProfile,
      stampDepth,
      stampVBitAngle,
      edgeFilletRadius,
      filletPower
    );
    // Drop the result if a newer refresh has started. Comparing to the
    // global generation (rather than just `myGeneration === current`)
    // means newer raster passes can clobber older ones in any order.
    if (myGeneration !== _refreshGeneration) return;
    setStampLayerMask(idx, result);
  });
  await Promise.all(promises);
  // Returns true only for the LATEST generation — caller can use this to
  // skip rebuilding when it knows a newer refresh is already running.
  return myGeneration === _refreshGeneration;
}

export async function refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode) {
  try {
    const isLatest = await updateStampMasks(nx, nz);
    if (!isLatest) return;
    scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode));
    // Notify any UI that wants to read the per-layer mask.metrics now
    // that they're freshly computed (e.g. the panel's metrics readout).
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('stampMaskUpdated'));
    }
  } catch (e) {
    console.error('Failed to refresh stamp masks:', e);
  }
}
