/**
 * SE4c — MIGRATIONS / runMigrations (main/app-init.js).
 *
 * A pre-SE4 save carried each stamp layer's drawing as a `.svg` field on
 * its own P.stampLayers entry. SE4c retired that field from the shape
 * entirely — content now lives only in the unified editor document
 * (P.editorSvg). The `legacy-stamp-svg` migration is the one-time bridge:
 * on load, if a save still has the old shape, synthesize an editor
 * document from it, populate P.editorSvg, and strip the legacy fields.
 *
 * Three things are guarded here, matching the dispatch's own verify list:
 *  1. A single legacy layer migrates: editorSvg gets populated once, the
 *     legacy field is gone.
 *  2. A two-layer legacy save: EACH layer's content lands under its own
 *     data-layer group (not just the first — the design's own risk note,
 *     since editorRestoreSvg's old `.find()` fallback only ever picked
 *     the first).
 *  3. Running migrations twice is a no-op (idempotent on the new shape).
 */
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

function svgWith(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

describe('runMigrations: legacy-stamp-svg', () => {
  it('migrates a single legacy layer into P.editorSvg and strips the legacy fields', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), mask: 'stale', depth: 0.25, enabled: true },
      ],
    };

    runMigrations(P);

    expect(P.editorSvg).toBeTruthy();
    expect(P.editorSvg).toContain('data-layer="0"');
    expect(P.editorSvg).toContain('<rect');
    expect(P.stampLayers[0].svg).toBeUndefined();
    expect(P.stampLayers[0].mask).toBeUndefined();
    // Tooling untouched.
    expect(P.stampLayers[0].depth).toBe(0.25);
    expect(P.stampLayers[0].enabled).toBe(true);

    // The roster carried in data-editor-layers describes both layers by
    // POSITION (id "0"), not the legacy P.stampLayers id ("layer0") —
    // parse it out rather than assume the string shape.
    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster).toHaveLength(1);
    expect(roster[0].id).toBe('0');
    expect(roster[0].depth).toBe(0.25);
  });

  it('migrates EVERY legacy layer with content into its own data-layer group, not just the first', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
        { id: 'layer1', name: 'Layer 2', svg: svgWith('<circle r="2"/>'), depth: 0.5 },
      ],
    };

    runMigrations(P);

    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const children = Array.from(root.children);
    const layer0Children = children.filter(ch => ch.getAttribute('data-layer') === '0');
    const layer1Children = children.filter(ch => ch.getAttribute('data-layer') === '1');

    expect(layer0Children).toHaveLength(1);
    expect(layer0Children[0].tagName.toLowerCase()).toBe('rect');
    expect(layer1Children).toHaveLength(1);
    expect(layer1Children[0].tagName.toLowerCase()).toBe('circle');

    expect(P.stampLayers[0].svg).toBeUndefined();
    expect(P.stampLayers[1].svg).toBeUndefined();

    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster.map(l => l.id)).toEqual(['0', '1']);
  });

  it('gives an empty legacy layer (no .svg) its own roster entry with no content, keeping position alignment', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
        { id: 'layer1', name: 'Layer 2', svg: null, depth: 0.5 },
      ],
    };

    runMigrations(P);

    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster).toHaveLength(2);
    expect(roster[1].id).toBe('1');
    expect(Array.from(root.children).some(ch => ch.getAttribute('data-layer') === '1')).toBe(false);
  });

  it('is a no-op the second time (idempotent)', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
      ],
    };

    runMigrations(P);
    const first = P.editorSvg;

    runMigrations(P);

    expect(P.editorSvg).toBe(first);
  });

  it('does nothing when there is no legacy content to migrate', () => {
    const P = { editorSvg: null, stampLayers: [{ id: 'layer0', name: 'Layer 1', depth: 0.25 }] };
    runMigrations(P);
    expect(P.editorSvg).toBeNull();
  });

  it('does nothing when P.editorSvg is already populated, even if a legacy field is still present', () => {
    const P = {
      editorSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      stampLayers: [{ id: 'layer0', svg: svgWith('<rect/>'), depth: 0.25 }],
    };
    runMigrations(P);
    expect(P.editorSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(P.stampLayers[0].svg).toBeTruthy(); // untouched — when() gated on !editorSvg
  });
});

/**
 * SE10 AMEND — layer-carve-flag. Before SE10, `visible === false` ALSO
 * meant "don't carve" (there was no other switch). editor/layers.js's own
 * applyToolingDefaults fills a MISSING `carve` with a flat
 * TOOLING_DEFAULTS.carve (true) on restore, which would silently start
 * carving a layer the user had deliberately hidden pre-SE10. This
 * migration gives every already-saved layer its correct HISTORICAL carve
 * value (carve = it was visible) before that flat default ever applies.
 */
describe('runMigrations: layer-carve-flag', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('a hidden layer missing carve gets carve:false (its historical behavior)', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(false);
  });

  it('a shown layer missing carve gets carve:true', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: true }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(true);
  });

  it('a layer that already HAS carve is left exactly as saved, not overridden from visible', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false, carve: true }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(true); // NOT flipped to false by visible
  });

  it('mixed roster: only the layer missing carve is touched', () => {
    const P = {
      editorSvg: editorSvgWithLayers([
        { id: '0', name: 'Layer 1', visible: true },               // missing carve -> gets true
        { id: '1', name: 'Layer 2', visible: false, carve: true },  // already set -> untouched
      ]),
    };
    runMigrations(P);
    const roster = rosterOf(P);
    expect(roster[0].carve).toBe(true);
    expect(roster[1].carve).toBe(true);
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false }]) };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });

  it('does nothing when every layer already has carve', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false, carve: false }]) };
    const before = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(before);
  });

  it('does nothing (does not throw) when there is no data-editor-layers roster at all', () => {
    const P = { editorSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
    expect(() => runMigrations(P)).not.toThrow();
    expect(P.editorSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });
});

/**
 * NODE-D — node-radius-to-diameter. A lattice layer's own `.pattern.
 * widths.nodeRadius` (OLD meaning: a radius) becomes `.pattern.widths.
 * nodeDiameter` (NEW meaning: a diameter, doubled) so an already-saved
 * CUSTOM node size survives the rename — the PATTERN_DEFAULTS.widths
 * merge every reader already does would otherwise silently substitute
 * the NEW default for a missing `nodeDiameter` key instead of converting
 * the old value.
 */
describe('runMigrations: node-radius-to-diameter', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('a layer with an old nodeRadius gets nodeDiameter = 2x it, and nodeRadius is removed', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { rails: 0.3, nodeRadius: 0.1 } } }]) };
    runMigrations(P);
    const widths = rosterOf(P)[0].pattern.widths;
    expect(widths.nodeDiameter).toBeCloseTo(0.2, 10);
    expect(widths.nodeRadius).toBeUndefined();
    expect(widths.rails).toBe(0.3); // untouched
  });

  it('a layer that already has nodeDiameter is left exactly as saved, never re-derived from a stale nodeRadius', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.1, nodeDiameter: 0.5 } } }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].pattern.widths.nodeDiameter).toBe(0.5); // NOT 0.2
  });

  it('a layer with no pattern (a plain non-lattice layer) is left untouched, no throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1' }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern).toBeUndefined();
  });

  it('mixed roster: only the layer with a stale nodeRadius is converted', () => {
    const P = {
      editorSvg: editorSvgWithLayers([
        { id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.2 } } }, // converts to 0.4
        { id: '1', name: 'Layer 2', pattern: { widths: { nodeDiameter: 0.15 } } }, // already migrated, untouched
        { id: '2', name: 'Layer 3' }, // no pattern at all, untouched
      ]),
    };
    runMigrations(P);
    const roster = rosterOf(P);
    expect(roster[0].pattern.widths.nodeDiameter).toBeCloseTo(0.4, 10);
    expect(roster[1].pattern.widths.nodeDiameter).toBe(0.15);
    expect(roster[2].pattern).toBeUndefined();
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.1 } } }]) };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });
});
