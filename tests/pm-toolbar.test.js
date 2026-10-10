/**
 * 2026-10-10 (Fred, a shot of the Project Manager: Load / Rename / Delete sat in the BOTTOM bar): the manager's one
 * toolbar, at the top, declared once (main/pm-toolbar.js PM_TOOLBAR) -- New Folder, New, Save As, Save | Load, Rename,
 * Delete; the selection buttons enabled only with what they need selected; Delete red, last, past a divider. The ids
 * are unchanged (the manager, the brick matrix and the cloud flows click them by id).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { PM_TOOLBAR, renderPmToolbar, syncPmToolbar } from '../bspline-frame-builder/b-spline-gen/html/main/pm-toolbar.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');

describe('the Project Manager toolbar, declared once', () => {
  it('the order Fred asked for, the ids unchanged', () => {
    expect(PM_TOOLBAR.map((b) => b.id)).toEqual(['fmBtnNewFolder', 'fmBtnNew', 'fmBtnSaveAs', 'fmBtnSave', 'fmBtnLoad', 'fmBtnRename', 'fmBtnDelete']);
    expect(PM_TOOLBAR.filter((b) => b.needsSelection).map((b) => [b.id, b.needsSelection])).toEqual([['fmBtnLoad', 'project'], ['fmBtnRename', 'any'], ['fmBtnDelete', 'any']]);
    expect(PM_TOOLBAR.filter((b) => b.danger).map((b) => b.id)).toEqual(['fmBtnDelete']);
  });
  it('the markup: one toolbar slot at the top; the bottom bar keeps only the info line (no buttons)', () => {
    expect(doc.querySelector('.pm-toolbar #fmToolbarActions')).not.toBeNull();
    expect(doc.querySelector('.pm-selbar #fmSelbarInfo')).not.toBeNull();
    expect(doc.querySelectorAll('.pm-selbar button').length).toBe(0);
    for (const b of PM_TOOLBAR) expect(doc.getElementById(b.id), b.id).toBeNull(); // rendered, never a second static copy
  });
});

describe('rendered and synced', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="fmToolbarActions"></div>'; renderPmToolbar(document.getElementById('fmToolbarActions')); });
  const $ = (id) => document.getElementById(id);
  it('in order; a divider before the selection group; Delete red and last; Save keeps its label hook; rendering twice adds nothing', () => {
    const kids = [...$('fmToolbarActions').children];
    expect(kids.map((k) => k.id || k.className)).toEqual(['fmBtnNewFolder', 'fmBtnNew', 'fmBtnSaveAs', 'fmBtnSave', 'pm-toolbar-divider', 'fmBtnLoad', 'fmBtnRename', 'fmBtnDelete']);
    expect($('fmBtnDelete').classList.contains('pm-toolbar-btn-danger')).toBe(true);
    expect($('fmBtnSave').querySelector('.pm-save-label')).not.toBeNull();
    renderPmToolbar($('fmToolbarActions'));
    expect($('fmToolbarActions').children.length).toBe(kids.length);
  });
  it('nothing selected: Load / Rename / Delete disabled; a project: all on; a folder: Rename / Delete only', () => {
    const state = () => ['fmBtnLoad', 'fmBtnRename', 'fmBtnDelete'].map((id) => !$(id).disabled);
    expect(state()).toEqual([false, false, false]);
    syncPmToolbar('project'); expect(state()).toEqual([true, true, true]);
    syncPmToolbar('folder'); expect(state()).toEqual([false, true, true]);
    syncPmToolbar(null); expect(state()).toEqual([false, false, false]);
    expect($('fmBtnSave').disabled).toBe(false); // never gated
  });
});
