// T84 item 10, part 3: RANDOM GENERATE. 50 seeds per template at 7x9, each seed resolved through
// generateValidFrameSeeds -- the SAME function (and the SAME isValid predicate) frame-gen.test.js
// already proves matches a real [Generate] click (inner profile clean + every outer piece >=
// frame_thickness, the "no wing" rule). Seeds 0..49 per template (deterministic, reproducible --
// not Math.random(), so a failure here is a re-runnable repro, not a one-off).
//
// Usage: node tools/repro/t84_item10_part3_random_generate_payloads.mjs <repoRoot> <outDir>
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile, frameInnerProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry, generateValidFrameSeeds } = await imp('editor/frame-handles.js');
const { paramsFromShapeModel } = await imp('editor/editor-shape-lattice-generator.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const { P } = await imp('core/state.js');

const W = 7, H = 9;
P.widthIn = W; P.heightIn = H;
mkdirSync(OUT_DIR, { recursive: true });
const N_SEEDS = 50;
const manifest = [];

for (const T of FRAME_DEFS.templates) {
  const templateId = T.id;
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const isValid = (s) => {
    const inner = frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId, seeds: s }), { widthIn: W, heightIn: H });
    if (inner && inner.defects.length > 0) return false;
    const outer = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId, seeds: s }), { widthIn: W, heightIn: H });
    if (outer.defects.length > 0) return false;
    return outer.primitives.every((p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : Math.abs(p.rx * p.dTheta)) >= t);
  };

  for (let genSeed = 0; genSeed < N_SEEDS; genSeed++) {
    const seeds = generateValidFrameSeeds(T, region, genSeed, t, isValid);
    const rec = normalizeFrameRecord({ templateId, seeds });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
    const seedGeometry = frameSeedGeometry(T, prof, W, H);
    const name = `${templateId}_gen${genSeed}_${W}x${H}`;
    const payload = {
      recordVersion: 1, templateId,
      params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
      seeds, frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
      seedGeometry, widthIn: W, heightIn: H,
    };
    writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(payload, null, 2));
    manifest.push({ templateId, genSeed, case: name, defects: prof.defects });
    if (prof.defects.length) console.log('WARN JS defects', name, JSON.stringify(prof.defects));
  }
}

writeFileSync(`${OUT_DIR}/manifest_part3.json`, JSON.stringify(manifest, null, 2));
console.log('wrote', manifest.length, 'random-generate payloads to', OUT_DIR);
console.log('cases with JS-side defects:', manifest.filter((m) => m.defects.length).length);
