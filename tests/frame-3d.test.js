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
  sampleOutline, toWorld, pointInPolygon, ringArrays, applyFrameToPanel, frameLoopsWorld,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { FakeTHREE, carvedPanel, PANEL_COLOUR } from './helpers/drawn-panel.js';
import { fitView } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-view.js';
import { frameColorFor } from '../bspline-frame-builder/b-spline-gen/html/core/color-utils.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const rec = (id, extra = {}) => normalizeFrameRecord({ templateId: id, ...extra });

/** A flat solid panel (the real buildSolidMesh): top at topZ, underside at botZ. */
const panel = (W, H, nx, nz, topZ = 2, botZ = 0.5) => carvedPanel(W, H, nx, nz, () => topZ, topZ - botZ);

describe('one outline source (editor profile == 3D outline == the definition the build reads)', () => {
  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: the 3D spec samples exactly the editor cut profile', (id) => {
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
  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: every kept triangle lies inside the outline, the cut ones become the rim', (id) => {
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
    expect(extra.map((m) => m.name)).toEqual(['frame-panel-rim', 'frame-panel-wall', 'frame-bars']);
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
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1', { frameBottomZ: -1, appearance: '3D Oak - Painted' }), BOARD);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
    const z = [];
    const p = bars.geometry.attributes.position.array;
    for (let i = 2; i < p.length; i += 3) z.push(Math.round(p[i] * 1e6) / 1e6);
    expect([...new Set(z)].sort()).toEqual([-1, 0.5]); // bottom = frame bottom z, top = the (flat) underside
    // H8: the bars use the declared frame colour for the wood (color-
    // utils.js's own FRAME_COLORS table), not the raw board colour.
    // H23 item 67d (Fred, direct: "the frame shouldn't change colour, only the board edge" --
    // reversing item 67b's own choice to also colour the bars): back to a single flat material
    // colour, no vertex colours at all -- the bars never carry the artwork, only the panel's own
    // wall does (frame-wall-edge-colour.test.js).
    expect(bars.material.color).toBe(frameColorFor('3D Oak - Painted', FRAME_DEFS.appearance.previewColors['3D Oak - Painted']));
    expect(bars.material.vertexColors).toBeFalsy();
  });

  it('H8: every declared wood\'s frame colour is its own declared FRAME_COLORS entry, never the raw board colour', () => {
    for (const [appearance, boardHex] of Object.entries(FRAME_DEFS.appearance.previewColors)) {
      const spec = frameSolidSpec(FRAME_DEFS, rec('template_1', { appearance }), BOARD);
      expect(spec.color).toBe(frameColorFor(appearance, boardHex));
      expect(spec.color).not.toBe(boardHex); // "a tiny bit different from the board" -- must not collapse back to it
    }
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

  it('ringArrays accepts a per-point zBottom function (T82 item 3: the window bars follow the underside on both faces, not a flat world z like the main frame\'s own bottom)', () => {
    const loop = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const inner = loop.map((p) => ({ x: p.x * 0.5 + 0.25, y: p.y * 0.5 + 0.25 }));
    const r = ringArrays(loop, inner, (p) => p.x - 1, () => 0); // zBottom varies with x, unlike a flat frame-bottom-z
    const z = [];
    for (let i = 2; i < r.positions.length; i += 3) z.push(r.positions[i]);
    expect(new Set(z).size).toBeGreaterThan(1); // not flat -- proves the function form actually varies per point
    expect(Math.min(...z)).toBeCloseTo(-1, 9); // the loop's x=0 corner -> zBottom(p) = -1
  });

});

describe('inset window (T82 item 3): subframe shown + exact hole clip', () => {
  const winRec = (extra = {}) => rec('template_1', {
    insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 }, frameBottomZ: -1, ...extra,
  });

  it('the subframe bars exist, in the frame\'s own material, between the underside and the main frame\'s own flat bottom', () => {
    const { mesh, grid } = panel(7, 9, 36, 46, 2, 0.5);
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const extra = applyFrameToPanel(FakeTHREE, mesh, grid, spec);
    const bars = extra.find((m) => m.name === 'frame-bars');
    const winBars = extra.find((m) => m.name === 'frame-window-bars');
    expect(winBars).toBeTruthy();
    expect(winBars.material).toBe(bars.material); // "the frame's own material" (the dispatch's own wording)
    const z = [];
    const p = winBars.geometry.attributes.position.array;
    for (let i = 2; i < p.length; i += 3) z.push(Math.round(p[i] * 1e6) / 1e6);
    // On this FLAT test panel, top and bottom both land flat, so this alone can't distinguish "top follows
    // the terrain" from "top is flat" -- the sculpted-panel test below proves that part. What this DOES
    // prove: the bottom is frameBottomZ (-1) itself, the SAME value the main bars' own bottom uses, not
    // frameBottomZ offset by the (here, coincidentally equal) underside height.
    expect([...new Set(z)].sort()).toEqual([-1, 0.5]);
    expect(extra.map((m) => m.name)).toContain('frame-window-wall');
  });

  it('T82 item 3 follow-up (Fred, 2nd look at the bottom-view shot): the subframe\'s BOTTOM is flat at the main frame\'s own frameBottomZ; only its TOP follows the sculpted terrain, so its thickness varies', () => {
    const { mesh, grid } = carvedPanel(7, 9, 71, 91, (x, y) => 2 + 0.3 * x, 1.5); // a sculpted top (varies with x) within the window's own footprint
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const winBars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-window-bars');
    const p = winBars.geometry.attributes.position.array;
    const z = []; for (let i = 2; i < p.length; i += 3) z.push(Math.round(p[i] * 1e6) / 1e6);
    const flatCount = z.filter((v) => v === -1).length; // spec.frameBottomZ
    expect(flatCount).toBeGreaterThan(0); // the flat frame-bottom-z plane is actually present...
    expect(flatCount).toBeLessThan(z.length); // ...but is not EVERY vertex: the top is not also flat
    expect(new Set(z).size).toBeGreaterThan(5); // the top genuinely varies across the ring, not just 2 values
    expect(Math.min(...z)).toBeCloseTo(-1, 6); // nothing sits below the main frame's own floor
  });

  it('off by default: no window bars/wall for a record with no insetWindow (byte-identical extras list)', () => {
    const { mesh, grid } = panel(7, 9, 36, 46);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const names = applyFrameToPanel(FakeTHREE, mesh, grid, spec).map((m) => m.name);
    expect(names).not.toContain('frame-window-bars');
    expect(names).not.toContain('frame-window-wall');
  });

  it('the hole is an EXACT rectangular cut (area-conserving), not a jagged terrain-grid staircase', () => {
    const area = (P, I) => {
      let s = 0;
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        s += Math.abs((P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a])) / 2;
      }
      return s;
    };
    const totalArea = (extra, mesh) => {
      let s = area(mesh.geometry.attributes.position.array, mesh.geometry.index.array);
      const rim = extra.find((m) => m.name === 'frame-panel-rim');
      if (rim) s += area(rim.geometry.attributes.position.array, rim.geometry.index.array);
      return s;
    };
    // A COARSE grid (cell ~0.5in, much larger than the window's own precision needs): a whole-triangle
    // (centroid) cull would miss the exact rectangle by a visible fraction of a grid cell here; an exact
    // clip matches it to floating-point precision regardless of grid coarseness.
    const noWin = panel(7, 9, 15, 19, 2, 0.5);
    const baseArea = totalArea(applyFrameToPanel(FakeTHREE, noWin.mesh, noWin.grid, frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD)), noWin.mesh);
    const withWin = panel(7, 9, 15, 19, 2, 0.5);
    const specWin = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const winArea = totalArea(applyFrameToPanel(FakeTHREE, withWin.mesh, withWin.grid, specWin), withWin.mesh);
    const holeArea = (specWin.insetWindow.hole.x2 - specWin.insetWindow.hole.x1) * (specWin.insetWindow.hole.y2 - specWin.insetWindow.hole.y1);
    // A solid (thickened) panel's kept+rim index carries BOTH the top surface and the underside, each with
    // the same XY footprint -- the hole cuts through both, so the footprint area drops by the hole's own
    // area TWICE (measured: with a flat 0.5/2 top/under panel, baseArea - winArea == 2*holeArea exactly).
    expect(winArea).toBeCloseTo(baseArea - 2 * holeArea, 6);
  });

  it('the hole cuts an EXACT rectangle, not a jagged terrain-grid staircase: a sample just outside stays covered, just inside is cut away', () => {
    // MUTATION-TESTED (not just asserted): reverting this file's exact clip to the old per-triangle
    // CENTROID cull makes every "inside" probe below come back covered too (the whole straddling
    // triangle survives because its centroid happened to land outside the hole) -- this test goes red
    // against that prior behaviour and green against the exact clip.
    const pointInTri = (p, a, b, c) => {
      const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(d) < 1e-14) return false;
      const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / d;
      const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / d;
      const w = 1 - u - v;
      return u >= -1e-9 && v >= -1e-9 && w >= -1e-9;
    };
    const coveredAtTop = (meshes, x, y, zTop) => meshes.some(({ position, index }) => {
      for (let t = 0; t < index.length; t += 3) {
        const ia = index[t] * 3, ib = index[t + 1] * 3, ic = index[t + 2] * 3;
        const a = { x: position[ia], y: position[ia + 1] }, b = { x: position[ib], y: position[ib + 1] }, c = { x: position[ic], y: position[ic + 1] };
        if (!pointInTri({ x, y }, a, b, c)) continue;
        if ([position[ia + 2], position[ib + 2], position[ic + 2]].some((z) => Math.abs(z - zTop) < 0.01)) return true;
      }
      return false;
    });

    const { mesh, grid } = panel(7, 9, 15, 19, 2, 0.5); // a COARSE grid (cell ~0.5in): a jagged cull is visible at this resolution
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const extra = applyFrameToPanel(FakeTHREE, mesh, grid, spec);
    const rim = extra.find((m) => m.name === 'frame-panel-rim');
    const meshes = [{ position: mesh.geometry.attributes.position.array, index: mesh.geometry.index.array }];
    if (rim) meshes.push({ position: rim.geometry.attributes.position.array, index: rim.geometry.index.array });

    const { W, H } = grid;
    const hole = spec.insetWindow.hole;
    const windowed = { x1: hole.x1 - W / 2, x2: hole.x2 - W / 2, y1: H / 2 - hole.y2, y2: H / 2 - hole.y1 };
    const midX = (windowed.x1 + windowed.x2) / 2, midY = (windowed.y1 + windowed.y2) / 2, eps = 0.1;
    const edges = [
      [windowed.x1 - eps, midY], [windowed.x2 + eps, midY], [midX, windowed.y1 - eps], [midX, windowed.y2 + eps],
    ];
    const insides = [
      [windowed.x1 + eps, midY], [windowed.x2 - eps, midY], [midX, windowed.y1 + eps], [midX, windowed.y2 - eps],
    ];
    for (const [x, y] of edges) expect(coveredAtTop(meshes, x, y, 2)).toBe(true);
    for (const [x, y] of insides) expect(coveredAtTop(meshes, x, y, 2)).toBe(false);
  });

  it('the window wall carries the panel\'s own vertex colours, not unset (Fred: the window wall rendered flat black on a real carved board) -- wallMat inherits vertexColors:true from the panel\'s own material whenever the board has carved colour data, so a geometry with no matching `color` attribute renders solid black there, not merely untinted. MUTATION-TESTED: dropping the window wall\'s own colour sampling (passing no 4th arg to _mesh) makes this fail -- the attribute is absent entirely, not just zero.', () => {
    const { mesh, grid } = panel(7, 9, 36, 46, 2, 0.5); // carvedPanel always supplies colour data (PANEL_COLOUR)
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const winWall = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-window-wall');
    const color = winWall.geometry.attributes.color;
    expect(color).toBeTruthy();
    const arr = color.array;
    expect(arr.length).toBeGreaterThan(0);
    for (let i = 0; i < arr.length; i += 3) {
      expect(arr[i]).toBeCloseTo(PANEL_COLOUR[0], 5);
      expect(arr[i + 1]).toBeCloseTo(PANEL_COLOUR[1], 5);
      expect(arr[i + 2]).toBeCloseTo(PANEL_COLOUR[2], 5);
    }
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
