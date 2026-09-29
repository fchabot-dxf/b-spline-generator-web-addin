/**
 * Settings > Save log (Fred: "a json copied to clipboard" -> "i thought you would make an actual .json file"): the
 * action log + the model now (core/action-log.js logReport) saved as a .json file AND copied to the clipboard, with
 * the result shown on the button itself (a corner toast was easy to miss on a wide screen). Inside Fusion, where
 * neither download nor clipboard may be allowed, the JSON opens in a box, selected, with its own Copy button.
 */
import { P } from '../core/state.js';
import { logReport } from '../core/action-log.js';

function _fileName() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `bspline-log-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}.json`;
}

function _download(text, name) {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    if (typeof saveAs === 'function') { saveAs(blob, name); return true; } // FileSaver (loaded by the page)
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return true;
  } catch (_) { return false; }
}

function _flash(btn, text) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = text;
  btn.style.color = '#2e7d32';
  clearTimeout(btn._flashTimer);
  btn._flashTimer = setTimeout(() => { btn.textContent = btn.dataset.label; btn.style.color = ''; }, 3500);
}

export async function copyLogToClipboard(e) {
  const btn = (e && e.currentTarget) || document.getElementById('btnCopyLog');
  const text = logReport(typeof window !== 'undefined' ? window.svgEditor : null, P);
  const kb = Math.max(1, Math.round(text.length / 1024));
  const name = _fileName();
  const saved = _download(text, name);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (_) { copied = false; }
  if (saved || copied) {
    _flash(btn, `✓ ${saved ? 'Saved ' + name : ''}${saved && copied ? ' + ' : ''}${copied ? 'copied' : ''} (${kb} KB)`);
  }
  if (!copied) _showLogBox(text);
}

function _showLogBox(text) {
  const overlay = document.createElement('div');
  overlay.className = 'pm-prompt-overlay';
  overlay.style.zIndex = '20000';
  overlay.innerHTML = `
    <div class="pm-prompt-dialog" role="dialog" aria-modal="true" style="width:min(92vw,520px);">
      <div class="pm-prompt-message">Copy this and paste it in the chat:</div>
      <textarea readonly style="width:100%; height:40vh; font-size:10px; font-family:monospace; box-sizing:border-box;"></textarea>
      <div class="pm-prompt-actions">
        <button type="button" class="pm-prompt-btn pm-prompt-cancel">Close</button>
        <button type="button" class="pm-prompt-btn pm-prompt-ok">Copy</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('textarea');
  ta.value = text;
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
  overlay.querySelector('.pm-prompt-cancel').addEventListener('click', () => overlay.remove());
  const okBtn = overlay.querySelector('.pm-prompt-ok');
  okBtn.addEventListener('click', () => {
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    okBtn.textContent = ok ? '✓ Copied' : 'Select all + copy by hand';
    if (ok) setTimeout(() => overlay.remove(), 900);
  });
}
