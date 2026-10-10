/**
 * The Photo tabs (Fred's OK on mockup v2): Source | Adjust | Relief pinned at the top of the Photo panel; a tab shows its
 * blocks and every section of its tools; the rail stays and a tool pick opens its tab; the preview and Save show on every
 * tab. Markup checks read the REAL palette; behaviour runs on the real Photo panel markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/patterns.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, loadPhotoPatterns: vi.fn(() => Promise.resolve([])) };
});

import { PHOTO_TABS, photoTabOfTool, setPhotoTab, activePhotoTab, initPhotoPanel } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const PANEL = doc.getElementById('editorPhotoPanel').outerHTML;
const TOOL_IDS = [...doc.querySelectorAll('[id^="photoToolSection_"]')].map((e) => e.id.replace('photoToolSection_', ''));

describe('Photo tabs: the declaration against the real markup', () => {
  it('Source | Adjust | Relief; every tool section sits in exactly one tab; every declared block exists', () => {
    expect(PHOTO_TABS.map((t) => t.label)).toEqual(['Source', 'Adjust', 'Relief']);
    expect(TOOL_IDS.length).toBe(5);
    for (const id of TOOL_IDS) expect(PHOTO_TABS.filter((t) => t.tools.includes(id)).length, id).toBe(1);
    for (const t of PHOTO_TABS) for (const b of t.blocks) expect(doc.getElementById(b), b).not.toBeNull();
  });
  it('the strip heads the Photo panel (pinned); the rail keeps its own toolbar', () => {
    const panel = doc.getElementById('editorPhotoPanel');
    expect(panel.firstElementChild.id).toBe('photoTabsHead');
    expect(panel.firstElementChild.firstElementChild.id).toBe('photoTabStrip');
    expect(doc.querySelector('aside.editor-sidebar #editorToolbarPhoto')).not.toBeNull();
  });
  // 2026-10-10 (Fred: this tab edits the image): Max Height and the effect params moved to Surface > Photo
  // (main/photo-layer-section.js PHOTO_CONTROLS, rendered there); the Relief tab keeps Raised / Carved
  it('the blocks: Patterns + Load in Source, Raised / Carved in Relief (Max Height + effect params: Surface > Photo); preview + Save in none', () => {
    expect(doc.getElementById('photoSourceBlock').querySelector('#photoPatternRow')).not.toBeNull();
    expect(doc.getElementById('photoSourceBlock').querySelector('#photoFileInput')).not.toBeNull();
    expect(doc.getElementById('photoReliefBlock').querySelector('#photoReliefToggle')).not.toBeNull();
    for (const id of ['photoReliefHeight', 'photoTweaksBody']) expect(doc.getElementById('editorPhotoPanel').querySelector(`#${id}`), id).toBeNull();
    for (const id of ['photoPreviewCanvas', 'photoBtnSaveToPattern']) expect(doc.getElementById(id).closest('#photoSourceBlock, #photoReliefBlock'), id).toBeNull();
  });
});

describe('Photo tabs: behaviour', () => {
  beforeEach(() => {
    document.body.innerHTML = PANEL + '<div id="editorToolbarPhoto"></div>';
    initPhotoPanel({ onChange: () => {} });
  });
  const shown = (id) => document.getElementById(id).style.display !== 'none';

  it('opens on Source: its block + crop / straighten / rotate sections; Adjust and Relief hidden; preview always', () => {
    expect(activePhotoTab()).toBe('source');
    expect(document.getElementById('photoTab_source').classList.contains('active')).toBe(true);
    for (const id of ['photoSourceBlock', 'photoToolSection_crop', 'photoToolSection_straighten', 'photoToolSection_rotateFlip', 'photoPreviewCanvas']) expect(shown(id), id).toBe(true);
    for (const id of ['photoToolSection_levels', 'photoToolSection_blur', 'photoReliefBlock']) expect(shown(id), id).toBe(false);
  });
  it('Adjust shows levels AND blur at once; Relief shows its block and no tool section', () => {
    document.getElementById('photoTab_adjust').click();
    for (const id of ['photoToolSection_levels', 'photoToolSection_blur']) expect(shown(id), id).toBe(true);
    expect(shown('photoSourceBlock')).toBe(false);
    setPhotoTab('relief');
    expect(shown('photoReliefBlock')).toBe(true);
    expect(TOOL_IDS.filter((t) => shown(`photoToolSection_${t}`))).toEqual([]);
    expect(shown('photoBtnSaveToPattern')).toBe(true);
  });
  it('the rail: a tool pick opens its tab', () => {
    setPhotoTab('relief');
    document.getElementById('photoTool_blur').click();
    expect(activePhotoTab()).toBe(photoTabOfTool('blur'));
    expect(activePhotoTab()).toBe('adjust');
    expect(document.getElementById('photoTool_blur').classList.contains('active')).toBe(true);
  });
});
