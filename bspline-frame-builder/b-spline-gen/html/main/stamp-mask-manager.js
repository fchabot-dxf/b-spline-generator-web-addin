import { P, setStampLayerMask } from '../core/state.js';
import { rasterizeSvg } from '../core/stamp.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';

export async function updateStampMasks(nx, nz) {
  if (!P.stampLayers) return;
  const promises = P.stampLayers.map(async (layer, idx) => {
    if (!layer.svg || !layer.enabled) return;
    const blurIn = layer.blur ?? 0;
    const stampProfile = layer.profile ?? P.stampProfile;
    const stampDepth = layer.depth ?? P.stampDepth;
    const stampVBitAngle = layer.angle ?? P.stampVBitAngle;
    const edgeFilletRadius = layer.edgeFilletRadius ?? P.stampEdgeFilletRadius ?? 0;
    const filletPower = layer.filletPower ?? P.stampFilletPower ?? 2.2;
    const result = await rasterizeSvg(
      layer.svg,
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
    setStampLayerMask(idx, result);
  });
  await Promise.all(promises);
}

export async function refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode) {
  try {
    await updateStampMasks(nx, nz);
    scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode));
  } catch (e) {
    console.error('Failed to refresh stamp masks:', e);
  }
}
