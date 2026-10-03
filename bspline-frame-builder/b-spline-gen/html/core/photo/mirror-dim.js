/**
 * photo/mirror-dim.js — F34 item 1 (Fred): "Show the user which half/
 * quadrant of the photo is used (dim the mirrored part in the editor
 * preview)." Pure geometry only (no canvas) so it's unit-testable; the
 * actual drawing (main/photo-panel.js) just fills these rectangles with a
 * translucent overlay on the raw-photo preview canvas.
 *
 * Mirrors terrain.js's own fold exactly (core/terrain.js: `mx = 0.5 +
 * symOffsetX`, `su = Math.abs(zu - mx) * 2` for symmetry 'x'/'radial', same
 * for 'y'/'radial' with my/sv) -- by that fold, only the region on ONE side
 * of the mirror axis is ever actually sampled; the other side's own pixels
 * are never read, their appearance in the final terrain is always a
 * reflection of the kept side. Convention (arbitrary but declared, since
 * the fold itself is symmetric about the axis): the KEPT/visible source is
 * u >= mx (right of the X axis) / v >= my (below the Y axis); the opposite
 * side is dimmed.
 *
 * Returns rectangles in normalized UV space (0..1, u=0 left, v=0 top),
 * matching the Photo editor's own raw-image preview coordinate convention.
 */
export function computeMirrorDimRects(symmetry, symOffsetX = 0, symOffsetY = 0) {
  const rects = [];
  const mx = Math.min(1, Math.max(0, 0.5 + symOffsetX));
  const my = Math.min(1, Math.max(0, 0.5 + symOffsetY));
  if (symmetry === 'x' || symmetry === 'radial') {
    rects.push({ x: 0, y: 0, w: mx, h: 1 });
  }
  if (symmetry === 'y' || symmetry === 'radial') {
    rects.push({ x: 0, y: 0, w: 1, h: my });
  }
  return rects;
}
