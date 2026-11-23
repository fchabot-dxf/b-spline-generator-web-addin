/**
 * The add-in download button offers the one-click installer for the visitor's OS (Fred 2026-11-22) and keeps the
 * plain ZIP as a link. One declared table (main/addin-download.js ADDIN_INSTALLERS: OS -> file) drives the button,
 * the Settings "Fusion add-in" section and (by name) the files the Pages build publishes from installer/.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  ADDIN_INSTALLERS, ADDIN_ZIP_URL, SITE_URL, detectAddinInstaller, bindAddinDownloadButton, renderAddinInstallSection,
} from '../bspline-frame-builder/b-spline-gen/html/main/addin-download.js';

const WIN = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 };
const MAC_HINTS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131.0', platform: '', userAgentData: { platform: 'macOS' }, maxTouchPoints: 0 };
const LINUX = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0', platform: 'Linux x86_64', maxTouchPoints: 0 };
const IPAD = { userAgent: MAC.userAgent, platform: 'MacIntel', maxTouchPoints: 5 }; // iPadOS asks for the desktop site
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 };

const byOs = (os) => ADDIN_INSTALLERS.find((e) => e.os === os);

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the installer for the visitor, declared', () => {
  it('Windows gets the .cmd, a Mac the .command, anything else the plain ZIP', () => {
    expect(detectAddinInstaller(WIN)?.file).toBe('install-bspline-addin.cmd');
    expect(detectAddinInstaller(MAC)?.file).toBe('install-bspline-addin.command');
    expect(detectAddinInstaller(MAC_HINTS)?.file).toBe('install-bspline-addin.command');
    expect(detectAddinInstaller(LINUX)).toBeNull();
    expect(detectAddinInstaller(IPAD)).toBeNull();     // Fusion's add-ins don't run there
    expect(detectAddinInstaller(IPHONE)).toBeNull();
  });

  it('every file in the table is a real installer in installer/, downloading from the ZIP the button used to link', () => {
    const base = ADDIN_ZIP_URL.slice(0, ADDIN_ZIP_URL.lastIndexOf('/') + 1);
    expect(ADDIN_INSTALLERS.map((e) => e.os).sort()).toEqual(['mac', 'windows']);
    for (const e of ADDIN_INSTALLERS) {
      expect(existsSync(`installer/${e.file}`)).toBe(true);
      expect(readFileSync(`installer/${e.file}`, 'utf8')).toContain(base);
      // the paste-in line fetches the same file from the site root (deploy_cloudflare.py copies installer/ there)
      expect(e.paste.command).toContain(`${SITE_URL}/${e.file}`);
    }
    expect(byOs('windows').paste.command).toBe(`irm ${SITE_URL}/install-bspline-addin.cmd | iex`);
    expect(byOs('mac').paste.command).toBe(`curl -fsSL ${SITE_URL}/install-bspline-addin.command | bash`);
  });
});

describe('the header button opens the modal', () => {
  const open = (nav) => {
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicked.push(this.getAttribute('href')); });
    const btn = document.createElement('button');
    document.body.append(btn);
    bindAddinDownloadButton(btn, { nav });
    btn.click();
    return { clicked, modal: document.querySelector('[data-addin-modal]') };
  };

  it('on Windows it opens the modal (no direct download): the .cmd link, its note, the exact one-liner, the ZIP', () => {
    const { clicked, modal } = open(WIN);
    expect(clicked).toEqual([]);
    expect(modal).not.toBeNull();
    const e = byOs('windows');
    const dl = modal.querySelector('a[download]');
    expect(dl.getAttribute('href')).toBe(e.file);
    expect(dl.textContent).toBe('Download installer');
    expect(modal.querySelector('[data-addin-note]').textContent).toBe(e.note);
    expect(modal.querySelector('code').textContent).toBe(e.paste.command);
    expect(modal.textContent).toContain('Then restart Fusion');
    expect(modal.querySelector('a[data-addin-zip]').getAttribute('href')).toBe(ADDIN_ZIP_URL);
  });

  it('on a Mac it leads with the .command; the switch shows the other OS', () => {
    const { modal } = open(MAC);
    expect(modal.querySelector('a[download]').getAttribute('href')).toBe(byOs('mac').file);
    modal.querySelector('[data-addin-switch="windows"]').click();
    expect(modal.querySelector('a[download]').getAttribute('href')).toBe(byOs('windows').file);
    expect(modal.querySelector('code').textContent).toBe(byOs('windows').paste.command);
    expect(modal.querySelectorAll('[data-addin-os]').length).toBe(1);
  });

  it('with no installer for this OS (Linux) it still opens, on the first entry with the switch', () => {
    expect(open(LINUX).modal.querySelector('a[download]')).not.toBeNull();
  });

  it('Copy writes the exact one-liner to the clipboard and says Copied', async () => {
    const writeText = vi.fn().mockResolvedValue();
    vi.stubGlobal('navigator', { ...WIN, clipboard: { writeText } });
    const { modal } = open(WIN);
    const btn = modal.querySelector('[data-addin-copy]');
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe('Copied'));
    expect(writeText).toHaveBeenCalledWith(byOs('windows').paste.command);
    vi.unstubAllGlobals();
  });

  it('Close, Escape and a tap on the backdrop each close it; touch targets are >= 28 px', () => {
    let { modal } = open(WIN);
    for (const el of modal.querySelectorAll('button, a')) expect(parseFloat(el.style.minHeight || el.style.lineHeight)).toBeGreaterThanOrEqual(28);
    modal.querySelector('[data-addin-close]').click();
    expect(document.querySelector('[data-addin-modal]')).toBeNull();
    ({ modal } = open(WIN));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[data-addin-modal]')).toBeNull();
    ({ modal } = open(WIN));
    modal.click();
    expect(document.querySelector('[data-addin-modal]')).toBeNull();
    ({ modal } = open(WIN));
    open(WIN);
    expect(document.querySelectorAll('[data-addin-modal]').length).toBe(1); // opening twice does not stack
  });

  it('the modal and Settings render the same block (same link, note, one-liner)', () => {
    const { modal } = open(WIN);
    const box = document.createElement('div');
    renderAddinInstallSection(box, WIN);
    const a = modal.querySelector('[data-addin-os]'), b = box.querySelector('[data-addin-os="windows"]');
    for (const sel of ['a[download]', '[data-addin-note]', 'code', '[data-addin-copy]']) {
      expect(a.querySelector(sel).getAttribute('href') ?? a.querySelector(sel).textContent)
        .toBe(b.querySelector(sel).getAttribute('href') ?? b.querySelector(sel).textContent);
    }
  });

  it('header-controls wires #btnDownloadAddin through this module (its hand-written ZIP link is gone)', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/header-controls.js', 'utf8');
    expect(src).toMatch(/import \{[^}]*bindAddinDownloadButton[^}]*\} from '\.\/addin-download\.js'/);
    expect(src).not.toContain('releases/download/latest/bspline-frame-builder.zip');
  });
});

describe('Settings > Fusion add-in', () => {
  const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
  const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

  it('the palette has the section inside the Settings window', () => {
    const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
    expect(doc.querySelector('#settings-panel #addinInstallSection #addinInstallLinks')).not.toBeNull();
  });

  it('lists the visitor\'s installer first, the other OS next, each with its paste-in line, then the ZIP', () => {
    const box = document.createElement('div');
    renderAddinInstallSection(box, MAC);
    const rows = [...box.querySelectorAll('[data-addin-os]')].map((r) => r.dataset.addinOs);
    expect(rows).toEqual(['mac', 'windows']);
    for (const e of ADDIN_INSTALLERS) {
      const row = box.querySelector(`[data-addin-os="${e.os}"]`);
      expect(row.querySelector('a[download]').getAttribute('href')).toBe(e.file);
      expect(row.querySelector('[data-addin-copy]')).not.toBeNull();
      expect(row.querySelector('code').textContent).toBe(e.paste.command);
    }
    expect(box.querySelector('[data-addin-os="mac"]').textContent).toContain('your computer');
    expect(box.querySelector('a[data-addin-zip]').getAttribute('href')).toBe(ADDIN_ZIP_URL);
    // phone first: every link in the section is at least a 28 px touch target
    for (const a of box.querySelectorAll('a')) expect(parseFloat(a.style.minHeight)).toBeGreaterThanOrEqual(28);
  });

  it('re-rendering replaces the list (opening Settings twice does not stack it)', () => {
    const box = document.createElement('div');
    renderAddinInstallSection(box, WIN);
    renderAddinInstallSection(box, WIN);
    expect(box.querySelectorAll('[data-addin-os]').length).toBe(2);
    expect(box.querySelector('[data-addin-os]').dataset.addinOs).toBe('windows');
  });
});
