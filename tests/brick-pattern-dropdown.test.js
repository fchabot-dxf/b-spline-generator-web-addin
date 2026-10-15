// the chips are main/icon-select.js mountIconGrid's (the one picker system): the chip opens the grid
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWallPatternList, setWallPattern } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('BRICK-PATTERN-DROPDOWN: single chip at rest, popover mosaic on click', () => {
  let root;

  beforeEach(() => {
    root = document.createElement('div');
    root.id = 'root';
    root.innerHTML = `
      <div id="brickWallSection">
        <div id="brickWallPatternRow">
          <label id="brickWallPatternLabel">Wall pattern</label>
          <div id="brickPatternList"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    P.brickSettings = {
      setIds: { wall: 1, frame: 1, brush: 1, raisedBrush: 1 },
      brickLengthIn: 1,
      pattern: 'stretcher',
      accent: { preset: 'none', levelIn: 0.0625 },
      wallRotationDeg: 0,
    };
    renderWallPatternList(document.getElementById('brickPatternList'));
  });

  afterEach(() => {
    root?.remove();
  });

  it('shows only the selected pattern chip at rest and hides the mosaic', () => {
    const triggerWrap = document.getElementById('brickPatternTriggerWrap');
    const triggerBtn = document.getElementById('brickPatternTrigger');
    const triggerName = document.getElementById('brickPatternTriggerName');
    const list = document.getElementById('brickPatternList');

    expect(triggerWrap).not.toBeNull();
    expect(triggerBtn).not.toBeNull();
    expect(triggerName.textContent).toBe('Stretcher');
    // Mosaic container is hidden at rest
    expect(list.style.display).toBe('none');
  });

  it('clicking the trigger chip toggles the mosaic popover open and closed', () => {
    const triggerBtn = document.getElementById('brickPatternTrigger');
    const list = document.getElementById('brickPatternList');

    expect(list.style.display).toBe('none');

    // Click to open
    triggerBtn.click();
    expect(list.style.display).toBe('grid');

    // Click to close
    triggerBtn.click();
    expect(list.style.display).toBe('none');
  });

  it('clicking a pattern button selects it, updates trigger label, and closes mosaic', () => {
    const triggerBtn = document.getElementById('brickPatternTrigger');
    const triggerName = document.getElementById('brickPatternTriggerName');
    const list = document.getElementById('brickPatternList');

    triggerBtn.click();
    expect(list.style.display).toBe('grid');

    const herringboneBtn = document.getElementById('brickPattern_herringbone');
    expect(herringboneBtn).not.toBeNull();

    herringboneBtn.click();

    expect(P.brickSettings.pattern).toBe('herringbone');
    expect(triggerName.textContent).toBe('Herringbone');
    expect(list.style.display).toBe('none');
  });
});
