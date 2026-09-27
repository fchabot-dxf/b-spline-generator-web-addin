/**
 * color-utils.js — H8's own declared frame colours.
 *
 * Fred: "make frame colour a bit different than board, tiny bit" -> (live,
 * after seeing Ash tinted darker) "Ash should be different lighter" ->
 * clarified: move AWAY from the middle (a wood lighter than middle gray
 * gets lighter, one darker gets darker) -> "Simply hardcode the colors".
 *
 * These exact values were COMPUTED once under that rule (an 8% HSL
 * lightness shift off each wood's own `previewColors` value, direction by
 * whether that wood's lightness sits above or below 0.5 — every declared
 * wood except Mahogany is above it) and are now a plain declared table,
 * not a runtime computation. core/preview/frame-mesh.js (the 3D bars) and
 * editor/editor-frame-profile.js (the 2D frame band) both read this SAME
 * table by the SAME wood-name key `defs.appearance.previewColors` already
 * uses (frame_definition.py's own APPEARANCE_PREVIEW_COLORS), so the two
 * render surfaces can never drift apart into two different values, and a
 * wood added later with no entry here just falls back to its own board
 * colour (frameColorFor's own fallback) until one is declared for it.
 */
export const FRAME_COLORS = {
  // Live feedback (Fred, after the first pass at +8%): "Ash lighter" -- the
  // base magnitude read as too subtle against Ash's own already-light board;
  // a bigger, declared exception (+15% lightness) rather than re-tuning the
  // shared magnitude around one wood.
  '3D Ash - Unfinished': '#efe9d9',      // board #d9c9a3, lighter (+15%)
  '3D Mahogany - Unfinished': '#5c2d23', // board #7a3b2e, darker
  '3D Pine - Unfinished': '#ead09c',     // board #e3c07a, lighter
  '3D Maple - Painted': '#f2e7cd',       // board #ead7ad, lighter
  // Oak sits almost exactly AT middle gray (L 0.527) -- the move-away-from-
  // middle rule's own "lighter" call left it looking too close to its own
  // board colour live (Fred: "Oak needs darker"). Darker instead, same 8%
  // magnitude as every other entry, an explicit exception to the rule
  // rather than the rule re-tuned around one borderline wood.
  '3D Oak - Painted': '#a17543',         // board #b88a55, darker
};

/** The frame's own colour for `appearance` (a wood name, the same string
 *  `previewColors` is keyed by), or `fallbackBoardHex` unchanged when
 *  `appearance` has no declared frame colour (every currently-declared
 *  wood does; this only matters for one added later without an entry
 *  above yet). */
export function frameColorFor(appearance, fallbackBoardHex) {
  return FRAME_COLORS[appearance] || fallbackBoardHex;
}
