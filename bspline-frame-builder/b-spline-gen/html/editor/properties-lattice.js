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
import { LATTICE_DRAW_KINDS } from './editor-lattice.js';
import {
    PATTERN_DEFAULTS, generatePattern, unprotectRails, nextSeed, recolorOwnedKind, rewidthOwnedKind, rewidthOwnedKinds,
    _findBoundaryElements, resolvePatternLayer, freshPattern,
} from './editor-lattice-pattern.js';
import { openColorMosaic } from './editor-color.js';
import { getActiveLayer } from './layers.js';
import { mountSelectedPiecePanel } from './lattice-piece-panel.js';
import { latticeScope, attachLatticeFormulaFields } from './lattice-formula-fields.js';
import { commitEdit } from './editor-commit.js';

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
    if (!layer) return freshPattern(editor); // defensive: no layers at all yet
    // T76 (SE17): the active layer may be any one of a pattern's own FOUR
    // kind-layers (Contour/Rails/Ties/Nodes) -- e.g. right after clicking a
    // tie, which activates the Ties layer (editor-interaction.js). Reading
    // `layer.pattern` directly here, unconditionally, would find nothing on
    // a sibling kind-layer and silently CREATE a brand-new, unrelated
    // default pattern on it -- forking the "one pattern record" this whole
    // feature exists to keep single. `resolvePatternLayer` finds wherever
    // the pattern ACTUALLY lives first.
    const patternLayer = resolvePatternLayer(editor, layer.id);
    if (patternLayer) return patternLayer.pattern;
    // R7 carry-over 2: a brand-new pattern's own grid step comes from the
    // LIVE editor grid, not PATTERN_DEFAULTS.spacing -- see freshPattern's
    // own doc comment.
    layer.pattern = freshPattern(editor);
    return layer.pattern;
}
// R5: exported under a clearer name for lattice-formula-fields.js (the
// declared per-panel formula scope) — same live pattern accessor this
// panel already uses internally, not a second one.
export { _currentPattern as currentPatternLattice };

export function initLatticeProperties(editor) {
    // RAIL-SPACING R7: the old grid-step Spacing select + Every/Offset +
    // seeded count-range fields are REMOVED from the UI (ruling) — an old
    // saved pattern's own stored values for these are untouched (nothing
    // writes them any more; readFieldsIntoPattern's own existing
    // fallback-to-current-value shape, unchanged, covers this for free).
    const railsAnchorStartEl = el('latticeRailsAnchorStart');
    const railsAnchorCenterEl = el('latticeRailsAnchorCenter');
    const railsAnchorEndEl = el('latticeRailsAnchorEnd');
    const railsSpacingEl = el('latticeRailsSpacing');
    const railsSpacingCountEl = el('latticeRailsSpacingCount');
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
    const tiesMinSpacingEl = el('latticeTiesMinSpacing');
    const nodesEndsEl = el('latticeNodesEnds');
    const nodesCrossingsEl = el('latticeNodesCrossings');
    const nodesRailEndsEl = el('latticeNodesRailEnds');
    const seedEl = el('latticeSeed');
    const generateBtn = el('latticeGenerate');
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
    // T75 LAT-SIZE
    const sizeWidthEl = el('latticeSizeWidth');
    const sizeHeightEl = el('latticeSizeHeight');
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

    // RAIL-SPACING R7 (ruling 4, "one grid"): the lattice grid step is no
    // longer a lattice-side setting at all (GRID_SPACINGS/GRID_DEFAULTS
    // now live purely in the editor's own toolbar grid) — the old
    // #latticeSpacing select this block used to populate is removed from
    // the markup entirely; freshPattern (editor-lattice-pattern.js) is
    // the ONE place a NEW pattern's own grid step is stamped, from the
    // live editor grid, at creation time.

    /** Anchor's own button LABELS swap Top/Center/Bottom (horizontal) <->
     *  Left/Center/Right (vertical) — the VALUE (start/center/end) never
     *  changes meaning, just its on-screen name, matching the ruling's
     *  own "[Top|Center|Bottom] (horizontal) / [Left|Center|Right]
     *  (vertical)" wording exactly. Called from syncFieldsFromPattern
     *  (reflects the loaded pattern's own orientation) and the
     *  Orientation click handlers below (reflects a live flip). */
    function _updateAnchorLabels(orientation) {
        if (railsAnchorStartEl) railsAnchorStartEl.textContent = orientation === 'vertical' ? 'Left' : 'Top';
        if (railsAnchorEndEl) railsAnchorEndEl.textContent = orientation === 'vertical' ? 'Right' : 'Bottom';
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
    // RAIL-SPACING R7: the rails mode toggle (Count/Every) + its own two
    // field groups are gone from the UI — this panel's own Generate now
    // always writes rails.mode:'spacing' (see readFieldsIntoPattern);
    // reflecting the anchor buttons' own `.active` state is handled
    // inline in syncFieldsFromPattern below, same one-liner shape as
    // Orientation just above it, since there's no field GROUP to show/
    // hide any more (unlike Ties' own Count/Density split, still real).
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
        _updateAnchorLabels(orientation);
        // T75 LAT-SIZE: null (unset) reads as blank ("auto"), same
        // convention as the Shape Lattice tool's own Size fields.
        const size = { ...PATTERN_DEFAULTS.size, ...p.size };
        if (sizeWidthEl) sizeWidthEl.value = size.width == null ? '' : size.width;
        if (sizeHeightEl) sizeHeightEl.value = size.height == null ? '' : size.height;
        // RAIL-SPACING R7: anchor/spacing/spacingCount — a saved pattern
        // from before this feature existed has none of these keys, so
        // `PATTERN_DEFAULTS.rails`' own new defaults (center/1in/null)
        // apply via the same `?? ` fallback every other field here uses.
        const railsAnchor = p.rails?.anchor ?? PATTERN_DEFAULTS.rails.anchor;
        if (railsAnchorStartEl) railsAnchorStartEl.classList.toggle('active', railsAnchor === 'start');
        if (railsAnchorCenterEl) railsAnchorCenterEl.classList.toggle('active', railsAnchor !== 'start' && railsAnchor !== 'end');
        if (railsAnchorEndEl) railsAnchorEndEl.classList.toggle('active', railsAnchor === 'end');
        if (railsSpacingEl) railsSpacingEl.value = p.rails?.spacing ?? PATTERN_DEFAULTS.rails.spacing;
        if (railsSpacingCountEl) railsSpacingCountEl.value = p.rails?.spacingCount == null ? '' : p.rails.spacingCount;
        // T56: same migration-aware fallback computePattern's own merge
        // uses (editor-lattice-pattern.js's own comment on this exact
        // point) — a saved `ties` object from before `mode` existed reads
        // as the OLD implicit mode, not the new default.
        const tiesMode = p.ties ? (p.ties.mode || 'density') : PATTERN_DEFAULTS.ties.mode;
        _showTiesMode(tiesMode);
        // T56 AMEND: span.mode has its OWN "no key yet" fallback too — a
        // saved pattern from before this field existed (or a fresh one,
        // which materializes straight from PATTERN_DEFAULTS anyway)
        // reads as PATTERN_DEFAULTS.ties.span.mode ('cells').
        _showTieSpanMode(p.ties?.span?.mode || PATTERN_DEFAULTS.ties.span.mode);
        const tiesCount = p.ties?.count ?? PATTERN_DEFAULTS.ties.count;
        if (tiesCountMinEl) tiesCountMinEl.value = tiesCount[0];
        if (tiesCountMaxEl) tiesCountMaxEl.value = tiesCount[1];
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
        // T77 (TIE-GAP): a saved pattern with no `minSpacing` key reads
        // the declared default (0.5in) — same "absent key = default"
        // convention every other field here follows.
        if (tiesMinSpacingEl) tiesMinSpacingEl.value = p.ties?.minSpacing ?? PATTERN_DEFAULTS.ties.minSpacing;
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
        if (widthNodesEl) widthNodesEl.value = widths.nodeDiameter;
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
        // UI4 item 0c (Fred: "the layer holds a SHAPE lattice -> switch to
        // the BOX Lattice tool -> its Regenerate rebuilds the SHAPE"):
        // _currentPattern returns the SAME layer.pattern object every
        // panel shares (mutated in place, not copied) — this function
        // already overwrites every BOX-lattice field (orientation/rails/
        // ties/nodes/colors/widths/seed) below, but until now left
        // `extent`/`boundary`/`shape` (properties-shape-lattice.js's own
        // fields, set when THAT panel last generated on this layer)
        // completely untouched. generatePattern branches on
        // `PATTERN.extent.mode === 'boundary'` to decide whether to fill
        // a hand-drawn/self-contour boundary at all — a stale 'boundary'
        // extent left over from a prior Shape Lattice generation on this
        // same layer silently kept running that path even from the BOX
        // panel's own Generate button. The declared rule (Fred): the
        // ACTIVE TOOL decides the kind — this panel is the box Lattice
        // tool, so every Generate/Regenerate from here unconditionally
        // resets the pattern to plain 'board' extent and drops the
        // Shape-Lattice-only fields, regardless of what the layer's
        // pattern held before. generatePattern's own ownership-sweep
        // only clears OWNERSHIP_ATTR'd rails/ties/nodes — a prior Shape
        // Lattice's own CONTOUR segments use a separate attribute scheme
        // (data-contour-seg/data-boundary-ref) and are invisible to that
        // sweep, so they'd otherwise survive as orphaned visual clutter
        // (confirmed live) even though "Regenerate clears the layer's
        // generated pieces" is exactly what Fred asked for. Swept here,
        // BEFORE p.boundary is dropped below (it's the only handle left
        // to find them by).
        if (p.boundary && p.boundary.shapeId) {
            const activeLayer = getActiveLayer(editor);
            _findBoundaryElements(editor, p.boundary.shapeId)
                .filter((ch) => ch.node.getAttribute('data-layer') === activeLayer)
                .forEach((ch) => ch.remove());
        }
        delete p.extent;
        delete p.boundary;
        delete p.shape;
        // SE7h: the segmented control's own `.active` state IS the source
        // of truth (same "read the control, not a separate variable" shape
        // as nodesEndsEl.checked below) — Vertical active means vertical,
        // anything else (including a fresh panel with neither button
        // wired) reads as horizontal.
        p.orientation = orientVerticalEl?.classList.contains('active') ? 'vertical' : 'horizontal';
        // RAIL-SPACING R7 (ruling 4, "one grid"): p.spacing (the lattice
        // GRID STEP) is deliberately left UNTOUCHED here — there is no
        // field for it any more (freshPattern, editor-lattice-pattern.js,
        // is the ONE place a NEW pattern's own grid step gets stamped,
        // from the live editor grid, at creation time; an EXISTING
        // pattern already has its own `.spacing`, read back unchanged by
        // computePattern's own merge, same migration story as always).
        const tiesMode = tiesModeDensityEl?.classList.contains('active') ? 'density' : 'count';
        // T56 AMEND: Rails active means bridging, anything else (including
        // no toggle wired) means Cells — this tool's own new default,
        // matching Fred's own pick.
        const tieSpanMode = tiesSpanModeRailsEl?.classList.contains('active') ? 'rails' : 'cells';
        const tiesCountMin = tiesCountMinEl ? (parseInt(tiesCountMinEl.value, 10) || 1) : (p.ties?.count?.[0] ?? PATTERN_DEFAULTS.ties.count[0]);
        const tiesCountMax = tiesCountMaxEl ? (parseInt(tiesCountMaxEl.value, 10) || tiesCountMin) : (p.ties?.count?.[1] ?? PATTERN_DEFAULTS.ties.count[1]);
        // RAIL-SPACING R7: this panel's own Generate always writes
        // rails.mode:'spacing' now — the OLD 'every'/'count' UI is gone,
        // so there's nothing left to read a DIFFERENT mode FROM. An old
        // saved pattern's own stored every/offset/count values are kept
        // (not read from any field, since none exist — just carried
        // forward unchanged) so a future rollback to an OLDER mode, or a
        // migration script, still has them; this panel simply never
        // writes them again.
        const railsAnchor = railsAnchorStartEl?.classList.contains('active') ? 'start'
            : railsAnchorEndEl?.classList.contains('active') ? 'end' : 'center';
        const railsSpacingCount = railsSpacingCountEl && railsSpacingCountEl.value !== ''
            ? (parseInt(railsSpacingCountEl.value, 10) || null) : null;
        p.rails = {
            ...PATTERN_DEFAULTS.rails,
            ...p.rails,
            mode: 'spacing',
            anchor: railsAnchor,
            spacing: railsSpacingEl ? (parseFloat(railsSpacingEl.value) || PATTERN_DEFAULTS.rails.spacing) : (p.rails?.spacing ?? PATTERN_DEFAULTS.rails.spacing),
            spacingCount: railsSpacingCount,
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
            // T77 (TIE-GAP): a real-inch decimal value, so parseFloat (not
            // parseInt). 0 is also a genuinely valid minSpacing (no minimum
            // at all), so a typed "0" is preserved as-is, not coerced up.
            minSpacing: tiesMinSpacingEl ? (parseFloat(tiesMinSpacingEl.value) || 0) : (p.ties?.minSpacing ?? PATTERN_DEFAULTS.ties.minSpacing),
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
            nodeDiameter: widthNodesEl ? (parseFloat(widthNodesEl.value) || PATTERN_DEFAULTS.widths.nodeDiameter) : (p.widths?.nodeDiameter ?? PATTERN_DEFAULTS.widths.nodeDiameter),
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
     *  ('rails'/'ties'/'nodeDiameter'); `kind` is recolorOwnedKind's own
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
        _updateAnchorLabels(value);
        const p = readFieldsIntoPattern();
        await generatePattern(editor, p); // T49: generatePattern is now async (boundary mode's own shapeToPrimitives)
        syncGenerateLabel();
    }
    if (orientHorizontalEl) on(orientHorizontalEl, 'click', () => selectOrientation('horizontal'));
    if (orientVerticalEl) on(orientVerticalEl, 'click', () => selectOrientation('vertical'));

    /** T75 LAT-SIZE: same "immediate re-projection with the current seed"
     *  shape as selectOrientation above, not deferred to Generate like the
     *  rest of this panel's structural fields -- changing the fill AREA
     *  itself needs a full re-layout of rails/ties, so there's no "re-style
     *  owned pieces in place" option the way Widths/Colors have. */
    async function updateSize(field, value) {
        const p = _currentPattern(editor);
        p.size = { ...PATTERN_DEFAULTS.size, ...p.size, [field]: value };
        const full = readFieldsIntoPattern();
        await generatePattern(editor, full);
        syncGenerateLabel();
    }
    if (sizeWidthEl) {
        on(sizeWidthEl, 'change', () => {
            updateSize('width', sizeWidthEl.value !== '' ? parseFloat(sizeWidthEl.value) : null);
        });
    }
    if (sizeHeightEl) {
        on(sizeHeightEl, 'change', () => {
            updateSize('height', sizeHeightEl.value !== '' ? parseFloat(sizeHeightEl.value) : null);
        });
    }

    // RAIL-SPACING R7: Anchor — a settings field like Ties' own density,
    // NOT an immediate re-projection (unlike Orientation/Size) — takes
    // effect on the next explicit Generate, same as every other
    // structural field in this panel.
    const _setRailsAnchor = (value) => {
        if (railsAnchorStartEl) railsAnchorStartEl.classList.toggle('active', value === 'start');
        if (railsAnchorCenterEl) railsAnchorCenterEl.classList.toggle('active', value === 'center');
        if (railsAnchorEndEl) railsAnchorEndEl.classList.toggle('active', value === 'end');
    };
    if (railsAnchorStartEl) on(railsAnchorStartEl, 'click', () => _setRailsAnchor('start'));
    if (railsAnchorCenterEl) on(railsAnchorCenterEl, 'click', () => _setRailsAnchor('center'));
    if (railsAnchorEndEl) on(railsAnchorEndEl, 'click', () => _setRailsAnchor('end'));
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
    wireWidthStepper(widthNodesEl, 'nodeDiameter', 'nodes');
    wireLinkedWidthStepper();
    wireWidthLinkToggle();

    // Fred: recoloured / striped / cut rails are protected from Generate -- this puts them all back to plain
    on(el('latticeUnprotectAll'), 'click', () => {
        if (unprotectRails(editor, getActiveLayer(editor))) commitEdit(editor);
    });

    // SE7i: settings are per-LAYER now — switching the active layer must
    // reload ITS OWN pattern into the panel, not keep showing whatever the
    // previously-active layer had. editorLayersChanged already fires on
    // every active-layer switch (layers.js's setActiveLayer ->
    // renderLayersPanel), so this re-syncs for free without a new event.
    document.addEventListener('editorLayersChanged', (e) => {
        if (e.detail && e.detail.editor === editor) syncFieldsFromPattern();
    });

    // UI5 items 1/3/4: the per-piece colour/width override panel — shared
    // with properties-shape-lattice.js (lattice-piece-panel.js), mounted
    // into THIS panel's own body via runtime DOM creation (no edits to
    // bspline_gen_palette.html).
    const latticeScopeThunk = () => latticeScope(editor, _currentPattern);
    mountSelectedPiecePanel(editor, el('editorLatticePanelBody'), latticeScopeThunk);

    // R5: every numeric field in this panel becomes formula-capable, over
    // ONE shared scope (lattice-formula-fields.js) — see that module's own
    // doc comment for the excluded fields (Seed; the mode/anchor/end-rule
    // controls, which aren't number inputs to begin with). ALSO excluded
    // here: `tiesDensityEl` — `#latticeTiesDensity` is `type="range"` (a
    // slider), not a typeable number field; attachFormula's own
    // type==='number' check would leave it untouched anyway, but it's
    // named explicitly rather than silently omitted.
    attachLatticeFormulaFields([
        sizeWidthEl, sizeHeightEl, railsSpacingEl, railsSpacingCountEl,
        tiesCountMinEl, tiesCountMaxEl, tiesSpanMinEl, tiesSpanMaxEl, tiesRailSnapRowsEl,
        tiesOneEndedEl, tiesMinSpacingEl, widthRailsEl, widthTiesEl, widthNodesEl, widthLinkedEl,
    ], latticeScopeThunk);
}
