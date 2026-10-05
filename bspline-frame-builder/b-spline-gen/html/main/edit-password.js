// edit-password.js -- F35 item 34 (Fred: "a simple enter password to edit is fine, save it to cache so I never get
// asked"). The cloud store's READS are open; every WRITE (save / rename / delete / upload) sends the edit password
// as `Authorization: Bearer <password>` (the worker's EDIT_PASSWORD secret, cloud/preset-worker/src/edit-gate.js).
//
// The app asks ONCE, on the first write, caches the password on this device (localStorage) once the worker has
// accepted it, and asks again only when the worker answers 401 (then once). Settings has a field to change or
// clear it. Inside Fusion the add-in keeps it in its own config outside the deployed folder
// (b-spline-gen.py read/write_user_config) and hands it over at startup ('edit_password'), so Fusion never asks
// twice; a new password goes back to Python ('store_edit_password').

import { isFusionMode } from '../core/state.js';
import { showToast } from '../core/toast.js';

export const EDIT_PASSWORD = Object.freeze({
  storageKey: 'bspline.editPassword',
  askTitle: 'Password to save',
  retryTitle: 'Wrong password -- try again',
  cancelledError: 'password needed to save',
  tooManyMessage: 'Too many wrong passwords -- wait 10 minutes, then try again.',
});

let _fromFusion = null; // the add-in's cached password (Fusion only)

export function getEditPassword() {
  if (_fromFusion) return _fromFusion;
  try { return localStorage.getItem(EDIT_PASSWORD.storageKey) || null; } catch { return null; }
}

/** Cache (a string) or clear (null) the password on this device -- and in the add-in's config inside Fusion. */
export function setEditPassword(password) {
  const pw = password || null;
  try {
    if (pw) localStorage.setItem(EDIT_PASSWORD.storageKey, pw);
    else localStorage.removeItem(EDIT_PASSWORD.storageKey);
  } catch { /* storage blocked: the Fusion copy / the next ask still work */ }
  if (isFusionMode) {
    _fromFusion = pw;
    try { adsk.fusionSendData('store_edit_password', JSON.stringify({ password: pw })); } catch { /* not in Fusion */ }
  }
  syncEditPasswordStatus();
}

/** The add-in's startup handshake ('edit_password'). */
export function receiveEditPasswordFromFusion(password) {
  _fromFusion = password || null;
  syncEditPasswordStatus();
}

/** A password prompt (the Project Manager's dialog style); resolves the text, or null when cancelled. */
export function askPassword(title) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pm-prompt-overlay';
    overlay.innerHTML = `
      <div class="pm-prompt-dialog" role="dialog" aria-modal="true">
        <div class="pm-prompt-title"></div>
        <input type="password" class="pm-prompt-input" autocomplete="current-password" placeholder="password">
        <div class="pm-prompt-actions">
          <button type="button" class="pm-prompt-btn pm-prompt-cancel">Cancel</button>
          <button type="button" class="pm-prompt-btn pm-prompt-ok">OK</button>
        </div>
      </div>`;
    overlay.querySelector('.pm-prompt-title').textContent = title;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.pm-prompt-input');
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.querySelector('.pm-prompt-ok').addEventListener('click', () => done(input.value || null));
    overlay.querySelector('.pm-prompt-cancel').addEventListener('click', () => done(null));
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(input.value || null); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
    });
    setTimeout(() => input.focus(), 0);
  });
}

const _cancelled = () => new Response(JSON.stringify({ error: EDIT_PASSWORD.cancelledError }), { status: 401, headers: { 'Content-Type': 'application/json' } });
const _withPassword = (init, pw) => ({ ...init, headers: { ...(init && init.headers), Authorization: `Bearer ${pw}` } });

/**
 * fetch() for a WRITE: the cached password (asked once if there is none); a 401 re-asks once and retries; a
 * password the worker accepted is cached. Cancelling the prompt answers a 401 Response (the caller's own
 * `!r.ok` path reports it); a 429 shows the wait message. `ask` = the prompt (tests pass their own).
 */
export async function editFetch(url, init = {}, ask = askPassword) {
  let pw = getEditPassword();
  if (!pw) {
    pw = await ask(EDIT_PASSWORD.askTitle);
    if (!pw) return _cancelled();
  }
  let r = await fetch(url, _withPassword(init, pw));
  if (r.status === 401) {
    setEditPassword(null);
    pw = await ask(EDIT_PASSWORD.retryTitle);
    if (!pw) return _cancelled();
    r = await fetch(url, _withPassword(init, pw));
  }
  if (r.status === 429) showToast(EDIT_PASSWORD.tooManyMessage);
  if (r.ok && pw !== getEditPassword()) setEditPassword(pw);
  return r;
}

/** The Settings field: Set caches what is typed (the worker checks it on the next write), Clear forgets it. */
export function syncEditPasswordStatus() {
  const status = typeof document !== 'undefined' && document.getElementById('editPasswordStatus');
  if (status) status.textContent = getEditPassword() ? 'Saved on this device.' : 'Not set: you will be asked on your next save.';
}
export function bindEditPasswordSettings() {
  const input = document.getElementById('editPasswordInput');
  document.getElementById('editPasswordSave')?.addEventListener('click', () => {
    if (input && input.value) { setEditPassword(input.value); input.value = ''; }
  });
  document.getElementById('editPasswordClear')?.addEventListener('click', () => {
    setEditPassword(null);
    if (input) input.value = '';
  });
  syncEditPasswordStatus();
}
