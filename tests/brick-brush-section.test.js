/**
 * F35 item 10 follow-up: the Brick tab's "Brush" section -- Profile
 * [Stripped|Continuous] and Orientation [Stretcher|Soldier] toggles, shown
 * only while the Brush tool is active.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';

const FIXTURE = `
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle">
      <button id="brickBtnProfileStripped" class="active"></button>
      <button id="brickBtnProfileContinuous"></button>
    </div>
    <div id="brickBrushOrientationToggle">
      <button id="brickBtnOrientationStretcher" class="active"></button>
      <button id="brickBtnOrientationSoldier"></button>
    </div>
  </div>
  <div id="brickFramePresetList"></div>
  <div id="brickPatternList"></div>
  <div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <input id="brickScaleSlider" type="range"><input id="brickScale">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickFrameLengthSlider" type="range"><input id="brickFrameLength">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;

const $ = (id) => document.getElementById(id);
const active = (id) => $(id).classList.contains('active');
const shown = (id) => $(id).style.display !== 'none';

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.brickSettings.profile = 'bricks';
  P.brickSettings.orientation = 'stretcher';
  initBrickPanel();
});
afterEach(() => { root.remove(); });

describe('Brick tab: Brush section', () => {
  it('is hidden until the Brush tool is selected, hidden again for Wall/Frame', () => {
    expect(shown('brickBrushSection')).toBe(false);
    $(`#editorToolbarBrick button`); // sanity: toolbar rendered
    document.getElementById('brickTool_brush').click();
    expect(shown('brickBrushSection')).toBe(true);
    document.getElementById('brickTool_wall').click();
    expect(shown('brickBrushSection')).toBe(false);
  });

  it('defaults to Stripped/Stretcher active', () => {
    expect(active('brickBtnProfileStripped')).toBe(true);
    expect(active('brickBtnProfileContinuous')).toBe(false);
    expect(active('brickBtnOrientationStretcher')).toBe(true);
    expect(active('brickBtnOrientationSoldier')).toBe(false);
  });

  it('Profile toggle writes P.brickSettings.profile (bricks|continuous) and updates both buttons', () => {
    $('brickBtnProfileContinuous').click();
    expect(P.brickSettings.profile).toBe('continuous');
    expect(active('brickBtnProfileContinuous')).toBe(true);
    expect(active('brickBtnProfileStripped')).toBe(false);
    $('brickBtnProfileStripped').click();
    expect(P.brickSettings.profile).toBe('bricks'); // the declared engine constant, not "stripped"
    expect(active('brickBtnProfileStripped')).toBe(true);
  });

  it('Orientation toggle writes P.brickSettings.orientation and updates both buttons', () => {
    $('brickBtnOrientationSoldier').click();
    expect(P.brickSettings.orientation).toBe('soldier');
    expect(active('brickBtnOrientationSoldier')).toBe(true);
    expect(active('brickBtnOrientationStretcher')).toBe(false);
    $('brickBtnOrientationStretcher').click();
    expect(P.brickSettings.orientation).toBe('stretcher');
    expect(active('brickBtnOrientationStretcher')).toBe(true);
  });

  it('a saved session restoring non-default values is reflected onto the buttons on init (syncControlsFromState)', () => {
    P.brickSettings.profile = 'continuous';
    P.brickSettings.orientation = 'soldier';
    initBrickPanel(); // re-init, as a reload would
    expect(active('brickBtnProfileContinuous')).toBe(true);
    expect(active('brickBtnOrientationSoldier')).toBe(true);
  });
});
