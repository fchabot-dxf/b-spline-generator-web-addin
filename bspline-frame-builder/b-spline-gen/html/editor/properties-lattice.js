/**
 * properties-lattice.js — SE7b slice 3: wires the Lattice Pattern panel
 * (bspline_gen_palette.html's #editorLatticePanel, shown only while the
 * Lattice tool is active — editor-ui.js's updateToolbarVisibility) to
 * the ACTIVE layer's own `.pattern` (SE7i — see _currentPattern below)
 * and PATTERN_DEFAULTS. Same per-panel-module shape as properties-shape.js
 * / properties-text.js / properties-expand.js.
 * See SE7B-PATTERN-GENERATOR-DESIGN.md §5 for the mockup this markup follows.
 */
import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import { LATTICE_DRAW_KINDS } from './editor-lattice.js';
import {
    PATTERN_DEFAULTS, generatePattern, detachAllOwned, nextSeed, recolorOwnedKind, rewidthOwnedKind,
    stampBoundaryRef,
} from './editor-lattice-pattern.js';
import { openColorMosaic } from './editor-color.js';
import { getActiveLayer } from './layers.js';

// T49 (SE13 Slice 3): the ending-rule table, declared once so the
// Boundary panel's own <select> renders from this list rather than a
// hand-typed <option> set that could drift from computePattern's own
// dispatch (editor-lattice-pattern.js's _applyEndRule) — same "declared
// table drives the control" shape LATTICE_DRAW_KINDS already uses.
const BOUNDARY_END_RULES = [
    { value: 'on-boundary', label: 'On boundary' },
    { value: 'inset', label: 'Inset (default)' },
    { value: 'joint', label: 'Joint' },
    { value: 'loose', label: 'Loose' },
];

/** SE7i: Pattern settings live ON THE ACTIVE LAYER now (`layer.pattern`),
 *  not once per file — Generate/Regenerate write into whichever layer is
 *  active, so each layer keeps its own seed/orientation/rails/ties/nodes/
 *  colors/widths independently (retires the old file-level
 *  editor._latticePattern, which forced every layer through one shared
 *  pattern). A fresh layer with no `.pattern` yet gets a deep-cloned
 *  default the FIRST time this is called for it (lazily, not at layer-
 *  creation time — most layers never touch the Lattice tool at all). */
function _activeLayerObj(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    return layers.find((l) => l.id === getActiveLayer(editor)) || null;
}
function _currentPattern(editor) {
    const layer = _activeLayerObj(editor);
    if (!layer) return JSON.parse(JSON.stringify(PATTERN_DEFAULTS)); // defensive: no layers at all yet
    if (!layer.pattern) layer.pattern = JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    return layer.pattern;
}

export function initLatticeProperties(editor) {
    const spacingEl = el('latticeSpacing');
    const railsEveryEl = el('latticeRailsEvery');
    const railsOffsetEl = el('latticeRailsOffset');
    const tiesDensityEl = el('latticeTiesDensity');
    const tiesSpanMinEl = el('latticeTiesSpanMin');
    const tiesSpanMaxEl = el('latticeTiesSpanMax');
    const tiesAnchorEl = el('latticeTiesAnchor');
    const tiesRailSnapRowsEl = el('latticeTiesRailSnapRows');
    const nodesEndsEl = el('latticeNodesEnds');
    const nodesCrossingsEl = el('latticeNodesCrossings');
    const nodesRailEndsEl = el('latticeNodesRailEnds');
    const seedEl = el('latticeSeed');
    const generateBtn = el('latticeGenerate');
    const detachAllBtn = el('latticeDetachAll');
    const colorRailsEl = el('latticeColorRails');
    const colorTiesEl = el('latticeColorTies');
    const colorNodesEl = el('latticeColorNodes');
    const widthRailsEl = el('latticeWidthRails');
    const widthTiesEl = el('latticeWidthTies');
    const widthNodesEl = el('latticeWidthNodes');
    const orientHorizontalEl = el('latticeOrientHorizontal');
    const orientVerticalEl = el('latticeOrientVertical');
    // T49 (SE13 Slice 3): Boundary / Ending / Border controls.
    const boundaryBoardEl = el('latticeBoundaryBoard');
    const boundaryShapeEl = el('latticeBoundaryShape');
    const pickShapeBtn = el('latticePickShape');
    const boundaryStatusEl = el('latticeBoundaryStatus');
    const endRuleEl = el('latticeEndRule');
    const borderEnabledEl = el('latticeBorderEnabled');
    const borderWidthEl = el('latticeBorderWidth');
    const borderColorEl = el('latticeBorderColor');
    const borderColorAutoEl = el('latticeBorderColorAuto');
    const toolBtn = el('toolLattice');
    const addKindEls = {};
    for (const { value } of LATTICE_DRAW_KINDS) addKindEls[value] = el(`latticeAdd-${value}`);
    if (!generateBtn) return; // panel not present in this host — no-op, matches other properties-*.js modules' own guard shape

    // MOB3: the old bottom-sheet collapse toggle (a click on
    // #editorLatticePanelHeader) and its --lattice-sheet-height
    // ResizeObserver are RETIRED — editor-drawer.js's own drag/tap-to-
    // snap mechanism and --drawer-height ResizeObserver (on
    // #editorMobileDrawer, not this panel alone) replace both, now that
    // the drawer — not this panel by itself — is the one thing that can
    // cover the canvas bottom.

    // Spacing select populated at bind time from GRID_SPACINGS — same
    // idiom properties-shape.js's initGridToggle already uses for the
    // grid's own spacing select (SA-TEXT-6 used the same pattern for
    // the font-family select) — no hand-typed <option> list to drift.
    if (spacingEl) {
        spacingEl.innerHTML = '';
        for (const spacing of GRID_SPACINGS) {
            const opt = document.createElement('option');
            opt.value = String(spacing);
            opt.textContent = `${spacing}"`;
            spacingEl.appendChild(opt);
        }
    }

    // T49: same declared-table idiom, for the ending-rule select.
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

    /** Reflect the active layer's own pattern onto every field. Called at
     *  bind time, whenever the Lattice tool button is clicked (the panel's
     *  own show trigger), and whenever the active layer itself changes
     *  (SE7i: settings are per-layer now — switching layers must reload
     *  THAT layer's own values, not keep showing the previous layer's). A
     *  document opened with a different saved pattern (editor-io.js's
     *  open()) shouldn't show stale field values from whatever was on
     *  screen before either. */
    function syncFieldsFromPattern() {
        const p = _currentPattern(editor);
        // SE7h: reflect the current orientation onto the segmented
        // control — an existing saved pattern from before this field
        // existed has no `orientation` key, reading as 'horizontal'
        // (PATTERN_DEFAULTS', matching computePattern's own `{
        // ...PATTERN_DEFAULTS, ...PATTERN }` merge — no migration).
        const orientation = p.orientation ?? PATTERN_DEFAULTS.orientation;
        if (orientHorizontalEl) orientHorizontalEl.classList.toggle('active', orientation !== 'vertical');
        if (orientVerticalEl) orientVerticalEl.classList.toggle('active', orientation === 'vertical');
        if (spacingEl) spacingEl.value = String(p.spacing ?? PATTERN_DEFAULTS.spacing);
        if (railsEveryEl) railsEveryEl.value = p.rails?.every ?? PATTERN_DEFAULTS.rails.every;
        if (railsOffsetEl) railsOffsetEl.value = p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset;
        if (tiesDensityEl) tiesDensityEl.value = p.ties?.density ?? PATTERN_DEFAULTS.ties.density;
        if (tiesSpanMinEl) tiesSpanMinEl.value = p.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin;
        if (tiesSpanMaxEl) tiesSpanMaxEl.value = p.ties?.spanMax ?? PATTERN_DEFAULTS.ties.spanMax;
        // Q1 (design doc open question, ruled by the advisor in T21's
        // dispatch): anchor is DATA — T30 (Fred: "don't limit it to
        // rails, but do snap to them") settles it as 'free' + snapping
        // by default; PATTERN_DEFAULTS.ties.anchor is what a brand-new
        // pattern gets, this field just reflects/edits whatever the
        // current PATTERN already has (an existing saved 'rails' pattern
        // keeps reading back as 'rails' — no migration).
        if (tiesAnchorEl) tiesAnchorEl.value = p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor;
        if (tiesRailSnapRowsEl) tiesRailSnapRowsEl.value = p.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
        if (nodesEndsEl) nodesEndsEl.checked = p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends;
        if (nodesCrossingsEl) nodesCrossingsEl.checked = p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings;
        if (nodesRailEndsEl) nodesRailEndsEl.checked = p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds;
        if (seedEl) seedEl.value = p.seed ?? PATTERN_DEFAULTS.seed;
        const colors = { ...PATTERN_DEFAULTS.colors, ...p.colors };
        if (colorRailsEl) colorRailsEl.style.background = colors.rails;
        if (colorTiesEl) colorTiesEl.style.background = colors.ties;
        if (colorNodesEl) colorNodesEl.style.background = colors.nodes;
        const widths = { ...PATTERN_DEFAULTS.widths, ...p.widths };
        if (widthRailsEl) widthRailsEl.value = widths.rails;
        if (widthTiesEl) widthTiesEl.value = widths.ties;
        if (widthNodesEl) widthNodesEl.value = widths.nodeRadius;

        // T49 (SE13 Slice 3): Boundary / Ending / Border.
        const boundaryMode = p.extent?.mode === 'boundary' ? 'boundary' : 'board';
        if (boundaryBoardEl) boundaryBoardEl.classList.toggle('active', boundaryMode !== 'boundary');
        if (boundaryShapeEl) boundaryShapeEl.classList.toggle('active', boundaryMode === 'boundary');
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

    /** Read every field back into the active layer's own pattern (mutated
     *  in place, matching generatePattern's own mutate-PATTERN-in-place
     *  contract) and return it. */
    function readFieldsIntoPattern() {
        const p = _currentPattern(editor);
        // SE7h: the segmented control's own `.active` state IS the source
        // of truth (same "read the control, not a separate variable" shape
        // as nodesEndsEl.checked below) — Vertical active means vertical,
        // anything else (including a fresh panel with neither button
        // wired) reads as horizontal.
        p.orientation = orientVerticalEl?.classList.contains('active') ? 'vertical' : 'horizontal';
        if (spacingEl) p.spacing = parseFloat(spacingEl.value) || PATTERN_DEFAULTS.spacing;
        p.rails = {
            every: railsEveryEl ? (parseInt(railsEveryEl.value, 10) || 1) : (p.rails?.every ?? PATTERN_DEFAULTS.rails.every),
            offset: railsOffsetEl ? (parseInt(railsOffsetEl.value, 10) || 0) : (p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset),
        };
        p.ties = {
            ...PATTERN_DEFAULTS.ties,
            ...p.ties,
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
        if (seedEl) p.seed = parseInt(seedEl.value, 10) || 0;
        p.widths = {
            rails: widthRailsEl ? (parseFloat(widthRailsEl.value) || PATTERN_DEFAULTS.widths.rails) : (p.widths?.rails ?? PATTERN_DEFAULTS.widths.rails),
            ties: widthTiesEl ? (parseFloat(widthTiesEl.value) || PATTERN_DEFAULTS.widths.ties) : (p.widths?.ties ?? PATTERN_DEFAULTS.widths.ties),
            nodeRadius: widthNodesEl ? (parseFloat(widthNodesEl.value) || PATTERN_DEFAULTS.widths.nodeRadius) : (p.widths?.nodeRadius ?? PATTERN_DEFAULTS.widths.nodeRadius),
        };

        // T49: extent.mode is driven by the Board/Shape toggle's own
        // `.active` state (same "the control IS the source of truth"
        // shape Orientation already uses above) — Shape active means
        // 'boundary', anything else (including no toggle wired) means
        // 'board', so an existing saved pattern with no Boundary UI at
        // all keeps reading as plain Board mode, unchanged.
        const wantsBoundary = !!(boundaryShapeEl && boundaryShapeEl.classList.contains('active'));
        p.extent = wantsBoundary ? { mode: 'boundary' } : { mode: 'board' };
        p.boundary = {
            ...PATTERN_DEFAULTS.boundary,
            ...p.boundary,
            endRule: endRuleEl ? endRuleEl.value : (p.boundary?.endRule ?? PATTERN_DEFAULTS.boundary.endRule),
            border: {
                ...PATTERN_DEFAULTS.boundary.border,
                ...p.boundary?.border,
                enabled: borderEnabledEl ? !!borderEnabledEl.checked : (p.boundary?.border?.enabled ?? false),
                width: borderWidthEl && borderWidthEl.value !== '' ? parseFloat(borderWidthEl.value) : null,
                color: p.boundary?.border?.color ?? null, // set only via the color-swatch picker below, never re-parsed from a text field
            },
        };
        return p;
    }

    /** SE7g AMEND (SE7i: layer-scoped): wire one Colors swatch button to
     *  the shared color mosaic. Picking a color updates PATTERN.colors
     *  [kind] (so the NEXT Generate/Regenerate uses it even if nothing is
     *  owned yet) and recolors the ACTIVE layer's already-OWNED pieces of
     *  that kind in place — no reseed, one undo step (recolorOwnedKind's
     *  own pushState; a no-op, no pushState, when nothing is owned yet).
     *  A detached piece keeps its own color for free, via the same
     *  ownership check that already excludes it. */
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

    /** T49: the Border piece's own color swatch — NOT wireColorSwatch
     *  above (that one's recolorOwnedKind call is keyed by
     *  COLOR_KIND_TO_LATTICE_ATTR's rails/ties/nodes vocabulary only, and
     *  a live in-place border recolor isn't built this slice — a picked
     *  color takes effect on the next Generate/Regenerate, same as every
     *  OTHER Boundary/Ending/Border field). `autoEl` is a small reset
     *  affordance back to `color: null` ("inherit the boundary shape's
     *  own stroke", Fred's own default ruling). */
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

    /** SE7i (Section 2, "Widths"): the size-editing mirror of
     *  wireColorSwatch above — a stepper's own value edits PATTERN.widths
     *  [field] AND re-widths the ACTIVE layer's already-owned pieces of
     *  that kind in place (rewidthOwnedKind), same "no reseed, just a
     *  live rewrite" contract as Colors. `field` is the PATTERN.widths key
     *  ('rails'/'ties'/'nodeRadius'); `kind` is recolorOwnedKind's own
     *  kind name ('rails'/'ties'/'nodes') — rewidthOwnedKind shares that
     *  same kind vocabulary. */
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

    /** SE7h: flipping orientation is a RE-PROJECTION of the same pattern,
     *  not a reshuffle — regenerates immediately with the CURRENT seed
     *  (never rolls a new one; that's Generate's own job, SE7g), reading
     *  every other field fresh via readFieldsIntoPattern() so a flip
     *  mid-edit picks up whatever's currently in the panel. One undo step
     *  (generatePattern's own single pushState — no extra plumbing
     *  needed, same as every other field here). */
    async function selectOrientation(value) {
        if (orientHorizontalEl) orientHorizontalEl.classList.toggle('active', value === 'horizontal');
        if (orientVerticalEl) orientVerticalEl.classList.toggle('active', value === 'vertical');
        const p = readFieldsIntoPattern();
        await generatePattern(editor, p); // T49: generatePattern is now async (boundary mode's own shapeToPrimitives)
        syncGenerateLabel();
    }
    if (orientHorizontalEl) on(orientHorizontalEl, 'click', () => selectOrientation('horizontal'));
    if (orientVerticalEl) on(orientVerticalEl, 'click', () => selectOrientation('vertical'));

    /** T49 (SE13 §13): the Boundary "Board | Shape" segmented toggle —
     *  a settings field like Orientation/Rails/Ties, NOT an immediate
     *  action (unlike Orientation, which re-projects right away) — Board/
     *  Shape only takes effect on the next explicit Generate/Regenerate,
     *  same as every other structural field in this panel (rails.every,
     *  ties.density, ...). Picking a shape (below) switches to 'boundary'
     *  automatically, since picking one only makes sense in Shape mode. */
    function selectBoundaryMode(mode) {
        if (boundaryBoardEl) boundaryBoardEl.classList.toggle('active', mode !== 'boundary');
        if (boundaryShapeEl) boundaryShapeEl.classList.toggle('active', mode === 'boundary');
    }
    if (boundaryBoardEl) on(boundaryBoardEl, 'click', () => selectBoundaryMode('board'));
    if (boundaryShapeEl) on(boundaryShapeEl, 'click', () => selectBoundaryMode('boundary'));

    /** T49 (SE13 §13, "Pick shape..."): arms the editor's own one-shot
     *  pick affordance (editor-interaction.js's handleStart, checked
     *  before the mode dispatch) — the NEXT click anywhere on the canvas,
     *  in whatever tool happens to be active, is consumed as a boundary
     *  pick instead of that tool's own gesture. Stamps (or reuses)
     *  `data-boundary-ref` on the hit element and stores its id on
     *  `PATTERN.boundary.shapeId` — does NOT auto-Generate (same "the
     *  explicit button is the one trigger" convention structural fields
     *  already follow here), so the user can still adjust Ending/Border/
     *  Rails/Ties before committing to a Generate. */
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
                selectBoundaryMode('boundary');
                if (boundaryStatusEl) boundaryStatusEl.textContent = 'Shape linked';
            };
        });
    }

    /** SE7k: which explicit kind the Lattice tool's next click/drag draws
     *  — session-only tool state (editor._lattice.drawKind, same scope as
     *  autoNodes), NOT a per-layer pattern field, so this never touches
     *  _currentPattern/readFieldsIntoPattern and needs no undo step of
     *  its own (nothing is drawn by clicking the button itself). */
    function selectDrawKind(value) {
        editor._lattice.drawKind = value;
        for (const { value: v } of LATTICE_DRAW_KINDS) {
            if (addKindEls[v]) addKindEls[v].classList.toggle('active', v === value);
        }
    }
    for (const { value } of LATTICE_DRAW_KINDS) {
        if (addKindEls[value]) on(addKindEls[value], 'click', () => selectDrawKind(value));
    }

    syncFieldsFromPattern();
    on(toolBtn, 'click', syncFieldsFromPattern);

    on(generateBtn, 'click', async () => {
        // SE7g (Fred: "the generate button needs to automatically use a
        // new seed"): roll BEFORE reading fields, so the fresh value is
        // what readFieldsIntoPattern picks up and what generatePattern
        // uses — one undo step total, same as every other field here
        // (this write is local to the panel's own DOM field, not P/
        // core-history, so it doesn't touch the global undo mechanism).
        if (seedEl) seedEl.value = nextSeed();
        const p = readFieldsIntoPattern();
        await generatePattern(editor, p); // T49: generatePattern is now async (boundary mode's own shapeToPrimitives)
        syncGenerateLabel();
    });

    wireColorSwatch(colorRailsEl, 'rails');
    wireColorSwatch(colorTiesEl, 'ties');
    wireColorSwatch(colorNodesEl, 'nodes');
    wireWidthStepper(widthRailsEl, 'rails', 'rails');
    wireWidthStepper(widthTiesEl, 'ties', 'ties');
    wireWidthStepper(widthNodesEl, 'nodeRadius', 'nodes');
    wireBorderColorSwatch(borderColorEl, borderColorAutoEl);

    on(detachAllBtn, 'click', () => {
        detachAllOwned(editor, getActiveLayer(editor));
    });

    // SE7i: settings are per-LAYER now — switching the active layer must
    // reload ITS OWN pattern into the panel, not keep showing whatever the
    // previously-active layer had. editorLayersChanged already fires on
    // every active-layer switch (layers.js's setActiveLayer ->
    // renderLayersPanel), so this re-syncs for free without a new event.
    document.addEventListener('editorLayersChanged', (e) => {
        if (e.detail && e.detail.editor === editor) syncFieldsFromPattern();
    });
}
