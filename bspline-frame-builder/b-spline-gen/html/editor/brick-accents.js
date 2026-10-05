/**
 * editor/brick-accents.js -- F35 item 15, RAISED ACCENTS (Fred's 4th sheet, shots/fred/ref_accent_brick_levels.jpg):
 * selected Wall bricks sit proud (or recessed) of the wall by a Level, in a decorative motif, inside a zone
 * (the lower third by default). Pure: no DOM, no engine call. Everything is DECLARED:
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
 * a Wall inside a frame (or, later, a wall element anywhere on the board) gets ITS lower third.
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

const LOWER_THIRD = Object.freeze([0, 1 / 3]); // zone = [from, to] as fractions of the board height, from the bottom

/** The 10 presets (advisor turn 207: "10, not 6", Fred picks from the icons). Ids are stable keys. */
export const ACCENT_PRESETS = Object.freeze([
  { id: 'checker', label: 'Checker', motif: 'checker', params: {}, zone: LOWER_THIRD },
  { id: 'staircase', label: 'Staircase', motif: 'staircase', params: { period: 6, width: 1 }, zone: LOWER_THIRD },
  { id: 'doubleStaircase', label: 'Double staircase', motif: 'staircase', params: { period: 8, width: 2 }, zone: LOWER_THIRD },
  { id: 'pyramid', label: 'Pyramid', motif: 'pyramid', params: { period: 8, height: 4 }, zone: LOWER_THIRD },
  { id: 'zigzag', label: 'Zigzag', motif: 'zigzag', params: { amp: 3, period: 8 }, zone: LOWER_THIRD },
  { id: 'courseBand', label: 'Course bands', motif: 'courseBand', params: { every: 4, count: 1 }, zone: LOWER_THIRD },
  { id: 'doubleBand', label: 'Double course bands', motif: 'courseBand', params: { every: 6, count: 2 }, zone: LOWER_THIRD },
  { id: 'crenellation', label: 'Crenellation', motif: 'crenellation', params: { every: 3 }, zone: LOWER_THIRD },
  { id: 'sparseDots', label: 'Sparse dots', motif: 'everyNth', params: { n: 4, m: 3, shift: 2 }, zone: LOWER_THIRD },
  { id: 'random', label: 'Random 15%', motif: 'random', params: { share: 0.15 }, zone: LOWER_THIRD },
]);
export const ACCENT_CUSTOM = Object.freeze({ id: 'custom', label: 'Custom (click bricks)' });
export const DEFAULT_ACCENT = Object.freeze({ preset: 'none', levelIn: 0.0625, clicks: [] });

/** F35 item 32 (Fred: "raised brick should allow sunk bricks"): the accent LEVEL is SIGNED -- + raises the marked
 *  bricks, - sinks them -- within this declared range. The height mask clamps the brick top at the ground (core
 *  sampleHeight never returns below 0), so a sunk brick never goes below the grout floor. */
export const ACCENT_LEVEL_RANGE = Object.freeze({ min: -0.125, max: 0.125, step: 0.015625, default: 0.0625 });
export const clampAccentLevel = (v) => Math.max(ACCENT_LEVEL_RANGE.min, Math.min(ACCENT_LEVEL_RANGE.max, Number(v) || 0));

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
  return { id: `user:${slug}`, label: String(label || 'Pattern').trim(), bond: { builtin: tile.base },
    accent: { tile: { rows: tile.rows, cols: tile.cols, cells: tile.cells.map((r) => r.slice()) } }, unit: tile.unit || 1, level: clampAccentLevel(levelIn) };
}
/** The accent a saved pattern applies (its tile ON its own bond -- marks never move to another bond). */
export const accentOfUserPattern = (u) => ({ preset: ACCENT_TILE.id, tile: { ...u.accent.tile, unit: u.unit, base: u.bond.builtin, userId: u.id }, levelIn: u.level });

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
