/**
 * core/pull-rails.js -- Pull from Fusion, rails custom-position + lock slice (seat D 2026-10-16; advisor 45,
 * Fred's pre-decided design): matches a Pull reply's pulled LINE curves back to the exact rail they came from
 * by railId (Send-tagged, editor-lattice.js's own RAIL_ID_ATTR -- never by guessing from geometry), and computes
 * each one's new row position as a fraction `at` of the layer's own lattice extent -- the SAME offset semantics
 * editor-lattice-pattern.js's own protectedRails[].at already uses (_captureProtectedRails), so Generate's own
 * row-placement machinery (_placeProtectedRails) can place a custom rail exactly like it already places a
 * protected one. Pure (no DOM, no pattern/P writes): the caller resolves `extent` (editor-sketch-manifest.js's
 * latticeExtentFor) and owns the actual write into pattern.rails.custom.
 */
import { orient } from '../editor/editor-lattice.js';

const RAIL_ID_RE = /^rail\d+$/;

/** The extent's own jMin/jMax in the CANONICAL (always-horizontal) frame computePattern itself works in --
 *  orient() conjugates a raw {iMin,jMin,iMax,jMax} box corner-wise, the same transform a single point gets
 *  (SE7h's own "rotate the problem 90°, solve it exactly as today" design). */
function _canonicalRowExtent(extent, orientation) {
  const lo = orient({ i: extent.iMin, j: extent.jMin }, orientation);
  const hi = orient({ i: extent.iMax, j: extent.jMax }, orientation);
  return { jMin: Math.min(lo.j, hi.j), jMax: Math.max(lo.j, hi.j) };
}

/** `pulledCurves` = a Pull reply's own `curves` (b-spline-gen.py's _handle_pull_sketch shape: board-inches
 *  x1/y1/x2/y2 + railId + isConstruction on a line). Returns [{id, at}], one per pulled line whose railId is a
 *  real Send-tagged rail id (RAIL_ID_RE) -- a hand-drawn/legacy curve has none and is skipped. isConstruction is NOT a filter: Send draws every rail
 *  as a construction line (measured live, all 9 rails of a 7x9 board), the railId alone says it is one.
 *  `at` is null (not dropped -- the caller decides whether an out-of-extent rail still gets kept/reported) when
 *  the rail's own row now sits outside `extent` entirely (a degenerate/zero-height extent). */
export function matchPulledRails(pulledCurves, { spacing, orientation, extent }) {
  const row = _canonicalRowExtent(extent, orientation);
  const out = [];
  for (const c of pulledCurves || []) {
    if (c.type !== 'line' || !c.railId || !RAIL_ID_RE.test(c.railId)) continue;
    const a = orient({ i: c.x1 / spacing, j: c.y1 / spacing }, orientation);
    const b = orient({ i: c.x2 / spacing, j: c.y2 / spacing }, orientation);
    const j = (a.j + b.j) / 2; // the rail's own row (tolerant of float noise between its two ends)
    const at = row.jMax > row.jMin ? (j - row.jMin) / (row.jMax - row.jMin) : null;
    out.push({ id: c.railId, at });
  }
  return out;
}
