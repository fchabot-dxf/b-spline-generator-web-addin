/**
 * core/bricks/layouts/bond.js — PORTABLE (see rng.js). The 'bond' layout: rectangular bricks in
 * horizontal courses, clipped to `boardOutline`.
 *
 * H23 item 72 (advisor, "patterns of different width" / ref_brick_bond_zones.jpg): the wall can be
 * split into horizontal ZONES, top -> bottom, each with its own declared PATTERN (library.js's own
 * `BRICK_PATTERNS` table -- F35 item 7, the SAME table Frame bands read, per the advisor-approved
 * shared (u,v) proposal: u=along a course, v=across courses, exactly `colPitch`/`coursePitch` below).
 * Each zone is `{ pattern, rows }` or `{ pattern, heightIn }` (`bond` is kept as a deprecated alias
 * for `pattern` -- every pre-item-7 caller used that field name); a zone with neither is a FILL zone
 * that absorbs whatever height the sized zones don't claim (if several zones are unsized, they split
 * the leftover height evenly). Default (no zones given) = a single stretcher zone covering the whole
 * board, i.e. byte-identical to the pre-zones behaviour.
 *
 * Only `BRICK_PATTERNS` entries of `kind:'course'` (stretcher/stack/soldier/header) or
 * `'course-alternating'` (flemish) are meaningful here -- a `'tile2d'` pattern (herringbone/
 * basketweave) needs a genuinely different cell-generation algorithm (its own layout file, same
 * category as fieldstone.js) and is never reachable through a zone; `patternFor` falls back to
 * stretcher for any name this file can't lay out itself, same graceful-fallback convention the
 * pre-item-7 `bondKind()` already used.
 *
 * Produces CELLS only (geometry + adjacency) -- no pieces, no suppression, no samples. Those are
 * shape-agnostic and live in pieces.js/suppression.js/samples.js, operating on whatever a layout
 * hands back here (Fred/the advisor: "nothing in suppression/clumping/frame/pieces assumes
 * rectangles beyond the bond layout itself").
 *
 * Edge treatment, H23 item 74 (de, F35 item 1 review: "a brick crossing the edge should be CUT,
 * not dropped or left hanging"): every cell is clipped to `boardOutline` via geometry.js's own
 * clipPolygonToBoard -- an EXACT cut, never stretched (a cut-down brick's own remaining shape is
 * still its true physical size, just trimmed, same as a real last-brick-in-a-row cut to fit a
 * wall), for a convex OR concave board alike (H23 item 76 cont.: concave boards used to fall back
 * to a keep-whole-or-drop heuristic that MEASURED 0.26-0.44in gaps at a concave Frame interior --
 * `clipPolygonToBoard` now cuts exactly there too). Adjacency/course assignment below still uses
 * each cell's own UNCLIPPED grid centre (cx/cy) -- clipping only trims the stored polygon, never
 * the logical grid position neighbours/suppression reason about.
 */
import { rectPolygon, clipPolygonToBoard } from '../geometry.js';
import { BRICK_PATTERNS, MIN_PIECE_FRACTION } from '../library.js';

function patternFor(name) {
  const p = BRICK_PATTERNS[name];
  return (p && (p.kind === 'course' || p.kind === 'course-alternating')) ? p : BRICK_PATTERNS.stretcher;
}

// T86 item 15 (Fred, shots/fred/empty_course_top.png: "empty line of brick, can it be filled with
// half bricks"): the SAME quarter-brick floor this project already uses elsewhere for "is a leftover
// piece worth keeping" -- library.js MIN_PIECE_FRACTION, the one shared declaration (T86 item 28).

// Exported for band-course.js's own reuse (F35 item 8: the Frame per-band pattern picker needs the
// SAME pitch/cross-axis convention, placed along a curved band's own (u,v) frame instead of flat x/y).
export const axisLen = (axis, L, H) => (axis === 'height' ? H : L);

/** This pattern's own COURSE HEIGHT (the `v`/cross dimension every row-generator below agrees on,
 *  used by resolveZones for pitch/row-count math before any row is actually built). flemish's own
 *  course height is simply brickHeightIn regardless of its own stretcher/header alternation -- a
 *  header SHOWS its end face but is still the SAME physical brick height as the stretcher beside it
 *  in a real flemish course (one course = one row of bricks, always).
 *  T86 item 2: exported for contour-bands.js's own reuse, same reason `axisLen` already is -- the
 *  SAME row-depth convention, now needed by the Frame-band engine too (replacing band-course.js). */
export function courseHeightFor(pattern, L, H) {
  return pattern.kind === 'course-alternating' ? H : axisLen(pattern.crossAxis, L, H);
}

/** Resolve a declared zone list into a concrete per-zone row count, given the board's total
 *  height -- an unsized zone (no `rows`/`heightIn`) fills whatever's left over. */
function resolveZones(set, zones, totalHeight) {
  const list = (zones && zones.length) ? zones : [{ pattern: 'stretcher' }];
  const J = set.grout.widthIn;
  const pitchFor = (name) => courseHeightFor(patternFor(name), set.brickLengthIn, set.brickHeightIn) + J;

  const sized = list.map((z) => {
    const pattern = z.pattern || z.bond || 'stretcher'; // z.bond: deprecated pre-item-7 alias
    const pitch = pitchFor(pattern);
    if (z.rows != null) return { pattern, pitch, rows: z.rows };
    if (z.heightIn != null) return { pattern, pitch, rows: Math.max(1, Math.round(z.heightIn / pitch)) };
    return { pattern, pitch, rows: null };
  });

  const fixedHeight = sized.filter((z) => z.rows != null).reduce((s, z) => s + z.rows * z.pitch, 0);
  const unsized = sized.filter((z) => z.rows == null);
  if (unsized.length) {
    const share = Math.max(0, totalHeight - fixedHeight) / unsized.length;
    for (const z of unsized) z.rows = Math.max(1, Math.ceil(share / z.pitch));
  }
  return sized;
}

/** 'course' kind (stretcher/stack/soldier/header): the pre-item-7 uniform-grid row, generalised
 *  from a `rotated` boolean to an explicit `pitchAxis`/`crossAxis` pair -- `rotated` could only ever
 *  express "swap both axes together", which covers stretcher/stack/soldier but not header (header
 *  needs ONLY its pitch axis swapped; its own cross/course-height axis is brickHeightIn either way,
 *  same as stretcher/stack -- "the brick's own HEIGHT face shows AND also spans the course height",
 *  library.js's own FRAME_PRESETS comment). `staggerFrac` (0..1, a FRACTION of colPitch, not a bare
 *  bool) generalises the old `stagger && c%2===1 ? colPitch/2 : 0` to any declared offset fraction. */
function uniformRow(courseIndex, pattern, minX, maxX, courseCy, cH, L, H, J) {
  const cL = axisLen(pattern.pitchAxis, L, H);
  const colPitch = cL + J;
  const staggerFrac = pattern.staggerFrac || 0;
  const stagger = (staggerFrac > 0 && courseIndex % 2 === 1) ? colPitch * staggerFrac : 0;
  const colCount = Math.ceil((maxX - minX + colPitch) / colPitch) + 1;
  const row = [];
  for (let i = -1; i < colCount; i++) {
    const cx = minX - stagger + i * colPitch + cL / 2;
    if (cx + cL / 2 < minX - 1e-6 || cx - cL / 2 > maxX + 1e-6) continue;
    const polygon = rectPolygon(cx, courseCy, cL / 2, cH / 2);
    row.push({ courseIndex, colIndex: row.length, cx, cy: courseCy, polygon });
  }
  return row;
}

/** 'course-alternating' (flemish): the textbook bond -- one course repeats [stretcher(L), header(H)]
 *  end to end (period = L+J+H+J), and alternate courses are offset by HALF that period so every
 *  header centres over the MIDDLE of a stretcher in the course below (and vice versa) -- the
 *  standard historical flemish-bond stagger, not independently re-derived. Walks a generous run of
 *  repeat units from well before `minX` so a partial unit at either true edge is still included
 *  (clipPolygonToBoard trims it to the real outline afterward, same as every other pattern here). */
/**
 * T86 item 27 (Fred, for 37's pattern builder F35-31e): a CUSTOM BOND from a tile -- `customBond = { courses: [{
 * pieces, offset }] }`, repeated course by course (course c uses courses[c mod n], counted from the first course laid,
 * as the built-in bonds' own stagger is). `pieces` = lengths in brick units (1, 1/2, 1/4, 3/4 ...), repeated along the
 * course; a piece of p bricks spans p pitches less one joint (L + (p - 1)(L + J): two halves + their joint = one
 * brick). `offset` = the course's shift in brick pitches. The ends are cut by the board clip like any course
 * (closers). Courses are stretcher-high. A built-in bond is a tile too: stretcher = [{pieces:[1], offset:0},
 * {pieces:[1], offset:0.5}] lays exactly uniformRow's bricks (the same arithmetic, pinned by a test).
 */
function customRow(courseIndex, bond, minX, maxX, courseCy, cH, L, J) {
  const course = bond.courses[courseIndex % bond.courses.length] || {};
  const seq = (course.pieces || []).map(Number).filter((p) => p > 0);
  if (!seq.length) return [];
  const pitch = L + J, offset = Number(course.offset) || 0;
  const periodUnits = seq.reduce((s, p) => s + p, 0);
  let u = 0; // the first piece's start, in pitches from minX - offset * pitch: one period before the course's left edge
  while (-offset + u > 0) u -= periodUnits;
  u -= periodUnits;
  const row = [];
  for (let k = 0; minX - offset * pitch + u * pitch < maxX + pitch; k++) {
    const p = seq[k % seq.length], len = L + (p - 1) * pitch;
    const cx = minX - offset * pitch + u * pitch + len / 2;
    if (!(cx + len / 2 < minX - 1e-6 || cx - len / 2 > maxX + 1e-6)) {
      row.push({ courseIndex, colIndex: row.length, cx, cy: courseCy, polygon: rectPolygon(cx, courseCy, len / 2, cH / 2) });
    }
    u += p;
  }
  return row;
}

function flemishRow(courseIndex, minX, maxX, courseCy, cH, L, H, J) {
  const period = L + J + H + J;
  const phase = (courseIndex % 2 === 1) ? period / 2 : 0;
  const row = [];
  let x = minX - phase - period;
  while (x < maxX + period) {
    const units = [{ x0: x, w: L }, { x0: x + L + J, w: H }];
    for (const u of units) {
      const cx = u.x0 + u.w / 2;
      if (!(cx + u.w / 2 < minX - 1e-6 || cx - u.w / 2 > maxX + 1e-6)) {
        const polygon = rectPolygon(cx, courseCy, u.w / 2, cH / 2);
        row.push({ courseIndex, colIndex: row.length, cx, cy: courseCy, polygon });
      }
    }
    x += period;
  }
  return row;
}

/**
 * @param {{x:number,y:number}[]} boardOutline — closed polygon, board inches
 * @param {{brickLengthIn:number, brickHeightIn:number, grout:{widthIn:number}}} set — the active brick set
 * @param {{pattern?:string, bond?:string, rows?:number, heightIn?:number}[]} [zones] — top -> bottom
 *   (`pattern` is any library.BRICK_PATTERNS key of kind 'course'/'course-alternating'; `bond` is a
 *   deprecated pre-item-7 alias, still read when `pattern` is omitted)
 * @returns {{cells: Array}} cells[i] = { id, polygon, courseIndex, colIndex, neighbors:{left,right,above,below} }
 */
/**
 * T86 item 26 (Fred, for 37's pattern maker F35-31b): ACCENT CUTS -- an accent tile at sub-brick resolution.
 * `accentCuts = { unit, tile: { rows, cols, cells[row][col] } }`: a cell is `unit` (1/2 or 1/4) of a brick's pitch
 * (brick + joint) along a course and one course high; row 0 = the wall's BOTTOM course (37's accentGrid
 * convention), columns counted from the wall's left edge (minX) -- a half-bond stagger is a whole number of 1/2 and
 * 1/4 cells, so one grid fits every course. A brick whose cells are not all marked alike is SPLIT where the mark
 * changes: each piece spans its cells less one joint (the joint between them), like two closers. Every cell comes
 * out with `accentMarked` (true = the tile marks it), so only the marked fraction is raised / sunk. A brick off the
 * grid (unit 1, flemish's headers) is not cut: it takes the mark under its centre, columns by 37's own half-bond
 * rule (floor(x / pitch + 0.25)).
 */
function applyAccentCuts(courses, accentCuts, minX, J) {
  const { unit, tile } = accentCuts;
  if (!tile || !tile.rows || !tile.cols || !tile.cells) return courses;
  const mod = (a, n) => ((a % n) + n) % n;
  const marked = (row, col) => !!(tile.cells[mod(row, tile.rows)] && tile.cells[mod(row, tile.rows)][mod(col, tile.cols)]);
  const last = courses.length - 1;
  return courses.map((row, c) => {
    const tileRow = last - c; // the bottom course is tile row 0
    const out = [];
    for (const cell of row) {
      const xs = cell.polygon.map((p) => p.x), ys = cell.polygon.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const pitch = x1 - x0 + J;
      const u = unit * pitch, n = Math.round(1 / unit);
      const k0 = (x0 - minX) / u;
      const onGrid = unit < 1 && Math.abs(n * unit - 1) < 1e-9 && Math.abs(k0 - Math.round(k0)) < 1e-6;
      if (!onGrid) {
        const col = unit < 1 ? Math.floor(((x0 + x1) / 2 - minX) / u) : Math.floor(((x0 + x1) / 2 - minX) / pitch + 0.25);
        out.push({ ...cell, colIndex: out.length, accentMarked: marked(tileRow, col) });
        continue;
      }
      const first = Math.round(k0);
      let a = 0;
      while (a < n) {
        const m = marked(tileRow, first + a);
        let b = a;
        while (b + 1 < n && marked(tileRow, first + b + 1) === m) b++;
        const px0 = x0 + a * u, px1 = x0 + (b + 1) * u - J;
        const cx = (px0 + px1) / 2;
        out.push({ ...cell, colIndex: out.length, cx, polygon: rectPolygon(cx, (y0 + y1) / 2, (px1 - px0) / 2, (y1 - y0) / 2), accentMarked: m });
        a = b + 1;
      }
    }
    return out;
  });
}

export function bondLayout(boardOutline, set, zones, _seed, _largeStones, _fences, { accentCuts, customBond } = {}) {
  const custom = customBond && Array.isArray(customBond.courses) && customBond.courses.length ? customBond : null;
  const xs = boardOutline.map((p) => p.x), ys = boardOutline.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

  const L = set.brickLengthIn, H = set.brickHeightIn, J = set.grout.widthIn;
  const maxDim = Math.max(L, H);

  const resolvedZones = resolveZones(set, zones, maxY - minY);
  const coursePatterns = [];
  for (const z of resolvedZones) for (let i = 0; i < z.rows; i++) coursePatterns.push(z.pattern);

  // course-by-course grid, keyed by [courseIndex] -> array of cells (so adjacency can look sideways
  // within a course directly by array index, and up/down by matching column-centre proximity --
  // adjacent courses can be staggered and/or a different pattern, so "the cell above" is whichever
  // overlaps this one's own x-span the most, not a fixed column index).
  const courses = [];
  let cy = minY;
  for (let c = 0; c < coursePatterns.length; c++) {
    const pattern = custom ? BRICK_PATTERNS.stretcher : patternFor(coursePatterns[c]);
    const cH = courseHeightFor(pattern, L, H);
    const coursePitch = cH + J;
    const courseCy = cy + cH / 2;
    const row = custom ? customRow(c, custom, minX, maxX, courseCy, cH, L, J)
      : pattern.kind === 'course-alternating'
        ? flemishRow(c, minX, maxX, courseCy, cH, L, H, J)
        : uniformRow(c, pattern, minX, maxX, courseCy, cH, L, H, J);
    courses.push(row);
    cy += coursePitch;
    if (cy > maxY + maxDim) break; // past the board -- later zones (if any) would be invisible anyway
  }

  // T86 item 15: `clipPolygonToBoard` below only ever SHRINKS a cell to fit the board outline -- it
  // can never GROW one to reach further than its own declared rectangle. Course pitch rarely divides
  // `maxY - minY` evenly, so the stack above routinely ends with its last course's own top edge short
  // of the board's real top, a genuine strip no cell was ever generated to cover (MEASURED: this is
  // the actual mechanism behind Fred's own screenshot, not a clipping bug -- clipping had nothing to
  // clip). Fixed here, once, after the declared stack settles, rather than inside the loop above: a
  // CUT course, same pattern/bond/stagger as the course directly below it (same row-generator, same
  // `cx` grid), just a SHORTER `cH` sized to the exact remaining gap instead of the pattern's own
  // declared course height -- `clipPolygonToBoard` trims it the normal way afterward, so a curved or
  // arched top still comes out right (less of this course survives near the curve, same as any other).
  // Below the quarter-brick floor, the leftover simply stays open -- it reads as a slightly wider
  // joint against the board's own edge, not a separate sliver brick nobody could keep clean anyway.
  if (courses.length) {
    const remaining = maxY - cy;
    if (remaining >= MIN_PIECE_FRACTION * H) {
      const c = courses.length;
      const pattern = patternFor(coursePatterns[c - 1]);
      const courseCy = cy + remaining / 2;
      const row = custom ? customRow(c, custom, minX, maxX, courseCy, remaining, L, J)
        : pattern.kind === 'course-alternating'
          ? flemishRow(c, minX, maxX, courseCy, remaining, L, H, J)
          : uniformRow(c, pattern, minX, maxX, courseCy, remaining, L, H, J);
      courses.push(row);
    }
  }

  const laid = accentCuts ? applyAccentCuts(courses, accentCuts, minX, J) : courses;
  const cells = [];
  let nextId = 0;
  const idGrid = laid.map(() => []);
  for (let c = 0; c < laid.length; c++) {
    for (let k = 0; k < laid[c].length; k++) {
      const cell = laid[c][k];
      const clipped = clipPolygonToBoard(cell.polygon, boardOutline, { x: cell.cx, y: cell.cy });
      if (clipped.length < 3) { idGrid[c].push(-1); continue; } // fully outside, or clipped to a degenerate sliver
      const id = nextId++;
      idGrid[c].push(id);
      cells.push({ id, polygon: clipped, courseIndex: c, colIndex: k, cx: cell.cx, cy: cell.cy, neighbors: {},
        ...(cell.accentMarked !== undefined ? { accentMarked: cell.accentMarked } : {}) });
    }
  }
  const byId = new Map(cells.map((c) => [c.id, c]));
  for (const cell of cells) {
    const row = idGrid[cell.courseIndex];
    const leftId = cell.colIndex > 0 ? row[cell.colIndex - 1] : -1;
    const rightId = cell.colIndex < row.length - 1 ? row[cell.colIndex + 1] : -1;
    cell.neighbors.left = leftId >= 0 ? byId.get(leftId) : null;
    cell.neighbors.right = rightId >= 0 ? byId.get(rightId) : null;
    // "above"/"below": the neighbouring course's own cell whose x-span overlaps this one's centre
    // most closely (courses can be staggered and/or a different bond kind, so there is no fixed
    // column correspondence).
    const findOverlap = (courseIdx) => {
      if (courseIdx < 0 || courseIdx >= idGrid.length) return null;
      let best = null, bestDist = Infinity;
      for (const otherId of idGrid[courseIdx]) {
        if (otherId < 0) continue;
        const other = byId.get(otherId);
        const d = Math.abs(other.cx - cell.cx);
        if (d < bestDist) { bestDist = d; best = other; }
      }
      return best && bestDist < maxDim ? best : null;
    };
    cell.neighbors.above = findOverlap(cell.courseIndex - 1);
    cell.neighbors.below = findOverlap(cell.courseIndex + 1);
  }
  return { cells, brickLengthIn: L, brickHeightIn: H };
}
