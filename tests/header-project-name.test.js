/**
 * Fred 2026-10-11: the project name lives on the LEFT of the header only (#fmCurrentFileLabel), bigger, in the same
 * row; the disk button (#btnQuickSave) is icon-only everywhere and keeps its saved / unsaved-changes colour (H16).
 * A project never saved reads "Unsaved". Runs on the REAL palette markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const $ = (id) => document.getElementById(id);

async function boot(file) {
  vi.resetModules(); // the current file is module state: each case loads the manager fresh
  document.body.innerHTML = BODY;
  localStorage.clear();
  if (file) localStorage.setItem('splineGenProjectMgrCurrentFile', file);
  const { bindProjectManager } = await import('../bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js');
  bindProjectManager({});
}

describe('the header names the project; the disk button is icon-only', () => {
  beforeEach(() => localStorage.clear());

  it('the disk button carries no name text (no label span, nothing but its icon)', async () => {
    await boot('claude 3');
    expect($('btnQuickSaveLabel')).toBeNull();
    expect($('btnQuickSave').textContent.trim()).toBe('💾');
    expect($('btnQuickSave').textContent).not.toContain('claude 3');
  });

  it('a saved project: the left label is its name alone (no leading "·")', async () => {
    await boot('claude 3');
    expect($('fmCurrentFileLabel').textContent).toBe('claude 3');
    expect($('fmCurrentFileLabel').style.display).not.toBe('none');
  });

  it('a project never saved reads "Unsaved"', async () => {
    await boot(null);
    expect($('fmCurrentFileLabel').textContent).toBe('Unsaved');
  });

  it('the name is bigger than the version-badge class it borrows, and a long name ends in "…" in the same row', () => {
    const rule = HTML.match(/#fmCurrentFileLabel \{([^}]*)\}/)[1];
    expect(parseFloat(rule.match(/font-size:\s*([\d.]+)px/)[1])).toBeGreaterThanOrEqual(14);
    const span = HTML.match(/<span id="fmCurrentFileLabel"[^>]*>/)[0];
    expect(span).toMatch(/text-overflow:ellipsis/);
    expect(span).toMatch(/white-space:nowrap/);
  });
});
