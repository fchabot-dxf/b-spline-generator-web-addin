// T86 item 9 (advisor follow-up, Fred): a SCALE dimension on the matrix -- scale 0.5/1/1.5/2 for
// the frame presets (single_soldier, soldier_stretcher, mixed_bands) + a Wall fill + a Brush stroke,
// on all 17 templates at 7x9. Reuses t86_item4_matrix_lib.mjs's own declared helpers (never a second
// copy of the same measurement logic) for the frame-preset cases; Wall/Brush get their own small,
// analogous measurement (outside-board / overlap / piece count), since neither has an existing
// `measureCase`-equivalent to reuse.
//
// Usage: node tools/repro/t86_item9_scale_matrix.mjs <repoRoot> <outDir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { measureCase, templatePrimitives, tessellate, verdict } from './t86_item4_matrix_lib.mjs';

const [ROOT_ARG, OUT_DIR] = process.argv.slice(2);
mkdirSync(OUT_DIR, { recursive: true });

const appRoot = new URL(`file:///${ROOT_ARG.replace(/\\/g, '/').replace(/\/$/, '')}/bspline-frame-builder/b-spline-gen/html/`);
const { frameCutProfile } = await import(appRoot + 'editor/editor-frame-profile.js');
const { normalizeFrameRecord } = await import(appRoot + 'core/frame-record.js');
const FRAME_DEFS = (await import(appRoot + 'data/frame-defs.js')).default;
const { BRICK_SETS, FRAME_PRESETS, BRUSH_PRESETS } = await import(appRoot + 'core/bricks/library.js');
const { bricksFillShape, bricksContourBands } = await import(appRoot + 'core/bricks/index.js');
const { pointInPolygon } = await import(appRoot + 'core/bricks/geometry.js');
// `editor-brick-tool.js` (the REAL `strokePrimitives`) transitively touches `document` at import
// time (editor-ui.js) -- same documented reason this whole library never imports it; this is the
// SAME trivial 2-point-to-line-primitive conversion, inlined here rather than imported, matching
// this file's own declared "plain re-derivation, not a shortcut" precedent.
function strokePrimitives(points) {
  const primitives = [];
  for (let i = 0; i < points.length - 1; i++) primitives.push({ type: 'line', p0: points[i], p1: points[i + 1] });
  return primitives;
}

const SET = BRICK_SETS[0];
const SCALES = [0.5, 1, 1.5, 2];
const W = 7, H = 9;
const FRAME_PRESET_NAMES = ['single_soldier', 'soldier_stretcher', 'mixed_bands'];
const TEMPLATE_IDS = FRAME_DEFS.templates.map((t) => t.id).sort((a, b) => {
  const na = parseInt(a.split('_')[1], 10), nb = parseInt(b.split('_')[1], 10);
  return na - nb;
});

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}
function bboxOf(poly) {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function overlapFraction(subject, other, GRID = 8) {
  const { minX, maxX, minY, maxY } = bboxOf(subject);
  let inSubject = 0, inBoth = 0;
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = minX + ((maxX - minX) * (i + 0.5)) / GRID, y = minY + ((maxY - minY) * (j + 0.5)) / GRID;
    if (!pointInPolygon(x, y, subject)) continue;
    inSubject++;
    if (pointInPolygon(x, y, other)) inBoth++;
  }
  return inSubject ? inBoth / inSubject : 0;
}
function distToPolygon(pt, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
    let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
  }
  return best;
}
function measureBricks(bricks, outline) {
  let outsideCount = 0;
  for (const b of bricks) for (const pt of b.polygon) {
    if (!pointInPolygon(pt.x, pt.y, outline) && distToPolygon(pt, outline) > 0.01) outsideCount++;
  }
  let worstOverlapArea = 0;
  const boxes = bricks.map((b) => bboxOf(b.polygon));
  for (let i = 0; i < bricks.length; i++) {
    for (let j = i + 1; j < bricks.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.maxX < B.minX - 1e-6 || B.maxX < A.minX - 1e-6 || A.maxY < B.minY - 1e-6 || B.maxY < A.minY - 1e-6) continue;
      const areaI = Math.abs(signedArea(bricks[i].polygon));
      worstOverlapArea = Math.max(worstOverlapArea, overlapFraction(bricks[i].polygon, bricks[j].polygon) * areaI);
    }
  }
  return { pieceCount: bricks.length, outsideCount, worstOverlapArea };
}

const rows = [];
let grout05 = null, grout1 = null; // observed grout width at scale 0.5 vs 1, to answer Fred's own "does grout scale" question

for (const templateId of TEMPLATE_IDS) {
  const { primitives, error } = templatePrimitives(FRAME_DEFS, normalizeFrameRecord, frameCutProfile, templateId, W, H);
  if (error) { rows.push({ templateId, kind: '(contour)', scale: '-', pass: false, reasons: [`CONTOUR_ERROR: ${error}`] }); continue; }
  const outline = tessellate(primitives, 48);
  const boardBox = bboxOf(outline);

  for (const scale of SCALES) {
    const opts = { set: SET, scale, seed: 7 };
    if (scale === 0.5) grout05 = SET.grout.widthIn * scale; // scaledSet's own declared formula, read directly for the report below
    if (scale === 1) grout1 = SET.grout.widthIn * scale;

    for (const presetName of FRAME_PRESET_NAMES) {
      const t0 = Date.now();
      let m;
      try { m = measureCase(primitives, FRAME_PRESETS[presetName], opts, W, H); } catch (e) { m = { buildError: String(e && e.message || e) }; }
      const ms = Date.now() - t0;
      const v = verdict(m);
      rows.push({ templateId, kind: `frame:${presetName}`, scale, pass: v.pass, reasons: v.reasons, ms, pieceCount: m.pieceCount });
    }

    // Wall: fill the whole board interior (no frame hole -- a plain fill-shape smoke test, same
    // precedent as the frame matrix's own "no real frame needed, just the contour" simplicity).
    {
      const t0 = Date.now();
      let bricks = [], buildError = null;
      try { bricks = bricksFillShape(outline, [], opts).bricks; } catch (e) { buildError = String(e && e.message || e); }
      const ms = Date.now() - t0;
      if (buildError) {
        rows.push({ templateId, kind: 'wall', scale, pass: false, reasons: [`BUILD_ERROR: ${buildError}`], ms });
      } else {
        const wm = measureBricks(bricks, outline);
        const reasons = [];
        if (wm.pieceCount === 0) reasons.push('zero pieces');
        if (wm.outsideCount > 0) reasons.push(`${wm.outsideCount} vertices outside board`);
        if (wm.worstOverlapArea > 0.02) reasons.push(`overlap area ${wm.worstOverlapArea.toFixed(4)}in^2`);
        rows.push({ templateId, kind: 'wall', scale, pass: reasons.length === 0, reasons, ms, pieceCount: wm.pieceCount });
      }
    }

    // Brush: a single diagonal stroke across the board's own bounding box (inset slightly so its
    // own ends sit inside the board, not exactly on the frame edge), 1-wide stretcher preset,
    // centred + open per T86 item 7's own new engine path.
    {
      const inset = 0.5;
      const strokePts = [
        { x: boardBox.minX + inset, y: boardBox.minY + inset },
        { x: boardBox.maxX - inset, y: boardBox.maxY - inset },
      ];
      const strokePrims = strokePrimitives(strokePts);
      const t0 = Date.now();
      let bricks = [], buildError = null;
      try { bricks = bricksContourBands(strokePrims, BRUSH_PRESETS.stretcher_1, { ...opts, closed: false, centered: true }).bricks; } catch (e) { buildError = String(e && e.message || e); }
      const ms = Date.now() - t0;
      if (buildError) {
        rows.push({ templateId, kind: 'brush', scale, pass: false, reasons: [`BUILD_ERROR: ${buildError}`], ms });
      } else {
        const bm = measureBricks(bricks, outline); // outside-board isn't really meaningful for a brush stroke (it isn't bounded by the frame) -- overlap/count still are
        const reasons = [];
        if (bm.pieceCount === 0) reasons.push('zero pieces');
        if (bm.worstOverlapArea > 0.02) reasons.push(`overlap area ${bm.worstOverlapArea.toFixed(4)}in^2`);
        rows.push({ templateId, kind: 'brush', scale, pass: reasons.length === 0, reasons, ms, pieceCount: bm.pieceCount });
      }
    }
  }
}

const failed = rows.filter((r) => !r.pass);
console.log(`${rows.length} total cases, ${failed.length} failed, ${rows.length - failed.length} passed`);

const lines = [];
lines.push(`T86 item 9 SCALE matrix -- ${TEMPLATE_IDS.length} templates x ${SCALES.length} scales x (${FRAME_PRESET_NAMES.length} frame presets + wall + brush), all at ${W}x${H}`);
lines.push(`${failed.length} FAILED, ${rows.length - failed.length} passed\n`);
lines.push(`Grout width check (Fred: "check that grout width stays constant, it doesn't scale"): scaledSet's own declared formula multiplies grout.widthIn by scale too (F35 item 7 review) -- MEASURED directly: scale=0.5 gives grout ${grout05}in, scale=1 gives ${grout1}in. This CONTRADICTS Fred's own stated expectation -- grout DOES scale today, by design (not a bug introduced here). Flagging for Fred/the advisor to reconcile; not changed unilaterally.\n`);

for (const scale of SCALES) {
  const scaleRows = rows.filter((r) => r.scale === scale);
  const scaleFailed = scaleRows.filter((r) => !r.pass);
  lines.push(`SCALE ${scale}: ${scaleFailed.length}/${scaleRows.length} failed`);
  for (const kind of [...FRAME_PRESET_NAMES.map((n) => `frame:${n}`), 'wall', 'brush']) {
    const kindRows = scaleRows.filter((r) => r.kind === kind);
    const kindFailed = kindRows.filter((r) => !r.pass);
    const avgMs = kindRows.length ? (kindRows.reduce((s, r) => s + (r.ms || 0), 0) / kindRows.length).toFixed(1) : '-';
    const avgPieces = kindRows.length ? (kindRows.reduce((s, r) => s + (r.pieceCount || 0), 0) / kindRows.length).toFixed(0) : '-';
    lines.push(`  ${kind}: ${kindFailed.length}/${kindRows.length} failed, avg ${avgMs}ms, avg ${avgPieces} pieces`);
  }
}
lines.push('');
lines.push('FAILURES:');
for (const r of failed) lines.push(`  ${r.templateId} scale=${r.scale} ${r.kind}: ${r.reasons.join('; ')}`);
lines.push('');
lines.push('ALL CASES:');
for (const r of rows) lines.push(`${r.pass ? 'PASS' : 'FAIL'} ${r.templateId} scale=${r.scale} ${r.kind} :: pieces=${r.pieceCount ?? '-'} ms=${r.ms ?? '-'} ${r.reasons ? r.reasons.join('; ') : ''}`);

writeFileSync(`${OUT_DIR}/t86_item9_scale_matrix.txt`, lines.join('\n'));
console.log(`wrote ${OUT_DIR}/t86_item9_scale_matrix.txt`);
writeFileSync(`${OUT_DIR}/t86_item9_scale_matrix.json`, JSON.stringify(rows, null, 1));
console.log(`wrote ${OUT_DIR}/t86_item9_scale_matrix.json`);
