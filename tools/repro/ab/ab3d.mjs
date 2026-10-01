import { pathToFileURL } from 'node:url';
const REPO = new URL('../../../', import.meta.url).href; // repo root as a file URL
const { Window } = await import(REPO + 'node_modules/happy-dom/lib/index.js'); const __w = new Window(); for (const k of ['document','window','navigator','localStorage','DOMParser','HTMLElement','Element','Node','getComputedStyle','requestAnimationFrame','CustomEvent','Event']) { try { if (!(k in globalThis) || k==='navigator') Object.defineProperty(globalThis, k, { value: __w[k] ?? __w, configurable: true, writable: true }); } catch (e) {} }
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const ROOT = pathToFileURL(process.argv[2]).href.replace(/\/$/, ''); // tree under test (current repo or a HEAD worktree)
const H = `${ROOT}/bspline-frame-builder/b-spline-gen/html`;
const FRAME_DEFS = (await import(`${H}/data/frame-defs.js`)).default;
const { normalizeFrameRecord } = await import(`${H}/core/frame-record.js`);
const { frameSolidSpec } = await import(`${H}/editor/editor-frame-profile.js`);
const FM = await import(`${H}/core/preview/frame-mesh.js`);
const { FakeTHREE, carvedPanel } = await import(REPO + 'tests/helpers/drawn-panel.js');
const TERRAIN = (x, y) => 1.2 + 0.5 * Math.sin(1.9 * x) * Math.cos(1.4 * y) + 0.25 * Math.sin(3.1 * y + 0.4 * x);
const out = {};
for (const id of (process.argv[4] || 'template_1,template_2,template_3,template_4,template_5,template_7,template_8').split(',')) {
  for (const [W, Hh, spacing, thick] of JSON.parse(process.argv[5] || '[[7,9,0.4,0.2],[7,9,0.15,1.0],[7,9,0.05,0.2],[12,6,0.1,0.3],[9,7,0.1,0.6],[5,5,0.1,0.2]]')) {
    for (const lip of [0, 0.125]) {
      const key = `${id} ${W}x${Hh} s${spacing} t${thick} lip${lip}`;
      const { mesh, grid } = carvedPanel(W, Hh, Math.round(W / spacing) + 1, Math.round(Hh / spacing) + 1, TERRAIN, thick);
      const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id, frameBottomZ: -1, panelLip: lip }), { widthIn: W, heightIn: Hh });
      if (!spec) { out[key] = 'nospec'; continue; }
      const extra = FM.applyFrameToPanel(FakeTHREE, mesh, grid, spec);
      out[key] = {};
      for (const m of [mesh, ...extra]) {
        const g = m.geometry, h = createHash('sha256');
        for (const [k, a] of Object.entries(g.attributes || {})) { h.update(k); h.update(JSON.stringify(Array.from(a.array))); }
        if (g.index) h.update(JSON.stringify(Array.from(g.index.array)));
        out[key][m.name || 'panel'] = h.digest('hex').slice(0, 12) + ' n' + (g.index ? g.index.array.length : 0);
      }
    }
  }
}
writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
