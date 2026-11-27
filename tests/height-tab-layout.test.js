/**
 * Owner 2026-11-23: the editor's Height tab uses the SAME frame as the Draw tab -- [the pinned tool row][the branches].
 * The tool row is the pinned head of the Height panel (no left rail; on a phone the drawer's head, shown at peek), and the
 * settings are ONE collapse tree (main/drawer-tree.js, as Draw / Brick): the armed tool's branch first and open with the
 * groups the tool leads with, then the free branches (Patch & layers, View, Stamp, ...). The branches scroll on their own
 * under the head (a later layer list above them must scroll separately). Read from the REAL page markup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { EDITOR_TABS, setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import {
  initHeightPanel, newHeightPatch, setHeightTool, setHeightField, _resetHeightPanelForTests, HEIGHT_TOOLS, HEIGHT_GROUPS, HEIGHT_TOOL_GROUPS,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
// the <body> only, without its scripts (as tests/art-tabs.test.js: the head's styles and fonts would be fetched)
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const PARSED = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const page = () => PARSED;
const CSS = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');

describe('the tool row: the pinned head of the Height panel, declared in EDITOR_TABS', () => {
  it('the Height tab\'s toolbar sits in its own panel\'s pinned head -- as Draw\'s does -- and not in the left rail', () => {
    const doc = page();
    for (const id of ['artwork', 'height']) {
      const t = EDITOR_TABS.find((x) => x.id === id);
      const row = doc.getElementById(t.toolbarId);
      expect(row, id).toBeTruthy();
      expect(row.closest('[data-panel-head]')?.parentElement?.id, id).toBe(t.panelId);
      expect(row.closest('.editor-sidebar'), id).toBeNull();
    }
  });
  it('on a phone the head is the drawer\'s pinned head at peek: the tab declares it in peekEssentials', () => {
    const t = EDITOR_TABS.find((x) => x.id === 'height');
    const doc = page();
    const head = doc.getElementById(t.toolbarId).closest('[data-panel-head]');
    expect((t.peekEssentials || []).some((sel) => doc.querySelector(sel) === head)).toBe(true);
  });
  it('the branches scroll on their own under the head (the panel is split: head, then a scroll container)', () => {
    const panel = page().getElementById('editorHeightPanel');
    expect(panel.classList.contains('editor-panel-split')).toBe(true);
    const kids = [...panel.children];
    expect(kids[0].hasAttribute('data-panel-head')).toBe(true);
    expect(kids[1].id).toBe('heightPanelBody');
    expect(kids[1].classList.contains('editor-panel-scroll')).toBe(true);
    const rule = CSS.match(/^\.editor-panel-split > \.editor-panel-scroll \{([^}]*)\}/m);
    expect(rule && rule[1]).toMatch(/overflow-y: auto/);
    expect(rule && rule[1]).toMatch(/min-height: 0/);
  });
});

const saved = {};
beforeEach(() => {
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
  try { localStorage.clear(); } catch (_) { /* none */ }
  // the real Height panel markup (head + body), as the page ships it
  document.body.innerHTML = page().getElementById('editorHeightPanel').outerHTML;
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
  initHeightPanel({});
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); });

const shown = (n) => n.style.display !== 'none' && !n.hidden;
const branches = () => [...document.querySelectorAll('#heightDrawerTree > .drawer-branch')];
const groupsIn = (b) => [...b.querySelectorAll(':scope > .drawer-branch-body > [id^="heightGroup_"]')].map((g) => g.id.slice('heightGroup_'.length));

describe('the Height panel is a collapse tree', () => {
  it('the tool row holds all the tools, in the head', () => {
    const row = document.querySelector('#heightToolsHead #editorToolbarHeight');
    expect([...row.querySelectorAll('[data-height-tool]')].map((b) => b.getAttribute('data-height-tool'))).toEqual(HEIGHT_TOOLS.map((t) => t.id));
  });
  it('the armed tool\'s branch is first and open, holding the groups it leads with in order; no other tool branch shows', async () => {
    await newHeightPatch();
    for (const t of HEIGHT_TOOLS) {
      setHeightTool(t.id);
      const vis = branches().filter(shown);
      if (!t.leads.length) { expect(vis.some((b) => b.dataset.branch === t.id), t.id).toBe(false); continue; } // its row is in the options bar
      expect(vis[0].dataset.branch, t.id).toBe(t.id);
      expect(vis[0].classList.contains('open'), t.id).toBe(true);
      expect(groupsIn(vis[0]), t.id).toEqual(t.leads);
      expect(vis.filter((b) => HEIGHT_TOOLS.some((x) => x.id === b.dataset.branch)).length, t.id).toBe(1);
    }
  });
  it('then the free branches: Patch & layers (open on a first visit), View, Stamp, Position & size, Heightmap file (no Selection section: its controls are in the options bar)', () => {
    const vis = branches().filter(shown);
    expect(vis.map((b) => b.querySelector('.drawer-branch-title').textContent))
      .toEqual(['Brush', 'Patch & layers', 'View', 'Stamp', 'Position & size', 'Heightmap file']);
    expect(vis[1].classList.contains('open')).toBe(true);
    expect(vis[2].classList.contains('open')).toBe(false);
  });
  it('every panel group sits in exactly one branch, except the bar groups (the Selection: its controls are in the options bar, its curve a sheet)', async () => {
    await newHeightPatch();
    expect(document.getElementById('heightBranch_selection')).toBeNull();
    const all = [...HEIGHT_GROUPS, ...HEIGHT_TOOL_GROUPS].filter((g) => !g.bar).map((g) => g.id);
    for (const g of all) expect(document.getElementById(`heightGroup_${g}`).parentElement.closest('.drawer-branch'), g).toBeTruthy();
    expect(branches().flatMap(groupsIn).sort()).toEqual([...all].sort());
    expect(document.getElementById('heightGroup_select').parentElement.id).toBe('heightFeatherSheet');
  });
  it('each branch header has a short summary (the armed tool: its first options-bar settings)', async () => {
    await newHeightPatch();
    setHeightField('sizeIn', 0.5);
    setHeightTool('brush');
    const sum = (id) => document.querySelector(`#heightBranch_${id} .drawer-branch-summary`).textContent;
    expect(sum('brush')).toBe('Size 0.5 · Raise');
    expect(sum('patch')).toMatch(/1 layer$/);
    expect(sum('view')).toBe('Lit');
    expect(sum('stamp')).toBe('Raised · Add');
    setHeightTool('gradient');
    expect(sum('gradient')).toMatch(/^Start .* · End /);
  });
  // owner 2026-11-23: '⌫' read as a keyboard backspace -- a tool Draw has too wears Draw's own icon (its button's svg, the
  // one source), declared per HEIGHT_TOOLS row (`iconFrom`); the select marquees are Draw's shapes drawn dashed
  it('the Eraser and the marquee tools wear Draw\'s own icons, from Draw\'s buttons', () => {
    document.body.innerHTML = page().getElementById('editorLayersPanel').outerHTML + page().getElementById('editorHeightPanel').outerHTML;
    _resetHeightPanelForTests();
    initHeightPanel({});
    const svgOf = (sel) => document.querySelector(sel)?.querySelector('svg');
    for (const [tool, draw] of [['eraser', 'toolErase'], ['marquee', 'toolRect'], ['move', 'toolSelect']]) {
      expect(HEIGHT_TOOLS.find((t) => t.id === tool).iconFrom, tool).toBe(draw);
      const mine = svgOf(`#editorToolbarHeight [data-height-tool="${tool}"]`), theirs = svgOf(`#${draw}`);
      expect(mine, tool).toBeTruthy();
      expect([...mine.children].map((n) => n.outerHTML.replace(/ stroke-dasharray="[^"]*"/, '')), tool).toEqual([...theirs.children].map((n) => n.outerHTML));
    }
    expect(document.querySelector('#editorToolbarHeight [data-height-tool="eraser"]').textContent).not.toContain('⌫');
    expect(svgOf('#editorToolbarHeight [data-height-tool="marquee"]').querySelector('[stroke-dasharray]')).toBeTruthy();
  });
  it('the Marquee button wears the icon of its current shape (Rectangle / Ellipse)', () => {
    document.body.innerHTML = page().getElementById('editorLayersPanel').outerHTML + page().getElementById('editorHeightPanel').outerHTML;
    _resetHeightPanelForTests();
    initHeightPanel({});
    const mine = () => [...document.querySelector('#editorToolbarHeight [data-height-tool="marquee"] svg').children].map((n) => n.outerHTML.replace(/ stroke-dasharray="[^"]*"/, ''));
    const draw = (id) => [...document.querySelector(`#${id} svg`).children].map((n) => n.outerHTML);
    expect(mine()).toEqual(draw('toolRect'));
    setHeightField('selShape', 'ellipse');
    expect(mine()).toEqual(draw('toolCircle'));
    expect(document.querySelectorAll('#editorToolbarHeight [data-height-tool="marquee"] svg').length).toBe(1);
  });
  // owner 2026-11-23 ("reuse tool icons where it makes sense"): the Height Brush and the Brick brushes paint -- ONE paintbrush
  // glyph, the shared table's (editor/tool-icons.js), referenced by both (Brick's no longer holds its own)
  it('the Brush wears the shared paintbrush glyph, the same definition the Brick brushes use', async () => {
    const { TOOL_GLYPHS } = await import('../bspline-frame-builder/b-spline-gen/html/editor/tool-icons.js');
    const { BRICK_TOOL_ICONS } = await import('../bspline-frame-builder/b-spline-gen/html/editor/brick-tool-icons.js');
    expect(HEIGHT_TOOLS.find((t) => t.id === 'brush').iconGlyph).toBe('paintbrush');
    expect(BRICK_TOOL_ICONS.brush.glyph).toBe(TOOL_GLYPHS.paintbrush.svg);
    const svg = document.querySelector('#editorToolbarHeight [data-height-tool="brush"] svg');
    expect(svg).toBeTruthy();
    const ref = document.createElement('div'); ref.innerHTML = `<svg>${TOOL_GLYPHS.paintbrush.svg}</svg>`; // the same serialiser
    expect(svg.innerHTML).toBe(ref.firstChild.innerHTML);
  });
  it('the carve-range readout stays above the tree (never folded away)', () => {
    const body = document.getElementById('heightPanelBody');
    const kids = [...body.children].map((c) => c.id);
    expect(kids.indexOf('heightCarveRange')).toBeGreaterThanOrEqual(0);
    expect(kids.indexOf('heightCarveRange')).toBeLessThan(kids.indexOf('heightDrawerTree'));
  });
});
