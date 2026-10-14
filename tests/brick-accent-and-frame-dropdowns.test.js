import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  renderAccentList,
  syncAccentControls,
  renderFramePresetList,
  syncFramePresetButtons,
  renderElementAccentRows,
  setAccentPreset,
  setFrameBandPreset,
  setElementAccent,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('BRICK-DROPDOWNS: Wall accent, Frame preset, and Brush accent use single-chip trigger & popover dropdown', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <div id="brickWallSection">
        <div id="brickWallAccentRow">
          <label id="brickWallAccentLabel">Accent</label>
          <div id="brickAccentList"></div>
        </div>
      </div>
      <div id="brickFrameSection">
        <div id="brickFramePresetRow">
          <label>Brick frame preset</label>
          <div id="brickFramePresetList"></div>
        </div>
      </div>
      <div id="brickBrushSection">
        <div id="brickBrushAccentRow"></div>
      </div>
    `;
    document.body.appendChild(root);

    P.brickSettings = {
      setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 },
      brickLengthIn: 1,
      pattern: 'stretcher',
      accent: { preset: 'none', levelIn: 0.0625 },
      frameBandPreset: 'single_soldier',
      frameBandAccents: [],
      brushAccent: { preset: 'none', levelIn: 0.0625 },
    };

    renderAccentList(document.getElementById('brickAccentList'));
    syncAccentControls();
    renderFramePresetList(document.getElementById('brickFramePresetList'));
    syncFramePresetButtons();
    renderElementAccentRows();
  });

  afterEach(() => {
    root?.remove();
  });

  it('Wall accent relief: single chip trigger at rest, popover opens on click, closes on selection', () => {
    const triggerWrap = document.getElementById('brickWallAccentTriggerWrap');
    const triggerBtn = document.getElementById('brickWallAccentTrigger');
    const triggerName = document.getElementById('brickWallAccentTriggerName');
    const list = document.getElementById('brickAccentList');

    expect(triggerWrap).not.toBeNull();
    expect(triggerBtn).not.toBeNull();
    expect(triggerName.textContent).toBe('None');
    expect(list.style.display).toBe('none');

    // Toggle open
    triggerWrap.click();
    expect(list.style.display).toBe('grid');

    // Click an accent preset
    const pyramidBtn = document.getElementById('brickAccent_pyramid');
    expect(pyramidBtn).not.toBeNull();
    pyramidBtn.click();

    expect(P.brickSettings.accent.preset).toBe('pyramid');
    expect(triggerName.textContent).toBe('Pyramid');
    expect(list.style.display).toBe('none');
  });

  it('Brick frame preset: single chip trigger at rest, popover opens on click, closes on selection', () => {
    const triggerWrap = document.getElementById('brickFramePresetTriggerWrap');
    const triggerBtn = document.getElementById('brickFramePresetTrigger');
    const triggerName = document.getElementById('brickFramePresetTriggerName');
    const list = document.getElementById('brickFramePresetList');

    expect(triggerWrap).not.toBeNull();
    expect(triggerBtn).not.toBeNull();
    expect(triggerName.textContent).toBe('Soldier');
    expect(list.style.display).toBe('none');

    // Toggle open
    triggerWrap.click();
    expect(list.style.display).toBe('flex');

    // Click three_band preset
    const threeBandBtn = document.getElementById('brickFramePreset_three_band');
    expect(threeBandBtn).not.toBeNull();
    threeBandBtn.click();

    expect(P.brickSettings.frameBandPreset).toBe('three_band');
    expect(triggerName.textContent).toBe('Soldier / Stretcher / Soldier');
    expect(list.style.display).toBe('none');
  });

  it('Brush accent relief: single chip trigger at rest, popover opens on click, closes on selection', () => {
    const triggerWrap = document.getElementById('brickAccentTriggerWrap_brush');
    const triggerBtn = document.getElementById('brickAccentTrigger_brush');
    const triggerName = document.getElementById('brickAccentTriggerName_brush');
    const popover = document.getElementById('brickAccentPopover_brush');

    expect(triggerWrap).not.toBeNull();
    expect(triggerBtn).not.toBeNull();
    expect(triggerName.textContent).toBe('None');
    expect(popover.style.display).toBe('none');

    // Toggle open
    triggerWrap.click();
    expect(popover.style.display).toBe('flex');

    // Click checker preset
    const checkerBtn = document.getElementById('brickAccent_brush_checker');
    expect(checkerBtn).not.toBeNull();
    checkerBtn.click();

    expect(P.brickSettings.brushAccent.preset).toBe('checker');
    expect(popover.style.display).toBe('none');
  });
});
