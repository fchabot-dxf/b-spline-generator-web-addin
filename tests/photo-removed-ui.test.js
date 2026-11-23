/**
 * Fred 2026-11-23 ("Remove photo"): no Photo anywhere in the app -- not in the sidebar (SIDEBAR_TABS / SECTION_THEMES, the
 * palette's .panel-photo), not in the editor (EDITOR_TABS, #editorTabPhoto, its rail #editorToolbarPhoto and its right
 * panel #editorPhotoPanel, the Clear menu), not in the engine (the 'photo' filter, the photo modules). New textures come
 * from an image imported into a Height patch (core/height/import.js).
 * Real shapes: the declared tables the app reads, the real palette markup, the real module tree.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { SIDEBAR_TABS, branchSections } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';
import { SECTION_THEMES, SECTION_ICONS, EDITOR_SECTION_THEMES } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { CLEAR_KINDS, clearOptions } from '../bspline-frame-builder/b-spline-gen/html/main/editor-clear-menu.js';
import { NoiseModes, NoiseList } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import { IN_EDITOR_3D } from '../bspline-frame-builder/b-spline-gen/html/core/in-editor-3d.js';
import { LOADING_STAGES } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const H = 'bspline-frame-builder/b-spline-gen/html/';
const HTML = readFileSync(`${H}bspline_gen_palette.html`, 'utf8');
const doc = new DOMParser().parseFromString(HTML, 'text/html');

describe('no Photo panel in the sidebar', () => {
  it('SIDEBAR_TABS declares no panel-photo; the palette has none; no photo theme / icon', () => {
    expect(SIDEBAR_TABS.flatMap(branchSections)).not.toContain('panel-photo');
    expect(doc.querySelector('.panel-photo')).toBeNull();
    expect(doc.getElementById('photoLayerBody')).toBeNull();
    expect(SECTION_THEMES).not.toHaveProperty('photo');
    expect(SECTION_ICONS).not.toHaveProperty('photo');
    expect(EDITOR_SECTION_THEMES).not.toHaveProperty('editorPhotoPanel');
  });
});

describe('no Photo tab in the editor', () => {
  it('EDITOR_TABS has no photo tab; the palette has no tab button, rail or panel for it', () => {
    expect(EDITOR_TABS.map((t) => t.id)).not.toContain('photo');
    for (const id of ['editorTabPhoto', 'editorToolbarPhoto', 'editorPhotoPanel', 'photoFileInput', 'photoPatternRow'])
      expect(doc.getElementById(id), id).toBeNull();
    expect([...doc.querySelectorAll('#editorModeTabs [data-editor-tab]')].map((b) => b.dataset.editorTab)).not.toContain('photo');
  });
  it('the Clear menu has no Photo entry', () => {
    expect(CLEAR_KINDS).not.toHaveProperty('photo');
    expect(clearOptions().map((o) => o.id)).not.toContain('photo');
  });
});

describe('no photo in the engine', () => {
  it("no 'photo' filter, in-editor row, loading stage or P default", () => {
    expect(NoiseModes).not.toHaveProperty('photo');
    expect(NoiseList.map((n) => n.id)).not.toContain('photo');
    expect(IN_EDITOR_3D).not.toHaveProperty('photo');
    expect(LOADING_STAGES).not.toHaveProperty('photo');
    expect(Object.keys(DEFAULT).filter((k) => k.startsWith('photo'))).toEqual([]);
  });
  it('the photo-only modules are gone', () => {
    for (const f of ['core/photo/state.js', 'core/photo/codec.js', 'core/photo/ops.js', 'core/photo/patterns.js', 'core/photo/mirror-dim.js',
      'core/noise/photo.js', 'main/photo-panel.js', 'main/photo-footprint.js', 'main/photo-layer-section.js', 'editor/photo-tool-icons.js',
      'data/photo-patterns.json']) expect(existsSync(`${H}${f}`), f).toBe(false);
  });
});
