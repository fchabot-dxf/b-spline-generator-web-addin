/**
 * F35 item 13: the Wall's rotation reaches the engine as generateBricks `rotationDeg` (seat B's contract, T86
 * item 29) -- and 0 leaves the input exactly as today (no key at all, so the lay is byte-identical).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [], frameBricks: [] })) };
});

import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c) }; return api; };
  return {
    _draw: {}, _mW: 7, _mH: 9,
    _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _sketchLayer: { node, children: () => ({ toArray: () => [] }),
      group: () => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'g'); node.appendChild(el); return wrap(el); } },
  };
}
const laidInput = (deg) => {
  generateBricks.mockClear();
  runBricks(fakeEditor(), { ...P.brickSettings, pattern: 'stretcher', wallRotationDeg: deg }, null);
  return generateBricks.mock.calls[0][0];
};

describe('F35 item 13: rotationDeg into the engine', () => {
  it('45 and 90 go in as rotationDeg', () => {
    expect(laidInput(45).rotationDeg).toBe(45);
    expect(laidInput(90).rotationDeg).toBe(90);
  });
  it('0 / missing: no rotationDeg key at all (today\'s input)', () => {
    expect('rotationDeg' in laidInput(0)).toBe(false);
    expect('rotationDeg' in laidInput(undefined)).toBe(false);
  });
});
