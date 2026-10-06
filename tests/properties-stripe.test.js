/**
 * F32 item 1: the Stripe tool's panel (#editorStripePanel, properties-stripe.js) colour-preset chips. The tool
 * logic itself (STRIPE_COLOR_PRESETS, applyStripeColorPreset) is tested in editor-stripe-tool.test.js; this file
 * covers the PANEL wiring -- one chip rendered per declared preset, and a tap applying it through the real DOM.
 * Minimal hand-written fixture matching the real panel's own IDs (same convention as
 * tests/properties-shape-lattice.test.js's own fixtureHTML).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initStripeProperties } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-stripe.js';
import { STRIPE_COLOR_PRESETS, STRIPE_PATTERNS, stripeSettings } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-stripe-tool.js';
import { UNDO_PARTS } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function fixtureHTML() {
  return `
    <div role="group">
      <button id="stripeByCount" class="editor-fillmode-btn active"></button>
      <button id="stripeByLength" class="editor-fillmode-btn"></button>
    </div>
    <div id="stripeCountRow"><input id="stripeCount" type="number" min="1" step="1" value="5"></div>
    <div id="stripeLengthRow" style="display:none"><input id="stripeLength" type="number" min="0" step="0.05"></div>
    <div id="stripePatternPresets"></div>
    <input id="stripePatternRatio" type="text">
    <div id="stripePatternClampNote" style="display:none"></div>
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

describe('F32 item 2: dash-ratio pattern chips, ratio field, clamp note', () => {
  it('renders exactly one chip per STRIPE_PATTERNS entry, titled with its ratio', () => {
    initStripeProperties(editor);
    const chips = document.getElementById('stripePatternPresets').children;
    expect(chips.length).toBe(STRIPE_PATTERNS.length);
    expect([...chips].map((c) => c.textContent)).toEqual(STRIPE_PATTERNS.map((p) => p.name));
    expect([...chips].map((c) => c.title)).toEqual(STRIPE_PATTERNS.map((p) => p.ratio.join(':')));
  });

  it('tapping the Dash chip sets settings.ratio and reflects it in the Ratio field', () => {
    initStripeProperties(editor);
    const s = stripeSettings(editor);
    const chips = document.getElementById('stripePatternPresets').children;
    [...chips].find((c) => c.textContent === 'Dash').click();
    expect(s.ratio).toEqual([3, 1]);
    expect(document.getElementById('stripePatternRatio').value).toBe('3:1');
  });

  it('typing a custom ratio applies it on change; invalid text leaves the current ratio alone', () => {
    initStripeProperties(editor);
    const s = stripeSettings(editor);
    const ratioEl = document.getElementById('stripePatternRatio');
    ratioEl.value = '2:3:2';
    ratioEl.dispatchEvent(new Event('change'));
    expect(s.ratio).toEqual([2, 3, 2]);
    ratioEl.value = 'nonsense';
    ratioEl.dispatchEvent(new Event('change'));
    expect(s.ratio).toEqual([2, 3, 2]); // unchanged, not clobbered
  });

  it('the clamp note shows only when the hovered plan reports clamped, scoped to this editor', () => {
    initStripeProperties(editor);
    const note = document.getElementById('stripePatternClampNote');
    expect(note.style.display).toBe('none');
    document.dispatchEvent(new CustomEvent('editorStripeTarget', { detail: { editor, plan: { clamped: true } } }));
    expect(note.style.display).toBe('block');
    document.dispatchEvent(new CustomEvent('editorStripeTarget', { detail: { editor, plan: { clamped: false } } }));
    expect(note.style.display).toBe('none');
    document.dispatchEvent(new CustomEvent('editorStripeTarget', { detail: { editor: {}, plan: { clamped: true } } }));
    expect(note.style.display).toBe('none'); // a different editor's event is ignored
  });
});

// item 73 (seat D's editor audit: Stripe count / by-length / by-count took no undo step -- Undo took back the previous
// canvas edit and left them): each panel change is ONE settings-only step, and the settings ride in the undo entry
describe('item 73: the Stripe tool settings are undoable', () => {
  const editorWithStack = () => { const ed = { pushState: vi.fn(), _notifyChange: vi.fn() }; return ed; };
  it('by length / a typed count / a count stepper (input + change) = one push each; typing alone pushes none', () => {
    const ed = editorWithStack();
    initStripeProperties(ed);
    document.getElementById('stripeByLength').click();
    expect(ed.pushState).toHaveBeenCalledTimes(1);
    const count = document.getElementById('stripeCount');
    count.value = '7'; count.dispatchEvent(new Event('input'));
    expect(ed.pushState).toHaveBeenCalledTimes(1); // a keystroke is not a step
    count.dispatchEvent(new Event('change'));
    expect(ed.pushState).toHaveBeenCalledTimes(2);
  });
  it('the undo part takes the settings and puts them back, with the panel', () => {
    const ed = editorWithStack();
    initStripeProperties(ed);
    const part = UNDO_PARTS.get('stripeSettings');
    const before = part.take();
    document.getElementById('stripeByLength').click();
    expect(stripeSettings(ed).drive).toBe('length');
    part.restore(before);
    expect(stripeSettings(ed).drive).toBe(before.drive);
    expect(document.getElementById('stripeByCount').classList.contains('active')).toBe(before.drive !== 'length');
  });
});

