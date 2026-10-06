// Brick matrix group 'password': the password to save.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { set } from './_shared.mjs';

// ---- the password to save (item 34, seat 37 fb-app 68feae7): every cloud WRITE carries `Authorization: Bearer <pw>`;
// the worker answers 401 to a wrong one. The matrix's cloud stand-in (run.mjs CLOUD_STAND_IN) mirrors that contract
// with this declared test password -- never a real one.
export const EDIT_PASSWORD_TEST = {
  password: 'brick-matrix-test-password', storageKey: 'bspline.editPassword',
  askTitle: 'Password to save', retryTitle: 'Wrong password -- try again',
  statusSaved: 'Saved on this device.', statusUnsetStarts: 'Not set',
  introducedBy: '68feae7',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, click, exists, editorOpen, apply, waitApp, checkRow;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, exists, editorOpen, apply, waitApp, checkRow } = ctx); }
export async function run() { await runPassword(); }

// ---------------------------------------------------------------- the password to save (hoisted; EDIT_PASSWORD_TEST)
async function standInNames() { return jsJSON(`JSON.stringify(Object.keys(JSON.parse(localStorage.getItem('brickMatrixCloudStandIn')||'{}')))`); }
async function cachedPassword() { return js(`localStorage.getItem(${JSON.stringify(EDIT_PASSWORD_TEST.storageKey)})`); }
// Save As `name`; answer every password prompt with the next of `answers`. Returns the titles the app asked with.
async function saveAsAnswering(name, answers) {
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input:not([type=password])'); if(!i) return 0; i.value=${JSON.stringify(name)}; i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-ok').click(); return 1; })()`);
  const asked = [];
  for (let k = 0; k < 6; k++) {
    await sleep(800);
    const title = await js(`(()=>{ const i=document.querySelector('.pm-prompt-overlay input[type=password]'); return i ? i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-title').textContent.trim() : null; })()`);
    if (!title) continue;
    asked.push(title);
    const answer = answers[asked.length - 1] ?? '';
    await js(`(()=>{ const i=document.querySelector('.pm-prompt-overlay input[type=password]'); i.value=${JSON.stringify(answer)}; i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-ok').click(); return 1; })()`);
  }
  await sleep(1500);
  await js(`(()=>{ document.querySelectorAll('.pm-prompt-overlay .pm-prompt-cancel').forEach((b)=>b.click()); return 1; })()`);
  return asked;
}
async function runPassword() {
  const W = EDIT_PASSWORD_TEST;
  await send('Page.reload', {}); await waitApp();
  if (!(await exists('editPasswordStatus'))) { checkRow('password', 'Password to save', false, '', W.introducedBy); return; }
  if (await editorOpen()) await apply();
  // 1. no cached password: Save As asks once, the write is accepted, the password is cached
  await js(`(()=>{ localStorage.removeItem(${JSON.stringify(W.storageKey)}); return 1; })()`);
  let asked = await saveAsAnswering('brick-matrix-pw-1', [W.password]);
  let names = await standInNames();
  checkRow('password', 'First save asks once, saves, caches it', asked.length === 1 && asked[0] === W.askTitle && names.includes('brick-matrix-pw-1') && (await cachedPassword()) === W.password,
    `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-1')}, cached ${(await cachedPassword()) === W.password}`);
  // 2. cached: no prompt at all
  asked = await saveAsAnswering('brick-matrix-pw-2', []);
  names = await standInNames();
  checkRow('password', 'Next save: no prompt', asked.length === 0 && names.includes('brick-matrix-pw-2'), `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-2')}`);
  // 3. a wrong cached password: 401 -> re-asked with the retry title -> the right one -> saved and cached
  await js(`(()=>{ localStorage.setItem(${JSON.stringify(W.storageKey)}, 'not-the-password'); return 1; })()`);
  asked = await saveAsAnswering('brick-matrix-pw-3', [W.password]);
  names = await standInNames();
  checkRow('password', 'Wrong password: re-asked, then saved', asked.length === 1 && asked[0] === W.retryTitle && names.includes('brick-matrix-pw-3') && (await cachedPassword()) === W.password,
    `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-3')}, cached ${(await cachedPassword()) === W.password}`);
  // 4. Settings: the status says so; Clear forgets it
  const st1 = await js(`(document.getElementById('editPasswordStatus')?.textContent||'').trim()`);
  await js(`(()=>{ document.getElementById('editPasswordClear')?.click(); return 1; })()`); await sleep(500);
  const st2 = await js(`(document.getElementById('editPasswordStatus')?.textContent||'').trim()`);
  checkRow('password', 'Settings: status, then Clear forgets it', st1 === W.statusSaved && st2.startsWith(W.statusUnsetStarts) && !(await cachedPassword()),
    `before "${st1}", after Clear "${st2.slice(0, 40)}", cached ${!!(await cachedPassword())}`);
}
