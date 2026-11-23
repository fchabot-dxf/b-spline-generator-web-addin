/**
 * The Fusion add-in download (Fred 2026-11-22): the header button saves the one-click installer for the visitor's OS;
 * Settings > "Fusion add-in" lists every installer with its paste-in line, and the plain ZIP.
 *
 * ADDIN_INSTALLERS is the ONE table (OS -> file). The files live in the repo's installer/ folder and the Pages build
 * (deploy_cloudflare.py) serves them at the site root, so a same-origin `<a download>` saves them. Both scripts
 * download ADDIN_ZIP_URL from the GitHub 'latest' release (release.py uploads it).
 *
 * A double-clicked downloaded script can still meet the OS's "unknown publisher" prompt (no code signing); the
 * paste-in line (irm | iex, curl | bash) never does, so the section shows it next to each file.
 */
import { showToast } from '../core/toast.js';

export const SITE_URL = 'https://bspline-generator.pages.dev';
export const ADDIN_ZIP_URL = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/bspline-frame-builder.zip';

export const ADDIN_INSTALLERS = [
  {
    os: 'windows',
    label: 'Windows',
    file: 'install-bspline-addin.cmd',
    platform: /^win|windows/i,
    after: 'Double-click it in Downloads. If Windows warns, choose More info > Run anyway, or paste the PowerShell line from Settings > Fusion add-in.',
    paste: { app: 'PowerShell', command: `irm ${SITE_URL}/install-bspline-addin.cmd | iex` },
  },
  {
    os: 'mac',
    label: 'macOS',
    file: 'install-bspline-addin.command',
    platform: /^mac|macintosh|mac os x/i,
    after: 'Open Terminal and run: bash ~/Downloads/install-bspline-addin.command (or paste the line from Settings > Fusion add-in).',
    paste: { app: 'Terminal', command: `curl -fsSL ${SITE_URL}/install-bspline-addin.command | bash` },
  },
];

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

function saveFile(file, doc) {
  const a = doc.createElement('a');
  a.setAttribute('href', file);
  a.setAttribute('download', file);
  a.style.display = 'none';
  doc.body.append(a);
  a.click();
  a.remove();
}

/** Wire the header's add-in button: the OS's installer, else the plain ZIP. `go` navigates (injected for tests). */
export function bindAddinDownloadButton(btn, { nav = globalThis.navigator, go = (url) => { window.location.href = url; } } = {}) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const entry = detectAddinInstaller(nav);
    if (!entry) { go(ADDIN_ZIP_URL); return; }
    saveFile(entry.file, btn.ownerDocument || document);
    showToast(`Saved ${entry.file}. ${entry.after}`);
  });
}

/** Fill Settings > "Fusion add-in": one row per table entry (the visitor's OS first), then the plain ZIP. */
export function renderAddinInstallSection(container, nav = globalThis.navigator) {
  if (!container) return;
  const doc = container.ownerDocument || document;
  const mine = detectAddinInstaller(nav);
  const rows = mine ? [mine, ...ADDIN_INSTALLERS.filter((e) => e !== mine)] : ADDIN_INSTALLERS;
  container.replaceChildren();
  for (const e of rows) {
    const row = doc.createElement('div');
    row.dataset.addinOs = e.os;
    row.style.cssText = 'margin-bottom:8px;';
    const link = doc.createElement('a');
    link.setAttribute('href', e.file);
    link.setAttribute('download', e.file);
    link.className = 'cad-btn cad-btn-secondary';
    link.style.cssText = 'display:flex; align-items:center; justify-content:center; min-height:30px; text-decoration:none;';
    link.textContent = `${e.label} installer${e === mine ? ' (your computer)' : ''}`;
    const how = doc.createElement('div');
    how.style.cssText = 'font-size:11px; color:#666; margin:4px 0 2px;';
    how.textContent = `Or paste in ${e.paste.app}:`;
    const code = doc.createElement('code');
    code.style.cssText = 'display:block; font-size:10px; user-select:all; word-break:break-all; padding:4px; background:rgba(0,0,0,0.05); border-radius:3px;';
    code.textContent = e.paste.command;
    row.append(link, how, code);
    container.append(row);
  }
  const zip = doc.createElement('a');
  zip.setAttribute('href', ADDIN_ZIP_URL);
  zip.dataset.addinZip = '';
  zip.style.cssText = 'display:inline-block; min-height:28px; line-height:28px; font-size:11px;'; // a 28 px touch target
  zip.textContent = 'Plain ZIP (unzip into Fusion\'s AddIns folder yourself)';
  container.append(zip);
}
