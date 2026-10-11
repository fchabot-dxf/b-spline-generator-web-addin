/**
 * 2026-10-11 (Fred approved the advisor's mock "Rowlock arch + keystone"): the frame preset 'arch_keystone' -- a mitred
 * stretcher course at the border and, inside it, a BLIND arch (core/bricks/arch-surround.js): two rowlock rings carried
 * down the jambs, a raised hood, a stone keystone and springers, a header sill with stone blocks; the wall cut around it
 * and laid again in its opening.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { layArch, archPlacement, run, ARCH_SPECS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arch-surround.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { FRAME_PRESETS, brickSetById, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { polygonsOverlap, buildRibbonPrimitives, frameArchOf, brickLayInput } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const RED = brickSetById(1);
const SCALE = 1 / 0.75; // the 1 in size chip (Red Brick is declared 0.75 in long): the preset's bestSize
const rectPoly = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const rectPrims = (W, H) => [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([a, b, c, d]) => ({ type: 'line', p0: { x: a, y: b }, p1: { x: c, y: d } }));
const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const t1Prims = () => {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
};
const lay = (primitives) => generateBricks({ boardOutline: rectPoly(0, 0, 7, 10), set: RED, scale: SCALE, seed: 3,
  frame: { primitives, bands: [...FRAME_PRESETS.arch_keystone] }, arch: { spec: FRAME_PRESETS.arch_keystone.arch } });

describe('the declaration', () => {
  it("'arch_keystone': one mitred stretcher course, the arch, best at 1 in -- the band list itself unchanged", () => {
    expect([...FRAME_PRESETS.arch_keystone]).toEqual([{ widthIn: 0.2, pattern: 'stretcher' }]);
    expect([FRAME_PRESETS.arch_keystone.arch, FRAME_PRESETS.arch_keystone.bestSize]).toEqual(['rowlock_keystone', 1]);
    expect(JSON.stringify(FRAME_PRESETS.arch_keystone)).toBe('[{"widthIn":0.2,"pattern":"stretcher"}]');
    expect(frameArchOf({ frameBandPreset: 'arch_keystone' })).toBe('rowlock_keystone');
    expect(frameArchOf({ frameBandPreset: 'single_soldier' })).toBe(null);
  });
  it('a header run: whole pieces, or staggered with half pieces at both ends; joints J between', () => {
    const plain = run(0, 3, 0.4, 0.05, false), stag = run(0, 3, 0.4, 0.05, true);
    expect(plain[0].a).toBe(0); expect(plain[plain.length - 1].b).toBe(3);
    for (const r of [plain, stag]) for (let i = 1; i < r.length; i++) expect(r[i].a - r[i - 1].b).toBeCloseTo(0.05, 9);
    expect(stag.length).toBe(plain.length + 1);
    expect(stag[0].b - stag[0].a).toBeCloseTo((plain[0].b - plain[0].a) / 2 - 0.025, 9);
  });
});

describe('the arch on a 7 x 10 board (the mock)', () => {
  const res = lay(rectPrims(7, 10));
  const pieces = res.archBricks;
  const parts = (p) => pieces.filter((b) => b.part === p);
  it('every part, in its own set: stone keystone / springers / sill blocks, the rest the frame set', () => {
    const counts = Object.fromEntries(['keystone', 'springer', 'ring', 'hood', 'jamb', 'sill', 'sillBlock'].map((p) => [p, parts(p).length]));
    expect(counts).toMatchObject({ keystone: 1, springer: 2, sillBlock: 2 });
    for (const p of ['ring', 'hood', 'jamb', 'sill']) expect(counts[p]).toBeGreaterThan(3);
    for (const b of pieces) expect(b.setId).toBe(['keystone', 'springer', 'sillBlock'].includes(b.part) ? 6 : undefined);
  });
  it('the hood stands proud (its declared level); the rest at the brick height', () => {
    const lvl = ARCH_SPECS.rowlock_keystone.hoodLevelIn;
    for (const b of parts('hood')) expect(b.heightOffset).toBeCloseTo(lvl, 1);
    for (const b of parts('ring')) expect(Math.abs(b.heightOffset)).toBeLessThan(lvl / 2);
  });
  it('no two arch pieces overlap; none is inside the opening; all inside the outer outline', () => {
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) expect(polygonsOverlap(pieces[i].polygon, pieces[j].polygon)).toBe(false);
    for (const b of pieces) {
      const c = centroid(b.polygon);
      expect(pointInPolygon(c.x, c.y, res.archOpening)).toBe(false);
      if (b.part !== 'keystone') expect(pointInPolygon(c.x, c.y, res.archOuter)).toBe(true); // the keystone stands past the hood
    }
  });
  it('the piers are laid whole: the bond is centred on the arch, the jambs on its head joints (no dropped slivers)', () => {
    // the outer outline ends with the jambs' four corners: right top, right bottom, left bottom, left top (arch-surround.js)
    const [rTop, rBot, , lTop] = res.archOuter.slice(-4);
    const xs = res.interiorOutline.map((p) => p.x), left = Math.min(...xs), right = Math.max(...xs);
    const area = (poly) => Math.abs(poly.reduce((acc, p, i) => { const q = poly[(i + 1) % poly.length]; return acc + p.x * q.y - q.x * p.y; }, 0) / 2);
    const y0 = rTop.y + 0.6, y1 = rBot.y - 0.6, cover = [];
    for (const [a, b] of [[left, lTop.x], [rTop.x, right]]) {
      const laid = res.bricks.filter((w) => { const c = centroid(w.polygon); return c.x > a && c.x < b && c.y > y0 && c.y < y1; }).reduce((acc, w) => acc + area(w.polygon), 0);
      cover.push(laid / ((b - a) * (y1 - y0)));
    }
    // MEASURED (seed 3, 7 x 10): 0.785 / 0.807 as built; the bond on the interior's own edge 0.732 on the left (a sliver
    // column dropped); the jambs off the head joints 0.760 both -- the joints alone leave ~0.8 of a running-bond strip
    for (const c of cover) expect(c).toBeGreaterThan(0.77);
  });
  it('the wall: around the arch (no overlap) and laid again in its opening', () => {
    for (const w of res.bricks) for (const a of pieces) expect(polygonsOverlap(w.polygon, a.polygon)).toBe(false);
    const inOpening = res.bricks.filter((w) => { const c = centroid(w.polygon); return pointInPolygon(c.x, c.y, res.archOpening); });
    const outside = res.bricks.filter((w) => { const c = centroid(w.polygon); return !pointInPolygon(c.x, c.y, res.archOuter); });
    expect(inOpening.length).toBeGreaterThan(40);
    expect(outside.length).toBeGreaterThan(40); // the spandrels and the piers
  });
});

describe('fit (any template)', () => {
  it('a wide, short interior: the arch is no taller than it -- its jambs at least one course over the sill', () => {
    const s = scaledSet(RED, SCALE);
    let laid = 0;
    for (const h of [3.5, 4, 5]) {
      const pl = archPlacement(rectPoly(0.3, 0.3, 8.7, 0.3 + h), ARCH_SPECS.rowlock_keystone, s);
      if (pl.fit) continue;
      laid++;
      expect(pl.yBot - pl.yc).toBeGreaterThanOrEqual(s.brickHeightIn - 1e-9);
    }
    expect(laid).toBeGreaterThan(0);
  });
  it('T1 hourglass 7 x 9: the arch fits the waist -- every piece inside the wall interior', () => {
    const res = lay(t1Prims());
    expect(res.archFit).toBeUndefined();
    expect(res.archBricks.length).toBeGreaterThan(40);
    for (const b of res.archBricks) for (const p of b.polygon) expect(pointInPolygon(p.x, p.y, res.interiorOutline)).toBe(true);
  });
  it("too narrow for a 2-brick opening: no arch ('archTooNarrow'), the wall as without it", () => {
    const narrow = rectPrims(2.4, 10);
    const res = lay(narrow);
    expect(res.archFit).toBe('archTooNarrow');
    expect(res.archBricks).toBeUndefined();
    const plain = generateBricks({ boardOutline: rectPoly(0, 0, 2.4, 10), set: RED, scale: SCALE, seed: 3, frame: { primitives: narrow, bands: [...FRAME_PRESETS.arch_keystone] } });
    expect(JSON.stringify(res.bricks)).toBe(JSON.stringify(plain.bricks));
  });
  it('the placement is the interior\'s: centred, a pier from the narrowest span, the sill on the bottom', () => {
    const s = scaledSet(RED, SCALE);
    const pl = archPlacement(rectPoly(0.3, 0.3, 6.7, 9.7), ARCH_SPECS.rowlock_keystone, s);
    expect(pl.cx).toBeCloseTo(3.5, 9);
    // the jambs a pier in at most, snapped inward to a head joint of the bond centred on the arch (a half-brick step)
    const face = pl.cx + pl.ri + pl.D, h = (s.brickLengthIn + s.grout.widthIn) / 2;
    expect(face).toBeLessThanOrEqual(6.7 - ARCH_SPECS.rowlock_keystone.pierIn + 1e-9);
    expect(face).toBeGreaterThan(6.7 - ARCH_SPECS.rowlock_keystone.pierIn - h);
    const steps = (face + s.grout.widthIn - pl.cx) / h;
    expect(steps).toBeCloseTo(Math.round(steps), 9);
    expect(pl.yFloor).toBeCloseTo(9.7 - s.grout.widthIn / 2, 9);
  });
});

describe('the editor sends the arch only with the Frame element', () => {
  const editor = { _mW: 7, _mH: 10, _sketchLayer: { node: { querySelectorAll: () => [], querySelector: () => null } }, _layers: [] };
  const geom = (bands) => ({ primitives: rectPrims(7, 10), bands, insetRect: null });
  it('arch_keystone with its bands -> input.arch; no bands (no Frame element) or another preset -> absent', () => {
    const settings = { frameBandPreset: 'arch_keystone', seed: 1, setId: 1, brickLengthIn: 1 };
    expect(brickLayInput(editor, settings, geom([...FRAME_PRESETS.arch_keystone])).arch).toEqual({ spec: 'rowlock_keystone' });
    expect(brickLayInput(editor, settings, geom([])).arch).toBeUndefined();
    expect(brickLayInput(editor, { ...settings, frameBandPreset: 'single_soldier' }, geom([...FRAME_PRESETS.single_soldier])).arch).toBeUndefined();
  });
});
