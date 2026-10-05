/**
 * F35 item 22 slice 1, step 2 (advisor-approved design): each Wall / Frame ELEMENT has a RECORD -- one invisible
 * node on the brick layer (display none; never drawn, hit, exported or downloaded) with the element's id and the
 * settings it was laid with; every brick it lays carries data-brick-owner = that id. Real draw path into a jsdom
 * container; the composer is stubbed to 2 wall bricks + 1 frame brick (as brick-tool-kinds.test.js).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [sq(5, 'f1')] })) };
});

import {
  runBricks, brickRecordNode, BRICK_RECORD_KINDS, BRICK_RECORD_ATTR, regenerateOwnedBrickElements, elementSettings,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { saveWithTextCopies, getLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { isEditableByLayer, isOnVisibleLayer, BRICK_EDITOR_ONLY_ATTRS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

/** An SVG.js-shaped sketch layer over a real DOM node (chainable elements, children() over the live DOM). */
function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => {
    const api = {
      node: el, type: el.tagName.toLowerCase(),
      fill: () => api, stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; },
      removeClass: (c) => { el.classList.remove(c); return api; },
      hasClass: (c) => el.classList.contains(c),
      remove: () => { el.remove(); return api; },
    };
    return api;
  };
  const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: '1',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true }],
    _sketchLayer: {
      node,
      polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}
const q = (ed, sel) => [...ed._sketchLayer.node.querySelectorAll(sel)];

describe('item 22 step 2: element records + brick owners', () => {
  it('a lay writes ONE record per element: invisible, with an id; every brick it laid names it as owner', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    for (const kind of ['wall', 'frame']) {
      const rec = brickRecordNode(ed, kind);
      expect(rec, kind).toBeTruthy();
      expect(rec.getAttribute(BRICK_RECORD_ATTR)).toBe(BRICK_RECORD_KINDS[kind]);
      expect(rec.getAttribute('display')).toBe('none');
      expect(rec.getAttribute('data-layer')).toBe('1');
      const id = rec.getAttribute('data-brick-element');
      expect(id).toMatch(/^be/);
      const bricks = q(ed, `[data-brick="${kind}"]`);
      expect(bricks.length).toBeGreaterThan(0);
      expect(bricks.every((b) => b.getAttribute('data-brick-owner') === id)).toBe(true);
    }
    expect(q(ed, `[${BRICK_RECORD_ATTR}]`)).toHaveLength(2);
  });

  it('the record keeps the settings its element was laid with (per element: the wall and frame sets differ)', () => {
    const ed = fakeEditor();
    const settings = { ...P.brickSettings, setIds: { ...P.brickSettings.setIds, wall: 1, frame: 3 } };
    runBricks(ed, settings, null);
    expect(JSON.parse(brickRecordNode(ed, 'wall').getAttribute('data-brick-settings'))).toEqual(JSON.parse(JSON.stringify(elementSettings(settings, 'wall'))));
    expect(JSON.parse(brickRecordNode(ed, 'frame').getAttribute('data-brick-settings')).setId).toBe(elementSettings(settings, 'frame').setId);
  });

  it('a re-lay keeps the SAME record (stable id, no duplicate) and re-owns the new bricks', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const id = brickRecordNode(ed, 'wall').getAttribute('data-brick-element');
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(q(ed, `[${BRICK_RECORD_ATTR}="wall-full"]`)).toHaveLength(1);
    expect(brickRecordNode(ed, 'wall').getAttribute('data-brick-element')).toBe(id);
    expect(q(ed, '[data-brick="wall"]').every((b) => b.getAttribute('data-brick-owner') === id)).toBe(true);
  });

  it('a Brush re-generation removes only BRUSH bricks -- the owned Wall/Frame bricks stay', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const before = q(ed, '[data-brick="wall"],[data-brick="frame"]').length;
    regenerateOwnedBrickElements(ed);
    expect(q(ed, '[data-brick="wall"],[data-brick="frame"]').length).toBe(before);
  });

  it('records are never picked (hidden) and never downloaded', async () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const rec = ed._sketchLayer.children().toArray().find((c) => c.attr(BRICK_RECORD_ATTR) === 'wall-full');
    expect(isEditableByLayer(ed, rec)).toBe(false);
    expect(isOnVisibleLayer(ed, rec)).toBe(false);
    const svg = await saveWithTextCopies(ed);
    expect(svg).toContain('data-brick="wall"');
    expect(svg).not.toContain(BRICK_RECORD_ATTR);
  });

  it('BYTE-IDENTICAL to before item 22 (advisor): the download and the baked layer SVG equal the same board WITHOUT records or Wall/Frame owners', async () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    // a brush brick keeps its owner (it always shipped it)
    const brush = ed._sketchLayer.polygon('0,0 1,0 1,1'); brush.attr('data-brick', 'brush').attr('data-brick-gen', '1').attr('data-layer', '1').attr('data-brick-owner', 'be1:0');
    const now = { dl: await saveWithTextCopies(ed), layer: getLayerSvg(ed, '1', 96) };
    expect(now.layer).toContain('data-brick="wall"');
    // "before item 22": the same drawing with no records and no Wall/Frame owners
    q(ed, `[${BRICK_RECORD_ATTR}]`).forEach((n) => n.remove());
    q(ed, '[data-brick="wall"],[data-brick="frame"]').forEach((n) => n.removeAttribute('data-brick-owner'));
    expect(now.dl).toBe(await saveWithTextCopies(ed));
    expect(now.layer).toBe(getLayerSvg(ed, '1', 96));
    expect(now.dl).toContain('data-brick-owner="be1:0"'); // the brush brick's, as before
    expect(Object.keys(BRICK_EDITOR_ONLY_ATTRS).sort()).toEqual(['frame', 'wall']); // one declared list
  });
});
