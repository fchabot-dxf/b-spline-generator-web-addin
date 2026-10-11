/**
 * 2026-10-11 (Fred approved the advisor's mock "Rowlock arch + keystone"; then "the arch must ALWAYS CONFORM to the wood
 * frame's shape" -- "If I want a semicircle I'll form the frame into one" -- and "no inward offset"): the frame preset
 * 'arch_keystone' -- a mitred stretcher course at the border and, directly inside it, a BLIND arch laid as an inner band
 * stack on the frame's own contour (core/bricks/arch-surround.js): a raised hood, two rowlock rings, a raised stone
 * keystone, stone springers and sill blocks; the wall laid inside its opening. Fred's ladder (shrink to fit, skip with
 * a hint): full stack -> no hood -> one ring -> no arch + the Frame note.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import * as ARCH from '../bspline-frame-builder/b-spline-gen/html/core/bricks/arch-surround.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { FRAME_PRESETS, brickSetById, RELIEF_LEVELS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { polygonsOverlap, buildRibbonPrimitives, frameArchOf, brickLayInput } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const { ARCH_SPECS } = ARCH;
const RED = brickSetById(1);
const SCALE = 1 / 0.75; // the 1 in size chip (Red Brick is declared 0.75 in long): the preset's bestSize
const rectPoly = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const rectPrims = (W, H) => [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]].map(([a, b, c, d]) => ({ type: 'line', p0: { x: a, y: b }, p1: { x: c, y: d } }));
const centroid = (poly) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });
const tplPrims = (id, W, H) => buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
const lay = (primitives, W = 7, H = 10) => generateBricks({ boardOutline: rectPoly(0, 0, W, H), set: RED, scale: SCALE, seed: 3,
  frame: { primitives, bands: [...FRAME_PRESETS.arch_keystone] }, arch: { spec: FRAME_PRESETS.arch_keystone.arch } });
const noOverlap = (P) => { for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) expect(polygonsOverlap(P[i].polygon, P[j].polygon)).toBe(false); };
/** Inside the polygon, or within a hair of its line: with no band the arch's outer rows hug the frame's own curve, and a chord
 *  tessellation of a concave curve lies a hair inside it (MEASURED: two hood pieces at T10's waist, outside by < 0.01 in). */
const insideOrOn = (c, poly, tol = 0.02) => pointInPolygon(c.x, c.y, poly) || poly.some((a, i) => { const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const f = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / l2)); return Math.hypot(a.x + dx * f - c.x, a.y + dy * f - c.y) < tol; });
/** The opening's top y at x (its topmost crossing), and its width at height y. */
const topAt = (poly, x) => { const ys = []; poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if ((a.x > x) !== (b.x > x)) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)); }); return Math.min(...ys); };
const widthAt = (poly, y) => { const xs = []; poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)); }); return Math.max(...xs) - Math.min(...xs); };

describe('the declaration', () => {
  it("'arch_keystone': no band of its own (Fred: the large blocks touch the frame's edge), the arch, best at 1 in", () => {
    expect([...FRAME_PRESETS.arch_keystone]).toEqual([]);
    expect([FRAME_PRESETS.arch_keystone.arch, FRAME_PRESETS.arch_keystone.bestSize]).toEqual(['rowlock_keystone', 1]);
    expect(JSON.stringify(FRAME_PRESETS.arch_keystone)).toBe('[]');
    expect(frameArchOf({ frameBandPreset: 'arch_keystone' })).toBe('rowlock_keystone');
    expect(frameArchOf({ frameBandPreset: 'single_soldier' })).toBe(null);
  });
  it("Fred's ladder, declared: the full stack, then no hood, then one ring", () => {
    expect(ARCH_SPECS.rowlock_keystone.ladder).toEqual([{ hood: true, rings: 2 }, { hood: false, rings: 2 }, { hood: false, rings: 1 }]);
  });
  it('RETIRED: no fixed semicircle (its placement / fit) and no pier (Fred: no inward offset)', () => {
    for (const gone of ['archPlacement', 'spanAt', 'run']) expect(ARCH[gone]).toBeUndefined();
    for (const key of ['apexCourses', 'minOpeningL', 'pierIn']) expect(ARCH_SPECS.rowlock_keystone).not.toHaveProperty(key);
  });
});

describe('on a 7 x 10 rectangle (the mock board): a flat (jack) arch directly inside the frame band', () => {
  const res = lay(rectPrims(7, 10));
  const pieces = res.archBricks;
  const parts = (p) => pieces.filter((b) => b.part === p);
  it('every part, in its own set: stone keystone / springers / sill blocks, the rest the frame set', () => {
    const counts = Object.fromEntries(['keystone', 'springer', 'ring', 'hood', 'sillBlock'].map((p) => [p, parts(p).length]));
    expect(counts).toMatchObject({ keystone: 1, springer: 2, sillBlock: 2 });
    for (const p of ['ring', 'hood']) expect(counts[p]).toBeGreaterThan(3);
    for (const b of pieces) expect(b.setId).toBe(['keystone', 'springer', 'sillBlock'].includes(b.part) ? 6 : undefined);
  });
  it("the hood and the keystone carry the frame motifs' RAISED tag (RELIEF_LEVELS; Fred: the keystone like the hood); the rings none", () => {
    expect([ARCH_SPECS.rowlock_keystone.hoodRelief, ARCH_SPECS.rowlock_keystone.keystoneRelief]).toEqual(['raised', 'raised']);
    for (const b of [...parts('hood'), ...parts('keystone')]) { expect(b.relief).toBe('raised'); expect(b.heightOffset).toBeCloseTo(RELIEF_LEVELS.raised, 1); }
    for (const b of parts('ring')) { expect(b.relief).toBeUndefined(); expect(Math.abs(b.heightOffset)).toBeLessThan(RELIEF_LEVELS.raised / 2); }
  });
  it("the arch starts AT the frame's edge (no band, no pier): its region's outer is the board's edge, a stone touches it", () => {
    expect(res.archRegion[0].outer).toEqual(res.interiorOutline);
    const xs = res.interiorOutline.map((p) => p.x), ys = res.interiorOutline.map((p) => p.y);
    expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => +v.toFixed(6))).toEqual([0, 0, 7, 10]);
    expect(Math.min(...parts('keystone')[0].polygon.map((p) => p.y))).toBeCloseTo(0, 6);
    expect(res.frameBricks).toEqual([]); // no frame band pieces
  });
  it('the opening follows the flat top: flat across', () => {
    expect(topAt(res.archOpening, 3.5)).toBeCloseTo(topAt(res.archOpening, 2.5), 6);
  });
  it('no two arch pieces overlap; none inside the opening', () => {
    noOverlap(pieces);
    for (const b of pieces) { const c = centroid(b.polygon); expect(pointInPolygon(c.x, c.y, res.archOpening)).toBe(false); }
  });
  it('the wall: inside the opening only, clear of the arch', () => {
    expect(res.bricks.length).toBeGreaterThan(40);
    for (const w of res.bricks) { const c = centroid(w.polygon); expect(pointInPolygon(c.x, c.y, res.archOpening)).toBe(true); }
    for (const w of res.bricks) for (const a of pieces) expect(polygonsOverlap(w.polygon, a.polygon)).toBe(false);
  });
});

describe('it conforms to the frame (any template)', () => {
  it("T10 Arched Hourglass: the opening's top is the frame's arc (curved), and it narrows at the waist", () => {
    const res = lay(tplPrims('template_10', 7, 10));
    expect(res.archFit).toBeUndefined();
    const o = res.archOpening, ys = o.map((p) => p.y), top = Math.min(...ys), bot = Math.max(...ys);
    expect(topAt(o, 3.5 + 1) - topAt(o, 3.5)).toBeGreaterThan(0.1); // curved: lower off the centre
    expect(widthAt(o, top + 0.45 * (bot - top))).toBeLessThan(widthAt(o, bot - 0.5) - 1); // the waist
    noOverlap(res.archBricks);
    for (const b of res.archBricks) expect(insideOrOn(centroid(b.polygon), res.interiorOutline)).toBe(true);
  });
  it('T1 hourglass 7 x 9: a flat top over a waist -- the rings follow it, no overlaps, all inside the interior', () => {
    const res = lay(tplPrims('template_1', 7, 9), 7, 9);
    expect(res.archFit).toBeUndefined();
    noOverlap(res.archBricks);
    for (const b of res.archBricks) expect(insideOrOn(centroid(b.polygon), res.interiorOutline)).toBe(true);
  });
  it("a neck or a peak too tight for the full stack: the ladder shrinks it or skips it ('archTooNarrow') -- never colliding pieces", () => {
    for (const [id, W, H] of [['template_18', 7, 10], ['template_7', 9, 12]]) {
      const res = lay(tplPrims(id, W, H), W, H);
      if (res.archFit) { expect(res.archFit).toBe('archTooNarrow'); expect(res.archBricks).toBeUndefined(); continue; }
      noOverlap(res.archBricks.filter((b) => b.part === 'ring'));
    }
  });
  it('every laid arch has all its stones: one keystone, two springers, two sill blocks (or the rung is not laid)', () => {
    for (const [id, W, H] of [['template_18', 7, 10], ['template_11', 7, 10], ['template_5', 7, 10], ['template_6', 7, 10]]) {
      const res = lay(tplPrims(id, W, H), W, H);
      if (res.archFit) continue;
      const n = (p) => res.archBricks.filter((b) => b.part === p).length;
      expect([id, n('keystone'), n('springer'), n('sillBlock')]).toEqual([id, 1, 2, 2]);
    }
  });
  it('a pointed gable (T7 9 x 12): laid, its keystone at the apex on the centre line (the top span = the two sides meeting there)', () => {
    const res = lay(tplPrims('template_7', 9, 12), 9, 12);
    expect(res.archFit).toBeUndefined();
    const k = centroid(res.archBricks.find((b) => b.part === 'keystone').polygon);
    expect(k.x).toBeCloseTo(4.5, 1);
    for (const sp of res.archBricks.filter((b) => b.part === 'springer')) expect(centroid(sp.polygon).y).toBeGreaterThan(k.y + 1);
  });
  it('T18 Arched Head 7 x 10: its neck takes the ladder down (no hood), laid all the same', () => {
    const res = lay(tplPrims('template_18', 7, 10));
    expect(res.archFit).toBeUndefined();
    expect(res.archStep).toBeGreaterThan(0);
    expect(res.archBricks.filter((b) => b.part === 'hood')).toHaveLength(0);
  });
  // MEASURED (the full sweep with each check removed): an opening split into lobes laid overlapping pieces on T14 / T16; a
  // stone reaching into the opening on T11 / T5 -- these boards pin both checks
  it.each([['template_14', 7, 10, 0.75], ['template_16', 9, 12, 1], ['template_11', 7, 10, 1], ['template_5', 7, 10, 1.25]])('%s %d x %d at %d in: no two arch pieces overlap, nor wall and arch', (id, W, H, size) => {
    const res = generateBricks({ boardOutline: rectPoly(0, 0, W, H), set: RED, scale: size / 0.75, seed: 3,
      frame: { primitives: tplPrims(id, W, H), bands: [...FRAME_PRESETS.arch_keystone] }, arch: { spec: 'rowlock_keystone' } });
    if (!res.archBricks) return;
    noOverlap(res.archBricks);
    for (const w of res.bricks) for (const a of res.archBricks) expect(polygonsOverlap(w.polygon, a.polygon)).toBe(false);
  });
  it("T5's concave dip at 1.25 in: the opening's wall clear of the arch's corner pieces", () => {
    const res = generateBricks({ boardOutline: rectPoly(0, 0, 7, 10), set: RED, scale: 1.25 / 0.75, seed: 3,
      frame: { primitives: tplPrims('template_5', 7, 10), bands: [...FRAME_PRESETS.arch_keystone] }, arch: { spec: 'rowlock_keystone' } });
    for (const w of res.bricks) for (const a of res.archBricks || []) expect(polygonsOverlap(w.polygon, a.polygon)).toBe(false);
  });
  it("too narrow for even one ring: no arch ('archTooNarrow'), the wall as without it", () => {
    const narrow = rectPrims(1.6, 10);
    const res = lay(narrow, 1.6, 10);
    expect(res.archFit).toBe('archTooNarrow');
    const plain = generateBricks({ boardOutline: rectPoly(0, 0, 1.6, 10), set: RED, scale: SCALE, seed: 3, frame: { primitives: narrow, bands: [...FRAME_PRESETS.arch_keystone] } });
    expect(JSON.stringify(res.bricks)).toBe(JSON.stringify(plain.bricks));
  });
});

describe('the editor sends the arch only with the Frame element', () => {
  const editor = { _mW: 7, _mH: 10, _sketchLayer: { node: { querySelectorAll: () => [], querySelector: () => null } }, _layers: [] };
  const geom = (bands) => ({ primitives: rectPrims(7, 10), bands, insetRect: null });
  it('arch_keystone (no bands of its own) -> input.arch; no Frame element (frameGeomForLay says so) or another preset -> absent', () => {
    const settings = { frameBandPreset: 'arch_keystone', seed: 1, setId: 1, brickLengthIn: 1 };
    expect(brickLayInput(editor, settings, geom([...FRAME_PRESETS.arch_keystone])).arch).toEqual({ spec: 'rowlock_keystone' });
    expect(brickLayInput(editor, settings, { ...geom([]), noFrameElement: true }).arch).toBeUndefined();
    expect(brickLayInput(editor, { ...settings, frameBandPreset: 'single_soldier' }, geom([...FRAME_PRESETS.single_soldier])).arch).toBeUndefined();
  });
});
