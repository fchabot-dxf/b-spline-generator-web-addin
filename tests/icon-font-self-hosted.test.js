/**
 * The icon font is SELF-HOSTED (Fred, iPad Chrome on the live site: every Projects-dialog button showed its raw ligature name,
 * 'create_new_folder New Folder', and each tile the word 'image', because the fonts.googleapis.com request had not delivered
 * the font). The page now serves a static subset of Material Symbols Outlined (Apache-2.0) from fonts/, declared in the
 * palette's own <style>, rebuilt by tools/gen_icon_font.py. These pins keep that true: same-origin, font-display block, the
 * file matching its manifest, and every icon name the app writes present in the manifest.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const HTML_DIR = path.resolve(__dirname, '../bspline-frame-builder/b-spline-gen/html');
const PALETTE = readFileSync(path.join(HTML_DIR, 'bspline_gen_palette.html'), 'utf8');
const FONT = path.join(HTML_DIR, 'fonts/material-symbols-outlined.woff2');
const MANIFEST_PATH = path.join(HTML_DIR, 'fonts/material-symbols-outlined.json');

function sources(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (['fonts', 'assets', 'data', 'node_modules'].includes(n)) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(html|js)$/.test(n)) out.push(p);
  }
  return out;
}
// names the app writes: an icon span's text, or an `icon: 'name'` field of a declared table
function usedIconNames() {
  const used = new Map();
  const add = (n, f) => { if (!used.has(n)) used.set(n, f); };
  for (const f of sources(HTML_DIR)) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/material-symbols-outlined[^>]*>\s*([a-z][a-z0-9_]+)\s*</g)) add(m[1], path.basename(f));
  }
  return used;
}

describe('the Material Symbols icon font is self-hosted', () => {
  it('the palette does not request the icon font from Google', () => {
    expect(PALETTE).not.toMatch(/fonts\.googleapis\.com\/css2\?family=Material\+Symbols/);
    expect(PALETTE).not.toMatch(/fonts\.gstatic\.com/);
  });

  it('declares an @font-face for it: same-origin woff2, font-display block', () => {
    const face = PALETTE.match(/@font-face\s*\{[^}]*Material Symbols Outlined[^}]*\}/);
    expect(face, 'no @font-face for Material Symbols Outlined in the palette').toBeTruthy();
    expect(face[0]).toMatch(/font-display:\s*block/);
    const url = face[0].match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)[1];
    expect(url).not.toMatch(/^(https?:)?\/\//); // same-origin: relative to the page
    expect(url).toBe('fonts/material-symbols-outlined.woff2');
    expect(statSync(path.join(HTML_DIR, url)).size).toBeGreaterThan(10000);
  });

  it('keeps the icon spans from ever showing words while the font is unconfirmed', () => {
    expect(PALETTE).toMatch(/html\.icons-wait \.material-symbols-outlined\s*\{[^}]*overflow:\s*hidden[^}]*color:\s*transparent/);
    expect(PALETTE).toMatch(/classList\.add\('icons-wait'\)/);
  });

  it('the font file is the one its manifest records', () => {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    expect(m.licence).toBe('Apache-2.0');
    expect(createHash('sha256').update(readFileSync(FONT)).digest('hex')).toBe(m.sha256);
    const head = readFileSync(FONT).subarray(0, 4).toString('latin1');
    expect(head).toBe('wOF2');
  });

  it('every icon name the app writes is in the bundled font', () => {
    const have = new Set(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).names);
    const used = usedIconNames();
    expect(used.size).toBeGreaterThan(10); // the scan really found the app's icons
    const missing = [...used].filter(([n]) => !have.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });
});
