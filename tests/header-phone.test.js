/**
 * The header at a phone, declared (Fred 2026-10-14, pick (a): with 7 header buttons Settings fell off a 390 px phone):
 * a header button marked .cad-nav-phone-hidden leaves the phone header -- the Projects window carries it there
 * (main/pm-toolbar.js `headerTwin`) unless it is desktop-only (data-desktop-only). styles/layout-app.css holds the one
 * phone rule; the project name ends in "…" in the room the buttons leave.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PM_TOOLBAR, renderPmToolbar } from '../bspline-frame-builder/b-spline-gen/html/main/pm-toolbar.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const doc = new DOMParser().parseFromString(`<!doctype html><html>${BODY}</html>`, 'text/html');
const header = doc.querySelector('.cad-navbar-actions');

describe('the phone header, declared', () => {
  it('Pull from Fusion, New and the add-in download leave the phone header; 6 buttons stay', () => {
    const hidden = [...header.querySelectorAll('.cad-nav-phone-hidden')].map((b) => b.id).sort();
    expect(hidden).toEqual(['btnDownloadAddin', 'btnNewProject', 'btnPullFromFusion']);
    const stay = [...header.querySelectorAll(':scope > button')].filter((b) => !b.classList.contains('cad-nav-phone-hidden'));
    expect(stay.length).toBe(6); // Undo, Redo, Save, Projects, STEP, Settings: 6 x 36 + 5 x 6 = 246 of a 390 phone's 358
  });
  it('each one is in the Projects window there (a headerTwin) or desktop-only -- never just gone', () => {
    const twins = new Set(PM_TOOLBAR.map((b) => b.headerTwin).filter(Boolean));
    for (const b of header.querySelectorAll('.cad-nav-phone-hidden')) expect(twins.has(b.id) || b.hasAttribute('data-desktop-only'), b.id).toBe(true);
  });
  it('one phone rule hides the marked buttons (no per-id rule left); the name is a shrinking flex item, no % / vw cap', () => {
    const phone = CSS.slice(CSS.indexOf('@media (pointer: coarse) and (max-width: 900px) {\n    .cad-navbar .cad-nav-phone-hidden'));
    expect(phone).toMatch(/\.cad-navbar \.cad-nav-phone-hidden \{ display: none !important; \}/);
    expect(CSS).not.toMatch(/#btnNewProject \{ display: none/);
    expect(CSS).not.toMatch(/#btnDownloadAddin \{ display: none/);
    expect(CSS).not.toMatch(/#fmCurrentFileLabel \{ max-width: \d+vw/);
    expect(phone).toMatch(/#fmCurrentFileLabel \{ max-width: none !important; min-width: 0; flex: 0 1 auto; \}/);
    // the empty spacer between the name and the buttons costs a 14 px column gap of the name's room: gone on a phone
    expect(doc.querySelector('.cad-navbar > .cad-nav-spacer')).not.toBeNull();
    expect(phone).toMatch(/\.cad-navbar \.cad-nav-spacer \{ display: none; \}/);
  });
  it('the Projects window carries a Pull entry that stands for the header button', () => {
    document.body.innerHTML = '<div id="bar"></div><button id="btnPullFromFusion"></button>';
    renderPmToolbar(document.getElementById('bar'));
    expect(document.getElementById('fmBtnPullFromFusion')).not.toBeNull();
    expect(PM_TOOLBAR.find((b) => b.id === 'fmBtnPullFromFusion').headerTwin).toBe('btnPullFromFusion');
  });
});
