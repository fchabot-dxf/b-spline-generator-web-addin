/**
 * Fred 2026-10-11 ("yes, build it", the ridge mock in shots/seatE/ridge): a motif declaring raisedTop 'flat' + joinRaised
 * (library.js BAND_MOTIFS zigzag / diaper) lays its raised pieces as FLAT plateaus at the declared level, and the joints
 * between two raised neighbours are filled, so a V arm reads as one ridge (band-motif.js tagMotifRow -> drawBrick's
 * attributes -> editor-brick-height-mask.js). Every other motif lays and carves byte-identically.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { rasterizeBrickHeightMask, brickFaceHeight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import * as tool from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, BAND_MOTIFS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const W = 7, H = 10, SET = BRICK_SETS[0];
const RIDGE = ['zigzag_band', 'diaper_lattice'];
const OTHERS = ['dentil_corbel', 'recessed_panel', 'soldier_string', 'dentil_cornice'];
// the app's recessed grout, so a plain joint is cut down and a joined one visibly is not
const GROUT = { groutProfile: 'recessed', groutDepthIn: 0.05 };

const lay = (preset) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1,
  scale: 1.25 / SET.brickLengthIn, suppression: 0, clumping: 0,
  frame: { primitives: tool.buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H })), bands: FRAME_PRESETS[preset] } }).frameBricks;

/** the laid frame written as drawBrick writes it (its attributes, the raised look's two included when exported) */
function fixture(bricks) {
  const root = document.createElement('div');
  bricks.forEach((b, k) => {
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', b.polygon.map((p) => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('data-layer', 'L');
    poly.setAttribute(tool.BRICK_GEN_ATTR, '1');
    poly.setAttribute('data-brick', 'frame');
    poly.setAttribute('data-brick-set', '1');
    poly.setAttribute('data-brick-seed', '1');
    poly.setAttribute('data-brick-id', `p${k}`);
    poly.setAttribute('data-brick-height-offset', String(b.heightOffset || 0));
    if (b.topFlat && tool.BRICK_TOP_FLAT_ATTR) poly.setAttribute(tool.BRICK_TOP_FLAT_ATTR, '1');
    if (b.joinRaised && tool.BRICK_JOIN_RAISED_ATTR) poly.setAttribute(tool.BRICK_JOIN_RAISED_ATTR, '1');
    root.appendChild(poly);
  });
  document.body.appendChild(root);
  return { editor: { _sketchLayer: { node: root } }, cleanup: () => root.remove() };
}
async function mask(bricks, nx, nz) {
  const f = fixture(bricks);
  try { return await rasterizeBrickHeightMask(f.editor, { id: 'L' }, nx, nz, W, H, GROUT); } finally { f.cleanup(); }
}
const pt = (m, i, j) => ({ x: (i / (m.nx - 1)) * W, y: H * (1 - j / (m.nz - 1)) });

describe('the ridge look is declared data', () => {
  it('zigzag and diaper declare a flat raised top joined to its raised neighbours; no other motif does', () => {
    for (const [id, m] of Object.entries(BAND_MOTIFS)) {
      const ridge = id === 'zigzag' || id === 'diaper';
      expect([m.raisedTop, m.joinRaised], id).toEqual(ridge ? ['flat', true] : [undefined, undefined]);
    }
  });
  it('the lay carries it on exactly the raised pieces of those motifs', () => {
    for (const preset of RIDGE) {
      const bricks = lay(preset);
      const raised = bricks.filter((b) => b.relief === 'raised');
      expect(raised.length, preset).toBeGreaterThan(20);
      expect(raised.every((b) => b.topFlat === true && b.joinRaised === true), preset).toBe(true);
      expect(bricks.filter((b) => b.relief !== 'raised').some((b) => 'topFlat' in b || 'joinRaised' in b), preset).toBe(false);
    }
    for (const preset of OTHERS) expect(lay(preset).some((b) => 'topFlat' in b || 'joinRaised' in b), preset).toBe(false);
  });
});

describe('the height mask: flat plateaus, one ridge', () => {
  it('a raised piece\'s top is flat at the declared level (reliefIn + its heightOffset, within the cap) everywhere inside it', async () => {
    for (const preset of RIDGE) {
      const bricks = lay(preset);
      const m = await mask(bricks, 141, 201);
      let checked = 0, off = 0;
      for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) {
        const { x, y } = pt(m, i, j);
        const b = bricks.find((p) => pointInPolygon(x, y, p.polygon));
        if (!b || b.relief !== 'raised') continue;
        const level = Math.min(SET.reliefMaxIn, SET.reliefIn + (b.heightOffset || 0));
        checked++;
        if (Math.abs(m.body[j * m.nx + i] * SET.reliefIn - level) > 1e-6) off++;
      }
      expect(checked, preset).toBeGreaterThan(1000);
      expect(off, preset).toBe(0);
    }
  });
  it('a joint between raised neighbours is filled to their lower face; a joint touching any other piece stays cut', async () => {
    const reach = SET.grout.widthIn;
    for (const preset of RIDGE) {
      const bricks = lay(preset);
      const m = await mask(bricks, 281, 401);
      const cut = -GROUT.groutDepthIn / SET.reliefIn;
      let joined = 0, joinedWrong = 0, plain = 0, plainWrong = 0;
      for (let j = 0; j < m.nz; j++) for (let i = 0; i < m.nx; i++) {
        const { x, y } = pt(m, i, j);
        if (bricks.some((p) => pointInPolygon(x, y, p.polygon))) continue;
        const hits = [[x + reach, y], [x - reach, y], [x, y + reach], [x, y - reach]]
          .map(([px, py]) => bricks.find((p) => pointInPolygon(px, py, p.polygon))).filter(Boolean);
        if (!hits.length) continue;
        const v = m.body[j * m.nx + i];
        if (hits.every((b) => b.relief === 'raised') && new Set(hits).size >= 2) {
          joined++;
          const low = Math.min(...hits.map((b) => brickFaceHeight(b, SET))) / SET.reliefIn;
          if (Math.abs(v - low) > 1e-6) joinedWrong++; // the body is a Float32Array
        } else if (hits.some((b) => b.relief !== 'raised')) {
          plain++;
          if (Math.abs(v - cut) > 1e-6) plainWrong++;
        }
      }
      expect(joined, preset).toBeGreaterThan(200);
      expect(plain, preset).toBeGreaterThan(200);
      expect({ joinedWrong, plainWrong }, preset).toEqual({ joinedWrong: 0, plainWrong: 0 });
    }
  });
});

describe('every other motif is byte-identical', () => {
  // golden hashes taken on the tree before the ridge (origin/main 63a41f5's code): the lay's polygons + offsets, and the mask
  const GOLDEN = {
    dentil_corbel: { lay: '27b4b921916da540', mask: 'e6d16efd7ce56d01' },
    recessed_panel: { lay: '6865febcdf3653b6', mask: '2d22abdaf8c27097' },
    soldier_string: { lay: '5d2e3cd1a461e5bd', mask: 'a48816ff4e42e988' },
    dentil_cornice: { lay: '86be0f14e8111957', mask: '3af60aeab6a295a6' },
  };
  const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
  it.each(OTHERS)('%s', async (preset) => {
    const bricks = lay(preset);
    const m = await mask(bricks, 71, 101);
    const got = { lay: sha(JSON.stringify(bricks)), mask: sha(Buffer.from(m.body.buffer)) };
    if (process.env.PRINT_GOLDEN) console.log('GOLDEN', preset, JSON.stringify(got));
    expect(got).toEqual(GOLDEN[preset]);
  });
});
