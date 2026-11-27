/**
 * core/stamp/strength.js -- the ONE per-layer STRENGTH every stamp source reads (Fred 2026-11-27: "can some show at least a
 * general strength override, 0-100%?" -- the layer stack's open card, main/layer-stack.js LAYER_TYPES strength).
 *
 * A HEIGHT scale (0..1), not a fade: core/engine/apply-stamp-layers.js multiplies the layer's own height (art depth, the
 * bricks' depth, the STL's height, a height patch's +/-1), its fillet and its suppression by it BEFORE the layer's rule runs;
 * the rule itself is untouched (zOffset, the STL Level base and a Flat brick's plane are never scaled).
 *
 * Where it is stored: an editor layer's `strength` (Draw / Lattice; saved with the layer, editor/editor-io.js), an STL / height
 * patch record's `strength` (core/stl/layer.js, core/height/layer.js), P.brickSettings.strength (every brick pass: the stack
 * shows the bricks as one item). Stored ONLY when not 100 % (the card deletes it at 100 %), so a board never touched keeps no
 * field and stamps exactly as before (AGENTS.md rule 3). Each pass builder copies it onto its pass with strengthOf.
 */
export const STAMP_STRENGTH = Object.freeze({ field: 'strength', full: 1 });

/** A pass's (or a record's) strength as the engine reads it: null = full (absent, 1, or not a number) -- no arithmetic. */
export const passStrength = (pass) => {
  const s = pass ? pass[STAMP_STRENGTH.field] : undefined;
  return typeof s === 'number' && Number.isFinite(s) && s !== STAMP_STRENGTH.full ? s : null;
};

/** The pass fields for a stored strength: `{}` when it reads as full (the pass is exactly as before), else { strength }. */
export const strengthOf = (stored) => (passStrength({ [STAMP_STRENGTH.field]: stored }) === null ? {} : { [STAMP_STRENGTH.field]: stored });

/** The card's 0..100 % for a stored value (absent = 100). */
export const strengthPercent = (stored) => { const s = passStrength({ [STAMP_STRENGTH.field]: stored }); return s === null ? 100 : Math.round(s * 1000) / 10; };

/** Write a card's percent onto `holder` (a layer object / a record copy / P.brickSettings): 100 % (or not a number) deletes
 *  the field, anything else is stored as a fraction. Returns the holder. No clamp: the slider's travel is 0..100. */
export function writeStrength(holder, percent) {
  const v = Number(percent);
  if (!Number.isFinite(v) || v === 100) delete holder[STAMP_STRENGTH.field];
  else holder[STAMP_STRENGTH.field] = v / 100;
  return holder;
}
