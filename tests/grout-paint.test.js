/**
 * F35 item 55 (seat E): GROUT COLOUR + EDGE + the LOCKED GROUT SHAPE.
 *  - core/bricks/grout-shape.js groutShapeOf: one even-odd path = the element's region minus its (inset) brick faces;
 *  - generateBricks returns `interiorOutline` (additive; every other field as before);
 *  - each laid Wall / Frame element gets ONE grout node `<element id>:grout` (data-brick="grout"), locked, no
 *    data-brick-set (the height mask never reads it), drawn above its bricks; paint = groutPaintOf (per element over the
 *    board-wide value over the defaults: no colour, no inset);
 *  - a paint change repaints only: the brick polygons, the height mask and Send's Bricks sketch are byte-identical;
 *  - art tools cannot pick / select it (layers.js LOCKED_ATTR); the Brick tab's Select picks it on a joint.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { groutShapeOf, insetFace, pointOnGrout, groutIdOf, primitivesOutline } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/grout-shape.js';
import { ribbonEdge } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/ribbon-outline.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRUSH_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import {
  runBricks, groutPaintOf, repaintGrout, brickElementAt, brickRecordNode, frameBandsOf, GROUT_PAINT_DEFAULT, forceRegenerateOwnedBrickElements,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { isEditableByLayer, isOnVisibleLayer, isLockedNode, BRICK_SEND_SKIP, EDITOR_ONLY_STYLE } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { _bricksLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe('groutShapeOf: the region minus the painted faces, one even-odd path', () => {
  const region = [{ outer: sq(0, 0, 4, 4), holes: [] }];
  it('a joint point is grout, a face point is not; the id is <element>:grout', () => {
    const g = groutShapeOf({ id: 'w1', region, faces: [sq(1, 1, 2, 2)] });
    expect(g.id).toBe('w1:grout');
    expect(groutIdOf('w1')).toBe('w1:grout');
    expect(g.fillRule).toBe('evenodd');
    expect(g.loops).toHaveLength(2);
    expect(pointOnGrout(g, 0.5, 0.5)).toBe(true);
    expect(pointOnGrout(g, 1.5, 1.5)).toBe(false);
    expect(g.d.match(/M/g)).toHaveLength(2);
  });
  it('the Edge insets the face (paint only): a point just inside the brick edge becomes grout', () => {
    const g0 = groutShapeOf({ id: 'w', region, faces: [sq(1, 1, 2, 2)], insetIn: 0 });
    const g1 = groutShapeOf({ id: 'w', region, faces: [sq(1, 1, 2, 2)], insetIn: 0.1 });
    expect(pointOnGrout(g0, 1.05, 1.5)).toBe(false);
    expect(pointOnGrout(g1, 1.05, 1.5)).toBe(true);
    expect(pointOnGrout(g1, 1.5, 1.5)).toBe(false);
  });
  it('a cut piece with an edge SHORTER than the inset keeps its face (measured: 17 of 147 faces dropped at 0.02)', () => {
    // a live T1 7x9 wall piece cut at the waist: a 0.006 in edge between two longer ones
    const piece = [{ x: 4.672, y: 3.67 }, { x: 3.426, y: 3.67 }, { x: 3.426, y: 3.3367 }, { x: 4.676, y: 3.3367 }, { x: 4.676, y: 3.6626 }];
    const face = insetFace(piece, 0.02);
    expect(face).not.toBeNull();
    const xs = face.map((p) => p.x), ys = face.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(3.446, 3);
    expect(Math.max(...ys)).toBeCloseTo(3.65, 2);
  });
  it('an inset that swallows the brick leaves no face (the whole brick reads as joint)', () => {
    expect(insetFace(sq(0, 0, 0.1, 0.1), 0.06)).toBeNull();
    expect(insetFace(sq(0, 0, 1, 1), 0)).toEqual(sq(0, 0, 1, 1));
  });
  it('a face crossing the region edge is cut to the region (nothing painted outside it)', () => {
    const g = groutShapeOf({ id: 'w', region, faces: [sq(3, 1, 5, 2)] });
    expect(pointOnGrout(g, 4.5, 1.5)).toBe(false); // outside the region: not grout
    expect(pointOnGrout(g, 3.5, 1.5)).toBe(false); // the face inside the region: not grout
    expect(pointOnGrout(g, 3.5, 2.5)).toBe(true);
  });
  it('cutouts (another element’s bricks) are never painted over, and are not inset', () => {
    const g = groutShapeOf({ id: 'w', region, faces: [], cutouts: [sq(1, 1, 2, 2)], insetIn: 0.2 });
    expect(pointOnGrout(g, 1.05, 1.5)).toBe(false);
  });
  it('a hole in the region (a frame ring) is not grout', () => {
    const g = groutShapeOf({ id: 'f', region: [{ outer: sq(0, 0, 4, 4), holes: [sq(1, 1, 3, 3)] }], faces: [] });
    expect(pointOnGrout(g, 0.5, 0.5)).toBe(true);
    expect(pointOnGrout(g, 2, 2)).toBe(false);
  });
  it('no region = no shape', () => {
    expect(groutShapeOf({ id: 'x', region: [], faces: [sq(0, 0, 1, 1)] })).toBeNull();
  });
  it('primitivesOutline: lines keep their corners; an arc is cut finely (chord sag < 0.002 in)', () => {
    const pts = primitivesOutline([{ type: 'line', p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } }, { type: 'arc', cx: 1, cy: 1, r: 1, theta1: -Math.PI / 2, theta2: 0 }]);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts.slice(1)) expect(Math.abs(Math.hypot(p.x - 1, p.y - 1) - 1)).toBeLessThan(1e-9);
  });
});

describe('generateBricks: interiorOutline is ADDITIVE', () => {
  const board = sq(0, 0, 7, 9);
  const base = { boardOutline: board, set: brickSetById(1), seed: 7 };
  it('no frame: the board; the result keys are the old ones + interiorOutline', () => {
    const r = generateBricks(base);
    expect(Object.keys(r).sort()).toEqual(['bricks', 'frameBricks', 'interiorOutline', 'seed']);
    expect(r.interiorOutline).toEqual(board);
  });
  it('a frame with bands: the bands’ inner path (inside the board)', () => {
    const primitives = [[0, 0, 7, 0], [7, 0, 7, 9], [7, 9, 0, 9], [0, 9, 0, 0]].map(([a, b, c, d]) => ({ type: 'line', p0: { x: a, y: b }, p1: { x: c, y: d } }));
    const r = generateBricks({ ...base, frame: { primitives, bands: frameBandsOf(P.brickSettings) } });
    expect(r.frameBricks.length).toBeGreaterThan(0);
    const xs = r.interiorOutline.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(0.1);
    expect(Math.max(...xs)).toBeLessThan(6.9);
  });
});

describe('groutPaintOf: per element over the board-wide value over the defaults', () => {
  it('a saved board without the keys reads no colour, no inset', () => {
    expect(groutPaintOf({}, 'wall')).toEqual({ color: null, paintInsetIn: 0 });
    expect(GROUT_PAINT_DEFAULT).toEqual({ color: null, paintInsetIn: 0 });
    expect(P.brickSettings.groutPaint).toEqual({ color: null, paintInsetIn: 0 });
    expect(P.brickSettings.groutPaintByElement).toEqual({ wall: null, frame: null, brush: null });
  });
  it('null = inherit the board-wide value; an element’s own wins; the Raised brush shares the Brush’s', () => {
    const s = { groutPaint: { color: '#cfc6b4', paintInsetIn: 0.02 }, groutPaintByElement: { wall: null, frame: { color: '#3b3b3b', paintInsetIn: 0 }, brush: { color: null, paintInsetIn: 0.01 } } };
    expect(groutPaintOf(s, 'wall')).toEqual({ color: '#cfc6b4', paintInsetIn: 0.02 });
    expect(groutPaintOf(s, 'frame')).toEqual({ color: '#3b3b3b', paintInsetIn: 0 });
    expect(groutPaintOf(s, 'raisedBrush')).toEqual({ color: null, paintInsetIn: 0.01 });
  });
});

/** An SVG.js-shaped sketch layer over a real DOM node (as tests/bricks-any-layer.test.js), the real engine. */
function fakeEditor() {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const wrap = (el) => {
    const api = {
      node: el, type: el.tagName.toLowerCase(),
      fill: (v) => { if (typeof v === 'string') el.setAttribute('fill', v); return api; },
      stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; },
      removeClass: (c) => { el.classList.remove(c); return api; },
      remove: () => { el.remove(); return api; },
    };
    return api;
  };
  const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _sketchLayer: {
      node,
      polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
      path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}
const RECT = [[0, 0, 7, 0], [7, 0, 7, 9], [7, 9, 0, 9], [0, 9, 0, 0]].map(([a, b, c, d]) => ({ type: 'line', p0: { x: a, y: b }, p1: { x: c, y: d } }));
const frameGeom = () => ({ primitives: RECT, bands: frameBandsOf(P.brickSettings) });
const q = (ed, sel) => [...ed._sketchLayer.node.querySelectorAll(sel)];
const bricksHtml = (ed) => q(ed, '[data-brick="wall"], [data-brick="frame"]').map((n) => n.outerHTML).join('');

describe('the lay draws one LOCKED grout node per Wall / Frame element', () => {
  it('a wall + frame lay: two grout nodes, ids <record>:grout, no data-brick-set, locked, above their bricks, no fill by default', () => {
    const ed = fakeEditor();
    const settings = { ...P.brickSettings, seed: 3 };
    runBricks(ed, settings, frameGeom());
    const grout = q(ed, '[data-brick="grout"]');
    expect(grout).toHaveLength(2);
    for (const kind of ['wall', 'frame']) {
      const rec = brickRecordNode(ed, kind).getAttribute('data-brick-element');
      const g = grout.find((n) => n.getAttribute('data-brick-grout-of') === kind);
      expect(g.getAttribute('id')).toBe(`${rec}:grout`);
      expect(g.getAttribute('data-brick-owner')).toBe(rec);
      expect(g.hasAttribute('data-brick-set')).toBe(false);
      expect(isLockedNode(g)).toBe(true);
      expect(g.getAttribute('fill')).toBe('none');
      expect(g.getAttribute('fill-rule')).toBe('evenodd');
      // drawn after (above) every brick of its element
      const bricks = q(ed, `[data-brick="${kind}"]`);
      expect(bricks.length).toBeGreaterThan(0);
      for (const b of bricks) expect(b.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // a re-lay replaces them (no duplicates)
    runBricks(ed, settings, frameGeom());
    expect(q(ed, '[data-brick="grout"]')).toHaveLength(2);
  });

  it('a paint change repaints only: the brick polygons and the height mask are byte-identical', async () => {
    const ed = fakeEditor();
    const settings = { ...P.brickSettings, seed: 3 };
    runBricks(ed, settings, frameGeom());
    const layerId = q(ed, '[data-brick="wall"]')[0].getAttribute('data-layer');
    const before = bricksHtml(ed);
    const mask0 = await rasterizeBrickHeightMask(ed, { id: layerId }, 40, 50, 7, 9);
    const wallG = () => q(ed, '[data-brick="grout"][data-brick-grout-of="wall"]')[0];
    const d0 = wallG().getAttribute('d');
    const painted = { ...settings, groutPaint: { color: '#cfc6b4', paintInsetIn: 0.03 } };
    expect(repaintGrout(ed, painted)).toBe(2);
    expect(wallG().getAttribute('fill')).toBe('#cfc6b4');
    expect(wallG().getAttribute('d')).not.toBe(d0); // the faces are inset
    expect(bricksHtml(ed)).toBe(before);
    const mask1 = await rasterizeBrickHeightMask(ed, { id: layerId }, 40, 50, 7, 9);
    expect(Buffer.from(mask1.body.buffer).equals(Buffer.from(mask0.body.buffer))).toBe(true);
    // the per-element override: the frame alone goes charcoal
    repaintGrout(ed, { ...painted, groutPaintByElement: { wall: null, frame: { color: '#3b3b3b', paintInsetIn: 0 } } });
    expect(wallG().getAttribute('fill')).toBe('#cfc6b4');
    expect(q(ed, '[data-brick="grout"][data-brick-grout-of="frame"]')[0].getAttribute('fill')).toBe('#3b3b3b');
  });

  it('art tools cannot pick it; the Brick tab’s Select picks its element on a joint', () => {
    const ed = fakeEditor();
    runBricks(ed, { ...P.brickSettings, seed: 3 }, frameGeom());
    const g = q(ed, '[data-brick="grout"][data-brick-grout-of="wall"]')[0];
    ed._activeLayer = g.getAttribute('data-layer');
    const el = (n) => ed._sketchLayer.children().toArray().find((w) => w.node === n); // the svg.js-shaped element
    expect(isEditableByLayer(ed, el(g))).toBe(false);
    expect(isOnVisibleLayer(ed, el(g))).toBe(false);
    const brick = q(ed, '[data-brick="wall"]')[0];
    expect(isOnVisibleLayer(ed, el(brick))).toBe(true); // bricks themselves stay pickable, as before
    // a point between the outermost frame brick and the board edge would be outside every region; take a wall joint:
    // just past a wall brick's corner, inside the wall region, on no brick
    const rec = brickRecordNode(ed, 'wall').getAttribute('data-brick-element');
    const pts = brick.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const onBrick = brickElementAt(ed, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 });
    expect(onBrick).toEqual({ id: rec, kind: 'wall' });
    // scan along the brick's mid-line for the first non-brick point: the joint
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    let hit = null;
    for (let x = Math.max(...xs); x < Math.max(...xs) + 0.3 && !hit; x += 0.002) {
      const h = brickElementAt(ed, { x, y });
      if (h && h.part === 'grout') hit = h;
    }
    expect(hit).toEqual({ id: rec, kind: 'wall', part: 'grout' });
  });
});

describe('Send: the grout never goes into the Bricks sketch (stamp.bricks.svg)', () => {
  function bricksEditor(innerHTML) {
    const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${innerHTML}</svg>`, 'image/svg+xml');
    const node = { innerHTML, querySelector: (sel) => doc.querySelector(sel) };
    return { _draw: {}, _sketchLayer: { node }, _mW: 7, _mH: 9, _layers: [{ id: 'b1', name: 'Bricks', holdsBricks: true }], _activeLayer: null };
  }
  it('declared once: BRICK_SEND_SKIP lists the grout kind', () => {
    expect(BRICK_SEND_SKIP).toContain('grout');
  });
  it('the bricks go, the grout path does not; with or without a grout node the sketch is byte-identical', async () => {
    const brick = '<polygon points="0,0 1,0 1,0.3 0,0.3" data-layer="b1" data-brick="wall" data-brick-gen="1"/>';
    const grout = '<path d="M0,0L2,0L2,2Z" fill="#cfc6b4" fill-rule="evenodd" id="w1:grout" data-layer="b1" data-brick="grout" data-brick-gen="1" data-brick-owner="w1" data-locked="1"/>';
    const without = await _bricksLayerSvg(bricksEditor(brick));
    const withGrout = await _bricksLayerSvg(bricksEditor(brick + grout));
    expect(withGrout).not.toContain('<path');
    expect(withGrout).not.toContain('grout');
    expect(withGrout).toBe(without);
  });
  // advisor (seat E finding): the editor's own look -- open()'s inline cursor, the hover / selection classes -- never
  // reaches stamp.bricks.svg (layers.js EDITOR_ONLY_STYLE)
  it('hovering, selecting or reopening a brick does not change the Bricks sketch', async () => {
    const plain = '<polygon points="0,0 1,0 1,0.3 0,0.3" data-layer="b1" data-brick="wall" data-brick-gen="1" fill="#aa4433"/>';
    const looked = '<polygon points="0,0 1,0 1,0.3 0,0.3" data-layer="b1" data-brick="wall" data-brick-gen="1" fill="#aa4433" style="cursor: pointer;" class="svg-hover svg-selected"/>';
    expect(EDITOR_ONLY_STYLE).toEqual({ props: ['cursor'], classes: ['svg-hover', 'svg-selected'] });
    const a = await _bricksLayerSvg(bricksEditor(plain)), b = await _bricksLayerSvg(bricksEditor(looked));
    expect(b).not.toContain('cursor');
    expect(b).not.toContain('svg-hover');
    expect(b).toBe(a);
    // a layer-state class is NOT editor-only look: it stays (today's sketches carry it)
    const dim = await _bricksLayerSvg(bricksEditor(looked.replace('svg-hover svg-selected', 'inactive-layer svg-hover')));
    expect(dim).toContain('class="inactive-layer"');
  });
});

// F35 item 55 follow-up (advisor): a BRUSH stroke's grout -- its region is the ribbon the engine laid it in
// (contour-bands ribbonOutline for an open centred ribbon, core/bricks/ribbon-outline.js), one grout node per stroke
describe('Brush stroke grout: the engine ribbon + one node per stroke', () => {
  const set = brickSetById(1);
  const line = (a, b) => ({ type: 'line', p0: a, p1: b });
  it('an open centred ribbon returns its outline (additive); a closed contour does not', () => {
    const prims = [line({ x: 0, y: 1 }, { x: 4, y: 1 })];
    const r = bricksContourBands(prims, BRUSH_PRESETS.stretcher_1, { set, seed: 1, closed: false, centered: true });
    expect(Object.keys(r).sort()).toEqual(['bricks', 'innerPath', 'ribbonOutline']);
    const xs = r.ribbonOutline.map((p) => p.x), ys = r.ribbonOutline.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(0, 6); expect(Math.max(...xs)).toBeCloseTo(4, 6);
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(2, 6); // centred on the stroke
    expect(r.ribbonOutline.length).toBe(4); // a straight ribbon is a rectangle: the stroke's own ends, the bricks' own edges
    // every brick sits across the ribbon's width; the end bricks overhang the stroke's ends by the engine's own end
    // allowance (measured 0.02 in at Set 1) -- their grout face is cut to the ribbon there (groutShapeOf)
    for (const b of r.bricks) for (const v of b.polygon) {
      expect(v.y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-9); expect(v.y).toBeLessThanOrEqual(Math.max(...ys) + 1e-9);
      expect(v.x).toBeGreaterThanOrEqual(-0.05); expect(v.x).toBeLessThanOrEqual(4.05);
    }
    const closed = bricksContourBands(RECT, frameBandsOf(P.brickSettings), { set, seed: 1 });
    expect('ribbonOutline' in closed).toBe(false);
  });
  it('an L stroke: each edge is mitred at the corner (the bricks’ own joint rule)', () => {
    const prims = [line({ x: 0, y: 0 }, { x: 2, y: 0 }), line({ x: 2, y: 0 }, { x: 2, y: 2 })].map((p) => {
      const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, len = Math.hypot(dx, dy);
      return { ...p, nx: -dy / len, ny: dx / len };
    });
    const edge = ribbonEdge(prims, 0.25);
    expect(edge).toHaveLength(3);
    expect(edge[1].x).toBeCloseTo(1.75, 6); expect(edge[1].y).toBeCloseTo(0.25, 6);
  });

  function strokeEditor() {
    const ed = fakeEditor();
    ed._layers = [{ id: 'S', name: 'Brush', visible: true, brickKind: 'brush' }];
    const spine = (x1, y1, x2, y2) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      Object.entries({ x1, y1, x2, y2, 'data-brick': 'brush-spine', 'data-brick-element': 'st1', 'data-layer': 'S',
        'data-brick-settings': JSON.stringify({ ...P.brickSettings, setId: 1, seed: 2 }) }).forEach(([k, v]) => el.setAttribute(k, String(v))); // a stroke freezes its set
      ed._sketchLayer.node.appendChild(el);
      return el;
    };
    return { ed, spine };
  }
  it('a stroke gets ONE grout node (its id, kind brush, locked) over its ribbon; a re-draw keeps the paint; a deleted stroke leaves none', () => {
    const { ed, spine } = strokeEditor();
    const s1 = spine(1, 1, 4, 1); spine(4, 1, 4, 4);
    forceRegenerateOwnedBrickElements(ed);
    const grout = q(ed, '[data-brick="grout"]');
    expect(grout).toHaveLength(1);
    expect(grout[0].getAttribute('data-brick-grout-of')).toBe('brush');
    expect(grout[0].getAttribute('data-brick-owner')).toBe('st1');
    expect(grout[0].getAttribute('id')).toBe('st1:grout');
    expect(isLockedNode(grout[0])).toBe(true);
    expect(q(ed, '[data-brick="brush"]').length).toBeGreaterThan(3);
    // the region is the stroke's ribbon: every stroke brick's centroid lies on it (measured: a stroke's bricks butt with no
    // joint along the run, so its grout reads only with an Edge; Select on any of its bricks already picks the stroke)
    const region = JSON.parse(grout[0].getAttribute('data-grout-region'));
    for (const n of q(ed, '[data-brick="brush"]')) {
      const v = n.getAttribute('points').trim().split(/[ ,]+/).map(Number);
      const cx = v.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (v.length / 2), cy = v.filter((_, i) => i % 2).reduce((a, b) => a + b, 0) / (v.length / 2);
      expect(pointOnGrout({ loops: region.map((r) => r.outer) }, cx, cy)).toBe(true);
    }
    expect(brickElementAt(ed, { x: 1.5, y: 1 })).toEqual({ id: 'st1', kind: 'brush' });
    // paint it, move the stroke: its new node keeps the paint (never frozen into the stroke's snapshot)
    repaintGrout(ed, { ...P.brickSettings, groutPaintByElement: { brush: { color: '#3b3b3b', paintInsetIn: 0.02 } } });
    s1.setAttribute('x1', '0.5');
    forceRegenerateOwnedBrickElements(ed);
    const again = q(ed, '[data-brick="grout"]');
    expect(again).toHaveLength(1);
    expect(again[0].getAttribute('fill')).toBe('#3b3b3b');
    expect(again[0].getAttribute('data-grout-inset')).toBe('0.02');
    // the stroke deleted: its grout goes with it
    q(ed, '[data-brick="brush-spine"]').forEach((n) => n.remove());
    forceRegenerateOwnedBrickElements(ed);
    expect(q(ed, '[data-brick="grout"]')).toHaveLength(0);
  });
});
