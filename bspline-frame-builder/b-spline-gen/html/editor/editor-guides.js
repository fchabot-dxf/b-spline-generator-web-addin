/**
 * editor-guides.js — BOUNDARY-GUIDE (Fred 2026-09-26: "in editor show the
 * boundary box but hide it in the 3D preview"): the editor renderer for
 * GUIDE records (`role === GUIDE_ROLE`, declared in editor-lattice-
 * boundary.js). Today the one guide is each generated lattice's boundary
 * box (`latticeBoundaryGuide`); a future guide is one more record, not
 * new renderer code.
 *
 * A guide is drawn into its OWN sibling group, `#guide-layer`, next to
 * `#sketch-layer` — never inside it. Every exporter/3D reader
 * (serializeEditor/save/getLayerSvg, the stamp mask, refreshDrape,
 * pushState's undo snapshot, hit-testing) walks ONLY the sketch layer, so
 * a guide is excluded from all of them by construction — the SAME free
 * exclusion init.js's `outlinePreview` sibling already relies on. The
 * role picks the layer; no 3D/export code checks anything.
 *
 * Always drawn (no toggle — Fred: "it's by default") for every lattice
 * pattern that has actually been GENERATED (owned pieces exist — the same
 * test the Fusion Send uses, export-flow.js `_fusionLayerManifest`) and
 * has at least one visible layer. Redrawn from the three hooks that can
 * change it: a commit (Generate, a Size edit, undo/redo), a board-size
 * change (`setModelMetrics`), and `editorLayersChanged` (visibility).
 */
import { GUIDE_ROLE, latticeBoundaryGuide } from './editor-lattice-boundary.js';
import { boardRegion } from './editor-shape-lattice-interaction.js';
import { _ownedOnLayer } from './editor-lattice-pattern.js';
import { isExported } from './layers.js';

export const GUIDE_LAYER_ID = 'guide-layer';
/** The DOM mark of a drawn guide (tests and DOM readers key off this). */
export const GUIDE_ATTR = 'data-role';

const GUIDE_STROKE = { color: '#0696D7', width: 0.01, dasharray: '0.1,0.06' };

/** Every guide record the editor should draw right now:
 *  `[{ id, role, rect, layerId }]`. */
export function editorGuides(editor) {
  const layers = Array.isArray(editor && editor._layers) ? editor._layers : [];
  const region = boardRegion(editor);
  const guides = [];
  for (const layer of layers) {
    if (!layer || !layer.pattern) continue;
    // T76: a split pattern lives on its rails layer; its pieces are spread
    // across the kind-layers in `pattern.layers`.
    const ids = [layer.id, ...Object.values(layer.pattern.layers || {})];
    const kindLayers = ids.map((id) => layers.find((l) => l.id === id)).filter(Boolean);
    if (!kindLayers.some(isExported)) continue;
    if (!ids.some((id) => _ownedOnLayer(editor, id).length)) continue;
    guides.push({ ...latticeBoundaryGuide(layer.pattern, region), layerId: layer.id });
  }
  return guides;
}

function _guideLayer(editor) {
  if (editor._guideLayer) return editor._guideLayer;
  if (!editor._draw || !editor._sketchLayer) return null;
  const g = editor._draw.group().id(GUIDE_LAYER_ID).attr('pointer-events', 'none');
  editor._sketchLayer.after(g);
  editor._guideLayer = g;
  return g;
}

/** Redraw every guide from scratch (cheap: a handful of rects). */
export function refreshGuides(editor) {
  const g = editor && _guideLayer(editor);
  if (!g) return;
  g.clear();
  for (const guide of editorGuides(editor)) {
    if (guide.role !== GUIDE_ROLE) continue;
    const { x, y, w, h } = guide.rect;
    if (!(w > 0 && h > 0)) continue;
    g.rect(w, h).move(x, y).fill('none').stroke(GUIDE_STROKE)
      .attr({ [GUIDE_ATTR]: GUIDE_ROLE, 'data-guide': guide.id, 'data-guide-layer': guide.layerId });
  }
}

/** Keep the guides in sync with the layer roster (visibility toggles and
 *  layer add/remove don't go through a commit). Once per editor. */
export function installGuides(editor) {
  if (!editor || editor._guidesInstalled || typeof document === 'undefined') return;
  editor._guidesInstalled = true;
  document.addEventListener('editorLayersChanged', (e) => {
    if (!e.detail || e.detail.editor === editor) refreshGuides(editor);
  });
}
