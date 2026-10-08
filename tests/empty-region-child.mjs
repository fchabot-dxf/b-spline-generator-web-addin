// Child process for tests/bricks-empty-region.test.js: one lay in a process of its own, so an endless loop is a TIMEOUT
// the test can see (a synchronous loop in the test's own worker can never time out). Reads a JSON job on argv[2]:
//   { kind: 'fill', layout }                       -> bricksFillShape on an EMPTY region with that layout
//   { kind: 'lay', prims, board: [W, H], L, pattern } -> generateBricks with a single soldier frame (no DOM needed)
// and prints { wall: <pieces> } on stdout.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const mod = (p) => import(pathToFileURL(path.join(here, '../bspline-frame-builder/b-spline-gen/html/core/bricks', p)).href);
const job = JSON.parse(process.argv[2]);
const { bricksFillShape } = await mod('fill-shape.js');
const { generateBricks } = await mod('engine.js');
const { BRICK_SETS, BRICK_PATTERNS, FRAME_PRESETS } = await mod('library.js');
const SET = BRICK_SETS[0];
if (job.kind === 'fill') {
  const r = bricksFillShape([], null, { set: { ...SET, layout: job.layout }, scale: 1, seed: 1, suppression: 0, clumping: 0 });
  process.stdout.write(JSON.stringify({ wall: r.bricks.length }));
} else {
  const [W, H] = job.board, scale = job.L / SET.brickLengthIn;
  const input = { boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, scale, seed: 1, suppression: 0, clumping: 0,
    frame: { primitives: job.prims, bands: FRAME_PRESETS.single_soldier } };
  if (BRICK_PATTERNS[job.pattern].kind === 'tile2d') input.set = { ...SET, layout: job.pattern }; else input.zones = [{ pattern: job.pattern }];
  process.stdout.write(JSON.stringify({ wall: generateBricks(input).bricks.length }));
}
