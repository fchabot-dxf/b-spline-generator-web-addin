/**
 * Settings > Copy log (Fred: "a json copied to clipboard"): the action log + the model now (core/action-log.js
 * logReport) onto the clipboard. Where the clipboard is refused (Fusion's palette, a non-secure page), the JSON
 * opens in a box, already selected, with its own Copy button.
 */
import { P } from '../core/state.js';
import { logReport } from '../core/action-log.js';
import { showToast } from '../core/toast.js';

export async function copyLogToClipboard() {
  const text = logReport(typeof window !== 'undefined' ? window.svgEditor : null, P);
  try {
    await navigator.clipboard.writeText(text);
    showToast(`✓ Log copied (${Math.round(text.length / 1024)} KB) — paste it in the chat`);
  } catch (_) {
    _showLogBox(text);
  }
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
  overlay.querySelector('.pm-prompt-ok').addEventListener('click', () => {
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    if (ok) { showToast('✓ Log copied — paste it in the chat'); overlay.remove(); }
  });
}
