/**
 * F32 item 1: the Stripe tool's panel (#editorStripePanel, properties-stripe.js) colour-preset chips. The tool
 * logic itself (STRIPE_COLOR_PRESETS, applyStripeColorPreset) is tested in editor-stripe-tool.test.js; this file
 * covers the PANEL wiring -- one chip rendered per declared preset, and a tap applying it through the real DOM.
 * Minimal hand-written fixture matching the real panel's own IDs (same convention as
 * tests/properties-shape-lattice.test.js's own fixtureHTML).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initStripeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-stripe.js';
import { STRIPE_COLOR_PRESETS, stripeSettings } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-stripe-tool.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function fixtureHTML() {
  return `
    <div role="group">
      <button id="stripeByCount" class="editor-fillmode-btn active"></button>
      <button id="stripeByLength" class="editor-fillmode-btn"></button>
    </div>
    <div id="stripeCountRow"><input id="stripeCount" type="number" min="1" step="1" value="5"></div>
    <div id="stripeLengthRow" style="display:none"><input id="stripeLength" type="number" min="0" step="0.05"></div>
    <label><input id="stripeThree" type="checkbox"></label>
    <button id="stripeColorsReset" type="button"></button>
    <div id="stripeColorPresets"></div>
    <button id="stripeColorA" type="button"></button>
    <button id="stripeColorB" type="button"></button>
    <button id="stripeColorC" type="button"></button>
  `;
}

let container, editor;
beforeEach(() => {
  container = document.createElement('div');
  container.innerHTML = fixtureHTML();
  document.body.appendChild(container);
  editor = {};
});
afterEach(() => {
  container.remove();
  document.querySelectorAll('.color-mosaic-popover').forEach((p) => p.remove());
});

describe('F32 item 1: preset chips, rendered from the declared list', () => {
  it('renders exactly one chip per STRIPE_COLOR_PRESETS entry, no more, no fewer', () => {
    initStripeProperties(editor);
    const chips = document.getElementById('stripeColorPresets').children;
    expect(chips.length).toBe(STRIPE_COLOR_PRESETS.length);
    expect([...chips].map((c) => c.title)).toEqual(STRIPE_COLOR_PRESETS.map((p) => p.name));
  });

  it('tapping the Black/White chip sets Colour A/B through the panel, clears C, turns Use C off -- one call', () => {
    initStripeProperties(editor);
    document.getElementById('stripeThree').checked = true;
    const s = stripeSettings(editor);
    s.colors = ['#remnant', '#remnant', '#remnant'];
    s.three = true;
    const chips = document.getElementById('stripeColorPresets').children;
    const blackWhiteChip = [...chips].find((c) => c.title === 'Black / White');
    blackWhiteChip.click();
    expect(s.colors).toEqual(['#000000', '#ffffff', null]);
    expect(s.three).toBe(false);
    // the panel's own swatches reflect it immediately (paintSwatches ran as part of the same click)
    expect(document.getElementById('stripeColorA').style.background).toBe('#000000');
    expect(document.getElementById('stripeThree').checked).toBe(false);
  });

  it('tapping the Blue/White chip uses the lattice\'s own node blue, not a retyped hex', () => {
    initStripeProperties(editor);
    const s = stripeSettings(editor);
    const chips = document.getElementById('stripeColorPresets').children;
    const blueWhiteChip = [...chips].find((c) => c.title === 'Blue / White');
    blueWhiteChip.click();
    expect(s.colors[0]).toBe(PATTERN_DEFAULTS.colors.nodes);
    expect(s.colors[1]).toBe('#ffffff');
  });
});
