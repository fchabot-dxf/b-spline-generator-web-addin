/**
 * SE12 T43 (Slice 4) — the Fusion export honors a layer's own
 * fusionGeometry pick (centerline / outline / both), via
 * getLayerSvg(editor, id, dpi, {geometry:'fusion'}).
 *
 * Root design point this suite guards: ONE geometry engine. The outline
 * `d` for each element comes from OUTLINE_KINDS (editor-outline-preview.js)
 * — the exact table that already drives the live, on-canvas outline
 * preview (T37-T40) — via a plain-DOM adapter (_outlineAdapter, not
 * exported; this file drives it only through getLayerSvg's own public
 * contract, same as every other editor-io test). A regression that forked
 * a second copy of the geometry math for export would NOT be caught by
 * editor-outline-preview.test.js (it only ever exercises the preview
 * path) — this file is what closes that gap.
 *
 * The default call (no options, or options without geometry:'fusion')
 * MUST stay byte-for-byte what it was before this slice — that's the
 * stamp-mask-manager.js carve-mask contract (getLayerSvg's own
 * docstring), and every EDM3/EDM3b test in editor-serialization.test.js
 * already locks that path down; this file adds ONE explicit "still
 * ignores fusionGeometry" case for it, rather than re-deriving the whole
 * EDM3b suite here.
 */
import { describe, it, expect, vi } from 'vitest';
import { getLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

function mockEditor(innerHTML, layers, { mW = 7, mH = 9 } = {}) {
  return {
    _draw: {},
    _sketchLayer: { node: { innerHTML } },
    _mW: mW,
    _mH: mH,
    _layers: layers,
    _activeLayer: null,
  };
}

// Every M/L/A/Z-only assertion below reads the command LETTERS out of a
// `d` string (case-sensitive — these engines only ever emit absolute
// uppercase commands) and checks none outside that set appear — the
// dispatch's own "path with only M/L/A/Z" contract, not just "some path
// got created".
function commandLetters(d) {
  return (d.match(/[A-Za-z]/g) || []);
}

describe('getLayerSvg — default call ignores fusionGeometry (carve-mask contract untouched)', () => {
  it('a layer with fusionGeometry:"outline" still exports its raw centerline when {geometry:"fusion"} is NOT requested', () => {
    const html = '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const withOpt = getLayerSvg(mockEditor(html, layers), '0');
    const withoutLayers = getLayerSvg(mockEditor(html, []), '0');
    expect(withOpt).toBe(withoutLayers); // fusionGeometry never even read on this path
    expect(withOpt).toContain('<line');
    expect(withOpt).not.toContain('<path');
  });
});

describe('getLayerSvg({geometry:"fusion"}) — centerline pick', () => {
  it('returns the SAME bytes the default call would, just wrapped in a Promise', async () => {
    const html = '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'centerline' }];
    const editor = mockEditor(html, layers);
    const plain = getLayerSvg(editor, '0');
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(svg).toBe(plain);
    expect(declined).toBe(0);
  });

  it('a layer with no fusionGeometry field at all also defaults to centerline (undefined -> "centerline", same as showsOutline\'s own convention)', async () => {
    const html = '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const layers = [{ id: '0' }];
    const editor = mockEditor(html, layers);
    const { svg } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(svg).toContain('<line');
    expect(svg).not.toContain('<path');
  });
});

describe('getLayerSvg({geometry:"fusion"}) — outline pick', () => {
  it('replaces the element with a path (no fill, only M/L/A/Z) and drops the original', async () => {
    const html = '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });

    expect(declined).toBe(0);
    expect(svg).not.toContain('<line');
    const dMatch = svg.match(/<path[^>]*\sd="([^"]+)"/);
    expect(dMatch).not.toBeNull();
    const letters = commandLetters(dMatch[1]);
    expect(letters.length).toBeGreaterThan(0);
    expect(letters.every((c) => 'MLAZ'.includes(c))).toBe(true);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('data-layer="0"'); // data-* carried over onto the replacement
  });

  it('carries the source element\'s own transform attribute onto the outline path, uncomposed (same contract as the live preview)', async () => {
    const html = '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0" transform="translate(1,2)"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(svg).toContain('transform="translate(1,2)"');
  });
});

describe('getLayerSvg({geometry:"fusion"}) — both pick', () => {
  it('keeps the original centerline element AND adds the outline path alongside it', async () => {
    const html = '<rect x="0" y="0" width="2" height="1" stroke-width="0.1" fill="none" stroke="#000000" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'both' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });

    expect(declined).toBe(0);
    expect(svg).toContain('<rect'); // centerline survives
    const dMatch = svg.match(/<path[^>]*\sd="([^"]+)"/);
    expect(dMatch).not.toBeNull(); // and the outline path was added
    const letters = commandLetters(dMatch[1]);
    expect(letters.every((c) => 'MLAZ'.includes(c))).toBe(true);
  });
});

describe('getLayerSvg({geometry:"fusion"}) — declined elements fall back + are counted', () => {
  it('an element with no OUTLINE_KINDS entry for its type (e.g. an image) exports its centerline untouched and is counted as declined', async () => {
    const html = '<image x="0" y="0" width="1" height="1" href="data:," data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { svg, declined, declinedKinds } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
      expect(declined).toBe(1);
      expect(declinedKinds).toEqual(['image']);
      expect(svg).toContain('<image'); // fell back to its own centerline, not dropped
      expect(svg).not.toContain('<path');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('declined outline geometry');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('text declines in this test environment (no live font fetch — see editor-outline-preview.test.js\'s own OUTLINE_KINDS.text test for why) and is counted the same way', async () => {
    const html = '<text x="0" y="1" font-family="Arial" font-size="1" data-layer="0">Hi</text>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { svg, declined, declinedKinds } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
      expect(declined).toBe(1);
      expect(declinedKinds).toEqual(['text']);
      expect(svg).toContain('<text');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('declinedKinds is the DISTINCT set of kinds, not one entry per declined element — 2 declined images count as 1 kind', async () => {
    const html = '<image x="0" y="0" width="1" height="1" href="data:," data-layer="0"/><image x="2" y="0" width="1" height="1" href="data:," data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { declined, declinedKinds } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
      expect(declined).toBe(2);
      expect(declinedKinds).toEqual(['image']);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('getLayerSvg({geometry:"fusion"}) — T45 ADD-ON: a full circle exports as a native <circle>, not two SketchArc-importing A commands', () => {
  it('a <circle> element (fill mode) exports as exactly ONE native <circle>, no <path> at all', async () => {
    const html = '<circle cx="2" cy="3" r="1" fill="#000000" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(declined).toBe(0);
    expect(svg).not.toContain('<path');
    expect((svg.match(/<circle/g) || []).length).toBe(1);
    expect(svg).toContain('cx="2"');
    expect(svg).toContain('cy="3"');
    expect(svg).toContain('r="1"');
  });

  it('a <circle> element (stroke mode, real annulus) exports as exactly TWO native <circle> elements (outer + inner), no <path>', async () => {
    const html = '<circle cx="0" cy="0" r="5" stroke="#000000" stroke-width="1" fill="none" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(declined).toBe(0);
    expect(svg).not.toContain('<path');
    expect((svg.match(/<circle/g) || []).length).toBe(2);
    expect(svg).toContain('r="5.5"'); // outer
    expect(svg).toContain('r="4.5"'); // inner
  });

  it('mode:"both" keeps the original centerline <circle> AND adds a new outline <circle> alongside it (2 total, still no <path>)', async () => {
    const html = '<circle cx="1" cy="1" r="2" fill="#000000" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'both' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(declined).toBe(0);
    expect(svg).not.toContain('<path');
    expect((svg.match(/<circle/g) || []).length).toBe(2);
  });

  it('a zero-length <line> (round cap) exports as a native <circle> too — the OTHER producer of this same shape', async () => {
    const html = '<line x1="3" y1="4" x2="3" y2="4" stroke-width="2" stroke-linecap="round" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(declined).toBe(0);
    expect(svg).not.toContain('<path');
    expect(svg).toContain('<circle');
    expect(svg).toContain('r="1"'); // strokeWidth/2
  });

  it('a NORMAL (non-zero-length) round-capped <line> still exports as a <path> with A commands — its two caps are genuinely separate half-circles, not one full circle', async () => {
    const html = '<line x1="0" y1="0" x2="10" y2="0" stroke-width="2" stroke-linecap="round" data-layer="0"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg, declined } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(declined).toBe(0);
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<circle');
  });

  it('the exported <circle> carries the source element\'s own data-* attrs and transform, same as the <path> replacement does', async () => {
    const html = '<circle cx="0" cy="0" r="1" fill="#000000" data-layer="0" transform="translate(2,3)"/>';
    const layers = [{ id: '0', fusionGeometry: 'outline' }];
    const editor = mockEditor(html, layers);
    const { svg } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(svg).toContain('data-layer="0"');
    expect(svg).toContain('transform="translate(2,3)"');
  });
});

describe('getLayerSvg({geometry:"fusion"}) — edge cases mirror the default path\'s own contract', () => {
  it('returns {svg:"", declined:0} when the layer has no matching children (default path returns "")', async () => {
    const layers = [{ id: '99', fusionGeometry: 'outline' }];
    const editor = mockEditor('<path data-layer="0" d="M0 0"/>', layers);
    const { svg, declined } = await getLayerSvg(editor, '99', 96, { geometry: 'fusion' });
    expect(svg).toBe('');
    expect(declined).toBe(0);
  });

  it('returns {svg:"", declined:0} when the editor is not drawn yet', async () => {
    const { svg, declined } = await getLayerSvg({ _draw: null, _sketchLayer: {} }, '0', 96, { geometry: 'fusion' });
    expect(svg).toBe('');
    expect(declined).toBe(0);
  });
});

describe('getLayerSvg — T72 (SE14c): a display:none child is dropped from BOTH export paths', () => {
  it('the default (non-fusion) export omits a display:none child but keeps a visible sibling', () => {
    const html = '<path data-layer="0" d="M0 0 L1 1" display="none"/>'
      + '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const svg = getLayerSvg(editor, '0');
    expect(svg).not.toContain('<path');
    expect(svg).toContain('<line');
  });

  it('the fusion-geometry export ALSO omits a display:none child (same shared _parseLayerContent filter)', async () => {
    const html = '<path data-layer="0" d="M0 0 L1 1" display="none"/>'
      + '<line x1="0" y1="0" x2="2" y2="0" stroke-width="0.2" data-layer="0"/>';
    const editor = mockEditor(html, [{ id: '0', fusionGeometry: 'centerline' }]);
    const { svg } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion' });
    expect(svg).not.toContain('<path');
    expect(svg).toContain('<line');
  });

  it('a visible (no display attribute) child is unaffected — non-vacuous: this is genuinely opt-in, not a blanket drop', () => {
    const html = '<path data-layer="0" d="M0 0 L1 1"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const svg = getLayerSvg(editor, '0');
    expect(svg).toContain('<path');
  });
});

/**
 * T74 AMEND 5 (Fred, live: a hand-drawn layer got sent to Fusion as a
 * LATTICE constrained sketch instead of its own artwork) — the fix's own
 * mixed-layer half: `options.excludeLatticeOwnedFor` (a PATTERN object)
 * strips that pattern's own lattice/contour content out of the returned
 * SVG, so export-flow.js can send a layer's non-lattice remainder
 * alongside its sketchManifest without duplicating the lattice geometry.
 * A generated silhouette's own contour segments carry NO
 * `data-lattice-gen` at all (they're linked via `data-boundary-ref`
 * instead, regenerateSilhouette's own separate mechanism), so BOTH
 * attributes are exercised here, not just the OWNERSHIP one.
 */
describe('getLayerSvg({excludeLatticeOwnedFor}) — T74 AMEND 5: strips this pattern\'s own lattice/contour content, leaves everything else', () => {
  it('a pure hand-drawn layer (no lattice content at all) is completely unaffected by the option', () => {
    const html = '<path data-layer="0" d="M0 0 L1 1"/><path data-layer="0" d="M2 2 L3 3"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const withOption = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: { shape: { source: 'generated' }, extent: { mode: 'boundary' }, boundary: { shapeId: 'nope' } } });
    const withoutOption = getLayerSvg(editor, '0');
    expect(withOption).toBe(withoutOption);
    expect((withOption.match(/<path/g) || []).length).toBe(2);
  });

  it('a pure lattice layer (every child owned) excludes down to nothing -- null content, never a fallback to the unfiltered SVG', () => {
    const html = '<line data-layer="0" data-lattice-gen="lat1" x1="0" y1="0" x2="1" y2="0"/>'
      + '<line data-layer="0" data-lattice-gen="lat1" x1="0" y1="1" x2="1" y2="1"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const pattern = { shape: { source: 'generated' }, extent: {}, boundary: {} }; // no boundary needed -- OWNERSHIP_ATTR alone covers rails/ties/nodes
    const svg = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: pattern });
    expect(svg).toBe(''); // getLayerSvg's own established "nothing to export" contract (_parseLayerContent returns null)
  });

  it('a MIXED layer: owned rails/ties/nodes (data-lattice-gen) are stripped, hand-drawn siblings survive', () => {
    const html = '<line data-layer="0" data-lattice-gen="lat1" x1="0" y1="0" x2="1" y2="0"/>'
      + '<path data-layer="0" d="M5 5 L6 6"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const pattern = { shape: { source: 'generated' }, extent: {}, boundary: {} };
    const svg = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: pattern });
    expect(svg).not.toContain('<line');
    expect(svg).toContain('<path');
    expect(svg).toContain('M5 5 L6 6');
  });

  it('a MIXED layer: a generated silhouette own contour segments (data-boundary-ref, no OWNERSHIP_ATTR at all) are ALSO stripped when hasGeneratedSilhouette(pattern) matches its shapeId, hand-drawn siblings survive', () => {
    const html = '<path data-layer="0" data-boundary-ref="shape-1" d="M0 0 L1 0"/>'
      + '<path data-layer="0" d="M5 5 L6 6"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const pattern = { shape: { source: 'generated' }, extent: { mode: 'boundary' }, boundary: { shapeId: 'shape-1' } };
    const svg = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: pattern });
    expect(svg).not.toContain('shape-1');
    expect(svg).not.toContain('M0 0 L1 0');
    expect(svg).toContain('M5 5 L6 6');
  });

  it('a contour segment with a DIFFERENT shapeId (a hand-picked boundary, or another layer\'s own link) is NOT stripped -- match is by this exact shapeId, never any boundary ref', () => {
    const html = '<path data-layer="0" data-boundary-ref="some-other-shape" d="M0 0 L1 0"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const pattern = { shape: { source: 'generated' }, extent: { mode: 'boundary' }, boundary: { shapeId: 'shape-1' } };
    const svg = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: pattern });
    expect(svg).toContain('some-other-shape');
  });

  it('a non-generated (hand-picked) pattern never strips contour segments by boundary-ref, only OWNERSHIP_ATTR-marked pieces -- hasGeneratedSilhouette must be true', () => {
    const html = '<path data-layer="0" data-boundary-ref="shape-1" d="M0 0 L1 0"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    const pattern = { shape: { source: 'picked' }, extent: { mode: 'boundary' }, boundary: { shapeId: 'shape-1' } };
    const svg = getLayerSvg(editor, '0', 96, { excludeLatticeOwnedFor: pattern });
    expect(svg).toContain('shape-1'); // NOT a generated silhouette -- its own boundary link is a hand-picked shape, never lattice-owned content
  });

  it('the {geometry:"fusion"} path ALSO honors excludeLatticeOwnedFor (same shared _parseLayerContent filter, not a second copy)', async () => {
    const html = '<line data-layer="0" data-lattice-gen="lat1" x1="0" y1="0" x2="1" y2="0" stroke-width="0.1"/>'
      + '<path data-layer="0" d="M5 5 L6 6"/>';
    const editor = mockEditor(html, [{ id: '0', fusionGeometry: 'centerline' }]);
    const pattern = { shape: { source: 'generated' }, extent: {}, boundary: {} };
    const { svg } = await getLayerSvg(editor, '0', 96, { geometry: 'fusion', excludeLatticeOwnedFor: pattern });
    expect(svg).not.toContain('<line');
    expect(svg).toContain('M5 5 L6 6');
  });

  it('omitting the option keeps the existing default behavior byte-for-byte (no accidental always-on filtering)', () => {
    const html = '<line data-layer="0" data-lattice-gen="lat1" x1="0" y1="0" x2="1" y2="0"/>';
    const editor = mockEditor(html, [{ id: '0' }]);
    expect(getLayerSvg(editor, '0')).toContain('<line');
  });
});
