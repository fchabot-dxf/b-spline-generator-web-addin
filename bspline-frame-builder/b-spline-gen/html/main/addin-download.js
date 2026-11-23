/**
 * The Fusion add-in download (Fred 2026-11-22): the header button opens a small modal with the one-click installer
 * for the visitor's OS (the other OS behind a switch); Settings > "Fusion add-in" lists every installer with its
 * paste-in line, and the plain ZIP. Both render through buildInstallerBlock (one function, one set of strings).
 *
 * ADDIN_INSTALLERS is the ONE table (OS -> file). The files live in the repo's installer/ folder and the Pages build
 * (deploy_cloudflare.py) serves them at the site root, so a same-origin `<a download>` saves them. Both scripts
 * download ADDIN_ZIP_URL from the GitHub 'latest' release (release.py uploads it).
 *
 * A double-clicked downloaded script can still meet the OS's "unknown publisher" prompt (no code signing); the
 * paste-in line (irm | iex, curl | bash) never does, so it sits next to each file with a Copy button.
 * The modal uses the app's in-page dialog look (.pm-prompt-overlay / .pm-prompt-dialog, as core/confirm-dialog.js).
 */
export const SITE_URL = 'https://bspline-generator.pages.dev';
export const ADDIN_ZIP_URL = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/bspline-frame-builder.zip';

export const ADDIN_INSTALLERS = [
  {
    os: 'windows',
    label: 'Windows',
    file: 'install-bspline-addin.cmd',
    platform: /^win|windows/i,
    note: 'Double-click it. Windows may say "Windows protected your PC": More info > Run anyway (first time only).',
    paste: { app: 'PowerShell', command: `irm ${SITE_URL}/install-bspline-addin.cmd | iex` },
  },
  {
    os: 'mac',
    label: 'macOS',
    file: 'install-bspline-addin.command',
    platform: /^mac|macintosh|mac os x/i,
    note: 'Open Terminal and run: bash ~/Downloads/install-bspline-addin.command (or double-click it).',
    paste: { app: 'Terminal', command: `curl -fsSL ${SITE_URL}/install-bspline-addin.command | bash` },
  },
];

const COPIED_MS = 1500;
const TARGET_CSS = 'display:flex; align-items:center; justify-content:center; min-height:30px; text-decoration:none; box-sizing:border-box;';
const BOX_CSS = 'display:block; font-size:11px; user-select:all; word-break:break-all; padding:6px; background:rgba(0,0,0,0.05); border-radius:3px; font-family:monospace;';

/** The table entry for this browser's OS, or null (Linux, phones, tablets: Fusion add-ins don't run there). */
export function detectAddinInstaller(nav = globalThis.navigator) {
  if (!nav) return null;
  const ua = nav.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return null;
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1) return null; // iPadOS on the desktop site
  const platform = nav.userAgentData?.platform || nav.platform || '';
  return ADDIN_INSTALLERS.find((e) => e.platform.test(platform))
    ?? ADDIN_INSTALLERS.find((e) => e.platform.test(ua))
    ?? null;
}

/** Copy `text`: the clipboard API, else select the box and execCommand('copy'). Resolves true on success. */
export async function copyText(text, box, doc = document) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the select-all fallback */ }
  try {
    const sel = doc.defaultView?.getSelection?.();
    if (box && sel) { const r = doc.createRange(); r.selectNodeContents(box); sel.removeAllRanges(); sel.addRange(r); }
    return !!doc.execCommand?.('copy');
  } catch { return false; }
}

/** ONE renderer for an installer entry (modal + Settings): download link, its note, paste-in line in a box, Copy. */
export function buildInstallerBlock(doc, e, { mine = false, primary = false } = {}) {
  const row = doc.createElement('div');
  row.dataset.addinOs = e.os;
  row.style.cssText = 'margin-bottom:8px;';
  const link = doc.createElement('a');
  link.setAttribute('href', e.file);
  link.setAttribute('download', e.file);
  link.className = primary ? 'pm-prompt-btn pm-prompt-ok' : 'cad-btn cad-btn-secondary';
  link.style.cssText = TARGET_CSS;
  link.textContent = primary ? 'Download installer' : `${e.label} installer${mine ? ' (your computer)' : ''}`;
  const note = doc.createElement('div');
  note.dataset.addinNote = '';
  note.style.cssText = 'font-size:11px; color:#666; margin:4px 0;';
  note.textContent = e.note;
  const how = doc.createElement('div');
  how.style.cssText = 'font-size:11px; color:#666; margin:6px 0 2px;';
  how.textContent = e.os === 'windows' ? `Or paste this in ${e.paste.app} (no warning):` : `Or paste this in ${e.paste.app}:`;
  const code = doc.createElement('code');
  code.style.cssText = BOX_CSS;
  code.textContent = e.paste.command;
  const copy = doc.createElement('button');
  copy.type = 'button';
  copy.dataset.addinCopy = '';
  copy.className = 'pm-prompt-btn';
  copy.style.cssText = 'min-height:28px; margin-top:4px;';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    const ok = await copyText(e.paste.command, code, doc);
    copy.textContent = ok ? 'Copied' : 'Select and copy';
    setTimeout(() => { copy.textContent = 'Copy'; }, COPIED_MS);
  });
  row.append(link, note, how, code, copy);
  return row;
}

function zipLink(doc, text) {
  const zip = doc.createElement('a');
  zip.setAttribute('href', ADDIN_ZIP_URL);
  zip.dataset.addinZip = '';
  zip.style.cssText = 'display:inline-block; min-height:28px; line-height:28px; font-size:11px;'; // a 28 px touch target
  zip.textContent = text;
  return zip;
}

/** Open the add-in modal: the visitor's OS first, the other OS behind a switch. */
export function openAddinModal({ nav = globalThis.navigator, doc = document } = {}) {
  doc.querySelector('[data-addin-modal]')?.remove();
  const mine = detectAddinInstaller(nav) ?? ADDIN_INSTALLERS[0];
  const overlay = doc.createElement('div');
  overlay.className = 'pm-prompt-overlay';
  overlay.dataset.addinModal = '';
  const dlg = doc.createElement('div');
  dlg.className = 'pm-prompt-dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.style.cssText = 'min-width:0; width:min(420px, calc(100vw - 32px)); max-height:90vh; overflow:auto; box-sizing:border-box;';
  const title = doc.createElement('div');
  title.className = 'pm-prompt-title';
  title.style.fontWeight = '600';
  title.textContent = 'Fusion add-in';
  const body = doc.createElement('div');
  const switchRow = doc.createElement('div');
  switchRow.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; font-size:11px; align-items:center;';
  const show = (e) => {
    body.replaceChildren(buildInstallerBlock(doc, e, { mine: e === mine, primary: true }));
    for (const b of switchRow.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.addinSwitch === e.os));
  };
  const lab = doc.createElement('span');
  lab.textContent = 'Mac / Windows:';
  switchRow.append(lab);
  for (const e of ADDIN_INSTALLERS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'pm-prompt-btn';
    b.dataset.addinSwitch = e.os;
    b.style.cssText = 'min-height:28px; min-width:0;';
    b.textContent = e.label;
    b.addEventListener('click', () => show(e));
    switchRow.append(b);
  }
  const then = doc.createElement('div');
  then.style.cssText = 'font-size:11px; color:#666;';
  then.textContent = 'Then restart Fusion (or Utilities > Add-Ins > Run).';
  const actions = doc.createElement('div');
  actions.className = 'pm-prompt-actions';
  actions.style.cssText = 'align-items:center; justify-content:space-between;';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'pm-prompt-btn';
  close.dataset.addinClose = '';
  close.style.minHeight = '28px';
  close.textContent = 'Close';
  actions.append(zipLink(doc, 'Download ZIP instead'), close);
  dlg.append(title, body, switchRow, then, actions);
  overlay.append(dlg);

  const onKey = (ev) => { if (ev.key === 'Escape') shut(); };
  const shut = () => { doc.removeEventListener('keydown', onKey); overlay.remove(); };
  close.addEventListener('click', shut);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) shut(); });
  doc.addEventListener('keydown', onKey);
  show(mine);
  doc.body.append(overlay);
  return { overlay, close: shut };
}

/** Wire the header's add-in button: it opens the modal (it no longer downloads directly). */
export function bindAddinDownloadButton(btn, { nav = globalThis.navigator } = {}) {
  if (!btn) return;
  btn.addEventListener('click', () => openAddinModal({ nav, doc: btn.ownerDocument || document }));
}

/** Fill Settings > "Fusion add-in": one block per table entry (the visitor's OS first), then the plain ZIP. */
export function renderAddinInstallSection(container, nav = globalThis.navigator) {
  if (!container) return;
  const doc = container.ownerDocument || document;
  const mine = detectAddinInstaller(nav);
  const rows = mine ? [mine, ...ADDIN_INSTALLERS.filter((e) => e !== mine)] : ADDIN_INSTALLERS;
  container.replaceChildren(
    ...rows.map((e) => buildInstallerBlock(doc, e, { mine: e === mine })),
    zipLink(doc, "Plain ZIP (unzip into Fusion's AddIns folder yourself)"),
  );
}
