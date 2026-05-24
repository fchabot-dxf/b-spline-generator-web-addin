import { P, setStampLayerMask } from '../core/state.js';
import { rasterizeSvg } from '../core/stamp.js';
import { applyLayerTransform } from '../core/stamp/transform.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { getLayerSvg } from '../editor/editor-io.js';

// Monotonic counter incremented on every refresh. Each in-flight
// rasterize captures the value at start; if it doesn't match at finish,
// a newer refresh has superseded it and we drop the result. Without this
// rapid slider drags can land an OLD mask after a newer one and paint
// stale stamps for one frame.
let _refreshGeneration = 0;

// Step 2 unification: prefer tooling values from the matching editor
// layer when one exists, falling back to the stamp-layer field, then
// the global P.* default. Position-based mapping (stamp pass i ↔ editor
// layer i) until each stamp pass formally points at an editor layer id.
function _editorLayerAt(idx) {
  try {
    if (typeof window === 'undefined' || !window.svgEditor) return null;
    const layers = window.svgEditor._layers;
    return Array.isArray(layers) ? (layers[idx] || null) : null;
  } catch (_) { return null; }
}

/**
 * Step 3 unification: produce one stamp pass per editor layer. The
 * editor's sketch is the single SVG document; each layer's content is
 * a partition of it (children with `data-layer="<layer.id>"`).
 *
 * Falls back to the legacy P.stampLayers iteration when:
 *   - the editor isn't loaded yet (early init), OR
 *   - the editor has no layers with content (empty drawing) but
 *     P.stampLayers carries legacy uploaded svgs.
 *
 * Masks are stored on the editor layer as `_mask` (so the compositor
 * can read them) AND on the matching P.stampLayers entry as `mask`
 * (legacy fallback for the existing applyStampLayers iteration path).
 */
export async function updateStampMasks(nx, nz) {
  const myGeneration = ++_refreshGeneration;
  const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
  const editorLayers = (editor && Array.isArray(editor._layers)) ? editor._layers : null;

  // Build the work list. Each entry: { source: 'editor'|'legacy', idx, layer, svg, tooling }
  const work = [];

  if (editorLayers && editorLayers.length > 0) {
    editorLayers.forEach((layer, idx) => {
      if (!layer) return;
      if (layer.visible === false) return;
      const svg = getLayerSvg(editor, layer.id);
      if (!svg) return;   // nothing on this layer yet — skip
      work.push({ source: 'editor', idx, layer, svg });
    });
  }

  // Legacy fallback: any P.stampLayers entry with svg+enabled that doesn't
  // already have a matching editor-layer pass (so a Browse upload predating
  // the unification still produces a stamp).
  if (Array.isArray(P.stampLayers)) {
    P.stampLayers.forEach((layer, idx) => {
      if (!layer || !layer.svg || !layer.enabled) return;
      // Skip if this position is already covered by an editor-layer pass.
      const alreadyCovered = work.some(w => w.source === 'editor' && w.idx === idx);
      if (alreadyCovered) return;
      work.push({ source: 'legacy', idx, layer, svg: layer.svg });
    });
  }

  if (work.length === 0) return myGeneration === _refreshGeneration;

  const promises = work.map(async ({ source, idx, layer, svg }) => {
    // Resolve tooling: editor wins, then legacy P.stampLayers[idx], then global P.*
    const eLayer = (source === 'editor') ? layer : (_editorLayerAt(idx) || {});
    const lLayer = (source === 'legacy') ? layer : (P.stampLayers?.[idx] || {});

    const blurIn = eLayer.blur ?? lLayer.blur ?? 0;
    const stampProfile = eLayer.profile ?? lLayer.profile ?? P.stampProfile;
    const stampDepth = eLayer.depth ?? lLayer.depth ?? P.stampDepth;
    const stampVBitAngle = eLayer.angle ?? lLayer.angle ?? P.stampVBitAngle;
    const edgeFilletRadius = eLayer.edgeFilletRadius ?? lLayer.edgeFilletRadius ?? P.stampEdgeFilletRadius ?? 0;
    const filletPower = eLayer.filletPower ?? lLayer.filletPower ?? P.stampFilletPower ?? 2.2;
    const layerTransform = {
      tx: eLayer.tx ?? lLayer.tx ?? 0,
      ty: eLayer.ty ?? lLayer.ty ?? 0,
      rotation: eLayer.rotation ?? lLayer.rotation ?? 0,
      scale: eLayer.scale ?? lLayer.scale ?? 1,
      mirrorX: (eLayer.mirrorX !== undefined) ? !!eLayer.mirrorX : !!lLayer.mirrorX,
      mirrorY: (eLayer.mirrorY !== undefined) ? !!eLayer.mirrorY : !!lLayer.mirrorY,
    };
    const transformedSvg = applyLayerTransform(svg, layerTransform, P.widthIn, P.heightIn);
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
    if (source === 'editor') {
      layer._mask = result;
      // Mirror to legacy slot if it exists — keeps the old compositor
      // path working during the transition.
      if (P.stampLayers?.[idx]) setStampLayerMask(idx, result);
    } else {
      setStampLayerMask(idx, result);
    }
  });
  await Promise.all(promises);
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
