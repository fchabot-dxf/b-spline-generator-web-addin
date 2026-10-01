import { P } from '../core/state.js';
import { rasterizeSvg } from '../core/stamp.js';
import { applyLayerTransform } from '../core/stamp/transform.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { getLayerSvg } from '../editor/editor-io.js';
import { isCarved } from '../editor/layers.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { frameWindowGeometry } from '../editor/contour-from-frame.js';
import { rectContains } from '../core/inset-window.js';

// Monotonic counter incremented on every refresh. Each in-flight
// rasterize captures the value at start; if it doesn't match at finish,
// a newer refresh has superseded it and we drop the result. Without this
// rapid slider drags can land an OLD mask after a newer one and paint
// stale stamps for one frame.
let _refreshGeneration = 0;

/**
 * SE3a: the mask-clear invariant — "a layer with no content has no
 * mask" — factored out as its own pure-ish function (only touches
 * `editorLayers` entries; no rasterizing, no DOM) so it's testable
 * without mocking rasterizeSvg/scheduleRebuild/getLayerSvg. `emptyIdxs`
 * is the set of indices into `editorLayers` that are visible but
 * currently have no content.
 */
export function clearEmptyLayerMasks(editorLayers, emptyIdxs) {
  for (const idx of emptyIdxs) {
    const layer = editorLayers[idx];
    if (layer) layer._mask = null;
  }
}

/**
 * H22 item 3: resolve the legacy P.stampLayers tooling-default entry (if
 * any) for an editor layer, joined by the editor layer's own id — never
 * by its current position in editor._layers.
 *
 * P.stampLayers is 3 fixed legacy slots predating per-layer editor
 * tooling; a FRESH editor roster's ids are '0'/'1'/'2'/... in creation
 * order (editor/layers.js's _nextLayerId — confirmed the same
 * correspondence app-init.js's MIGRATIONS relies on), so a layer's own id
 * IS its legacy slot index. Looking this up by ARRAY POSITION instead
 * breaks the moment a layer is reordered (H22 item 1's drag-to-reorder)
 * or an earlier layer is deleted — either shifts a later layer's position
 * without changing its id, silently borrowing a different legacy slot's
 * depth/profile/blur/etc.
 */
export function resolveLegacyStampLayer(eLayer) {
  const legacyIdx = Number(eLayer && eLayer.id);
  if (!Number.isInteger(legacyIdx) || legacyIdx < 0) return {};
  return (P.stampLayers && P.stampLayers[legacyIdx]) || {};
}

/**
 * T82 item 2: zero a rasterized stamp mask inside the frame's own inset window -- a literal hole through
 * the panel, so a stamp cannot carve material that isn't there. `hole` is insetWindowGeometry's own `.hole`
 * rectangle (board-local inches, origin top-left, y down -- the same `widthIn`/`heightIn` frame rasterizeSvg
 * itself renders into). `nx`/`nz` is the mask's own grid (`k = j*nx+i`, rasterizeSvg's own indexing): column
 * `i` maps directly to x (0 -> left edge, nx-1 -> right edge, no flip -- rasterizeSvg's own `fx` formula);
 * row `j` maps to y FLIPPED (j=0 -> board BOTTOM, j=nz-1 -> board TOP) -- the same row order
 * core/coords.js's gridRowToRasterY/rasterYToGridRow declare and core/render-topview.js's own top view
 * already reads back by, reused here rather than re-derived.
 */
export function clearStampMaskInWindow(result, hole, nx, nz, widthIn, heightIn) {
  if (!hole) return result;
  const iSpan = Math.max(1, nx - 1), jSpan = Math.max(1, nz - 1);
  for (let j = 0; j < nz; j++) {
    const y = heightIn * (1 - j / jSpan);
    for (let i = 0; i < nx; i++) {
      if (!rectContains(hole, (i / iSpan) * widthIn, y)) continue;
      const k = j * nx + i;
      result.body[k] = 0;
      result.fillet[k] = 0;
      result.isStamped[k] = 0;
    }
  }
  return result;
}

/**
 * Step 3 unification: produce one stamp pass per editor layer. The
 * editor's sketch is the single SVG document; each layer's content is
 * a partition of it (children with `data-layer="<layer.id>"`).
 *
 * SE4b: the P.stampLayers content mirror is retired — masks live only
 * on the editor layer's own `_mask`.
 */
export async function updateStampMasks(nx, nz) {
  const myGeneration = ++_refreshGeneration;
  const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
  const editorLayers = (editor && Array.isArray(editor._layers)) ? editor._layers : null;
  // T82 item 2: the frame's own inset window (if any) -- computed once per refresh (frame-level, not
  // per-layer); unconditional (not opt-in like the Shape Lattice's contour.fromFrame), since the window is
  // a literal hole in the panel regardless of what any individual stamp layer is doing.
  const windowHole = frameWindowGeometry(frameContext(editor))?.hole || null;

  // Build the work list. Each entry: { idx, layer, svg }
  const work = [];
  // SE3a: visible editor layers with no content — tracked separately from
  // "not in work" so the invariant below never touches a HIDDEN layer's
  // mask (a hidden layer still has content, just not shown right now).
  const emptyIdxs = [];

  if (editorLayers && editorLayers.length > 0) {
    editorLayers.forEach((layer, idx) => {
      if (!layer) return;
      // T27: isCarved(layer) — visible is the master, so a HIDDEN layer
      // never carves regardless of its own carve flag (mirrors the same
      // gate change in core/engine/rebuild.js).
      if (!isCarved(layer)) return;
      const svg = getLayerSvg(editor, layer.id);
      if (!svg) { emptyIdxs.push(idx); return; }   // nothing on this layer yet — skip
      work.push({ idx, layer, svg });
    });
  }

  // Invariant: a layer with no content has no mask. Without this, a
  // layer that just lost its content (Clear, or an edit that emptied it)
  // keeps rendering whatever it was stamping before, forever — the mask
  // was rasterized from content that no longer exists.
  clearEmptyLayerMasks(editorLayers, emptyIdxs);

  if (work.length === 0) return myGeneration === _refreshGeneration;

  const promises = work.map(async ({ layer, svg }) => {
    // Resolve tooling: editor wins, then the matching legacy P.stampLayers
    // entry (H22 item 3: joined by id, not by idx — see
    // resolveLegacyStampLayer above), then global P.*
    const eLayer = layer;
    const lLayer = resolveLegacyStampLayer(eLayer);

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
    if (windowHole) clearStampMaskInWindow(result, windowHole, nx, nz, P.widthIn, P.heightIn);
    layer._mask = result;
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
