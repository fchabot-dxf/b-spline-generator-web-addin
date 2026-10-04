/**
 * F35 (Fred: "resolution is his own responsibility via the resolution panel" -- reversing the
 * earlier auto-tighten of P.spacing): a non-blocking, DETECTION-ONLY hint in both the Resolution
 * panel and the Brick tab's own Grout section when bricks exist and the current spacing is too
 * coarse to carve the grout joints cleanly. Never writes P.spacing itself.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';

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
  <input id="brickScaleSlider" type="range"><input id="brickScale">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickFrameLengthSlider" type="range"><input id="brickFrameLength">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
  <select id="spacing"><option value="0.05" selected>Mega Ultra</option><option value="0.5">Coarse</option></select>
  <div id="spacingGroutHint"></div>
  <div id="brickGroutSpacingHint"></div>
`;

const $ = (id) => document.getElementById(id);
const shown = (id) => $(id).style.display !== 'none';

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.spacing = 0.05;
  P.brickSettings.grout.widthIn = 0.06;
  initBrickPanel();
});
afterEach(() => { root.remove(); });

/** updateSpacingHint checks the live DOM for `[data-brick-gen="1"]` (the SAME attribute every real
 *  generated brick polygon carries) to know "bricks exist" -- this fixture has no real editor/SVG,
 *  so a plain tagged element stands in for "a brick is on the board" the same way a real one would. */
function seedABrick() {
  const el = document.createElement('div');
  el.setAttribute('data-brick-gen', '1');
  root.appendChild(el);
}

const fireBricksGenerated = (groutWidthIn) => {
  seedABrick();
  document.dispatchEvent(new CustomEvent('bricksGenerated', { detail: { groutWidthIn } }));
};

describe('Brick tab / Resolution panel: the grout-vs-spacing hint', () => {
  it('hidden with no bricks yet (initBrickPanel\'s own initial call)', () => {
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('brickGroutSpacingHint')).toBe(false);
  });

  it('shows in BOTH places once bricks exist and spacing is too coarse for the grout width, and never changes P.spacing', () => {
    P.spacing = 0.5; // coarser than 0.06/3 = 0.02
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(true);
    expect(shown('brickGroutSpacingHint')).toBe(true);
    expect($('spacingGroutHint').textContent).toMatch(/0\.020/);
    expect($('spacingGroutHint').textContent).toMatch(/0\.5/);
    expect(P.spacing).toBe(0.5); // detection only -- the historical auto-tighten is GONE
  });

  it('stays hidden when spacing is already fine enough for the grout width', () => {
    P.spacing = 0.01; // finer than 0.06/3 = 0.02
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('brickGroutSpacingHint')).toBe(false);
  });

  it('changing the Resolution panel\'s own spacing select re-evaluates the hint live, reading P.spacing (not the raw DOM value) once the real param-binding has had a tick to update it', async () => {
    fireBricksGenerated(0.06); // seeds "bricks exist", spacing 0.05 is already too coarse (0.05 > 0.02)
    expect(shown('spacingGroutHint')).toBe(true);
    $('spacing').value = '0.5';
    P.spacing = 0.5; // simulates the generic param-input binding (elsewhere) having already run
    $('spacing').dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0)); // this module's own listener defers one tick -- see its comment
    expect($('spacingGroutHint').textContent).toMatch(/current 0\.5/);
  });
});
