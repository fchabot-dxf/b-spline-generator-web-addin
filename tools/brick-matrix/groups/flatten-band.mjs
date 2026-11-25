// Brick matrix group 'flatten-band': Surface > FLATTEN BAND (Fred 2026-11-25, core/flatten-band.js) in the real app.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).
//   1. band on, Applies to Both, Flat height FLATTEN_BAND.heightIn, on the Hourglass (template_1): every terrain point in the
//      flat (|signed distance to the frame outline| <= width / 2, the app's own outline + field) reads the Flat height
//      within FLATTEN_BAND.tolIn -- read on the terrain stage (lastResult.baseHeights: before stamps / bricks / sculpt,
//      which the band never flattens) -- and the 3D heights changed;
//   2. band off again: the final heights are bit-identical to the board's before the band (a full digest of the bytes).
export const FLATTEN_BAND = {
  template: 'template_1', heightIn: 0.3, tolIn: 1e-4, // the heights are Float32: 0.3 in reads 0.30000001
  introducedBy: 'bc0a82b7',
};
export const rows = [];

let js, jsJSON, click, setValue, sleep, exists, heightsSettled, editorOpen, apply, checkRow;
export function bind(ctx) { ({ js, jsJSON, click, setValue, sleep, exists, heightsSettled, editorOpen, apply, checkRow } = ctx); }
export async function run() { await runFlattenBand(); }

// every byte of the final heights + the terrain stage (FNV-1a), and the grid
const DIGEST = `(async()=>{ const m=await import('./core/state.js'); const r=m.lastResult; if(!r||!r.heights) return JSON.stringify(null);
  const f=(a)=>{ const u=new Uint8Array(a.buffer,a.byteOffset,a.byteLength); let h=0x811c9dc5; for(let i=0;i<u.length;i++){ h^=u[i]; h=Math.imul(h,0x01000193)>>>0; } return h.toString(16); };
  return JSON.stringify({ heights: f(r.heights), base: f(r.baseHeights||r.heights), nx: r.nx, nz: r.nz }); })()`;
// the flat's points on the terrain stage: the app's own outline (bandOutlineOf) and field (outlineField), the grid's layout
const FLAT_CHECK = `(async()=>{ const { P, lastResult: r } = await import('./core/state.js');
  const { bandOutlineOf } = await import('./core/flatten-band-outline.js'); const { outlineField } = await import('./core/flatten-band.js');
  const loop = bandOutlineOf(P); if (!loop || !r) return JSON.stringify({ n: 0 });
  const f = outlineField(loop), W = P.widthIn, H = P.heightIn, nx = r.nx, nz = r.nz, half = P.bandWidthIn / 2, b = r.baseHeights;
  let n = 0, worst = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const d = f.at(i / (nx - 1) * W, H * (1 - j / (nz - 1))); if (Math.abs(d) > half) continue;
    n++; worst = Math.max(worst, Math.abs(b[j * nx + i] - P.bandHeightIn)); }
  return JSON.stringify({ n, worst, template: P.frame && P.frame.templateId, applies: P.bandAppliesTo, h: P.bandHeightIn }); })()`;

async function runFlattenBand() {
  const B = FLATTEN_BAND;
  const name1 = `Flatten band on (Both, Hourglass): the flat = Flat height ${B.heightIn} in`;
  const name2 = 'Flatten band off: heights bit-identical to before';
  if (!(await exists('bandEnabled'))) { checkRow('flatten-band', name1, false, '', B.introducedBy); checkRow('flatten-band', name2, false, '', B.introducedBy); return; }
  if (await editorOpen()) await apply();
  // the Hourglass board (the sidebar's frame picker); the band off to start
  await js(`(async()=>{ const s=document.getElementById('frameTemplate'); if(!s || s.value===${JSON.stringify(B.template)}) return 0; s.value=${JSON.stringify(B.template)}; s.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await js(`(()=>{ const c=document.getElementById('bandEnabled'); if (c.checked) c.click(); })()`);
  const z0 = await heightsSettled(null);
  const before = await jsJSON(DIGEST);
  // on, Both, the height typed
  await click('bandEnabled', 400);
  await js(`(()=>{ const b=document.querySelector('#bandAppliesToGroup > button[data-value="both"]'); if (b && !b.classList.contains('active')) b.click(); })()`);
  await setValue('bandHeightIn', B.heightIn, 'input'); await setValue('bandHeightIn', B.heightIn, 'change');
  const z1 = await heightsSettled(z0, 30000, 20000);
  const flat = await jsJSON(FLAT_CHECK);
  const ok1 = flat.n > 0 && flat.worst <= B.tolIn && flat.template === B.template && flat.applies === 'both' && z1 !== z0;
  checkRow('flatten-band', name1, ok1, `${flat.n} flat points on ${flat.template}, worst |h - ${flat.h}| = ${Number(flat.worst).toExponential(2)} in (tol ${B.tolIn}), 3D ${z1 !== z0 ? 'changed' : 'UNCHANGED'}`);
  // off again
  await click('bandEnabled', 400);
  await heightsSettled(z1, 30000, 20000);
  const after = await jsJSON(DIGEST);
  const ok2 = !!before && !!after && before.heights === after.heights && before.base === after.base && before.nx === after.nx && before.nz === after.nz;
  checkRow('flatten-band', name2, ok2, `before ${before && before.heights}/${before && before.base} after ${after && after.heights}/${after && after.base} (${after && after.nx}x${after && after.nz})`);
}
