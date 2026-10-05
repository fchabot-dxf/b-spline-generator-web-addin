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
  migrateBrickRecords, BRICK_LAID_ATTR,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { clearBrickElements, clearArtworkLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-clear.js';
import { saveWithTextCopies, getLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { isEditableByLayer, isOnVisibleLayer, BRICK_EDITOR_ONLY_ATTRS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateBricks as engineGenerate } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';

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

describe('item 22 step 5: a board saved BEFORE item 22 gets its records on load (one-time, idempotent)', () => {
  const OLD_KEY = '{"pattern":"herringbone","setIds":{"wall":1,"frame":3}}#frame:{"frame":null,"w":7,"h":9}';
  function oldBoard({ wall = true, frame = true, laidKinds = ['wall', 'frame'] } = {}) {
    const ed = fakeEditor();
    for (const [kind, on, pts] of [['wall', wall, '1,0 2,0 2,0.3'], ['frame', frame, '5,0 6,0 6,0.3']]) {
      if (!on) continue;
      const el = ed._sketchLayer.polygon(pts).node;
      el.setAttribute('data-brick', kind); el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-layer', '1');
    }
    Object.assign(ed._layers[1], { brickLaidKey: OLD_KEY, brickLaidKinds: laidKinds });
    return ed;
  }

  it('records for the laid kinds: the old shared key on each (nothing re-lays), its settings part as the snapshot, owners stamped, the old layer fields retired', () => {
    const ed = oldBoard();
    expect(migrateBrickRecords(ed)).toEqual(['wall', 'frame']);
    for (const kind of ['wall', 'frame']) {
      const rec = brickRecordNode(ed, kind);
      expect(rec.getAttribute(BRICK_LAID_ATTR)).toBe(OLD_KEY);
      expect(rec.getAttribute('display')).toBe('none');
      const id = rec.getAttribute('data-brick-element');
      expect(q(ed, `[data-brick="${kind}"]`).every((b) => b.getAttribute('data-brick-owner') === id)).toBe(true);
    }
    expect(JSON.parse(brickRecordNode(ed, 'wall').getAttribute('data-brick-settings'))).toMatchObject({ pattern: 'herringbone', setId: 1 });
    expect(JSON.parse(brickRecordNode(ed, 'frame').getAttribute('data-brick-settings')).setId).toBe(3);
    expect('brickLaidKey' in ed._layers[1]).toBe(false);
    expect('brickLaidKinds' in ed._layers[1]).toBe(false);
  });

  it('idempotent: a second load changes nothing; a board that already has records is untouched', () => {
    const ed = oldBoard();
    migrateBrickRecords(ed);
    const html = ed._sketchLayer.node.innerHTML;
    expect(migrateBrickRecords(ed)).toEqual([]);
    expect(ed._sketchLayer.node.innerHTML).toBe(html);
    const fresh = fakeEditor();
    runBricks(fresh, P.brickSettings, null, { laidKey: 'NEW' });
    const before = fresh._sketchLayer.node.innerHTML;
    expect(migrateBrickRecords(fresh)).toEqual([]);
    expect(fresh._sketchLayer.node.innerHTML).toBe(before);
  });

  it('a wall the bands squeezed to ZERO bricks (only in the old laid kinds) still becomes an element; no bricks and no kinds = nothing', () => {
    const ed = oldBoard({ wall: false });
    expect(migrateBrickRecords(ed)).toEqual(['wall', 'frame']);
    const bare = fakeEditor();
    expect(migrateBrickRecords(bare)).toEqual([]);
    expect(q(bare, `[${BRICK_RECORD_ATTR}]`)).toHaveLength(0);
  });
});

describe('item 22 step 5: Clear per kind = its records + bricks', () => {
  it('Clear Bricks removes every record with its bricks; Clear Artwork keeps them', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null, { laidKey: 'K' });
    clearArtworkLayers(ed);
    expect(q(ed, `[${BRICK_RECORD_ATTR}]`)).toHaveLength(2);
    clearBrickElements(ed);
    expect(q(ed, `[${BRICK_RECORD_ATTR}]`)).toHaveLength(0);
    expect(q(ed, '[data-brick-gen="1"]')).toHaveLength(0);
  });
});

describe('item 29 (a): the Wall’s Rustic reaches the engine for a running bond only', () => {
  it('input.rustic = the wall amount for stretcher; absent for stack, and absent at 0', () => {
    const lay = (pattern, wall) => { engineGenerate.mockClear(); runBricks(fakeEditor(), { ...P.brickSettings, pattern, rusticByElement: { wall, brush: 0 } }, null, { kinds: ['wall'] }); return engineGenerate.mock.calls[0][0]; };
    expect(lay('stretcher', 0.3).rustic).toBe(0.3);
    expect(lay('stack', 0.3).rustic).toBeUndefined();
    expect(lay('stretcher', 0).rustic).toBeUndefined();
  });
});

describe('grout per element: each element reaches the engine with its OWN joint', () => {
  it('a rock wall + a brick frame: the wall set carries the rock joint, the frame set the Red one', () => {
    engineGenerate.mockClear();
    runBricks(fakeEditor(), { ...P.brickSettings, pattern: 'fieldstone', groutByElement: { wall: null, frame: 0.05, brush: null } }, { primitives: [], bands: [] });
    const input = engineGenerate.mock.calls[0][0];
    expect(input.set.layout).toBe('fieldstone');
    expect(input.set.grout.widthIn).toBeGreaterThan(0.05); // the rock set's declared joint
    expect(input.frame.set.grout.widthIn).toBeCloseTo(0.05, 5); // the frame set is pre-scaled; grout is not scaled
  });
});
