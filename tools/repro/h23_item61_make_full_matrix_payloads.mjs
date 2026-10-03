// H23 item 61 (1) / item 64: the PERMANENT every-template x every-declared-handle x
// {min, default, max} payload generator, promoted from item 60(C)'s own one-off probe. Generic
// across all 13 templates: reads T.handles dynamically, resolves a real `resolved` object via
// paramsFromShapeModel first (the item-60 fix -- frameParamRanges silently returns NaN/null
// without it), then writes one payload per template (the shared default) plus one payload per
// handle per range end (min/max) with every OTHER handle held at ITS OWN template default.
//
// H23 item 64: a handle's own DECLARED range end (frameParamRanges) is not necessarily where a
// real drag ever stops -- Fred's own guards (the no-hook rule, item 39; the undercut rule, item
// 63(a)) pull the drag-stop back BEFORE the declared end whenever the declared end itself would
// already break one of them. Tests the REACHABLE end instead: the same shared predicate the
// live drag-stop uses (`_frameRecordBreaksNoHookRule`, frame-panel.js, exported for this reuse --
// not copied), bisected from the template's own known-safe default toward the declared end the
// same way `_clampDragPatchToNoHookRule` bisects a drag. Records BOTH ends per case.
//
// T84 item 10 (1): board size is now a CLI arg (default 7x9, unchanged) -- "SIZES" asks for the
// SAME matrix at 6x9 and 9x12 too, and hand-patching this file per size (the item 9 gap-fraction
// probe's own throwaway pattern) doesn't scale to three permanent runs.
// Usage: node tools/repro/h23_item61_make_full_matrix_payloads.mjs <repoRoot> <outDir> [widthIn] [heightIn]
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// frame-panel.js's own module graph pulls in editor-ui.js, which touches `document` at module
// scope -- harmless in the browser, fatal in plain Node. A bare jsdom document/window (no DOM
// elements touched by anything this script actually calls) is enough for the import to resolve.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const [ROOT_ARG, OUT_DIR, W_ARG, H_ARG] = process.argv.slice(2);
const ROOT = pathToFileURL(ROOT_ARG).href.replace(/\/$/, '');
const root = `${ROOT}/bspline-frame-builder/b-spline-gen/html/`;
const imp = (p) => import(root + p);
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry, frameParamRanges } = await imp('editor/frame-handles.js');
const { paramsFromShapeModel } = await imp('editor/editor-shape-lattice-generator.js');
const { normalizeFrameRecord } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const { P } = await imp('core/state.js');
const { _frameRecordBreaksNoHookRule } = await imp('main/frame-panel.js');

mkdirSync(OUT_DIR, { recursive: true });
const W = W_ARG ? Number(W_ARG) : 7, H = H_ARG ? Number(H_ARG) : 9;
P.widthIn = W; P.heightIn = H;
const manifest = [];

/** H23 item 64: the REACHABLE value of handle `key` between the known-safe `safeVal` (the
 *  template's own default) and the declared `end` -- `end` itself if the drag-stop guard never
 *  objects to it, else bisected back (24 halvings, the same count `_clampDragPatchToNoHookRule`
 *  uses) to where it stops objecting. Assumes monotonic badness between the two, the same
 *  assumption the live drag-stop's own bisection makes. */
function reachableEnd(templateId, key, safeVal, end) {
  const isBad = (val) => _frameRecordBreaksNoHookRule(normalizeFrameRecord({ templateId, seeds: { [key]: val } }));
  if (!isBad(end)) return end;
  let lo = safeVal, hi = end;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isBad(mid)) hi = mid; else lo = mid;
  }
  return lo;
}

function writePayload(templateId, T, seeds, name) {
  const rec = normalizeFrameRecord({ templateId, seeds });
  const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
  const seedGeometry = frameSeedGeometry(T, prof, W, H);
  const payload = {
    recordVersion: 1, templateId,
    params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
    seeds, frameBottomZ: null, panelLip: null, appearance: null, insetWindow: null,
    seedGeometry, widthIn: W, heightIn: H,
  };
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(payload, null, 2));
  return { name, defects: prof.defects };
}

for (const T of FRAME_DEFS.templates) {
  const templateId = T.id;
  const baseRec = normalizeFrameRecord({ templateId, seeds: {} });
  const region = frameCutProfile(FRAME_DEFS, baseRec, { widthIn: W, heightIn: H }).region;
  const t = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const resolved = paramsFromShapeModel(T.silhouettePreset, T.shapeModel, region);
  const ranges = frameParamRanges(T, region, resolved, t);

  const info = writePayload(templateId, T, {}, `${templateId}_default_${W}x${H}`);
  manifest.push({ templateId, handle: null, tag: 'default', case: info.name, defects: info.defects });
  if (info.defects.length) console.log('WARN default already has JS defects:', templateId, JSON.stringify(info.defects));

  for (const h of T.handles) {
    const range = ranges[h.key];
    if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
      console.log('SKIP (no finite range)', templateId, h.key, JSON.stringify(range));
      continue;
    }
    const safeVal = resolved[h.key] ?? (range.min + range.max) / 2;
    for (const [tag, declaredEnd] of [['min', range.min], ['max', range.max]]) {
      const val = reachableEnd(templateId, h.key, safeVal, declaredEnd);
      const pulledBack = Math.abs(val - declaredEnd) > 1e-9;
      const name = `${templateId}_${h.key}_${tag}_${W}x${H}`;
      const r = writePayload(templateId, T, { [h.key]: val }, name);
      manifest.push({
        templateId, handle: h.key, tag, case: r.name, defects: r.defects,
        declaredEnd, reachableEnd: val, pulledBack,
      });
      if (pulledBack) console.log('PULLED BACK', templateId, h.key, tag, declaredEnd, '->', val);
    }
  }
}

writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('wrote', manifest.length, 'payloads to', OUT_DIR);
console.log('cases with JS-side defects:', JSON.stringify(manifest.filter((m) => m.defects.length)));
console.log('cases pulled back from their declared end:', manifest.filter((m) => m.pulledBack).length);
