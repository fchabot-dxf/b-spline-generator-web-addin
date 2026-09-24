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
import { PATTERN_DEFAULTS, generatePattern, detachAllOwned } from './editor-lattice-pattern.js';

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
    const nodesEndsEl = el('latticeNodesEnds');
    const nodesCrossingsEl = el('latticeNodesCrossings');
    const seedEl = el('latticeSeed');
    const rerollBtn = el('latticeReroll');
    const generateBtn = el('latticeGenerate');
    const detachAllBtn = el('latticeDetachAll');
    const toolBtn = el('toolLattice');

    if (!generateBtn) return; // panel not present in this host — no-op, matches other properties-*.js modules' own guard shape

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
        if (spacingEl) spacingEl.value = String(p.spacing ?? PATTERN_DEFAULTS.spacing);
        if (railsEveryEl) railsEveryEl.value = p.rails?.every ?? PATTERN_DEFAULTS.rails.every;
        if (railsOffsetEl) railsOffsetEl.value = p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset;
        if (tiesDensityEl) tiesDensityEl.value = p.ties?.density ?? PATTERN_DEFAULTS.ties.density;
        if (tiesSpanMinEl) tiesSpanMinEl.value = p.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin;
        if (tiesSpanMaxEl) tiesSpanMaxEl.value = p.ties?.spanMax ?? PATTERN_DEFAULTS.ties.spanMax;
        // Q1 (design doc open question, ruled by the advisor in T21's
        // dispatch): anchor is DATA, default 'rails' — Fred hasn't
        // answered which he prefers, so PATTERN_DEFAULTS.ties.anchor
        // ('rails') is what a brand-new pattern gets; this field just
        // reflects/edits whatever the current PATTERN already has.
        if (tiesAnchorEl) tiesAnchorEl.value = p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor;
        if (nodesEndsEl) nodesEndsEl.checked = p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends;
        if (nodesCrossingsEl) nodesCrossingsEl.checked = p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings;
        if (seedEl) seedEl.value = p.seed ?? PATTERN_DEFAULTS.seed;
        syncGenerateLabel();
    }

    /** Read every field back into editor._latticePattern (mutated in
     *  place, matching generatePattern's own mutate-PATTERN-in-place
     *  contract) and return it. */
    function readFieldsIntoPattern() {
        const p = _currentPattern(editor);
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
        };
        p.nodes = {
            ends: nodesEndsEl ? !!nodesEndsEl.checked : (p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends),
            crossings: nodesCrossingsEl ? !!nodesCrossingsEl.checked : (p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings),
        };
        if (seedEl) p.seed = parseInt(seedEl.value, 10) || 0;
        return p;
    }

    syncFieldsFromPattern();
    on(toolBtn, 'click', syncFieldsFromPattern);

    on(generateBtn, 'click', () => {
        const p = readFieldsIntoPattern();
        generatePattern(editor, p);
        syncGenerateLabel();
    });

    on(rerollBtn, 'click', () => {
        if (!seedEl) return;
        // Rails are deterministic from every/offset (not seed-dependent,
        // per the design doc's own §5 note) — reroll only visibly moves
        // ties/their spans. Does not itself Generate; the user still
        // clicks Generate/Regenerate to apply the new seed, same as
        // every other field here.
        seedEl.value = Math.floor(Math.random() * 1_000_000);
    });

    on(detachAllBtn, 'click', () => {
        const p = _currentPattern(editor);
        if (p.id) detachAllOwned(editor, p.id);
    });
}
