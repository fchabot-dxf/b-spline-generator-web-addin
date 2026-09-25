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
 * `stampBoundaryRef` when it doesn't — e.g. right after "Pick shape…");
 * (2) the Fill/Boundary/Ending/Border sections are the SAME fields the
 * box Lattice panel used to carry for Boundary mode, now living here
 * instead (T58's own "the box # Lattice loses its Boundary row").
 */
import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import {
    PATTERN_DEFAULTS, generatePattern, detachAllOwned, nextSeed, recolorOwnedKind, rewidthOwnedKind, rewidthOwnedKinds,
    stampBoundaryRef, _findBoundaryElement,
} from './editor-lattice-pattern.js';
import { PRESETS, generateSilhouette, primitivesToPathD } from './editor-shape-lattice-generator.js';
import { openColorMosaic } from './editor-color.js';
import { getActiveLayer, ensureActiveLayer } from './layers.js';

// Same declared-table idiom properties-lattice.js used to own for this —
// moved here with the Ending select itself (T58's own panel split).
const BOUNDARY_END_RULES = [
    { value: 'on-boundary', label: 'On boundary' },
    { value: 'inset', label: 'Inset (default)' },
    { value: 'joint', label: 'Joint' },
    { value: 'loose', label: 'Loose' },
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

/** The generated silhouette's own stroke width — a small, FIXED value,
 *  deliberately NOT `editor._strokeWidth` (the general drawing tool's own
 *  CURRENT setting). Same bug class `emitSegment` (editor-lattice.js) was
 *  already fixed for once: "a live browser test found a 0.5in board-wide
 *  stroke on a 0.5in rail pitch" — found again live here, this turn: a
 *  0.5in default stroke on the silhouette's own pinched waist inset the
 *  boundary's own inner-fill cut (`_effectiveBorderWidth`/`edge:
 *  'inner-stroke'`, editor-lattice-pattern.js) far enough inward to leave
 *  ZERO room for any rail/tie at all — confirmed live (0 rails/0 ties
 *  after Generate), not assumed from reading the code alone. */
const SILHOUETTE_STROKE_WIDTH = 0.02;

/** SE14 §4's own "mirrored pairs" rule: at index `i` (the right/first
 *  half of the flat array), its mirror is `n-2-i` — the two CAP edges
 *  (bottom, at `n/2-1`, and top, at `n-1`) have no partner (each is its
 *  own single edge, not a left/right pair) and map to themselves. Derived
 *  directly from the generator's own solver doc comments (both presets'
 *  `fresh` arrays: right side 0..n/2-2, bottom cap at n/2-1, left side
 *  n/2..n-2 — a mirror of the right side in REVERSE order, top cap at
 *  n-1) rather than a per-preset hardcoded table, so it can't drift if a
 *  future preset changes segment count. */
function _mirrorSegmentIndex(i, n) {
  if (i === n / 2 - 1 || i === n - 1) return i;
  return n - 2 - i;
}

/** SE7i's own per-layer pattern lookup, duplicated here (not imported)
 *  the same way `_fmix32` is duplicated per-file elsewhere in this
 *  codebase — a small, private, state-free helper, not worth a shared
 *  import for two callers. */
function _activeLayerObj(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    return layers.find((l) => l.id === getActiveLayer(editor)) || null;
}
function _currentPattern(editor) {
    const layer = _activeLayerObj(editor);
    if (!layer) return JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    if (!layer.pattern) layer.pattern = JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    return layer.pattern;
}
/** Lazily materializes `p.shape` the same way `_currentPattern` itself
 *  lazily materializes `layer.pattern` — a layer that's never touched the
 *  Shape Lattice tool has no `.shape` key at all until this is called. */
function _currentShape(p) {
    if (!p.shape) p.shape = JSON.parse(JSON.stringify(PATTERN_DEFAULTS.shape));
    return p.shape;
}

/** SE14 §3 Q5 ruling ("explicit {x,y,w,h}, default = the board's inner
 *  rect"): v1's own region is the WHOLE board rect — the same `_mW`/`_mH`
 *  units `_resolveExtent`'s own 'board' branch already reads (inches),
 *  un-inset (no separate margin fraction is declared for this tool; the
 *  fill engine's own PATTERN.margin only applies to 'board' mode's row/
 *  column extent, not to boundary mode's own bbox — see
 *  `_resolveExtent`'s own doc comment). */
function _boardRegion(editor) {
  return { x: 0, y: 0, w: editor._mW || 4, h: editor._mH || 4 };
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
  return generateSilhouette(_boardRegion(editor), shape).segments;
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
    const nodesEndsEl = el('shapeLatticeNodesEnds');
    const nodesCrossingsEl = el('shapeLatticeNodesCrossings');
    const nodesRailEndsEl = el('shapeLatticeNodesRailEnds');
    const orientHorizontalEl = el('shapeLatticeOrientHorizontal');
    const orientVerticalEl = el('shapeLatticeOrientVertical');
    const colorRailsEl = el('shapeLatticeColorRails');
    const colorTiesEl = el('shapeLatticeColorTies');
    const colorNodesEl = el('shapeLatticeColorNodes');
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

    // ── Boundary / Ending / Border (moved here from the box Lattice
    //    panel — no Board/Shape toggle: this tool is ALWAYS boundary
    //    mode). ────────────────────────────────────────────────────────
    const pickShapeBtn = el('shapeLatticePickShape');
    const boundaryStatusEl = el('shapeLatticeBoundaryStatus');
    const endRuleEl = el('shapeLatticeEndRule');
    const borderEnabledEl = el('shapeLatticeBorderEnabled');
    const borderWidthEl = el('shapeLatticeBorderWidth');
    const borderColorEl = el('shapeLatticeBorderColor');
    const borderColorAutoEl = el('shapeLatticeBorderColorAuto');

    if (spacingEl) {
        spacingEl.innerHTML = '';
        for (const spacing of GRID_SPACINGS) {
            const opt = document.createElement('option');
            opt.value = String(spacing);
            opt.textContent = `${spacing}"`;
            spacingEl.appendChild(opt);
        }
    }
    if (endRuleEl) {
        endRuleEl.innerHTML = '';
        for (const { value, label } of BOUNDARY_END_RULES) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            endRuleEl.appendChild(opt);
        }
    }

    function syncGenerateLabel() {
        const p = _currentPattern(editor);
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
        const shape = _currentShape(p);
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

    /**
     * SE14 §6: regenerate the silhouette from the CURRENT `p.shape` and
     * emit/update its linked `<path>`. In-place `d` update when this
     * tool's own generated path is ALREADY the link (`shape.source
     * ==='generated'` AND that element still exists); otherwise mints a
     * fresh `<path>`, `stampBoundaryRef`s it, and re-links — the same
     * "re-picking stamps a NEW id, the old element's own tag is left in
     * place, inert" convention T49's boundary link already established
     * (covers BOTH "first generate ever" and "was linked to a hand-PICKED
     * shape, now generating" — the picked element is never overwritten).
     * Pure geometry + DOM emit only — the Fill re-run is the caller's own
     * job (see `_regenerateSilhouetteAndFill` below), matching
     * `generatePattern`'s own "read `PATTERN.boundary.shapeId` fresh"
     * contract exactly.
     */
    function _regenerateSilhouette(p) {
        const shape = _currentShape(p);
        const region = _boardRegion(editor);
        const { primitives, segments } = generateSilhouette(region, shape);
        shape.segments = segments;
        const d = primitivesToPathD(primitives);
        const reuseExisting = shape.source === 'generated' && p.boundary && p.boundary.shapeId;
        let pathEl = reuseExisting ? _findBoundaryElement(editor, p.boundary.shapeId) : null;
        if (pathEl) {
            pathEl.attr('d', d);
        } else {
            pathEl = editor._sketchLayer
                .path(d)
                .fill('none')
                .stroke({ color: editor._color || '#000000', width: SILHOUETTE_STROKE_WIDTH })
                .attr('data-layer', ensureActiveLayer(editor));
            const id = stampBoundaryRef(pathEl);
            p.boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary, shapeId: id };
        }
        p.extent = { mode: 'boundary' };
        shape.source = 'generated';
        if (boundaryStatusEl) boundaryStatusEl.textContent = 'Shape linked';
        return pathEl;
    }

    /** Shape-section edits (preset, reroll, a param, a segment's own
     *  style) are an IMMEDIATE re-projection — same "settings that change
     *  the shape itself take effect right away" contract Orientation
     *  already has in properties-lattice.js — because the Fill is
     *  entirely DERIVED from this boundary; leaving a stale fill against
     *  a just-changed silhouette would look broken, not just deferred.
     *  Calls `generatePattern` directly (not the indirect commit-hook
     *  `refreshBoundaryPatterns` already provides) so a slider release
     *  updates the canvas on the SAME tick, no microtask gap. */
    async function _regenerateSilhouetteAndFill() {
        const p = _currentPattern(editor);
        _regenerateSilhouette(p);
        await generatePattern(editor, p);
        syncGenerateLabel();
        _refreshSegmentList(p);
    }

    function syncFieldsFromPattern() {
        const p = _currentPattern(editor);
        const shape = _currentShape(p);

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
        if (nodesEndsEl) nodesEndsEl.checked = p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends;
        if (nodesCrossingsEl) nodesCrossingsEl.checked = p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings;
        if (nodesRailEndsEl) nodesRailEndsEl.checked = p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds;
        if (fillSeedEl) fillSeedEl.value = p.seed ?? PATTERN_DEFAULTS.seed;
        const colors = { ...PATTERN_DEFAULTS.colors, ...p.colors };
        if (colorRailsEl) colorRailsEl.style.background = colors.rails;
        if (colorTiesEl) colorTiesEl.style.background = colors.ties;
        if (colorNodesEl) colorNodesEl.style.background = colors.nodes;
        const rawWidths = p.widths || {};
        const widths = { ...PATTERN_DEFAULTS.widths, ...rawWidths };
        if (widthRailsEl) widthRailsEl.value = widths.rails;
        if (widthTiesEl) widthTiesEl.value = widths.ties;
        if (widthLinkedEl) widthLinkedEl.value = widths.rails;
        if (widthNodesEl) widthNodesEl.value = widths.nodeRadius;
        // T58 ADD-ON: same migration-aware inference properties-lattice.js's
        // own panel uses (see that file's own comment on this exact point).
        const widthLinked = 'linkRailsTies' in rawWidths ? rawWidths.linkRailsTies : widths.rails === widths.ties;
        _showWidthLinkMode(widthLinked);

        const boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary };
        if (boundaryStatusEl) boundaryStatusEl.textContent = boundary.shapeId ? 'Shape linked' : 'No shape picked';
        if (endRuleEl) endRuleEl.value = boundary.endRule;
        const border = { ...PATTERN_DEFAULTS.boundary.border, ...boundary.border };
        if (borderEnabledEl) borderEnabledEl.checked = !!border.enabled;
        if (borderWidthEl) borderWidthEl.value = border.width == null ? '' : border.width;
        if (borderColorEl) borderColorEl.style.background = border.color || '#ffffff';
        if (borderColorAutoEl) borderColorAutoEl.classList.toggle('active', border.color == null);

        syncGenerateLabel();
    }

    /** The Fill/Boundary/Ending/Border half of the pattern, read from the
     *  panel into `p` — the SAME shape properties-lattice.js's own
     *  readFieldsIntoPattern has, minus Board/Shape (this tool is ALWAYS
     *  boundary mode — `p.extent`/`p.boundary.endRule`/`.border` are
     *  ALWAYS written here, unlike box Lattice's own version, which now
     *  leaves them untouched). `p.shape.*` is NOT read here — the Shape
     *  section writes it immediately, on its own field changes (see
     *  `_regenerateSilhouetteAndFill` above), not deferred to Generate. */
    function readFieldsIntoPattern() {
        const p = _currentPattern(editor);
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
            nodeRadius: widthNodesEl ? (parseFloat(widthNodesEl.value) || PATTERN_DEFAULTS.widths.nodeRadius) : (p.widths?.nodeRadius ?? PATTERN_DEFAULTS.widths.nodeRadius),
            linkRailsTies: widthLinked,
        };
        // T58: this tool is ALWAYS boundary mode — no Board/Shape toggle.
        p.extent = { mode: 'boundary' };
        p.boundary = {
            ...PATTERN_DEFAULTS.boundary,
            ...p.boundary,
            endRule: endRuleEl ? endRuleEl.value : (p.boundary?.endRule ?? PATTERN_DEFAULTS.boundary.endRule),
            border: {
                ...PATTERN_DEFAULTS.boundary.border,
                ...p.boundary?.border,
                enabled: borderEnabledEl ? !!borderEnabledEl.checked : (p.boundary?.border?.enabled ?? false),
                width: borderWidthEl && borderWidthEl.value !== '' ? parseFloat(borderWidthEl.value) : null,
                color: p.boundary?.border?.color ?? null,
            },
        };
        return p;
    }

    function wireColorSwatch(btnEl, kind) {
        if (!btnEl) return;
        on(btnEl, 'click', (e) => {
            e.stopPropagation();
            const p = _currentPattern(editor);
            openColorMosaic(btnEl, (hex) => {
                p.colors = { ...PATTERN_DEFAULTS.colors, ...p.colors, [kind]: hex };
                btnEl.style.background = hex;
                recolorOwnedKind(editor, getActiveLayer(editor), kind, hex);
            });
        });
    }
    function wireBorderColorSwatch(btnEl, autoEl) {
        if (!btnEl) return;
        on(btnEl, 'click', (e) => {
            e.stopPropagation();
            const p = _currentPattern(editor);
            openColorMosaic(btnEl, (hex) => {
                p.boundary = {
                    ...PATTERN_DEFAULTS.boundary, ...p.boundary,
                    border: { ...PATTERN_DEFAULTS.boundary.border, ...p.boundary?.border, color: hex },
                };
                btnEl.style.background = hex;
                if (autoEl) autoEl.classList.remove('active');
            });
        });
        if (autoEl) {
            on(autoEl, 'click', () => {
                const p = _currentPattern(editor);
                p.boundary = {
                    ...PATTERN_DEFAULTS.boundary, ...p.boundary,
                    border: { ...PATTERN_DEFAULTS.boundary.border, ...p.boundary?.border, color: null },
                };
                btnEl.style.background = '#ffffff';
                autoEl.classList.add('active');
            });
        }
    }
    function wireWidthStepper(inputEl, field, kind) {
        if (!inputEl) return;
        on(inputEl, 'change', () => {
            const p = _currentPattern(editor);
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
            const p = _currentPattern(editor);
            const value = parseFloat(widthLinkedEl.value) || PATTERN_DEFAULTS.widths.rails;
            p.widths = { ...PATTERN_DEFAULTS.widths, ...p.widths, rails: value, ties: value, linkRailsTies: true };
            widthLinkedEl.value = value;
            rewidthOwnedKinds(editor, getActiveLayer(editor), [['rails', value], ['ties', value]]);
        });
    }
    function wireWidthLinkToggle() {
        if (!widthLinkToggleEl) return;
        on(widthLinkToggleEl, 'click', () => {
            const p = _currentPattern(editor);
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
        const p = _currentPattern(editor);
        const shape = _currentShape(p);
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
            const p = _currentPattern(editor);
            const shape = _currentShape(p);
            shape.seed = nextSeed();
            if (shapeSeedEl) shapeSeedEl.value = shape.seed;
            _regenerateSilhouetteAndFill();
        });
    }
    if (shapeSeedEl) {
        on(shapeSeedEl, 'change', () => {
            const p = _currentPattern(editor);
            _currentShape(p).seed = parseInt(shapeSeedEl.value, 10) || 0;
            _regenerateSilhouetteAndFill();
        });
    }
    for (const [key, inputEl] of Object.entries(PARAM_INPUTS)) {
        if (!inputEl) continue;
        on(inputEl, 'change', () => {
            const p = _currentPattern(editor);
            const shape = _currentShape(p);
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
    function _writeSegment(patch) {
        const p = _currentPattern(editor);
        const shape = _currentShape(p);
        if (!Array.isArray(shape.segments)) shape.segments = _effectiveSegments(editor, shape);
        const n = shape.segments.length;
        const index = _curSegmentIndex();
        const cur = shape.segments[index] || { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 };
        const next = { ...cur, ...patch };
        shape.segments[index] = next;
        // SE14 §4: mirrored pairs change together — the two cap edges
        // (top/bottom) have no partner (_mirrorSegmentIndex returns the
        // same index for them), a no-op spread in that case.
        const mirror = _mirrorSegmentIndex(index, n);
        if (mirror !== index) shape.segments[mirror] = { ...next };
        _regenerateSilhouetteAndFill();
    }
    if (segmentIndexEl) {
        on(segmentIndexEl, 'change', () => {
            const p = _currentPattern(editor);
            _syncSegmentFields(_currentShape(p), _curSegmentIndex());
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

    // ── Boundary section wiring: "Pick shape…" — same T49 mechanism the
    //    box Lattice panel used to own, moved here verbatim. Does NOT
    //    auto-Generate (same "the explicit button is the one trigger"
    //    convention), so the user can still adjust Fill before committing.
    if (pickShapeBtn) {
        on(pickShapeBtn, 'click', () => {
            if (boundaryStatusEl) boundaryStatusEl.textContent = 'Click a shape on the canvas…';
            editor._boundaryPickCallback = (hitEl) => {
                if (!hitEl) {
                    if (boundaryStatusEl) boundaryStatusEl.textContent = 'Pick cancelled';
                    return;
                }
                const p = _currentPattern(editor);
                const id = stampBoundaryRef(hitEl);
                p.boundary = { ...PATTERN_DEFAULTS.boundary, ...p.boundary, shapeId: id };
                p.extent = { mode: 'boundary' };
                // SE14 §6: a hand-picked shape is NOT this tool's own
                // generated output — the Shape section's own controls
                // become inert cosmetically until the user touches one of
                // them again (which regenerates and re-links, see
                // _regenerateSilhouette's own `reuseExisting` guard).
                _currentShape(p).source = 'picked';
                if (boundaryStatusEl) boundaryStatusEl.textContent = 'Shape linked';
            };
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
        _regenerateSilhouette(p);
        await generatePattern(editor, p);
        syncGenerateLabel();
        _refreshSegmentList(p);
    });

    wireColorSwatch(colorRailsEl, 'rails');
    wireColorSwatch(colorTiesEl, 'ties');
    wireColorSwatch(colorNodesEl, 'nodes');
    wireWidthStepper(widthRailsEl, 'rails', 'rails');
    wireWidthStepper(widthTiesEl, 'ties', 'ties');
    wireWidthStepper(widthNodesEl, 'nodeRadius', 'nodes');
    wireLinkedWidthStepper();
    wireWidthLinkToggle();
    wireBorderColorSwatch(borderColorEl, borderColorAutoEl);

    if (detachAllBtn) {
        on(detachAllBtn, 'click', () => {
            detachAllOwned(editor, getActiveLayer(editor));
        });
    }

    document.addEventListener('editorLayersChanged', (e) => {
        if (e.detail && e.detail.editor === editor) syncFieldsFromPattern();
    });
}
