/**
 * F35 item 42 (Fred: "I don't always use frames"): with NO Frame element on the board, the wall fills the frame's contour
 * itself -- the template's outer edge, the board rectangle for template None -- with no band reserve; once a Frame element
 * exists (laid now or already there) the wall sits inside its bands as before. Measured before: T18 7x10, 0.75 in, Wall
 * only: the wall spanned x 1.00-6.00 (the preset's Soldier band kept clear). Real engine, fake editor (as wall-areas).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));

import { runBricks, buildRibbonPrimitives, frameGeomForLay, BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor(w = 7, h = 9) {
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c),
    fill: () => api, stroke: () => api }; return api; };
  const svgEl = (tag) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return el; };
  return { _draw: {}, _mW: w, _mH: h, _activeLayer: '0', _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _sketchLayer: { node, children: () => Object.assign([], { toArray: () => [] }), group: () => wrap(svgEl('g')), polygon: (pts) => { const el = svgEl('polygon'); el.setAttribute('points', pts); return wrap(el); }, path: (d) => { const el = svgEl('path'); el.setAttribute('d', d); return wrap(el); } } };
}
const S = () => ({ ...P.brickSettings, pattern: 'stretcher', wallRotationDeg: 0, accent: { preset: 'none', levelIn: 0.0625, clicks: [] } });
const geom = (x1, y1, x2, y2) => ({ primitives: buildRibbonPrimitives(rectToPrimitives({ x1, y1, x2, y2 })), bands: FRAME_PRESETS.single_soldier });
const bbox = (ed, kind) => {
  const pts = [...ed._sketchLayer.node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][data-brick="${kind}"]`)]
    .flatMap((n) => n.getAttribute('points').trim().split(/[ ]+/).map((q) => q.split(',').map(Number)));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
};
const JOINT = 0.1; // the wall's own joint at the board edge, generously

describe('item 42: a wall with no Frame element fills the frame contour (no band reserve)', () => {
  it('a template’s outer edge (0.25 in in from the board): the wall reaches it within a joint', () => {
    const ed = fakeEditor();
    runBricks(ed, S(), geom(0.25, 0.25, 6.75, 8.75), { kinds: ['wall'] });
    const [x0, y0, x1, y1] = bbox(ed, 'wall');
    for (const [got, want] of [[x0, 0.25], [y0, 0.25], [x1, 6.75], [y1, 8.75]]) expect(Math.abs(got - want)).toBeLessThan(JOINT);
  });
  it('template None (the board rectangle): the wall reaches the board edge', () => {
    const ed = fakeEditor();
    runBricks(ed, S(), geom(0, 0, 7, 9), { kinds: ['wall'] });
    const [x0, y0, x1, y1] = bbox(ed, 'wall');
    for (const [got, want] of [[x0, 0], [y0, 0], [x1, 7], [y1, 9]]) expect(Math.abs(got - want)).toBeLessThan(JOINT);
  });
  it('with a Frame element (laid, then the wall re-laid alone) the wall stays inside its bands, as before', () => {
    const ed = fakeEditor();
    const g = geom(0.25, 0.25, 6.75, 8.75);
    runBricks(ed, S(), g); // wall + frame
    const [fx0] = bbox(ed, 'frame');
    runBricks(ed, S(), g, { kinds: ['wall'] }); // the frame element is on the board
    const [x0] = bbox(ed, 'wall');
    expect(fx0).toBeLessThan(0.25 + JOINT);
    expect(x0).toBeGreaterThan(0.25 + 0.4); // a band's depth in
  });
  it('frameGeomForLay: the bands go only when there is no Frame element (laid now or on the board)', () => {
    const ed = fakeEditor();
    const g = geom(0, 0, 7, 9);
    expect(frameGeomForLay(ed, g, ['wall']).bands).toEqual([]);
    expect(frameGeomForLay(ed, g, ['wall', 'frame']).bands).toBe(g.bands);
    expect(frameGeomForLay(ed, null, ['wall'])).toBeNull();
  });
});
