/**
 * core/bricks/index.js — PORTABLE (see rng.js). The public API surface: the THREE core primitives
 * (Fred's own UI lock: a Brick tab with three tools -- Brush = bricksAlongPath, Wall =
 * bricksFillShape, Frame = bricksContourBands -- see the adapter table in WORK-LOG.md), plus the
 * declared library data and the convenience whole-board composer this project's own preview/tests
 * use.
 */
export { bricksAlongPath } from './along-path.js';
export { bricksFillShape, bricksClearOf } from './fill-shape.js';
export { strokesToRegion } from './region.js'; // T86 item 18: painted strokes -> the wall's region
export { bricksGroutCut, applyGroutCuts } from './grout-cut.js'; // T86 item 10: the Raised brush's grout mode (+ the one shared cut step)
export { LAID_BY_COURSES, minPieceAreaOf } from './piece-floor.js'; // the floor a cut may leave, per laying layout
export { groutShapeOf, groutIdOf, insetFace, pointOnGrout, primitivesOutline, GROUT_ID_SUFFIX } from './grout-shape.js'; // F35 item 55
export { bricksContourBands, bandFrameAt, frameCornerEffect, frameHasFan, CORNER_CUT_STYLES } from './contour-bands.js';
export { FAN_CENTRES, FAN_CENTRE_DEFAULT, FAN_MIN_TIP_OF_HEIGHT, fanCentreStyle, fanGroups } from './fan-centre.js'; // T86 item 16e
// T86 item 2: `ribbonPieces` itself -- the per-row primitive `bricksContourBands` already calls
// internally, now exported directly too (sequence/forcedFStart params included) for a consumer that
// needs one row's own exact geometry without the whole band/depth-stacking wrapper.
export { ribbonPieces } from './primitive-ribbon.js';
export { generateBricks, buildSpatialIndex, sampleHeight, ENGINE_OPTIONS } from './engine.js';
export { brickTopHeight } from './height-profile.js';
export { PIECE_CATALOGUE, BRICK_SETS, FRAME_PRESETS, BRUSH_PRESETS, brickSetById, enabledPieces, scaledSet } from './library.js';
export { pointInPolygon, polygonCentroid, rectPolygon, offsetPathInward, inwardSignFor, clipToHalfPlane, roundPolygonCorners } from './geometry.js';
export { mulberry32, seedFor, hashedRandom } from './rng.js';
