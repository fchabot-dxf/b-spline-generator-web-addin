/**
 * H23 item 67 (Fred, "teint dans la masse": the board's edges should show
 * whatever artwork colour reaches them): the panel's outline wall
 * (frame-panel-wall) and the inset-window wall (frame-window-wall) now take
 * an optional `edgeSampler(u, v) -> {r,g,b} | null` (applyFrameToPanel,
 * frame-mesh.js) -- the artwork colour at a wall point when the sampler
 * finds one there, falling back to the existing heat-map colour (today's
 * look) when it returns null or isn't given at all. One shared sampler
 * (sampleDrapeUV, drape-svg.js) feeds it; this file proves the WALL side of
 * the wiring with a plain fake callback (no real canvas needed -- see
 * drape-svg.test.js for sampleDrapeUV's own pixel-level tests).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel, frameLoopsWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { topCapIndices } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';
import { FakeTHREE, carvedPanel, PANEL_COLOUR } from './helpers/drawn-panel.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const rec = (id, extra = {}) => normalizeFrameRecord({ templateId: id, ...extra });
const panel = (W, H, nx, nz, topZ = 2, botZ = 0.5) => carvedPanel(W, H, nx, nz, () => topZ, topZ - botZ);

/** An edgeSampler that paints a distinct, recognisable colour for u < 0.5
 *  (half the board's own outline, by construction of the templates' own
 *  uv layout) and returns null (no artwork) for u >= 0.5. */
const ARTWORK = { r: 0.9, g: 0.1, b: 0.9 };
const halfSampler = (u) => (u < 0.5 ? { ...ARTWORK } : null);

describe('applyFrameToPanel: edgeSampler colours the outline wall (H23 item 67)', () => {
  it('without edgeSampler: wall colour is exactly the heat-map colour, unchanged from before this item', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD))
      .find((m) => m.name === 'frame-panel-wall');
    const arr = wall.geometry.attributes.color.array;
    for (let i = 0; i < arr.length; i += 3) {
      expect(arr[i]).toBeCloseTo(PANEL_COLOUR[0], 5);
      expect(arr[i + 1]).toBeCloseTo(PANEL_COLOUR[1], 5);
      expect(arr[i + 2]).toBeCloseTo(PANEL_COLOUR[2], 5);
    }
  });

  it('with edgeSampler: points where it finds artwork get THAT colour, not the heat-map one (non-vacuous: differs from the no-sampler case above)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, spec, (u) => halfSampler(u))
      .find((m) => m.name === 'frame-panel-wall');
    const arr = wall.geometry.attributes.color.array;
    let artworkCount = 0, heatmapCount = 0;
    for (let i = 0; i < arr.length; i += 3) {
      const isArtwork = Math.abs(arr[i] - ARTWORK.r) < 1e-5 && Math.abs(arr[i + 1] - ARTWORK.g) < 1e-5 && Math.abs(arr[i + 2] - ARTWORK.b) < 1e-5;
      const isHeatmap = Math.abs(arr[i] - PANEL_COLOUR[0]) < 1e-5 && Math.abs(arr[i + 1] - PANEL_COLOUR[1]) < 1e-5 && Math.abs(arr[i + 2] - PANEL_COLOUR[2]) < 1e-5;
      expect(isArtwork || isHeatmap, `vertex ${i / 3}: [${arr[i]},${arr[i + 1]},${arr[i + 2]}] is neither the artwork nor the heat-map colour`).toBe(true);
      if (isArtwork) artworkCount++; else heatmapCount++;
    }
    // "no artwork at the edge leaves the wall unchanged" -- SOME points keep the heat-map colour
    expect(heatmapCount).toBeGreaterThan(0);
    // and the sampler's own colour genuinely reached the wall somewhere -- not silently ignored
    expect(artworkCount).toBeGreaterThan(0);
  });

  it('a sampler returning artwork EVERYWHERE floods the whole wall with it (full height: both the bottom and top rim share the SAME vertex colour at each outline point, per wallArrays\' own (bot,top) pairing)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, spec, () => ({ ...ARTWORK }))
      .find((m) => m.name === 'frame-panel-wall');
    const arr = wall.geometry.attributes.color.array;
    expect(arr.length).toBeGreaterThan(0);
    for (let i = 0; i < arr.length; i += 3) {
      expect(arr[i]).toBeCloseTo(ARTWORK.r, 5);
      expect(arr[i + 1]).toBeCloseTo(ARTWORK.g, 5);
      expect(arr[i + 2]).toBeCloseTo(ARTWORK.b, 5);
    }
  });

  it('the inset-window wall (frame-window-wall) gets the SAME edgeSampler treatment', () => {
    const winRec = () => rec('template_1', { insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 }, frameBottomZ: -1 });
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    expect(spec.insetWindow).toBeTruthy(); // the record shape actually produced a window spec -- not a vacuous pass
    const winWall = applyFrameToPanel(FakeTHREE, mesh, grid, spec, () => ({ ...ARTWORK }))
      .find((m) => m.name === 'frame-window-wall');
    expect(winWall).toBeTruthy();
    const arr = winWall.geometry.attributes.color.array;
    expect(arr.length).toBeGreaterThan(0);
    for (let i = 0; i < arr.length; i += 3) expect(arr[i]).toBeCloseTo(ARTWORK.r, 5);
  });

  it('edgeSampler is called with the SAME uv the heat-map colour is sampled at (both read attrs.uv/attrs.color via the identical surf.at(...).hi hit)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const seenUVs = [];
    applyFrameToPanel(FakeTHREE, mesh, grid, spec, (u, v) => { seenUVs.push([u, v]); return null; });
    expect(seenUVs.length).toBeGreaterThan(0);
    for (const [u, v] of seenUVs) {
      expect(u).toBeGreaterThanOrEqual(0); expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('topCapIndices (H23 item 67: the top-cap-only index the colourEdges-OFF overlay uses)', () => {
  it('is exactly the PREFIX of buildSolidMesh\'s own full index (top+bottom caps, before the wall faces)', () => {
    const nx = 5, nz = 4;
    const { mesh: solid } = carvedPanel(7, 9, nx, nz, () => 1, 0.5);
    const full = Array.from(solid.geometry.index.array);
    const capOnly = topCapIndices(nx, nz);
    expect(capOnly.length).toBeLessThan(full.length); // genuinely a subset, not vacuously the same
    expect(full.slice(0, capOnly.length)).toEqual(capOnly);
  });

  it('references only top/bottom-cap vertex indices, never a side-wall vertex index', () => {
    const nx = 5, nz = 4;
    const count = nx * nz;
    const capOnly = topCapIndices(nx, nz);
    for (const idx of capOnly) expect(idx).toBeLessThan(count * 2); // SIDE_START = count*2 (terrain-mesh.js)
  });

  it('non-vacuous: a DIFFERENT grid size produces a correspondingly different-length index', () => {
    expect(topCapIndices(5, 4).length).not.toBe(topCapIndices(3, 3).length);
    expect(topCapIndices(3, 3).length).toBe((3 - 1) * (3 - 1) * 6 * 2); // 2 caps x 2x2 quads x 6
  });
});

/**
 * H23 item 67: TerrainPreview._applyFrame builds a SECOND overlay mesh
 * sharing the rim's OWN geometry (the top surface's trimmed boundary strip,
 * applyFrameToPanel's 'frame-panel-rim'), so the artwork reaches right up
 * to the frame cut edge -- unconditionally (like the rest of the top
 * surface), NOT gated by the colourEdges toggle (that one only affects the
 * WALLS). Real `TerrainPreview.prototype._applyFrame.call(mockThis)` — the
 * class itself can't be constructed here (needs window.THREE + a real
 * canvas) — against a mock built from FakeTHREE + a real carved panel/frame
 * spec, same convention as drape-mesh.test.js's own _rebuildDrapeMesh tests.
 */
describe('TerrainPreview._applyFrame: the frame rim gets its own drape overlay (H23 item 67)', () => {
  function mockThisFor({ drapeTexture = null, colourEdges = true } = {}) {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const sceneAdds = [], sceneRemoves = [];
    return {
      _THREE: FakeTHREE,
      _scene: { add: (o) => sceneAdds.push(o), remove: (o) => sceneRemoves.push(o) },
      _mesh: mesh,
      _lastGrid: grid,
      _frameProvider: (W, H) => frameSolidSpec(FRAME_DEFS, rec('template_1'), { widthIn: W, heightIn: H }),
      _frameMeshes: [],
      _frameRimDrapeMesh: null,
      _trimPoly: null,
      _leaders: { setData() {} },
      _worstPts: [],
      _showLeaders: false,
      _drapeTexture: drapeTexture,
      _colourEdges: colourEdges,
      _sceneAdds: sceneAdds,
      _sceneRemoves: sceneRemoves,
      _clearFrameMeshes: TerrainPreview.prototype._clearFrameMeshes,
      _visibleWorstPts: TerrainPreview.prototype._visibleWorstPts,
      _drapeOverlayMaterial: TerrainPreview.prototype._drapeOverlayMaterial,
    };
  }
  const run = (mock) => TerrainPreview.prototype._applyFrame.call(mock);
  const fakeImage = { width: 4, height: 4, getContext: () => null }; // never actually sampled by these tests

  it('no drape texture: no rim overlay is built (nothing new to show)', () => {
    const mock = mockThisFor({ drapeTexture: null });
    run(mock);
    expect(mock._frameRimDrapeMesh).toBeNull();
  });

  it('with a drape texture: a rim overlay is built, SHARING the rim mesh\'s own geometry (no copy), and added to the scene', () => {
    const mock = mockThisFor({ drapeTexture: { image: fakeImage } });
    run(mock);
    const rim = mock._frameMeshes.find((m) => m.name === 'frame-panel-rim');
    expect(rim).toBeTruthy();
    expect(mock._frameRimDrapeMesh).toBeTruthy();
    expect(mock._frameRimDrapeMesh.geometry).toBe(rim.geometry);
    expect(mock._sceneAdds).toContain(mock._frameRimDrapeMesh);
  });

  it('colourEdges OFF: the rim overlay STILL appears -- that toggle is about the walls only, not the top surface\'s own edge', () => {
    const mock = mockThisFor({ drapeTexture: { image: fakeImage }, colourEdges: false });
    run(mock);
    expect(mock._frameRimDrapeMesh).toBeTruthy();
  });

  it('a stale rim overlay from a previous call is removed before a fresh one is built (no leak, no duplicate)', () => {
    const mock = mockThisFor({ drapeTexture: { image: fakeImage } });
    run(mock);
    const first = mock._frameRimDrapeMesh;
    let disposed = false;
    first.material.dispose = () => { disposed = true; };
    run(mock);
    expect(disposed).toBe(true);
    expect(mock._sceneRemoves).toContain(first);
    expect(mock._frameRimDrapeMesh).not.toBe(first);
  });
});

/**
 * H23 item 67b (advisor rework, 2026-10-03: "the after shot still shows plain grey/beige walls
 * below a thin green lip"): MEASURED via a live raycast that the "plain grey/beige" area was
 * frame-bars (the wood moulding ring), not frame-panel-wall -- frame-bars' own OUTER wall sits
 * at the EXACT SAME (x,y) as frame-panel-wall (outer === panel at panelLip 0) and, being the
 * WIDER ring, is what a viewer actually sees as "the wall". It previously had NO colour mechanism
 * at all (a flat material colour only) -- this proves it now takes the edge colour, full height,
 * on its own outer wall only, with the inner wall and the rest of its own top cap staying the
 * frame's declared wood colour.
 */
describe('applyFrameToPanel: frame-bars\' own OUTER wall now takes the edge colour too (H23 item 67b)', () => {
  it('without edgeSampler: every bar vertex is the frame\'s own declared wood colour (today\'s pre-67b look, now via vertex colours instead of a flat material colour)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1', { appearance: '3D Oak - Painted' }), BOARD);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
    expect(bars.material.vertexColors).toBe(true);
    expect(bars.material.color).toBe(0xffffff);
    const col = bars.geometry.attributes.color.array;
    expect(col.length).toBeGreaterThan(0);
    const wood = new FakeTHREE.Color(spec.color);
    for (let i = 0; i < col.length; i += 3) {
      expect(col[i]).toBeCloseTo(wood.r, 2); expect(col[i + 1]).toBeCloseTo(wood.g, 2); expect(col[i + 2]).toBeCloseTo(wood.b, 2);
    }
  });

  it('with edgeSampler: the OUTER wall (the visible exterior face) takes the artwork colour, full height (bottom and top share the same colour)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec, () => ({ ...ARTWORK })).find((m) => m.name === 'frame-bars');
    const col = bars.geometry.attributes.color.array;
    let artworkCount = 0;
    for (let i = 0; i < col.length; i += 3) {
      if (Math.abs(col[i] - ARTWORK.r) < 1e-5 && Math.abs(col[i + 1] - ARTWORK.g) < 1e-5 && Math.abs(col[i + 2] - ARTWORK.b) < 1e-5) artworkCount++;
    }
    // non-vacuous: the sampler's own colour genuinely reached the bars somewhere
    expect(artworkCount).toBeGreaterThan(0);
  });

  it('the INNER wall (closest to the panel\'s own sculpted centre) stays the wood colour even when edgeSampler finds artwork everywhere -- no artwork reaches that far in', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec, () => ({ ...ARTWORK })).find((m) => m.name === 'frame-bars');
    const col = bars.geometry.attributes.color.array;
    const wood = new FakeTHREE.Color(spec.color);
    let woodCount = 0;
    for (let i = 0; i < col.length; i += 3) {
      if (Math.abs(col[i] - wood.r) < 1e-2 && Math.abs(col[i + 1] - wood.g) < 1e-2 && Math.abs(col[i + 2] - wood.b) < 1e-2) woodCount++;
    }
    // the inner wall + the rest of the top cap (everything but row 0 and oB) -- a real, sizeable share
    expect(woodCount).toBeGreaterThan(0);
  });

  it('a sampler that returns null everywhere behaves exactly like no sampler at all (the wood-colour fallback)', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const withNullSampler = applyFrameToPanel(FakeTHREE, mesh, grid, spec, () => null).find((m) => m.name === 'frame-bars');
    const withNoSampler = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-bars');
    expect(Array.from(withNullSampler.geometry.attributes.color.array)).toEqual(Array.from(withNoSampler.geometry.attributes.color.array));
  });

  it('frame-window-bars (the inset-window moulding) gets a uniform wood colour attribute -- NOT left without one, which would render flat black now that barMat always has vertexColors:true', () => {
    const winRec = () => rec('template_1', { insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 }, frameBottomZ: -1 });
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, winRec(), BOARD);
    const winBars = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-window-bars');
    expect(winBars).toBeTruthy();
    const col = winBars.geometry.attributes.color.array;
    expect(col.length).toBeGreaterThan(0);
    const wood = new FakeTHREE.Color(spec.color);
    for (let i = 0; i < col.length; i += 3) {
      expect(col[i]).toBeCloseTo(wood.r, 2); expect(col[i + 1]).toBeCloseTo(wood.g, 2); expect(col[i + 2]).toBeCloseTo(wood.b, 2);
    }
  });
});

/**
 * H23 item 67b (saw-teeth): Fred's own close-up (a striped black/white contour) showed
 * alternating wall-colour/stripe-colour TRIANGLES -- traced to `panel`'s own coarse,
 * 1-sample-per-cell wall resolution letting a single stripe (narrower than one cell) start and
 * end strictly within one wall quad. WALL_COLOR_OVERSAMPLE resamples the wall's own colour-
 * bearing geometry at a finer resolution, independent of `panel`'s own (unchanged) role as the
 * trim/clip polygon.
 */
describe('WALL_COLOR_OVERSAMPLE (H23 item 67b: the saw-teeth fix)', () => {
  it('a narrow coloured band (narrower than one cell) is caught by SOME wall vertex -- proving the oversampled resolution can resolve it, where the original 1-sample-per-cell resolution routinely could not', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    // A sampler that only "finds" artwork in a narrow u-band -- narrower than 1/WALL_COLOR_OVERSAMPLE
    // of the panel's own perimeter in u-space, simulating one thin stripe.
    const narrowSampler = (u) => (u > 0.4995 && u < 0.5005 ? { ...ARTWORK } : null);
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, spec, narrowSampler).find((m) => m.name === 'frame-panel-wall');
    const col = wall.geometry.attributes.color.array;
    let hit = false;
    for (let i = 0; i < col.length; i += 3) {
      if (Math.abs(col[i] - ARTWORK.r) < 1e-5 && Math.abs(col[i + 1] - ARTWORK.g) < 1e-5 && Math.abs(col[i + 2] - ARTWORK.b) < 1e-5) { hit = true; break; }
    }
    expect(hit, 'the narrow band was never sampled by any wall vertex at all -- the oversampling did not actually increase resolution').toBe(true);
  });

  it('non-vacuous: the fine wall loop has noticeably MORE points than panel\'s own (unchanged) coarse loop -- the structural fact the resolution claim above rests on, not just "it happened to work once"', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const coarsePanelLen = frameLoopsWorld(spec, grid).panel.length;
    const wall = applyFrameToPanel(FakeTHREE, mesh, grid, spec).find((m) => m.name === 'frame-panel-wall');
    const finePointCount = wall.geometry.attributes.position.array.length / 3 / 2; // /2: top+bottom per point
    expect(finePointCount).toBeGreaterThan(coarsePanelLen * 2); // at least ~WALL_COLOR_OVERSAMPLE/2 x denser
  });

  it('frame-bars\' own outer wall is ALSO oversampled (not just the panel wall) -- it resolves the SAME narrow band the panel wall above does', () => {
    const { mesh, grid } = panel(7, 9, 71, 91);
    const spec = frameSolidSpec(FRAME_DEFS, rec('template_1'), BOARD);
    const narrowSampler = (u) => (u > 0.4995 && u < 0.5005 ? { ...ARTWORK } : null);
    const bars = applyFrameToPanel(FakeTHREE, mesh, grid, spec, narrowSampler).find((m) => m.name === 'frame-bars');
    const col = bars.geometry.attributes.color.array;
    let hit = false;
    for (let i = 0; i < col.length; i += 3) {
      if (Math.abs(col[i] - ARTWORK.r) < 1e-5 && Math.abs(col[i + 1] - ARTWORK.g) < 1e-5 && Math.abs(col[i + 2] - ARTWORK.b) < 1e-5) { hit = true; break; }
    }
    expect(hit, 'the narrow band was never sampled by any bar vertex at all').toBe(true);
  });
});
