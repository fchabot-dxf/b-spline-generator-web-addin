/**
 * Fred's stated brick defaults (2026-10-07): a new board's bricks are FLAT and its grout RECESSED. core/state.js declares
 * both (brickTopMode 'flat', grout.profile 'recessed'); the palette markup marks the other button active (Organic, Flush),
 * so the sidebar shows the defaults only because initBrickPanel syncs the buttons from state. The REAL palette body (no
 * scripts), a fresh state (no saved session), only the engine mocked.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));

import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const active = (id) => document.getElementById(id).classList.contains('active');

beforeAll(() => {
  localStorage.clear();
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  window.svgEditor = null;
  initBrickPanel();
});

describe('fresh boot: the sidebar shows the declared brick defaults', () => {
  it('grout is Recessed: Recessed active, Flush not', () => {
    expect(P.brickSettings.grout.profile).toBe('recessed');
    expect(active('brickBtnGroutRecessed')).toBe(true);
    expect(active('brickBtnGroutFlush')).toBe(false);
  });
  it('brick top is Flat: Flat active, Organic not', () => {
    expect(P.brickSettings.brickTopMode).toBe('flat');
    expect(active('brickBtnTopFlat')).toBe(true);
    expect(active('brickBtnTopOrganic')).toBe(false);
  });
});
