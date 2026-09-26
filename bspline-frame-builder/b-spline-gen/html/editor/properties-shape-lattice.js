/**
 * properties-shape-lattice.js — T58 (SE14 Slice 3): wires the Shape
 * Lattice tool's own panel (bspline_gen_palette.html's
 * #editorShapeLatticePanel, shown only while the shapeLattice tool is
 * active — editor-ui.js's TOOLBAR_GROUPS) to the ACTIVE layer's own
 * `.pattern` — the SAME per-layer object properties-lattice.js's own
 * box-Lattice panel reads/writes (SE7i), just a SECOND tool operating on
 * it: "two tools sharing one engine" (SE14-SHAPE-LATTICE-DESIGN.md §1).
 * Same per-panel-module shape as properties-lattice.js itself.
 *
 * Two responsibilities, kept in one file because they share `p`/`p.shape`
 * so tightly: (1) the Shape/Segments sections drive
 * `editor-shape-lattice-generator.js`'s pure `generateSilhouette`, then
 * emit/update the ONE linked silhouette `<path>` (§6: in-place `d` update
 * when this tool already owns the link, a fresh element + a fresh
 * `stampBoundaryRef` when it doesn't — e.g. the very first Generate);
 * (2) the Fill/Boundary/Ending/Contour sections are the SAME fields the
 * box Lattice panel used to carry for Boundary mode, now living here
 * instead (T58's own "the box # Lattice loses its Boundary row").
 */
import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import {
    PATTERN_DEFAULTS, generatePattern, detachAllOwned, nextSeed, recolorOwnedKind, rewidthOwnedKind, rewidthOwnedKinds,
    stampBoundaryRef, _findBoundaryElements, hasGeneratedSilhouette, CONTOUR_SEG_INDEX_ATTR, BOUNDARY_REF_ATTR,
} from './editor-lattice-pattern.js';
import { PRESETS, generateSilhouette, primitiveToPathD } from './editor-shape-lattice-generator.js';
import { boardRegion, computeParamHandles, mirrorSegmentIndex } from './editor-shape-lattice-interaction.js';
import { insetRegionForContour, CONTOUR_STROKE_STYLE } from './editor-lattice-boundary.js';
import { openColorMosaic } from './editor-color.js';
import { getActiveLayer, ensureActiveLayer } from './layers.js';
import { viewScale } from './editor-view.js';
import { inputProfileFor } from './editor-input.js';

// T59: the event this module dispatches after ANY programmatic change to
// `p.shape` from OUTSIDE the panel's own field handlers (a param-handle
// drag release, a canvas segment tap) — the panel's own
// `syncFieldsFromPattern` listens for it (alongside the pre-existing
// `editorLayersChanged`) so the Segments dropdown / Shape sliders never
// drift from a canvas-driven edit. Declared once so a future THIRD writer
// (there are only two today) has an obvious hook to reuse rather than
// inventing its own.
export const SHAPE_CHANGED_EVENT = 'editorShapeLatticeChanged';
function _dispatchShapeChanged(editor) {
    document.dispatchEvent(new CustomEvent(SHAPE_CHANGED_EVENT, { detail: { editor } }));
}

// Same declared-table idiom properties-lattice.js used to own for this —
// moved here with the Ending control itself (T58's own panel split).
// UI1: `label` is the segmented button's own text (short — 4 buttons
// need to fit this panel's ~236px width); `title` keeps the fuller
// wording (incl. "(default)") the old <select>'s option text carried,
// same "title carries the hint text" convention latticeAddKindGroup's
// own comment already established for a width-constrained panel.
const BOUNDARY_END_RULES = [
    { value: 'on-boundary', label: 'Boundary', title: 'On boundary' },
    { value: 'inset', label: 'Inset', title: 'Inset (default)' },
    { value: 'joint', label: 'Joint', title: 'Joint' },
    { value: 'loose', label: 'Loose', title: 'Loose' },
];

// SE14 §2's own flat-array ordering (generator's own solver doc comments,
// editor-shape-lattice-generator.js) — a small, declared per-preset label
// table so the Segments <select> reads as "R shoulder" rather than a bare
// index; purely cosmetic, never read back by the generator itself.
const SEGMENT_LABELS = {
  hourglass: [
    'R horn (top)', 'R shoulder', 'R waist', 'R hip', 'R horn (bottom)', 'Bottom edge',
    'L horn (bottom)', 'L hip', 'L waist', 'L shoulder', 'L horn (top)', 'Top edge',
  ],
  bottle: [
    'R horn (top)', 'R neck', 'R hip', 'R horn (bottom)', 'Bottom edge',
    'L horn (bottom)', 'L hip', 'L neck', 'L horn (top)', 'Top edge',
  ],
};

// Which param sliders belong to which preset — PRESETS' own `params` keys
// (editor-shape-lattice-generator.js), just the NAMES, so this table can't
// drift from what the generator actually reads.
const PARAM_ROWS = {
  hourglass: Object.keys(PRESETS.hourglass.params),
  bottle: Object.keys(PRESETS.bottle.params),
};

/** SE7i's own per-layer pattern lookup, duplicated here (not imported)
 *  the same way `_fmix32` is duplicated per-file elsewhere in this
 *  codebase — a small, private, state-free helper, not worth a shared
 *  import for two callers.
 *
 *  T59: EXPORTED now (dropping the underscore, matching `stampBoundaryRef`
 *  's own no-underscore-but-exported convention for a genuine public API,
 *  not the underscore-kept-on-export style `_findBoundaryElements` uses for
 *  an internal helper one other module happens to need) — the canvas
 *  interaction code (editor-interaction.js) needs the SAME lookup a
 *  handle-drag or a segment tap reads/writes `p`/`p.shape` through. */
function _activeLayerObj(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    return layers.find((l) => l.id === getActiveLayer(editor)) || null;
}
export function currentPattern(editor) {
    const layer = _activeLayerObj(editor);
    if (!layer) return JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    if (!layer.pattern) layer.pattern = JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    return layer.pattern;
}
/** Lazily materializes `p.shape` the same way `currentPattern` itself
 *  lazily materializes `layer.pattern` — a layer that's never touched the
 *  Shape Lattice tool has no `.shape` key at all until this is called. */
export function currentShape(p) {
    if (!p.shape) p.shape = JSON.parse(JSON.stringify(PATTERN_DEFAULTS.shape));
    return p.shape;
}

/** T71: the region a GENERATED shape's own silhouette actually builds
 *  from — the board region, inset by the declared contour-size margin
 *  (editor-lattice-boundary.js's own `insetRegionForContour`, the SAME
 *  helper `buildSketchManifest` uses on the manifest side) — every caller
 *  below that builds OR re-derives a generated silhouette must use this,
 *  never the raw `boardRegion`, so the drawn contour, its param handles,
 *  and the manifest's own contour entities always agree on where the
 *  shape actually sits. Exported (same underscore-kept-while-exported
 *  convention `_findBoundaryElements` already uses in this file) — editor-
 *  interaction.js's own segment-tap hit-test needs this SAME region too,
 *  not a second copy of the formula. */
export function _shapeContourRegion(editor) {
  return insetRegionForContour(boardRegion(editor));
}

/** The segments array a JUST-generated silhouette would use RIGHT NOW —
 *  `shape.segments` once the tool has generated at least once (an
 *  explicit override, `generateSilhouette`'s own contract), else a pure,
 *  side-effect-free peek at the preset's own fresh defaults (same region
 *  Generate itself would use, so a segment's `bulge` the user edits
 *  BEFORE ever pressing Generate still matches the real board's own
 *  aspect ratio, not a throwaway placeholder). Lets the Segments list +
 *  per-segment style controls work immediately on a fresh layer, matching
 *  how the Fill section's own fields already read optimistically off
 *  PATTERN_DEFAULTS before a first Generate. */
function _effectiveSegments(editor, shape) {
  if (Array.isArray(shape.segments)) return shape.segments;
  return generateSilhouette(_shapeContourRegion(editor), shape).segments;
}

/**
 * SE14 §6 / T73 (SE14b): regenerate the silhouette from the CURRENT
 * `p.shape` and emit/update its linked contour — now N per-segment
 * elements (one `<path>` per primitive: a straight `L` command for a
 * line, an `A` command for an arc, round caps, never one combined closed
 * path), from the SAME `primitives` list the manifest producer
 * (`manifestFromShape`) reads — one declaration, two consumers, never a
 * second geometry derivation. In-place `d` update on each element when
 * the segment COUNT hasn't changed (preserves element identity — and so
 * preserves selection and any per-segment colour override); a count
 * change (a different preset, or a kink that splits one segment into two)
 * REBUILDS from scratch and resets every override (T73's own dispatch:
 * "a regenerate with the same segment count keeps per-segment colours; a
 * count change resets them" — index `i` no longer means the same physical
 * segment once the count differs, so an old override would silently
 * apply to the WRONG piece if kept).
 *
 * T49's own "re-picking stamps a NEW id, the old element's own tag is
 * left in place, inert" convention still holds (covers BOTH "first
 * generate ever" and "was linked to a hand-PICKED shape, now
 * generating" — the picked element is never touched). Pure geometry + DOM
 * emit only — the Fill re-run is the caller's own job (see
 * `regenerateSilhouetteAndFill` below), matching `generatePattern`'s own
 * "read `PATTERN.boundary.shapeId` fresh" contract exactly.
 *
 * T59: lifted to MODULE SCOPE (was a closure inside
 * `initShapeLatticeProperties`) — a param-handle drag's own per-frame
 * LIVE update (editor-interaction.js) needs this exact SYNC, no-
 * generatePattern-call step, called on every pointermove; only `finish`
 * additionally calls the full `regenerateSilhouetteAndFill` below. The
 * ONE thing the old closure did that this can't (a
 * `boundaryStatusEl.textContent` update) now reads that element fresh by
 * id instead of via closure — harmless if the panel isn't mounted at all
 * (`el()` returns null, the `if` guards it), matching every OTHER
 * function in this file's own "no panel, no-op" convention.
 *
 * @returns {Array} the N per-segment elements, in segment order (was a
 *   single element pre-T73 — every real caller discards the return value
 *   already; only tests read it, updated alongside this change).
 */
export function regenerateSilhouette(editor, p) {
    const shape = currentShape(p);
    const region = _shapeContourRegion(editor);
    const { primitives, segments } = generateSilhouette(region, shape);

    const widths = { ...PATTERN_DEFAULTS.widths, ...(p.widths || {}) };
    p.contour = { ...PATTERN_DEFAULTS.contour, ...(p.contour || {}) };
    // T73: "stroke = the contour's width (auto = lattice stroke width,
    // T72 item 6)" — the contour's OWN drawn width defaults to widths.rails
    // (the SAME value rails/ties/the manifest's stroke_width already use),
    // replacing the old fixed SILHOUETTE_STROKE_WIDTH hairline. T74 AMEND 1:
    // `p.contour.width` (was `boundary.border.width`) is an explicit
    // override when set. See editor-sketch-manifest.js's own
    // shapeHalfInset, updated in lockstep so the lattice-fill's own default
    // inset amount still agrees between the app and the manifest.
    const contourWidth = p.contour.width != null ? p.contour.width : widths.rails;
    const contourColor = ({ ...PATTERN_DEFAULTS.colors, ...p.colors }).contour;
    const contourShow = p.contour.show !== false;

    const reuseExisting = shape.source === 'generated' && p.boundary && p.boundary.shapeId;
    const existing = reuseExisting ? _findBoundaryElements(editor, p.boundary.shapeId) : [];
    const countMatches = existing.length === primitives.length && primitives.length > 0;

    // T73: `p.contour.segmentColors[i]` is keyed by PRIMITIVE index (the
    // SAME index `primitives[i]` and the manifest's own `seg{i}` ids use) —
    // NOT `shape.segments[i]`'s topology index, which `_segmentToPrimitives`
    // can expand 1-to-2 for a 'kink' style-segment, so the two arrays can
    // have different lengths. A segment-count change means index i no
    // longer names the same drawn edge, so overrides are cleared rather
    // than silently misapplied to a different piece after the rebuild.
    if (!countMatches) {
        p.contour.segmentColors = [];
        for (const oldEl of existing) oldEl.remove();
    }
    shape.segments = segments;

    const layerId = ensureActiveLayer(editor);
    const segEls = primitives.map((prim, i) => {
        const d = primitiveToPathD(prim);
        if (countMatches) return existing[i].attr('d', d);
        return editor._sketchLayer
            .path(d)
            .fill('none')
            .stroke(CONTOUR_STROKE_STYLE)
            .attr('data-layer', layerId)
            .attr(CONTOUR_SEG_INDEX_ATTR, i);
    });
    if (!countMatches) {
        const id = stampBoundaryRef(segEls[0]);
        for (let i = 1; i < segEls.length; i++) segEls[i].attr(BOUNDARY_REF_ATTR, id);
        p.boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary, shapeId: id };
    }
    // Re-applied on EVERY regenerate (not just at mint time), so a colour/
    // width/show change already written to `p` takes effect immediately —
    // matching contourWidth's own "follows live" requirement.
    for (let i = 0; i < segEls.length; i++) {
        const segColor = (p.contour.segmentColors && p.contour.segmentColors[i]) || contourColor;
        segEls[i].stroke({ color: segColor, width: contourWidth });
        segEls[i].attr('display', contourShow ? null : 'none');
    }

    p.extent = { mode: 'boundary' };
    shape.source = 'generated';
    const statusEl = el('shapeLatticeBoundaryStatus');
    if (statusEl) statusEl.textContent = 'Shape linked';
    // T59: re-render the on-canvas param handles from the geometry this
    // call just wrote — ONE call site for both callers (a panel slider
    // change, a canvas handle drag's own per-frame update), rather than
    // each caller separately remembering to re-sync them. Guarded: a test
    // mock editor has no `_updateHandles` at all, matching every other
    // optional-editor-method call in this file (`pushState`,
    // `_notifyChange`).
    if (typeof editor._updateHandles === 'function') editor._updateHandles();
    return segEls;
}

/** The full "regenerate + refill" step (T59: lifted to module scope, was
 *  a closure) — calls `generatePattern` directly (not the indirect
 *  commit-hook `refreshBoundaryPatterns` already provides) so a slider
 *  release / drag release updates the canvas on the SAME tick, no
 *  microtask gap. Dispatches `SHAPE_CHANGED_EVENT` at the end so ANY
 *  mounted panel (or future listener) re-syncs, regardless of which
 *  caller (this panel's own fields, a param-handle drag, a segment tap)
 *  triggered it. */
export async function regenerateSilhouetteAndFill(editor) {
    const p = currentPattern(editor);
    regenerateSilhouette(editor, p);
    await generatePattern(editor, p);
    _dispatchShapeChanged(editor);
}

/**
 * T59: writes a PATCH onto `shape.segments[index]` (mirrored per SE14
 * §4's own rule — the two cap edges have no partner, a no-op spread in
 * that case), then regenerates + refills — the tap-a-segment popup's own
 * write path (editor-interaction.js), and this panel's own Segments
 * section buttons (thin wrappers below, in `initShapeLatticeProperties`).
 * Lifted to module scope for the SAME reason `regenerateSilhouette` was:
 * a second real caller outside this panel's own DOM needs the identical
 * mirror-and-regenerate logic, not a second copy of it.
 */
export async function writeSegmentStyle(editor, index, patch) {
    const p = currentPattern(editor);
    const shape = currentShape(p);
    if (!Array.isArray(shape.segments)) shape.segments = _effectiveSegments(editor, shape);
    const n = shape.segments.length;
    const cur = shape.segments[index] || { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 };
    const next = { ...cur, ...patch };
    shape.segments[index] = next;
    const mirror = mirrorSegmentIndex(index, n);
    if (mirror !== index) shape.segments[mirror] = { ...next };
    await regenerateSilhouetteAndFill(editor);
}

/**
 * T59: which param handles the Shape Lattice tool should currently show
 * on canvas — `[]` when there's nothing generated yet, or when the
 * linked boundary is a HAND-PICKED shape (`shape.source==='picked'`: no
 * generator params to speak of, nothing to drag). Calls
 * `generateSilhouette` itself (pure, cheap, no DOM) to get the FULLY
 * RESOLVED params (T59's own new `params` return field) — `shape.params`
 * alone would be missing any key the user never explicitly pinned.
 *
 * T72 (AMEND 2): `hasGeneratedSilhouette` (editor-lattice-pattern.js) is
 * the REAL "has Generate actually run" check — `shape.source ===
 * 'generated'` alone is true on an untouched layer too (it's just
 * PATTERN_DEFAULTS.shape's own default value), which is exactly why this
 * used to show 3 handles floating over an empty board before any shape
 * existed.
 */
export function paramHandleRecords(editor) {
    const p = currentPattern(editor);
    const shape = currentShape(p);
    if (!hasGeneratedSilhouette(p)) return [];
    const region = _shapeContourRegion(editor);
    const { params: resolved } = generateSilhouette(region, shape);
    if (!resolved) return [];
    return computeParamHandles(shape.preset, region, resolved).map((h) => ({ ...h, hx: h.anchor.x, hy: h.anchor.y }));
}

/**
 * Draws the current param handles into `editor._handleLayer` — same
 * visual/sizing convention `renderTransformHandles` (editor-transform-
 * handles.js) already established (screen-px handle size via
 * `viewScale`/`inputProfileFor`, `pointer-events:none`, hit-tested
 * manually) — a distinct color (purple) so a handle is never confused
 * with a transform handle (blue) or a Lattice node (the Colors row's own
 * per-pattern node color). Returns the hit-test records
 * (`{key,label,axis,valueFromWorld,hx,hy,hitR}`), directly compatible
 * with `hitTestHandle` (editor-transform-handles.js) — same shape, so
 * editor-interaction.js reuses that function rather than a second one.
 */
export function renderShapeLatticeHandles(editor) {
    if (!editor._handleLayer) return [];
    const records = paramHandleRecords(editor);
    if (!records.length) return [];
    const view = (editor._draw && editor._draw.viewbox) ? editor._draw.viewbox() : null;
    const svgEl = document.getElementById('editorSVGContainer');
    const clientWidth = (svgEl && svgEl.clientWidth) || 800;
    const clientHeight = (svgEl && svgEl.clientHeight) || 800;
    const pxPerModelUnit = view ? viewScale(view, clientWidth, clientHeight) : 100;
    const handlePx = inputProfileFor(editor._pointerType).handlePx;
    const sz = Math.max(handlePx / pxPerModelUnit, 0.05);
    const strokeW = sz * (0.0025 / 0.012); // matches renderTransformHandles' own ratio
    const out = [];
    for (const r of records) {
        editor._handleLayer.circle(sz * 2)
            .center(r.hx, r.hy)
            .fill('#ffffff')
            .stroke({ color: '#7b1fa2', width: strokeW })
            .attr('pointer-events', 'none');
        out.push({ ...r, hitR: sz * 1.8 });
    }
    return out;
}

/**
 * T59 (SE14 §6, "recompute-and-compare"): called from `editor.js`'s own
 * `_notifyChange('commit')` — the SAME general commit hook
 * `refreshBoundaryPatterns` already hangs off — on EVERY commit, not just
 * a Shape-Lattice-tool one (a hand node-edit happens in NODE mode, a
 * different tool entirely, so there's no narrower hook to gate on without
 * tracking "which element did this commit touch," the same cost
 * `refreshBoundaryPatterns`'s own doc comment already declined to pay).
 * Cheap: a same-layer check plus ONE string comparison against what
 * `regenerateSilhouette` would ITSELF produce right now from the CURRENT
 * `shape.params`/`segments` — genuinely unrelated commits (the overwhelming
 * majority) bail after the first `if`. A real hand-edit (a Node-mode drag
 * on the linked path) changes the live `d` directly, so it no longer
 * matches this deterministic re-derivation — `shape.source` flips to
 * 'picked' so a LATER Shape-panel edit doesn't silently overwrite the
 * user's own hand-tuned geometry (design doc §6's own explicit ask).
 */
export function detectShapeLatticeDetach(editor) {
    // Deliberately NOT `currentPattern(editor)` — that lazily MATERIALIZES
    // a full default pattern onto the active layer the first time it's
    // called (by design, for every OTHER caller in this file, which only
    // ever runs while the Shape Lattice tool is genuinely in use). This
    // hook runs on EVERY commit, tool-independent — a real, measured
    // regression (found by the full suite, not live): plain box-Lattice-
    // only undo tests started seeing a phantom `layer.pattern` appear
    // after ANY commit, because this call used to materialize one. A
    // read-only lookup that returns nothing for a layer that's never
    // touched EITHER Lattice tool is the fix.
    const layer = _activeLayerObj(editor);
    const p = layer && layer.pattern;
    const shape = p && p.shape;
    if (!shape || shape.source !== 'generated') return;
    if (!p.boundary || !p.boundary.shapeId) return;
    const segEls = _findBoundaryElements(editor, p.boundary.shapeId);
    if (!segEls.length) return;
    const region = _shapeContourRegion(editor);
    const { primitives } = generateSilhouette(region, shape);
    // T73 (SE14b): the contour is N per-segment elements now — a genuine
    // hand-edit of ANY one of them (a NODE-mode drag moving its endpoint,
    // now that a segment is a real, selectable element) is still real
    // divergence and still flips this to 'picked', same as a single-path
    // hand-edit always did; a segment COUNT mismatch is unconditionally a
    // divergence too (regenerateSilhouette always keeps the two in sync,
    // so this can only mean something ELSE touched the DOM).
    const expected = primitives.map((prim) => primitiveToPathD(prim));
    const diverged = segEls.length !== expected.length
      || segEls.some((segEl, i) => segEl.attr('d') !== expected[i]);
    if (diverged) shape.source = 'picked';
}

/**
 * T59: the small floating "straight | curve | kink" bar a canvas tap on a
 * silhouette segment opens (editor-interaction.js) — appended to
 * `document.body`, `position:fixed`, clamped to the viewport, same
 * positioning/outside-click-close shape `openColorMosaic`
 * (editor-color.js) already established for a floating popover, not a
 * second mechanism. `screenX`/`screenY` are CLIENT coordinates (the tap's
 * own `e.clientX/Y`), not model coordinates — the caller already has
 * them from the pointer event; converting a model point through the
 * SVG's own screen CTM would be strictly more code for the same result.
 */
export function openSegmentStyleBar(editor, index, screenX, screenY) {
    document.querySelectorAll('.shape-lattice-segment-bar').forEach((el) => el.remove());
    const p = currentPattern(editor);
    const shape = currentShape(p);
    const seg = (shape.segments && shape.segments[index]) || { style: 'straight' };
    const bar = document.createElement('div');
    // UI1: the shared segmented-group look (styles/base.css), not this
    // popup's own border/radius — a floating context still gets its own
    // position/elevation via role=group's own box-shadow addition below.
    bar.className = 'shape-lattice-segment-bar segmented-group';
    bar.setAttribute('role', 'group');
    bar.style.cssText = 'position:fixed; z-index:10000; height:32px; box-shadow:0 2px 8px rgba(0,0,0,0.2);';
    const STYLES = [['straight', 'Straight'], ['curve', 'Curve'], ['kink', 'Kink']];
    for (const [value, label] of STYLES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = 'editor-fillmode-btn' + (seg.style === value || (value === 'straight' && !seg.style) ? ' active' : '');
        btn.style.cssText = 'padding:0 10px; font-size:11px;';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const patch = value === 'straight' ? { style: 'straight', bulge: 0 }
                : { style: value, bulge: seg.bulge > 0 ? seg.bulge : 0.5 };
            writeSegmentStyle(editor, index, patch);
            bar.remove();
        });
        bar.appendChild(btn);
    }
    document.body.appendChild(bar);
    // Clamp to the viewport (same shape openColorMosaic's own positioning uses).
    const bw = bar.offsetWidth || 120, bh = bar.offsetHeight || 40;
    const left = Math.max(4, Math.min(screenX - bw / 2, window.innerWidth - bw - 4));
    const top = Math.max(4, Math.min(screenY - bh - 12, window.innerHeight - bh - 4));
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    const close = (e) => {
        if (!bar.contains(e.target)) {
            bar.remove();
            document.removeEventListener('mousedown', close, true);
            document.removeEventListener('touchstart', close, true);
        }
    };
    // Deferred one tick so the SAME tap that opened the bar doesn't also close it.
    setTimeout(() => {
        document.addEventListener('mousedown', close, true);
        document.addEventListener('touchstart', close, true);
    }, 0);
    return bar;
}

export function initShapeLatticeProperties(editor) {
    const toolBtn = el('toolShapeLattice');
    const generateBtn = el('shapeLatticeGenerate');
    if (!generateBtn) return; // panel not present in this host — no-op, matches other properties-*.js modules' own guard shape

    // ── Shape section ───────────────────────────────────────────────
    const presetHourglassEl = el('shapePresetHourglass');
    const presetBottleEl = el('shapePresetBottle');
    const shapeSeedEl = el('shapeSeed');
    const rerollEl = el('shapeReroll');
    const PARAM_INPUTS = {};
    for (const keys of Object.values(PARAM_ROWS)) {
        for (const key of keys) PARAM_INPUTS[key] = el(`shapeParam-${key}`);
    }

    // ── Segments section ────────────────────────────────────────────
    const segmentIndexEl = el('shapeSegmentIndex');
    const segStyleStraightEl = el('shapeSegStyleStraight');
    const segStyleCurveEl = el('shapeSegStyleCurve');
    const segStyleKinkEl = el('shapeSegStyleKink');
    const segCurveFieldsEl = el('shapeSegCurveFields');
    const segDirOutEl = el('shapeSegDirOut');
    const segDirInEl = el('shapeSegDirIn');
    const segBulgeEl = el('shapeSegBulge');

    // ── Fill section (box Lattice's own controls, reused verbatim under
    //    shapeLattice*-prefixed ids — T58's own "Fill = the box Lattice's
    //    controls, reused, not retyped"). ──────────────────────────────
    const spacingEl = el('shapeLatticeSpacing');
    const railsModeCountEl = el('shapeLatticeRailsModeCount');
    const railsModeEveryEl = el('shapeLatticeRailsModeEvery');
    const railsCountFieldsEl = el('shapeLatticeRailsCountFields');
    const railsEveryFieldsEl = el('shapeLatticeRailsEveryFields');
    const railsCountMinEl = el('shapeLatticeRailsCountMin');
    const railsCountMaxEl = el('shapeLatticeRailsCountMax');
    const railsEveryEl = el('shapeLatticeRailsEvery');
    const railsOffsetEl = el('shapeLatticeRailsOffset');
    const tiesModeCountEl = el('shapeLatticeTiesModeCount');
    const tiesModeDensityEl = el('shapeLatticeTiesModeDensity');
    const tiesCountFieldsEl = el('shapeLatticeTiesCountFields');
    const tiesDensityFieldsEl = el('shapeLatticeTiesDensityFields');
    const tiesCountMinEl = el('shapeLatticeTiesCountMin');
    const tiesCountMaxEl = el('shapeLatticeTiesCountMax');
    const tiesSpanModeCellsEl = el('shapeLatticeTiesSpanModeCells');
    const tiesSpanModeRailsEl = el('shapeLatticeTiesSpanModeRails');
    const tiesDensityEl = el('shapeLatticeTiesDensity');
    const tiesSpanMinEl = el('shapeLatticeTiesSpanMin');
    const tiesSpanMaxEl = el('shapeLatticeTiesSpanMax');
    const tiesAnchorEl = el('shapeLatticeTiesAnchor');
    const tiesRailSnapRowsEl = el('shapeLatticeTiesRailSnapRows');
    const tiesOneEndedEl = el('shapeLatticeTiesOneEnded');
    const nodesEndsEl = el('shapeLatticeNodesEnds');
    const nodesCrossingsEl = el('shapeLatticeNodesCrossings');
    const nodesRailEndsEl = el('shapeLatticeNodesRailEnds');
    const orientHorizontalEl = el('shapeLatticeOrientHorizontal');
    const orientVerticalEl = el('shapeLatticeOrientVertical');
    const colorRailsEl = el('shapeLatticeColorRails');
    const colorTiesEl = el('shapeLatticeColorTies');
    const colorNodesEl = el('shapeLatticeColorNodes');
    const colorContourEl = el('shapeLatticeColorContour'); // T72 (AMEND 2)
    const widthRailsEl = el('shapeLatticeWidthRails');
    const widthTiesEl = el('shapeLatticeWidthTies');
    const widthNodesEl = el('shapeLatticeWidthNodes');
    // T58 ADD-ON (Fred: "I normally want ties and rails to be the same
    // width"): same shared shape properties-lattice.js's own panel has.
    const widthLinkedEl = el('shapeLatticeWidthLinked');
    const widthLinkToggleEl = el('shapeLatticeWidthLinkToggle');
    const widthUnlinkedFieldsEl = el('shapeLatticeWidthUnlinkedFields');
    const widthLinkedRowEl = el('shapeLatticeWidthLinkedRow');
    const fillSeedEl = el('shapeLatticeSeed');
    const detachAllBtn = el('shapeLatticeDetachAll');

    // ── Boundary / Ending / Contour (moved here from the box Lattice
    //    panel — no Board/Shape toggle: this tool is ALWAYS boundary
    //    mode). T74 AMEND 1 (Fred: "if draw boundary is off I shouldn't
    //    see it at all"): the old separate "show contour" checkbox
    //    (SE14c) and the Border section's own "draw boundary" checkbox
    //    were two independent on/off switches for what reads as ONE
    //    thing; merged into the ONE `shapeLatticeContourShow` checkbox +
    //    `shapeLatticeContourWidth` width field below (colour stays the
    //    Colors row's own `shapeLatticeColorContour` swatch, never
    //    duplicated here). The separate Border section's own enabled/
    //    color/color-auto controls are RETIRED along with it. ──────────
    const boundaryStatusEl = el('shapeLatticeBoundaryStatus');
    const endRuleEl = el('shapeLatticeEndRule');
    // T72 (SE14c): show/hide the contour's own drawn segments (rails/ties
    // still clip/fit to it either way) — unlike most of this section,
    // wired for an IMMEDIATE effect (below), not deferred to Generate,
    // since toggling it changes nothing about the fill geometry itself.
    const contourShowEl = el('shapeLatticeContourShow');
    const contourWidthEl = el('shapeLatticeContourWidth');

    if (spacingEl) {
        spacingEl.innerHTML = '';
        for (const spacing of GRID_SPACINGS) {
            const opt = document.createElement('option');
            opt.value = String(spacing);
            opt.textContent = `${spacing}"`;
            spacingEl.appendChild(opt);
        }
    }
    // UI1: `endRuleEl` is now the segmented GROUP div, not a <select> —
    // "its value" is whichever child button carries .active (get/set
    // helpers right below double as this control's own get/set, same
    // role .value used to play).
    function getEndRule() {
        return endRuleEl?.querySelector('.editor-fillmode-btn.active')?.dataset.value
            ?? PATTERN_DEFAULTS.boundary.endRule;
    }
    function setEndRule(value) {
        if (!endRuleEl) return;
        for (const btn of endRuleEl.children) btn.classList.toggle('active', btn.dataset.value === value);
    }
    if (endRuleEl) {
        endRuleEl.innerHTML = '';
        for (const { value, label, title } of BOUNDARY_END_RULES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'editor-fillmode-btn';
            btn.dataset.value = value;
            btn.textContent = label;
            btn.title = title;
            btn.style.flex = '1';
            // Same passive-until-Generate behavior the old <select> had
            // (no 'change' listener at all — readFieldsIntoPattern below
            // reads whichever is .active only when Generate/Regenerate
            // actually runs) — a visual restyle, not a new live-update.
            on(btn, 'click', () => setEndRule(value));
            endRuleEl.appendChild(btn);
        }
    }

    function syncGenerateLabel() {
        const p = currentPattern(editor);
        generateBtn.textContent = p.id ? 'Regenerate' : 'Generate';
    }

    function _showRailsMode(mode) {
        if (railsModeCountEl) railsModeCountEl.classList.toggle('active', mode !== 'every');
        if (railsModeEveryEl) railsModeEveryEl.classList.toggle('active', mode === 'every');
        if (railsCountFieldsEl) railsCountFieldsEl.style.display = mode === 'every' ? 'none' : 'flex';
        if (railsEveryFieldsEl) railsEveryFieldsEl.style.display = mode === 'every' ? 'flex' : 'none';
    }
    function _showTiesMode(mode) {
        if (tiesModeCountEl) tiesModeCountEl.classList.toggle('active', mode !== 'density');
        if (tiesModeDensityEl) tiesModeDensityEl.classList.toggle('active', mode === 'density');
        if (tiesCountFieldsEl) tiesCountFieldsEl.style.display = mode === 'density' ? 'none' : 'flex';
        if (tiesDensityFieldsEl) tiesDensityFieldsEl.style.display = mode === 'density' ? 'flex' : 'none';
    }
    function _showTieSpanMode(mode) {
        if (tiesSpanModeCellsEl) tiesSpanModeCellsEl.classList.toggle('active', mode !== 'rails');
        if (tiesSpanModeRailsEl) tiesSpanModeRailsEl.classList.toggle('active', mode === 'rails');
    }
    // T58 ADD-ON: same shape properties-lattice.js's own panel has.
    function _showWidthLinkMode(linked) {
        if (widthLinkToggleEl) widthLinkToggleEl.classList.toggle('active', linked);
        if (widthUnlinkedFieldsEl) widthUnlinkedFieldsEl.style.display = linked ? 'none' : 'flex';
        if (widthLinkedRowEl) widthLinkedRowEl.style.display = linked ? 'flex' : 'none';
    }
    function _showPresetParams(preset) {
        for (const [presetName, keys] of Object.entries(PARAM_ROWS)) {
            for (const key of keys) {
                const row = el(`shapeParamRow-${key}`);
                if (row) row.style.display = presetName === preset ? 'flex' : 'none';
            }
        }
    }

    /** Reflect `shape.segments[index]`'s own style/dir/bulge onto the
     *  per-segment controls — called on a list selection AND right after
     *  a regenerate (the selected index's own values may have shifted). */
    function _syncSegmentFields(shape, index) {
        const seg = (shape.segments && shape.segments[index]) || { style: 'straight', bulge: 0, dir: 'out' };
        const style = seg.style || 'straight';
        if (segStyleStraightEl) segStyleStraightEl.classList.toggle('active', style !== 'curve' && style !== 'kink');
        if (segStyleCurveEl) segStyleCurveEl.classList.toggle('active', style === 'curve');
        if (segStyleKinkEl) segStyleKinkEl.classList.toggle('active', style === 'kink');
        if (segCurveFieldsEl) segCurveFieldsEl.style.display = style === 'curve' ? 'flex' : 'none';
        const dir = seg.dir || 'out';
        if (segDirOutEl) segDirOutEl.classList.toggle('active', dir !== 'in');
        if (segDirInEl) segDirInEl.classList.toggle('active', dir === 'in');
        if (segBulgeEl) segBulgeEl.value = seg.bulge != null ? seg.bulge : 0.5;
    }

    /** Repopulate the Segments <select> from the CURRENT (or
     *  soon-to-be-generated) segment list, keeping the previously
     *  selected index when it's still in range (switching a param
     *  shouldn't silently jump the picker back to segment 0). */
    function _refreshSegmentList(p) {
        if (!segmentIndexEl) return;
        const shape = currentShape(p);
        const segs = _effectiveSegments(editor, shape);
        const labels = SEGMENT_LABELS[shape.preset] || [];
        const prevIndex = parseInt(segmentIndexEl.value, 10);
        segmentIndexEl.innerHTML = '';
        segs.forEach((seg, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = labels[i] ? `${i}: ${labels[i]}` : `Segment ${i}`;
            segmentIndexEl.appendChild(opt);
        });
        const validIndex = Number.isInteger(prevIndex) && prevIndex >= 0 && prevIndex < segs.length ? prevIndex : 0;
        segmentIndexEl.value = String(validIndex);
        _syncSegmentFields(shape, validIndex);
    }

    /** Shape-section edits (preset, reroll, a param, a segment's own
     *  style) are an IMMEDIATE re-projection — same "settings that change
     *  the shape itself take effect right away" contract Orientation
     *  already has in properties-lattice.js — because the Fill is
     *  entirely DERIVED from this boundary; leaving a stale fill against
     *  a just-changed silhouette would look broken, not just deferred.
     *  Thin wrapper over the MODULE-LEVEL `regenerateSilhouetteAndFill`
     *  (T59: lifted out so a canvas param-handle drag's own release can
     *  call the SAME function — see that function's own doc comment) —
     *  this panel's own extra step is just its local UI sync. */
    async function _regenerateSilhouetteAndFill() {
        // regenerateSilhouetteAndFill's own SHAPE_CHANGED_EVENT dispatch
        // (synchronous) already triggers this SAME panel's own
        // syncFieldsFromPattern via the listener registered below — no
        // separate local sync call needed here.
        await regenerateSilhouetteAndFill(editor);
    }

    function syncFieldsFromPattern() {
        const p = currentPattern(editor);
        const shape = currentShape(p);

        if (presetHourglassEl) presetHourglassEl.classList.toggle('active', shape.preset !== 'bottle');
        if (presetBottleEl) presetBottleEl.classList.toggle('active', shape.preset === 'bottle');
        _showPresetParams(shape.preset);
        if (shapeSeedEl) shapeSeedEl.value = shape.seed ?? PATTERN_DEFAULTS.shape.seed;
        for (const [key, inputEl] of Object.entries(PARAM_INPUTS)) {
            if (!inputEl) continue;
            const presetDefault = PRESETS[shape.preset]?.params?.[key];
            inputEl.value = shape.params?.[key] ?? presetDefault ?? inputEl.value;
        }
        _refreshSegmentList(p);

        const orientation = p.orientation ?? PATTERN_DEFAULTS.orientation;
        if (orientHorizontalEl) orientHorizontalEl.classList.toggle('active', orientation !== 'vertical');
        if (orientVerticalEl) orientVerticalEl.classList.toggle('active', orientation === 'vertical');
        if (spacingEl) spacingEl.value = String(p.spacing ?? PATTERN_DEFAULTS.spacing);
        const railsMode = p.rails ? (p.rails.mode || 'every') : PATTERN_DEFAULTS.rails.mode;
        const tiesMode = p.ties ? (p.ties.mode || 'density') : PATTERN_DEFAULTS.ties.mode;
        _showRailsMode(railsMode);
        _showTiesMode(tiesMode);
        _showTieSpanMode(p.ties?.span?.mode || PATTERN_DEFAULTS.ties.span.mode);
        const railsCount = p.rails?.count ?? PATTERN_DEFAULTS.rails.count;
        if (railsCountMinEl) railsCountMinEl.value = railsCount[0];
        if (railsCountMaxEl) railsCountMaxEl.value = railsCount[1];
        const tiesCount = p.ties?.count ?? PATTERN_DEFAULTS.ties.count;
        if (tiesCountMinEl) tiesCountMinEl.value = tiesCount[0];
        if (tiesCountMaxEl) tiesCountMaxEl.value = tiesCount[1];
        if (railsEveryEl) railsEveryEl.value = p.rails?.every ?? PATTERN_DEFAULTS.rails.every;
        if (railsOffsetEl) railsOffsetEl.value = p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset;
        if (tiesDensityEl) tiesDensityEl.value = p.ties?.density ?? PATTERN_DEFAULTS.ties.density;
        if (tiesSpanMinEl) tiesSpanMinEl.value = p.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin;
        if (tiesSpanMaxEl) tiesSpanMaxEl.value = p.ties?.spanMax ?? PATTERN_DEFAULTS.ties.spanMax;
        if (tiesAnchorEl) tiesAnchorEl.value = p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor;
        if (tiesRailSnapRowsEl) tiesRailSnapRowsEl.value = p.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
        if (tiesOneEndedEl) tiesOneEndedEl.value = p.ties?.oneEnded ?? PATTERN_DEFAULTS.ties.oneEnded;
        if (nodesEndsEl) nodesEndsEl.checked = p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends;
        if (nodesCrossingsEl) nodesCrossingsEl.checked = p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings;
        if (nodesRailEndsEl) nodesRailEndsEl.checked = p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds;
        if (fillSeedEl) fillSeedEl.value = p.seed ?? PATTERN_DEFAULTS.seed;
        const colors = { ...PATTERN_DEFAULTS.colors, ...p.colors };
        if (colorRailsEl) colorRailsEl.style.background = colors.rails;
        if (colorTiesEl) colorTiesEl.style.background = colors.ties;
        if (colorNodesEl) colorNodesEl.style.background = colors.nodes;
        if (colorContourEl) colorContourEl.style.background = colors.contour;
        const rawWidths = p.widths || {};
        const widths = { ...PATTERN_DEFAULTS.widths, ...rawWidths };
        if (widthRailsEl) widthRailsEl.value = widths.rails;
        if (widthTiesEl) widthTiesEl.value = widths.ties;
        if (widthLinkedEl) widthLinkedEl.value = widths.rails;
        if (widthNodesEl) widthNodesEl.value = widths.nodeDiameter;
        // T58 ADD-ON: same migration-aware inference properties-lattice.js's
        // own panel uses (see that file's own comment on this exact point).
        const widthLinked = 'linkRailsTies' in rawWidths ? rawWidths.linkRailsTies : widths.rails === widths.ties;
        _showWidthLinkMode(widthLinked);

        const boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary };
        if (boundaryStatusEl) boundaryStatusEl.textContent = boundary.shapeId ? 'Shape linked' : 'No shape picked';
        setEndRule(boundary.endRule);
        const contour = { ...PATTERN_DEFAULTS.contour, ...p.contour };
        if (contourShowEl) contourShowEl.checked = contour.show !== false;
        if (contourWidthEl) contourWidthEl.value = contour.width == null ? '' : contour.width;

        syncGenerateLabel();
    }

    /** The Fill/Boundary/Ending/Contour half of the pattern, read from the
     *  panel into `p` — the SAME shape properties-lattice.js's own
     *  readFieldsIntoPattern has, minus Board/Shape (this tool is ALWAYS
     *  boundary mode — `p.extent`/`p.boundary.endRule`/`p.contour.width`
     *  are ALWAYS written here, unlike box Lattice's own version, which
     *  now leaves them untouched). `p.shape.*` is NOT read here — the Shape
     *  section writes it immediately, on its own field changes (see
     *  `_regenerateSilhouetteAndFill` above), not deferred to Generate. */
    function readFieldsIntoPattern() {
        const p = currentPattern(editor);
        p.orientation = orientVerticalEl?.classList.contains('active') ? 'vertical' : 'horizontal';
        if (spacingEl) p.spacing = parseFloat(spacingEl.value) || PATTERN_DEFAULTS.spacing;
        const railsMode = railsModeEveryEl?.classList.contains('active') ? 'every' : 'count';
        const tiesMode = tiesModeDensityEl?.classList.contains('active') ? 'density' : 'count';
        const tieSpanMode = tiesSpanModeRailsEl?.classList.contains('active') ? 'rails' : 'cells';
        const railsCountMin = railsCountMinEl ? (parseInt(railsCountMinEl.value, 10) || 1) : (p.rails?.count?.[0] ?? PATTERN_DEFAULTS.rails.count[0]);
        const railsCountMax = railsCountMaxEl ? (parseInt(railsCountMaxEl.value, 10) || railsCountMin) : (p.rails?.count?.[1] ?? PATTERN_DEFAULTS.rails.count[1]);
        const tiesCountMin = tiesCountMinEl ? (parseInt(tiesCountMinEl.value, 10) || 1) : (p.ties?.count?.[0] ?? PATTERN_DEFAULTS.ties.count[0]);
        const tiesCountMax = tiesCountMaxEl ? (parseInt(tiesCountMaxEl.value, 10) || tiesCountMin) : (p.ties?.count?.[1] ?? PATTERN_DEFAULTS.ties.count[1]);
        p.rails = {
            mode: railsMode,
            count: railsCountMin <= railsCountMax ? [railsCountMin, railsCountMax] : [railsCountMax, railsCountMin],
            every: railsEveryEl ? (parseInt(railsEveryEl.value, 10) || 1) : (p.rails?.every ?? PATTERN_DEFAULTS.rails.every),
            offset: railsOffsetEl ? (parseInt(railsOffsetEl.value, 10) || 0) : (p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset),
        };
        p.ties = {
            ...PATTERN_DEFAULTS.ties,
            ...p.ties,
            mode: tiesMode,
            count: tiesCountMin <= tiesCountMax ? [tiesCountMin, tiesCountMax] : [tiesCountMax, tiesCountMin],
            span: { ...PATTERN_DEFAULTS.ties.span, ...p.ties?.span, mode: tieSpanMode },
            density: tiesDensityEl ? parseFloat(tiesDensityEl.value) : (p.ties?.density ?? PATTERN_DEFAULTS.ties.density),
            spanMin: tiesSpanMinEl ? (parseInt(tiesSpanMinEl.value, 10) || 1) : (p.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin),
            spanMax: tiesSpanMaxEl ? (parseInt(tiesSpanMaxEl.value, 10) || 1) : (p.ties?.spanMax ?? PATTERN_DEFAULTS.ties.spanMax),
            anchor: tiesAnchorEl ? tiesAnchorEl.value : (p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor),
            railSnapRows: tiesRailSnapRowsEl ? (parseInt(tiesRailSnapRowsEl.value, 10) || 0) : (p.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows),
            oneEnded: tiesOneEndedEl ? (parseInt(tiesOneEndedEl.value, 10) || 0) : (p.ties?.oneEnded ?? PATTERN_DEFAULTS.ties.oneEnded),
        };
        p.nodes = {
            ends: nodesEndsEl ? !!nodesEndsEl.checked : (p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends),
            crossings: nodesCrossingsEl ? !!nodesCrossingsEl.checked : (p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings),
            railEnds: nodesRailEndsEl ? !!nodesRailEndsEl.checked : (p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds),
        };
        if (fillSeedEl) p.seed = parseInt(fillSeedEl.value, 10) || 0;
        // T58 ADD-ON: same "the toggle IS the source of truth" shape
        // properties-lattice.js's own panel uses.
        const widthLinked = widthLinkToggleEl ? widthLinkToggleEl.classList.contains('active') : (p.widths?.linkRailsTies ?? true);
        const railsValue = widthLinked
            ? (widthLinkedEl ? (parseFloat(widthLinkedEl.value) || PATTERN_DEFAULTS.widths.rails) : (p.widths?.rails ?? PATTERN_DEFAULTS.widths.rails))
            : (widthRailsEl ? (parseFloat(widthRailsEl.value) || PATTERN_DEFAULTS.widths.rails) : (p.widths?.rails ?? PATTERN_DEFAULTS.widths.rails));
        const tiesValue = widthLinked
            ? railsValue
            : (widthTiesEl ? (parseFloat(widthTiesEl.value) || PATTERN_DEFAULTS.widths.ties) : (p.widths?.ties ?? PATTERN_DEFAULTS.widths.ties));
        p.widths = {
            rails: railsValue,
            ties: tiesValue,
            nodeDiameter: widthNodesEl ? (parseFloat(widthNodesEl.value) || PATTERN_DEFAULTS.widths.nodeDiameter) : (p.widths?.nodeDiameter ?? PATTERN_DEFAULTS.widths.nodeDiameter),
            linkRailsTies: widthLinked,
        };
        // T58: this tool is ALWAYS boundary mode — no Board/Shape toggle.
        p.extent = { mode: 'boundary' };
        p.boundary = {
            ...PATTERN_DEFAULTS.boundary,
            ...p.boundary,
            endRule: endRuleEl ? getEndRule() : (p.boundary?.endRule ?? PATTERN_DEFAULTS.boundary.endRule),
        };
        // T74 AMEND 1: the ONE contour width (replaces the retired
        // `boundary.border.width`) — `contourShowEl`'s own immediate-effect
        // handler (below) already writes `p.contour.show` directly, so it
        // is read back here rather than re-derived, matching every other
        // field in this function that preserves an already-written value
        // when its own element is absent.
        p.contour = {
            ...PATTERN_DEFAULTS.contour,
            ...p.contour,
            width: contourWidthEl && contourWidthEl.value !== '' ? parseFloat(contourWidthEl.value) : null,
        };
        return p;
    }

    function wireColorSwatch(btnEl, kind) {
        if (!btnEl) return;
        on(btnEl, 'click', (e) => {
            e.stopPropagation();
            const p = currentPattern(editor);
            openColorMosaic(btnEl, (hex) => {
                p.colors = { ...PATTERN_DEFAULTS.colors, ...p.colors, [kind]: hex };
                btnEl.style.background = hex;
                recolorOwnedKind(editor, getActiveLayer(editor), kind, hex);
            });
        });
    }
    function wireWidthStepper(inputEl, field, kind) {
        if (!inputEl) return;
        on(inputEl, 'change', () => {
            const p = currentPattern(editor);
            const value = parseFloat(inputEl.value) || PATTERN_DEFAULTS.widths[field];
            p.widths = { ...PATTERN_DEFAULTS.widths, ...p.widths, [field]: value };
            inputEl.value = value;
            rewidthOwnedKind(editor, getActiveLayer(editor), kind, value);
        });
    }

    // T58 ADD-ON: same shape properties-lattice.js's own panel has (see
    // that file's own doc comments for the "one undo step" rationale).
    function wireLinkedWidthStepper() {
        if (!widthLinkedEl) return;
        on(widthLinkedEl, 'change', () => {
            const p = currentPattern(editor);
            const value = parseFloat(widthLinkedEl.value) || PATTERN_DEFAULTS.widths.rails;
            p.widths = { ...PATTERN_DEFAULTS.widths, ...p.widths, rails: value, ties: value, linkRailsTies: true };
            widthLinkedEl.value = value;
            rewidthOwnedKinds(editor, getActiveLayer(editor), [['rails', value], ['ties', value]]);
        });
    }
    function wireWidthLinkToggle() {
        if (!widthLinkToggleEl) return;
        on(widthLinkToggleEl, 'click', () => {
            const p = currentPattern(editor);
            const nowLinked = !widthLinkToggleEl.classList.contains('active');
            _showWidthLinkMode(nowLinked);
            if (nowLinked) {
                const value = widthRailsEl ? (parseFloat(widthRailsEl.value) || PATTERN_DEFAULTS.widths.rails) : (p.widths?.rails ?? PATTERN_DEFAULTS.widths.rails);
                p.widths = { ...PATTERN_DEFAULTS.widths, ...p.widths, rails: value, ties: value, linkRailsTies: true };
                if (widthLinkedEl) widthLinkedEl.value = value;
                rewidthOwnedKinds(editor, getActiveLayer(editor), [['rails', value], ['ties', value]]);
            } else {
                p.widths = { ...PATTERN_DEFAULTS.widths, ...p.widths, linkRailsTies: false };
            }
        });
    }

    // ── Shape section wiring ────────────────────────────────────────
    function _selectPreset(preset) {
        if (presetHourglassEl) presetHourglassEl.classList.toggle('active', preset !== 'bottle');
        if (presetBottleEl) presetBottleEl.classList.toggle('active', preset === 'bottle');
        _showPresetParams(preset);
        const p = currentPattern(editor);
        const shape = currentShape(p);
        shape.preset = preset;
        // A different preset has a different segment COUNT/topology — an
        // override sized for the OLD preset would just be discarded by
        // generateSilhouette anyway (length mismatch), but clearing it
        // here keeps shape.segments honest rather than holding a stale,
        // now-unusable array around.
        shape.segments = null;
        _regenerateSilhouetteAndFill();
    }
    if (presetHourglassEl) on(presetHourglassEl, 'click', () => _selectPreset('hourglass'));
    if (presetBottleEl) on(presetBottleEl, 'click', () => _selectPreset('bottle'));

    if (rerollEl) {
        on(rerollEl, 'click', () => {
            const p = currentPattern(editor);
            const shape = currentShape(p);
            shape.seed = nextSeed();
            if (shapeSeedEl) shapeSeedEl.value = shape.seed;
            _regenerateSilhouetteAndFill();
        });
    }
    if (shapeSeedEl) {
        on(shapeSeedEl, 'change', () => {
            const p = currentPattern(editor);
            currentShape(p).seed = parseInt(shapeSeedEl.value, 10) || 0;
            _regenerateSilhouetteAndFill();
        });
    }
    for (const [key, inputEl] of Object.entries(PARAM_INPUTS)) {
        if (!inputEl) continue;
        on(inputEl, 'change', () => {
            const p = currentPattern(editor);
            const shape = currentShape(p);
            shape.params = { ...shape.params, [key]: parseFloat(inputEl.value) };
            _regenerateSilhouetteAndFill();
        });
    }

    // ── Segments section wiring ─────────────────────────────────────
    function _curSegmentIndex() {
        return parseInt(segmentIndexEl?.value, 10) || 0;
    }
    /** A curve/kink needs a nonzero bulge to be visibly anything but a
     *  straight line — reuses the currently-shown value if it's already
     *  meaningful, else a sane starting magnitude. */
    function _curBulgeOrDefault() {
        const v = parseFloat(segBulgeEl?.value);
        return v > 0 ? v : 0.5;
    }
    /** T59: thin wrapper over the module-level `writeSegmentStyle` (the
     *  SAME function the canvas tap-a-segment popup calls) — this panel's
     *  own local UI resync happens for free, via the `SHAPE_CHANGED_EVENT`
     *  listener below (`syncFieldsFromPattern`), not a direct call here. */
    function _writeSegment(patch) {
        writeSegmentStyle(editor, _curSegmentIndex(), patch);
    }
    if (segmentIndexEl) {
        on(segmentIndexEl, 'change', () => {
            const p = currentPattern(editor);
            _syncSegmentFields(currentShape(p), _curSegmentIndex());
        });
    }
    if (segStyleStraightEl) on(segStyleStraightEl, 'click', () => _writeSegment({ style: 'straight', bulge: 0 }));
    if (segStyleCurveEl) on(segStyleCurveEl, 'click', () => _writeSegment({ style: 'curve', bulge: _curBulgeOrDefault() }));
    if (segStyleKinkEl) on(segStyleKinkEl, 'click', () => _writeSegment({ style: 'kink', bulge: _curBulgeOrDefault() }));
    if (segDirOutEl) on(segDirOutEl, 'click', () => _writeSegment({ dir: 'out' }));
    if (segDirInEl) on(segDirInEl, 'click', () => _writeSegment({ dir: 'in' }));
    if (segBulgeEl) on(segBulgeEl, 'change', () => _writeSegment({ bulge: parseFloat(segBulgeEl.value) || 0 }));

    // ── Fill section wiring (same shape as properties-lattice.js) ──
    async function selectOrientation(value) {
        if (orientHorizontalEl) orientHorizontalEl.classList.toggle('active', value === 'horizontal');
        if (orientVerticalEl) orientVerticalEl.classList.toggle('active', value === 'vertical');
        const p = readFieldsIntoPattern();
        await generatePattern(editor, p);
        syncGenerateLabel();
    }
    if (orientHorizontalEl) on(orientHorizontalEl, 'click', () => selectOrientation('horizontal'));
    if (orientVerticalEl) on(orientVerticalEl, 'click', () => selectOrientation('vertical'));

    if (railsModeCountEl) on(railsModeCountEl, 'click', () => _showRailsMode('count'));
    if (railsModeEveryEl) on(railsModeEveryEl, 'click', () => _showRailsMode('every'));
    if (tiesModeCountEl) on(tiesModeCountEl, 'click', () => _showTiesMode('count'));
    if (tiesModeDensityEl) on(tiesModeDensityEl, 'click', () => _showTiesMode('density'));
    if (tiesSpanModeCellsEl) on(tiesSpanModeCellsEl, 'click', () => _showTieSpanMode('cells'));
    if (tiesSpanModeRailsEl) on(tiesSpanModeRailsEl, 'click', () => _showTieSpanMode('rails'));

    // T72 (SE14c): an IMMEDIATE write+redraw, unlike the deferred-to-
    // Generate fields above — the contour is still computed/clipped
    // against exactly the same either way (regenerateSilhouetteAndFill
    // reruns the SAME fill), only its own drawn visibility changes, so
    // there's no reason to make the user press Generate to see it.
    if (contourShowEl) {
        on(contourShowEl, 'change', async () => {
            const p = currentPattern(editor);
            // T74 AMEND 1: spread the EXISTING contour object rather than
            // replacing it outright — `width` and `segmentColors` must
            // survive a plain checkbox toggle, not just `show`.
            p.contour = { ...PATTERN_DEFAULTS.contour, ...p.contour, show: !!contourShowEl.checked };
            await regenerateSilhouetteAndFill(editor);
        });
    }
    // T74 AMEND 1: same IMMEDIATE write+redraw as the show checkbox above
    // — the width field replaces the retired Border section's own width
    // field, which had the same immediate-effect behavior.
    if (contourWidthEl) {
        on(contourWidthEl, 'change', async () => {
            const p = currentPattern(editor);
            p.contour = {
                ...PATTERN_DEFAULTS.contour,
                ...p.contour,
                width: contourWidthEl.value !== '' ? parseFloat(contourWidthEl.value) : null,
            };
            await regenerateSilhouetteAndFill(editor);
        });
    }

    syncFieldsFromPattern();
    if (toolBtn) on(toolBtn, 'click', syncFieldsFromPattern);

    on(generateBtn, 'click', async () => {
        if (fillSeedEl) fillSeedEl.value = nextSeed();
        const p = readFieldsIntoPattern();
        // Defensive/idempotent: make sure the linked silhouette matches
        // the CURRENT Shape state before filling — a no-op re-render when
        // nothing shape-related changed since the last edit (each Shape
        // field already regenerates immediately on its own, above).
        regenerateSilhouette(editor, p);
        await generatePattern(editor, p);
        syncGenerateLabel();
        _refreshSegmentList(p);
    });

    wireColorSwatch(colorRailsEl, 'rails');
    wireColorSwatch(colorTiesEl, 'ties');
    wireColorSwatch(colorNodesEl, 'nodes');
    wireColorSwatch(colorContourEl, 'contour'); // T72 (AMEND 2): recolorOwnedKind's own 'contour' special case
    wireWidthStepper(widthRailsEl, 'rails', 'rails');
    wireWidthStepper(widthTiesEl, 'ties', 'ties');
    wireWidthStepper(widthNodesEl, 'nodeDiameter', 'nodes');
    wireLinkedWidthStepper();
    wireWidthLinkToggle();

    if (detachAllBtn) {
        on(detachAllBtn, 'click', () => {
            detachAllOwned(editor, getActiveLayer(editor));
        });
    }

    document.addEventListener('editorLayersChanged', (e) => {
        if (e.detail && e.detail.editor === editor) syncFieldsFromPattern();
    });
    // T59: a canvas-driven write (a param-handle drag release, a tap-a-
    // segment popup pick) calls the SAME module-level regenerate/write
    // functions this panel's own fields do, then dispatches this event —
    // re-syncing here (rather than the canvas code reaching back into
    // THIS panel's own closures) keeps the Segments dropdown / Shape
    // sliders in sync with zero coupling in the other direction. Fires
    // for this panel's OWN writes too (regenerateSilhouetteAndFill has no
    // way to know who called it) — a harmless redundant re-sync, same
    // idempotent shape `editorLayersChanged` above already tolerates.
    document.addEventListener(SHAPE_CHANGED_EVENT, (e) => {
        if (e.detail && e.detail.editor === editor) syncFieldsFromPattern();
    });
}
