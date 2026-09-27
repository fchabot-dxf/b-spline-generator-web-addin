/**
 * SE16 ✂ CUT tool (F18): chains by derivation, cutAt / join, snapping on the line (the H1 toggles, Q5), the
 * chain-aware drag helpers, and the Fusion side (an explicit Coincident at every cut). CUT-TOOL-DESIGN.md U1-U4, M1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { latticeChains, splitLine, chainOf, withChain, writeChainRow, updateJointSlide, pushTieJoints, MIN_PIECE_CELLS, JOINT_TOL } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-chains.js';
import { cutAt, join, jointAt, snapOnLine, cutIntent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-cut-tool.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { drawnFromPattern } from './helpers/drawn-lattice.js';
import { moveRailAlongAxis, orient, fromLattice } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

// ── a minimal svg.js-shaped element + editor (worldPoint = identity: no matrix()) ──
function makeEl(type, attrs, layer) {
  const store = { ...attrs };
  const el = {
    type,
    node: {
      getAttribute: (k) => (store[k] !== undefined ? String(store[k]) : null),
      setAttribute: (k, v) => { store[k] = v; }, hasAttribute: (k) => store[k] !== undefined,
      removeAttribute: (k) => { delete store[k]; },
    },
    attr(k, v) {
      if (typeof k === 'object') { for (const [kk, vv] of Object.entries(k)) { if (vv == null) delete store[kk]; else store[kk] = vv; } return el; }
      if (v === undefined) return store[k];
      store[k] = v; return el;
    },
    stroke(o) { if (o && o.color) store.stroke = o.color; return el; },
    fill(c) { store.fill = c; return el; },
    center(x, y) { store.cx = x; store.cy = y; return el; },
    clone() { return makeEl(type, { ...store }, layer); },
    insertAfter(other) { const list = layer.list; list.splice(list.indexOf(other) + 1, 0, el); return el; },
    remove() { const list = layer.list; list.splice(list.indexOf(el), 1); },
    store,
  };
  return el;
}
function makeEditor(pattern) {
  const layer = { list: [] };
  const editor = {
    _sketchLayer: { children: () => { const a = layer.list.slice(); a.toArray = () => a; return a; } },
    _layers: [{ id: 'R', pattern }], _activeLayer: 'R',
    _grid: { gridSnap: true, geometrySnap: false, spacing: 0.25 },
    commits: 0, pushState() { editor.commits++; }, _notifyChange() {},
    line(x1, y1, x2, y2, extra = {}) {
      const el = makeEl('line', { x1, y1, x2, y2, 'data-layer': 'R', ...extra }, layer);
      layer.list.push(el); return el;
    },
    node(cx, cy) { const el = makeEl('circle', { cx, cy, 'data-layer': 'N', 'data-lattice': 'node' }, layer); layer.list.push(el); return el; },
    _getNearbyElement(pt, tol) {
      let best = null, bestD = tol;
      for (const el of layer.list) {
        if (el.type !== 'line') continue;
        const [a, b] = [{ x: +el.store.x1, y: +el.store.y1 }, { x: +el.store.x2, y: +el.store.y2 }];
        const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy)));
        const d = Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y);
        if (d <= bestD) { bestD = d; best = el; }
      }
      return best;
    },
    layer,
  };
  return editor;
}
const RAIL = { 'data-lattice': 'rail', 'data-lattice-gen': 'p', stroke: '#333', 'stroke-width': 0.07 };
const pts = (el) => [+el.store.x1, +el.store.y1, +el.store.x2, +el.store.y2];

describe('U1 latticeChains: collinear + touching = one; a gap, another row or kind = separate', () => {
  const p = (kind, a, b) => ({ kind, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
  it('the unit cases', () => {
    const chains = latticeChains([
      p('rail', [0, 1], [1, 1]), p('rail', [1, 1], [3, 1]), p('rail', [3, 1], [4, 1]),   // one rail, 3 segments
      p('rail', [5, 1], [6, 1]),                                                          // a gap: its own
      p('rail', [0, 2], [2, 2]), p('rail', [2, 2 + 1e-7], [4, 2 + 1e-7]),                // 1e-7 off: still one
      p('rail', [0, 3], [2, 3]), p('rail', [2.001, 3], [4, 3]),                           // 1e-3 gap: two
      p('tie', [1, 0], [1, 1]), p('tie', [1, 1], [1, 2]),                                 // ties chain on their own axis
      p('tie', [3, 1], [4, 1]),                                                           // a tie is not a rail
    ]);
    const sizes = chains.map((c) => `${c.kind}:${c.segments.length}`).sort();
    expect(sizes).toEqual(['rail:1', 'rail:1', 'rail:1', 'rail:2', 'rail:3', 'tie:1', 'tie:2'].sort());
    const three = chains.find((c) => c.segments.length === 3);
    expect(three.segments.map((s) => s.a.x)).toEqual([0, 1, 3]); // ordered along the axis
  });
  it('splitLine: both halves share the SAME point', () => {
    const [[a, p1], [p2, b]] = splitLine({ x: 0, y: 1 }, { x: 4, y: 1 }, { x: 1.5, y: 1 });
    expect(p1).toEqual(p2);
    expect([a, b]).toEqual([{ x: 0, y: 1 }, { x: 4, y: 1 }]);
  });
});

describe('U2 cutAt / join', () => {
  let ed, rail;
  beforeEach(() => { ed = makeEditor({ spacing: 0.25, colors: { rails: '#333' } }); rail = ed.line(0, 1, 4, 1, RAIL); });

  it('cutAt splits a rail into two segments with IDENTICAL joint numbers, every attribute copied, one undo step', () => {
    const [a, b] = cutAt(ed, rail, { x: 1.5, y: 1 });
    expect(pts(a)).toEqual([0, 1, 1.5, 1]);
    expect(pts(b)).toEqual([1.5, 1, 4, 1]);
    for (const k of ['data-lattice', 'data-lattice-gen', 'data-layer', 'stroke', 'stroke-width']) expect(b.store[k]).toBe(a.store[k]);
    expect(ed.layer.list.indexOf(b)).toBe(ed.layer.list.indexOf(a) + 1);
    expect(ed.commits).toBe(1);
    expect(chainOf(ed, a).segments.map((s) => s.el)).toEqual([a, b]); // still ONE rail by derivation
  });

  it('refuses a lattice cut closer than one cell to an end; a plain line may be cut anywhere inside', () => {
    expect(cutAt(ed, rail, { x: 0.2, y: 1 })).toBeNull();
    expect(ed.commits).toBe(0);
    const plain = ed.line(0, 3, 1, 3, { stroke: '#000' });
    expect(cutAt(ed, plain, { x: 0.05, y: 3 })).not.toBeNull();
  });

  it('join undoes a cut: the original geometry back, the colour overrides of BOTH cleared (Q4)', () => {
    const [a, b] = cutAt(ed, rail, { x: 1.5, y: 1 });
    a.attr({ stroke: '#f00', 'data-override-color': '#f00' });
    b.attr({ stroke: '#00f', 'data-override-color': '#00f' });
    expect(jointAt(ed, { x: 1.5, y: 1 })).toEqual([a, b]);
    const j = join(ed, { x: 1.5, y: 1 });
    expect(j).toBe(a);
    expect(pts(j)).toEqual([0, 1, 4, 1]);
    expect(ed.layer.list.includes(b)).toBe(false);
    expect(j.store['data-override-color']).toBeUndefined();
    expect(j.store.stroke).toBe('#333'); // the lattice default colour
    expect(ed.commits).toBe(2);
  });

  it('a tap on a point that is not a joint joins nothing; a gap is never a joint', () => {
    expect(jointAt(ed, { x: 4, y: 1 })).toBeNull();
    ed.line(4.5, 1, 6, 1, RAIL);
    expect(jointAt(ed, { x: 4, y: 1 })).toBeNull();
  });

  it('cutIntent: near a joint = join, elsewhere on a line = cut', () => {
    cutAt(ed, rail, { x: 1.5, y: 1 });
    expect(cutIntent(ed, { x: 1.52, y: 1.01 }).action).toBe('join');
    expect(cutIntent(ed, { x: 3, y: 1.01 }).action).toBe('cut');
  });
});

describe('U3 snapOnLine: the normal H1 toggles, restricted to the line (Q5)', () => {
  it('GRID on: a grid crossing ON the line; Alt or both toggles off: the exact projection', () => {
    const ed = makeEditor({ spacing: 0.25 });
    const rail = ed.line(0.1, 1.3, 4.1, 1.3, RAIL); // an off-grid (RAIL-SPACING) row
    const g = snapOnLine(ed, rail, { x: 1.43, y: 1.36 });
    expect(g.x).toBeCloseTo(1.5, 12); expect(g.y).toBeCloseTo(1.3, 12); // the rail's own row, a grid column
    expect(snapOnLine(ed, rail, { x: 1.43, y: 1.36 }, true).x).toBeCloseTo(1.43, 12); // Alt: exact
    ed._grid.gridSnap = false;
    expect(snapOnLine(ed, rail, { x: 1.43, y: 1.36 }).x).toBeCloseTo(1.43, 12);
  });
});

describe('the chain-aware drag helpers', () => {
  let ed, segs;
  const setup = () => {
    ed = makeEditor({ spacing: 0.25 });
    const rail = ed.line(0.5, 1, 4, 1, RAIL);
    const [a, b] = cutAt(ed, rail, { x: 1.5, y: 1 });
    const [, c] = cutAt(ed, b, { x: 3, y: 1 });
    segs = [a, b, c];
  };
  const baseMove = (el, mode, extra = {}) => ({ kind: 'rail', mode, el, spacing: 0.25, orientation: 'horizontal', ...extra });

  it('a body move of ANY segment covers the whole rail\'s extent; every segment takes the new row', () => {
    setup();
    const m = withChain(ed, baseMove(segs[1], 'move', { railCanon: { a: { i: 6, j: 4 }, b: { i: 12, j: 4 } } }));
    expect(m.chain.map((s) => s.el)).toEqual(segs);
    expect(m.railCanon).toEqual({ a: { i: 2, j: 4 }, b: { i: 16, j: 4 } }); // 0.5 .. 4 in, /0.25
    expect([...m.excludeSet]).toEqual(segs);                                  // U4: never snaps onto itself
    writeChainRow(m, 6);
    expect(segs.map(pts)).toEqual([[0.5, 1.5, 1.5, 1.5], [1.5, 1.5, 3, 1.5], [3, 1.5, 4, 1.5]]);
  });

  it('a grab at a JOINT becomes a joint slide (both ends together, clamped to one cell each side); an outer end stays a stretch', () => {
    setup();
    const j = withChain(ed, baseMove(segs[0], 'stretch', { end: 'b' }));
    expect(j.mode).toBe('joint');
    updateJointSlide(j, 8); // 2 in
    expect(pts(segs[0])[2]).toBeCloseTo(2, 12);
    expect(pts(segs[1])[0]).toBeCloseTo(2, 12);           // no gap
    updateJointSlide(j, 100);                              // past the next joint: clamped one cell short of it
    expect(pts(segs[0])[2]).toBeCloseTo(3 - 0.25, 12);
    const outer = withChain(ed, baseMove(segs[0], 'stretch', { end: 'a' }));
    expect(outer.mode).toBe('stretch');
  });

  it('JOINT_TOL is SE7i\'s own 1e-6', () => { expect(JOINT_TOL).toBe(1e-6); });
});

describe('M1: Fusion side, a cut rail sent AS DRAWN', () => {
  const REGION = { x: 0, y: 0, w: 7, h: 9 };
  const BOX = { id: 'p', spacing: 0.25, rails: { mode: 'every', every: 4, offset: 0 },
    ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
    nodes: { ends: true, crossings: true, railEnds: false }, widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: true } };
  it('3 Slots on one line, one Collinear + one explicit Coincident per cut, stroke_width drives all 3, no node triangle', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const r = drawn.rails[1];
    const [lo, hi] = [Math.min(r.p1.x, r.p2.x), Math.max(r.p1.x, r.p2.x)];
    // cut ON a tie crossing (a node sits there) and mid-rail (nothing there)
    const onRow = drawn.nodes.filter((n) => Math.abs(n.c.y - r.p1.y) < 1e-9 && n.c.x > lo + 0.3 && n.c.x < hi - 0.6);
    expect(onRow.length).toBeGreaterThan(0);
    const xCross = onRow[0].c.x, xMid = (xCross + hi) / 2;
    const seg = (x0, x1) => ({ p1: { x: x0, y: r.p1.y }, p2: { x: x1, y: r.p1.y }, overrideWidth: null });
    const rails = [drawn.rails[0], seg(lo, xCross), seg(xCross, xMid), seg(xMid, hi), ...drawn.rails.slice(2)];
    const m = buildSketchManifest(BOX, REGION, { drawn: { ...drawn, rails } });
    const ids = ['rail1', 'rail2', 'rail3'];
    const joints = m.constraints.filter((c) => c.type === 'Coincident' && ids.includes(c.targets[0].split(':')[0]) && ids.includes(c.targets[1].split(':')[0]));
    expect(joints.map((c) => c.targets)).toEqual([['rail1:E', 'rail2:S'], ['rail2:E', 'rail3:S']]);
    expect(m.constraints.filter((c) => c.type === 'Collinear' && ids.includes(c.targets[0]))).toHaveLength(2);
    for (const id of ids) expect(m.dimensions.find((d) => d.target === id).expression).toBe('stroke_width');
    // no triangle at a joint: every OTHER entity touching it (a tie end, a node) attaches to exactly ONE of the two
    // segment ends (the joint's own Coincident implies the other), and the tie-crossing cut really has one
    let attached = 0;
    for (const [e1, e2] of joints.map((c) => c.targets)) {
      const legs = m.constraints.filter((c) => c.type === 'Coincident' && !(c.targets.includes(e1) && c.targets.includes(e2))
        && (c.targets.includes(e1) || c.targets.includes(e2)));
      const byOther = new Map();
      for (const c of legs) { const other = c.targets.find((t) => t !== e1 && t !== e2); byOther.set(other, (byOther.get(other) || 0) + 1); }
      for (const n of byOther.values()) expect(n).toBe(1);
      attached += byOther.size;
    }
    expect(attached).toBeGreaterThan(0);
  });
});

describe('M1b: a node on a joint where a tie passes THROUGH (not ending there)', () => {
  const REGION = { x: 0, y: 0, w: 7, h: 9 };
  const BOX = { id: 'p', spacing: 0.25, rails: { mode: 'every', every: 4, offset: 0 },
    ties: { mode: 'density', density: 0 }, nodes: { ends: false, crossings: false, railEnds: false },
    widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: true } };
  it('the node attaches to ONE segment end (plus the tie), never to both ends of the joint', () => {
    const drawn = drawnFromPattern(BOX, REGION);
    const r = drawn.rails[1], y = r.p1.y;
    const [lo, hi] = [Math.min(r.p1.x, r.p2.x), Math.max(r.p1.x, r.p2.x)];
    const xc = lo + 1.5;
    const rails = [drawn.rails[0], { p1: { x: lo, y }, p2: { x: xc, y }, overrideWidth: null },
      { p1: { x: xc, y }, p2: { x: hi, y }, overrideWidth: null }, ...drawn.rails.slice(2)];
    const ties = [{ p1: { x: xc, y: y - 0.5 }, p2: { x: xc, y: y + 0.5 }, overrideWidth: null }];
    const nodes = [{ c: { x: xc, y }, overrideWidth: null }];
    const m = buildSketchManifest(BOX, REGION, { drawn: { rails, ties, nodes } });
    const legs = m.constraints.filter((c) => c.type === 'Coincident' && c.targets[0] === 'node0:C').map((c) => c.targets[1]);
    expect(legs.filter((t) => t === 'rail1:E' || t === 'rail2:S')).toHaveLength(1);
    expect(legs).toContain('tie0');
    expect(m.constraints).toContainEqual({ type: 'Coincident', targets: ['rail1:E', 'rail2:S'] });
  });
});

describe('F19: a rail dragged across a CUT tie joint pushes the joint along (Fred, option b)', () => {
  const TIE = { 'data-lattice': 'tie', 'data-lattice-gen': 'p', stroke: '#333', 'stroke-width': 0.05 };
  const S = 0.25;
  // one scene per orientation, written in (along-rail, across-rail) coordinates: T maps them to world
  for (const orientation of ['horizontal', 'vertical']) {
    const T = (u, v) => (orientation === 'horizontal' ? [u, v] : [v, u]);
    const scene = (tieCuts, beyond = null) => {
      const ed = makeEditor({ spacing: S });
      const rail = ed.line(...T(0.5, 1), ...T(4, 1), RAIL);
      let tie = ed.line(...T(2, 1), ...T(2, 3), TIE);
      const segs = [];
      for (const v of tieCuts) { const [a, b] = cutAt(ed, tie, { x: T(2, v)[0], y: T(2, v)[1] }); segs.push(a); tie = b; }
      segs.push(tie);
      if (beyond) segs.push(...cutAt(ed, ed.line(...T(beyond, 1), ...T(beyond, 3), TIE), { x: T(beyond, 2)[0], y: T(beyond, 2)[1] }));
      const canon = (el) => ({ a: orient({ i: +el.store.x1 / S, j: +el.store.y1 / S }, orientation), b: orient({ i: +el.store.x2 / S, j: +el.store.y2 / S }, orientation) });
      const r = canon(rail);
      const m = withChain(ed, { kind: 'rail', mode: 'move', el: rail, spacing: S, orientation, railCanon: r,
        ties: segs.map((el) => ({ el, ...canon(el) })), nodes: [] });
      // the real per-frame order (editor-interaction.js _updateLatticeMove + _writeRailMove): push, then the rail
      const dragTo = (v) => {
        const j = pushTieJoints(m, v / S);
        const res = moveRailAlongAxis(m.railCanon, j, m.ties, m.nodes);
        const a = fromLattice(orient(res.rail.a, orientation), S), b = fromLattice(orient(res.rail.b, orientation), S);
        rail.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        for (const { tie: t, end, point } of res.tieUpdates) {
          const p = fromLattice(orient(point, orientation), S);
          t.el.attr(end === 'a' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y });
        }
        return j * S;
      };
      // each tie segment as [v start, v end] along the tie; plus its u (straightness)
      const along = (el) => (orientation === 'horizontal' ? [+el.store.y1, +el.store.y2] : [+el.store.x1, +el.store.x2]);
      const across = (el) => (orientation === 'horizontal' ? [+el.store.x1, +el.store.x2] : [+el.store.y1, +el.store.y2]);
      return { ed, rail, segs, m, dragTo, along, across };
    };

    it(`${orientation}: past the joint -> the joint is pushed ahead, both segments >= the minimum, coincident, straight`, () => {
      const { segs, dragTo, along, across } = scene([2]);
      expect(dragTo(2.5)).toBeCloseTo(2.5, 12);                      // never blocked here
      const [n, f] = segs.map(along);
      expect(n[0]).toBeCloseTo(2.5, 12);                             // the attached end rides the rail
      expect(n[1]).toBeCloseTo(2.5 + MIN_PIECE_CELLS * S, 12);       // the joint, one cell ahead
      expect(f[0]).toBe(n[1]);                                       // still coincident (the same number)
      expect(f[1]).toBeCloseTo(3, 12);                               // the far end stays
      expect(n[1] - n[0]).toBeGreaterThanOrEqual(MIN_PIECE_CELLS * S - 1e-12);
      expect(f[1] - f[0]).toBeGreaterThanOrEqual(MIN_PIECE_CELLS * S - 1e-12);
      for (const el of segs) for (const u of across(el)) expect(u).toBeCloseTo(2, 12); // still one straight tie
    });

    it(`${orientation}: the one clamp -- the far segment keeps the minimum too; moving back lets the joint return`, () => {
      const { segs, dragTo, along } = scene([2]);
      expect(dragTo(3.75)).toBeCloseTo(3 - 2 * MIN_PIECE_CELLS * S, 12);
      expect(along(segs[1])[1] - along(segs[1])[0]).toBeCloseTo(MIN_PIECE_CELLS * S, 12);
      expect(dragTo(1.5)).toBeCloseTo(1.5, 12);
      expect(along(segs[0])[1]).toBeCloseTo(2, 12);                  // back at its own place: a push, not a drag
    });

    it(`${orientation}: 2 cuts -> only the NEAREST joint is pushed`, () => {
      const { segs, dragTo, along } = scene([1.75, 2.5]);
      dragTo(2);
      expect(along(segs[0])[1]).toBeCloseTo(2.25, 12);
      expect(along(segs[1])[0]).toBeCloseTo(2.25, 12);
      expect(along(segs[1])[1]).toBeCloseTo(2.5, 12);                // the second joint untouched
      expect(dragTo(3)).toBeCloseTo(2.5 - 2 * MIN_PIECE_CELLS * S, 12); // clamped by the segment up to the next joint
    });

    it(`${orientation}: an UNCUT tie is unchanged (no push record; it just shrinks with the rail)`, () => {
      const { m, segs, dragTo, along } = scene([]);
      expect(m.tiePush).toBeUndefined();
      expect(dragTo(2.5)).toBeCloseTo(2.5, 12);
      expect(along(segs[0])).toEqual([2.5, 3]);
    });

    it(`${orientation}: a cut tie on the rail's row but BEYOND its end is not attached, so not pushed`, () => {
      const { segs, dragTo, along } = scene([2], 5);
      dragTo(2.5);
      expect(along(segs[2])).toEqual([1, 2]);
      expect(along(segs[3])).toEqual([2, 3]);
    });
  }
});
