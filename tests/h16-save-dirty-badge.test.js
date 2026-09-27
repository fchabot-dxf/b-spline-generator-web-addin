/**
 * H16 (Fred, phone, pointing at the header dot: "what is the point for?" ->
 * "it should be signalled by the save (disk) button" -> correction: "no,
 * just a colour vs grey"): the Save button IS the one unsaved-changes
 * signal now -- normal colour when dirty, `.disabled` (CLASS only, never
 * the `disabled` ATTRIBUTE -- stays clickable either way) when saved,
 * title "Save"/"Saved". #dirty-dot is removed entirely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { bindProjectManager } from '../bspline-frame-builder/b-spline-gen/html/main/cloud-project-manager.js';
import { markDirty, markClean } from '../bspline-frame-builder/b-spline-gen/html/core/dirty.js';

function setupDom() {
  document.body.innerHTML = `
    <button id="btnQuickSave" class="cad-btn cad-btn-secondary cad-nav-btn disabled" title="Saved">
      <span id="btnQuickSaveLabel">Save…</span>
    </button>
    <button id="btnOpenProjectManager"></button>
  `;
}

describe('H16: the Save button is the unsaved-changes signal', () => {
  beforeEach(() => {
    setupDom();
    localStorage.clear();
    markClean(); // known starting state -- dirty.js's flag is module-level, shared across tests
    bindProjectManager({});
  });

  it('#dirty-dot does not exist anywhere in the DOM', () => {
    expect(document.getElementById('dirty-dot')).toBeNull();
  });

  it('starts saved (clean): .disabled present, title "Saved"', () => {
    const btn = document.getElementById('btnQuickSave');
    expect(btn.classList.contains('disabled')).toBe(true);
    expect(btn.title).toBe('Saved');
  });

  it('marking dirty turns the badge ON: .disabled removed, title "Save", button stays clickable (no disabled attribute)', () => {
    markDirty();
    const btn = document.getElementById('btnQuickSave');
    expect(btn.classList.contains('disabled')).toBe(false);
    expect(btn.title).toBe('Save');
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('a completed save (markClean) turns the badge back OFF', () => {
    markDirty();
    markClean();
    const btn = document.getElementById('btnQuickSave');
    expect(btn.classList.contains('disabled')).toBe(true);
    expect(btn.title).toBe('Saved');
  });

  it('a completed load (also markClean) turns the badge OFF the same way', () => {
    markDirty();
    // Project load and save both end in the same markClean() call
    // (core/dirty.js's own single writer for "nothing unsaved") -- no
    // separate load-specific path to test differently.
    markClean();
    const btn = document.getElementById('btnQuickSave');
    expect(btn.classList.contains('disabled')).toBe(true);
    expect(btn.title).toBe('Saved');
  });
});
