// The CAM palette's Frame card split (FRAME-SPLIT, Fred 2026-10-24): the frame cut as 1-4 setups ("sometimes I don't have
// large enough pieces"). Pieces = [1] [2] [3] [4] buttons (presets in cam_engine/frame_layout.py: 2 = bottom + right /
// top + left), then one row per piece: its setup name, its bars, and an optional THICKNESS in inches (Fred: "two
// thickness" -- the halves can be different boards; empty = the bars' own thickness). The second exception to "no input
// fields in the CAM add-in", by Fred's ruling. Saved on the Design; the next BUILD makes one setup per piece.

/** '1.75' -> 1.75; '' -> null (the bars' own thickness); garbage / <= 0 -> NaN (not saved). */
export function parseThickness(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

/** A [n] button: ask for preset n. */
export function requestForCount(n) {
  return { action: 'set_frame_layout', data: { count: n } };
}

/** A thickness edit on piece ``index``: the whole layout with that piece's thickness replaced; null when the text is not a
 *  usable thickness (nothing is sent until it is). */
export function requestForThickness(pieces, index, text) {
  const t = parseThickness(text);
  if (Number.isNaN(t)) return null;
  const next = pieces.map((p, i) => ({ bars: [...p.bars], thickness_in: i === index ? t : p.thickness_in }));
  return { action: 'set_frame_layout', data: { pieces: next } };
}

/** The rows the card shows for a 'frame_layout' payload: [{ index, name, bars: 'bottom + right', thickness: '' | '1.75' }].
 *  A saved piece with no bar on its sides in this frame (names[i] null, e.g. 'top' on a peaked roof) is not shown; when
 *  the frame is split and has an inset window, a last row { index: null, name: 'Frame Window', bars: 'window bars' } (no
 *  thickness field). ``index`` = the piece's place in the saved layout (what a thickness edit changes). */
export function rows(payload) {
  const pieces = (payload && payload.pieces) || [];
  const names = (payload && payload.names) || [];
  const out = [];
  pieces.forEach((p, i) => {
    const name = names[i] === undefined ? 'Frame' : names[i];
    if (name === null) return;
    out.push({ index: i, name, bars: p.bars.join(' + '), thickness: p.thickness_in == null ? '' : String(p.thickness_in) });
  });
  if (payload && payload.window) out.push({ index: null, name: 'Frame Window', bars: 'window bars', thickness: null });
  return out;
}

export const FRAME_NOTE = 'One setup per piece on the next BUILD, all with the same passes. Thickness empty = the bars\' own.';

if (typeof window !== 'undefined') window.camFrameLayout = { parseThickness, requestForCount, requestForThickness, rows, FRAME_NOTE };
