// T86 item 4: run the full brick-frame stress matrix (every template x 7 presets x corner style
// mitre/butt x 2 sizes) and save a results table.
//
// Usage: node tools/repro/t86_item4_matrix_run.mjs <repoRoot> <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { measureCase, templatePrimitives, verdict, withCornerStyle } from './t86_item4_matrix_lib.mjs';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
mkdirSync(OUT_DIR, { recursive: true });

const appRoot = new URL(`file:///${ROOT_ARG.replace(/\\/g, '/').replace(/\/$/, '')}/bspline-frame-builder/b-spline-gen/html/`);
const { frameContourSilhouette } = await import(appRoot + 'editor/contour-from-frame.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;
const { BRICK_SETS, FRAME_PRESETS } = await import(appRoot + 'core/bricks/library.js');

const SET = BRICK_SETS[0];
const TEMPLATE_IDS = FRAME_DEFS.templates.map((t) => t.id).sort((a, b) => {
  const na = parseInt(a.split('_')[1], 10), nb = parseInt(b.split('_')[1], 10);
  return na - nb;
});
const SIZES = [[7, 9], [9, 12]];
// "the 6 FRAME_PRESETS" (T86 item 1's own dispatch) + mixed_bands (item 2) -- three_band (a
// pre-existing demo preset, not part of either dispatch) excluded, matching the advisor's own count.
const PRESET_NAMES = ['single_soldier', 'soldier_stretcher', 'double_course', 'quoin_corners', 'header_band', 'butt_frame', 'mixed_bands'];

const rows = [];
let n = 0;
for (const templateId of TEMPLATE_IDS) {
  for (const [W, H] of SIZES) {
    const { primitives, error } = templatePrimitives(FRAME_DEFS, normalizeFrameRecord, frameContourSilhouette, templateId, W, H);
    if (error) {
      rows.push({ templateId, W, H, preset: '(contour)', cornerStyle: '-', pass: false, reasons: [`CONTOUR_ERROR: ${error}`] });
      continue;
    }
    for (const presetName of PRESET_NAMES) {
      const baseBands = FRAME_PRESETS[presetName];
      for (const cornerStyle of ['native', 'butt']) {
        const bands = cornerStyle === 'native' ? baseBands : withCornerStyle(baseBands, 'butt');
        n++;
        let m;
        try {
          m = measureCase(primitives, bands, { set: SET, seed: 7 }, W, H);
        } catch (e) {
          m = { buildError: String(e && e.message || e) };
        }
        const v = verdict(m);
        rows.push({ templateId, W, H, preset: presetName, cornerStyle, pass: v.pass, reasons: v.reasons, m });
        if (n % 50 === 0) console.log(`...${n} cases run`);
      }
    }
  }
}

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length} total cases, ${failed.length} failed, ${rows.length - failed.length} passed`);

const lines = [];
lines.push(`T86 item 4 matrix -- ${rows.length} cases (${TEMPLATE_IDS.length} templates x ${SIZES.length} sizes x ${PRESET_NAMES.length} presets x 2 corner styles)`);
lines.push(`${failed.length} FAILED, ${rows.length - failed.length} passed\n`);
lines.push('FAILURES:');
for (const r of failed) {
  lines.push(`  ${r.templateId} ${r.W}x${r.H} ${r.preset}/${r.cornerStyle}: ${r.reasons.join('; ')}`);
}
lines.push('');
lines.push('ALL CASES:');
for (const r of rows) {
  const status = r.pass ? 'PASS' : 'FAIL';
  const extra = r.m && !r.m.buildError
    ? `pieces=${r.m.pieceCount} outside=${r.m.outsideCount} selfX=${r.m.notSimple} overlap=${r.m.worstOverlapArea.toFixed(4)} maxR=${r.m.maxRatio.toFixed(2)} minR=${r.m.minRatio.toFixed(2)} arcCov=${(r.m.arcCoverage * 100).toFixed(0)}%`
    : (r.m && r.m.buildError) || '';
  lines.push(`${status} ${r.templateId} ${r.W}x${r.H} ${r.preset}/${r.cornerStyle} :: ${extra}`);
}
writeFileSync(`${OUT_DIR}/t86_item4_matrix.txt`, lines.join('\n'));
console.log(`wrote ${OUT_DIR}/t86_item4_matrix.txt`);

// also dump JSON for the fix-by-class analysis pass
writeFileSync(`${OUT_DIR}/t86_item4_matrix.json`, JSON.stringify(rows.map((r) => ({ ...r, m: r.m && !r.m.buildError ? r.m : { buildError: r.m && r.m.buildError } })), null, 1));
console.log(`wrote ${OUT_DIR}/t86_item4_matrix.json`);
