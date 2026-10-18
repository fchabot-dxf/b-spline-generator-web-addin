/**
 * core/bricks/band-motif.js — PORTABLE (see rng.js). Frame motifs phase 1: the band MOTIF mechanism -- one interpreter for
 * library.js BAND_MOTIFS (the data). contour-bands.js asks it two things per motif band row:
 *   motifRowPlan  -- how the row's run is cut (its pitch, the cycled piece lengths, the start piece) so the motif's module
 *                    lattice lines up from the band's corner line, row to row;
 *   tagMotifRow   -- each laid piece's RELIEF (raised / flush / recessed), added to its heightOffset (RELIEF_LEVELS).
 * The pieces themselves are laid by primitive-ribbon.js exactly as any band's are (mitres, fans, notches, the yield); a band
 * without a motif never reaches this file, so every other lay is unchanged.
 */
import { BAND_MOTIFS, RELIEF_LEVELS, RELIEF_CHARS } from './library.js';
import { MIN_CLOSER_FRACTION, CLOSER_MAX_FRACTION } from './piece-plan.js';
import { signedArea } from './geometry.js';

/** The band's motif (BAND_MOTIFS entry), or null. */
export function motifOf(band) {
  return (band && band.motif && BAND_MOTIFS[band.motif]) || null;
}
/** A motif that sets the row's cut (1D runs or a grid); a `fill` motif only tags the band pattern's own pieces. */
export const motifCutsRows = (motif) => !!(motif && (motif.rows || motif.grid));
/** The rows a motif declares (a grid: its tile's rows), or null (a fill motif: the band's own). */
export const motifRowCount = (motif) => (motif && motif.grid ? motif.grid.tile.length : motif && motif.rows ? motif.rows.length : null);
/** One row's depth (in) under a motif that cuts rows. */
export const motifRowDepth = (motif, H) => (motif.rowDepth || 1) * H;

const unitOf = (motif, L, H) => (motif.unit === 'H' ? H : L);
function rowSlots(motif, row) {
  if (motif.grid) return { offset: 0, slots: [{ len: 1, relief: null }] };
  const spec = motif.rows[row % motif.rows.length];
  return { offset: spec.offset || 0, slots: spec.seq.map(([len, relief]) => ({ len, relief })) };
}

/**
 * The cut of row `row` of a motif band: the row's run starts at `from` = d0 - bandStart along a run from the band's corner
 * line (a right-angle mitre moves one inch along per inch of depth); the lattice of slot boundaries (offset + the cycled
 * slot modules) is anchored at that corner line. The START piece runs to the first boundary that leaves it at least a
 * closer's floor plus half the row's depth (the mitre takes a triangle that deep); each later piece is one slot, a joint
 * shorter than its module. Returns the ribbonPieces inputs (pitch, sequence, forcedFStart) + the slot the second piece
 * takes (`firstSlot`) and, for a grid, the start piece's lattice column (`startColumn`).
 * `bond` (the band's optional FRAME_PRESETS `bond`, in the motif's unit): the lattice is anchored at the BOARD's corner line
 * instead, shifted `bond` along -- so bands declaring the same bond have their joints stacked across bands, and a bond of half
 * a piece lays them in running bond (2026-10-14, the short-brick presets). Absent: anchored at the band's own corner line.
 */
export function motifRowPlan(motif, { row, d0, d1, bandStart, L, H, J, bond }) {
  const unit = unitOf(motif, L, H);
  const rs = rowSlots(motif, row), slots = rs.slots;
  const offset = bond === undefined ? rs.offset : rs.offset + bond - bandStart / unit;
  // the run's pitch (the closers' and the run merge's base) is one MODULE, joint included: an end closer the mitre cuts to a
  // sliver then merges into its neighbour under the 1.2 ceiling (MEASURED 9x12 at 1 in: on a one-cell pitch the merge was
  // refused at 1.23 and the sliver stayed, 0.17 of a cell)
  // `maxPieceFactor` (Fred 2026-10-15, the short-brick motifs): the closers and the merge are based on the motif's own piece
  // instead, so no closer or merged piece passes maxPieceFactor x its longest slot (a closer reaches CLOSER_MAX_FRACTION x the
  // pitch) -- on a whole-brick pitch a third-brick run's end pieces reached 3-4 bricks on short curves. Absent: as before.
  const pitch = motif.maxPieceFactor ? (motif.maxPieceFactor * (Math.max(...slots.map((s) => s.len)) * unit - J)) / CLOSER_MAX_FRACTION : unit;
  const from = d0 - bandStart;
  // the start piece's reach past the run's start: a closer's floor plus half the row's depth (a right-angle mitre's triangle);
  // under maxPieceFactor the floor alone -- a curve run starts on a smooth joint with no triangle, and that half depth made its
  // start piece 1.7-2x the motif's brick (MEASURED T1 9x12 notch); a mitre-clipped start sliver merges forward (ceiling above)
  const minEnd = from + J + MIN_CLOSER_FRACTION * (pitch - J) + (motif.maxPieceFactor ? 0 : (d1 - d0) / 2);
  const period = slots.reduce((s, x) => s + x.len, 0) * unit;
  // the boundary at the start of slot 0 of the period just before minEnd, then forward slot by slot
  let b = offset * unit + Math.floor((minEnd - offset * unit) / period - 1) * period, i = 0;
  while (b < minEnd - 1e-9) { b += slots[i].len * unit; i = (i + 1) % slots.length; }
  const ordered = slots.map((_, k) => slots[(i + k) % slots.length]);
  return {
    pitch,
    sequence: ordered.map((s) => s.len * unit - J),
    forcedFStart: (b - from - J) / pitch,
    firstSlot: i,
    slots,
    startColumn: Math.round(b / unit) - 1,
  };
}

/** A piece under the floor smaller than this (sq in) drops -- the yield's MEDIAL_HOLE_SQIN, a grout-wide fleck. */
export const MOTIF_FLECK_SQIN = 0.002;
/** The FLOOR of a motif-cut row: a quarter of its smallest slot piece x the row's depth (the run merge's own floor rule,
 *  piece-plan.js mergeSlivers, on the motif's module). `keep[k]` = piece k stays: a run piece under the floor AND under
 *  MOTIF_FLECK_SQIN does not; a bigger one stays (a small piece beats a hole -- MEASURED T15 7x10 1.25 in: dropping a
 *  sub-floor end closer left a 0.054-face bare patch). A corner's fan slice and a quoin always stay. The pitch of one module
 *  (motifRowPlan) is what keeps end slivers rare: the run merge takes them. null when every piece stays. */
export function motifFloorKeep(pieces, sources, plan, depth) {
  const floor = MIN_CLOSER_FRACTION * Math.min(plan.pitch, ...plan.sequence) * depth;
  // a small piece beats a hole (contour-bands.js yieldAtMedialLine's own rule): only a fleck that reads as joint drops
  const keep = pieces.map((p, k) => { const a = Math.abs(signedArea(p.polygon)); return !(sources[k] >= 0) || a >= floor || a >= MOTIF_FLECK_SQIN; });
  return keep.every(Boolean) ? null : keep;
}

/** A tile cell's relief: tile[row][col] as RELIEF_CHARS (outside the tile: flush). */
function cellRelief(tile, row, col) {
  const line = tile[row];
  return (line && RELIEF_CHARS[line[col]]) || 'flush';
}
const mod = (a, n) => ((a % n) + n) % n;

/** What an ARC run of a grid motif lays when its band has meanderCurves on (BAND_MOTIFS.<m>.curvePattern names one).
 *  A grid's columns do not line up row to row on a curve, so a curve never carries the key itself: it lays a plain,
 *  regular pattern ALONG each row, never across rows. `rows`: the motif rows (an int, negative from the last row, or
 *  'mid'), the whole row raised; `seq`: a relief sequence repeated from the run's start by piece, the same every row. */
export const CURVE_PATTERNS = Object.freeze({
  rings: { rows: [1, -2] },                       // the key's own border lines, continued round the curve
  along: { seq: ['flush', 'flush', 'raised'] },   // 2 field, 1 motif, repeating from the row's start
  plain: { rows: ['mid'] },                       // all field, one motif row in the middle
  meander: { tile: true },                        // the key's own row, its column picked by arc-length fraction
});
/** `tile: true`: the motif's own tile row, its column = the piece's fraction of the run x (an integer count of the tile's
 *  periods that fits the arc at its contour radius, one cell = plan.pitch), so each row turns at the same places. */
function curveRelief(pattern, row, rows, j, n, motif, prim, plan, periodsOverride) {
  const p = CURVE_PATTERNS[pattern];
  if (!p) return 'flush';
  if (p.tile && motif.grid) {
    const line = motif.grid.tile[row % motif.grid.tile.length];
    const periods = periodsOverride || Math.max(1, Math.round((prim.r * Math.abs(prim.theta2 - prim.theta1)) / (line.length * plan.pitch)));
    return RELIEF_CHARS[line[Math.floor((j / n) * periods * line.length) % line.length]] || 'flush';
  }
  if (p.rows && p.rows.some((r) => (r === 'mid' ? row === rows >> 1 : mod(r, rows) === row))) return 'raised';
  return p.seq ? p.seq[j % p.seq.length] : 'flush';
}

/** The relief of piece j (of n) of one run, at row `row` of `rows`. `curves`: the band's own meanderCurves setting
 *  (false on a migrated legacy board -- app-init.js MIGRATIONS); with the motif's declared curvePattern it lays that
 *  pattern on an arc run instead of flush. Every straight run, and every motif without a curvePattern, is unchanged. */
function runRelief(motif, plan, row, rows, j, n, src, primitives, curves) {
  if (motif.fill) return motif.fill;
  if (!(src >= 0)) return 'flush'; // a corner's fan slice or a quoin
  const isArc = primitives[src] && primitives[src].type === 'arc';
  if (motif.grid) {
    if (isArc) return curves && motif.curvePattern ? curveRelief(motif.curvePattern, row, rows, j, n, motif, primitives[src], plan) : 'flush'; // a grid's columns do not line up row to row on a curve
    const { tile, corner } = motif.grid;
    const R = rows, c = plan.startColumn + j, cEnd = plan.startColumn + (n - 1 - j);
    const line = tile[row % tile.length];
    if (curves && motif.curvePattern) {
      // a straight run of a band with the curve rule on: between its two corners the key's columns stretch / squeeze to a
      // WHOLE number of periods (clean at both ends); a run with no room for one period lays the curve pattern instead
      const mid = n + 2 * plan.startColumn - 2 * R, jLo = R - plan.startColumn;
      if (mid >= line.length && c >= R && cEnd >= R) {
        const periods = Math.floor(mid / line.length);
        return RELIEF_CHARS[line[Math.floor(((j - jLo) / mid) * periods * line.length) % line.length]] || 'flush';
      }
      if (mid < line.length) return curveRelief(motif.curvePattern, row, rows, j, n, motif, null, plan, 1);
    }
    if (c < R) return cellRelief(corner, row, c);
    if (cEnd < R) return cellRelief(corner, row, cEnd);
    return RELIEF_CHARS[line[mod(c, line.length)]] || 'flush';
  }
  if (j === 0 || j === n - 1) return motif.ends || 'flush';
  return plan.slots[(plan.firstSlot + j - 1) % plan.slots.length].relief || 'flush';
}

/**
 * Tags one laid row: each piece gets `relief` and its heightOffset + RELIEF_LEVELS[relief]. `sources[k]` = the primitive
 * piece k was laid from (primitive-ribbon.js ribbonPieces; -1 a fan slice, -2 a quoin); a RUN = consecutive pieces of one
 * source, j its piece's place in it (0 = the start corner). `meanderCurves` is the BAND's own resolved setting
 * (editor-brick-tool.js frameBandsOf). Returns new piece objects (the input is not touched).
 */
export function tagMotifRow(pieces, sources, primitives, motif, plan, row, rows, meanderCurves) {
  const out = pieces.slice();
  for (let k = 0; k < pieces.length;) {
    let e = k + 1;
    while (e < pieces.length && sources[e] === sources[k]) e++;
    for (let j = 0; j < e - k; j++) {
      const relief = runRelief(motif, plan, row, rows, j, e - k, sources[k], primitives, meanderCurves);
      const p = pieces[k + j];
      // a raised piece of a motif declaring raisedTop 'flat' / joinRaised carries it (the height mask reads both)
      const raisedLook = relief === 'raised' ? { ...(motif.raisedTop === 'flat' ? { topFlat: true } : {}), ...(motif.joinRaised ? { joinRaised: true } : {}) } : {};
      out[k + j] = { ...p, relief, heightOffset: (p.heightOffset || 0) + (RELIEF_LEVELS[relief] || 0), ...raisedLook };
    }
    k = e;
  }
  return out;
}

/** A band's declared relief for the WALL inside it (`insideRelief`, e.g. the recessed panel), or null. */
export function insideReliefOf(bands) {
  const b = (bands || []).find((x) => x && RELIEF_LEVELS[x.insideRelief] !== undefined);
  return b ? b.insideRelief : null;
}
/** The wall's pieces with that relief applied (new objects). */
export function tagInsideRelief(bricks, relief) {
  const level = RELIEF_LEVELS[relief] || 0;
  return bricks.map((b) => ({ ...b, relief, heightOffset: (b.heightOffset || 0) + level }));
}
