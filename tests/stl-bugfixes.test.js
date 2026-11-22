/**
 * STL-RELIEF worker E bug fixes (STL-RELIEF-DESIGN.md section 13): a truncated stored mesh, an import racing a project load,
 * compressRelief's NaN, the job-timeline lock surviving a panel re-render, and the strip refreshing when STLs come and go.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { indexMesh, encodeMesh, decodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import {
  normaliseStlLayer, compressRelief, getStlErrors, _resetStlCachesForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { P, bootRestore } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  renderStlPanel, bindStlPanel, syncStlPanel, addStlFromBuffer, removeStlLayer, noteStlProjectReplaced, isStlLocked, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { setSectionReadOnly } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { initJobTimelineStrip, renderJobStrips } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';
import { setJobTimelineEnabled } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-enabled.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const tri = (a, b, c) => [...a, ...b, ...c];
function pyramidSoup() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
function binaryStl(soup) {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
const $ = (id) => document.getElementById(id);
const saved = {};
beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 20; P.heightIn = 20; delete P.stlLayers;
  _resetStlCachesForTests(); _resetStlPanelForTests();
});
afterEach(() => {
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  delete window.svgEditor;
});

describe('E1 a truncated stored mesh is reported, never silently dropped', () => {
  const full = encodeMesh(indexMesh(pyramidSoup()));
  const rec = (id, mesh) => ({ ...normaliseStlLayer({ id, mesh, unitIn: 1 }), name: id });
  const stampedIds = () => _collectStampPasses(41, 41).map((p) => p.id);
  for (const field of ['pos', 'idx']) {
    it(`every cut length of the ${field} string: no throw, nothing stamped, the error named; the intact sibling still stamps`, () => {
      const intactBytes = atob(full[field]).length;
      let checked = 0;
      for (let n = 0; n < full[field].length; n++) {
        const cut = { ...full, [field]: full[field].slice(0, n) };
        let bytes = null;
        try { bytes = atob(cut[field]).length; } catch (e) { bytes = null; } // a cut atob rejects must be reported too
        if (bytes === intactBytes) continue; // only the '=' padding was cut: still the whole mesh
        _resetStlCachesForTests();
        P.stlLayers = [rec('cut', cut), rec('ok', full)];
        let ids;
        expect(() => { ids = stampedIds(); }, `cut ${n}`).not.toThrow();
        expect(ids, `cut ${n}`).toEqual(['stl:ok']);
        expect(Object.keys(getStlErrors()), `cut ${n}`).toEqual(['cut']);
        checked++;
      }
      expect(checked).toBeGreaterThan(20);
    });
  }
  it('the message says what is wrong', () => {
    expect(() => decodeMesh({ ...full, pos: full.pos.slice(0, 20) })).toThrow(/incomplete: \d+ of \d+ position values/);
  });
  it('an index past the vertex count is refused', () => {
    expect(() => decodeMesh({ ...full, nv: 2, pos: full.pos.slice(0, 8) })).toThrow(/position values/);
    const bad = { ...full, idx: btoa(String.fromCharCode(...new Uint8Array(Uint16Array.from([0, 1, 9999, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2]).buffer))) };
    expect(() => decodeMesh(bad)).toThrow(/damaged/);
  });
  it('an intact record decodes', () => {
    expect(decodeMesh(full).indices.length).toBe(full.nt * 3);
  });
});

describe('E3 compressRelief never returns NaN', () => {
  it('a vanishing c is linear; a real c still compresses', () => {
    expect(compressRelief(0.3, 1e-17)).toBe(0.3);
    expect(compressRelief(0.3, 1e-9)).toBe(0.3);
    expect(compressRelief(0.3, 0.5)).toBeGreaterThan(0.3);
  });
});

describe('E2 an import racing a project load', () => {
  const pick = (id, fileObj) => { const inp = $(id); Object.defineProperty(inp, 'files', { value: [fileObj], configurable: true }); inp.dispatchEvent(new Event('change')); };
  const run = async (replace) => {
    document.body.innerHTML = '<div id="stlLayerBody"></div>';
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    let release; const gate = new Promise((r) => { release = r; });
    pick('stlFile', { name: 'late.stl', arrayBuffer: async () => { await gate; return binaryStl(pyramidSoup()); } });
    if (replace) noteStlProjectReplaced(); // the project load lands while the file is being read
    release();
    await new Promise((r) => setTimeout(r, 50));
  };
  it('a load landing while the file is read: nothing is added, the user is told', async () => {
    await run(true);
    expect(P.stlLayers ?? []).toHaveLength(0);
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toBe('The project changed while the STL was being read: add it again.');
  });
  it('without a load the same import adds the layer', async () => {
    await run(false);
    expect(P.stlLayers).toHaveLength(1);
  });
});

describe('E4 the job-timeline lock survives a panel re-render', () => {
  const tag = (HTML.match(/<div[^>]*id="stlLayerBody"[^>]*>/) || [''])[0];
  beforeEach(() => { document.body.innerHTML = `${tag}</div>`; renderStlPanel($('stlLayerBody')); bindStlPanel({}); });
  const controls = () => [...document.querySelectorAll('#stlLayerBody input, #stlLayerBody button')];
  it('locked: an added STL and a sync leave every control disabled; unlocked: enabled again', () => {
    expect(isStlLocked()).toBe(false);
    setSectionReadOnly('stl', true);
    expect(isStlLocked()).toBe(true);
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    syncStlPanel();
    const list = controls();
    expect(list.some((e) => e.matches('[data-stl-enable]'))).toBe(true);
    expect(list.some((e) => e.matches('[data-stl-pick]'))).toBe(true);
    expect(list.every((e) => e.disabled)).toBe(true);
    setSectionReadOnly('stl', false);
    expect(isStlLocked()).toBe(false);
    syncStlPanel();
    expect(controls().some((e) => e.disabled)).toBe(false);
  });
});

describe('E5 the strip learns when STLs are added or removed', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="previewArea" style="position:relative"></div><div id="editorCanvasContainer" style="position:relative"></div><div id="stlLayerBody"></div>';
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    setJobTimelineEnabled(true);
    window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }] };
    P.frame = { templateId: 'template_1' }; P.jobTimeline = null; bootRestore.complete = true;
  });
  it('an add and a remove each dispatch stlLayersChanged', () => {
    const seen = vi.fn(); document.addEventListener('stlLayersChanged', seen);
    const rec = addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    expect(seen).toHaveBeenCalledTimes(1);
    removeStlLayer(rec.id);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener('stlLayersChanged', seen);
  });
  it('after an add the strip has the stl chip with no other event; after the remove it is gone', () => {
    initJobTimelineStrip({ opener: vi.fn() });
    renderJobStrips();
    const chips = () => [...$('jobStrip3d').querySelectorAll('[data-job-step]')].map((c) => c.dataset.jobStep);
    expect(chips()).toContain('frame'); // the strip is really drawn
    expect(chips()).not.toContain('stl');
    const rec = addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    expect(chips()).toContain('stl');
    removeStlLayer(rec.id);
    expect(chips()).not.toContain('stl');
  });
});
