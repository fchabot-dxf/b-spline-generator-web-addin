/**
 * lattice-formula-fields.js — FORMULA-FIELDS R5: the declared scope + field
 * list shared by BOTH lattice panels — the Lattice Pattern panel
 * (properties-lattice.js) and the Shape Lattice panel
 * (properties-shape-lattice.js) — one module, not two near-duplicates
 * (same "shared, not forked" shape as lattice-piece-panel.js, which mounts
 * the per-piece override panel for both).
 *
 * Names read LIVE off the ACTIVE layer's own pattern via each panel's own
 * pattern accessor (`currentPatternLattice` / `currentPattern`), passed in
 * by the caller rather than imported here — this module never picks a
 * panel's editor state apart itself, it only shapes a `get()` around
 * whatever accessor the caller already has. `attachFormula`'s scope can be
 * a plain array OR `() => array` (core/formula-field.js's own contract);
 * every `get()` below re-reads the pattern at CALL time, so switching
 * layers or Regenerating is picked up for free — no new live-sync
 * plumbing needed.
 *
 * R1/R2 precedent (main/formula-fields.js): one scope per PANEL SECTION,
 * derived from a declared list, an explicit reason logged for every
 * numeric field left out. Same shape here, adapted for a per-layer
 * pattern instead of the global `P`.
 */
import { boardRegion } from './editor-shape-lattice-interaction.js';
import { sizedBoardRegion } from './editor-lattice-boundary.js';
import { PATTERN_DEFAULTS } from './editor-lattice-pattern.js';
import { attachFormula } from '../core/formula-field.js';

const IN = '"';
const w = PATTERN_DEFAULTS.widths;

/** The boundary's REAL current size (never null — auto-resolves exactly
 *  the way generatePattern itself would, via the same pure
 *  `sizedBoardRegion`/`boardRegion` the engine and the Shape Lattice panel
 *  already use — see editor-lattice-boundary.js's own doc comment on
 *  `sizedBoardRegion` for why a raw, possibly-null `pattern.size` is never
 *  the right thing to read directly). */
function _resolvedSize(editor, currentPattern) {
  const pattern = currentPattern(editor);
  return sizedBoardRegion(boardRegion(editor), pattern && pattern.size);
}

/**
 * The names common to both panels. `currentPattern(editor)` is the
 * caller's own live accessor (properties-lattice.js's
 * `currentPatternLattice` / properties-shape-lattice.js's `currentPattern`).
 * `extra` appends panel-specific names (e.g. the Shape Lattice contour
 * stroke) — kept to ONE shared list plus a small per-panel tail, rather
 * than two forked copies of the common names.
 *
 * Left OUT, with the reason (R5-item-2, same "state the exclusion"
 * discipline as R2's stock-panel scope):
 * - Seed (`latticeSeed` / `shapeLatticeSeed`): an integer id the user
 *   rerolls, not a quantity anyone would formula against — same reason
 *   R2 excluded the SEED panel's own Seed field (main/formula-fields.js).
 * - Node ends/crossings/rail-ends: checkboxes, not number inputs —
 *   `attachFormula` only ever binds a number-shaped field to begin with.
 * - Ties MODE toggle, Ties Anchor, End Rule: segmented controls/selects,
 *   not numbers. Rails Anchor (Top/Center/Bottom) is the same kind of
 *   control — not declared as a NAME either, only its own field is
 *   formula-capable (typing a formula still commits a plain number the
 *   panel then reads as a segmented-control-style start/center/end via
 *   its own `.active` state, same as every other segmented control here
 *   — Anchor itself has no numeric field at all, so nothing to attach).
 * - `railcountmin`/`railcountmax`/`railevery`/`railoffset` (R5's own
 *   names for the OLD 'every'/'count' rail fields): REMOVED here in R7,
 *   same turn those fields were removed from the UI (ruling) — the
 *   PATTERN keys themselves still exist for an old saved pattern's own
 *   geometry (R6/R7's migration fallback, unchanged), but nothing in
 *   either panel can type a formula into them any more, so offering
 *   these names in the dropdown would dangle.
 */
export function latticeScope(editor, currentPattern, extra = []) {
  return [
    { name: 'width', label: 'Boundary width', get: () => _resolvedSize(editor, currentPattern).w, unit: IN },
    { name: 'height', label: 'Boundary height', get: () => _resolvedSize(editor, currentPattern).h, unit: IN },
    {
      name: 'stroke', label: 'Rail/tie stroke width (linked)', unit: IN,
      get: () => currentPattern(editor).widths?.rails ?? w.rails,
    },
    { name: 'railwidth', label: 'Rail width', unit: IN, get: () => currentPattern(editor).widths?.rails ?? w.rails },
    { name: 'tiewidth', label: 'Tie width', unit: IN, get: () => currentPattern(editor).widths?.ties ?? w.ties },
    {
      name: 'nodewidth', label: 'Node diameter', unit: IN,
      get: () => currentPattern(editor).widths?.nodeDiameter ?? w.nodeDiameter,
    },
    // RAIL-SPACING R7 (advisor checklist: "update the declared scope:
    // spacing = rail-to-rail now"): `spacing` used to mean the lattice's
    // GRID STEP (`pattern.spacing`) — that concept is no longer a
    // lattice-side setting at all (ruling 4, "one grid": the grid step
    // comes from the editor's own toolbar grid, freshPattern stamps it
    // once at creation) and has no field to read a formula FROM any more.
    // `spacing` is repointed to the NEW user-facing concept with the same
    // name in the UI's own "Spacing" field: `rails.spacing`, rail-to-rail
    // inches. A formula like `spacing*2` in the new Count field, or
    // `width/spacing` to estimate a fill count, now means what the field
    // labeled "Spacing" actually says.
    { name: 'spacing', label: 'Rail spacing (rail-to-rail)', unit: IN, get: () => currentPattern(editor).rails?.spacing ?? PATTERN_DEFAULTS.rails.spacing },
    {
      name: 'minspacing', label: 'Minimum tie spacing', unit: IN,
      get: () => currentPattern(editor).ties?.minSpacing ?? PATTERN_DEFAULTS.ties.minSpacing,
    },
    {
      name: 'tiecountmin', label: 'Ties count (min)',
      get: () => (currentPattern(editor).ties?.count ?? PATTERN_DEFAULTS.ties.count)[0],
    },
    {
      name: 'tiecountmax', label: 'Ties count (max)',
      get: () => (currentPattern(editor).ties?.count ?? PATTERN_DEFAULTS.ties.count)[1],
    },
    { name: 'tiedensity', label: 'Ties density', get: () => currentPattern(editor).ties?.density ?? PATTERN_DEFAULTS.ties.density },
    ...extra,
  ];
}

/** Attach every field in `fields` (an array of `{ id, get: () => element }`
 *  or plain element ids read via `document.getElementById`) to `scope`.
 *  `scope` is passed straight through to `attachFormula` — a plain array
 *  is fine (evaluated once per call, which is exactly how the two panel
 *  modules already call this, right where they build their own field
 *  list), or a caller can pass a thunk for a scope that must be built
 *  fresh each time (not needed here — the array's own `get()`s already
 *  read live). */
export function attachLatticeFormulaFields(fields, scope) {
  fields.forEach((input) => { if (input) attachFormula(input, scope); });
}
