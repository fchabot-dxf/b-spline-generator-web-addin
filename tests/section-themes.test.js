/**
 * F35 item 30 step 1: ONE declared table (main/section-themes.js SECTION_THEMES) -> every visible tint derived
 * (themeTokens) for light and dark. Step 1 = the declaration + the tint sheet; nothing is wired into the app yet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SECTION_THEMES, EDITOR_SECTION_THEMES, BRICK_SECTION_THEMES, themeTokens, applySectionThemes, themeBrickSection } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { BRICK_TAB_SECTIONS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';

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
    expect(EDITOR_SECTION_THEMES.brickStripeSection.theme).toBe('brick');
    // Brick-tab v2: the tool sections' own tints and the shared 'Brick' header are gone (their KIND sections carry it)
    for (const id of ['editorBrickPanel', 'brickWallSection', 'brickFrameSection', 'brickBrushSection', 'brickRaisedSection']) expect(EDITOR_SECTION_THEMES[id], id).toBeUndefined();
    expect(EDITOR_SECTION_THEMES.editorLayersPanel.theme).toBe('stamp');
  });
  it('tokens are derived for light AND dark; a Brick tool section is a shade of the brick hue', () => {
    for (const mode of ['light', 'dark']) {
      const k = themeTokens('brick', mode);
      for (const t of ['body', 'header', 'stripe', 'text']) expect(k[t]).toMatch(/^hsl\(6 /);
    }
    expect(themeTokens('brick', 'light').body).not.toBe(themeTokens('brick', 'dark').body);
    expect(themeTokens('brick-joint', 'light').body).not.toBe(themeTokens('brick-crumble', 'light').body);
    expect(themeTokens('nope')).toBeNull();
  });
});

describe('item 30 step 2: wired', () => {
  it('applySectionThemes writes the light + dark tokens of each theme on its section (sidebar panels, editor panels, Brick sections)', () => {
    document.body.innerHTML = '<aside class="cad-sidebar"><div class="panel panel-brick"><div class="panel-header"></div><div class="panel-body"></div></div>'
      + '<div class="panel panel-stock"></div></aside><aside class="editor-layers-panel" id="editorBrickPanel">'
      + '<div id="brickStripeSection"></div></aside><aside class="editor-layers-panel" id="editorLayersPanel"></aside>';
    expect(applySectionThemes(document)).toBe(4);
    const brick = document.querySelector('.panel-brick');
    expect(brick.classList.contains('section-themed')).toBe(true);
    expect(brick.style.getPropertyValue('--section-header')).toBe(themeTokens('brick', 'light').header);
    expect(brick.style.getPropertyValue('--section-body-dark')).toBe(themeTokens('brick', 'dark').body);
    expect(document.getElementById('editorBrickPanel').classList.contains('section-themed-panel')).toBe(false);
    expect(document.getElementById('editorLayersPanel').classList.contains('section-themed-panel')).toBe(true);
    expect(document.getElementById('brickStripeSection').classList.contains('section-themed-section')).toBe(true);
    expect(applySectionThemes(document)).toBe(4); // idempotent
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

describe('Brick-tab v2 (Fred, 2026-10-07: "color coded"): one colour per section KIND', () => {
  it('every kind a Brick-tab section uses is declared, each with its own hue (the same kind = the same colour in every tab)', () => {
    const used = new Set(Object.values(BRICK_TAB_SECTIONS).flatMap((t) => t.sections.map((s) => s.kind)));
    for (const k of used) expect(BRICK_SECTION_THEMES[k], k).toBeTruthy();
    const hues = Object.values(BRICK_SECTION_THEMES).map((t) => t.hue);
    expect(new Set(hues).size).toBe(hues.length);
    for (const mode of ['light', 'dark']) expect(themeTokens('brick-joint', mode).stripe).toMatch(/^hsl\(185 /);
  });
  it("themeBrickSection writes the kind's light + dark tokens on a section", () => {
    document.body.innerHTML = '<div id="s"></div>';
    const el = document.getElementById('s');
    expect(themeBrickSection(el, 'brick-joint')).toBe(true);
    expect(el.classList.contains('section-themed-brick')).toBe(true);
    expect(el.style.getPropertyValue('--section-header')).toBe(themeTokens('brick-joint', 'light').header);
    expect(el.style.getPropertyValue('--section-stripe-dark')).toBe(themeTokens('brick-joint', 'dark').stripe);
    expect(themeBrickSection(el, 'nope')).toBe(false);
  });
});
