/**
 * Audit C11 (Fred's Brick tab, phone 390px): at the drawer's peek height a tap on its tab only
 * switched the tab -- the panel (and its Generate + pending dot) stayed below the fold, and dragging
 * the handle was the only way up. A tab tap at peek now opens the drawer to 'half'. Since the Art tabs the drawer's own
 * tab pair is retired: the tabs are the panels' strips (editor/tab-strip.js .ui-tab-strip) inside the drawer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDrawer, drawerHeightPx } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  document.body.innerHTML = `
    <div id="editorMobileDrawer"><div id="editorDrawerHandle"></div><div id="editorDrawerHandleV"></div>
      <div id="editorDrawerBody"><div class="ui-tab-strip"><button class="ui-tab" id="stripTab">Wall</button></div><button id="notATab">x</button></div></div>
    <aside id="editorLayersPanel"></aside>`;
});

const drawer = () => document.getElementById('editorMobileDrawer');

describe('a drawer tab tap at peek opens the drawer', () => {
  it('peek -> tap the tab -> half', () => {
    initDrawer({ _editorTab: 'brick', _currentMode: 'select' });
    expect(drawer().classList.contains('is-peek')).toBe(true);
    document.getElementById('notATab').click(); // any other button: the drawer stays at peek
    expect(drawer().classList.contains('is-peek')).toBe(true);
    document.getElementById('stripTab').click();
    expect(drawer().classList.contains('is-peek')).toBe(false);
    expect(drawer().style.height).toBe(`${drawerHeightPx('half', 844)}px`);
  });
  it('already open: a tab tap leaves the height alone', () => {
    initDrawer({ _editorTab: 'brick', _currentMode: 'select' });
    document.getElementById('stripTab').click(); // -> half
    drawer().style.height = '700px';
    drawer().classList.remove('is-peek');
    document.getElementById('stripTab').click();
    expect(drawer().style.height).toBe('700px');
  });
});
