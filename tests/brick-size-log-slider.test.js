/**
 * F35 item 16 advisor follow-up (Fred, "is scale easy?"): the Brick-size slider's own linear
 * 0.375-8in range crammed every everyday size (0.375-1.5in) into the first ~15% of the handle's
 * travel, since 8in is >20x the minimum. Fix: the slider's own raw DOM value is now a LOG position
 * (0-1000), mapped to real inches by main/brick-panel.js's own brickSizeToSliderPos/
 * sliderPosToBrickSize -- #brickSize (the number stepper) stays real inches throughout, exact.
 * Also: the preset list widened from 3 points (2/4/8in) to the 5 values spanning the control's own
 * min/max (0.375/0.75/1.5/3/8in), matching the measured resolution grid's own columns.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn() };
});

import {
  initBrickPanel,
  brickSizeToSliderPos,
  sliderPosToBrickSize,
  BRICK_SIZE_SLIDER_STEPS,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const MIN_IN = 0.375;
const MAX_IN = 8;

describe('brickSizeToSliderPos / sliderPosToBrickSize (pure log mapping)', () => {
  it('maps the two endpoints exactly', () => {
    expect(brickSizeToSliderPos(MIN_IN)).toBe(0);
    expect(brickSizeToSliderPos(MAX_IN)).toBe(BRICK_SIZE_SLIDER_STEPS);
    expect(sliderPosToBrickSize(0)).toBeCloseTo(MIN_IN, 9);
    expect(sliderPosToBrickSize(BRICK_SIZE_SLIDER_STEPS)).toBeCloseTo(MAX_IN, 9);
  });

  it('is monotonically increasing (a bigger size never maps to a smaller or equal position)', () => {
    const sizes = [0.375, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
    const positions = sizes.map(brickSizeToSliderPos);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('round-trips every preset value to within slider quantization (1/1000th of the log range)', () => {
    for (const inches of [0.375, 0.75, 1.5, 3, 8]) {
      const pos = brickSizeToSliderPos(inches);
      const back = sliderPosToBrickSize(pos);
      // quantization error is multiplicative (log-space), not additive -- bound it relative to the
      // value itself rather than a fixed absolute epsilon.
      expect(Math.abs(back - inches) / inches).toBeLessThan(0.01);
    }
  });

  it('puts the everyday sizes (0.375-1.5in) spread across a meaningful share of the travel -- the exact bug this fix addresses', () => {
    // Before this fix (plain linear 0.375-8in), 0.375-1.5in covered (1.5-0.375)/(8-0.375) = ~14.7%
    // of the handle's travel. The log mapping must do substantially better.
    const posAt1_5 = brickSizeToSliderPos(1.5);
    const share = posAt1_5 / BRICK_SIZE_SLIDER_STEPS;
    expect(share).toBeGreaterThan(0.4);
  });
});

const FIXTURE = `
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFramePresetList"></div>
  <div id="brickPatternList"></div>
  <div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;

const $ = (id) => document.getElementById(id);
let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {} };
  P.brickSettings.brickLengthIn = 1.25; // the new-board default (core/state.js DEFAULT)
  initBrickPanel();
  $('brickTool_wall').click();
  vi.clearAllMocks();
});
afterEach(() => { root.remove(); window.svgEditor = null; });

describe('the real #brickSizeSlider element drives inches through the log mapping', () => {
  it('dragging the slider to a raw position commits the correspondingly-mapped inches value', () => {
    const pos = brickSizeToSliderPos(3);
    $('brickSizeSlider').value = String(pos);
    $('brickSizeSlider').dispatchEvent(new Event('change'));
    expect(P.brickSettings.brickLengthIn).toBeCloseTo(3, 1);
    // F35 item 27 (Fred): the editor's Brick-tab controls re-lay at once again -- release re-lays.
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('the number box stays in EXACT real inches, independent of the slider\'s own quantization', () => {
    $('brickSize').value = '2.2';
    $('brickSize').dispatchEvent(new Event('change'));
    expect(P.brickSettings.brickLengthIn).toBe(2.2); // exact, not round-tripped through the slider's log position
  });

  it('setting via the number box also re-syncs the slider\'s own raw position (not left stale)', () => {
    $('brickSize').value = '1.5';
    $('brickSize').dispatchEvent(new Event('change'));
    expect(Number($('brickSizeSlider').value)).toBe(brickSizeToSliderPos(1.5));
  });
});

describe('brick size presets (F35 item 16 follow-up: widened from 3 to 5 points)', () => {
  it('renders exactly the 7 declared presets, one button each (2026-10-05: + 1 1/4 in, the new default, beside 1 in)', () => {
    const buttons = document.querySelectorAll('#brickSizePresetList button');
    expect(buttons.length).toBe(7);
    expect(document.getElementById('brickSizePreset_one').textContent).toBe('1″');
    expect(document.getElementById('brickSizePreset_one_quarter1').textContent).toBe('1¼″');
    expect(document.getElementById('brickSizePreset_one').nextElementSibling.id).toBe('brickSizePreset_one_quarter1');
  });
  it('the 1 1/4 in new-board default (core/state.js DEFAULT) shows as the picked preset', async () => {
    const { DEFAULT } = await import('../bspline-frame-builder/b-spline-gen/html/core/state.js');
    expect(DEFAULT.brickSettings.brickLengthIn).toBe(1.25);
    expect(document.getElementById('brickSizePreset_one_quarter1').classList.contains('active')).toBe(true); // setup: the default
    expect([...document.querySelectorAll('#brickSizePresetList .active')]).toHaveLength(1);
  });

  it('clicking a preset sets the exact inches value, both controls, and highlights only that preset', () => {
    document.getElementById('brickSizePreset_three').click();
    expect(P.brickSettings.brickLengthIn).toBe(3);
    expect($('brickSize').value).toBe('3');
    expect(Number($('brickSizeSlider').value)).toBe(brickSizeToSliderPos(3));
    expect(document.getElementById('brickSizePreset_three').classList.contains('active')).toBe(true);
    expect(document.getElementById('brickSizePreset_life').classList.contains('active')).toBe(false);
  });

  it('the Life-size preset is the control\'s own max (8in)', () => {
    document.getElementById('brickSizePreset_life').click();
    expect(P.brickSettings.brickLengthIn).toBe(8);
  });
});
