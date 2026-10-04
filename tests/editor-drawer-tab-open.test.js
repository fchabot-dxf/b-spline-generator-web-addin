/**
 * Audit C11 (Fred's Brick tab, phone 390px): at the drawer's peek height a tap on its tab only
 * switched the tab -- the panel (and its Generate + pending dot) stayed below the fold, and dragging
 * the handle was the only way up. A tab tap at peek now opens the drawer to 'half'.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initDrawer, drawerHeightPx } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-drawer.js';

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  document.body.innerHTML = `
    <div id="editorMobileDrawer"><div id="editorDrawerHandle"></div><div id="editorDrawerHandleV"></div>
      <div id="editorDrawerTabs"><button id="editorDrawerTab-tool" class="hidden"></button><button id="editorDrawerTab-layers">Brick</button></div>
      <div id="editorDrawerBody"></div></div>
    <aside id="editorLayersPanel"></aside>`;
});

const drawer = () => document.getElementById('editorMobileDrawer');

describe('a drawer tab tap at peek opens the drawer', () => {
  it('peek -> tap the tab -> half', () => {
    initDrawer({ _editorTab: 'brick', _currentMode: 'select' });
    expect(drawer().classList.contains('is-peek')).toBe(true);
    document.getElementById('editorDrawerTab-layers').click();
    expect(drawer().classList.contains('is-peek')).toBe(false);
    expect(drawer().style.height).toBe(`${drawerHeightPx('half', 844)}px`);
  });
  it('already open: a tab tap leaves the height alone', () => {
    initDrawer({ _editorTab: 'brick', _currentMode: 'select' });
    document.getElementById('editorDrawerTab-layers').click(); // -> half
    drawer().style.height = '700px';
    drawer().classList.remove('is-peek');
    document.getElementById('editorDrawerTab-layers').click();
    expect(drawer().style.height).toBe('700px');
  });
});
