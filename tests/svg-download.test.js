/**
 * F35 item 56 (seat E): the SVG DOWNLOAD -- ONE file, top-level groups frame / art (per layer) / bricks (per element) /
 * grout (per element), each named for Illustrator / Inkscape (id + inkscape:label + groupmode layer), stacked as the
 * Layers panel is (advisor: frame at the bottom, then each layer's art, bricks, grout, bottom to top); bricks as FLAT
 * vector colours (each a path filled with its set's declared faceColor, its face inset by its element's Edge), piece ids
 * kept; no fill points at a pattern the file lacks (seat C's measurement: 151 fills -> 0 embedded patterns).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({
  // the canvas paints each brick with its photo PATTERN (a url(#brickfill-...) whose <pattern> lives outside the drawing)
  brickFillPaint: vi.fn((editor, setId, sampleId) => `url(#brickfill-${sampleId}-1)`),
  preloadSetDetail: vi.fn(async () => {}),
  sampleDetailAtFor: vi.fn(() => undefined),
}));

import { runBricks, repaintGrout, frameBandsOf, brickRecordNode } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { saveSvgDownload } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { SVG_BRICK_EXPORT, SVG_EXPORT_GROUPS, svgDownloadGroups, INKSCAPE_NS } from '../bspline-frame-builder/b-spline-gen/html/editor/svg-export.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  const node = document.createElement('div');
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
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '9', name: 'Hidden art', visible: false }],
    _sketchLayer: {
      node,
      polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
      path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
      rect: () => make('rect')(),
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}
const RECT = [[0, 0, 7, 0], [7, 0, 7, 9], [7, 9, 0, 9], [0, 9, 0, 0]].map(([a, b, c, d]) => ({ type: 'line', p0: { x: a, y: b }, p1: { x: c, y: d } }));
function laidBoard(paint = { color: '#cfc6b4', paintInsetIn: 0 }) {
  const ed = fakeEditor();
  const settings = { ...P.brickSettings, seed: 3, groutPaint: paint };
  runBricks(ed, settings, { primitives: RECT, bands: frameBandsOf(P.brickSettings) });
  repaintGrout(ed, settings);
  // art on the active layer and on a HIDDEN layer
  const r = ed._sketchLayer.rect(); r.attr('data-layer', '0').attr('x', 1).attr('y', 1).attr('width', 1).attr('height', 1).attr('fill', '#123456');
  const h = ed._sketchLayer.rect(); h.attr('data-layer', '9').attr('x', 2).attr('y', 2).attr('width', 1).attr('height', 1).attr('fill', '#654321');
  return ed;
}
const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
// jsdom's XML parser does not bind attribute namespaces (namespaceURI null, measured): read the qualified name here;
// the live probe reads getAttributeNS(INKSCAPE_NS, ...) in Chrome, whose parser does
const label = (g) => g.getAttribute('inkscape:label');
const bbox = (pts) => { const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; };

describe('declared: the styles and the groups', () => {
  it('flat is the default and the only style exposed; textured is declared, not built', () => {
    expect(SVG_BRICK_EXPORT.default).toBe('flat');
    expect(SVG_BRICK_EXPORT.exposed).toEqual(['flat']);
    expect(Object.keys(SVG_BRICK_EXPORT.styles).sort()).toEqual(['flat', 'outline', 'textured']);
    expect(() => svgDownloadGroups(fakeEditor(), 'textured')).toThrow(/not available/);
  });
  it('every brick set declares its face colour', () => {
    for (const s of BRICK_SETS) expect(s.faceColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('the download: one file, named groups, flat bricks', () => {
  it('top-level groups stack as the Layers panel: each layer’s art, then its elements’ bricks + grout; each a named Inkscape layer', async () => {
    const ed = laidBoard();
    const root = parse(await saveSvgDownload(ed));
    expect(root.querySelector('parsererror')).toBeNull();
    const top = [...root.children].filter((c) => c.tagName === 'g');
    const rec = (k) => brickRecordNode(ed, k).getAttribute('data-brick-element');
    // roster bottom -> top: Layer 1, Hidden art, then the Wall and Frame kind layers (item 64); no frame template here
    expect(top.map((g) => g.id)).toEqual(['art:0', 'art:9', `bricks:${rec('wall')}`, `grout:${rec('wall')}`, `bricks:${rec('frame')}`, `grout:${rec('frame')}`]);
    expect(top.map(label)).toEqual(['Layer 1', 'Hidden art', 'Wall', 'Wall grout', 'Frame', 'Frame grout']);
    expect(SVG_EXPORT_GROUPS.map((g) => [g.id, g.place])).toEqual([['frame', 'bottom'], ['art', 'layer'], ['bricks', 'layer'], ['grout', 'layer']]);
    for (const g of top) expect(g.getAttribute('inkscape:groupmode')).toBe('layer');
    expect(root.getAttribute('xmlns:inkscape')).toBe(INKSCAPE_NS);
  });

  it('the user’s roster order wins: the Wall layer moved to the bottom puts its bricks under the art', async () => {
    const ed = laidBoard();
    const wall = ed._layers.find((l) => l.brickKind === 'wall');
    ed._layers = [wall, ...ed._layers.filter((l) => l !== wall)];
    const top = [...parse(await saveSvgDownload(ed)).children].filter((c) => c.tagName === 'g').map((g) => g.id);
    expect(top.indexOf(`bricks:${brickRecordNode(ed, 'wall').getAttribute('data-brick-element')}`)).toBeLessThan(top.indexOf('art:0'));
  });

  it('every laid brick is ONE path in its element’s group, filled with its set’s faceColor; ids kept and unique; no url(#...) anywhere', async () => {
    const ed = laidBoard();
    const svg = await saveSvgDownload(ed);
    expect(svg).not.toContain('url(#');
    const root = parse(svg);
    const laid = [...ed._sketchLayer.node.querySelectorAll('[data-brick="wall"], [data-brick="frame"]')];
    const paths = [...root.querySelectorAll('g[id^="bricks:"] path')];
    expect(paths).toHaveLength(laid.length);
    const ids = paths.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const red = BRICK_SETS.find((s) => s.id === 1).faceColor;
    expect(paths.every((p) => p.getAttribute('fill') === red)).toBe(true);
    const wallRec = brickRecordNode(ed, 'wall').getAttribute('data-brick-element');
    const wall0 = laid.find((n) => n.getAttribute('data-brick') === 'wall');
    expect(ids).toContain(`${wallRec}:${wall0.getAttribute('data-brick-id')}`);
  });

  it('the Edge insets each painted face (the joint = joint + 2 x Edge); the drawing’s own polygons are untouched', async () => {
    const ed = laidBoard({ color: '#cfc6b4', paintInsetIn: 0.03 });
    const before = [...ed._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n) => n.getAttribute('points'));
    const root = parse(await saveSvgDownload(ed));
    const wall0 = ed._sketchLayer.node.querySelector('[data-brick="wall"]');
    const owner = wall0.getAttribute('data-brick-owner'), bid = wall0.getAttribute('data-brick-id');
    const path = [...root.querySelectorAll('path')].find((p) => p.id === `${owner}:${bid}`);
    const out = path.getAttribute('d').replace(/[MZ]/g, '').split('L').map((q) => q.split(',').map(Number));
    const src = wall0.getAttribute('points').trim().split(/\s+/).map((q) => q.split(',').map(Number));
    expect(bbox(src).w - bbox(out).w).toBeCloseTo(0.06, 3);
    expect(bbox(src).h - bbox(out).h).toBeCloseTo(0.06, 3);
    expect([...ed._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n) => n.getAttribute('points'))).toEqual(before);
  });

  it('grout: one group per element, the path `<element>:grout` with its colour; None = no fill', async () => {
    const ed = laidBoard();
    const root = parse(await saveSvgDownload(ed));
    const grout = [...root.querySelectorAll('g[id^="grout:"] path')];
    expect(grout.map((p) => p.id).sort()).toEqual(['frame', 'wall'].map((k) => `${brickRecordNode(ed, k).getAttribute('data-brick-element')}:grout`).sort());
    expect(grout.every((p) => p.getAttribute('fill') === '#cfc6b4' && p.getAttribute('fill-rule') === 'evenodd')).toBe(true);
    const none = parse(await saveSvgDownload(laidBoard({ color: null, paintInsetIn: 0 })));
    expect([...none.querySelectorAll('g[id^="grout:"] path')].every((p) => p.getAttribute('fill') === 'none')).toBe(true);
  });

  it('art: one group per layer holding art, hidden layers included; no brick, no record in it', async () => {
    const root = parse(await saveSvgDownload(laidBoard()));
    const art = [...root.querySelectorAll('g[id^="art:"]')];
    expect(art.map(label)).toEqual(['Layer 1', 'Hidden art']);
    expect(art.flatMap((g) => [...g.querySelectorAll('rect')])).toHaveLength(2);
    expect(art.some((g) => g.querySelector('[data-brick-gen], [data-brick-record]'))).toBe(false);
  });
});
