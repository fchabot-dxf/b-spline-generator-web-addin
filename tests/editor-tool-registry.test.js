/**
 * F35 (advisor: "ONE declared tool registry per tab driving the active-tool highlight for all
 * tabs"): editor/editor-tool-registry.js's shared render/sync, and the regression it exists to
 * fix -- editor-ui.js's setMode() used to toggle `.active` across EVERY `.tool-btn` in
 * `.editor-sidebar`, not just Artwork's own, so selecting a Brick tool that arms the generic mode
 * system (e.g. Brush -> 'brickBrush') immediately un-highlighted itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderToolRegistry, syncToolRegistryButtons } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-tool-registry.js';
import { setMode } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

describe('editor-tool-registry: renderToolRegistry / syncToolRegistryButtons', () => {
  const REGISTRY = [
    { id: 'a', buttonId: 'btnA', label: 'Alpha', icon: 'A', hint: 'does alpha things' },
    { id: 'b', buttonId: 'btnB', label: 'Beta', icon: 'B' },
  ];

  let root;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('renders one button per entry with the declared id/icon/title, wired to onSelect', () => {
    const selected = [];
    renderToolRegistry(root, REGISTRY, (id) => selected.push(id));
    const a = document.getElementById('btnA'), b = document.getElementById('btnB');
    expect(a.textContent).toBe('A');
    expect(a.title).toBe('Alpha — does alpha things');
    expect(b.title).toBe('Beta'); // no hint -- falls back to the bare label
    a.click();
    expect(selected).toEqual(['a']);
  });

  it('F35 item 16 follow-up: every rendered button carries tool-btn-emoji, the scoped hook for a stronger active highlight than plain .tool-btn alone (editor.css) -- Fred, live use: "can\'t tell which tool is selected"', () => {
    renderToolRegistry(root, REGISTRY, () => {});
    expect(document.getElementById('btnA').classList.contains('tool-btn-emoji')).toBe(true);
    expect(document.getElementById('btnA').classList.contains('tool-btn')).toBe(true); // both, not instead-of
  });

  it('re-rendering clears whatever was there before (no stale buttons left behind)', () => {
    renderToolRegistry(root, REGISTRY, () => {});
    renderToolRegistry(root, [REGISTRY[0]], () => {});
    expect(document.getElementById('btnA')).not.toBeNull();
    expect(document.getElementById('btnB')).toBeNull();
  });

  it('syncToolRegistryButtons toggles .active on exactly the matching entry', () => {
    renderToolRegistry(root, REGISTRY, () => {});
    syncToolRegistryButtons(REGISTRY, 'b');
    expect(document.getElementById('btnA').classList.contains('active')).toBe(false);
    expect(document.getElementById('btnB').classList.contains('active')).toBe(true);
    syncToolRegistryButtons(REGISTRY, 'a');
    expect(document.getElementById('btnA').classList.contains('active')).toBe(true);
    expect(document.getElementById('btnB').classList.contains('active')).toBe(false);
  });

  it('a missing button id is a safe no-op (declared but not yet rendered)', () => {
    expect(() => syncToolRegistryButtons([{ id: 'x', buttonId: 'nope' }], 'x')).not.toThrow();
  });

  afterEach(() => root.remove());
});

/** A minimal mock editor sufficient to run setMode() end to end -- same proven field set
 *  shape-lattice-handle-hover.test.js already uses to call setMode(editor, 'select') safely. */
function mockEditor() {
  return {
    _mW: 7, _mH: 9, _currentMode: 'select', _selectedElements: [], _selectedElement: null,
    _updateSelectionHighlight() {}, _updateHandles() {}, pushState() {}, _notifyChange() {},
  };
}

describe('setMode\'s own active-highlight toggle is scoped to Artwork\'s wrapper only (the fix)', () => {
  function setupDom() {
    document.body.innerHTML = `
      <aside class="editor-sidebar">
        <div id="editorToolbarArtwork">
          <button class="tool-btn active" id="toolSelect"></button>
          <button class="tool-btn" id="toolDraw"></button>
        </div>
        <div id="editorToolbarBrick">
          <button class="tool-btn active" id="brickTool_brush"></button>
          <button class="tool-btn" id="brickTool_wall"></button>
        </div>
      </aside>`;
  }

  it('switching Artwork to Draw mode highlights toolDraw and does NOT touch Brick\'s own active button', () => {
    setupDom();
    const editor = mockEditor();
    setMode(editor, 'draw');
    expect(document.getElementById('toolDraw').classList.contains('active')).toBe(true);
    expect(document.getElementById('toolSelect').classList.contains('active')).toBe(false);
    // THE regression this fixes: Brick's own highlight must survive an unrelated setMode call.
    expect(document.getElementById('brickTool_brush').classList.contains('active')).toBe(true);
  });

  it('arming a Brick-owned mode (e.g. brickBrush, via Brush) never un-highlights brickTool_brush', () => {
    setupDom();
    const editor = mockEditor();
    // No #toolBrickbrush button exists in Artwork's own wrapper -- the pre-fix blanket query would
    // toggle `active=false` on EVERY .tool-btn it reached, including Brick's own, since none match.
    setMode(editor, 'brickBrush');
    expect(document.getElementById('brickTool_brush').classList.contains('active')).toBe(true);
  });
});
