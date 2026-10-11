// Brick matrix group 'photo-layer': the photo as its own LAYER over the chosen filter, end to end in the real app (2026-10-10
// / 11, Fred: the layer + "Filter shows through", the 'whole' mirror, the on-board footprint gizmo, the edge fade outside the
// photo). Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).
// Ten rows, on one fresh board (the plain filter, the built-in Brick 1 pattern picked through its own button):
//   pick -> the layer on, the heights changed | the layer toggle: off = the filter's own heights, on = back
//   "Filter shows through" changes the heights (state + control) | PERSIST: a reload; Save As -> a fresh app -> Load
//   the footprint gizmo: a real mouse drag = ONE editor undo step, undone exactly | Mirror X on a fresh board: 'whole',
//   the heights mirrored | the EDGE FADE: outside a scaled-down photo the heights are the layer-off ones
//   LAYOUT: Surface > Photo at 390 px | LEGACY: a board saved on the old Photo filter loads with its legacy keys and the
//   same heights as that board set up with them by hand.
import { EDIT_PASSWORD_TEST } from './password.mjs';

export const PHOTO_LAYER = {
  pattern: '#photoPatternRow button[title="Brick 1"]',
  baseFilter: 'silk', amount: 40,
  scaleDown: 0.4, // the edge-fade row: the photo this small leaves the board's corners outside it
  cornerFrac: 0.12, // ... the corners sampled: this fraction of the board each way from each corner
  gizmoDrag: [[0.5, 0.5], [0.58, 0.55]], // the footprint's middle (inside it at scale 1) moved, svg-element fractions
  project: 'brick-matrix-photo-layer',
  phone: { width: 390, height: 844 }, minPx: 28,
  smallOk: ['checkbox', 'range'], // controls whose own box is not the touch target (their row / thumb is)
  legacyKeys: { photoOrientation: 'legacy-flipped', photoMirrorMode: 'squeeze', photoEdge: 'clamp' }, // MIGRATIONS' legacy values
};
export const runsLast = true; // it reloads the page

let sleep, send, js, jsJSON, click, waitApp, checkRow, heightsSettled, reloadWithStorage, drag;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, waitApp, checkRow, heightsSettled, reloadWithStorage, drag } = ctx); }
export async function run() { await runPhotoLayer(); }

const G = 'photo-layer';
const settled = async () => { await js(`import('./core/engine.js').then((e) => e.whenRebuildIdle()).then(() => 1)`); return heightsSettled(null, 40000); };
const photoReady = async () => { for (let i = 0; i < 60; i++) { if (await js(`import('./core/state.js').then(({ P }) => import('./core/photo/state.js').then((s) => !!P.photoImageDataUrl && s.isPhotoReady(P.photoImageDataUrl)))`)) return true; await sleep(500); } return false; };
const READ = `(async () => {
  const { P } = await import('./core/state.js');
  return JSON.stringify({
    state: { noiseType: P.noiseType, photoLayer: P.photoLayer, amount: P.photoFilterAmount, pattern: P.photoPatternId, mode: P.photoMirrorMode,
      orientation: P.photoOrientation, edge: P.photoEdge, scale: P.filterTweaks?.photo?.scale ?? null, offsetX: P.filterTweaks?.photo?.offsetX ?? null, offsetY: P.filterTweaks?.photo?.offsetY ?? null },
    shown: { noiseType: document.getElementById('noiseType')?.value, photoLayer: !!document.getElementById('photoLayer')?.checked, amount: Number(document.getElementById('photoFilterAmount')?.value) },
  });
})()`;
const read = async () => JSON.parse(await js(READ));
const param = (key, v) => js(`import('./main/param-manager.js').then((m) => { m.applyParam(${JSON.stringify(key)}, ${JSON.stringify(v)}); return 1; })`);
const setField = (id, v) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; e.value = String(${JSON.stringify(v)});
  e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const toggle = (id, on) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; if (e.checked !== ${on}) e.click(); return true; })()`);
const openSection = () => js(`(async () => { document.getElementById('sidebarTab_surface')?.click(); await new Promise((r) => setTimeout(r, 300));
  const h = document.querySelector('.panel-photo .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); await new Promise((r) => setTimeout(r, 300)); return 1; })()`);
const setScale = (v) => js(`import('./core/noise/tweaks-ui.js').then((m) => { m.setTweak('photo', 'scale', ${v}); return 1; })`);
/** The last heights as a plain array + grid size (the board's own, for the mirror / edge-fade rows). */
const HEIGHTS_ARRAY = `import('./core/state.js').then(({ lastResult, lastNx, lastNz }) => JSON.stringify({ nx: lastNx, nz: lastNz, h: Array.from(lastResult?.heights || []) }))`;

async function runPhotoLayer() {
  const W = PHOTO_LAYER, pw = { [EDIT_PASSWORD_TEST.storageKey]: EDIT_PASSWORD_TEST.password };
  await reloadWithStorage(pw);
  await js(`(() => { const s = document.getElementById('noiseType'); s.value = 'simplex'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  const hFilter = await settled();
  // 1. the pick: the layer on, the photo decoded, the heights changed
  const picked = await js(`(() => { const b = document.querySelector(${JSON.stringify(W.pattern)}); if (!b) return false; b.click(); return true; })()`);
  const ready = picked && (await photoReady());
  const h0 = await settled(); await sleep(1500);
  const session0 = await js(`localStorage.getItem('splineGenLastSession')`);
  const s0 = await read();
  checkRow(G, 'Photo layer: a pattern pick turns the layer on and changes the heights', ready && s0.state.photoLayer === true && h0 !== hFilter && h0 !== 'none',
    `pattern ${picked ? 'picked' : 'missing'}, decoded ${ready}, layer ${s0.state.photoLayer}; heights ${h0} vs the filter ${hFilter}`);
  if (!ready || !s0.state.photoLayer) return;
  await openSection();
  // 2. the toggle: off = the filter's own heights, on = back to the photo's
  await toggle('photoLayer', false); const hOff = await settled();
  await toggle('photoLayer', true); const hOn = await settled();
  checkRow(G, 'Photo layer: the toggle -- off = the filter alone, on = the photo back', hOff === hFilter && hOn === h0, `off ${hOff} (filter ${hFilter}), on ${hOn} (layer ${h0})`);
  // 3. "Filter shows through" over another filter
  await js(`(() => { const s = document.getElementById('noiseType'); s.value = ${JSON.stringify(W.baseFilter)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  const hBase = await settled();
  await setField('photoFilterAmount', W.amount);
  const h1 = await settled(); await sleep(1500);
  const s1 = await read();
  checkRow(G, 'Photo layer: "Filter shows through" changes the heights (state + control)', s1.state.amount === W.amount && s1.shown.amount === W.amount && h1 !== hBase,
    `amount ${s1.state.amount} shown ${s1.shown.amount}; heights ${h1} vs 0 % ${hBase}`);
  // 4-5. PERSIST
  const same = (a, b) => a.state.noiseType === b.state.noiseType && a.state.photoLayer === b.state.photoLayer && a.state.amount === b.state.amount
    && a.shown.noiseType === b.shown.noiseType && a.shown.photoLayer === b.shown.photoLayer && a.shown.amount === b.shown.amount;
  await send('Page.reload', {}); await waitApp(); await photoReady(); await openSection();
  { const r = await read(), h = await settled(); checkRow(G, 'Photo layer persists: a reload', same(r, s1) && h === h1, `state ${JSON.stringify(r.state)} shown ${JSON.stringify(r.shown)}; heights ${h} vs ${h1}`); }
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input'); if(!i) return 'no prompt'; i.value=${JSON.stringify(W.project)}; document.querySelector('.pm-prompt-ok').click(); await new Promise(r=>setTimeout(r,4000)); return 'ok'; })()`);
  const keep = await js(`localStorage.getItem('brickMatrixCloudStandIn')`);
  await reloadWithStorage({ ...pw, ...(keep ? { brickMatrixCloudStandIn: keep } : {}) });
  await click('btnOpenProjectManager', 2500);
  const loaded = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')===${JSON.stringify(W.project)}); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  await photoReady(); await openSection();
  { const r = await read(), h = await settled(); checkRow(G, 'Photo layer persists: Save As -> Load', loaded === 'loaded' && same(r, s1) && h === h1, `load: ${loaded}; state ${JSON.stringify(r.state)}; heights ${h} vs ${h1}`); }

  // 6. the footprint gizmo: a real mouse drag in the editor's Photo tab = one undo step, undone exactly
  await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click('editorTabPhoto', 1500);
  const before = await read(), undo0 = await js(`window.svgEditor._undoStack.length`);
  const shown = await js(`!!document.getElementById('photoFootprint') && document.getElementById('photoFootprint').style.display !== 'none'`);
  await drag(W.gizmoDrag);
  const after = await read(), undo1 = await js(`window.svgEditor._undoStack.length`);
  await click('editorUndo', 2000);
  const undone = await read();
  const moved = after.state.offsetX !== before.state.offsetX || after.state.offsetY !== before.state.offsetY;
  checkRow(G, 'Photo footprint: a mouse drag moves the photo as ONE editor undo step; Undo puts it back', shown && moved && undo1 === undo0 + 1
    && undone.state.offsetX === before.state.offsetX && undone.state.offsetY === before.state.offsetY,
    `footprint shown ${shown}; offsets ${before.state.offsetX},${before.state.offsetY} -> ${after.state.offsetX},${after.state.offsetY} -> undo ${undone.state.offsetX},${undone.state.offsetY}; undo stack ${undo0} -> ${undo1}`);
  await click('editorCancel', 1500);

  // 7. Mirror X on a fresh board: the 'whole' mode, the heights mirrored
  await reloadWithStorage(pw);
  await js(`(() => { document.querySelector(${JSON.stringify(W.pattern)})?.click(); return 1; })()`); await photoReady();
  await param('symmetry', 'x'); await settled();
  { const s = await read(), a = JSON.parse(await js(HEIGHTS_ARRAY));
    let worst = 0; for (let j = 0; j < a.nz; j++) for (let i = 0; i < a.nx; i++) worst = Math.max(worst, Math.abs(a.h[j * a.nx + i] - a.h[j * a.nx + (a.nx - 1 - i)]));
    checkRow(G, "Photo under Mirror X (a fresh board): the 'whole' mode, the heights mirrored", s.state.mode === 'whole' && a.h.length > 0 && worst < 1e-6, `mode ${s.state.mode}; worst mirror difference ${worst.toExponential(2)} over ${a.nx}x${a.nz}`); }

  // 8. the edge fade: a scaled-down photo -- its corners outside it read the layer-off heights
  await param('symmetry', 'none'); await setScale(W.scaleDown); await settled();
  const corners = (a) => { const out = []; const ki = Math.floor(a.nx * W.cornerFrac), kj = Math.floor(a.nz * W.cornerFrac);
    for (const [i0, j0] of [[0, 0], [a.nx - ki, 0], [0, a.nz - kj], [a.nx - ki, a.nz - kj]]) for (let j = j0; j < j0 + kj; j++) for (let i = i0; i < i0 + ki; i++) out.push(a.h[j * a.nx + i]); return out; };
  const on = JSON.parse(await js(HEIGHTS_ARRAY)), sOn = await read();
  await openSection(); await toggle('photoLayer', false); await settled();
  const off = JSON.parse(await js(HEIGHTS_ARRAY));
  { const a = corners(on), b = corners(off); let worst = 0; for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
    checkRow(G, "Photo edge fade (a fresh board, 'fade'): outside a scaled-down photo the heights are the layer-off ones", sOn.state.edge === 'fade' && a.length > 20 && worst < 1e-6,
      `edge ${sOn.state.edge}, scale ${sOn.state.scale}; ${a.length} corner samples, worst difference ${worst.toExponential(2)}`); }
  await toggle('photoLayer', true); await settled();

  // 9. LAYOUT: the phone
  await send('Emulation.setDeviceMetricsOverride', { ...W.phone, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }); // as layout.mjs / blind.mjs: the coarse-pointer CSS keys on it
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  try {
    await sleep(800); await openSection();
    const r = await jsJSON(`(async () => JSON.stringify(await (async () => {
      const out = { n: 0, bad: [] };
      for (const e of [...document.querySelectorAll('#photoLayerBody button, #photoLayerBody input')]) {
        if (!e.getClientRects().length) continue;
        out.n++;
        e.scrollIntoView({ block: 'center' }); await new Promise((r) => requestAnimationFrame(r));
        const q = e.getBoundingClientRect(), cx = q.left + q.width / 2, cy = q.top + q.height / 2;
        const inView = cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight;
        const top = document.elementFromPoint(cx, cy);
        const covered = !top || !(top === e || e.contains(top) || top.contains(e) || (e.labels && [...e.labels].some((l) => l.contains(top))));
        const px = Math.round(Math.min(q.width, q.height)), small = px < ${W.minPx} && !${JSON.stringify(W.smallOk)}.includes(e.type);
        if (!inView || covered || small) out.bad.push({ id: e.id || e.getAttribute('data-photo-step') || (e.textContent || e.type).trim().slice(0, 16), inView, covered, px });
      }
      return out; })()))()`);
    checkRow(G, 'Photo layer: Surface > Photo reachable at 390 px, targets >= 28 px', r.n > 10 && r.bad.length === 0, `${r.n} controls; problems ${JSON.stringify(r.bad)}`);
  } finally {
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
  }

  // 10. LEGACY: the pick board's session as the OLD Photo filter wrote it (no layer, no photo keys) loads with MIGRATIONS'
  // legacy keys, and its heights are that same board's with those keys set by hand
  const ref = JSON.parse(session0); Object.assign(ref.P, W.legacyKeys);
  await reloadWithStorage({ ...pw, splineGenLastSession: JSON.stringify(ref) }); await photoReady();
  const hRef = await settled();
  const legacy = JSON.parse(session0);
  legacy.P.noiseType = 'photo';
  for (const k of ['photoLayer', 'photoFilterAmount', ...Object.keys(W.legacyKeys)]) delete legacy.P[k];
  await reloadWithStorage({ ...pw, splineGenLastSession: JSON.stringify(legacy) }); await photoReady();
  const sL = await read(), hL = await settled();
  checkRow(G, 'Photo layer: a board saved on the old Photo filter loads as the layer with its legacy keys, the same heights',
    sL.state.noiseType === 'simplex' && sL.state.photoLayer === true && sL.state.amount === 0 && sL.state.orientation === W.legacyKeys.photoOrientation
      && sL.state.mode === W.legacyKeys.photoMirrorMode && sL.state.edge === W.legacyKeys.photoEdge && hL === hRef && hRef !== 'none',
    `state ${JSON.stringify(sL.state)}; heights ${hL} vs the same board with the legacy keys ${hRef}`);
}
