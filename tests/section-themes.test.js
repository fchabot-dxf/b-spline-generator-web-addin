/**
 * F35 item 30 step 1: ONE declared table (main/section-themes.js SECTION_THEMES) -> every visible tint derived
 * (themeTokens) for light and dark. Step 1 = the declaration + the tint sheet; nothing is wired into the app yet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SECTION_THEMES, EDITOR_SECTION_THEMES, themeTokens, applySectionThemes } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';

const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');

describe('item 30: SECTION_THEMES', () => {
  it('every main-sidebar section has a theme (read from the palette, not a copied list)', () => {
    const aside = html.slice(html.indexOf('<aside class="cad-sidebar">'), html.indexOf('<div class="cad-resizer"'));
    const ids = [...aside.matchAll(/class="panel panel-([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) expect(SECTION_THEMES[id], id).toBeTruthy();
  });
  it('every editor section names a real theme and a real element; the editor reuses the matching tab hue', () => {
    for (const [id, e] of Object.entries(EDITOR_SECTION_THEMES)) {
      expect(SECTION_THEMES[e.theme], id).toBeTruthy();
      expect(html.includes(`id="${id}"`), id).toBe(true);
    }
    expect(EDITOR_SECTION_THEMES.editorFramePanel.theme).toBe('frame');
    expect(EDITOR_SECTION_THEMES.brickWallSection.theme).toBe('brick');
    expect(EDITOR_SECTION_THEMES.editorLayersPanel.theme).toBe('stamp');
  });
  it('tokens are derived for light AND dark; a Brick tool section is a shade of the brick hue', () => {
    for (const mode of ['light', 'dark']) {
      const k = themeTokens('brick', mode);
      for (const t of ['body', 'header', 'stripe', 'text']) expect(k[t]).toMatch(/^hsl\(6 /);
    }
    expect(themeTokens('brick', 'light').body).not.toBe(themeTokens('brick', 'dark').body);
    expect(themeTokens('brickWallSection', 'light').body).not.toBe(themeTokens('brickStripeSection', 'light').body);
    expect(themeTokens('nope')).toBeNull();
  });
});

describe('item 30 step 2: wired', () => {
  it('applySectionThemes writes the light + dark tokens of each theme on its section (sidebar panels, editor panels, Brick sections)', () => {
    document.body.innerHTML = '<aside class="cad-sidebar"><div class="panel panel-brick"><div class="panel-header"></div><div class="panel-body"></div></div>'
      + '<div class="panel panel-stock"></div></aside><aside class="editor-layers-panel" id="editorBrickPanel"><div class="layers-header"></div>'
      + '<div id="brickWallSection"></div></aside><aside class="editor-layers-panel" id="editorLayersPanel"></aside>';
    expect(applySectionThemes(document)).toBe(5);
    const brick = document.querySelector('.panel-brick');
    expect(brick.classList.contains('section-themed')).toBe(true);
    expect(brick.style.getPropertyValue('--section-header')).toBe(themeTokens('brick', 'light').header);
    expect(brick.style.getPropertyValue('--section-body-dark')).toBe(themeTokens('brick', 'dark').body);
    expect(document.getElementById('editorBrickPanel').className).toMatch(/section-themed-panel.*section-themed-headonly/);
    expect(document.getElementById('editorLayersPanel').classList.contains('section-themed-headonly')).toBe(false);
    expect(document.getElementById('brickWallSection').classList.contains('section-themed-section')).toBe(true);
    expect(applySectionThemes(document)).toBe(5); // idempotent
  });
  it('the CSS reads the tokens only (no colour named), beating the white panel body of the page; the editor headers too', () => {
    const app = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf-8');
    const ed = readFileSync('bspline-frame-builder/styles/editor.css', 'utf-8');
    const block = (css, sel) => css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    expect(block(app, '.cad-sidebar .section-themed > .panel-body {')).toMatch(/background: var\(--section-body\)/);
    expect(block(app, '.cad-sidebar .section-themed > .panel-header,')).toMatch(/var\(--section-header\)[\s\S]*var\(--section-stripe\)/);
    expect(block(ed, '.editor-layers-panel.section-themed-panel > .layers-header {')).toMatch(/var\(--section-header\)/);
    expect(readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf-8')).toMatch(/applySectionThemes\(\)/);
  });
});
