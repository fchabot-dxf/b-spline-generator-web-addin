import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Fred 2026-11-25 (iPad Chrome, landscape + portrait): the header scrolled off the top because the app shell was sized by
// 100vh (the LARGE viewport on iPad / phone browsers, taller than what is visible). The shell must be sized by 100dvh.
const css = (f) => readFileSync(path.resolve(__dirname, '../bspline-frame-builder/styles', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// the top-level (column 0) rule for one selector, not the indented copies inside @media blocks
const rule = (src, sel) => { const m = src.match(new RegExp('\\n' + sel.replace(/[.]/g, '\\.') + '[^{]*\\{([^}]*)\\}')); return m ? m[1] : ''; };

describe('app shell height (iPad)', () => {
  const shell = rule(css('base.css'), '.cad-app-shell');
  it('the shell is sized by 100dvh, 100vh only as the fallback before it', () => {
    expect(shell).toMatch(/height:\s*100vh;\s*height:\s*100dvh;/);
  });
  it('the shell has no 100vh min-height and is position: fixed (the document has nothing to scroll)', () => {
    expect(shell).not.toMatch(/min-height:\s*100vh/);
    expect(shell).toMatch(/position:\s*fixed/);
  });
  it('the main content fills the shell by flex, not calc(100vh - ...)', () => {
    const main = rule(css('layout-app.css'), '.cad-main-content');
    expect(main).not.toMatch(/100vh/);
    expect(main).toMatch(/flex:\s*1 1 0/);
  });
});
