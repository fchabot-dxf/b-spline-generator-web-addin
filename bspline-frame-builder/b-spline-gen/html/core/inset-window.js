/**
 * inset-window.js — T82 item 2 (INSET-WINDOW-DESIGN.md). A second, small, rectangular mitred frame set into
 * the panel: always open, hidden behind the panel (mounted from the back). ONE declared geometry function;
 * every consumer (3D preview clip, stamps, lattice, 2D editor, the eventual Fusion build) reads it instead of
 * re-deriving the three nested rectangles itself.
 *
 * Deliberately NOT clamped against the frame's own opening or the board edge (Fred: "then it's my
 * responsibility to not let it intersect") -- the only two guards are pure geometry validity (window bars and
 * opening both > 0), read here, never written back into the record.
 */

/**
 * The window's own three nested rectangles, or null when disabled or geometrically invalid (bars/opening <= 0
 * -- see the design note's own §3). `frameThickness`/`panelLip` are real inches, the SAME values the main
 * frame already reads (`frame_thickness`, `record.panelLip`) -- no second setting.
 */
export function insetWindowGeometry(record, frameThickness, panelLip) {
  const w = record?.insetWindow;
  if (!w || !w.enabled) return null;
  const { x1, y1, x2, y2 } = w;
  if (!(x2 - x1 > 2 * frameThickness) || !(y2 - y1 > 2 * frameThickness)) return null; // window bars > 0
  const inner = { x1: x1 + frameThickness, y1: y1 + frameThickness, x2: x2 - frameThickness, y2: y2 - frameThickness };
  if (!(inner.x2 - inner.x1 > 0) || !(inner.y2 - inner.y1 > 0)) return null; // opening > 0
  const lip = Math.max(0, panelLip ?? 0);
  const hole = { x1: inner.x1 + lip, y1: inner.y1 + lip, x2: inner.x2 - lip, y2: inner.y2 - lip };
  // A lip wider than the opening would invert the hole; clamp it shut (zero-area) rather than invert -- same
  // "degenerate but not crashing" bar every other floor in this codebase holds to.
  if (!(hole.x2 - hole.x1 > 0) || !(hole.y2 - hole.y1 > 0)) {
    const cx = (inner.x1 + inner.x2) / 2, cy = (inner.y1 + inner.y2) / 2;
    return { outer: { x1, y1, x2, y2 }, inner, hole: { x1: cx, y1: cy, x2: cx, y2: cy } };
  }
  return { outer: { x1, y1, x2, y2 }, inner, hole };
}

/** True when a point (board-local inches) sits inside a rectangle from `insetWindowGeometry` (inclusive). */
export function rectContains(rect, x, y) {
  return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

/** A rectangle from `insetWindowGeometry` as a closed loop of 4 line primitives, same board-local frame
 *  every other contour primitive list in this app uses (origin top-left, y down, inches) -- for callers
 *  that feed primitive lists into `insideSpans`' own even-odd scan (editor/editor-lattice-boundary.js),
 *  which already treats any extra closed loop in the SAME list as a hole, no code change needed there. */
export function rectToPrimitives(rect) {
  const corners = [{ x: rect.x1, y: rect.y1 }, { x: rect.x2, y: rect.y1 }, { x: rect.x2, y: rect.y2 }, { x: rect.x1, y: rect.y2 }];
  return corners.map((p0, i) => ({ type: 'L', p0, p1: corners[(i + 1) % 4] }));
}
