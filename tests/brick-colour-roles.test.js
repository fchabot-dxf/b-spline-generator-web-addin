/**
 * Brick colour roles (seat A 2026-10-15; Fred's colour plan, paint only): every laid piece carries its role
 * (core/bricks/colour-roles.js -- field / motif / accent / stone, from the engine's OWN tags) as an editor-only
 * attribute: the drawing gains it, Send's Bricks sketch never does (byte-identical to a board laid without roles).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id, tags = {}) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }], ...tags });
  return {
    ...actual,
    generateBricks: vi.fn(() => ({
      bricks: [sq(1, 'w1'), sq(3, 'w2', { accentMarked: true }), sq(5, 'w3', { relief: 'recessed' })], // a wall's relief: field
      frameBricks: [sq(7, 'f1'), sq(9, 'f2', { relief: 'raised' }), sq(11, 'f3', { relief: 'flush' })],
      archBricks: [sq(13, 'a1', { part: 'keystone' }), sq(15, 'a2', { part: 'hood', relief: 'raised' }), sq(17, 'a3', { part: 'ring' })],
    })),
  };
});

import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { getLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { BRICK_EDITOR_ONLY_ATTRS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { BRICK_COLOUR_ROLES, BRICK_ROLE_ATTR, brickRoleOf } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/colour-roles.js';

function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => {
    const api = {
      node: el, type: el.tagName.toLowerCase(), fill: () => api, stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; },
      hasClass: (c) => el.classList.contains(c), remove: () => { el.remove(); return api; },
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
      path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}
const roleOfId = (ed, id) => ed._sketchLayer.node.querySelector(`[data-brick-id="${id}"]`)?.getAttribute(BRICK_ROLE_ATTR);

describe('colour roles, declared', () => {
  it('the roles and the rule: the engine tags decide, a wall relief stays field', () => {
    expect(BRICK_COLOUR_ROLES).toEqual(['field', 'motif', 'accent', 'stone', 'grout']);
    expect(brickRoleOf({ part: 'springer' }, 'frame')).toBe('stone');
    expect(brickRoleOf({ part: 'sillBlock', relief: 'raised' }, 'frame')).toBe('stone');
    expect(brickRoleOf({ relief: 'recessed' }, 'frame')).toBe('motif');
    expect(brickRoleOf({ relief: 'recessed' }, 'wall')).toBe('field');
    expect(brickRoleOf({ accentMarked: true }, 'wall')).toBe('accent');
    expect(brickRoleOf({ accentMarked: false }, 'wall')).toBe('field');
    expect(brickRoleOf({}, 'brush')).toBe('field');
  });
});

describe('a lay tags every piece with its role', () => {
  it('wall / frame / arch pieces each carry theirs', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    expect(['w1', 'w2', 'w3'].map((id) => roleOfId(ed, id))).toEqual(['field', 'accent', 'field']);
    expect(['f1', 'f2', 'f3'].map((id) => roleOfId(ed, id))).toEqual(['field', 'motif', 'field']);
    expect(['a1', 'a2', 'a3'].map((id) => roleOfId(ed, id))).toEqual(['stone', 'motif', 'field']); // keystone / hood / ring
  });

  it('the role is editor-only: Send’s Bricks sketch equals the same board with no roles at all', () => {
    for (const kind of ['wall', 'frame', 'brush']) expect(BRICK_EDITOR_ONLY_ATTRS[kind], kind).toContain(BRICK_ROLE_ATTR);
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const layerIds = [...new Set([...ed._sketchLayer.node.querySelectorAll('[data-brick]')].map((n) => n.getAttribute('data-layer')))];
    const sent = layerIds.map((l) => getLayerSvg(ed, l, 96, { bricks: 'only' }));
    expect(sent.join('')).not.toContain(BRICK_ROLE_ATTR);
    ed._sketchLayer.node.querySelectorAll(`[${BRICK_ROLE_ATTR}]`).forEach((n) => n.removeAttribute(BRICK_ROLE_ATTR));
    expect(layerIds.map((l) => getLayerSvg(ed, l, 96, { bricks: 'only' }))).toEqual(sent);
  });
});
