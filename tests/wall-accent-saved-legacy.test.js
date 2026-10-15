/**
 * A board saved with a Wall accent its pattern no longer offers (0b04ee2: a pattern offers its OWN presets; Stretcher
 * has no Course bands) still lays it (accentPresetById reads the legacy entry) -- so the grid lists it, ACTIVE, and the
 * chip names it (advisor 2026-10-14) instead of showing a chip with no name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderAccentList, syncAccentControls, wallAccentChoices } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const boot = (preset) => {
  document.body.innerHTML = '<div id="brickWallAccentRow"><div id="brickAccentList"></div></div>';
  P.brickSettings = { setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 }, brickLengthIn: 1, pattern: 'stretcher', accent: { preset, levelIn: 0.0625 } };
  renderAccentList(document.getElementById('brickAccentList'));
  syncAccentControls();
};
afterEach(() => { document.body.innerHTML = ''; });

describe('a saved legacy Wall accent stays visible in the grid', () => {
  it('Stretcher + a saved Course bands: listed, active, and the chip names it', () => {
    boot('courseBand');
    const b = document.getElementById('brickAccent_courseBand');
    expect(b).not.toBeNull();
    expect(b.classList.contains('active')).toBe(true);
    expect(document.getElementById('brickWallAccentTriggerName').textContent).toBe(b.getAttribute('aria-label'));
    expect(b.getAttribute('aria-label')).toMatch(/band/i);
  });
  it('a preset the pattern offers adds nothing; neither do None / Custom / a tile', () => {
    const own = wallAccentChoices('stretcher', 'diamond').map((c) => c.id);
    expect(own).toEqual(wallAccentChoices('stretcher', null).map((c) => c.id));
    for (const p of ['none', 'custom', 'tile', 'no-such-id']) expect(wallAccentChoices('stretcher', p).length, p).toBe(own.length);
    expect(wallAccentChoices('stretcher', 'courseBand').length).toBe(own.length + 1);
  });
});
