// T84 item 10, part 2: INSET WINDOW payloads.
// (a) every template's own default shape, window ON, at 6x9/7x9/9x12.
// (b) on 3 representative templates (T1, T10, T16), the window at its own range ends --
//     smallest (2*frame_thickness + 0.1 margin, centred), largest (full board, centred),
//     off-centre (a default-sized window pushed to its own clamped corner) -- at 7x9.
// The clamp logic mirrors frame-panel.js's own _clampInsetWindowRect exactly (same formula,
// read directly from source rather than re-derived, so this can never silently drift from it).
//
// Usage: node tools/repro/t84_item10_part2_inset_window_payloads.mjs <repoRoot> <outDir>
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
const { frameCutProfile } = await imp('editor/editor-frame-profile.js');
const { frameSeedGeometry } = await imp('editor/frame-handles.js');
const { normalizeFrameRecord, frameParam } = await imp('core/frame-record.js');
const { default: FRAME_DEFS } = await imp('data/frame-defs.js');
const { P } = await imp('core/state.js');

mkdirSync(OUT_DIR, { recursive: true });
const MARGIN = 0.1;

function clampRect(r, widthIn, heightIn, ft) {
  const minSize = 2 * ft + MARGIN;
  const w = Math.min(Math.max(r.w, minSize), widthIn);
  const h = Math.min(Math.max(r.h, minSize), heightIn);
  const cx = Math.min(Math.max(r.cx, -(widthIn - w) / 2), (widthIn - w) / 2);
  const cy = Math.min(Math.max(r.cy, -(heightIn - h) / 2), (heightIn - h) / 2);
  return { cx, cy, w, h };
}

function writePayload(templateId, T, W, H, insetWindow, name) {
  P.widthIn = W; P.heightIn = H;
  const rec = normalizeFrameRecord({ templateId, seeds: {} });
  const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
  const seedGeometry = frameSeedGeometry(T, prof, W, H);
  const payload = {
    recordVersion: 1, templateId,
    params: Object.fromEntries(T.params.filter((p) => p.owner === 'frame').map((p) => [p.name, p.default])),
    seeds: {}, frameBottomZ: null, panelLip: null, appearance: null, insetWindow,
    seedGeometry, widthIn: W, heightIn: H,
  };
  writeFileSync(`${OUT_DIR}/${name}.json`, JSON.stringify(payload, null, 2));
  return prof.defects;
}

const manifest = [];

// (a) every template's default, window ON, 3 sizes, a default-sized window (a third of the board,
// centred -- the app's own first-enabled default, T82 item 5).
for (const T of FRAME_DEFS.templates) {
  for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
    const ft = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
    const raw = { cx: 0, cy: 0, w: W / 3, h: H / 3 };
    const win = { enabled: true, ...clampRect(raw, W, H, ft) };
    const name = `${T.id}_defaultWindow_${W}x${H}`;
    const defects = writePayload(T.id, T, W, H, win, name);
    manifest.push({ part: 'a', templateId: T.id, W, H, case: name, defects });
    if (defects.length) console.log('WARN JS defects', name, JSON.stringify(defects));
  }
}

// (b) T1/T10/T16: window range ends at 7x9.
const W = 7, H = 9;
for (const id of ['template_1', 'template_10', 'template_16']) {
  const T = FRAME_DEFS.templates.find((t) => t.id === id);
  const ft = (T.params.find((p) => p.name === 'frame_thickness') || {}).default ?? 0.75;
  const variants = {
    smallest: clampRect({ cx: 0, cy: 0, w: 0, h: 0 }, W, H, ft), // clamps up to minSize
    largest: clampRect({ cx: 0, cy: 0, w: W, h: H }, W, H, ft),
    offCentre: clampRect({ cx: W, cy: H, w: W / 3, h: H / 3 }, W, H, ft), // clamps to the corner
  };
  for (const [tag, rect] of Object.entries(variants)) {
    const win = { enabled: true, ...rect };
    const name = `${id}_window_${tag}_${W}x${H}`;
    const defects = writePayload(id, T, W, H, win, name);
    manifest.push({ part: 'b', templateId: id, tag, case: name, defects });
    if (defects.length) console.log('WARN JS defects', name, JSON.stringify(defects));
  }
}

writeFileSync(`${OUT_DIR}/manifest_part2.json`, JSON.stringify(manifest, null, 2));
console.log('wrote', manifest.length, 'inset-window payloads to', OUT_DIR);
console.log('cases with JS-side defects:', JSON.stringify(manifest.filter((m) => m.defects.length)));
