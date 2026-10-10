import { P } from '../core/state.js';
import { applyBrickHeightGreys } from '../editor/brick-height-grey.js';
import { rasterizeSvg } from '../core/stamp.js';
import { applyLayerTransform } from '../core/stamp/transform.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { deferToHold } from '../core/engine/scheduler.js';
import { getLayerSvg } from '../editor/editor-io.js';
import { isCarved } from '../editor/layers.js';
import { frameContext, frameSolidSpec } from '../editor/editor-frame-profile.js';
import { frameLoopsWorld } from '../core/preview/frame-mesh.js';
import { maskEdgeSource } from '../core/bricks/mask-edge.js';
import { frameWindowGeometry } from '../editor/contour-from-frame.js';
import { rectContains } from '../core/inset-window.js';
import { layerHasBrickPieces, brickDepth, elementGroutWidth, BRICK_KINDS } from '../editor/editor-brick-tool.js';
import { rasterizeBrickHeightMask } from '../editor/editor-brick-height-mask.js';
import { withLoadingStage } from '../core/loading-signal.js';

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
    if (layer) { layer._mask = null; layer._brickMask = null; }
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
      if (result.flatTop) result.flatTop.brickOf[k] = -1; // F35 item 18: no Flat brick top in the hole either
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
/** Item 74n: the panel's trim loop in board inches (editor: y down) -- the SAME loop the 3D preview trims the panel on
 *  (core/preview/frame-mesh.js frameLoopsWorld, from frameSolidSpec), so the bricks' edge height is carried past exactly
 *  that outline; null with no frame outline (the board rectangle = the grid's own edge, nothing outside it). */
export function panelTrimOutline(ctx, nx, nz, widthIn, heightIn) {
  const spec = ctx && ctx.defs && ctx.record ? frameSolidSpec(ctx.defs, ctx.record, { widthIn, heightIn }) : null;
  if (!spec || !spec.outerPrimitives) return null;
  const loop = frameLoopsWorld(spec, { W: widthIn, H: heightIn, nx, nz }).panel;
  return loop && loop.length >= 3 ? loop.map((p) => ({ x: p.x + widthIn / 2, y: heightIn / 2 - p.y })) : null;
}

export async function updateStampMasks(nx, nz) {
  const myGeneration = ++_refreshGeneration;
  const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
  const editorLayers = (editor && Array.isArray(editor._layers)) ? editor._layers : null;
  // T82 item 2: the frame's own inset window (if any) -- computed once per refresh (frame-level, not
  // per-layer); unconditional (not opt-in like the Shape Lattice's contour.fromFrame), since the window is
  // a literal hole in the panel regardless of what any individual stamp layer is doing.
  const windowHole = frameWindowGeometry(frameContext(editor))?.hole || null;
  // item 74n: past the panel outline, each brick mask carries its edge points' height (maskEdgeSource), computed once
  let edgeSource;
  const brickEdgeSource = () => (edgeSource !== undefined ? edgeSource
    : (edgeSource = maskEdgeSource(panelTrimOutline(frameContext(editor), nx, nz, P.widthIn, P.heightIn), nx, nz, P.widthIn, P.heightIn)));

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
      // F35 item 22 slice 3: a layer's ART (getLayerSvg leaves the brick-tool nodes out) and its BRICKS, each
      // its own mask -- combined per layer by the compositor (rebuild.js: the art pass, then the brick pass)
      const svg = getLayerSvg(editor, layer.id);
      const bricks = layerHasBrickPieces(editor, layer.id);
      if (!svg && !bricks) { emptyIdxs.push(idx); return; }   // nothing on this layer yet — skip
      work.push({ idx, layer, svg, bricks });
    });
  }

  // Invariant: a layer with no content has no mask. Without this, a
  // layer that just lost its content (Clear, or an edit that emptied it)
  // keeps rendering whatever it was stamping before, forever — the mask
  // was rasterized from content that no longer exists.
  clearEmptyLayerMasks(editorLayers, emptyIdxs);

  if (work.length === 0) return myGeneration === _refreshGeneration;

  const promises = work.map(async ({ layer, svg, bricks }) => {
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
    // F35 item 5: the Bricks layer carries real per-brick height variation
    // (shoulder/crown/chip + photo-surface detail, core/bricks/'s own
    // sampleHeight) the generic SVG-polygon rasterizer below has no way to
    // express (it only knows "inside this shape at a uniform depth") --
    // routed to its own rasterizer instead, which reads the SAME layer
    // content but produces a per-grid-point-varying mask. See
    // editor-brick-height-mask.js's own header.
    // the bricks' own height (brickDepth: relief + Raised/Carved), never the layer's art depth
    const bDepth = brickDepth(P.brickSettings);
    const brickResult = !bricks ? null
      : await withLoadingStage('heightMask', () => rasterizeBrickHeightMask(editor, { id: eLayer.id, depth: bDepth }, nx, nz, P.widthIn, P.heightIn,
          { topMode: P.brickSettings && P.brickSettings.brickTopMode, // F35 item 18: Flat | Organic brick tops
            surfaceStyle: P.brickSettings && P.brickSettings.surfaceStyle, // F35 item 18 (2): Clean | Weathered
            surfaceWear: P.brickSettings && P.brickSettings.surfaceWear, // the Weathered Wear slider (0..1)
            // the joint recess reaches the WIDEST element joint (per-element grout): every joint's gap is covered
            groutWidthIn: P.brickSettings ? Math.max(...BRICK_KINDS.map((k) => elementGroutWidth(P.brickSettings, k))) : undefined,
            groutProfile: P.brickSettings && P.brickSettings.grout && P.brickSettings.grout.profile, // Recessed | Flush
            groutDepthIn: P.brickSettings && P.brickSettings.grout && P.brickSettings.grout.depthIn,
            levels: P.brickSettings && P.brickSettings.elementLevelIn, // F35 item 16: per-element Level
            accent: P.brickSettings && P.brickSettings.accent, // F35 item 15: raised accents (Wall)
            frameBandAccents: P.brickSettings && P.brickSettings.frameBandAccents, // per band (advisor)
            brushAccent: P.brickSettings && P.brickSettings.brushAccent, // the Brush element's, per stroke
            accentSeed: P.brickSettings && P.brickSettings.seed }));
    const result = !svg ? null
      : await rasterizeSvg(
          applyLayerTransform(svg, layerTransform, P.widthIn, P.heightIn),
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
    for (const m of [result, brickResult]) if (m && windowHole) clearStampMaskInWindow(m, windowHole, nx, nz, P.widthIn, P.heightIn);
    if (brickResult) { const src = brickEdgeSource(); if (src) brickResult.edgeSource = src; }
    layer._mask = result;
    layer._brickMask = brickResult;
    layer._brickDepth = bDepth;
  });
  await Promise.all(promises);
  const latest = myGeneration === _refreshGeneration;
  // Fred 2026-10-08 (grey by height): the 2D bricks repaint from the fresh masks -- on a mask update only (every
  // caller of this function: a refresh, a rebuild), never per paint
  if (latest) paintBrickHeightGreys();
  return latest;
}

/** The editor's brick height greys (editor/brick-height-grey.js) from the masks just set; timed as the
 *  'brick-height-greys' performance measure (the phone repaint cost, read by the matrix / probes). */
function paintBrickHeightGreys() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) return;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  applyBrickHeightGreys(editor);
  if (typeof performance !== 'undefined' && performance.measure) {
    try { performance.measure('brick-height-greys', { start: t0, end: performance.now() }); } catch { /* an old engine: no measure */ }
  }
}

export async function refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode) {
  // a board size change holding the 3D (main/app-init.js STOCK_CHANGE_DEFERS): the latest pass runs once, at its end
  if (deferToHold('stamp-masks', () => refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode))) return;
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
