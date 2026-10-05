/**
 * F35 item 31e: the pattern builder edits the BOND too. A tile on base 'custom' carries its own bond (brick-accents.js
 * BOND_CUSTOM: per course the pieces in cells + an offset in cells); join / split / offset are pure operations on it;
 * customBondFor scales it into the engine's customBond (seat B T86-27) and the wall lays it -- row 0 = the bottom course
 * (core COURSE_ROW_ORIGIN), the marks per piece from the engine. Real engine, fake editor (as wall-areas).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
const engineOpts = vi.hoisted(() => ({ without: [] })); // the mock-base rule: both states of 'customBond'
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get ENGINE_OPTIONS() { return actual.ENGINE_OPTIONS.filter((o) => !engineOpts.without.includes(o)); } };
});

import { runBricks, BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import {
  BOND_CUSTOM, blankBond, bondJoin, bondSplit, bondShift, bondTogglePiece, pieceOfCells, customBondFor, accentLayInput,
  userPatternFrom, accentOfUserPattern, wallPatternOfBase, makeTile, ACCENT_MARK_ATTR,
} from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const customTile = (rows, cols, unit = 0.5) => ({ ...makeTile(rows, cols, null, { base: BOND_CUSTOM, unit }), bond: blankBond(rows, cols) });
const pieces = (t, r) => t.bond.courses[r].pieces;
const row = (t, r) => t.cells[r].map((v) => (v ? 1 : 0)).join('');
beforeEach(() => { engineOpts.without = []; });

describe('31e: the bond operations (pure)', () => {
  it('Custom = a blank grid: every cell its own piece, no offset', () => {
    expect(blankBond(2, 4)).toEqual({ courses: [{ pieces: [1, 1, 1, 1], offset: 0 }, { pieces: [1, 1, 1, 1], offset: 0 }] });
  });
  it('a drag across cells joins every piece it touches into one; the joined brick takes the first one’s mark', () => {
    let t = customTile(2, 6);
    t = bondTogglePiece(t, 0, 1);
    t = bondJoin(t, 0, 1, 3);
    expect(pieces(t, 0)).toEqual([3, 1, 1, 1]);
    expect(pieceOfCells(t.bond.courses[0], 6)).toEqual([3, 0, 0, 0, 1, 2]);
    expect(row(t, 0)).toBe('011100');
    expect(pieces(t, 1)).toEqual([1, 1, 1, 1, 1, 1]); // other courses untouched
    expect(bondJoin(t, 0, 2, 3)).toBe(t); // inside one piece: nothing to join
  });
  it('a tap on a joint splits the brick there; a tap on a piece raises the whole piece', () => {
    let t = bondJoin(customTile(1, 6), 0, 0, 3);
    t = bondTogglePiece(t, 0, 2);
    expect(row(t, 0)).toBe('111100');
    t = bondSplit(t, 0, 2);
    expect(pieces(t, 0)).toEqual([2, 2, 1, 1]);
    expect(row(t, 0)).toBe('111100'); // both halves keep the mark
    expect(bondSplit(t, 0, 2)).toBe(t); // a piece's own start: no joint inside it there
  });
  it('an offset moves a course’s joints AND its marks together', () => {
    let t = bondTogglePiece(bondJoin(customTile(1, 4), 0, 0, 1), 0, 0);
    expect([pieceOfCells(t.bond.courses[0], 4), row(t, 0)]).toEqual([[0, 0, 1, 2], '1100']);
    t = bondShift(t, 0, 1);
    expect([pieceOfCells(t.bond.courses[0], 4), row(t, 0)]).toEqual([[2, 0, 0, 1], '0110']);
    t = bondShift(t, 0, 3); // round the tile
    expect([pieceOfCells(t.bond.courses[0], 4), row(t, 0)]).toEqual([[0, 0, 1, 2], '1100']);
  });
  it('customBondFor = the engine shape: cells x unit (brick units / pitches); accentLayInput sends cuts + bond, each when listed', () => {
    const t = bondShift(bondJoin(customTile(1, 4, 0.5), 0, 0, 1), 0, -1);
    expect(customBondFor(t)).toEqual({ courses: [{ pieces: [1, 0.5, 0.5], offset: 0.5 }] });
    const acc = { preset: 'tile', tile: t };
    expect(Object.keys(accentLayInput(acc, ['accentCuts', 'customBond']))).toEqual(['accentCuts', 'customBond']);
    expect(accentLayInput(acc, ['accentCuts'])).not.toHaveProperty('customBond');
    expect(customBondFor(makeTile(2, 4))).toBeNull(); // a built-in base has no bond of its own
  });
  it('a saved pattern = { bond: custom courses, accent, unit, level }; picking it gives back the same tile on the stretcher grid', () => {
    const t = bondTogglePiece(bondJoin(customTile(2, 4), 0, 0, 1), 0, 0);
    const u = userPatternFrom('Mine', t, -0.0625);
    expect(u.bond).toEqual({ custom: { courses: t.bond.courses } });
    expect(u).toMatchObject({ unit: 0.5, level: -0.0625, accent: { tile: { rows: 2, cols: 4 } } });
    const back = accentOfUserPattern(u).tile;
    expect([back.base, back.bond, back.cells, back.unit]).toEqual([BOND_CUSTOM, t.bond, t.cells, 0.5]);
    expect(wallPatternOfBase(back.base)).toBe('stretcher');
    expect(userPatternFrom('Plain', makeTile(2, 4), 0.06).bond).toEqual({ builtin: 'stretcher' }); // built-in unchanged
  });
});

describe('31e: the wall lays the custom bond (real engine)', () => {
  function fakeEditor() {
    const node = document.createElement('div');
    const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c),
      fill: () => api, stroke: () => api }; return api; };
    const svgEl = (tag) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return el; };
    return { _draw: {}, _mW: 7, _mH: 9, _activeLayer: '0', _layers: [{ id: '0', name: 'Layer 1', visible: true }],
      _sketchLayer: { node, children: () => ({ toArray: () => [] }), group: () => wrap(svgEl('g')), polygon: (pts) => { const el = svgEl('polygon'); el.setAttribute('points', pts); return wrap(el); } } };
  }
  // row 0 (bottom): one whole brick + two halves, the whole one raised; row 1: four halves
  const tile = () => bondTogglePiece(bondJoin(customTile(2, 4, 0.5), 0, 0, 1), 0, 0);
  const S = (accent) => ({ ...P.brickSettings, pattern: 'stretcher', wallRotationDeg: 0, setIds: { ...(P.brickSettings.setIds || {}), wall: 1 }, accent });
  const box = (n) => { const pts = n.getAttribute('points').trim().split(/\s+/).map((p) => p.split(',').map(Number)); const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
  /** per course, BOTTOM course first: each whole (unclipped) piece as { cell: its start cell in the 4-cell tile, w: its
   *  width in bricks, m: marked }. The joint J and the pitch are MEASURED from the lay (a gap inside a course; a whole
   *  brick's width + J), never re-derived from the set. */
  function coursesBottomUp(ed) {
    const boxes = [...ed._sketchLayer.node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][data-brick="wall"]`)].map((n) => ({ ...box(n), m: n.getAttribute(ACCENT_MARK_ATTR) === '1' }));
    const rows = new Map();
    for (const b of boxes) { const y = Math.round(b.y0 * 100); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(b); }
    const courses = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((p, q) => p.x0 - q.x0));
    const J = courses[0][1].x0 - courses[0][0].x1;
    const pitch = Math.max(...boxes.map((b) => b.x1 - b.x0)) + J;
    return courses.map((r) => r.filter((b) => b.x1 < 7 - 1e-3) // the right side's closer is clipped
      .map((b) => ({ cell: ((Math.round(b.x0 / (pitch / 2)) % 4) + 4) % 4, w: Math.round(((b.x1 - b.x0 + J) / pitch) * 4) / 4, m: b.m })));
  }
  it('the bottom course = tile row 0 (a whole brick raised + two halves), the next = four halves, repeating', () => {
    const ed = fakeEditor();
    runBricks(ed, S({ preset: 'tile', tile: tile(), levelIn: 0.0625, clicks: [] }), null);
    const rows = coursesBottomUp(ed);
    expect(rows.length).toBeGreaterThan(10);
    const ROW0 = { 0: { w: 1, m: true }, 2: { w: 0.5, m: false }, 3: { w: 0.5, m: false } };
    rows.slice(0, -1).forEach((r, k) => { // the top course is cut by the board
      expect(r.length, `course ${k}`).toBeGreaterThan(6);
      for (const p of r) expect({ w: p.w, m: p.m }, `course ${k} piece at cell ${p.cell}`).toEqual(k % 2 === 0 ? ROW0[p.cell] : { w: 0.5, m: false });
    });
  });
  it('hidden until the engine lists customBond: a custom tile adds nothing, the wall lays its plain stretcher bond', () => {
    engineOpts.without = ['customBond'];
    const a = fakeEditor(), b = fakeEditor();
    runBricks(a, S({ preset: 'tile', tile: tile(), levelIn: 0.0625, clicks: [] }), null);
    runBricks(b, S({ preset: 'none', levelIn: 0.0625, clicks: [] }), null);
    const pts = (ed) => [...ed._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n) => n.getAttribute('points'));
    expect(pts(a).length).toBeGreaterThan(50);
    expect(pts(a)).toEqual(pts(b));
    expect(accentLayInput({ preset: 'tile', tile: tile() }, ['accentCuts'])).toEqual({});
  });
});
