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
import { MIN_CLOSER_FRACTION } from './piece-plan.js';
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
 */
export function motifRowPlan(motif, { row, d0, d1, bandStart, L, H, J }) {
  const unit = unitOf(motif, L, H);
  const { offset, slots } = rowSlots(motif, row);
  // the run's pitch (the closers' and the run merge's base) is one MODULE, joint included: an end closer the mitre cuts to a
  // sliver then merges into its neighbour under the 1.2 ceiling (MEASURED 9x12 at 1 in: on a one-cell pitch the merge was
  // refused at 1.23 and the sliver stayed, 0.17 of a cell)
  const pitch = unit;
  const from = d0 - bandStart;
  const minEnd = from + J + MIN_CLOSER_FRACTION * (unit - J) + (d1 - d0) / 2;
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

/** The relief of piece j (of n) of one run, at row `row` of `rows`. */
function runRelief(motif, plan, row, rows, j, n, src, primitives) {
  if (motif.fill) return motif.fill;
  if (!(src >= 0)) return 'flush'; // a corner's fan slice or a quoin
  const isArc = primitives[src] && primitives[src].type === 'arc';
  if (motif.grid) {
    if (isArc) return 'flush'; // a grid's columns do not line up row to row on a curve
    const { tile, corner } = motif.grid;
    const R = rows, c = plan.startColumn + j, cEnd = plan.startColumn + (n - 1 - j);
    if (c < R) return cellRelief(corner, row, c);
    if (cEnd < R) return cellRelief(corner, row, cEnd);
    const line = tile[row % tile.length];
    return RELIEF_CHARS[line[mod(c, line.length)]] || 'flush';
  }
  if (j === 0 || j === n - 1) return motif.ends || 'flush';
  return plan.slots[(plan.firstSlot + j - 1) % plan.slots.length].relief || 'flush';
}

/**
 * Tags one laid row: each piece gets `relief` and its heightOffset + RELIEF_LEVELS[relief]. `sources[k]` = the primitive
 * piece k was laid from (primitive-ribbon.js ribbonPieces; -1 a fan slice, -2 a quoin); a RUN = consecutive pieces of one
 * source, j its piece's place in it (0 = the start corner). Returns new piece objects (the input is not touched).
 */
export function tagMotifRow(pieces, sources, primitives, motif, plan, row, rows) {
  const out = pieces.slice();
  for (let k = 0; k < pieces.length;) {
    let e = k + 1;
    while (e < pieces.length && sources[e] === sources[k]) e++;
    for (let j = 0; j < e - k; j++) {
      const relief = runRelief(motif, plan, row, rows, j, e - k, sources[k], primitives);
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
