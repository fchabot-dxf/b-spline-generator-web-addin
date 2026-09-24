/**
 * properties-lattice.js — SE7b slice 3: wires the Lattice Pattern panel
 * (bspline_gen_palette.html's #editorLatticePanel, shown only while the
 * Lattice tool is active — editor-ui.js's updateToolbarVisibility) to
 * editor._latticePattern and PATTERN_DEFAULTS. Same per-panel-module
 * shape as properties-shape.js / properties-text.js / properties-expand.js.
 * See SE7B-PATTERN-GENERATOR-DESIGN.md §5 for the mockup this markup follows.
 */
import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import {
    PATTERN_DEFAULTS, generatePattern, detachAllOwned, nextSeed, recolorOwnedKind,
} from './editor-lattice-pattern.js';
import { openColorMosaic } from './editor-color.js';

/** editor._latticePattern is set by generatePattern, or restored by
 *  editor-io.js's open() from a document's data-lattice-pattern — never
 *  invented here. A fresh deep-cloned default is used only until the
 *  user's first Generate ever runs. */
function _currentPattern(editor) {
    if (!editor._latticePattern) {
        editor._latticePattern = JSON.parse(JSON.stringify(PATTERN_DEFAULTS));
    }
    return editor._latticePattern;
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
    const orientHorizontalEl = el('latticeOrientHorizontal');
    const orientVerticalEl = el('latticeOrientVertical');
    const toolBtn = el('toolLattice');
    const panelEl = el('editorLatticePanel');
    const headerBtn = el('editorLatticePanelHeader');

    if (!generateBtn) return; // panel not present in this host — no-op, matches other properties-*.js modules' own guard shape

    // SE7p: the bottom-sheet collapse toggle (styles/editor.css gates the
    // actual show/hide behind its own <=720px media query — this handler
    // is wired unconditionally, same as every other control here, so
    // there's no separate "only on mobile" JS branch to keep in sync with
    // the CSS breakpoint).
    if (panelEl && headerBtn) {
        on(headerBtn, 'click', () => panelEl.classList.toggle('collapsed'));
    }

    // T32: expose this panel's own live rendered height as a CSS custom
    // property, so the floating undo/redo pill (styles/editor.css,
    // pointer:coarse + max-width:720px, where the panel becomes a fixed
    // bottom sheet) can lift itself clear of the sheet without a second
    // JS layout read of its own. ResizeObserver fires on any box-size
    // change — sheet collapse/expand, content growth, AND per spec when
    // the observed element's own display becomes 'none' (reports a zero
    // size) — so one observer here covers every case (including the
    // panel simply being hidden outside Lattice mode) without a separate
    // visibility branch.
    if (panelEl && typeof ResizeObserver !== 'undefined') {
        const syncSheetHeightVar = () => {
            document.documentElement.style.setProperty('--lattice-sheet-height', `${panelEl.offsetHeight}px`);
        };
        new ResizeObserver(syncSheetHeightVar).observe(panelEl);
    }

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

    function syncGenerateLabel() {
        const p = _currentPattern(editor);
        generateBtn.textContent = p.id ? 'Regenerate' : 'Generate';
    }

    /** Reflect editor._latticePattern onto every field. Called at bind
     *  time and again whenever the Lattice tool button is clicked (the
     *  panel's own show trigger) — a document opened with a different
     *  saved pattern (editor-io.js's open()) shouldn't show stale field
     *  values from whatever was on screen before. */
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
        syncGenerateLabel();
    }

    /** Read every field back into editor._latticePattern (mutated in
     *  place, matching generatePattern's own mutate-PATTERN-in-place
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
        return p;
    }

    /** SE7g AMEND: wire one Colors swatch button to the shared color
     *  mosaic. Picking a color updates PATTERN.colors[kind] (so the NEXT
     *  Generate/Regenerate uses it even if nothing is owned yet) and, if
     *  this pattern has already generated at least once (p.id exists),
     *  recolors the OWNED pieces of that kind in place — no reseed, one
     *  undo step (recolorOwnedKind's own pushState). A detached piece
     *  keeps its own color for free, via the same ownership check that
     *  already excludes it. */
    function wireColorSwatch(btnEl, kind) {
        if (!btnEl) return;
        on(btnEl, 'click', (e) => {
            e.stopPropagation();
            const p = _currentPattern(editor);
            openColorMosaic(btnEl, (hex) => {
                p.colors = { ...PATTERN_DEFAULTS.colors, ...p.colors, [kind]: hex };
                btnEl.style.background = hex;
                if (p.id) recolorOwnedKind(editor, p.id, kind, hex);
            });
        });
    }

    /** SE7h: flipping orientation is a RE-PROJECTION of the same pattern,
     *  not a reshuffle — regenerates immediately with the CURRENT seed
     *  (never rolls a new one; that's Generate's own job, SE7g), reading
     *  every other field fresh via readFieldsIntoPattern() so a flip
     *  mid-edit picks up whatever's currently in the panel. One undo step
     *  (generatePattern's own single pushState — no extra plumbing
     *  needed, same as every other field here). */
    function selectOrientation(value) {
        if (orientHorizontalEl) orientHorizontalEl.classList.toggle('active', value === 'horizontal');
        if (orientVerticalEl) orientVerticalEl.classList.toggle('active', value === 'vertical');
        const p = readFieldsIntoPattern();
        generatePattern(editor, p);
        syncGenerateLabel();
    }
    if (orientHorizontalEl) on(orientHorizontalEl, 'click', () => selectOrientation('horizontal'));
    if (orientVerticalEl) on(orientVerticalEl, 'click', () => selectOrientation('vertical'));

    syncFieldsFromPattern();
    on(toolBtn, 'click', syncFieldsFromPattern);

    on(generateBtn, 'click', () => {
        // SE7g (Fred: "the generate button needs to automatically use a
        // new seed"): roll BEFORE reading fields, so the fresh value is
        // what readFieldsIntoPattern picks up and what generatePattern
        // uses — one undo step total, same as every other field here
        // (this write is local to the panel's own DOM field, not P/
        // core-history, so it doesn't touch the global undo mechanism).
        if (seedEl) seedEl.value = nextSeed();
        const p = readFieldsIntoPattern();
        generatePattern(editor, p);
        syncGenerateLabel();
    });

    wireColorSwatch(colorRailsEl, 'rails');
    wireColorSwatch(colorTiesEl, 'ties');
    wireColorSwatch(colorNodesEl, 'nodes');

    on(detachAllBtn, 'click', () => {
        const p = _currentPattern(editor);
        if (p.id) detachAllOwned(editor, p.id);
    });
}
