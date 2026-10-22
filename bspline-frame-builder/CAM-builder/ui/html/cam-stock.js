// The CAM palette's Stock card (Fred 2026-10-20): the B-spline setups' stock box, typed as X / Y / Z in inches -- the ONE
// exception to "no input fields in the CAM add-in": exactly three number fields (+ a Clear button), nothing else.
//
// Meaning (cam_engine/stock_dims.py): the TOTAL box in the MODEL's axes (X across the panel, Y up it, Z through it),
// centred on the panel, its bottom on the model's world bottom, ONE box shared by the Back and flipped setups.
//   all three EMPTY  = default: a new setup gets the declared box; an EXISTING setup keeps whatever stock it has
//   all three FILLED = Fred's explicit intent: the next BUILD writes that box to the B-spline setups
// Detection only: a box smaller than the panel + frame gets an amber warning; nothing is clamped or blocked.

/** '7.5' -> 7.5; '' -> null; garbage / <= 0 -> NaN (not a usable size). */
export function parseSize(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

/** The three field texts -> { kind: 'default' } (all empty) | { kind: 'box', dims: [x, y, z] } | { kind: 'partial' } (some
 *  empty or invalid: nothing is saved yet). */
export function readFields(x, y, z) {
  const v = [x, y, z].map(parseSize);
  if (v.every((n) => n === null)) return { kind: 'default' };
  if (v.every((n) => typeof n === 'number' && !Number.isNaN(n))) return { kind: 'box', dims: v };
  return { kind: 'partial' };
}

const num = (n) => String(Math.round(n * 100) / 100);

/** 'stock: default (...)' or 'stock: 7.5 × 9.5 × 1.5 in (...)' -- which of the two applies. */
export function statusLine(state) {
  if (state.kind === 'box') return `stock: ${state.dims.map(num).join(' × ')} in (centred on the panel, bottom on the model bottom)`;
  if (state.kind === 'partial') return 'stock: enter all three sizes (X, Y and Z), or clear them for the default';
  return 'stock: default (panel + 1 in, 2 in tall; a setup that already has a stock keeps it)';
}

/** The amber warning for a box smaller than the part, or '' . `needs` = { x, y, z } inches (panel + frame). */
export function warningText(state, needs) {
  if (state.kind !== 'box' || !needs) return '';
  const short = ['x', 'y', 'z'].map((a, i) => ({ a: a.toUpperCase(), have: state.dims[i], need: needs[a] }))
    .filter((r) => typeof r.need === 'number' && r.have < r.need - 1e-6);
  if (!short.length) return '';
  const parts = short.map((r) => `${r.a} ${num(r.have)} in is less than the ${num(r.need)} in the part needs`);
  return `Smaller than the panel + frame: ${parts.join('; ')}. BUILD writes it anyway.`;
}

/** What the add-in is asked, from the fields: save the box, clear it, or nothing yet. */
export function requestFor(state) {
  if (state.kind === 'box') return { action: 'set_stock', data: { dims: state.dims } };
  if (state.kind === 'default') return { action: 'set_stock', data: { dims: null } };
  return null;
}

/** The card's note under the status line, the same text in the mockup Fred approved. */
export const STOCK_NOTE = 'PREVIEW (top bar) draws this box in Fusion as you type. A filled box is written to the Back and flipped setups on the next BUILD, and toolpaths made earlier then show out of date in the list.';

if (typeof window !== 'undefined') window.camStock = { readFields, statusLine, warningText, requestFor, STOCK_NOTE };
