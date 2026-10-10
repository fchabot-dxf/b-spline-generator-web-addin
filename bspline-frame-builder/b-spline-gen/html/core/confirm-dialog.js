/**
 * The app's own confirm box (the project manager's, lifted here to share it). window.confirm is disabled inside
 * Fusion's palette (it returns null), so every "are you sure" goes through this. Uses the page's .pm-prompt-*
 * styles. `opts.okLabel` / `opts.cancelLabel` name the buttons; `opts.zIndex` lifts it above a modal (the SVG
 * editor's is 9999). Resolves true (OK) or false (Cancel, Escape, a tap outside).
 */
import { whileAskingUser } from './loading-signal.js';
// the loading card steps back while it is open (core/loading-signal.js whileAskingUser)
export function confirmDialog(message, opts = {}) { return whileAskingUser(() => _confirmDialog(message, opts)); }
function _confirmDialog(message, opts = {}) {
  const { okLabel = 'OK', cancelLabel = 'Cancel', zIndex = null } = opts;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pm-prompt-overlay';
    if (zIndex != null) overlay.style.zIndex = String(zIndex);
    overlay.innerHTML = `
      <div class="pm-prompt-dialog" role="alertdialog" aria-modal="true">
        <div class="pm-prompt-message">${_escape(message).replace(/\n/g, '<br>')}</div>
        <div class="pm-prompt-actions">
          <button type="button" class="pm-prompt-btn pm-prompt-cancel">${_escape(cancelLabel)}</button>
          <button type="button" class="pm-prompt-btn pm-prompt-ok pm-prompt-danger">${_escape(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const okBtn = overlay.querySelector('.pm-prompt-ok');
    const cancelBtn = overlay.querySelector('.pm-prompt-cancel');
    const cleanup = (v) => { overlay.remove(); resolve(v); };
    okBtn.addEventListener('click', () => cleanup(true));
    cancelBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); cleanup(true); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

function _escape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
