import { pathToFileURL } from 'node:url';
const REPO = new URL('../../../', import.meta.url).href; // repo root as a file URL
const { Window } = await import(REPO + 'node_modules/happy-dom/lib/index.js'); const __w = new Window(); for (const k of ['document','window','navigator','localStorage','DOMParser','HTMLElement','Element','Node','getComputedStyle','requestAnimationFrame','CustomEvent','Event']) { try { if (!(k in globalThis) || k==='navigator') Object.defineProperty(globalThis, k, { value: __w[k] ?? __w, configurable: true, writable: true }); } catch (e) {} }
import { createHash } from 'node:crypto';
const ROOT = pathToFileURL(process.argv[2]).href.replace(/\/$/, ''); // tree under test (current repo or a HEAD worktree)
const H = `${ROOT}/bspline-frame-builder/b-spline-gen/html`;
const FRAME_DEFS = (await import(`${H}/data/frame-defs.js`)).default;
const { normalizeFrameRecord } = await import(`${H}/core/frame-record.js`);
const C = await import(`${H}/editor/contour-from-frame.js`);
const G = await import(`${H}/editor/editor-shape-lattice-generator.js`);
const B = await import(`${H}/editor/editor-lattice-boundary.js`);
const LP = await import(`${H}/editor/editor-lattice-pattern.js`);
const out = []; let n = 0;
const run = (prims) => {
  for (let seed = 1; seed <= 6; seed++) for (const orientation of ['horizontal', 'vertical'])
    for (const rails of [LP.PATTERN_DEFAULTS.rails, { ...LP.PATTERN_DEFAULTS.rails, spacing: 0.5 }, { mode: 'count', count: [9, 11] }])
      for (const endRule of ['on-boundary', 'inset']) {
        const PATTERN = { ...LP.PATTERN_DEFAULTS, seed, orientation, rails, boundary: { ...LP.PATTERN_DEFAULTS.boundary, endRule }, extent: { mode: 'boundary' } };
        out.push(JSON.stringify(LP.computePattern(PATTERN, { extent: LP._resolveExtent(null, PATTERN, prims) }))); n++;
      }
};
const parsed = (ps) => B.insetGeneratedPresetPathDToPrimitives(G.joinSegmentPathsIntoClosedD(ps.map((p) => G.primitiveToPathD(p))), 0);
for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5'])
  for (const [W, Hh] of [[7, 9], [12, 6], [9, 12], [8, 8]])
    for (const d of [0, 0.25, 0.6]) {
      const sil = C.frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: W, heightIn: Hh } }, d, 0.25);
      if (sil.error) { out.push(sil.error); continue; }
      run(parsed(sil.primitives));
    }
let s = 3; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = 0; i < 60; i++) {
  const preset = i % 3 ? 'hourglass' : 'bottle';
  const region = { x: 0.5, y: 0.5, w: 3 + rnd() * 8, h: 3 + rnd() * 8 };
  const sil = G.generateContourSilhouette(region, { preset, params: {}, seed: i }, 0.25);
  const prims = parsed(sil.primitives);
  run(prims);
  for (let k = 0; k < 40; k++) { const y = region.y + rnd() * region.h, x = region.x + rnd() * region.w;
    out.push(JSON.stringify([B.insideSpans({ point: { x: 0, y }, dir: { x: 1, y: 0 } }, prims), B.insideSpans({ point: { x, y: 0 }, dir: { x: 0, y: 1 } }, prims)])); }
}
if (process.argv[3]) (await import("node:fs")).writeFileSync(process.argv[3], out.join("\n"));
console.log(createHash('sha256').update(out.join('\n')).digest('hex'), out.length, n);
