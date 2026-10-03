/**
 * T80 item 1 (Fred's screenshot: Shape Lattice hourglass, Ties Count 8-13,
 * span Rails, one-ended 1, min spacing 0.5 -> only 4 ties drawn). The count
 * was chosen before the filters (inside the shape, ends on real rails, min
 * spacing) dropped ties. Now the valid ties are found first and the count is
 * chosen from them; when fewer than Count's minimum fit, it's reported.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  generatePattern, PATTERN_DEFAULTS, tieShortfallText,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { regenerateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';

// Same lightweight-but-real mock as the tie-gap sweep test (this codebase's
// convention: each such test file owns its own harness copy).
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

// Fred's exact settings, stated explicitly rather than relied on as defaults.
function fredsHourglass(seed, tieOverrides = {}) {
  return {
    ...PATTERN_DEFAULTS, spacing: 0.25, seed,
    ties: {
      ...PATTERN_DEFAULTS.ties,
      mode: 'count', count: [8, 13], span: { mode: 'rails', rails: 1 }, oneEnded: 1, minSpacing: 0.5,
      ...tieOverrides,
    },
    extent: { mode: 'boundary' },
    shape: { source: 'generated', preset: 'hourglass', seed, params: {}, segments: null },
  };
}

async function run(pattern) {
  const editor = makeMockEditor(7, 9);
  regenerateSilhouette(editor, pattern);
  const result = await generatePattern(editor, pattern);
  const drawn = editor._sketchLayer.children().toArray().filter((e) => e.attr('data-lattice') === 'tie').length;
  return { result, drawn };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="editorStatusHint" style="display:none"></div>';
});

describe('T80 item 1: Count is honoured -- the valid ties are found first, then the count is chosen', () => {
  it("Fred's hourglass (8-13, rails, one-ended 1, min spacing 0.5) draws at least 8 ties, or reports the shortfall, on every seed", async () => {
    let honoured = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { result, drawn } = await run(fredsHourglass(seed));
      expect(drawn, `seed ${seed}`).toBeLessThanOrEqual(13);
      if (drawn >= 8) {
        honoured++;
        expect(result.tieShortfall, `seed ${seed}`).toBeNull();
      } else {
        expect(result.tieShortfall, `seed ${seed}: ${drawn} ties with no shortfall reported`).toEqual({ placed: drawn, min: 8 });
      }
    }
    // The fix's own point: on this shape enough valid ties exist, so almost
    // every seed lands in range (before the fix: as few as 4). H23 item 66
    // (a tie must also clear the contour by a declared margin, layered on
    // TOP of this fix) can legitimately take the count back below 8 on a
    // seed where the only remaining valid candidates are too close to the
    // contour -- correctly REPORTED as a shortfall above, not silently
    // dropped, so this number is no longer a strict 20: MEASURED, 18/20
    // with item 66's own fix in place (2 genuine, correctly-reported
    // shortfalls, not a regression of T80 item 1 itself).
    expect(honoured).toBe(18);
  });

  it('when fewer than the minimum fit, all that fit are placed and the editor says so', async () => {
    const { result, drawn } = await run(fredsHourglass(7, { minSpacing: 3 }));
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(8);
    expect(result.tieShortfall).toEqual({ placed: drawn, min: 8 });
    const hint = document.getElementById('editorStatusHint');
    expect(hint.textContent).toBe(tieShortfallText(result.tieShortfall));
    expect(hint.textContent).toContain(`only ${drawn} fit`);
    expect(hint.style.display).toBe('block');
  });

  it('the shortfall message is cleared once enough ties fit again, without touching an unrelated hint', async () => {
    await run(fredsHourglass(7, { minSpacing: 3 }));
    const hint = document.getElementById('editorStatusHint');
    expect(hint.textContent).toContain('only');
    await run(fredsHourglass(7));
    expect(hint.textContent).toBe('');

    hint.textContent = 'Some other panel message';
    hint.style.display = 'block';
    await run(fredsHourglass(7));
    expect(hint.textContent).toBe('Some other panel message');
  });

  it('stays seed-deterministic', async () => {
    const a = await run(fredsHourglass(11));
    const b = await run(fredsHourglass(11));
    expect(b.result.segments).toEqual(a.result.segments);
  });
});
