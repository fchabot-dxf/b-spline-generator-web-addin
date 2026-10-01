import { pathToFileURL } from 'node:url';
const REPO = new URL('../../../', import.meta.url).href; // repo root as a file URL
const { Window } = await import(REPO + 'node_modules/happy-dom/lib/index.js'); const __w = new Window(); for (const k of ['document','window','navigator','localStorage','DOMParser','HTMLElement','Element','Node','getComputedStyle','requestAnimationFrame','CustomEvent','Event']) { try { if (!(k in globalThis) || k==='navigator') Object.defineProperty(globalThis, k, { value: __w[k] ?? __w, configurable: true, writable: true }); } catch (e) {} }
import { createHash } from 'node:crypto';
const ROOT = pathToFileURL(process.argv[2]).href.replace(/\/$/, ''); // tree under test (current repo or a HEAD worktree)
const H = `${ROOT}/bspline-frame-builder/b-spline-gen/html`;
const FRAME_DEFS = (await import(`${H}/data/frame-defs.js`)).default;
const { normalizeFrameRecord } = await import(`${H}/core/frame-record.js`);
const { frameCutProfile, frameInnerProfile, frameMiters, frameSolidSpec } = await import(`${H}/editor/editor-frame-profile.js`);
const FM = await import(`${H}/core/preview/frame-mesh.js`);
const { FakeTHREE, carvedPanel } = await import(REPO + 'tests/helpers/drawn-panel.js');
const { frameHandles, frameSeedGeometry, generateFrameSeeds, handleDragPatch } = await import(`${H}/editor/frame-handles.js`);
const G = await import(`${H}/editor/editor-shape-lattice-generator.js`);
const I = await import(`${H}/editor/editor-shape-lattice-interaction.js`);
const M = await import(`${H}/editor/editor-sketch-manifest.js`);
const C = await import(`${H}/editor/contour-from-frame.js`);
const out = [];
const strip = (x) => JSON.stringify(x, (k, v) => (typeof v === 'function' ? undefined : (k === 'table' ? undefined : v)));
let s = 5; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 400; i++) {
  const params = {};
  for (const k of ['waistReach', 'cornerRadius', 'waistCenterY', 'waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom']) if (rnd() < 0.6) params[k] = k === 'waistCenterY' ? rnd() - 0.5 : rnd();
  const region = { x: rnd(), y: rnd(), w: 2 + rnd() * 10, h: 2 + rnd() * 10 }, stroke = rnd() < 0.5 ? 0 : 0.1;
  const sil = G.generateSilhouette(region, { preset: 'hourglass', params, seed: i }, stroke);
  const r = G.feasibleParamRanges('hourglass', region, sil.params, stroke);
  delete r.topDipWidth; delete r.topDipDepth; delete r.topPeak; delete r.shoulderLedgeWidth; delete r.hipFlare; // T7: new frame-only range keys, same as T5's own two
  const hs = I.computeParamHandles('hourglass', region, sil.params);
  const pt = { x: region.x + rnd() * region.w, y: region.y + rnd() * region.h };
  out.push(strip([sil, r, G.outlineDefects(sil.primitives), G.generateContourSilhouette(region, { preset: 'hourglass', params, seed: i }, 0.1),
    hs, hs.map((h) => h.patchFromWorld(pt, { side: i % 2 })), M.manifestFromShape({ preset: 'hourglass', params }, region)]));
}
for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_7', 'template_8']) {
  const tpl = FRAME_DEFS.templates.find((t) => t.id === id);
  for (const [W, Hh] of [[7, 9], [12, 6], [9, 12], [5.51, 1.97], [8, 8]]) {
    const rec = normalizeFrameRecord({ templateId: id });
    const p = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: Hh });
    const hs = frameHandles(tpl, p);
    const gens = [1, 2, 3, 4, 5].map((sd) => generateFrameSeeds(tpl, p.region, sd));
    const drags = hs.map((h) => handleDragPatch(rec, h, { x: h.anchor.x - 0.2, y: h.anchor.y + 0.15 }, p.region, { side: 1 }));
    const cs = [0.1, 0.25, -0.2].map((d) => C.frameContourSilhouette({ defs: FRAME_DEFS, record: rec, board: { widthIn: W, heightIn: Hh } }, d, 0.1));
    const mans = cs.map((c) => (c.error ? c.error : M.manifestFromShape({ preset: 'hourglass', params: {} }, p.region, { silhouette: c })));
    const genProfs = gens.map((sd) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds: sd }), { widthIn: W, heightIn: Hh }));
    const inn = frameInnerProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: Hh });
    const mit = inn ? frameMiters(p.primitives, inn.primitives) : null;
    const hover = hs.map((h) => I.controlledSegments(tpl.silhouettePreset, h.key, p.primitives.length));
    const thick = [0.25, 0.5, 1.0, 1.5].map((t) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, params: { frame_thickness: t } }), { widthIn: W, heightIn: Hh }));
    out.push(strip([p, inn, mit, hover, thick, hs, gens, drags, frameSeedGeometry(tpl, p, W, Hh), cs, mans, genProfs]));
  }
}
const TERRAIN = (x, y) => 1.2 + 0.5 * Math.sin(1.9 * x) * Math.cos(1.4 * y) + 0.25 * Math.sin(3.1 * y + 0.4 * x);
const h3 = createHash('sha256');
let n3 = 0;
for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_7', 'template_8']) {
  for (const [W, Hh, spacing, thick] of [[7, 9, 0.4, 0.2], [7, 9, 0.15, 1.0], [7, 9, 0.05, 0.2], [12, 6, 0.1, 0.3], [9, 7, 0.1, 0.6], [5, 5, 0.1, 0.2]]) {
    for (const lip of [0, 0.125]) {
      const { mesh, grid } = carvedPanel(W, Hh, Math.round(W / spacing) + 1, Math.round(Hh / spacing) + 1, TERRAIN, thick);
      const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: id, frameBottomZ: -1, panelLip: lip }), { widthIn: W, heightIn: Hh });
      if (!spec) { h3.update('nospec'); continue; }
      const extra = FM.applyFrameToPanel(FakeTHREE, mesh, grid, spec);
      for (const m of [mesh, ...extra]) {
        const g = m.geometry;
        h3.update(m.name || 'panel');
        for (const [k, a] of Object.entries(g.attributes || {})) { h3.update(k); h3.update(Buffer.from(new Float64Array(Array.from(a.array)).buffer)); }
        if (g.index) h3.update(Buffer.from(new Float64Array(Array.from(g.index.array)).buffer));
      }
      n3++;
    }
  }
}
console.log('3D', h3.digest('hex'), n3);
console.log(createHash('sha256').update(out.join('\n')).digest('hex'), out.length);
