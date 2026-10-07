/**
 * Item 74i (Fred: grey + explain; seat D measured live: with "Offset from frame" ON the Size / Shape / Segments blocks are
 * already inert and dim -- F21, properties-shape-lattice.js _syncFromFrame -- a real click does nothing, but nothing said
 * why, and an inert control shows no tooltip): one declared line under the toggle while it is on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { setFrameProfileProvider } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { initShapeLatticeProperties, SHAPE_FOLLOWS_FRAME_NOTE } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape-lattice.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const generated = (on) => ({ shape: { source: 'generated', preset: 'hourglass' }, extent: { mode: 'boundary' },
  contour: { fromFrame: { on, distance: 0, distanceRef: 'outer', userSet: true } } });
const editorWith = (pattern) => ({ _mW: 7, _mH: 9, _layers: [{ id: '0', name: 'Layer 1', visible: true, pattern }], _activeLayer: '0' });
const note = () => document.getElementById('shapeLatticeFollowsFrameNote');
const shown = (n) => n.style.display !== 'none';

afterEach(() => setFrameProfileProvider(null));

describe('item 74i: the "follows the frame" line', () => {
  it('the words are declared; the line sits right under the Offset-from-frame toggle', () => {
    expect(SHAPE_FOLLOWS_FRAME_NOTE).toBe('The shape follows the frame while Offset from frame is on');
    const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
    const toggle = doc.getElementById('shapeLatticeContourFromFrame'), line = doc.getElementById('shapeLatticeFollowsFrameNote');
    expect(line).not.toBeNull();
    expect(!!(toggle.compareDocumentPosition(line) & 4)).toBe(true); // after the toggle
    expect(!!(line.compareDocumentPosition(doc.getElementById('shapeLatticeShapeBlock')) & 4)).toBe(true); // before the blocks
  });
  it.each([[true, true], [false, false]])('offset %s: the line shown %s, the Shape block inert %s too', (on, want) => {
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }) }));
    document.body.innerHTML = BODY;
    initShapeLatticeProperties(editorWith(generated(on)));
    expect(note().textContent).toBe(SHAPE_FOLLOWS_FRAME_NOTE);
    expect(shown(note())).toBe(want);
    expect(!!document.getElementById('shapeLatticeShapeBlock').inert).toBe(want); // the F21 grey it explains
  });
});
