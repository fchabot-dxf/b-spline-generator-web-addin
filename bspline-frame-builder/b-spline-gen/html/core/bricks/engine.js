/**
 * core/bricks/engine.js — PORTABLE (see rng.js). A convenience composer over the THREE core
 * primitives (along-path.js's bricksAlongPath = the Brush tool, fill-shape.js's bricksFillShape =
 * the Wall tool, contour-bands.js's bricksContourBands = the Frame tool) for the common
 * "whole board, optional contour frame" case -- the adapter can call the primitives directly per
 * editor-element type instead (see WORK-LOG's own element-type -> primitive table), this file
 * is just the one-call convenience this project's own preview script and tests use.
 *
 * Primary output is VECTOR SHAPES (Fred: "bricks are more like vectors"); the height-field
 * sampler below is a SECOND, DERIVED output built from that same brick list.
 */
import { bricksFillShape } from './fill-shape.js';
import { strokesToRegion, WALL_REGION_PICK } from './region.js';
import { bricksContourBands } from './contour-bands.js';
import { pointInPolygon } from './geometry.js';
import { brickTopHeight } from './height-profile.js';
import { suppressBricks } from './suppression.js';
import { laySurround } from './inset-surround.js';
import { scaledSet } from './library.js';
import { applyFanCentre, FAN_CENTRE_DEFAULT } from './fan-centre.js';

/**
 * @param {object} input
 * @param {{x:number,y:number}[]} input.boardOutline — closed polygon, board inches
 * @param {object} input.set — a library.BRICK_SETS entry
 * @param {object} [input.frame] — { primitives, bands, set } or omitted/null for no frame
 *   (H23 item 76: `primitives` is the frame contour's own RAW lines+arcs, passed through to
 *   bricksContourBands verbatim -- see that function's own header; `set`, F35 item 5 review: an
 *   OPTIONAL override used for the frame bands ONLY, defaulting to the top-level `input.set` when
 *   omitted -- Wall's own bricksFillShape call below always uses `input.set`, never this. T86
 *   item 14: Wall's own interior ALWAYS resolves against `frame.primitives` whenever it's present,
 *   even with `bands: []` or omitted -- only a `frame` that's ITSELF omitted/null falls back to
 *   `boardOutline`.)
 * @param {number} [input.suppression=0]
 * @param {number} [input.topBias=0.8]
 * @param {number} [input.clumping=0.3]
 * @param {{bond?:'running'|'stack'|'soldier', rows?:number, heightIn?:number}[]} [input.zones]
 * @param {number} [input.scale=1] — uniform multiplier on the set's own brick length/height (grout unaffected)
 * @param {boolean} [input.skipWallFill=false] — F35 item 12 follow-up (Fred): the Wall picker's own
 *   'none' pattern (editor-brick-tool.js's applyWallPattern) -- skip bricksFillShape entirely, Wall
 *   produces zero bricks (Frame, if any, is untouched: this only gates the Wall fill call below).
 * @param {number} [input.largeStones] — T86 item 17: fieldstone layouts only (ignored otherwise,
 *   same as `zones` is bond-only); see fieldstoneLayout's own header for the declared range.
 * @param {number} input.seed
 * @returns {{ bricks: Array, frameBricks: Array, seed: number }} `seed` is carried along so
 *   sampleHeight (below) can reach it without a breaking signature change -- height-profile chip
 *   placement is seeded.
 */
/** The generateBricks `input` options this engine actually HONOURS (turn 199, advisor: a UI control for an
 *  option the engine ignores must not show -- main/brick-control-requires.js `engineOption`). Add an
 *  option's name here in the SAME change that makes the engine read it (e.g. 'largeStones' with T86
 *  item 17, 'exclusions' with T86 item 13) and its control appears by itself. */
export const ENGINE_OPTIONS = Object.freeze([
  'boardOutline', 'set', 'frame', 'suppression', 'topBias', 'clumping', 'zones', 'scale', 'skipWallFill', 'seed',
  'largeStones', // T86 item 17
  'exclusions', // T86 item 13
  'bandFit', // T86 item 28: false = draw the frame stack as requested (icons); default: the fit rule
  'rotationDeg', // T86 item 29: the wall pattern turned by this angle (0 / 45 / 90 chips); default 0
  'wallRegion', // T86 item 18: the wall lays only in the painted areas (wallRegionOf)
  'rustic', // T86 item 22: rustic running bond, 0..1 (library.js RUSTIC); the Brush reads it too (along-path)
  'accentCuts', // T86 item 26: an accent tile at 1/2 or 1/4 brick splits bricks and marks the pieces (accentMarked)
  'customBond', // T86 item 27: a declared course sequence (pieces in brick units + an offset per course)
  'suppressFrame', 'frameSuppression', // T86 item 29 (lane-b): the frame bands crumble by the wall's rule (suppression.js suppressBricks)
  'insetSurround', // T86 item 29 (lane-b): { rect, preset, corner?, set? } -- a band stack around the inset window (inset-surround.js)
  'fanCentre', // T86 item 16e: how a frame corner's fan ends at its centre (fan-centre.js FAN_CENTRES); absent = needle
]);

export function generateBricks(input) {
  const { boardOutline, set, frame, seed, scale } = input;

  let interiorOutline = boardOutline;
  let frameBricks = [];
  let bandsReduced; // T86 item 28: contour-bands' fit-rule note, when the requested stack did not fit
  // T86 item 14 (Fred: a Wall with no Frame bands was filling `boardOutline` -- in the live app,
  // ALWAYS a plain bounding rectangle (editor-brick-tool.js's own `boardPolygon`), never the
  // template's own true (often non-rectangular: hourglass waists, tapered sides, arched tops)
  // contour. `frame.primitives` carries that true contour whenever a frame/template resolved AT
  // ALL (main/brick-panel.js's own `resolveFrameGeom`, called unconditionally on every generate,
  // independent of whether the Frame KIND is actually being laid) -- the old `frame.bands.length`
  // gate threw it away the instant bands was empty (preset 'none', or just Wall used alone),
  // falling back to the rectangle and leaking bricks into every concave notch/cutaway the
  // template's own silhouette doesn't actually cover. MEASURED (tests/bricks-engine.test.js, this
  // item): on real templates (7x9/9x12), the template's own area is only 55-84% of its bounding
  // rectangle, and 22-50% of Wall's own bricks landed outside the true contour before this fix.
  // Gate on `frame.primitives` instead -- `bricksContourBands` with an EMPTY `bands` list already
  // returns `innerPath` unchanged (0 bands = nothing to shrink by), so this is a strict
  // generalisation: identical result whenever `frame.primitives` happens to equal `boardOutline`
  // (every existing rectangular-fixture test), a real fix whenever it doesn't.
  if (frame && frame.primitives && frame.primitives.length) {
    // F35 item 5 review: frame.set is an OPTIONAL Frame-only override (Fred's
    // own "frame thickness" = the brick LENGTH across a band) -- defaults to
    // the top-level `set` so every existing caller (nothing passed frame.set
    // before this) is unaffected; Wall's own bricksFillShape call below
    // always keeps the top-level `set`, never this override.
    const frameSet = frame.set || set;
    const res = bricksContourBands(frame.primitives, frame.bands || [], { set: frameSet, seed, scale, bandFit: input.bandFit });
    frameBricks = res.bricks;
    interiorOutline = res.innerPath;
    bandsReduced = res.bandsReduced;
    // T86 item 16e: the fan centre (fan-centre.js); absent / needle = no call, the lay byte-identical
    if (input.fanCentre && input.fanCentre !== FAN_CENTRE_DEFAULT) frameBricks = applyFanCentre(frameBricks, input.fanCentre, { set: scaledSet(frameSet, scale), region: interiorOutline });
    // T86 item 29: the frame crumbles by the SAME rule as the wall (whole pieces, top-weighted, exact count, clumping);
    // off (absent / false / 0) = no call, the lay byte-identical
    if (input.suppressFrame && input.frameSuppression > 0) {
      frameBricks = suppressBricks(frameBricks, { suppression: input.frameSuppression, topBias: input.topBias ?? 0.8, clumping: input.clumping ?? 0.3 },
        seed, scaledSet(frameSet, scale).brickHeightIn);
    }
  }
  // T86 item 29: the inset window's surround (its own field); the wall is cut around it (its outer rect, one joint off)
  const surround = input.insetSurround ? laySurround(input.insetSurround, { set: (frame && frame.set) || set, seed, scale }) : null;
  const wallExclusions = surround ? [...(input.exclusions || []), { polygon: surround.outer }] : input.exclusions;

  const region = wallRegionOf(input.wallRegion, set);
  const bricks = input.skipWallFill ? [] : bricksFillShape(interiorOutline, null, {
    set, seed, scale,
    suppression: input.suppression ?? 0,
    topBias: input.topBias ?? 0.8,
    clumping: input.clumping ?? 0.3,
    zones: input.zones,
    largeStones: input.largeStones,
    rotationDeg: input.rotationDeg,
    rustic: input.rustic,
    accentCuts: input.accentCuts,
    customBond: input.customBond,
    exclusions: wallExclusions,
    region,
  }).bricks;
  // T86 item 13: the app's own stub (editor-brick-tool.js dropExcludedWallBricks) stands down when this is set
  const notes = { ...(bandsReduced ? { bandsReduced } : {}), ...(input.wallRegion ? { wallRegionApplied: true } : {}), ...(surround ? { surroundBricks: surround.bricks } : {}) };
  // F35 item 55: + `interiorOutline` (the wall's fill outline: the frame's innerPath, else the board) -- additive, read by
  // the grout shape (grout-shape.js); every other field is as before
  if (Array.isArray(input.exclusions)) return { bricks, frameBricks, seed, exclusionsApplied: true, ...notes, interiorOutline };
  return { bricks, frameBricks, seed, ...notes, interiorOutline };
}

/** T86 item 18: the wall's region from `input.wallRegion` -- { strokes: [{ points, widthIn }], minus: [...] } (each
 *  NEWER area's strokes; region.js strokesToRegion, the minus grown by the wall set's grout so two areas never butt),
 *  or ready-made { polygons: [{ outer, holes }] } (strokesToRegion's own output). Missing, or no strokes and no
 *  polygons = undefined = the full fill as before. */
export function wallRegionOf(wallRegion, set) {
  if (!wallRegion) return undefined;
  if (Array.isArray(wallRegion.polygons)) return wallRegion.polygons;
  if (!Array.isArray(wallRegion.strokes) || !wallRegion.strokes.length) return undefined;
  // 'clip' keeps two areas a grout apart; 'centroid' partitions bricks exactly (no gap: no brick is cut, none shared)
  const gapIn = WALL_REGION_PICK === 'clip' && set && set.grout ? set.grout.widthIn : 0;
  return strokesToRegion(wallRegion.strokes, wallRegion.minus || [], { gapIn }).polygons;
}

/** A simple grid-bucket spatial index over a brick list, so repeated point queries (a terrain
 *  sampler calls this once per grid point) don't linear-scan every brick. */
export function buildSpatialIndex(bricks, cellSizeIn) {
  const buckets = new Map();
  const key = (bx, by) => `${bx},${by}`;
  for (const b of bricks) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of b.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const bx0 = Math.floor(minX / cellSizeIn), bx1 = Math.floor(maxX / cellSizeIn);
    const by0 = Math.floor(minY / cellSizeIn), by1 = Math.floor(maxY / cellSizeIn);
    for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) {
      const k = key(bx, by);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
  return { query: (x, y) => buckets.get(key(Math.floor(x / cellSizeIn), Math.floor(y / cellSizeIn))) || [] };
}

/**
 * The SECOND, DERIVED output: height at a board-inch point (x,y). Fred: brick relief is in
 * inches, default `set.reliefIn`, NEVER more than `set.reliefMaxIn` -- every brick's own raised
 * top, now a full 3D PROFILE (H23 item 73(c): rounded shoulder + slight crown + chipped corners,
 * `height-profile.js`'s own `brickTopHeight`, declared per set as `set.heightProfile`; a set with
 * no declared profile reduces exactly to the original flat `reliefIn + heightOffset`), is clamped
 * to reliefMaxIn here, the one place every source of height variation funnels through. Falls back
 * to `jointHeightIn` (0 = the groove floor) when the point is in a joint, not inside any brick.
 *
 * @param {(x:number,y:number,brick:object)=>number} [sampleDetailAt] — optional, see
 *   height-profile.js's own header: the adapter's de-lit high-pass sample surface, not built here.
 */
export function sampleHeight(result, index, x, y, set, jointHeightIn = 0, sampleDetailAt) {
  const candidates = index ? index.query(x, y) : [...result.bricks, ...result.frameBricks];
  for (const b of candidates) {
    if (pointInPolygon(x, y, b.polygon)) {
      const raw = brickTopHeight(x, y, b, set, result.seed, sampleDetailAt);
      return Math.max(0, Math.min(set.reliefMaxIn ?? 0.25, raw));
    }
  }
  return jointHeightIn;
}
