/**
 * LABELS worker T ("Clearer names & units"): display-only renames + the SVG stamp's Relief Raised | Carved toggle.
 * The REAL palette markup. Nothing stored changes: the toggle and the Height control write the SAME signed layer
 * `depth` (+ the P.stampDepth mirror) the old "Plunge Depth" control wrote.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { bind, syncPair } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { createStampCtx } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_shared.js';
import { initDepth } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/depth.js';
import { attachFormulaFields, FORMULA_FIELDS } from '../bspline-frame-builder/b-spline-gen/html/main/formula-fields.js';
import { renderPhotoLayerSection } from '../bspline-frame-builder/b-spline-gen/html/main/photo-layer-section.js';
import { isFormulaField } from '../bspline-frame-builder/b-spline-gen/html/core/formula-field.js';
import { evaluate } from '../bspline-frame-builder/b-spline-gen/html/core/formula.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const $ = (id) => document.getElementById(id);

/** The label text that heads a control: the nearest earlier-sibling <label> walking up from it. */
function labelOf(id) {
  let n = $(id);
  while (n) {
    const p = n.previousElementSibling;
    if (p && p.tagName === 'LABEL') return p.textContent.replace(/\s+/g, ' ').trim();
    n = n.parentElement;
  }
  return null;
}

beforeAll(() => { document.body.innerHTML = BODY; });

describe('LABELS T: renamed labels (display only)', () => {
  it.each([
    ['stampBlur', 'Blur (grid cells)'],
    ['stampSmoothingRadius', 'Smoothing radius (grid cells)'],
    ['stampTextureSuppression', 'Smooth the terrain under it (0–1)'],
    ['brickSuppression', 'Remove bricks (fraction)'],
    ['brickFrameSuppression', 'Crumble (fraction)'],
    ['photoBlur', 'Blur (image px)'],
    ['stampVBitAngle', 'V-Bit Angle (°)'],
    ['stampEdgeFilletRadius', 'Edge Fillet (in)'],
    ['sculptTopRadius', 'Brush Size (in)'],
    ['sculptBotRadius', 'Brush Size (in)'],
    ['thickenOffset', 'Offset (Thickness, in)'],
    ['stampHeight', 'Height (in)'],
  ])('%s is labelled "%s"', (id, text) => {
    expect($(id), `#${id} exists`).toBeTruthy();
    expect(labelOf(id)).toBe(text);
  });

  it('the sidebar Photo mirror says Blur (image px) too', () => {
    const body = document.createElement('div');
    document.body.appendChild(body);
    renderPhotoLayerSection(body);
    const n = body.querySelector('#photo3dBlur');
    expect(n).toBeTruthy();
    let el = n, text = null;
    while (el && !text) { const p = el.previousElementSibling; if (p && p.tagName === 'LABEL') text = p.textContent.trim(); el = el.parentElement; }
    expect(text).toBe('Blur (image px)');
    body.remove();
  });
});

describe('LABELS T: the SVG stamp Relief Raised | Carved toggle writes the signed depth', () => {
  let layer;
  beforeEach(() => {
    document.body.innerHTML = BODY;
    layer = { id: '0', depth: 0.25 };
    window.svgEditor = { _layers: [layer] };
    P.activeLayerIdx = 0;
    P.stampDepth = 0.25;
    // what ui-bindings.js does for the generic P keys: the (hidden) signed stampDepth input drives applyParam -> updateP
    bind('stampDepth', 'number', (v) => updateP('stampDepth', v));
    syncPair('stampDepth', 'stampDepthSlider');
    attachFormulaFields(document);
    const ctx = createStampCtx({});
    initDepth(ctx);
    ctx.broadcastSyncFromLayer();
  });
  const type = (id, v) => { $(id).value = String(v); $(id).dispatchEvent(new Event('input', { bubbles: true })); };

  it('has a Relief toggle right above the Height control, Raised active by default', () => {
    const raised = $('stampBtnReliefRaised'), carved = $('stampBtnReliefCarved');
    expect(raised && carved).toBeTruthy();
    expect(raised.classList.contains('active')).toBe(true);
    expect(carved.classList.contains('active')).toBe(false);
    expect($('stampReliefToggle').nextElementSibling.contains($('stampHeight'))).toBe(true);
  });

  it('Carved + 0.3 -> depth -0.3 (layer + P.stampDepth mirror); the slider shows 0.3', () => {
    $('stampBtnReliefCarved').click();
    type('stampHeight', 0.3);
    expect(layer.depth).toBe(-0.3);
    expect(P.stampDepth).toBe(-0.3);
    expect($('stampHeightSlider').value).toBe('0.3');
    expect($('stampHeight').value).toBe('0.3');
    expect($('stampBtnReliefCarved').classList.contains('active')).toBe(true);
  });

  it('Raised -> +0.3, and flipping the toggle keeps the magnitude', () => {
    $('stampBtnReliefCarved').click();
    type('stampHeight', 0.3);
    $('stampBtnReliefRaised').click();
    expect(layer.depth).toBe(0.3);
    expect(P.stampDepth).toBe(0.3);
    $('stampBtnReliefCarved').click();
    expect(layer.depth).toBe(-0.3);
  });

  it('the slider writes the same signed depth', () => {
    $('stampBtnReliefCarved').click();
    type('stampHeightSlider', 0.5);
    expect(layer.depth).toBe(-0.5);
    expect($('stampHeight').value).toBe('0.5');
  });

  it('formula fields keep working: a formula result is the height, the toggle gives the sign', () => {
    expect(isFormulaField($('stampHeight'))).toBe(true);
    $('stampBtnReliefCarved').click();
    const inp = $('stampHeight');
    inp.value = '0.1*3';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(inp.value).toBe('0.3');
    expect(layer.depth).toBe(-0.3);
    // a name: relief = the magnitude, plunge = the signed depth (unchanged meaning; `height` stays the board's Y)
    const scope = FORMULA_FIELDS.find((f) => f.id === 'stampDepth').scope;
    expect(evaluate('relief * 2', scope)).toEqual({ ok: true, value: 0.6 });
    expect(evaluate('plunge * 2', scope)).toEqual({ ok: true, value: -0.6 });
    // a negative typed / computed height is a magnitude too (no flipping behind the toggle's back)
    inp.value = '0.2-0.5';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    expect(layer.depth).toBe(-0.3);
  });

  it('a saved board loads untouched: the controls follow the layer, nothing is written back', () => {
    layer.depth = -0.4;
    P.stampDepth = -0.4;
    const ctx = createStampCtx({});
    initDepth(ctx);
    ctx.broadcastSyncFromLayer();
    expect(layer.depth).toBe(-0.4);
    expect(P.stampDepth).toBe(-0.4);
    expect($('stampHeight').value).toBe('0.4');
    expect($('stampHeightSlider').value).toBe('0.4');
    expect($('stampBtnReliefCarved').classList.contains('active')).toBe(true);
    expect($('stampBtnReliefRaised').classList.contains('active')).toBe(false);
    layer.depth = 0.7;
    ctx.broadcastSyncFromLayer();
    expect(layer.depth).toBe(0.7);
    expect($('stampBtnReliefRaised').classList.contains('active')).toBe(true);
  });
});
