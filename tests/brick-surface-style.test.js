/**
 * F35 item 18 (2): the brick SURFACE STYLE, Clean | Weathered, declared as data
 * (editor/brick-surface-styles.js). Clean = the set's own look, byte-identical to before the style
 * existed. Weathered = worn ragged edges (core/bricks/height-profile.js edgeNoiseIn), uneven tops
 * (per-brick jitter), pitted faces (negative photo detail amplified), deep joints (recessed).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import {
  BRICK_SURFACE_STYLES, surfaceStyleById, styledSet, styledDetail, styleTopJitter,
} from '../bspline-frame-builder/b-spline-gen/html/editor/brick-surface-styles.js';
import { brickTopHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-profile.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SET1 = brickSetById(1);
const WEATHERED = BRICK_SURFACE_STYLES.weathered;

describe('the declared styles', () => {
  it('Clean, unknown and missing ids are all Clean, and Clean changes nothing', () => {
    expect(surfaceStyleById('clean')).toBe(BRICK_SURFACE_STYLES.clean);
    expect(surfaceStyleById(undefined)).toBe(BRICK_SURFACE_STYLES.clean);
    expect(surfaceStyleById('nope')).toBe(BRICK_SURFACE_STYLES.clean);
    expect(styledSet(SET1, BRICK_SURFACE_STYLES.clean)).toBe(SET1);
    const detail = () => -0.5;
    expect(styledDetail(detail, BRICK_SURFACE_STYLES.clean)).toBe(detail);
    expect(styleTopJitter(BRICK_SURFACE_STYLES.clean, 1, 'b1')).toBe(0);
  });

  it("Weathered scales the set's OWN profile, caps the fractions at 1, adds edge wear, leaves the library set alone", () => {
    const before = JSON.stringify(SET1.heightProfile);
    const s = styledSet(SET1, WEATHERED);
    const hp = SET1.heightProfile;
    expect(s.heightProfile.edgeRadiusIn).toBeCloseTo(hp.edgeRadiusIn * WEATHERED.profileScale.edgeRadiusIn, 9);
    expect(s.heightProfile.chipSizeIn).toBeCloseTo(hp.chipSizeIn * WEATHERED.profileScale.chipSizeIn, 9);
    expect(s.heightProfile.chipRate).toBeLessThanOrEqual(1);
    expect(s.heightProfile.surfaceShare).toBeLessThanOrEqual(1);
    expect(s.heightProfile.surfaceShare).toBeGreaterThan(hp.surfaceShare);
    expect(s.heightProfile.edgeNoiseIn).toBe(WEATHERED.profileSet.edgeNoiseIn);
    expect(JSON.stringify(SET1.heightProfile)).toBe(before);
  });

  it('pit contrast amplifies the negative half only', () => {
    const d = styledDetail((x) => x, WEATHERED);
    expect(d(-0.4)).toBeCloseTo(-0.4 * WEATHERED.pitGain, 9);
    expect(d(0.4)).toBe(0.4);
  });

  it('top jitter: seeded per brick, within +/- topJitterIn, and actually varies', () => {
    const vals = Array.from({ length: 40 }, (_, i) => styleTopJitter(WEATHERED, 7, `b${i}`));
    expect(vals.every((v) => Math.abs(v) <= WEATHERED.topJitterIn)).toBe(true);
    expect(new Set(vals.map((v) => v.toFixed(6))).size).toBeGreaterThan(30);
    expect(styleTopJitter(WEATHERED, 7, 'b3')).toBe(vals[3]);
    expect(styleTopJitter(WEATHERED, 8, 'b3')).not.toBe(vals[3]);
  });
});

describe('height-profile edge wear (edgeNoiseIn)', () => {
  const brick = { id: 1, polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0.5 }, { x: 0, y: 0.5 }], heightOffset: 0 };
  const base = { reliefIn: 0.125, heightProfile: { edgeRadiusIn: 0.05, crown: 0, chipRate: 0, chipSizeIn: 0, surfaceShare: 0 } };
  // points 0.03 in from the bottom edge, along its length (inside the shoulder)
  const along = Array.from({ length: 40 }, (_, i) => ({ x: 0.2 + i * 0.04, y: 0.03 }));

  it('absent or 0: exactly the plain shoulder (same height all along the edge)', () => {
    const plain = along.map((p) => brickTopHeight(p.x, p.y, brick, base, 1));
    const zero = along.map((p) => brickTopHeight(p.x, p.y, brick, { ...base, heightProfile: { ...base.heightProfile, edgeNoiseIn: 0, edgeNoiseScaleIn: 0.06 } }, 1));
    expect(zero).toEqual(plain);
    expect(Math.max(...plain) - Math.min(...plain)).toBeLessThan(1e-12);
  });
  it('on: the shoulder line wanders along the edge, never above the full height', () => {
    const worn = { ...base, heightProfile: { ...base.heightProfile, edgeNoiseIn: 0.02, edgeNoiseScaleIn: 0.06 } };
    const h = along.map((p) => brickTopHeight(p.x, p.y, brick, worn, 1));
    expect(Math.max(...h) - Math.min(...h)).toBeGreaterThan(0.01);
    expect(Math.max(...h)).toBeLessThanOrEqual(0.125 + 1e-12);
    // deep inside (past the shoulder + noise) the brick is untouched
    expect(brickTopHeight(1, 0.25, brick, worn, 1)).toBeCloseTo(brickTopHeight(1, 0.25, brick, base, 1), 12);
  });
});

describe('rasterizeBrickHeightMask with a surface style', () => {
  const W = 8, H = 4, NX = 65, NZ = 33; // 0.125 in grid
  function fixture() {
    const root = document.createElement('div');
    const add = (id, pts) => {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      poly.setAttribute('points', pts);
      poly.setAttribute('data-layer', 'L');
      poly.setAttribute(BRICK_GEN_ATTR, '1');
      poly.setAttribute('data-brick-set', '1');
      poly.setAttribute('data-brick-seed', '1');
      poly.setAttribute('data-brick-relief', '0.125');
      poly.setAttribute('data-brick-id', id);
      poly.setAttribute('data-brick', id === 'left' ? 'wall' : 'frame');
      root.appendChild(poly);
    };
    // two bricks with a 0.25 in joint at x = 3.875..4.125
    add('left', '0.5,0.5 3.875,0.5 3.875,3.5 0.5,3.5');
    add('right', '4.125,0.5 7.5,0.5 7.5,3.5 4.125,3.5');
    document.body.appendChild(root);
    return { editor: { _sketchLayer: { node: root } }, layer: { id: 'L', depth: 0.125 }, cleanup: () => root.remove() };
  }
  const run = async (opts, depth) => {
    const f = fixture();
    if (depth !== undefined) f.layer.depth = depth;
    const m = await rasterizeBrickHeightMask(f.editor, f.layer, NX, NZ, W, H, opts);
    f.cleanup();
    return m;
  };
  const K = (x, y) => Math.round((1 - y / H) * (NZ - 1)) * NX + Math.round((x / W) * (NX - 1));

  it('Clean (explicit, unknown, or absent) is byte-identical to no style at all', async () => {
    const none = await run({});
    for (const opts of [{ surfaceStyle: 'clean' }, { surfaceStyle: 'bogus' }]) {
      const m = await run(opts);
      expect(Array.from(m.body)).toEqual(Array.from(none.body));
      expect(Array.from(m.isStamped)).toEqual(Array.from(none.isStamped));
    }
  });

  // turn 181: ONE joint-recess implementation, driven by the grout profile; the style only scales it
  const RECESSED = { groutWidthIn: 0.25, groutProfile: 'recessed', groutDepthIn: 0.05 };
  const joint = K(4, 2), open = K(0.125, 2), inBrick = K(2, 2);

  it('Recessed grout (Clean): the joint goes down by grout depth, the open board is untouched', async () => {
    const flush = await run({ groutWidthIn: 0.25, groutProfile: 'flush', groutDepthIn: 0.05 });
    const r = await run(RECESSED);
    expect(flush.isStamped[joint]).toBe(0);
    expect(r.isStamped[joint]).toBe(1);
    expect(r.body[joint] * 0.125).toBeCloseTo(-0.05, 6);
    expect(r.isStamped[open]).toBe(0);
    expect(r.body[open]).toBe(0);
    expect(r.body[inBrick]).toBe(flush.body[inBrick]); // bricks themselves untouched by the grout setting
  });

  it('Flush = no recess in every style (Weathered included); Weathered still restyles the bricks', async () => {
    const clean = await run({});
    const w = await run({ surfaceStyle: 'weathered', groutWidthIn: 0.25, groutProfile: 'flush', groutDepthIn: 0.05 });
    expect(w.isStamped[joint]).toBe(0);
    expect(w.body[joint]).toBe(0);
    expect(w.body[inBrick]).not.toBe(clean.body[inBrick]);
  });

  it('Weathered + Recessed: grout depth x jointDepthScale', async () => {
    const w = await run({ surfaceStyle: 'weathered', ...RECESSED });
    expect(w.body[joint] * 0.125).toBeCloseTo(-0.05 * WEATHERED.jointDepthScale, 6);
  });

  it('Carved (negative depth): the joint still goes DOWN', async () => {
    const r = await run(RECESSED, -0.125);
    expect(r.body[joint] * -0.125).toBeCloseTo(-0.05, 6);
  });
});

describe('F35 item 16: per-element Level in the height mask', () => {
  const W = 8, H = 4, NX = 65, NZ = 33;
  const K = (x, y) => Math.round((1 - y / H) * (NZ - 1)) * NX + Math.round((x / W) * (NX - 1));
  async function run(opts) {
    const root = document.createElement('div');
    for (const [id, kind, pts] of [['left', 'wall', '0.5,0.5 3.875,0.5 3.875,3.5 0.5,3.5'], ['right', 'frame', '4.125,0.5 7.5,0.5 7.5,3.5 4.125,3.5']]) {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', pts], ['data-layer', 'L'], [BRICK_GEN_ATTR, '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'],
        ['data-brick-relief', '0.125'], ['data-brick-id', id], ['data-brick', kind]]) poly.setAttribute(k, v);
      root.appendChild(poly);
    }
    document.body.appendChild(root);
    const m = await rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, NX, NZ, W, H, opts);
    root.remove();
    return m;
  }
  it('a kind\'s level raises (or lowers) exactly that kind\'s bricks by that many inches', async () => {
    const flat = await run({});
    const lv = await run({ levels: { wall: 0.03, frame: -0.02 } });
    const inWall = K(2, 2), inFrame = K(6, 2);
    expect((lv.body[inWall] - flat.body[inWall]) * 0.125).toBeCloseTo(0.03, 6);
    expect((lv.body[inFrame] - flat.body[inFrame]) * 0.125).toBeCloseTo(-0.02, 6);
  });
  it('no levels (a saved session without the key) = byte-identical', async () => {
    const a = await run({});
    const b = await run({ levels: { wall: 0, frame: 0 } });
    expect(Array.from(b.body)).toEqual(Array.from(a.body));
  });
});
