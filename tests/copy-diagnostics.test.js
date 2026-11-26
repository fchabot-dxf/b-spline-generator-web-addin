/**
 * Diagnostics folded into Settings > Log for Claude (Fred 2026-11-25): the declared probe table yields every field, the
 * Save log JSON carries them in a `diagnostics` field, no second button, main.js installs the error ring at app start.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { logReport } from '../bspline-frame-builder/b-spline-gen/html/core/action-log.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  DIAG_PROBES, diagnosticsReport, diagnosticsData, pushDiagError, diagErrors, ERROR_RING_SIZE,
} from '../bspline-frame-builder/b-spline-gen/html/main/copy-diagnostics.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const MAIN_JS = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');
const HEADER_JS = readFileSync('bspline-frame-builder/b-spline-gen/html/main/header-controls.js', 'utf8');

const LABELS = ['app', 'time', 'userAgent', 'platform', 'devicePixelRatio', 'pointer', 'orientation', 'inner w x h',
  'visualViewport', 'documentElement.clientHeight', '100vh / 100dvh px', 'page scrollTop / scrollHeight', 'header rect',
  'sidebar scroller', 'editor open / drawer', 'Material Symbols font', 'layout mode', 'board', 'last errors',
  'sidebar panel headers'];

function dom() {
  document.body.innerHTML = `
    <header class="cad-navbar"></header>
    <span id="build-badge">v1 2026.11.25 abc1234</span>
    <aside class="cad-sidebar"><div class="panel"><div class="panel-header collapsed">A</div></div></aside>
    <div id="svgEditorModal" style="display:none"></div><div id="editorMobileDrawer"></div>
    <button id="btnCopyDiagnostics">Copy diagnostics</button>`;
}

describe('Copy diagnostics', () => {
  beforeEach(dom);

  it('the probe table declares every field and the report prints each one', () => {
    expect(DIAG_PROBES.map((p) => p.label)).toEqual(LABELS);
    const text = diagnosticsReport();
    for (const l of LABELS) expect(text).toContain(`${l}:`);
    expect(text).not.toMatch(/n\/a \(/); // no getter threw in the DOM
    expect(text).toContain('board: 7 x 9 in');
    expect(text).toContain(`carveZ ${P.carveZ}`);
    expect(text).toContain('sidebar panel headers:');
    expect(text).toContain('panel-header.collapsed');
    expect(text.length).toBeLessThan(4096);
  });

  it('a throwing getter prints n/a and the rest of the report survives', () => {
    const orig = DIAG_PROBES[2].get;
    DIAG_PROBES[2].get = () => { throw new Error('boom'); };
    try { expect(diagnosticsReport()).toMatch(/userAgent: n\/a \(boom\)[\s\S]*platform:/); } finally { DIAG_PROBES[2].get = orig; }
  });

  it('the error ring keeps the last 20', () => {
    for (let i = 0; i < ERROR_RING_SIZE + 5; i++) pushDiagError(`e${i}`);
    expect(diagErrors().length).toBe(ERROR_RING_SIZE);
    expect(diagErrors().at(-1)).toBe(`e${ERROR_RING_SIZE + 4}`);
    expect(diagnosticsReport()).toContain(`e${ERROR_RING_SIZE + 4}`);
  });

  it('the Save log JSON gains a diagnostics field: structured fields, the ring entries and the text', () => {
    pushDiagError('ring-entry-xyz');
    const j = JSON.parse(logReport(null, P, diagnosticsData()));
    expect(Object.keys(j.diagnostics.fields)).toEqual(LABELS);
    expect(j.diagnostics.fields.board).toContain('7 x 9 in');
    expect(j.diagnostics.errors).toContain('ring-entry-xyz');
    expect(j.diagnostics.text).toContain('bspline diagnostics');
    expect(j.log).toBeDefined();
  });

  it('copy-log.js hands diagnosticsData() to logReport; Settings has ONE log button and no second Diagnostics button', () => {
    expect(readFileSync('bspline-frame-builder/b-spline-gen/html/main/copy-log.js', 'utf8')).toMatch(/logReport\([^)]*diagnosticsData\(\)\)/);
    const body = HTML.slice(HTML.indexOf('id="settings-panel-overlay"'), HTML.indexOf('id="close-settings-footer-btn"'));
    expect(body).toContain('id="btnCopyLog"');
    expect(body).not.toContain('btnCopyDiagnostics');
    expect(HEADER_JS).not.toContain('btnCopyDiagnostics');
    expect(MAIN_JS).toMatch(/^installErrorRing\(\)/m);
  });
});
