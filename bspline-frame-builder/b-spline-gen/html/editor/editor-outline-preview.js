/**
 * editor-outline-preview.js — SE12 Slice 3: the faint, non-interactive
 * preview of what a layer's "outline" fusionGeometry pick actually looks
 * like, drawn in editor._outlinePreviewLayer (a SIBLING of _sketchLayer,
 * created in init.js — every reader that matters (serializeEditor/save/
 * getLayerSvg, hit-testing, selection, pushState's undo snapshot,
 * refreshDrape) walks ONLY sketchLayer.children(), so this sibling is
 * excluded from all of them by construction, not by filtering code here).
 *
 * Rebuilt on COMMIT only (see editor.js's _notifyChange — a 'live' drag
 * frame never calls this), same timing refreshDrape already uses, per
 * the SE12 design doc's own item 2. A layer's fusionGeometry picker lives
 * outside the editor (the stamp panel sidebar, main/stamp/fusion-
 * geometry.js) — that module calls refreshOutlinePreview directly on a
 * pick (not the full _notifyChange('commit') cascade, which would also
 * re-persist/remask/re-drape for a field nothing else reads yet), so
 * "picking Centerline empties the preview" holds without waiting for an
 * unrelated edit.
 */
import { showsOutline, showsColor } from './layers.js';
import { lineOutlinePathD } from './editor-expand-analytic.js';
import { _currentElementColor } from './properties-shape.js';

const PREVIEW_STROKE_WIDTH = 0.02;

/**
 * SE12 T37 AMEND (Fred: "it should work on shapes in priority, but
 * eventually text" — keep this turn's scope to lines, but don't hardcode
 * <line> so the NEXT kind is a table entry, not a preview-code change).
 * One entry per svg.js element `.type` this preview can outline, each a
 * function `(el) => { d, unsupported }` — same return shape
 * lineOutlinePathD itself uses, so a new entry just adapts that kind's
 * own attrs into whatever geometry function it calls. A `.type` with no
 * entry here is skipped in refreshOutlinePreview below, silently, same
 * as an `unsupported` result — no error either way.
 *
 * T38 is shapes (rect/circle/polyline/polygon/path); text after that.
 * Only 'line' exists today — the TABLE is worth declaring now (cheap,
 * and it's the shape every future kind will plug into identically); the
 * geometry FUNCTIONS for shapes/text are not (building them before
 * anything calls them is the "machinery for an unused case" the
 * declare-over-hand-roll rule itself warns against).
 */
export const OUTLINE_KINDS = {
  line: (el) => lineOutlinePathD({
    x1: parseFloat(el.attr('x1')) || 0,
    y1: parseFloat(el.attr('y1')) || 0,
    x2: parseFloat(el.attr('x2')) || 0,
    y2: parseFloat(el.attr('y2')) || 0,
    strokeWidth: parseFloat(el.attr('stroke-width')) || 0,
    cap: el.attr('stroke-linecap') || 'round',
  }),
};

export function refreshOutlinePreview(editor) {
  if (!editor || !editor._outlinePreviewLayer) return;
  editor._outlinePreviewLayer.clear();
  if (!editor._sketchLayer || !Array.isArray(editor._layers)) return;

  const layersById = new Map(editor._layers.map((l) => [String(l.id), l]));

  for (const ch of editor._sketchLayer.children().toArray()) {
    const layer = layersById.get(String(ch.attr('data-layer')));
    if (!showsOutline(layer)) continue;
    const outlineFor = OUTLINE_KINDS[ch.type];
    if (!outlineFor) continue; // no table entry for this element kind — skipped, no error

    const { d, unsupported } = outlineFor(ch);
    if (unsupported || !d) continue; // no preview, no error — e.g. a cap lineOutlinePathD doesn't support yet

    const color = _currentElementColor(ch, editor._color);
    const preview = editor._outlinePreviewLayer.path(d)
      .fill('none')
      .stroke({ color, width: PREVIEW_STROKE_WIDTH });
    // Reuse the SAME display-only neutral-color override the sketch
    // layer itself uses (styles/editor.css's .layer-no-color, applied by
    // applyLayerState) rather than computing a second neutral value here
    // — one CSS rule, one color, whichever element carries it.
    if (!showsColor(layer)) preview.addClass('layer-no-color');
    // The element's own transform, uncomposed — lineOutlinePathD works in
    // the element's LOCAL frame (its raw x1/y1/x2/y2), so the preview
    // needs the SAME transform the source carries to land in the same
    // place. Slice 0 (isSimilarity/bakeArcSimilar) is what composes a
    // WORLD transform into this kind of arc-bearing path at bake time —
    // not this module's job.
    const t = ch.attr('transform');
    if (t) preview.attr('transform', t);
  }
}
