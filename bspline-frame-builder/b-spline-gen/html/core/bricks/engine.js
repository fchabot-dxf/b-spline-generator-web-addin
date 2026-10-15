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
import { bricksFillShape, bricksClearOf } from './fill-shape.js';
import { strokesToRegion, WALL_REGION_PICK } from './region.js';
import { bricksContourBands, setBandPattern, clipPiecesToBoard } from './contour-bands.js';
import { frameLaidBy, minPieceAreaOf } from './piece-floor.js';
import { pointInPolygon, polygonIntersection, polygonDifference, signedArea, offsetPathInward, inwardSignFor } from './geometry.js';
/** a quoin reaches into the wall's region past this much overlap (sq in; contour-bands' own MEDIAL_OVERLAP_SQIN) */
const QUOIN_REACH_SQIN = 1e-4;
import { brickTopHeight } from './height-profile.js';
import { suppressBricks } from './suppression.js';
import { laySurround } from './inset-surround.js';
import { layArch } from './arch-surround.js';
import { bareTips } from './tip-fill.js';
import { isPartCellId, CELL_PART } from './cell-parts.js';
import { scaledSet, BRICK_PATTERNS } from './library.js';
import { applyGroutCuts, groutCutsOf } from './grout-cut.js';
import { applyFanCentre, FAN_CENTRE_DEFAULT } from './fan-centre.js';
import { insideReliefOf, tagInsideRelief } from './band-motif.js'; // frame motifs: a band's relief for the wall inside it

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
  'groutCut', // T86 item 10: [{ polyline, widthIn? }] -- grout joints cut through the laid pieces (grout-cut.js), after the lay
  'arch', // 2026-10-11: { spec } -- a blind arch conforming to the frame (arch-surround.js layArch): the wall is cleared off it and fills its opening
  'fanCentre', // T86 item 16e: how a frame corner's fan ends at its centre (fan-centre.js FAN_CENTRES); absent = needle
]);

const boxOf = (p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
const overlapsMoreThan = (a, b, sqIn) => { const A = boxOf(a), B = boxOf(b); return !(A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) && Math.abs(signedArea(polygonIntersection(a, b)) || 0) > sqIn; };

export function generateBricks(input) {
  const { boardOutline, set, frame, seed, scale } = input;

  let interiorOutline = boardOutline;
  let frameBoard = null; // the frame's own board outline (contour-bands `board`): the wall is clipped to it below
  let frameBricks = [];
  let bandsReduced; // T86 item 28: contour-bands' fit-rule note, when the requested stack did not fit
  let frameLay = null;
  let frameBlocksSkipped = null; // Fred 2026-10-15: mid-course blocks that placed nothing (frame-blocks.js), a note // T86 item 16f: how the frame was laid, to lay it again into the wall's bare tips
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
    // T86 (seat E, MEASURED: a lay with a bare tip laid the frame twice, the second lay as long as the first): the frame is
    // PLANNED here (its bands, the fit rule, the wall's inner path -- no pieces) and laid ONCE below, after the wall, with the
    // wall's bare tips (item 16f) when it has any. The inner path is the plan's own (contour-bands opts.planOnly).
    const plan = bricksContourBands(frame.primitives, frame.bands || [], { set: frameSet, seed, scale, bandFit: input.bandFit, planOnly: true });
    interiorOutline = plan.innerPath;
    frameBoard = plan.board || null;
    bandsReduced = plan.bandsReduced;
    frameLay = { frameSet, bands: frame.bands || [] };
  }
  // T86 item 29: the inset window's surround (its own field); the wall is cut around it (its outer rect, one joint off)
  const surround = input.insetSurround ? laySurround(input.insetSurround, { set: (frame && frame.set) || set, seed, scale }) : null;
  // 2026-10-11: the arch (a frame preset's `arch`): an inner band stack on the frame's own contour, inside its bands (Fred:
  // it always conforms to the frame); the wall is cleared off it and fills its opening (below). Absent = the lay byte-identical
  const archLay = input.arch && frameLay ? layArch(input.arch.spec, frame.primitives, frameLay.bands, { set: frameLay.frameSet, seed, scale }) : null;
  const arch = archLay && !archLay.fit ? archLay : null;
  const wallExclusions = surround ? [...(input.exclusions || []), { polygon: surround.outer }] : input.exclusions;

  const region = wallRegionOf(input.wallRegion, set);
  let laidWall = input.skipWallFill ? [] : bricksFillShape(interiorOutline, null, {
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
  // the arch starts at the frame's inner edge (Fred: no inward offset), so no wall is left outside it: the wall is laid
  // inside its opening only (its own courses, as a blind arch is built)
  if (arch) laidWall = [];
  // ... cleared off the arch's own pieces (a band's corner pieces can reach past its nominal depth at a tight concave
  // turn: T5's dip, MEASURED) by the quoin rule -- a joint off, every cut piece kept (fill-shape.js bricksClearOf)
  const openingWall = arch && !input.skipWallFill ? bricksClearOf(bricksFillShape(arch.opening, null, {
    set, seed, scale, suppression: input.suppression ?? 0, topBias: input.topBias ?? 0.8, clumping: input.clumping ?? 0.3,
    rotationDeg: input.rotationDeg, rustic: input.rustic, customBond: input.customBond, exclusions: input.exclusions,
  }).bricks, arch.pieces.map((b) => ({ polygon: b.polygon })), scaledSet(set, scale)) : [];
  if (openingWall.length) laidWall = [...laidWall, ...openingWall];
  // the wall is never laid off the board (seat E, 2026-10-08, the gap sweep): its region is clipped to the board
  // (primitive-ribbon.js wallRegionAtDepth), and its pieces are cut to the board by the band's own step, dropping under the
  // wall set's floor -- a region inverted at 2 - 8 in can still hand the fill a zero-width bridge it lays whole bricks across
  const bricks = frameBoard && laidWall.length ? clipPiecesToBoard(laidWall, frameBoard, minPieceAreaOf(scaledSet(set, scale))) : laidWall;
  // T86 item 10 (the Raised brush's Grout mode): each cut polyline opens a joint through the laid pieces AFTER the lay --
  // the wall at the wall set's joint, the frame (and the window surround) at the frame set's, unless the cut declares
  // its own width; a piece under the quarter-brick floor of its element drops into the joint. No cut = as before.
  const cuts = groutCutsOf(input.groutCut);
  const cutAll = (pieces, s, laidBy) => applyGroutCuts(pieces, cuts, s, scale, laidBy); // the one shared cut step (grout-cut.js)
  const cutWall = cutAll(bricks, set);
  // frame motifs (the recessed panel): a frame band may declare the wall inside it raised / recessed (`insideRelief`); none = as before
  const insideRelief = frameLay ? insideReliefOf(frameLay.bands) : null;
  // (let: the quoins that reach into the wall clear it below -- bricksClearOf keeps each piece's tags)
  let wallBricks = insideRelief ? tagInsideRelief(cutWall, insideRelief) : cutWall;
  const frameSetUsed = (frame && frame.set) || set;
  // the bands' pieces drop under the floor of the layout that laid them (a Grey stone ring: fieldstone; piece-floor.js)
  const surroundBricks = surround ? cutAll(surround.bricks, frameSetUsed, frameLaidBy(frameSetUsed, setBandPattern)) : null;
  const archBricks = arch ? cutAll(arch.pieces, frameSetUsed) : null;
  // T86 item 16f (B1): the wall region's acute tips (>= TIP_FILL_MIN_DEG) the wall leaves bare are the band's -- the frame's
  // innermost row reaches into what the wall leaves uncovered (a joint off every wall brick; the wall itself is untouched)
  // the wall's smallest whole piece: a header when any of its patterns lays headers (library.js smallestFace), else a stretcher --
  // a tip's course front reads it (tip-fill.js bareTips)
  const wallSet = scaledSet(set, scale), wallPatterns = [set.layout, ...(input.zones || []).map((z) => z && z.pattern)].filter(Boolean);
  const wholeFaceSqIn = wallPatterns.some((p) => BRICK_PATTERNS[p] && BRICK_PATTERNS[p].smallestFace === 'header') ? wallSet.brickHeightIn * wallSet.brickHeightIn : undefined;
  // read off today's pieces only (cell-parts.js: an added part never moves the frame -- a bond's tips are the band's)
  const todays = bricks.filter((b) => !isPartCellId(b.id));
  const tips = frameLay && frameLay.bands.length && todays.length ? bareTips(interiorOutline, todays, wallSet, { wholeFaceSqIn }) : [];
  if (frameLay) {
    const laidFrame = bricksContourBands(frame.primitives, frameLay.bands, { set: frameLay.frameSet, seed, scale, bandFit: input.bandFit, ...(tips.length ? { tipZones: tips } : {}),
      ...(frame.blocks && frame.blocks.length ? { blocks: frame.blocks } : {}) }); // Fred 2026-10-15: mid-course blocks (frame-blocks.js)
    frameBricks = laidFrame.bricks;
    frameBlocksSkipped = laidFrame.blocksSkipped || null; // a block that placed nothing, and why (frame-blocks.js)
    // an added wall part (cell-parts.js) is cut clear of the band (a joint off: a tip the band took, a piece reaching past the
    // stack -- MEASURED T10 7x9 1 in herringbone, 0.001 sq in under a fan slice), the id kept; a fleck left of it drops
    const J = wallSet.grout.widthIn;
    wallBricks = wallBricks.flatMap((b) => {
      if (!isPartCellId(b.id)) return [b];
      let poly = b.polygon;
      for (const fb of frameBricks) {
        if (!poly || !overlapsMoreThan(poly, fb.polygon, 1e-6)) continue;
        poly = (polygonDifference(poly, offsetPathInward(fb.polygon, J, -inwardSignFor(fb.polygon))) || []).filter((p) => p && p.length >= 3)
          .sort((p, q) => Math.abs(signedArea(q)) - Math.abs(signedArea(p)))[0] || null;
      }
      return poly && Math.abs(signedArea(poly)) > CELL_PART.minSqIn ? [poly === b.polygon ? b : { ...b, polygon: poly }] : [];
    });
    // seat E 2026-10-10 (Fred's "Armor"; advisor's pick A): a quoin is a 1.1 in block, deeper than a thin band stack (two
    // stretcher bands at 1 in: 0.55 in), so it reaches past the stack into the wall's region -- the wall was laid under it
    // and the frame's grout (its hole = this region) painted it dark. The quoins that reach in come out of the region
    // (grown by the wall's joint) -- ONE source, interiorOutline, which the grout reads -- and the wall is cut clear of
    // them by its own exclusion rule (fill-shape.js bricksClearOf, a joint off), every cut piece kept as the fill keeps
    // a piece cut at any region edge (bond.js: no area floor there). MEASURED alternatives, both worse: a floor on the
    // cut pieces with their remnants merged into a neighbour made ragged pieces (a two-brick M across a gable top, T11
    // 9x12 3/4 in); filling the wall again into the new outline re-aligned every course and dropped a gable's flank
    // triangle (0.038 sq in bare). A quoin inside the stack changes nothing.
    // ... or that a laid wall brick overlaps: the region test alone misses a curved block's wedge against a concave region
    // (MEASURED T18 7x9 1 in, a mid-course block on the arched head: the clip came back empty, 7 wall bricks under it)
    const reaching = (laidFrame.quoins || []).filter((q) => Math.abs(signedArea(polygonIntersection(q, interiorOutline)) || 0) > QUOIN_REACH_SQIN
      || wallBricks.some((w) => overlapsMoreThan(q, w.polygon, QUOIN_REACH_SQIN)));
    if (reaching.length) {
      const J = scaledSet(set, scale).grout.widthIn;
      const largest = (parts) => (parts && !parts.holeIgnored ? parts : []).filter((p) => p && p.length >= 3).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0] || null;
      for (const q of reaching) interiorOutline = largest(polygonDifference(interiorOutline, offsetPathInward(q, J, -inwardSignFor(q)))) || interiorOutline;
      wallBricks = bricksClearOf(wallBricks, reaching.map((polygon) => ({ polygon })), scaledSet(set, scale));
    }
  }
  // T86 item 16e: the fan centre (fan-centre.js), on the frame as finally laid; absent / needle = no call, the lay byte-identical
  if (frameLay && input.fanCentre && input.fanCentre !== FAN_CENTRE_DEFAULT) {
    frameBricks = applyFanCentre(frameBricks, input.fanCentre, { set: scaledSet(frameLay.frameSet, scale), region: interiorOutline });
  }
  // T86 item 10: the grout cuts on the frame's ONE lay (after the tip re-lay and the fan centre, before the crumble, so the
  // crumble picks among the cut pieces)
  if (frameLay) frameBricks = cutAll(frameBricks, frameLay.frameSet, frameLaidBy(frameLay.frameSet, setBandPattern));
  // T86 item 29: the frame crumbles by the SAME rule as the wall (whole pieces, top-weighted, exact count, clumping);
  // off (absent / false / 0) = no call, the lay byte-identical
  if (frameLay && input.suppressFrame && input.frameSuppression > 0) {
    frameBricks = suppressBricks(frameBricks, { suppression: input.frameSuppression, topBias: input.topBias ?? 0.8, clumping: input.clumping ?? 0.3 },
      seed, scaledSet(frameLay.frameSet, scale).brickHeightIn);
  }
  // T86 item 13: the app's own stub (editor-brick-tool.js dropExcludedWallBricks) stands down when this is set
  const notes = { ...(bandsReduced ? { bandsReduced } : {}), ...(input.wallRegion ? { wallRegionApplied: true } : {}), ...(surround ? { surroundBricks } : {}),
    ...(arch ? { archBricks, archRegion: arch.region, archOpening: arch.opening, archStep: arch.step } : {}), ...(archLay && archLay.fit ? { archFit: archLay.fit } : {}),
    ...(cuts.length ? { groutCutApplied: cuts.length } : {}), ...(frameBlocksSkipped ? { blocksSkipped: frameBlocksSkipped } : {}) };
  // F35 item 55: + `interiorOutline` (the wall's fill outline: the frame's innerPath, else the board) -- additive, read by
  // the grout shape (grout-shape.js); every other field is as before
  if (Array.isArray(input.exclusions)) return { bricks: wallBricks, frameBricks, seed, exclusionsApplied: true, ...notes, interiorOutline };
  return { bricks: wallBricks, frameBricks, seed, ...notes, interiorOutline };
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
  // query(x, y): the bricks that can contain (x, y) -- its bucket's bricks, in order, whose box padded by more than
  // pointInPolygon's on-edge distance (1e-9 in) holds the point. Every caller tests containment (first match), and a
  // point outside that box is neither inside nor on an edge, so the answers are the same. MEASURED 2026-10-08 (phone
  // 4x, a laid wall + frame band): the brick height mask's per-point pointInPolygon rejections were most of each
  // rebuild (0.7 - 3.3 s); numeric bucket keys too (a string per query).
  const PAD = 1e-8;
  const buckets = new Map();
  const key = (bx, by) => (bx + 32768) * 65536 + (by + 32768);
  for (const b of bricks) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of b.polygon) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const entry = { b, x0: minX - PAD, x1: maxX + PAD, y0: minY - PAD, y1: maxY + PAD };
    const bx0 = Math.floor(minX / cellSizeIn), bx1 = Math.floor(maxX / cellSizeIn);
    const by0 = Math.floor(minY / cellSizeIn), by1 = Math.floor(maxY / cellSizeIn);
    for (let bx = bx0; bx <= bx1; bx++) for (let by = by0; by <= by1; by++) {
      const k = key(bx, by);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(entry);
    }
  }
  return {
    query: (x, y) => {
      const list = buckets.get(key(Math.floor(x / cellSizeIn), Math.floor(y / cellSizeIn)));
      const out = [];
      if (list) for (const e of list) if (x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1) out.push(e.b);
      return out;
    },
  };
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
