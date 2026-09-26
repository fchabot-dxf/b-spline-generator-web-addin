/**
 * FB-APP S3 (F7): the 3D preview trims the panel to the frame's cut profile
 * and adds the wood bars; the editor's grid / snap / fit follow the outline.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, defaultFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  frameCutProfile, frameSolidSpec, frameSnapGate, frameFitRegion,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  sampleOutline, toWorld, pointInPolygon, trimIndices, sampleGridZ, ringArrays, applyFrameToPanel, frameLoopsWorld,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { buildHeightField } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';
import { fitView } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-view.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const rec = (id, extra = {}) => normalizeFrameRecord({ templateId: id, ...extra });

// A minimal stand-in for the THREE classes applyFrameToPanel touches.
const FakeTHREE = {
  DoubleSide: 2,
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.index = null; this.userData = {}; }
    setAttribute(k, a) { this.attributes[k] = a; }
    setIndex(ix) { this.index = { array: Array.isArray(ix) ? ix : Array.from(ix) }; }
    computeVertexNormals() {}
  },
  Float32BufferAttribute: class { constructor(arr, n) { this.array = Float32Array.from(arr); this.itemSize = n; } },
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  MeshPhongMaterial: class { constructor(o) { Object.assign(this, o); } },
};

function panel(W, H, nx, nz, topZ = 2, botZ = 0.5) {
  const top = buildHeightField(new Float32Array(nx * nz).fill(topZ), nx, nz, W, H);
  const bot = buildHeightField(new Float32Array(nx * nz).fill(botZ), nx, nz, W, H).pos;
  const g = new FakeTHREE.BufferGeometry();
  g.setAttribute('position', new FakeTHREE.Float32BufferAttribute(top.pos, 3));
  g.setIndex(top.indices);
  const mat = { clone() { return { ...this }; } };
  return { mesh: new FakeTHREE.Mesh(g, mat), grid: { W, H, nx, nz, topPos: top.pos, botPos: bot } };
}

describe('one outline source (editor profile == 3D outline == the definition the build reads)', () => {
  it.each(['template_1', 'template_2'])('%s: the 3D spec samples exactly the editor cut profile', (id) => {
    const prof = frameCutProfile(FRAME_DEFS, rec(id), BOARD);
    const spec = frameSolidSpec(FRAME_DEFS, rec(id), BOARD);
    expect(spec.outline).toEqual(sampleOutline(prof.primitives));
    expect(spec.innerPrimitives).toHaveLength(prof.primitives.length); // outer/inner pair by index (the bars)
  });

  it('no frame -> no 3D spec', () => {
    expect(frameSolidSpec(FRAME_DEFS, defaultFrameRecord(), BOARD)).toBeNull();
  });

  it('editor -> world mapping puts the editor top at world +y (T2 neck up, as in Fusion)', () => {
    const [p] = toWorld([{ x: 0, y: 0 }], 7, 9);
    expect(p).toEqual({ x: -3.5, y: 4.5 });
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_2'), BOARD);
    const w = toWorld(spec.outline, 7, 9);
    const widthAt = (sign) => Math.max(...w.filter((q) => Math.sign(q.y) === sign && Math.abs(q.y) > 3.5).map((q) => Math.abs(q.x)));
    expect(widthAt(1)).toBeLessThan(widthAt(-1)); // narrow neck at the top (+y), wide body at the bottom
  });
});

describe('trimmed panel', () => {
  it.each(['template_1', 'template_2'])('%s: every kept triangle lies inside the outline, and some are cut', (id) => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const full = mesh.geometry.index.array.length;
    const extra = applyFrameToPanel(FakeTHREE, mesh, grid, frameSolidSpec(FRAME_DEFS, rec(id), BOARD));
    const poly = frameLoopsWorld(frameSolidSpec(FRAME_DEFS, rec(id), BOARD), grid).outer; // the SAME loop the trim uses
    const ix = mesh.geometry.index.array, pos = mesh.geometry.attributes.position.array;
    expect(ix.length).toBeLessThan(full);
    for (let t = 0; t < ix.length; t += 3) {
      const cx = (pos[ix[t] * 3] + pos[ix[t + 1] * 3] + pos[ix[t + 2] * 3]) / 3;
      const cy = (pos[ix[t] * 3 + 1] + pos[ix[t + 1] * 3 + 1] + pos[ix[t + 2] * 3 + 1]) / 3;
      expect(pointInPolygon(cx, cy, poly)).toBe(true);
    }
    expect(extra.map((m) => m.name || 'wall')).toEqual(['wall', 'frame-bars']);
  });

  it('no frame = unchanged panel (the full index is restored exactly)', () => {
    const { mesh, grid } = panel(7, 9, 36, 46);
    const before = Array.from(mesh.geometry.index.array);
    applyFrameToPanel(FakeTHREE, mesh, grid, frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD));
    expect(applyFrameToPanel(FakeTHREE, mesh, grid, null)).toEqual([]);
    expect(Array.from(mesh.geometry.index.array)).toEqual(before);
  });
});

describe('bars', () => {
  it('run straight from frame-bottom z up to the panel underside, in the chosen wood', () => {
    const { mesh, grid } = panel(7, 9, 36, 46, 2, 0.5);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1', { frameBottomZ: -1, appearance: '3D Cherry - Unfinished' }), BOARD);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
    const z = [];
    const p = bars.geometry.attributes.position.array;
    for (let i = 2; i < p.length; i += 3) z.push(Math.round(p[i] * 1e6) / 1e6);
    expect([...new Set(z)].sort()).toEqual([-1, 0.5]); // bottom = frame bottom z, top = the (flat) underside
    expect(bars.material.color).toBe(FRAME_DEFS.appearance.previewColors['3D Cherry - Unfinished']);
  });

  it('changing the wood changes the bars colour (live, no rebuild of the spec source)', () => {
    const a = frameSolidSpec(FRAME_DEFS, rec('template_1', { appearance: '3D Ash - Unfinished' }), BOARD);
    const b = frameSolidSpec(FRAME_DEFS, rec('template_1', { appearance: '3D Mahogany - Unfinished' }), BOARD);
    expect(a.color).not.toBe(b.color);
    expect(a.outline).toEqual(b.outline);
  });

  it('changing frame_thickness moves the inner edge (live)', () => {
    const a = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const b = frameSolidSpec(FRAME_DEFS, rec('template_1', { params: { frame_thickness: 0.5 } }), BOARD);
    expect(b.inner).not.toEqual(a.inner);
    expect(b.outline).toEqual(a.outline);
  });

  it('ringArrays refuses loops that do not correspond', () => {
    expect(() => ringArrays([{ x: 0, y: 0 }], [], 0, () => 1)).toThrow(/correspond/);
  });

  it('sampleGridZ reads the underside', () => {
    const { grid } = panel(7, 9, 8, 10, 2, 0.5);
    expect(sampleGridZ(grid.botPos, 8, 10, 7, 9, 1.23, -2.1)).toBeCloseTo(0.5, 9);
  });
});

describe('editor grid / snap / fit follow the outline (AMEND 1)', () => {
  const editorWith = (id) => {
    const e = { _mW: 7, _mH: 9 };
    e._frameProfile = id ? frameCutProfile(FRAME_DEFS, rec(id), BOARD) : null;
    return e;
  };

  it('snapping inside the outline is unchanged; a snap landing in the cut-away falls back to the raw point', () => {
    const e = editorWith('template_1');
    const raw = { x: 0.1, y: 4.5 }, snapped = { x: 0, y: 4.5 }; // x=0 is in the cut-away (outline starts at 0.25)
    expect(frameSnapGate(e, snapped, raw)).toBe(raw);
    const inRaw = { x: 3.49, y: 4.51 }, inSnap = { x: 3.5, y: 4.5 };
    expect(frameSnapGate(e, inSnap, inRaw)).toBe(inSnap);
    expect(frameSnapGate(editorWith(null), snapped, raw)).toBe(snapped); // no frame: unchanged
  });

  it('fit-to-view frames the outline region (and the whole board with no frame)', () => {
    const applied = [];
    const e = { ...editorWith('template_1'), _draw: { viewbox: (...v) => applied.push(v) } };
    fitView(e);
    expect(frameFitRegion(e)).toEqual({ x: 0.25, y: 0.25, w: 6.5, h: 8.5 });
    // Aspect is preserved, so the limiting side fits exactly (height: 9/8.5) and the box contains the region.
    const [x, y, w, h] = applied[0];
    expect(h).toBeCloseTo(8.5, 9);
    expect(y).toBeCloseTo(0.25, 9);
    expect(x).toBeLessThanOrEqual(0.25 + 1e-9);
    expect(x + w).toBeGreaterThanOrEqual(6.75 - 1e-9);
    const e2 = { ...editorWith(null), _draw: { viewbox: (...v) => applied.push(v) } };
    fitView(e2);
    expect(applied[1]).toEqual([0, 0, 7, 9]);
  });
});

describe('editor grid is clipped to the outline (AMEND 1)', () => {
  it('clips the grid layer to the cut profile, and unclips with no frame', async () => {
    const { drawFrameProfile, setFrameProfileProvider, FRAME_GRID_CLIP_ID } = await import(
      '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js');
    const node = () => {
      const n = { kids: [], attrs: {}, id(v) { n.attrs.id = v; return n; }, attr(k, v) { n.attrs[k] = v; return n; },
        fill() { return n; }, stroke() { return n; }, addClass() { return n; },
        path(d) { const c = node(); c.attrs.d = d; n.kids.push(c); return c; },
        group() { const c = node(); c.parent = n; n.kids.push(c); return c; },
        remove() { if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); },
        findOne(sel) { return n.kids.find((c) => '#' + c.attrs.id === sel) || null; } };
      return n;
    };
    const draw = node();
    draw.clip = () => { const c = node(); c.parent = draw; draw.kids.push(c); return c; };
    const grid = { clipped: null, clipWith(c) { this.clipped = c; }, unclip() { this.clipped = null; } };
    const editor = { _bgLayer: node(), _draw: draw, _gridLayer: grid, _mW: 7, _mH: 9 };
    let record = rec('template_1');
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record }));
    const prof = drawFrameProfile(editor);
    expect(grid.clipped.attrs.id).toBe(FRAME_GRID_CLIP_ID);
    expect(grid.clipped.kids[0].attrs.d).toBe(prof.pathD);
    drawFrameProfile(editor);
    expect(draw.kids.filter((c) => c.attrs.id === FRAME_GRID_CLIP_ID)).toHaveLength(1); // replaced, not stacked
    record = defaultFrameRecord();
    drawFrameProfile(editor);
    expect(grid.clipped).toBeNull();
    expect(draw.findOne('#' + FRAME_GRID_CLIP_ID)).toBeNull();
  });
});
