/**
 * T77 item 3 (TIE-GAP) — the dispatch's own explicit sweep requirement:
 * "sweep test across seeds x counts x presets x orientations: no generated
 * pair closer than minSpacing; parity app==manifest unchanged; kind-layer
 * split (SE17) unaffected." Item 2's own test file
 * (editor-lattice-pattern-tie-gap.test.js) already covers a deep SEED sweep
 * (50 seeds) at fixed count/orientation/no-shape; this file crosses the
 * OTHER three named dimensions the dispatch calls out by name, using the
 * SAME real `generatePattern` + mock-editor pipeline
 * shape-lattice-param-sweep.test.js's own T72 AMEND 5 sweep already
 * established (a preset x rails-count x orientation grid), rather than a
 * second hand-rolled harness.
 */
import { describe, it, expect } from 'vitest';
import {
  generatePattern, PATTERN_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';
import { buildSketchManifest } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';

// Same lightweight-but-real mock (svg.js-shaped elements backed by a plain
// store) as shape-lattice-param-sweep.test.js's own makeMockEditor — copied
// rather than imported, matching this codebase's own established
// per-sweep-file convention (each sweep test owns its own harness copy).
function makeMockEditor(mW, mH) {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
      attr(k, ...rest) { if (rest.length === 0) return store[k]; const v = rest[0]; if (v === null || v === undefined) delete store[k]; else store[k] = v; return elObj; },
      stroke(v) { if (typeof v === 'object' && v !== null) { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return elObj; },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2 }); },
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  return {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [],
    pushState() {}, _notifyChange() {},
  };
}

/** Model-space (real inches, already final/oriented) violation oracle —
 *  unlike editor-lattice-pattern-tie-gap.test.js's own `findViolation`
 *  (which reads PRE-orient lattice i/j units directly off computePattern's
 *  return value), this reads the ACTUALLY DRAWN <line> elements'
 *  x1/y1/x2/y2 (real inches, post-orient), so it needs no separate
 *  horizontal/vertical case: a tie's own two endpoints share exactly one
 *  coordinate (its "column" axis) and differ along the other (its own
 *  span) regardless of orientation -- determined per-pair from the drawn
 *  geometry itself, never from `pattern.orientation`. */
function findDrawnViolation(tieEls, minSpacingIn, tol = 1e-6) {
  const ties = tieEls.map((e) => ({
    x1: +e.attr('x1'), y1: +e.attr('y1'), x2: +e.attr('x2'), y2: +e.attr('y2'),
  }));
  for (let a = 0; a < ties.length; a++) {
    for (let b = a + 1; b < ties.length; b++) {
      const t1 = ties[a]; const t2 = ties[b];
      const vertical1 = Math.abs(t1.x1 - t1.x2) < tol;
      const vertical2 = Math.abs(t2.x1 - t2.x2) < tol;
      if (vertical1 !== vertical2) continue; // never mixed within one orientation; defensive only
      if (vertical1) {
        const lo1 = Math.min(t1.y1, t1.y2); const hi1 = Math.max(t1.y1, t1.y2);
        const lo2 = Math.min(t2.y1, t2.y2); const hi2 = Math.max(t2.y1, t2.y2);
        const overlap = lo1 <= hi2 + tol && lo2 <= hi1 + tol;
        const dist = Math.abs(t1.x1 - t2.x1);
        if (overlap && dist < minSpacingIn - tol) return { t1, t2, dist };
      } else {
        const lo1 = Math.min(t1.x1, t1.x2); const hi1 = Math.max(t1.x1, t1.x2);
        const lo2 = Math.min(t2.x1, t2.x2); const hi2 = Math.max(t2.x1, t2.x2);
        const overlap = lo1 <= hi2 + tol && lo2 <= hi1 + tol;
        const dist = Math.abs(t1.y1 - t2.y1);
        if (overlap && dist < minSpacingIn - tol) return { t1, t2, dist };
      }
    }
  }
  return null;
}

const PRESETS = ['hourglass', 'bottle'];
const ORIENTATIONS = ['horizontal', 'vertical'];
const COUNT_RANGES = [[4, 6], [8, 13], [15, 20]];
const SEEDS = [1, 7, 23];
const REGION = { x: 0, y: 0, w: 7, h: 9 };

describe('T77 item 3: seeds x counts x presets x orientations sweep — no generated tie pair closer than minSpacing', () => {
  for (const preset of PRESETS) {
    for (const orientation of ORIENTATIONS) {
      for (const countRange of COUNT_RANGES) {
        for (const seed of SEEDS) {
          const name = `${preset} ${orientation} count=${countRange.join('-')} seed=${seed}`;
          it(name, async () => {
            const editor = makeMockEditor(REGION.w, REGION.h);
            const pattern = {
              ...PATTERN_DEFAULTS, spacing: 0.25, seed,
              orientation,
              rails: { mode: 'count', count: [6, 7], every: 2, offset: 0 },
              ties: { ...PATTERN_DEFAULTS.ties, count: countRange },
              extent: { mode: 'boundary' },
              shape: { source: 'generated', preset, seed, params: {}, segments: null },
            };
            regenerateSilhouette(editor, pattern);
            await generatePattern(editor, pattern);
            const ties = editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie');
            expect(findDrawnViolation(ties, PATTERN_DEFAULTS.ties.minSpacing), `${name}: no tie pair closer than minSpacing`).toBeNull();
          });
        }
      }
    }
  }
});

describe('T77 item 3: parity app==manifest unchanged under a NON-default minSpacing that genuinely drops ties', () => {
  it('a minSpacing large enough to drop ties still leaves the drawn ties and the manifest ties in exact 1:1 agreement', async () => {
    const editor = makeMockEditor(4, 4);
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 3,
      ties: { ...PATTERN_DEFAULTS.ties, minSpacing: 1.5 }, // well above default 0.5 -- forces real drops
    };
    await generatePattern(editor, pattern);
    const drawnTies = editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie');
    expect(drawnTies.length).toBeGreaterThan(0); // non-vacuous
    expect(drawnTies.length).toBeLessThan(PATTERN_DEFAULTS.ties.count[0]); // genuinely fewer than the declared minimum -- the filter DID something

    const region = { x: 0, y: 0, w: editor._mW, h: editor._mH };
    const manifest = buildSketchManifest(pattern, region, {});
    const manifestTies = manifest.entities.filter((e) => e.type === 'Slot' && e.id.startsWith('tie'));
    expect(manifestTies.length).toBe(drawnTies.length);
  });
});

describe('T77 item 3: kind-layer split (SE17) unaffected by a minSpacing that drops ties', () => {
  it('still splits into exactly Rails/Ties/Nodes, with every drawn tie correctly owned by the Ties layer, even when several candidates were dropped', async () => {
    const editor = makeMockEditor(4, 4);
    const pattern = {
      ...PATTERN_DEFAULTS, seed: 3,
      ties: { ...PATTERN_DEFAULTS.ties, minSpacing: 1.5 }, // same forced-drop scenario as the parity test above
    };
    await generatePattern(editor, pattern);

    expect(editor._layers).toHaveLength(3);
    const [railsLayer, tiesLayer, nodesLayer] = editor._layers;
    expect(railsLayer.name).toBe('Rails');
    expect(tiesLayer.name).toBe('Ties');
    expect(nodesLayer.name).toBe('Nodes');
    expect(pattern.layers).toEqual({ rails: railsLayer.id, ties: tiesLayer.id, nodes: nodesLayer.id });

    const drawnTies = editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie');
    expect(drawnTies.length).toBeGreaterThan(0); // non-vacuous: the drop didn't zero out every tie
    expect(drawnTies.length).toBeLessThan(PATTERN_DEFAULTS.ties.count[0]); // confirms this scenario really did drop some
    for (const el of drawnTies) {
      expect(el.attr('data-layer')).toBe(tiesLayer.id);
    }
  });
});
