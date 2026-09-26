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
    PATTERN_DEFAULTS, generatePattern, detachAllOwned, nextSeed, recolorOwnedKind, rewidthOwnedKind, rewidthOwnedKinds,
} from './editor-lattice-pattern.js';
import { openColorMosaic } from './editor-color.js';
import { getActiveLayer } from './layers.js';

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
    // T56: rails/ties mode toggles (same segmented-control shape as
    // Orientation) + their own field groups, shown/hidden together.
    const railsModeCountEl = el('latticeRailsModeCount');
    const railsModeEveryEl = el('latticeRailsModeEvery');
    const railsCountFieldsEl = el('latticeRailsCountFields');
    const railsEveryFieldsEl = el('latticeRailsEveryFields');
    const railsCountMinEl = el('latticeRailsCountMin');
    const railsCountMaxEl = el('latticeRailsCountMax');
    const railsEveryEl = el('latticeRailsEvery');
    const railsOffsetEl = el('latticeRailsOffset');
    const tiesModeCountEl = el('latticeTiesModeCount');
    const tiesModeDensityEl = el('latticeTiesModeDensity');
    const tiesCountFieldsEl = el('latticeTiesCountFields');
    const tiesDensityFieldsEl = el('latticeTiesDensityFields');
    const tiesCountMinEl = el('latticeTiesCountMin');
    const tiesCountMaxEl = el('latticeTiesCountMax');
    // T56 AMEND: count-mode's own tie SPAN sub-toggle (Cells, the
    // default per Fred's own pick / Rails, bridging, an alternative).
    const tiesSpanModeCellsEl = el('latticeTiesSpanModeCells');
    const tiesSpanModeRailsEl = el('latticeTiesSpanModeRails');
    const tiesDensityEl = el('latticeTiesDensity');
    const tiesSpanMinEl = el('latticeTiesSpanMin');
    const tiesSpanMaxEl = el('latticeTiesSpanMax');
    const tiesAnchorEl = el('latticeTiesAnchor');
    const tiesRailSnapRowsEl = el('latticeTiesRailSnapRows');
    const tiesOneEndedEl = el('latticeTiesOneEnded');
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
    // T58 ADD-ON (Fred: "I normally want ties and rails to be the same
    // width"): the link toggle + its own linked/unlinked field groups.
    const widthLinkedEl = el('latticeWidthLinked');
    const widthLinkToggleEl = el('latticeWidthLinkToggle');
    const widthUnlinkedFieldsEl = el('latticeWidthUnlinkedFields');
    const widthLinkedRowEl = el('latticeWidthLinkedRow');
    const orientHorizontalEl = el('latticeOrientHorizontal');
    const orientVerticalEl = el('latticeOrientVertical');
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
    // T56: show exactly one of the two field groups per toggle, and
    // reflect which is active onto the buttons — one function shared by
    // syncFieldsFromPattern (reflecting the PATTERN) and the toggle
    // click handlers (reflecting a user's own click) so the two can never
    // drift apart into showing a group that doesn't match the `.active`
    // button.
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
    // T56 AMEND: count-mode's own tie SPAN sub-toggle — only reflects the
    // `.active` state (both buttons live inside `#latticeTiesCountFields`,
    // whose OWN visibility is already driven by `_showTiesMode` above, so
    // this never needs its own show/hide of a field GROUP, just the two
    // buttons' own active state).
    function _showTieSpanMode(mode) {
        if (tiesSpanModeCellsEl) tiesSpanModeCellsEl.classList.toggle('active', mode !== 'rails');
        if (tiesSpanModeRailsEl) tiesSpanModeRailsEl.classList.toggle('active', mode === 'rails');
    }
    // T58 ADD-ON: same "one function reflects AND reacts" shape as the
    // toggles above — the chain button's own `.active` state IS whether
    // rails/ties are linked.
    function _showWidthLinkMode(linked) {
        if (widthLinkToggleEl) widthLinkToggleEl.classList.toggle('active', linked);
        if (widthUnlinkedFieldsEl) widthUnlinkedFieldsEl.style.display = linked ? 'none' : 'flex';
        if (widthLinkedRowEl) widthLinkedRowEl.style.display = linked ? 'flex' : 'none';
    }

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
        // T56: same migration-aware fallback computePattern's own merge
        // uses (editor-lattice-pattern.js's own comment on this exact
        // point) — a saved `rails`/`ties` object from before `mode`
        // existed reads as the OLD implicit mode, not the new default.
        const railsMode = p.rails ? (p.rails.mode || 'every') : PATTERN_DEFAULTS.rails.mode;
        const tiesMode = p.ties ? (p.ties.mode || 'density') : PATTERN_DEFAULTS.ties.mode;
        _showRailsMode(railsMode);
        _showTiesMode(tiesMode);
        // T56 AMEND: span.mode has its OWN "no key yet" fallback too — a
        // saved pattern from before this field existed (or a fresh one,
        // which materializes straight from PATTERN_DEFAULTS anyway)
        // reads as PATTERN_DEFAULTS.ties.span.mode ('cells').
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
        // Q1 (design doc open question, ruled by the advisor in T21's
        // dispatch): anchor is DATA — T30 (Fred: "don't limit it to
        // rails, but do snap to them") settles it as 'free' + snapping
        // by default; PATTERN_DEFAULTS.ties.anchor is what a brand-new
        // pattern gets, this field just reflects/edits whatever the
        // current PATTERN already has (an existing saved 'rails' pattern
        // keeps reading back as 'rails' — no migration).
        if (tiesAnchorEl) tiesAnchorEl.value = p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor;
        if (tiesRailSnapRowsEl) tiesRailSnapRowsEl.value = p.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
        // T67 AMEND 3+4: a saved pattern with no `oneEnded` key reads the
        // declared default (1) — same "absent key = default, no silent
        // behavior change" convention every other field here follows.
        if (tiesOneEndedEl) tiesOneEndedEl.value = p.ties?.oneEnded ?? PATTERN_DEFAULTS.ties.oneEnded;
        if (nodesEndsEl) nodesEndsEl.checked = p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends;
        if (nodesCrossingsEl) nodesCrossingsEl.checked = p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings;
        if (nodesRailEndsEl) nodesRailEndsEl.checked = p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds;
        if (seedEl) seedEl.value = p.seed ?? PATTERN_DEFAULTS.seed;
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
        // T58 ADD-ON: migration-aware, same shape rails.mode/ties.mode
        // already use above — an EXISTING saved pattern from before this
        // field existed has no `linkRailsTies` key at all (checked on the
        // RAW, pre-merge object, not `widths`, which the PATTERN_DEFAULTS
        // spread would otherwise silently backfill to `true`): it infers
        // linked ONLY when rails/ties already happen to be equal ("no
        // silent change" for a differing pair, per Fred's own ruling); a
        // brand-new pattern (no `p.widths` at all) reads PATTERN_DEFAULTS'
        // own `linkRailsTies: true` untouched.
        const widthLinked = 'linkRailsTies' in rawWidths ? rawWidths.linkRailsTies : widths.rails === widths.ties;
        _showWidthLinkMode(widthLinked);

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
        // T56: same "the control's own `.active` state IS the source of
        // truth" shape as Orientation above — Every/Density active means
        // that mode, anything else (including a fresh panel with neither
        // toggle wired) means Count, this tool's own new default.
        const railsMode = railsModeEveryEl?.classList.contains('active') ? 'every' : 'count';
        const tiesMode = tiesModeDensityEl?.classList.contains('active') ? 'density' : 'count';
        // T56 AMEND: Rails active means bridging, anything else (including
        // no toggle wired) means Cells — this tool's own new default,
        // matching Fred's own pick.
        const tieSpanMode = tiesSpanModeRailsEl?.classList.contains('active') ? 'rails' : 'cells';
        const railsCountMin = railsCountMinEl ? (parseInt(railsCountMinEl.value, 10) || 1) : (p.rails?.count?.[0] ?? PATTERN_DEFAULTS.rails.count[0]);
        const railsCountMax = railsCountMaxEl ? (parseInt(railsCountMaxEl.value, 10) || railsCountMin) : (p.rails?.count?.[1] ?? PATTERN_DEFAULTS.rails.count[1]);
        const tiesCountMin = tiesCountMinEl ? (parseInt(tiesCountMinEl.value, 10) || 1) : (p.ties?.count?.[0] ?? PATTERN_DEFAULTS.ties.count[0]);
        const tiesCountMax = tiesCountMaxEl ? (parseInt(tiesCountMaxEl.value, 10) || tiesCountMin) : (p.ties?.count?.[1] ?? PATTERN_DEFAULTS.ties.count[1]);
        p.rails = {
            mode: railsMode,
            // count is a [min,max] PAIR — swap defensively if a user
            // types them backwards rather than silently emitting an
            // inverted (empty) seeded range.
            count: railsCountMin <= railsCountMax ? [railsCountMin, railsCountMax] : [railsCountMax, railsCountMin],
            every: railsEveryEl ? (parseInt(railsEveryEl.value, 10) || 1) : (p.rails?.every ?? PATTERN_DEFAULTS.rails.every),
            offset: railsOffsetEl ? (parseInt(railsOffsetEl.value, 10) || 0) : (p.rails?.offset ?? PATTERN_DEFAULTS.rails.offset),
        };
        p.ties = {
            ...PATTERN_DEFAULTS.ties,
            ...p.ties,
            mode: tiesMode,
            count: tiesCountMin <= tiesCountMax ? [tiesCountMin, tiesCountMax] : [tiesCountMax, tiesCountMin],
            // T56 AMEND: span.rails (the bridge-gap count, 1..maxRailGaps)
            // has no dedicated stepper yet — kept at whatever it already
            // was (or the default) — only span.MODE has a control so far.
            span: { ...PATTERN_DEFAULTS.ties.span, ...p.ties?.span, mode: tieSpanMode },
            density: tiesDensityEl ? parseFloat(tiesDensityEl.value) : (p.ties?.density ?? PATTERN_DEFAULTS.ties.density),
            spanMin: tiesSpanMinEl ? (parseInt(tiesSpanMinEl.value, 10) || 1) : (p.ties?.spanMin ?? PATTERN_DEFAULTS.ties.spanMin),
            spanMax: tiesSpanMaxEl ? (parseInt(tiesSpanMaxEl.value, 10) || 1) : (p.ties?.spanMax ?? PATTERN_DEFAULTS.ties.spanMax),
            anchor: tiesAnchorEl ? tiesAnchorEl.value : (p.ties?.anchor ?? PATTERN_DEFAULTS.ties.anchor),
            railSnapRows: tiesRailSnapRowsEl ? (parseInt(tiesRailSnapRowsEl.value, 10) || 0) : (p.ties?.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows),
            // T67 AMEND 3+4: 0 is a genuinely valid value (pure rail-to-
            // rail, no one-ended ties at all) — `|| 0` (not `|| 1`) so a
            // typed "0" isn't coerced back up to the default.
            oneEnded: tiesOneEndedEl ? (parseInt(tiesOneEndedEl.value, 10) || 0) : (p.ties?.oneEnded ?? PATTERN_DEFAULTS.ties.oneEnded),
        };
        p.nodes = {
            ends: nodesEndsEl ? !!nodesEndsEl.checked : (p.nodes?.ends ?? PATTERN_DEFAULTS.nodes.ends),
            crossings: nodesCrossingsEl ? !!nodesCrossingsEl.checked : (p.nodes?.crossings ?? PATTERN_DEFAULTS.nodes.crossings),
            railEnds: nodesRailEndsEl ? !!nodesRailEndsEl.checked : (p.nodes?.railEnds ?? PATTERN_DEFAULTS.nodes.railEnds),
        };
        if (seedEl) p.seed = parseInt(seedEl.value, 10) || 0;
        // T58 ADD-ON: the chain toggle's own `.active` state IS the source
        // of truth (same shape every other toggle in this panel uses) —
        // when linked, Ties reads from the SAME combined stepper Rails
        // does (widthLinkedEl), not its own separate field.
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

        // T58 (SE14 Slice 3): this tool no longer has ANY Boundary/Ending/
        // Border controls (moved to the new Shape Lattice tool's own
        // panel) — p.extent/p.boundary are deliberately left UNTOUCHED
        // here, not force-written to 'board'. Fred's own ruling
        // (SE14-SHAPE-LATTICE-DESIGN.md, "Fred 2026-09-25"): an existing
        // layer already in extent.mode:'boundary' from before this split
        // is "handed to the Shape Lattice tool (settings kept), not
        // reverted to board" — this tool's own Generate on such a layer
        // still fills to whatever extent/boundary the pattern already has
        // (unchanged since the LAST time anything wrote it), same as
        // every other field this function doesn't mention. A brand-new
        // pattern simply has no `extent` key at all, which `_resolveExtent`
        // itself already defaults to 'board' — no explicit write needed
        // for that case either.
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

    /** T58 ADD-ON: the LINKED stepper's own mirror of wireWidthStepper
     *  above — one value writes BOTH widths.rails AND widths.ties, and
     *  re-widths BOTH kinds' owned pieces in ONE undo step
     *  (rewidthOwnedKinds, not two rewidthOwnedKind calls — see that
     *  function's own doc comment for why two calls wouldn't satisfy
     *  "one undo step"). */
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

    /** T58 ADD-ON: the chain toggle itself — linking unifies rails/ties to
     *  the CURRENT rails value (live re-width, one undo step, same shape
     *  as wireLinkedWidthStepper above); unlinking changes no VALUE at
     *  all, just stops a future combined edit from propagating to both —
     *  same "the control IS the source of truth" idiom every other toggle
     *  in this panel already follows. */
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

    // T56: rails/ties MODE toggles — a settings field like Rails' own
    // every/offset or Ties' own density, NOT an immediate re-projection
    // (unlike Orientation) — takes effect on the next explicit Generate,
    // same as every other structural field in this panel.
    if (railsModeCountEl) on(railsModeCountEl, 'click', () => _showRailsMode('count'));
    if (railsModeEveryEl) on(railsModeEveryEl, 'click', () => _showRailsMode('every'));
    if (tiesModeCountEl) on(tiesModeCountEl, 'click', () => _showTiesMode('count'));
    if (tiesModeDensityEl) on(tiesModeDensityEl, 'click', () => _showTiesMode('density'));
    if (tiesSpanModeCellsEl) on(tiesSpanModeCellsEl, 'click', () => _showTieSpanMode('cells'));
    if (tiesSpanModeRailsEl) on(tiesSpanModeRailsEl, 'click', () => _showTieSpanMode('rails'));

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
    wireLinkedWidthStepper();
    wireWidthLinkToggle();

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
