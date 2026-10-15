/**
 * The header buttons' faces, declared (Fred 2026-10-15): on a phone the Send button is ICON ONLY -- its label
 * "Send to Fusion" read "d to Fu" in the 36 px phone button (measured, headless Chrome at 390 px in Fusion mode); the
 * desktop keeps the label. core/header-faces.js HEADER_BUTTON_FACES declares label / title / phoneIcon per host mode;
 * one phone rule shows a declared icon instead of the label. A busy text rewrites the label only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEADER_BUTTON_FACES, FACE_CLASSES, applyHeaderFace } from '../bspline-frame-builder/b-spline-gen/html/core/header-faces.js';
import { setFusionActionState } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');
const PHONE_BLOCK = HTML.slice(HTML.indexOf('@media (max-width: 600px), (pointer: coarse) {'));
const PHONE_BUTTON_PX = Number(/--cad-navbar-touch: (\d+)px/.exec(PHONE_BLOCK)[1]);
const $ = (id) => document.getElementById(id);

describe('the Send button faces', () => {
  beforeEach(() => { document.body.innerHTML = '<nav class="cad-navbar"><button id="btnDownload">STEP</button></nav>'; });

  it('Fusion: the full label and a phone icon; the website: STEP, no icon', () => {
    expect(HEADER_BUTTON_FACES.btnDownload.fusion).toMatchObject({ label: 'Send to Fusion' });
    expect(HEADER_BUTTON_FACES.btnDownload.fusion.phoneIcon).toMatch(/^<svg /);
    expect(HEADER_BUTTON_FACES.btnDownload.web).toMatchObject({ label: 'STEP', phoneIcon: null });
  });

  it('the phone icon fits the phone button (no clipping at 390 px)', () => {
    const w = Number(/width="(\d+)"/.exec(HEADER_BUTTON_FACES.btnDownload.fusion.phoneIcon)[1]);
    expect(PHONE_BUTTON_PX).toBe(36);
    expect(w).toBeLessThanOrEqual(PHONE_BUTTON_PX - 12); // the phone rule takes the padding to 0; 6 px clear each side
  });

  it('rendered: a label span and an icon span, the button marked for the phone rule', () => {
    applyHeaderFace($('btnDownload'), 'fusion');
    const b = $('btnDownload');
    expect(b.querySelector(`.${FACE_CLASSES.label}`).textContent).toBe('Send to Fusion');
    expect(b.querySelector(`.${FACE_CLASSES.icon} svg`)).not.toBeNull();
    expect(b.classList.contains(FACE_CLASSES.hasPhoneIcon)).toBe(true);
    expect([b.title, b.getAttribute('aria-label')]).toEqual(['Send to Fusion', 'Send to Fusion']);
    applyHeaderFace(b, 'web');
    expect(b.textContent).toBe('STEP');
    expect(b.classList.contains(FACE_CLASSES.hasPhoneIcon)).toBe(false);
  });

  it('a busy text rewrites the label and keeps the icon', () => {
    applyHeaderFace($('btnDownload'), 'fusion');
    setFusionActionState('Baking...', true);
    const b = $('btnDownload');
    expect(b.querySelector(`.${FACE_CLASSES.label}`).textContent).toBe('Baking...');
    expect(b.querySelector(`.${FACE_CLASSES.icon} svg`)).not.toBeNull();
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('Baking...');
  });

  it('one phone rule shows a declared icon instead of the label; outside the phone the icon is hidden', () => {
    const phone = PHONE_BLOCK.slice(0, PHONE_BLOCK.indexOf('\n    }\n'));
    expect(phone).toMatch(/\.cad-navbar \.cad-nav-has-phone-icon \.cad-nav-face-label \{ display: none !important; \}/);
    expect(phone).toMatch(/\.cad-navbar \.cad-nav-has-phone-icon \.cad-nav-face-icon \{ display: inline-flex !important; \}/);
    expect(CSS).toMatch(/\.cad-navbar \.cad-nav-face-icon \{ display: none;/);
    expect(HTML).not.toMatch(/#btnDownload[^{]*\{[^}]*content:/); // a declared face, not a CSS-content hack
  });
});
