/**
 * editor/brick-accents.js -- F35 item 15, RAISED ACCENTS (Fred's 4th sheet, shots/fred/ref_accent_brick_levels.jpg):
 * selected Wall bricks sit proud (or recessed) of the wall by a Level, in a decorative motif, inside a zone
 * (the whole wall, F35 item 57). Pure: no DOM, no engine call. Everything is DECLARED:
 *   ACCENT_MOTIFS  -- the rule that picks a brick from its (course, column) in the zone
 *   ACCENT_PRESETS -- the user's choices: a motif + its parameters + a zone (a new preset = one more entry)
 * Plus 'custom' ("Click bricks"): the raised bricks are the ones under the user's stored click POINTS, so a
 * re-lay (new pattern, size, seed) re-maps each click to whichever brick now lies under it.
 *
 * (course, column) are DERIVED from the bricks' positions here, not taken from the layout engine (no engine
 * op): course pitch = the typical vertical step between brick centres, column pitch = the typical step along
 * a course. Course 0 is the zone's BOTTOM course (the board's y grows downward). Course-free layouts
 * (herringbone, fieldstone) still get a grid, just a looser one.
 * The ZONE is measured over the WALL's own extent (its bricks' lowest to highest point), not the board:
 * a Wall inside a frame (or, later, a wall element anywhere on the board) gets ITS zone (ACCENT_ZONES).
 */
import { pointInPolygon, polygonCentroid, hashedRandom } from '../core/bricks/index.js';

const mod = (a, n) => ((a % n) + n) % n;

/** motif id -> (course, column, params, ctx) => raised? */
export const ACCENT_MOTIFS = Object.freeze({
  checker: (c, i) => mod(c + i, 2) === 0,
  // every nth brick of every mth course; `shift` slides the picked column along per picked course
  everyNth: (c, i, p) => mod(c, p.m) === 0 && mod(i + (c / p.m) * (p.shift || 0), p.n) === 0,
  // a diagonal run: `width` bricks per course, stepping one column per course, repeating every `period`
  staircase: (c, i, p) => mod(i - c, p.period) < (p.width || 1),
  // a stepped triangle outline `height` courses tall, one every `period` columns
  pyramid: (c, i, p) => c < p.height && Math.abs(mod(i, p.period) - Math.floor(p.period / 2)) === p.height - 1 - c,
  // a staircase that turns back every `amp` courses
  zigzag: (c, i, p) => { const t = mod(c, 2 * p.amp); return mod(i, p.period) === (t <= p.amp ? t : 2 * p.amp - t); },
  // whole courses: `count` courses out of every `every`
  courseBand: (c, i, p) => mod(c, p.every) < (p.count || 1),
  // alternate bricks of every `every`th course
  crenellation: (c, i, p) => mod(c, p.every) === 0 && mod(i, 2) === 0,
  // a seeded share of the zone's bricks
  random: (c, i, p, ctx) => hashedRandom(ctx.seed, 'accent-random', c * 100003 + i) < p.share,
  // F35 item 31: a user TILE -- `rows` x `cols` cells, cells[row][col] true = raised; row 0 = the zone's bottom
  // course. Cell = (course mod rows, brick mod cols); the bond's stagger is already in the columns (accentGrid's
  // half-bond rule), so the tile repeats over the wall WITH the stagger.
  tile: (c, i, p) => !!(p.cells && p.cells[mod(c, p.rows)] && p.cells[mod(c, p.rows)][mod(i, p.cols)]),
});

/** F35 item 31: the TILE a preset repeats with (rows x cols, each <= `max`), measured, not declared: the
 *  smallest tile that reproduces the preset's rule over a 48 x 48 window -- or null when it has none (a
 *  course-bounded or seeded motif: pyramid, random). The periodic presets become the same tile data a user tile
 *  is. */
export function tileOf(preset, max = 8, ctx = { seed: 1 }) {
  const rule = preset && ACCENT_MOTIFS[preset.motif];
  if (!rule) return null;
  const at = (c, i) => !!rule(c, i, preset.params || {}, ctx);
  const WINDOW = 48;
  const sizes = [];
  for (let rows = 1; rows <= max; rows++) for (let cols = 1; cols <= max; cols++) sizes.push([rows, cols]);
  sizes.sort((a, b) => a[0] * a[1] - b[0] * b[1]);
  for (const [rows, cols] of sizes) {
    let ok = true;
    for (let c = 0; c < WINDOW && ok; c++) for (let i = 0; i < WINDOW && ok; i++) if (at(c, i) !== at(c % rows, i % cols)) ok = false;
    if (ok) return { rows, cols, cells: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, k) => at(r, k))) };
  }
  return null;
}

// zone = [from, to] as fractions of the WALL's height, from its bottom. F35 item 57 (Fred: "always puts them at the
// bottom, never higher"): the presets cover the WHOLE wall, as their picker icons show; LOWER_THIRD stays declared.
export const ACCENT_ZONES = Object.freeze({ WHOLE: Object.freeze([0, 1]), LOWER_THIRD: Object.freeze([0, 1 / 3]) });
const { WHOLE, LOWER_THIRD } = ACCENT_ZONES;

/** The 10 presets (advisor turn 207: "10, not 6", Fred picks from the icons). Ids are stable keys. */
export const ACCENT_PRESETS = Object.freeze([
  { id: 'checker', label: 'Checker', motif: 'checker', params: {}, zone: WHOLE },
  { id: 'staircase', label: 'Staircase', motif: 'staircase', params: { period: 6, width: 1 }, zone: WHOLE },
  { id: 'doubleStaircase', label: 'Double staircase', motif: 'staircase', params: { period: 8, width: 2 }, zone: WHOLE },
  { id: 'pyramid', label: 'Pyramid', motif: 'pyramid', params: { period: 8, height: 4 }, zone: WHOLE },
  { id: 'zigzag', label: 'Zigzag', motif: 'zigzag', params: { amp: 3, period: 8 }, zone: WHOLE },
  { id: 'courseBand', label: 'Course bands', motif: 'courseBand', params: { every: 4, count: 1 }, zone: WHOLE },
  { id: 'doubleBand', label: 'Double course bands', motif: 'courseBand', params: { every: 6, count: 2 }, zone: WHOLE },
  { id: 'crenellation', label: 'Crenellation', motif: 'crenellation', params: { every: 3 }, zone: WHOLE },
  { id: 'sparseDots', label: 'Sparse dots', motif: 'everyNth', params: { n: 4, m: 3, shift: 2 }, zone: WHOLE },
  { id: 'random', label: 'Random 15%', motif: 'random', params: { share: 0.15 }, zone: WHOLE },
]);
export const ACCENT_CUSTOM = Object.freeze({ id: 'custom', label: 'Custom (click bricks)' });
export const DEFAULT_ACCENT = Object.freeze({ preset: 'none', levelIn: 0.0625, clicks: [] });

/** F35 item 32 (Fred: "raised brick should allow sunk bricks"): the accent LEVEL is SIGNED -- + raises the marked
 *  bricks, - sinks them -- within this declared range. The height mask clamps the brick top at the ground (core
 *  sampleHeight never returns below 0), so a sunk brick never goes below the grout floor. */
export const ACCENT_LEVEL_RANGE = Object.freeze({ min: -0.125, max: 0.125, step: 0.015625, default: 0.0625 });
export const clampAccentLevel = (v) => Math.max(ACCENT_LEVEL_RANGE.min, Math.min(ACCENT_LEVEL_RANGE.max, Number(v) || 0));

/** Per-element accents on PATH-FOLLOWING runs (advisor: Frame bands + Brush strokes): the same periodic presets
 *  and Click bricks as the Wall, on the run's OWN grid -- course = its row (rowIndex), brick = its piece along the
 *  run (pieceIndex), both stamped by the engine on every band / stroke brick -- over the whole run (no zone). The
 *  custom TILE builder stays Wall-only (PATTERN_BUILDER_SCOPE). `bricks` = [{ polygon, row, piece }]. */
export function accentedRunIndices(bricks, accent, ctx = {}) {
  const out = new Set();
  if (!accent || !accent.preset || accent.preset === 'none' || !bricks.length) return out;
  if (accent.preset === ACCENT_CUSTOM.id) {
    for (const pt of accent.clicks || []) {
      const k = bricks.findIndex((b) => pointInPolygon(pt.x, pt.y, b.polygon));
      if (k >= 0) out.add(k);
    }
    return out;
  }
  const preset = accentPresetById(accent.preset);
  const rule = preset && ACCENT_MOTIFS[preset.motif];
  if (!rule) return out;
  bricks.forEach((b, k) => { if (rule(b.row || 0, b.piece || 0, preset.params, ctx)) out.add(k); });
  return out;
}
/** The element accents a lay / the mask read, declared once: the Wall's (`accent`), one per Frame band
 *  (`frameBandAccents[i]`) and the Brush element's (`brushAccent`, every stroke on its own grid). */
export const elementAccents = (settings) => ({
  wall: settings && settings.accent,
  frameBands: (settings && settings.frameBandAccents) || [],
  brush: settings && settings.brushAccent,
});

/** F35 item 31 step 2: the custom pattern TILE (the builder). An accent `{ preset: 'tile', tile }` raises (or sinks)
 *  the tile's cells, repeated over the whole wall: tile = { rows, cols, cells[row][col], unit, base }. `base` = the
 *  bond the tile is drawn on (the wall pattern it was made for), `unit` = a cell's share of a brick (1 / 0.5 /
 *  0.25; the fractions need the engine's 'accentCuts', seat B T86-26). */
export const ACCENT_TILE = Object.freeze({ id: 'tile' });
export const ACCENT_TILE_LIMITS = Object.freeze({ min: 2, max: 8, rows: 4, cols: 6, maxCellsAcross: 16 });
export const ACCENT_TILE_UNITS = Object.freeze([
  { id: 1, label: '1', title: 'A cell is a whole brick' },
  { id: 0.5, label: '½', title: 'A cell is half a brick', requires: { engineOption: 'accentCuts' } },
  { id: 0.25, label: '¼', title: 'A cell is a quarter brick', requires: { engineOption: 'accentCuts' } },
]);
/** F35 item 31b: the engine input a tile at a FRACTION of a brick lays with -- generateBricks `accentCuts` (seat B
 *  T86-26): the wall's bricks are CUT at the tile's cell boundaries and each piece comes back `accentMarked`. A whole-
 *  brick tile (unit 1), a preset or no accent -> null: no key, today's lay (byte-identical). */
export function accentCutsFor(accent) {
  const t = accent && accent.preset === ACCENT_TILE.id && accent.tile;
  if (!t || !t.rows || !t.cols || !Array.isArray(t.cells)) return null;
  // item 31e: a CUSTOM bond is always marked by the engine (its pieces are not the accent grid's bricks), any unit
  if (!isCustomBondTile(t) && !(Number(t.unit) > 0 && Number(t.unit) < 1)) return null;
  return { unit: Number(t.unit) || 1, tile: { rows: t.rows, cols: t.cols, cells: t.cells.map((r) => r.map(Boolean)) } };
}

/* ------------------------------------------------------------------------------------------------------------
 * F35 item 31e (Fred: "the pattern builder is both pattern and raised-brick editor"): the tile edits the BOND too.
 * Base 'custom' = a CUSTOM BOND carried by the tile itself (one pattern object): tile.bond = { courses: [{ pieces,
 * offset }] }, one course per tile row (row 0 = the wall's bottom course, core COURSE_ROW_ORIGIN), `pieces` = each
 * piece's length in CELLS (summing to cols), `offset` = the course's shift in cells, the engine's sense (the pieces
 * start `offset` cells LEFT of the wall's left edge). customBondFor scales both by the unit into the engine's
 * customBond (brick units / pitches, seat B T86-27). A piece's cells are marked together (a tap raises the piece).
 * ---------------------------------------------------------------------------------------------------------- */
export const BOND_CUSTOM = 'custom';
export const isCustomBondTile = (t) => !!(t && t.base === BOND_CUSTOM && t.bond && Array.isArray(t.bond.courses));
const _blankCourse = (cols) => ({ pieces: Array(cols).fill(1), offset: 0 });
/** "Custom" starts from a blank grid: every cell its own piece, no offset. */
export const blankBond = (rows, cols) => ({ courses: Array.from({ length: rows }, () => _blankCourse(cols)) });
/** Resized: rows kept / added blank; each course's pieces kept in order up to `cols` (the last one cut), the rest
 *  single cells; offsets wrapped. */
export function resizeBond(bond, rows, cols) {
  const courses = Array.from({ length: rows }, (_, r) => {
    const c = bond && bond.courses && bond.courses[r];
    if (!c) return _blankCourse(cols);
    const pieces = [];
    let used = 0;
    for (const n of c.pieces) { if (used >= cols) break; const k = Math.min(n, cols - used); pieces.push(k); used += k; }
    while (used < cols) { pieces.push(1); used++; }
    return { pieces, offset: mod(c.offset || 0, cols) };
  });
  return { courses };
}
/** cell (0..cols-1) -> the index of the course's piece covering it. */
export function pieceOfCells(course, cols) {
  const of = Array(cols).fill(0);
  let x = -(course.offset || 0);
  course.pieces.forEach((n, k) => { for (let j = 0; j < n; j++) of[mod(x + j, cols)] = k; x += n; });
  return of;
}
/** The cells (absolute, in order) of piece k of a course. */
export function cellsOfPiece(course, cols, k) {
  let x = -(course.offset || 0);
  for (let i = 0; i < k; i++) x += course.pieces[i];
  return Array.from({ length: course.pieces[k] }, (_, j) => mod(x + j, cols));
}
const _withCourse = (tile, row, course, cells = tile.cells) => ({ ...tile, cells,
  bond: { courses: tile.bond.courses.map((c, r) => (r === row ? course : c)) } });
/** Tap a cell: its whole PIECE is raised / un-raised (marks never split a custom piece). */
export function bondTogglePiece(tile, row, col) {
  const course = tile.bond.courses[row];
  const cells = cellsOfPiece(course, tile.cols, pieceOfCells(course, tile.cols)[col]);
  const on = !tile.cells[row][col];
  return { ...tile, cells: tile.cells.map((r, i) => (i === row ? r.map((v, c) => (cells.includes(c) ? on : v)) : r)) };
}
/** Drag across cells a..b of a row: every piece they touch becomes ONE piece (walking right from a's piece, so a drag
 *  across the tile's edge joins round it); the joined piece takes a's piece's mark. A join that would leave the course
 *  a single ring piece is a no-op (a course needs a joint). */
export function bondJoin(tile, row, a, b) {
  const course = tile.bond.courses[row], n = course.pieces.length;
  const of = pieceOfCells(course, tile.cols);
  const first = of[a], last = of[b];
  if (first === last) return tile;
  const span = mod(last - first, n) + 1; // pieces first..last, walking right (wrapping)
  if (span >= n) return tile;
  const take = Array.from({ length: span }, (_, i) => mod(first + i, n));
  const order = Array.from({ length: n }, (_, i) => mod(first + i, n));
  const start = cellsOfPiece(course, tile.cols, first)[0];
  const pieces = [take.reduce((sum, k) => sum + course.pieces[k], 0), ...order.slice(span).map((k) => course.pieces[k])];
  const mark = tile.cells[row][start];
  const joinedCells = take.flatMap((k) => cellsOfPiece(course, tile.cols, k));
  const cells = tile.cells.map((r, i) => (i === row ? r.map((v, c) => (joinedCells.includes(c) ? mark : v)) : r));
  return _withCourse(tile, row, { pieces, offset: mod(-start, tile.cols) }, cells);
}
/** Tap the joint before cell `col` inside a piece: split it there (both halves keep the mark). */
export function bondSplit(tile, row, col) {
  const course = tile.bond.courses[row];
  const k = pieceOfCells(course, tile.cols)[col];
  const at = cellsOfPiece(course, tile.cols, k).indexOf(col);
  if (at <= 0) return tile; // the piece's own start: there is no joint inside it there
  const pieces = [...course.pieces.slice(0, k), at, course.pieces[k] - at, ...course.pieces.slice(k + 1)];
  return _withCourse(tile, row, { ...course, pieces });
}
/** Offset a course by `delta` cells to the RIGHT (its marks travel with its pieces). */
export function bondShift(tile, row, delta) {
  const course = tile.bond.courses[row];
  const cells = tile.cells.map((r, i) => (i === row ? r.map((_, c) => r[mod(c - delta, tile.cols)]) : r));
  return _withCourse(tile, row, { ...course, offset: mod((course.offset || 0) - delta, tile.cols) }, cells);
}
/** The engine's customBond for a custom-bond tile (cells x unit = brick units / pitches); null otherwise. */
export function customBondFor(tile) {
  if (!isCustomBondTile(tile)) return null;
  const u = Number(tile.unit) || 1;
  return { courses: tile.bond.courses.map((c) => ({ pieces: c.pieces.map((n) => n * u), offset: (c.offset || 0) * u })) };
}
/** What the Wall accent adds to a lay, declared ONCE (the lay input, the icons and the panel's re-lay rule read it):
 *  accentCuts (a cut / custom tile) and customBond (a custom tile), each only while the engine lists it. */
export function accentLayInput(accent, engineOptions = []) {
  const out = {};
  // a custom-bond tile adds NOTHING until the engine lays custom bonds (its cells index a bond that is not laid)
  if (accent && accent.preset === ACCENT_TILE.id && isCustomBondTile(accent.tile) && !engineOptions.includes('customBond')) return out;
  const cuts = engineOptions.includes('accentCuts') ? accentCutsFor(accent) : null;
  if (cuts) out.accentCuts = cuts;
  const bond = engineOptions.includes('customBond') && accent && accent.preset === ACCENT_TILE.id ? customBondFor(accent.tile) : null;
  if (bond) out.customBond = bond;
  return out;
}
/** The engine's per-brick mark, kept on each drawn Wall brick (editor-only: never baked) -- the 2D outline, the icons
 *  and the height mask read it whenever the accent is cut (accentCutsFor), so all three show the engine's own pieces. */
export const ACCENT_MARK_ATTR = 'data-brick-accent-marked';

/** The builder's declared scope (Fred: "Custom is for wall only for now"): which element kinds may open it. */
export const PATTERN_BUILDER_SCOPE = Object.freeze(['wall']);

/** A blank tile (or one resized: the kept cells stay where they were). */
export function makeTile(rows = ACCENT_TILE_LIMITS.rows, cols = ACCENT_TILE_LIMITS.cols, from = null, extra = {}) {
  const clamp = (n) => Math.max(ACCENT_TILE_LIMITS.min, Math.min(ACCENT_TILE_LIMITS.max, Math.round(n)));
  const r = clamp(rows), c = clamp(cols);
  const cells = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, k) => !!(from && from.cells && from.cells[i] && from.cells[i][k])));
  return { rows: r, cols: c, cells, unit: (from && from.unit) || 1, base: (from && from.base) || 'stretcher', ...extra };
}

/** A SAVED custom pattern (item 31 data shape, approved): ONE object -- its bond, its accent tile ON that bond, the
 *  tile unit and the signed level. Stored with the project (P.brickSettings.userPatterns) + in the browser. */
export function userPatternFrom(label, tile, levelIn) {
  const slug = String(label || 'pattern').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pattern';
  // item 31e: the bond is the built-in one the tile was drawn on, or the tile's own CUSTOM bond (its courses, in cells)
  const bond = isCustomBondTile(tile) ? { custom: { courses: tile.bond.courses.map((c) => ({ pieces: c.pieces.slice(), offset: c.offset || 0 })) } } : { builtin: tile.base };
  return { id: `user:${slug}`, label: String(label || 'Pattern').trim(), bond,
    accent: { tile: { rows: tile.rows, cols: tile.cols, cells: tile.cells.map((r) => r.slice()) } }, unit: tile.unit || 1, level: clampAccentLevel(levelIn) };
}
/** The accent a saved pattern applies (its tile ON its own bond -- marks never move to another bond). */
export const accentOfUserPattern = (u) => ({ preset: ACCENT_TILE.id, levelIn: u.level, tile: { ...u.accent.tile, unit: u.unit, userId: u.id,
  ...(u.bond.custom ? { base: BOND_CUSTOM, bond: { courses: u.bond.custom.courses.map((c) => ({ ...c, pieces: c.pieces.slice() })) } } : { base: u.bond.builtin }) } });
/** item 31e: the Wall PATTERN (BRICK_PATTERNS id) a tile's base lays on -- a custom bond on the stretcher course grid
 *  (stretcher-high courses, the bond layout), a built-in bond as itself. */
export const wallPatternOfBase = (base) => (base === BOND_CUSTOM ? 'stretcher' : base);

export const accentPresetById = (id) => ACCENT_PRESETS.find((p) => p.id === id) || null;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Typical step between distinct sorted values, ignoring steps below `minStep` (same course / column). */
function typicalStep(values, minStep, fallback) {
  const s = [...values].sort((a, b) => a - b);
  const steps = [];
  for (let k = 1; k < s.length; k++) if (s[k] - s[k - 1] > minStep) steps.push(s[k] - s[k - 1]);
  return steps.length ? median(steps) : fallback;
}

/** [{course, column}] per brick (same order), for the bricks whose centre lies in `zone` of the bricks'
 *  own vertical extent; null for a brick outside the zone. */
export function accentGrid(bricks, zone = LOWER_THIRD) {
  const allY = bricks.flatMap((b) => b.polygon.map((p) => p.y));
  const top = Math.min(...allY), span = Math.max(...allY) - top || 1;
  const info = bricks.map((b) => {
    const c = polygonCentroid(b.polygon);
    const ys = b.polygon.map((p) => p.y), xs = b.polygon.map((p) => p.x);
    const up = (top + span - c.y) / span; // 0 at the wall's bottom edge
    return { c, h: Math.max(...ys) - Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), inZone: up >= zone[0] && up <= zone[1] };
  });
  const inZone = info.filter((n) => n.inZone);
  if (!inZone.length) return bricks.map(() => null);
  const h = median(inZone.map((n) => n.h));
  const w = median(inZone.map((n) => n.w));
  const pitchY = typicalStep(inZone.map((n) => n.c.y), h * 0.3, h);
  const bottom = Math.max(...inZone.map((n) => n.c.y));
  const course = (n) => Math.round((bottom - n.c.y) / pitchY);
  // column pitch: the step between centres along a course
  const byCourse = new Map();
  for (const n of inZone) {
    const k = course(n);
    if (!byCourse.has(k)) byCourse.set(k, []);
    byCourse.get(k).push(n.c.x);
  }
  const steps = [];
  for (const xs of byCourse.values()) {
    xs.sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] > w * 0.3) steps.push(xs[k] - xs[k - 1]);
  }
  const pitchX = steps.length ? median(steps) : w;
  // + 0.25: a half-bond course's centres sit half a pitch over, so both courses floor to the same column.
  // Along a course the columns strictly increase: a cut brick at the board's edge (centre close to its
  // neighbour's) takes the next column instead of sharing one (measured: the right-edge half brick).
  const column = new Map();
  for (const k of byCourse.keys()) {
    let prev = -Infinity;
    for (const n of inZone.filter((m) => course(m) === k).sort((a, b) => a.c.x - b.c.x)) {
      prev = Math.max(Math.floor(n.c.x / pitchX + 0.25), prev + 1);
      column.set(n, prev);
    }
  }
  return info.map((n) => (n.inZone ? { course: course(n), column: column.get(n) } : null));
}

/** Indices of the bricks the accent raises -- `bricks` = the WHOLE wall (the zone is measured over it).
 *  `accent` = {preset, levelIn, clicks}; `ctx` = {seed, zone?} (zone overrides the preset's: the icons). */
export function accentedBrickIndices(bricks, accent, ctx = {}) {
  const out = new Set();
  if (!accent || !accent.preset || accent.preset === 'none' || !bricks.length) return out;
  if (accent.preset === ACCENT_CUSTOM.id) {
    for (const pt of accent.clicks || []) {
      const k = bricks.findIndex((b) => pointInPolygon(pt.x, pt.y, b.polygon));
      if (k >= 0) out.add(k);
    }
    return out;
  }
  // item 31b: a CUT tile -- the engine marked every piece it laid (accentMarked); that is the answer, no grid
  if (accentCutsFor(accent) && bricks.every((b) => typeof b.accentMarked === 'boolean')) {
    bricks.forEach((b, k) => { if (b.accentMarked) out.add(k); });
    return out;
  }
  // item 31: `preset` may also be an ad-hoc preset object (a user tile, before it is saved)
  // item 31: a custom TILE (the builder / a saved pattern) repeats over the whole wall
  const preset = accent.preset === ACCENT_TILE.id && accent.tile
    ? { motif: 'tile', params: accent.tile, zone: accent.tile.zone || [0, 1] }
    : typeof accent.preset === 'object' ? accent.preset : accentPresetById(accent.preset);
  const rule = preset && ACCENT_MOTIFS[preset.motif];
  if (!rule) return out;
  const zone = ctx.zone || preset.zone;
  accentGrid(bricks, zone).forEach((g, k) => {
    if (g && rule(g.course, g.column, preset.params, ctx)) out.add(k);
  });
  return out;
}

/** Custom mode: a click on a brick that already holds a stored point removes that point (un-raise);
 *  a click on any other brick stores the click (raise). A click on grout changes nothing. */
export function toggleAccentClick(clicks, pt, bricks) {
  const hit = bricks.find((b) => pointInPolygon(pt.x, pt.y, b.polygon));
  if (!hit) return clicks;
  const inHit = (q) => pointInPolygon(q.x, q.y, hit.polygon);
  return clicks.some(inHit) ? clicks.filter((q) => !inHit(q)) : [...clicks, { x: +pt.x.toFixed(4), y: +pt.y.toFixed(4) }];
}
