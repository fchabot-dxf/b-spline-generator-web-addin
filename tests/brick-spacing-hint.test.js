/**
 * F35 (Fred: "resolution is his own responsibility via the resolution panel" -- reversing the
 * earlier auto-tighten of P.spacing): a non-blocking, DETECTION-ONLY hint in both the Resolution
 * panel and the Brick tab's own Grout section when bricks exist and the current spacing is too
 * coarse to carve the grout joints cleanly. Never writes any resolution field itself.
 *
 * F35 item 16 follow-up (Fred, from the measured resolution x brick-size grid): the hint now
 * targets the EFFECTIVE EXPORT resolution (Display vs Export split, core/state.js's
 * effectiveExportSpacing), not Display directly, and is silent above 1.5in bricks -- finer
 * resolution only ever fixes grout-joint carving, never the separate "reads as terrain, not
 * bricks" issue the grid measured at larger sizes.
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
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000"><input id="brickSize" type="number">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
  <select id="spacing"><option value="0.05" selected>Mega Ultra</option><option value="0.5">Coarse</option></select>
  <div id="spacingGroutHint"></div>
  <input type="checkbox" id="sameAsDisplayResolution" checked>
  <select id="exportSpacing"><option value="0.05" selected>Mega Ultra</option><option value="0.5">Coarse</option><option value="0.015">Masonry</option></select>
  <div id="exportSpacingGroutHint"></div>
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
  P.exportSpacing = 0.05;
  P.sameAsDisplayResolution = true;
  P.brickSettings.grout.widthIn = 0.06;
  P.brickSettings.brickLengthIn = 0.75; // <= 1.5in: the hint's own "small enough to help" gate
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

describe('Brick tab / Resolution panel: the grout-vs-export-resolution hint', () => {
  it('hidden with no bricks yet (initBrickPanel\'s own initial call)', () => {
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('brickGroutSpacingHint')).toBe(false);
    expect(shown('exportSpacingGroutHint')).toBe(false);
  });

  it('shows in Display\'s own panel (sameAsDisplayResolution) + the Brick tab once bricks exist and resolution is too coarse, naming the fine-enough options, and never changes any resolution field', () => {
    P.spacing = 0.5; // coarser than 0.06/3 = 0.02
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(true);
    expect(shown('brickGroutSpacingHint')).toBe(true);
    expect(shown('exportSpacingGroutHint')).toBe(false); // sameAsDisplayResolution=true: NOT the active one
    expect($('spacingGroutHint').textContent).toMatch(/0\.020/);
    expect($('spacingGroutHint').textContent).toMatch(/0\.5/);
    expect($('spacingGroutHint').textContent).toMatch(/Extreme \(0\.02"\) or Masonry \(0\.015"\)/);
    expect(P.spacing).toBe(0.5); // detection only -- the historical auto-tighten is GONE
    expect(P.exportSpacing).toBe(0.05);
  });

  it('targets Export, not Display, once sameAsDisplayResolution is off', () => {
    P.sameAsDisplayResolution = false;
    P.spacing = 0.01; // Display is fine -- irrelevant once decoupled
    P.exportSpacing = 0.5; // Export is coarse
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(false); // Display's own panel: not the active one now
    expect(shown('exportSpacingGroutHint')).toBe(true);
    expect(shown('brickGroutSpacingHint')).toBe(true);
    expect($('exportSpacingGroutHint').textContent).toMatch(/current 0\.5/);
  });

  it('stays hidden when the effective export resolution is already fine enough', () => {
    P.spacing = 0.01; // finer than 0.06/3 = 0.02
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('brickGroutSpacingHint')).toBe(false);
  });

  it('is silent above 1.5in bricks even when resolution is coarse -- finer resolution does not fix the measured "reads as terrain" issue at that size', () => {
    P.brickSettings.brickLengthIn = 3;
    P.spacing = 0.5; // would otherwise trigger the hint
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('brickGroutSpacingHint')).toBe(false);
  });

  it('changing the Resolution panel\'s own Display spacing select re-evaluates the hint live, reading P.spacing (not the raw DOM value) once the real param-binding has had a tick to update it', async () => {
    fireBricksGenerated(0.06); // seeds "bricks exist", spacing 0.05 is already too coarse (0.05 > 0.02)
    expect(shown('spacingGroutHint')).toBe(true);
    $('spacing').value = '0.5';
    P.spacing = 0.5; // simulates the generic param-input binding (elsewhere) having already run
    $('spacing').dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0)); // this module's own listener defers one tick -- see its comment
    expect($('spacingGroutHint').textContent).toMatch(/current 0\.5/);
  });

  it('toggling "same as display" off re-evaluates the hint live and moves it to the Export panel', async () => {
    P.spacing = 0.01; // Display fine
    P.exportSpacing = 0.5; // Export coarse, but currently inactive (sameAsDisplayResolution=true)
    fireBricksGenerated(0.06);
    expect(shown('spacingGroutHint')).toBe(false);
    $('sameAsDisplayResolution').checked = false;
    P.sameAsDisplayResolution = false; // simulates the generic param-input binding having already run
    $('sameAsDisplayResolution').dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 0));
    expect(shown('spacingGroutHint')).toBe(false);
    expect(shown('exportSpacingGroutHint')).toBe(true);
  });
});
