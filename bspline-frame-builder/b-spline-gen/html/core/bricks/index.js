/**
 * core/bricks/index.js — PORTABLE (see rng.js). The public API surface: the THREE core primitives
 * (Fred's own UI lock: a Brick tab with three tools -- Brush = bricksAlongPath, Wall =
 * bricksFillShape, Frame = bricksContourBands -- see the adapter table in WORK-LOG.md), plus the
 * declared library data and the convenience whole-board composer this project's own preview/tests
 * use.
 */
export { bricksAlongPath } from './along-path.js';
export { bricksFillShape } from './fill-shape.js';
export { bricksContourBands, bandFrameAt } from './contour-bands.js';
export { generateBricks, buildSpatialIndex, sampleHeight } from './engine.js';
export { brickTopHeight } from './height-profile.js';
export { PIECE_CATALOGUE, BRICK_SETS, FRAME_PRESETS, brickSetById, enabledPieces, scaledSet } from './library.js';
export { pointInPolygon, polygonCentroid, rectPolygon, offsetPathInward, inwardSignFor, clipToHalfPlane, roundPolygonCorners } from './geometry.js';
export { mulberry32, seedFor, hashedRandom } from './rng.js';
