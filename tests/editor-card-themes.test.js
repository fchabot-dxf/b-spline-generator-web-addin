/**
 * EDITOR CARDS, one style (Fred 2026-11-24, option A): every 2D-editor collapse-tree card wears the sidebar's coloured
 * panel look, in shades of the colour its tab's layer has in the layer stack (main/section-themes.js EDITOR_CARD_THEMES,
 * applied by main/drawer-tree.js through themeEditorCard). The stripe stays thin in the editor.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITOR_CARD_THEMES, SECTION_THEMES, themeTokens, editorCardTheme, themeEditorCard } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { createDrawerTree } from '../bspline-frame-builder/b-spline-gen/html/main/drawer-tree.js';
import { LAYER_TYPES } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { DRAW_TREE, DRAW_DRAWER_TREE } from '../bspline-frame-builder/b-spline-gen/html/main/draw-tree.js';
import { BRICK_TREE, BRICK_DRAWER_TREE } from '../bspline-frame-builder/b-spline-gen/html/main/brick-tab-sections.js';
import { HEIGHT_TREE, HEIGHT_DRAWER_TREE } from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { LATTICE_DRAWER_TREES } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-side-column.js';

// the app's trees, by the editor tab (main/editor-tabs.js id) whose layer they edit
const TREES = [
  { tab: 'artwork', id: DRAW_TREE.id, branches: DRAW_DRAWER_TREE },
  { tab: 'brick', id: BRICK_TREE.id, branches: BRICK_DRAWER_TREE },
  { tab: 'height', id: HEIGHT_TREE.id, branches: HEIGHT_DRAWER_TREE },
  ...Object.values(LATTICE_DRAWER_TREES).map((d) => ({ tab: 'lattice', id: d.treeId, branches: d.branches })),
];

describe('EDITOR_CARD_THEMES: every editor card in its layer colour', () => {
  it("every collapse tree is declared, in the layer stack's colour of the layer its tab edits", () => {
    for (const t of TREES) {
      const decl = EDITOR_CARD_THEMES[t.id];
      expect(decl, t.id).toBeTruthy();
      const layer = Object.values(LAYER_TYPES).find((L) => L.editorTab === t.tab);
      expect(decl.theme, t.id).toBe(layer.theme);
      expect(SECTION_THEMES[decl.theme], t.id).toBeTruthy();
    }
  });
  it('a shade names a real card of its tree; cards differ only by a lightness step (one hue per tab)', () => {
    for (const t of TREES) {
      const ids = new Set(t.branches.map((b) => b.id));
      for (const k of Object.keys(EDITOR_CARD_THEMES[t.id].shades)) expect(ids.has(k), `${t.id}.${k}`).toBe(true);
      const hues = new Set(t.branches.map((b) => themeTokens(editorCardTheme(t.id, b.id, !!b.armsTool).theme, 'light').stripe));
      expect(hues.size, t.id).toBe(1);
    }
    expect(themeTokens('stamp', 'light', 3).header).not.toBe(themeTokens('stamp', 'light', 0).header);
  });
  it('a built tree tints each card with its declared shade (tool cards: the tree\'s tool shade)', () => {
    document.body.innerHTML = '<div id="host"><div id="a"></div><div id="b"></div></div>';
    const tree = createDrawerTree({ id: 'drawDrawerTree', openKey: 'test.cards', branchDomId: (id) => `card_${id}`,
      branches: [{ id: 'general', title: 'General', hosts: ['a'] }, { id: 'text', title: 'Text', hosts: ['b'], armsTool: 'text' }] });
    tree.build(document.getElementById('host'), () => {});
    const general = document.getElementById('card_general');
    const text = document.getElementById('card_text');
    expect(general.classList.contains('section-themed-card')).toBe(true);
    expect(general.style.getPropertyValue('--section-header')).toBe(themeTokens('stamp', 'light', EDITOR_CARD_THEMES.drawDrawerTree.shades.general).header);
    expect(text.style.getPropertyValue('--section-header')).toBe(themeTokens('stamp', 'light', EDITOR_CARD_THEMES.drawDrawerTree.tool).header);
    expect(general.style.getPropertyValue('--section-stripe-dark')).toBe(themeTokens('stamp', 'dark').stripe);
    expect(themeEditorCard(document.createElement('div'), 'noSuchTree', 'x')).toBe(false);
  });
  it('the CSS reads the tokens only, with a THIN stripe (Fred: not the sidebar\'s stripe-to-the-edge)', () => {
    const ed = readFileSync('bspline-frame-builder/styles/editor.css', 'utf-8');
    const block = (sel) => ed.slice(ed.indexOf(sel), ed.indexOf('}', ed.indexOf(sel)));
    const card = block('.drawer-branch.section-themed-card {');
    expect(card).toMatch(/background: var\(--section-body\)/);
    expect(card).toMatch(/border-left: 4px solid var\(--section-stripe\)/);
    expect(card).not.toMatch(/panel-edge-gap|margin-left/);
    expect(block('.drawer-branch.section-themed-card > .drawer-branch-head {')).toMatch(/var\(--section-header\)[\s\S]*var\(--section-text\)/);
    // the sidebar's edge rule is scoped to the sidebar; the editor cards carry their own class, not .section-themed
    const app = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf-8');
    expect(app).toMatch(/\.cad-sidebar \.section-themed \{ margin-left: calc\(-1 \* var\(--panel-edge-gap\)\); \}/);
  });
});
