// Brick matrix group 'photo-layer': the photo as its own LAYER over the chosen filter (2026-10-10, Fred), end to end.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).
//
// The board: a fresh page on the plain filter, the built-in Brick 1 pattern picked through its own button (the layer
// turns on), then the base filter, "Filter shows through" and one photo tweak set through Surface > Photo's controls.
//   PERSIST: after a reload, and after a project Save As -> (fresh app) -> Load, every one of those shows its value and
//            the 3D heights hash is the same.
//   LAYOUT:  at 390 px (the phone), every control of Surface > Photo is reachable (in view once scrolled to, not covered)
//            and a button / number box is at least 28 px (native checkboxes and slider tracks are the section-wide
//            exception, as in every sidebar section: their row / thumb is the target).
//   LEGACY:  a session saved on the OLD Photo FILTER (noiseType 'photo', no layer keys) loads through the migration
//            (main/app-init.js 'photo-filter-to-layer'): the layer is on at 0 %, the filter dropdown is not on Photo, and
//            the heights equal the same board built with the layer (the unit pins hold the pre-change goldens:
//            tests/photo-layer.test.js).
import { EDIT_PASSWORD_TEST } from './password.mjs';

export const PHOTO_LAYER = {
  pattern: '#photoPatternRow button[title="Brick 1"]',
  baseFilter: 'silk', amount: 40, tweak: { key: 'scale', value: 1.5 },
  project: 'brick-matrix-photo-layer',
  phone: { width: 390, height: 844 }, minPx: 28,
  // the controls whose own box is not the touch target (their label row / thumb is): checkbox, range
  smallOk: ['checkbox', 'range'],
};
export const runsLast = true; // it reloads the page

let sleep, send, js, jsJSON, click, waitApp, checkRow, heightsSettled, reloadWithStorage;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, waitApp, checkRow, heightsSettled, reloadWithStorage } = ctx); }
export async function run() { await runPhotoLayer(); }

const G = 'photo-layer';
const settled = async () => { await js(`import('./core/engine.js').then((e) => e.whenRebuildIdle()).then(() => 1)`); return heightsSettled(null, 40000); };
const photoReady = async () => { for (let i = 0; i < 60; i++) { if (await js(`import('./core/state.js').then(({ P }) => import('./core/photo/state.js').then((s) => !!P.photoImageDataUrl && s.isPhotoReady(P.photoImageDataUrl)))`)) return true; await sleep(500); } return false; };
// what the state holds and what the controls SHOW
const READ = `(async () => {
  const { P } = await import('./core/state.js');
  const tweakRow = document.querySelector('#photoLayerBody .tweak-row[data-tweak-key="${PHOTO_LAYER.tweak.key}"] input[type="number"]');
  return JSON.stringify({
    state: { noiseType: P.noiseType, photoLayer: P.photoLayer, amount: P.photoFilterAmount, tweak: P.filterTweaks?.photo?.${PHOTO_LAYER.tweak.key} ?? null, pattern: P.photoPatternId },
    shown: { noiseType: document.getElementById('noiseType')?.value, photoLayer: !!document.getElementById('photoLayer')?.checked,
      amount: Number(document.getElementById('photoFilterAmount')?.value), tweak: tweakRow ? Number(tweakRow.value) : null },
  });
})()`;
const setField = (id, v) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; e.value = String(${JSON.stringify(v)});
  e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
const openSection = () => js(`(async () => { document.getElementById('sidebarTab_surface')?.click(); await new Promise((r) => setTimeout(r, 300));
  const h = document.querySelector('.panel-photo .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); await new Promise((r) => setTimeout(r, 300)); return 1; })()`);

function sameBoard(name, want, got, wantH, gotH) {
  const W = PHOTO_LAYER;
  const okState = got.state.noiseType === W.baseFilter && got.state.photoLayer === true && got.state.amount === W.amount && got.state.tweak === W.tweak.value;
  const okShown = got.shown.noiseType === W.baseFilter && got.shown.photoLayer && got.shown.amount === W.amount && got.shown.tweak === W.tweak.value;
  checkRow(G, name, okState && okShown && gotH === wantH && wantH !== 'none',
    `state ${JSON.stringify(got.state)} shown ${JSON.stringify(got.shown)}; heights ${gotH} vs ${wantH}`);
}

async function runPhotoLayer() {
  const W = PHOTO_LAYER, pw = { [EDIT_PASSWORD_TEST.storageKey]: EDIT_PASSWORD_TEST.password };
  // the board: the plain filter, the pattern, 0 %  (the LEGACY reference), then the base filter + share + tweak
  await reloadWithStorage(pw);
  await js(`(() => { const s = document.getElementById('noiseType'); s.value = 'simplex'; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await settled();
  const picked = await js(`(() => { const b = document.querySelector(${JSON.stringify(W.pattern)}); if (!b) return false; b.click(); return true; })()`);
  const ready = picked && (await photoReady());
  const h0 = await settled(); await sleep(1500); // the session save follows the change
  const session0 = await js(`localStorage.getItem('splineGenLastSession')`);
  const s0 = JSON.parse(await js(READ));
  if (!ready || !s0.state.photoLayer) { checkRow(G, 'Photo layer: the board', false, `pattern ${picked ? 'picked' : 'missing'}, decoded ${ready}, layer ${s0.state.photoLayer}`); return; }
  await openSection();
  await js(`(() => { const s = document.getElementById('noiseType'); s.value = ${JSON.stringify(W.baseFilter)}; s.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
  await setField('photoFilterAmount', W.amount);
  await js(`(() => { const e = document.querySelector('#photoLayerBody .tweak-row[data-tweak-key="${W.tweak.key}"] input[type="number"]'); if (!e) return false;
    e.value = String(${W.tweak.value}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const h1 = await settled(); await sleep(1500);
  const s1 = JSON.parse(await js(READ));
  sameBoard('Photo layer: the board as set (state + controls)', s1, s1, h1, h1);

  // PERSIST: a reload
  await send('Page.reload', {}); await waitApp(); await photoReady(); await openSection();
  sameBoard('Photo layer persists: a reload', s1, JSON.parse(await js(READ)), h1, await settled());

  // PERSIST: Save As -> a fresh app -> Load (the real Project Manager, the cloud stand-in)
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input'); if(!i) return 'no prompt'; i.value=${JSON.stringify(W.project)}; document.querySelector('.pm-prompt-ok').click(); await new Promise(r=>setTimeout(r,4000)); return 'ok'; })()`);
  const keep = await js(`localStorage.getItem('brickMatrixCloudStandIn')`);
  await reloadWithStorage({ ...pw, ...(keep ? { brickMatrixCloudStandIn: keep } : {}) });
  await click('btnOpenProjectManager', 2500);
  const loaded = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')===${JSON.stringify(W.project)}); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  await photoReady(); await openSection();
  if (loaded !== 'loaded') checkRow(G, 'Photo layer persists: Save As -> Load', false, `load: ${loaded}`);
  else sameBoard('Photo layer persists: Save As -> Load', s1, JSON.parse(await js(READ)), h1, await settled());

  // LAYOUT: the phone
  await send('Emulation.setDeviceMetricsOverride', { ...W.phone, deviceScaleFactor: 1, mobile: true });
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
  }

  // LEGACY: the reference board's session as the OLD Photo filter wrote it
  const legacy = JSON.parse(session0);
  legacy.P.noiseType = 'photo'; delete legacy.P.photoLayer; delete legacy.P.photoFilterAmount;
  await reloadWithStorage({ ...pw, splineGenLastSession: JSON.stringify(legacy) });
  await photoReady();
  const sL = JSON.parse(await js(READ)), hL = await settled();
  checkRow(G, 'Photo layer: a board saved on the old Photo filter loads as the layer, the same heights',
    sL.state.noiseType === 'simplex' && sL.state.photoLayer === true && sL.state.amount === 0 && sL.shown.noiseType !== 'photo' && hL === h0 && h0 !== 'none',
    `state ${JSON.stringify(sL.state)}, dropdown ${sL.shown.noiseType}; heights ${hL} vs the layer board ${h0}`);
}
