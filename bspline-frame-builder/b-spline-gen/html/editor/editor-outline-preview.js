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
 * the SE12 design doc's own item 2. Also refreshed on undo/redo
 * (editor.js's _restoreState → _notifyChange), layer switch, and
 * document open/restore (both via layers.js's setActiveLayer — open()
 * calls editor.setActiveLayer() as its own last roster-restore step) —
 * T37 only wired the edit/commit path; T38 closed the other three. A
 * layer's fusionGeometry picker lives outside the editor (the stamp
 * panel sidebar, main/stamp/fusion-geometry.js) — that module calls
 * refreshOutlinePreview directly on a pick (not the full
 * _notifyChange('commit') cascade, which would also re-persist/remask/
 * re-drape for a field nothing else reads yet), so "picking Centerline
 * empties the preview" holds without waiting for an unrelated edit.
 *
 * SE12 T38 (review finding on T37's own screenshot): draws a fixed
 * dark-over-white halo (styles/editor.css's .outline-preview-halo/-line),
 * not the source element's own color — a same-color thin line over a
 * same-color stroke was invisible. showsColor(layer) no longer gates the
 * preview's own color choice (there isn't one to gate); it still gates
 * nothing else here since it never did — the visibility gate is, and
 * always was, showsOutline(layer) alone.
 */
import { showsOutline } from './layers.js';
import { lineOutlinePathD, circleOutlinePathD, rectOutlinePathD, ellipseOutlinePathD } from './editor-expand-analytic.js';

/** Which of the 3 outline modes editor-expand-analytic.js's shape
 *  functions want, read from the element's OWN fill/stroke presentation
 *  attrs (Fred: "Filled shapes (fill mode fill/both): outline = the
 *  shape's own edge... 'both' = edge offset by w/2"). Declared once here
 *  since every closed-shape OUTLINE_KINDS entry needs the same read. */
function _fillModeOf(el) {
  const fill = el.attr('fill');
  const stroke = el.attr('stroke');
  const hasFill = !!fill && fill !== 'none';
  const hasStroke = !!stroke && stroke !== 'none';
  if (hasFill && hasStroke) return 'both';
  if (hasFill) return 'fill';
  return 'stroke'; // also the safe default for a degenerate "neither set" element
}

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
 * T38 added rect/circle (closed-form, no offsetting algorithm needed);
 * polyline/polygon/generic-path and text are later work (open item in
 * this module — see WORK-LOG). The TABLE was worth declaring in T37
 * before any shape existed (cheap, and it's the shape every future kind
 * plugs into identically); the
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
  circle: (el) => circleOutlinePathD({
    cx: parseFloat(el.attr('cx')) || 0,
    cy: parseFloat(el.attr('cy')) || 0,
    r: parseFloat(el.attr('r')) || 0,
    strokeWidth: parseFloat(el.attr('stroke-width')) || 0,
    mode: _fillModeOf(el),
  }),
  rect: (el) => rectOutlinePathD({
    x: parseFloat(el.attr('x')) || 0,
    y: parseFloat(el.attr('y')) || 0,
    width: parseFloat(el.attr('width')) || 0,
    height: parseFloat(el.attr('height')) || 0,
    strokeWidth: parseFloat(el.attr('stroke-width')) || 0,
    mode: _fillModeOf(el),
  }),
  // T38 AMEND (Fred: "ellipse and curved path too please" — supersedes
  // the T38-checkpoint-1 decline below): biarc-fit via
  // editor-expand-biarc.js's fitOffsetWithBiarcs, tangent-continuous
  // circular arcs to within OUTLINE_FIT's tolerance, not a spline —
  // see ellipseOutlinePathD's own header for the fit + vanishing-ring
  // details. Only the curved rings are fitted; still closed-form exact
  // where the ellipse degenerates to a circle (rx===ry, same function).
  ellipse: (el) => ellipseOutlinePathD({
    cx: parseFloat(el.attr('cx')) || 0,
    cy: parseFloat(el.attr('cy')) || 0,
    rx: parseFloat(el.attr('rx')) || 0,
    ry: parseFloat(el.attr('ry')) || 0,
    strokeWidth: parseFloat(el.attr('stroke-width')) || 0,
    mode: _fillModeOf(el),
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

    // The element's own transform, uncomposed — lineOutlinePathD works in
    // the element's LOCAL frame (its raw x1/y1/x2/y2), so the preview
    // needs the SAME transform the source carries to land in the same
    // place. Slice 0 (isSimilarity/bakeArcSimilar) is what composes a
    // WORLD transform into this kind of arc-bearing path at bake time —
    // not this module's job.
    const t = ch.attr('transform');
    // Halo drawn FIRST (underneath), then the dark line on top — same
    // `d` for both, same transform. Both classes are the sole source of
    // color/width/vector-effect (styles/editor.css); no attrs set here,
    // so there's nothing per-element to keep in sync with the CSS.
    const halo = editor._outlinePreviewLayer.path(d).addClass('outline-preview-halo');
    if (t) halo.attr('transform', t);
    const line = editor._outlinePreviewLayer.path(d).addClass('outline-preview-line');
    if (t) line.attr('transform', t);
  }
}
