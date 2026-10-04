/**
 * Turn 195 (advisor, "one contextual panel"): main/editor-tabs.js EDITOR_TABS `modeHosts` declares which
 * panel a mode's settings open in, per tab. In the Brick tab the Stripe settings live INSIDE the Brick
 * panel (#brickStripeSection); everywhere else they stay in Artwork's own #editorStripePanel, which then
 * shows only while it holds them (editor-ui.js TOOLBAR_GROUPS).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setEditorTab, EDITOR_TABS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { TOOLBAR_GROUPS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `
    <aside id="editorStripePanel"><div id="editorStripePanelBody"><input id="stripeCount"></div></aside>
    <aside id="editorBrickPanel"><div id="brickStripeSection"></div></aside>
    <aside id="editorLayersPanel"></aside>`;
  document.body.appendChild(root);
  window.svgEditor = { _currentMode: 'stripe' };
});
afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; });
const $ = (id) => document.getElementById(id);

describe('EDITOR_TABS modeHosts', () => {
  it('declared on the Brick tab for stripe only', () => {
    expect(EDITOR_TABS.find((t) => t.id === 'brick').modeHosts.stripe).toEqual(
      { content: 'editorStripePanelBody', host: 'brickStripeSection', panel: 'editorStripePanel' });
    expect(EDITOR_TABS.find((t) => t.id === 'artwork').modeHosts).toBeUndefined();
  });
  it('Brick tab: the stripe settings move into the Brick panel and the side panel hides', () => {
    setEditorTab('brick');
    expect($('brickStripeSection').contains($('stripeCount'))).toBe(true);
    expect($('editorStripePanel').classList.contains('hidden')).toBe(true);
    expect(TOOLBAR_GROUPS.editorStripePanel('stripe', null, 'stripe')).toBe(false);
  });
  it('back to Artwork: the settings go home and the side panel shows again in stripe mode', () => {
    setEditorTab('brick');
    setEditorTab('artwork');
    expect($('editorStripePanel').contains($('stripeCount'))).toBe(true);
    expect($('editorStripePanel').classList.contains('hidden')).toBe(false);
    expect(TOOLBAR_GROUPS.editorStripePanel('stripe', null, 'stripe')).toBe(true);
  });
});
