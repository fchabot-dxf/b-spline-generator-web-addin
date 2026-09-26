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
 * - Rails/Ties MODE toggles, Ties Anchor, End Rule: segmented
 *   controls/selects, not numbers.
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
    { name: 'spacing', label: 'Grid spacing', unit: IN, get: () => currentPattern(editor).spacing ?? PATTERN_DEFAULTS.spacing },
    {
      name: 'minspacing', label: 'Minimum tie spacing', unit: IN,
      get: () => currentPattern(editor).ties?.minSpacing ?? PATTERN_DEFAULTS.ties.minSpacing,
    },
    {
      name: 'railcountmin', label: 'Rails count (min)',
      get: () => (currentPattern(editor).rails?.count ?? PATTERN_DEFAULTS.rails.count)[0],
    },
    {
      name: 'railcountmax', label: 'Rails count (max)',
      get: () => (currentPattern(editor).rails?.count ?? PATTERN_DEFAULTS.rails.count)[1],
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
    { name: 'railevery', label: 'Rails every (rows)', get: () => currentPattern(editor).rails?.every ?? PATTERN_DEFAULTS.rails.every },
    { name: 'railoffset', label: 'Rails offset (rows)', get: () => currentPattern(editor).rails?.offset ?? PATTERN_DEFAULTS.rails.offset },
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
