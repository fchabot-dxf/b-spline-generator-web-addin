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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { activeStampLayers, exportableStampLayers, _reportDeclinedOutlines, _fusionLayerManifest, _boundarySketchManifests, _bricksLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { setLayerVisible } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
// F17 (P1): the lattice manifest is built from the owned pieces AS DRAWN, so the mocks carry real geometry
import { drawnFromPattern, ownedStores } from './helpers/drawn-lattice.js';
const BOARD = { x: 0, y: 0, w: 7, h: 9 };
/** A pattern's owned pieces as generatePattern draws them, all kinds on `layer` (or on its kind layers). */
function ownedFor(pattern, layer, gen = 'anything') {
  const layers = pattern.layers || { rails: layer, ties: layer, nodes: layer };
  const st = ownedStores(drawnFromPattern(pattern, BOARD), { gen, layers });
  return [...st.rails, ...st.ties, ...st.nodes];
}

/** Editor layer mock: tooling (depth/profile/visible) lives ON the layer
 *  object itself now, alongside content — matching what editor._layers
 *  actually carries (TOOLING_DEFAULTS + _PERSISTED_LAYER_FIELDS).
 *
 *  T74 AMEND 5: an optional per-layer `owned` array seeds mock DOM
 *  elements `latticeOwnedElementsOnLayer` can actually find — each entry
 *  is a plain attribute-store object (e.g. `{ 'data-layer': '3',
 *  'data-lattice-gen': 'anything' }` for an owned rail/tie/node, or
 *  `{ 'data-layer': '3', 'data-boundary-ref': shapeId }` for a contour
 *  segment) — same `.node.getAttribute`/`.hasAttribute` shape every other
 *  mock editor in this suite already uses (editor-lattice-pattern-emit.
 *  test.js's own `_makeMockEditor`), not a second, differently-shaped one. */
function mockEditor(layers) {
  const elements = layers.flatMap(l => (l.owned || []).map(store => ({
    node: {
      getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
      hasAttribute: (k) => store[k] !== undefined,
    },
  })));
  return {
    _draw: {},
    _mW: 7,
    _mH: 9,
    _sketchLayer: {
      node: { innerHTML: layers.map(l => l.content || '').join('') },
      // svg.js API stub — enough for setLayerVisible's applyLayerState()
      // call AND latticeOwnedElementsOnLayer's own children().toArray().
      children: () => { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    },
    _layers: layers.map(l => ({
      id: l.id,
      visible: l.visible,
      carve: l.carve,
      depth: l.depth,
      profile: l.profile,
      _mask: l.mask ?? null,
      pattern: l.pattern ?? null,
      // T76 (SE17): a sibling kind-layer carries only this pointer, never
      // its own `.pattern` — see resolvePatternLayer's own doc comment.
      ...(l.patternOwner !== undefined ? { patternOwner: l.patternOwner } : {}),
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

  it('turn 207 (Fred: hidden is display-only): a HIDDEN layer still ships on Send', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: false, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    expect(exportableStampLayers()).toHaveLength(1);
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

  it('turn 207 + audit B6: visible:false + carve:true (default) -> STILL carving (hidden is display only), shipped to the Carved component', () => {
    window.svgEditor = mockEditor([
      { id: '0', visible: false, depth: 0.2, profile: 'square', content: '<rect data-layer="0"/>', mask: { body: new Float32Array(4) } },
    ]);

    expect(activeStampLayers()).toHaveLength(1);     // audit B6: hidden keeps its own carve (defaults true)
    expect(exportableStampLayers()).toHaveLength(1); // turn 207: hidden is display-only -> shipped
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

    expect(exportableStampLayers()).toHaveLength(1); // starts hidden -- turn 207: hidden layers ship too

    setLayerVisible(editor, '2', true); // the real function svg-source.js's Browse handler calls

    expect(editor._layers[0].visible).toBe(true);
    expect(exportableStampLayers()).toHaveLength(1);
    expect(activeStampLayers()).toHaveLength(1);
  });
});

/**
 * T44 — _reportDeclinedOutlines, the "N elements exported as centerline —
 * no outline for: <kinds>" user-facing notice, aggregated across every
 * layer in a Fusion export. Uses a REAL `#fusion-status` DOM element (the
 * happy-dom environment already gives every test file a real `document`)
 * rather than mocking setFusionStatus/core/fusion-bridge.js — this
 * codebase's own established convention (no vi.mock anywhere in this
 * suite) is real DOM/object stand-ins over module mocking, and driving
 * the REAL setFusionStatus against a REAL element is a more faithful
 * check of the actual wiring than a mock would be.
 */
describe('export-flow: _reportDeclinedOutlines (T44 fallback notice)', () => {
  function mockStatusEl() {
    const el = document.createElement('div');
    el.id = 'fusion-status';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    const el = document.getElementById('fusion-status');
    if (el) el.remove();
  });

  it('does nothing (element stays hidden) when nothing declined across any layer', () => {
    const el = mockStatusEl();
    _reportDeclinedOutlines([{ declined: 0, declinedKinds: [] }, { declined: 0, declinedKinds: [] }]);
    expect(el.hidden).toBe(true);
    expect(el.textContent).toBe('');
  });

  it('reports a single declined element with singular "element" wording and the exact kind', () => {
    const el = mockStatusEl();
    _reportDeclinedOutlines([{ declined: 1, declinedKinds: ['text'] }]);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('1 element exported as centerline — no outline for: text');
    expect(el.dataset.kind).toBe('warn');
  });

  it('sums declined counts and unions declinedKinds ACROSS every layer, de-duplicating repeated kinds — the exact multi-layer export scenario this notice exists for', () => {
    const el = mockStatusEl();
    _reportDeclinedOutlines([
      { declined: 2, declinedKinds: ['image', 'text'] },
      { declined: 1, declinedKinds: ['text'] }, // same kind as layer 1 -- must not duplicate in the message
      { declined: 0, declinedKinds: [] },
    ]);
    expect(el.textContent).toBe('3 elements exported as centerline — no outline for: image, text');
  });
});

/**
 * T62 (SE15) — _fusionLayerManifest: a layer's own SE15 sketch manifest,
 * gated on the layer actually HAVING a `.pattern` (declined gracefully for
 * a hand-drawn/text layer, matching `_fusionLayerSvg`'s own convention).
 * Own describe block, own small function, directly testable without the
 * heavier STEP-generation/Fusion-bridge machinery `sendToFusion` itself
 * needs — same reason `_fusionLayerSvg` is its own function here.
 *
 * T74 AMEND 5 (Fred, live: a hand-drawn layer got sent to Fusion as a
 * LATTICE constrained sketch instead of its own artwork): `.pattern`
 * merely existing is NOT enough — every fixture below that expects a REAL
 * manifest now also seeds at least one owned/contour element, matching
 * what `latticeOwnedElementsOnLayer` (editor-lattice-pattern.js) actually
 * requires; the exact bug itself (a `.pattern` with ZERO owned content)
 * gets its own new case.
 */
describe('export-flow: _fusionLayerManifest (T62 — SE15 manifest gating)', () => {
  it('returns null when the editor is missing', () => {
    expect(_fusionLayerManifest(null, { id: '1' })).toBeNull();
  });

  it('returns null when the layer id is missing', () => {
    const editor = mockEditor([{ id: '1' }]);
    expect(_fusionLayerManifest(editor, { id: null })).toBeNull();
  });

  it('returns null for a layer with no .pattern (hand-drawn/text layer — declined gracefully)', () => {
    const editor = mockEditor([{ id: '1' }]);
    expect(_fusionLayerManifest(editor, { id: '1' })).toBeNull();
  });

  it('T74 AMEND 5 (the reported bug, exactly): returns null for a layer with a STALE .pattern but ZERO owned pieces (the Lattice tool was opened on it once, nothing was ever generated, or the user drew something else by hand afterward) — never builds a manifest for content that is not actually there', () => {
    const pattern = {
      spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 0, anchor: 'free', spanMin: 1, spanMax: 1 },
      nodes: { ends: false, crossings: false, railEnds: false },
    };
    // No `owned` array at all -- the exact "hand-drawn layer, stale
    // pattern" shape the live bug report described.
    const editor = mockEditor([{ id: '2', pattern, content: '<path d="M0 0 L1 1"/><path d="M2 2 L3 3"/>' }]);
    expect(_fusionLayerManifest(editor, { id: '2' })).toBeNull();
  });

  // H3 (NO-PIECE-WIDTH): rewritten, not deleted — T75/OVR-FUSION's own
  // "a per-piece override hardcodes its own SlotWidth expression"
  // mechanism is gone (a lattice piece has no per-piece width any more).
  // `data-override-width` here now stands for a STALE marker an OLD saved
  // document might still carry (from before this turn) — the new rule is
  // that it's simply never read, by this element or any other.
  it('H3: an element carrying a stale data-override-width still gets the SHARED parameter expression, never a hardcoded one', () => {
    const pattern = {
      spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 0, anchor: 'free', spanMin: 1, spanMax: 1 },
      nodes: { ends: false, crossings: false, railEnds: false },
      widths: { rails: 0.07, ties: 0.07, nodeDiameter: 0.15, linkRailsTies: true },
    };
    const owned = ownedFor(pattern, '3');
    owned.find((o) => o['data-lattice'] === 'rail')['data-override-width'] = '0.5'; // stale, pre-H3 marker
    const editor = mockEditor([{ id: '3', pattern, owned }]);
    const manifest = _fusionLayerManifest(editor, { id: '3' });
    const rail0Dim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === 'rail0');
    expect(rail0Dim.expression).toBe('stroke_width'); // NOT '0.5 in'
    const rail1Dim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === 'rail1');
    expect(rail1Dim.expression).toBe('stroke_width'); // identical to its "un-stale" sibling
  });
});

// H3 (NO-PIECE-WIDTH) item 3: "a grep proves no reader of data-override-width
// remains" — proves it directly, against the real source tree, rather than
// asserting it in prose. The ONE known, deliberately-deferred exception (see
// this test would FAIL — not silently pass — the moment ANY reader of it
// reappears anywhere in the real source tree, now that the manifest-side
// half (editor-sketch-manifest.js + export-flow.js's own
// _drawnPiecesForLayer) is removed too (this part landed after F17
// merged, unblocking it -- see WORK-LOG).
describe('H3 (NO-PIECE-WIDTH): no reader of data-override-width remains anywhere', () => {
  it('greps the real editor/main source tree', () => {
    const ROOT = 'bspline-frame-builder/b-spline-gen/html';
    const READ_PATTERN = /\.(getAttribute|hasAttribute|attr)\(\s*['"]data-override-width['"]/;
    const files = [];
    (function walk(dir) {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.js')) files.push(p);
      }
    })(ROOT);
    const readers = files.filter((f) => READ_PATTERN.test(readFileSync(f, 'utf-8')));
    expect(readers).toEqual([]); // no reader anywhere, no named exception left
  });

  it('returns a real manifest for a layer that DOES carry a .pattern AND owned pieces', () => {
    const pattern = {
      spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 0, anchor: 'free', spanMin: 1, spanMax: 1 },
      nodes: { ends: false, crossings: false, railEnds: false },
    };
    const editor = mockEditor([{ id: '3', pattern, owned: [{ 'data-layer': '3', 'data-lattice-gen': 'anything' }] }]);
    const manifest = _fusionLayerManifest(editor, { id: '3' });
    expect(manifest).not.toBeNull();
    expect(manifest.layerId).toBe('3');
    expect(manifest.sketchName).toBe('Layer 3');
    expect(manifest.units).toBe('in');
    expect(Array.isArray(manifest.entities)).toBe(true);
  });

  it('non-vacuous: looks up the layer by id, not by array position (a stale/wrong index would silently attach the WRONG layer\'s pattern)', () => {
    // F17: every:20 (one drawn rail): a pattern that draws NOTHING is no longer sent at all
    const patternA = { spacing: 0.25, rails: { mode: 'every', every: 20, offset: 0 }, ties: { mode: 'density', density: 0 }, nodes: { ends: false, crossings: false, railEnds: false } };
    const patternB = { spacing: 0.25, rails: { mode: 'every', every: 1, offset: 0 }, ties: { mode: 'density', density: 0 }, nodes: { ends: false, crossings: false, railEnds: false } };
    const editor = mockEditor([
      { id: 'A', pattern: patternA, owned: ownedFor(patternA, 'A', 'a') },
      { id: 'B', pattern: patternB, owned: ownedFor(patternB, 'B', 'b') },
    ]);
    const manifestB = _fusionLayerManifest(editor, { id: 'B' });
    const manifestA = _fusionLayerManifest(editor, { id: 'A' });
    // every:1 (B) produces strictly more rails than every:20 (A) on the
    // same 7x9 board — a real, checkable difference, not just "not null".
    const railCount = (m) => m.entities.filter((e) => e.id.match(/^rail\d+$/)).length;
    expect(railCount(manifestB)).toBeGreaterThan(railCount(manifestA));
  });
});

/**
 * T76 (SE17, item 4) — a pattern already split across its own kind-layers
 * (`pattern.layers`, item 2's own `_ensureKindLayers`) builds ONE manifest
 * PER KIND-LAYER via splitManifestByKind, not one combined manifest for
 * whichever layer happens to be asked about.
 */
describe('export-flow: _fusionLayerManifest (T76 item 4 — one manifest per kind-layer)', () => {
  function makeKindSplitEditor() {
    const pattern = {
      id: 'p', // matches the owned pieces' data-lattice-gen below (generatePattern always sets one)
      spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
      nodes: { ends: true, crossings: true, railEnds: false },
      widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: false },
      layers: { rails: 'railsL', ties: 'tiesL', nodes: 'nodesL' },
    };
    const owned = ownedFor(pattern, null, 'p');
    const on = (layer) => owned.filter((o) => o['data-layer'] === layer);
    return mockEditor([
      { id: 'railsL', pattern, owned: on('railsL') },
      { id: 'tiesL', patternOwner: 'railsL', owned: on('tiesL') },
      { id: 'nodesL', patternOwner: 'railsL', owned: on('nodesL') },
    ]);
  }

  it('the Rails layer\'s own manifest contains ONLY rail entities (no ties/nodes mixed in)', () => {
    const editor = makeKindSplitEditor();
    const manifest = _fusionLayerManifest(editor, { id: 'railsL' });
    expect(manifest).not.toBeNull();
    expect(manifest.layerId).toBe('railsL');
    expect(manifest.entities.length).toBeGreaterThan(0);
    expect(manifest.entities.every((e) => e.id.startsWith('rail'))).toBe(true);
  });

  it('BOUNDARY-GUIDE: one "Lattice Boundary" manifest per sent pattern -- its own first sketch, construction Lines only', () => {
    const editor = makeKindSplitEditor();
    const manifests = ['railsL', 'tiesL'].map((id) => _fusionLayerManifest(editor, { id }));
    const extra = _boundarySketchManifests(editor, manifests);
    expect(extra).toHaveLength(1); // two kind-layers of ONE pattern -> one boundary sketch
    const [b] = extra;
    expect(b.kind).toBe('boundary');
    expect(b.buildOrder).toBe(0);
    expect(b.sketchName).toBe('Lattice Boundary');
    expect(b.patternId).toBe(manifests[0].patternId);
    expect(b.entities.map((e) => [e.id, e.type, e.isConstruction])).toEqual(
      [0, 1, 2, 3].map((i) => [`bnd${i}`, 'Line', true]));
    expect(_boundarySketchManifests(editor, [null])).toEqual([]); // nothing sent -> no boundary
  });

  it('the Ties layer\'s own manifest (a SIBLING with no .pattern of its own) still resolves the shared pattern and contains ONLY tie entities', () => {
    const editor = makeKindSplitEditor();
    const manifest = _fusionLayerManifest(editor, { id: 'tiesL' });
    expect(manifest).not.toBeNull();
    expect(manifest.layerId).toBe('tiesL');
    expect(manifest.entities.length).toBeGreaterThan(0);
    expect(manifest.entities.every((e) => e.id.startsWith('tie'))).toBe(true);
    // its own cross-kind tie-on-rail links became projections, not raw rail ids.
    expect(manifest.projections.length).toBeGreaterThan(0);
    expect(manifest.projections.every((p) => p.sourceKind === 'rails')).toBe(true);
  });

  it('the Nodes layer\'s own manifest resolves the shared pattern too, with projections sourced from rails and/or ties', () => {
    const editor = makeKindSplitEditor();
    const manifest = _fusionLayerManifest(editor, { id: 'nodesL' });
    expect(manifest).not.toBeNull();
    expect(manifest.entities.every((e) => e.id.startsWith('node'))).toBe(true);
    expect(manifest.projections.length).toBeGreaterThan(0);
    for (const p of manifest.projections) expect(['rails', 'ties']).toContain(p.sourceKind);
  });

  it('T76 item 6 (hidden kind-layer, dependents keep exact geometry): a SIBLING kind-layer\'s own visible/hidden state has NO effect on another kind-layer\'s own manifest at all -- Nodes\' own entities/projections come out byte-for-byte identical whether Ties is visible or hidden', () => {
    const editorTiesVisible = makeKindSplitEditor();
    const editorTiesHidden = makeKindSplitEditor();
    editorTiesHidden._layers.find((l) => l.id === 'tiesL').visible = false;

    const manifestA = _fusionLayerManifest(editorTiesVisible, { id: 'nodesL' });
    const manifestB = _fusionLayerManifest(editorTiesHidden, { id: 'nodesL' });
    // _fusionLayerManifest itself never reads ANY layer's own `.visible` --
    // visibility gating happens one level up, in sendToFusion's own
    // layersToExport filter (isExported), which decides WHETHER this
    // function ever gets called for a given layer at all, not what it
    // returns once called. Nodes' own geometry/projections are therefore
    // computed the SAME way regardless -- "dependents keep exact
    // geometry" holds by construction, not by a special case added here.
    expect(manifestB).toEqual(manifestA);
    expect(manifestB.entities.length).toBeGreaterThan(0);
    expect(manifestB.projections.length).toBeGreaterThan(0);
  });

  // H3 (NO-PIECE-WIDTH): rewritten, not deleted — the override-hardcoding
  // half is gone, but the SE17 kind-layer resolution this test was really
  // probing (a stale marker on ONE kind-layer's own owned element) still
  // needs to correctly resolve to the shared parameter under the SAME
  // per-kind-layer split, not just the simpler pre-SE17 path the OVR-
  // FUSION test above already covers.
  it('a per-kind-layer manifest ignores a stale data-override-width on THAT KIND\'s own owned elements the same as the simple path does', () => {
    const pattern = {
      spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 0 },
      nodes: { ends: false, crossings: false, railEnds: false },
      widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: false },
      layers: { rails: 'railsL', ties: 'tiesL', nodes: 'nodesL' },
    };
    const owned = ownedFor(pattern, null, 'p');
    owned.find((o) => o['data-lattice'] === 'rail')['data-override-width'] = '0.5'; // stale, pre-H3 marker
    const on = (layer) => owned.filter((o) => o['data-layer'] === layer);
    const editor = mockEditor([
      { id: 'railsL', pattern, owned: on('railsL') },
      { id: 'tiesL', patternOwner: 'railsL', owned: on('tiesL') },
      { id: 'nodesL', patternOwner: 'railsL', owned: on('nodesL') },
    ]);
    const manifest = _fusionLayerManifest(editor, { id: 'railsL' });
    const rail0Dim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === 'rail0');
    expect(rail0Dim.expression).toBe('rail_width'); // NOT hardcoded
  });
});

/** F35 item 11: _bricksLayerSvg -- the Bricks editor layer's own generated polygons, filtered to
 *  real brick pieces only (editor-io-fusion-geometry.test.js's own minimal getLayerSvg fixture
 *  shape: {_draw, _sketchLayer:{node:{innerHTML}}, _mW, _mH, _layers, _activeLayer}). */
describe('export-flow: _bricksLayerSvg (F35 item 11 -- Send bricks with the B-spline)', () => {
  function bricksEditor(innerHTML, layerId = 'b1') {
    return {
      _draw: {},
      _sketchLayer: { node: { innerHTML } },
      _mW: 7, _mH: 9,
      _layers: [{ id: layerId, name: 'Bricks', holdsBricks: true }],
      _activeLayer: null,
    };
  }

  it('no Bricks layer at all -> empty string', async () => {
    const editor = { _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _layers: [{ id: 'l0', name: 'Layer 1' }], _activeLayer: null };
    expect(await _bricksLayerSvg(editor)).toBe('');
  });

  it('a Bricks layer with only the Brush spine (no real pieces yet) -> empty string', async () => {
    const html = '<line x1="0" y1="0" x2="1" y2="0" data-layer="b1" data-brick="brush-spine"/>';
    expect(await _bricksLayerSvg(bricksEditor(html))).toBe('');
  });

  it('keeps real brick polygons (data-brick-gen="1") and strips the spine line sharing the same layer', async () => {
    const html = [
      '<line x1="0" y1="0" x2="1" y2="0" data-layer="b1" data-brick="brush-spine"/>',
      '<polygon points="0,0 1,0 1,0.3 0,0.3" data-layer="b1" data-brick="wall" data-brick-gen="1"/>',
      '<polygon points="0,0.3 1,0.3 1,0.6 0,0.6" data-layer="b1" data-brick="frame" data-brick-gen="1"/>',
    ].join('');
    const svg = await _bricksLayerSvg(bricksEditor(html));
    expect(svg).toContain('<svg');
    expect((svg.match(/<polygon/g) || [])).toHaveLength(2);
    expect(svg).not.toContain('brush-spine');
    expect(svg).not.toContain('<line');
  });

  it('a different layer\'s own content (data-layer mismatch) never leaks in', async () => {
    const html = '<polygon points="0,0 1,0 1,1" data-layer="other" data-brick="wall" data-brick-gen="1"/>';
    expect(await _bricksLayerSvg(bricksEditor(html))).toBe('');
  });
});
