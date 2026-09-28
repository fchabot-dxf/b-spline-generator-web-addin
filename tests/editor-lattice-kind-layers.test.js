/**
 * T76 (SE17, item 1) — the declared kind->layer map + Fusion sketch build
 * order: LATTICE_FUSION_BUILD_ORDER (editor-lattice-pattern.js) is the ONE
 * table both the (future) per-kind layer creation AND the Fusion build
 * sequencing read from, so the two can never independently drift.
 * Pure data, no behavior yet -- this file just locks the declared SHAPE
 * down before anything starts consuming it.
 */
import { describe, it, expect } from 'vitest';
import {
  LATTICE_FUSION_BUILD_ORDER, LATTICE_KIND_LAYER_DEFAULTS, resolvePatternLayer, _ensureKindLayers,
  recolorOwnedKind, detachAllOwned, PATTERN_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { currentPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';

/** Same lightweight-but-real shape editor-lattice-pattern-emit.test.js's
 *  own `_makeMockEditor` already establishes -- `addLayer`/`setActiveLayer`
 *  (layers.js) tolerate this minimal a mock fine (renderLayersPanel/
 *  applyLayerState/refreshOutlinePreview all no-op gracefully with no real
 *  DOM panel present). */
function makeMockEditor() {
  return {
    _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, node: {} },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    pushState() {},
    _notifyChange() {},
  };
}

describe('LATTICE_FUSION_BUILD_ORDER', () => {
  it('is exactly contour -> rails -> ties -> nodes -- the fixed Fusion dependency order (contour under rails, rails under ties, rails/ties under nodes)', () => {
    expect(LATTICE_FUSION_BUILD_ORDER).toEqual(['contour', 'rails', 'ties', 'nodes']);
  });

  it('is frozen -- a declared constant, never mutated by a consumer', () => {
    expect(Object.isFrozen(LATTICE_FUSION_BUILD_ORDER)).toBe(true);
  });
});

describe('LATTICE_KIND_LAYER_DEFAULTS', () => {
  it('has exactly one entry per LATTICE_FUSION_BUILD_ORDER kind -- neither table can drift ahead of the other', () => {
    expect(Object.keys(LATTICE_KIND_LAYER_DEFAULTS).sort()).toEqual([...LATTICE_FUSION_BUILD_ORDER].sort());
  });

  it('every entry declares at least its own layer name', () => {
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(typeof LATTICE_KIND_LAYER_DEFAULTS[kind].name).toBe('string');
      expect(LATTICE_KIND_LAYER_DEFAULTS[kind].name.length).toBeGreaterThan(0);
    }
  });

  it('rails/ties/nodes keep the recovered SE7b tuned tooling (rails/ties V-bit, ties shallower; nodes ballnose)', () => {
    expect(LATTICE_KIND_LAYER_DEFAULTS.rails).toEqual({ name: 'Rails', depth: 0.15, profile: 'vbit', angle: 90, carve: false });
    expect(LATTICE_KIND_LAYER_DEFAULTS.ties).toEqual({ name: 'Ties', depth: 0.08, profile: 'vbit', angle: 90, carve: false });
    expect(LATTICE_KIND_LAYER_DEFAULTS.nodes).toEqual({ name: 'Nodes', depth: 0.12, profile: 'ballnose', angle: 90, carve: false });
  });

  it('contour (a genuinely new kind-layer, no SE7b precedent) declares only its own name (+ carve off), deferring every other tooling field to addLayer\'s own generic TOOLING_DEFAULTS', () => {
    expect(LATTICE_KIND_LAYER_DEFAULTS.contour).toEqual({ name: 'Contour', carve: false });
  });

  it('every lattice layer is created with the 3D relief OFF (Fred: "lattice should be created with the 3d relief off by default"), including the current layer that becomes Rails', () => {
    const editor = makeMockEditor();
    expect(editor._layers[0].carve).not.toBe(false); // non-vacuous: an ordinary layer carves by default
    const ids = _ensureKindLayers(editor, { seed: 1 }, editor._layers[0].id, [...LATTICE_FUSION_BUILD_ORDER]);
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(editor._layers.find((l) => l.id === ids[kind]).carve, kind).toBe(false);
    }
  });

  it('is frozen, including every per-kind entry -- a declared table, never mutated by a consumer', () => {
    expect(Object.isFrozen(LATTICE_KIND_LAYER_DEFAULTS)).toBe(true);
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(Object.isFrozen(LATTICE_KIND_LAYER_DEFAULTS[kind])).toBe(true);
    }
  });
});

describe('resolvePatternLayer (T76 item 2)', () => {
  it('returns the layer itself when it directly holds .pattern (the PRIMARY/rails layer)', () => {
    const editor = makeMockEditor();
    editor._layers[0].pattern = { seed: 1 };
    expect(resolvePatternLayer(editor, '0')).toBe(editor._layers[0]);
  });

  it('returns the PRIMARY layer when given a sibling kind-layer\'s own id (via patternOwner)', () => {
    const editor = makeMockEditor();
    editor._layers[0].pattern = { seed: 1 };
    editor._layers.push({ id: '1', name: 'Ties', patternOwner: '0' });
    expect(resolvePatternLayer(editor, '1')).toBe(editor._layers[0]);
  });

  it('returns null for an ordinary layer with neither .pattern nor .patternOwner', () => {
    const editor = makeMockEditor();
    expect(resolvePatternLayer(editor, '0')).toBeNull();
  });

  it('returns null for a layer id that does not exist at all', () => {
    const editor = makeMockEditor();
    expect(resolvePatternLayer(editor, 'nope')).toBeNull();
  });
});

describe('_ensureKindLayers (T76 item 2)', () => {
  it('on the FIRST split, the CURRENT layer becomes rails directly (renamed, same id) -- no orphaned empty container', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    expect(ids.rails).toBe('0');
    expect(editor._layers[0].name).toBe('Rails');
    expect(editor._layers[0].pattern).toBe(pattern);
  });

  it('creates the OTHER requested kinds as new sibling layers, each pointing back at rails via patternOwner', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    expect(editor._layers).toHaveLength(3);
    const ties = editor._layers.find((l) => l.id === ids.ties);
    const nodes = editor._layers.find((l) => l.id === ids.nodes);
    expect(ties.name).toBe('Ties');
    expect(ties.patternOwner).toBe('0');
    expect(nodes.name).toBe('Nodes');
    expect(nodes.patternOwner).toBe('0');
    // the recovered SE7b tooling values, not the generic TOOLING_DEFAULTS.
    expect(ties.depth).toBe(0.08);
    expect(nodes.profile).toBe('ballnose');
  });

  it('is idempotent -- a second call with the SAME kinds reuses the existing layers, creates nothing new', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const first = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const second = _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    expect(second).toEqual(first);
    expect(editor._layers).toHaveLength(3);
  });

  it('a contour-only call (regenerateSilhouette\'s own case, which can run BEFORE rails/ties/nodes ever have) still ensures rails FIRST, so contour\'s own patternOwner is always valid', () => {
    const editor = makeMockEditor();
    const pattern = {};
    const ids = _ensureKindLayers(editor, pattern, '0', ['contour']);
    expect(ids.rails).toBe('0'); // ensured as a side effect, even though only 'contour' was asked for
    expect(ids.contour).toBeTruthy();
    const contourLayer = editor._layers.find((l) => l.id === ids.contour);
    expect(contourLayer.patternOwner).toBe('0');
    expect(contourLayer.name).toBe('Contour');
  });

  it('a LATER call for a NEW kind (e.g. converting an existing box lattice to a shape lattice) reuses the EXISTING rails id, not the current active layer', () => {
    const editor = makeMockEditor();
    const pattern = {};
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    // the user has since switched to the Ties layer -- '1' is NOT rails.
    const ids = _ensureKindLayers(editor, pattern, '1', ['contour']);
    expect(ids.rails).toBe('0'); // untouched -- NOT reassigned to '1'
    const contourLayer = editor._layers.find((l) => l.id === ids.contour);
    expect(contourLayer.patternOwner).toBe('0');
  });
});

describe('currentPattern (properties-shape-lattice.js) does NOT fork the pattern when the active layer is a SIBLING kind-layer (T76 item 2, the critical fix)', () => {
  it('activating a sibling (e.g. clicking a tie activates the Ties layer, editor-interaction.js) still returns the SAME shared pattern object -- never a freshly-created default one', () => {
    const editor = makeMockEditor();
    const pattern = { seed: 999 };
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const tiesLayerId = pattern.layers.ties;

    editor._activeLayer = tiesLayerId; // simulates clicking a tie
    const readBack = currentPattern(editor);

    expect(readBack).toBe(pattern); // the EXACT same object -- not a fork
    expect(readBack.seed).toBe(999);
  });
});

/**
 * T76 (SE17, item 7 — the explicit decide+log point): "saved single-layer
 * lattices from before SE17 still load (migrate on read or keep as one
 * layer — decide+log)". Decided: KEEP AS ONE LAYER on load, migrating
 * LAZILY (automatically, no separate migration step at all) the next
 * time Generate/Regenerate actually runs on it — neither of the two named
 * options taken as-is, but the one every OTHER fallback in this whole
 * feature already implements for free: `pattern.layers` absent means
 * every "act on everything" helper resolves straight to the one shared
 * `layerId` it was always given, unchanged from before this turn. A file
 * that's loaded and never touched again behaves EXACTLY as it always has
 * — zero risk, zero new migration code to get wrong — and the instant the
 * user next hits Generate, `_ensureKindLayers` (item 2) splits it, using
 * the SAME code path a brand-new pattern already takes, not a special
 * "migrated" branch of its own.
 */
describe('T76 item 7: a pre-SE17 saved pattern (no .layers field at all) keeps working, unmigrated, until the next Generate', () => {
  function makeMockElement(store) {
    return {
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k];
        else store[k] = v;
        return this;
      },
      stroke(v) { if (v && v.color) store.stroke = v.color; return this; },
      fill(v) { if (v !== undefined) store.fill = v; return this; },
    };
  }

  it('recolorOwnedKind/detachAllOwned still act on the ONE shared layer\'s own owned pieces directly -- no pattern.layers lookup needed, nothing forced to split just to be edited', () => {
    const pattern = { ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)) }; // no .layers key, exactly like an old save
    const railEl = makeMockElement({ 'data-layer': '0', 'data-lattice-gen': pattern.id || 'old', 'data-lattice': 'rail', stroke: '#ff0000' });
    const tieEl = makeMockElement({ 'data-layer': '0', 'data-lattice-gen': pattern.id || 'old', 'data-lattice': 'tie', stroke: '#ffff00' });
    const editor = {
      _layers: [{ id: '0', name: 'Layer 1', visible: true, pattern }],
      _sketchLayer: { children() { const a = [railEl, tieEl]; a.toArray = () => a; return a; } },
      pushState() {}, _notifyChange() {},
    };

    const recolored = recolorOwnedKind(editor, '0', 'rails', '#00ff00');
    expect(recolored).toBe(1);
    expect(railEl.attr('stroke')).toBe('#00ff00');
    expect(tieEl.attr('stroke')).toBe('#ffff00'); // untouched -- rails-only recolor

    const detached = detachAllOwned(editor, '0');
    expect(detached).toBe(2); // BOTH pieces, still correctly found on the one shared layer
    expect(railEl.node.hasAttribute('data-lattice-gen')).toBe(false);
    expect(tieEl.node.hasAttribute('data-lattice-gen')).toBe(false);
  });
});
