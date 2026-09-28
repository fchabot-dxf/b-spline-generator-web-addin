/** A short message in the corner (the project manager's, shared): 'ok' green, 'warn' orange, 'error' red. Hosts
 *  itself on first use, so it works with any modal open or closed. */
export function showToast(text, type = 'ok') {
  let host = document.getElementById('cpmToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cpmToastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(host);
  }
  const colors = { ok: '#2a7', warn: '#a60', error: '#c00' };
  const el = document.createElement('div');
  el.style.cssText = `background:${colors[type] || '#444'};color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:0;transition:opacity 200ms ease;pointer-events:auto;max-width:320px;`;
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}
