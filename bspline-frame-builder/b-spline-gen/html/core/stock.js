/**
 * core/stock.js -- heights against the STOCK, the ONE overshoot check (moved here from core/stl/stock.js, which re-exports it
 * under its old names so the STL card is unchanged; HEIGHT-PAINTER slice 5, Fred 2026-11-23: "with carving we need a warning
 * about the surface thickness"). DETECTION ONLY: nothing here changes, blocks or clamps anything.
 *
 * The stock's bounds are the sculpt check's own (core/sculpt.js checkPreBounds): a height z is OVER when z > carveZ (the stock
 * top, P.carveZ = Board > Carve Depth) and UNDER when z < 0 (the stock bottom). rebuild.js reports, after each heights build,
 * each STL pass (core/stl/stock.js), each height patch (its footprint) and the whole board (every point).
 */

/** Over the points `covered` marks (null = every point): how many leave the stock, the worst overshoot above the top / below
 *  the bottom (inches), and the lowest / highest height there. */
export function stockOvershoot(heights, covered, carveZ) {
  let count = 0, maxOver = 0, maxUnder = 0, min = Infinity, max = -Infinity;
  for (let k = 0, n = heights.length; k < n; k++) {
    if (covered && !covered[k]) continue;
    const z = heights[k];
    if (z < min) min = z;
    if (z > max) max = z;
    if (z > carveZ) { count++; maxOver = Math.max(maxOver, z - carveZ); } // checkPreBounds' rule, point for point
    if (z < 0) { count++; maxUnder = Math.max(maxUnder, -z); }
  }
  return { count, maxOver, maxUnder, min, max };
}

/** One entry per pass of `kind` ('stl', 'height'; its id '<kind>:<record id>'), keyed by the record id:
 *  { count, maxOver, maxUnder, min, max, carveZ }. */
export function stockReport(passes, heights, carveZ, kind) {
  const out = {};
  const pre = `${kind}:`;
  for (const p of passes || []) {
    if (!p || p.kind !== kind || typeof p.id !== 'string' || !p.id.startsWith(pre) || !p.mask || !p.mask.isStamped) continue;
    out[p.id.slice(pre.length)] = { ...stockOvershoot(heights, p.mask.isStamped, carveZ), carveZ };
  }
  return out;
}

const inches = (v) => `${v.toFixed(2)} in`;
/** The one warning line for an entry, about `subject` ('This STL', 'This patch', 'The board'); '' inside the stock. */
export function stockMessage(e, subject) {
  if (!e || !(e.count > 0)) return '';
  const bits = [];
  if (e.maxOver > 0) bits.push(`rises ${inches(e.maxOver)} above the stock top`);
  if (e.maxUnder > 0) bits.push(`cuts ${inches(e.maxUnder)} below the stock bottom`);
  return `⚠ ${subject} ${bits.join(' and ')} (Carve Depth ${inches(e.carveZ)}) at ${e.count} point${e.count === 1 ? '' : 's'}.`;
}
/** The board inside the stock: how far its deepest point sits above the floor and its highest under the top (the plain line). */
export const stockRoomMessage = (e) => (e && Number.isFinite(e.min) && Number.isFinite(e.max)
  ? `Deepest point ${e.min.toFixed(2)} in above the carve floor / highest ${(e.carveZ - e.max).toFixed(2)} in under the stock top` : '');

/** The same room, short, for a narrow bar (the Height options bar): '↓0.06 in floor · ↑0.12 in top'. */
export const stockRoomShort = (e) => (e && Number.isFinite(e.min) && Number.isFinite(e.max)
  ? `↓${e.min.toFixed(2)} in floor · ↑${(e.carveZ - e.max).toFixed(2)} in top` : '');

// The last build's height-painter report { board, patches: { [record id]: entry } } (rebuild.js sets it after each heights
// build; main/height-panel.js reads it). Setting it announces 'heightStockChanged' on the document.
let _heightReport = null;
export function getHeightStockReport() { return _heightReport; }
export function setHeightStockReport(report) {
  _heightReport = report || null;
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('heightStockChanged'));
}
