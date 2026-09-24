/**
 * SE5b — export-flow's activeStampLayers/exportableStampLayers now read
 * BOTH content and tooling from the editor layer object — no P.stampLayers
 * read left at all (SE5-TOOLING-STORE-DESIGN.md, SA-LAYER-1/2/3).
 *
 * Before this change (SE4a/SE5a), content already came from the editor but
 * tooling (`depth`/`profile`/`enabled`) still came from `P.stampLayers[idx]`
 * by POSITION — a fixed 3-entry array. That meant: a 4th+ layer's tooling
 * read was always `{}` (undefined enabled/depth/profile); a layer drawn
 * directly (not Browse-imported) never got `.enabled` flipped true; and a
 * reorder/delete-in-middle could desync `P.stampLayers[idx]` from whatever
 * editor layer actually sat at that index. Rewritten whole-file per the
 * design doc's own STOP condition (a partial rewrite would leave some
 * fixtures asserting the retired shape while the code no longer reads it).
 *
 * Every fixture below deliberately sets `P.stampLayers` to WRONG/stale
 * tooling values (or leaves it empty) precisely so a regression back to
 * reading `P.stampLayers` would show up as a wrong depth/profile or a
 * layer wrongly included/excluded — not just an absent field.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { activeStampLayers, exportableStampLayers } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { setLayerVisible } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

/** Editor layer mock: tooling (depth/profile/visible) lives ON the layer
 *  object itself now, alongside content — matching what editor._layers
 *  actually carries (TOOLING_DEFAULTS + _PERSISTED_LAYER_FIELDS). */
function mockEditor(layers) {
  return {
    _draw: {},
    _mW: 7,
    _mH: 9,
    _sketchLayer: {
      node: { innerHTML: layers.map(l => l.content || '').join('') },
      children: () => [], // svg.js API stub — enough for setLayerVisible's applyLayerState() call
    },
    _layers: layers.map(l => ({
      id: l.id,
      visible: l.visible,
      carve: l.carve,
      depth: l.depth,
      profile: l.profile,
      _mask: l.mask ?? null,
    })),
  };
}

describe('export-flow: activeStampLayers / exportableStampLayers (single-store: editor._layers only)', () => {
  beforeEach(() => {
    // Deliberately WRONG values — a regression back to reading
    // P.stampLayers would pick these up instead of the editor layer's own
    // depth/profile/visible, and the assertions below would catch it.
    P.stampLayers = [
      { enabled: false, depth: 999, profile: 'WRONG' },
      { enabled: false, depth: 999, profile: 'WRONG' },
      { enabled: false, depth: 999, profile: 'WRONG' },
    ];
    if (typeof window !== 'undefined') window.svgEditor = null;
  });

  it('counts a layer with real editor content and reads its depth/profile from the editor layer, not P.stampLayers', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    const active = activeStampLayers();
    const exportable = exportableStampLayers();

    expect(active).toHaveLength(1);
    expect(exportable).toHaveLength(1);
    expect(active[0].depth).toBe(0.2);       // from editor._layers[0], NOT the 999 in P.stampLayers[0]
    expect(active[0].profile).toBe('square'); // from editor._layers[0], NOT 'WRONG'
    expect(active[0].svg).toContain('data-layer');
  });

  it('a HIDDEN layer is never exportable, even though P.stampLayers (unused now) would say otherwise', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: false, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    expect(exportableStampLayers()).toHaveLength(0);
  });

  // T27 FINAL: visible is the MASTER — carve only takes effect while
  // visible, so a hidden layer never carves regardless of its own carve
  // flag. carve:false + visible:true is the one case that still carves
  // "not at all but still ships" (shown but not cut).
  it('T27: carve:false + visible:true -> not carving, still exportable (shown but not cut)', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, carve: false, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    expect(activeStampLayers()).toHaveLength(0);     // carve:false -> never carving, mask or not
    expect(exportableStampLayers()).toHaveLength(1); // still shown -> still ships as artwork
  });

  it('T27: visible:false + carve:true (default) -> NOT carving (visible is the master), never exportable', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: false, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    expect(activeStampLayers()).toHaveLength(0);     // hidden -> isCarved false even though carve defaults true
    expect(exportableStampLayers()).toHaveLength(0); // hidden -> never shipped
  });

  it('does not count an EMPTY layer (no content, no mask)', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, depth: 0.2, profile: 'square', content: '', mask: null },
    ]);

    expect(activeStampLayers()).toHaveLength(0);
    expect(exportableStampLayers()).toHaveLength(0);
  });

  it('exportableStampLayers is looser than activeStampLayers: svg without a baked mask ships but does not carve', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: true, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: null },
    ]);

    expect(activeStampLayers()).toHaveLength(0);     // no mask -> not carving
    expect(exportableStampLayers()).toHaveLength(1); // has svg -> still exportable
  });

  it('returns [] when the editor is not loaded', () => {
    window.svgEditor = null;

    expect(activeStampLayers()).toHaveLength(0);
    expect(exportableStampLayers()).toHaveLength(0);
  });

  it('SA-LAYER-1 #1: a 4th layer exports correctly even though P.stampLayers has only 3 entries', () => {
    expect(P.stampLayers).toHaveLength(3); // the precondition the old 3-entry read broke on
    window.svgEditor = mockEditor([
      { id: '0', visible: true, depth: 0.1, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
      { id: '1', visible: true, depth: 0.1, profile: 'square', content: '<rect data-layer="1"/>', mask: { body: new Float32Array(4) } },
      { id: '2', visible: true, depth: 0.1, profile: 'square', content: '<rect data-layer="2"/>', mask: { body: new Float32Array(4) } },
      { id: '3', visible: true, depth: 0.4, profile: 'ballnose', content: '<rect data-layer="3"/>', mask: { body: new Float32Array(4) } },
    ]);

    const active = activeStampLayers();
    expect(active).toHaveLength(4);
    const fourth = active.find(l => l.depth === 0.4);
    expect(fourth).toBeDefined();
    expect(fourth.profile).toBe('ballnose');
  });

  it('SA-LAYER-1 #2: a layer drawn directly (no Browse import, P.stampLayers never touched for it) still exports', () => {
    // layer '1' has real content and is visible, purely via direct drawing
    // — nothing in this test ever calls setLayerVisible/Browse for it, and
    // P.stampLayers[1] (set in beforeEach) says enabled:false/WRONG.
    window.svgEditor = mockEditor([
      { id: '0', visible: true, depth: 0.25, profile: 'vbit', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
      { id: '1', visible: true, depth: -0.5, profile: 'ballnose', content: '<path data-layer="1"/>', mask: { body: new Float32Array(4) } },
    ]);

    const active = activeStampLayers();
    expect(active).toHaveLength(2);
    expect(active.some(l => l.depth === -0.5 && l.profile === 'ballnose')).toBe(true);
  });

  it('SA-LAYER-1 #3: reorder — tooling follows the layer OBJECT, not the array index', () => {
    // Build with layer '0' shallow (depth 0.1) and layer '1' deep (depth
    // 0.9), then reorder the array so '1' is now at index 0. A position-
    // based read (the old bug) would report the WRONG depth for whichever
    // id ended up at which index; an object-based read reports correctly
    // regardless of array order.
    const editor = mockEditor([
      { id: '0', visible: true, depth: 0.1, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
      { id: '1', visible: true, depth: 0.9, profile: 'ballnose', content: '<rect data-layer="1"/>', mask: { body: new Float32Array(4) } },
    ]);
    window.svgEditor = editor;
    // Simulate reorderLayer's effect: splice + reinsert, same objects.
    const [moved] = editor._layers.splice(1, 1);
    editor._layers.splice(0, 0, moved);
    expect(editor._layers.map(l => l.id)).toEqual(['1', '0']); // reorder actually happened

    const active = activeStampLayers();
    const byId = Object.fromEntries(
      editor._layers.map((l, i) => [l.id, active.find(a => a.svg && a.svg.includes(`data-layer="${l.id}"`))])
    );
    expect(byId['1'].depth).toBe(0.9);
    expect(byId['1'].profile).toBe('ballnose');
    expect(byId['0'].depth).toBe(0.1);
    expect(byId['0'].profile).toBe('square');
  });

  it('Browse-into-layer end to end: setLayerVisible(true) (the real function svg-source.js now calls) makes a layer exportable — the exact regression SE5a opened and SE5b closes', () => {
    const editor = mockEditor([
      { id: '2', visible: false, depth: 0.75, profile: 'flat', content: '<rect data-layer="2"/>', mask: { body: new Float32Array(4) } },
    ]);
    window.svgEditor = editor;

    expect(exportableStampLayers()).toHaveLength(0); // starts hidden, per DEFAULT.stampLayers[2]-style layers

    setLayerVisible(editor, '2', true); // the real function svg-source.js's Browse handler calls

    expect(editor._layers[0].visible).toBe(true);
    expect(exportableStampLayers()).toHaveLength(1);
    expect(activeStampLayers()).toHaveLength(1);
  });
});
