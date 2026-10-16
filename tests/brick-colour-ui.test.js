/**
 * Brick colours in the panel (seat A 2026-10-15; Fred's answers): a NEW board opens in the Colour look, a SAVED board
 * keeps the Height look (migration 'brick-look-mode'); each element's Colour section lists its roles' colours (a ↺ when
 * the user's own differs) and its own grout colour (an untouched element reads the old board-wide one); the General
 * tab switches the look; the Fusion artwork decal keeps today's look, byte-identical.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({ preloadSetDetail: vi.fn(async () => {}), sampleDetailAtFor: vi.fn(() => undefined) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import { initBrickPanel, setElementColour, setLookMode } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { groutPaintOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { paletteOf, BRICK_SET_COLOURS, ROLE_DEFAULT_COLOURS, PALETTE_STYLE_ID, BRICK_PALETTE_CHANGED } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/palette.js';
import { decalDrapeSvg } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/decal-png.js';
import { buildDrapeSvg } from '../bspline-frame-builder/b-spline-gen/html/core/preview/drape-svg.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button><button id="editorDrawerTab-layers">Brick</button>
  <div id="editorToolbarBrick"></div><div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;"></div>
  <div id="brickFramePresetRow"><div id="brickFramePresetList"></div></div>
  <div id="brickBrushPresetList"></div><div id="brickPatternList"></div>
  <label id="brickFrameBandPatternLabel">Band patterns</label><div id="brickFrameBandPatternList"></div>
  <div id="brickSetRow"></div>
  <div id="brickSizeBlock"><label id="brickSizeLabel">Brick size (in)</label>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <div id="brickSizePresetList"></div></div>
  <div id="brickGroutWidthRow"><label id="brickGroutWidthLabel">Joint width (in)</label><input id="brickGroutWidth"></div>
  <div id="brickGroutDepthRow"><button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <label id="brickGroutDepthLabel">Joint depth (in)</label><input id="brickGroutDepth"></div>
  <div id="brickLookModeRow"><button id="brickLook_colour"></button><button id="brickLook_height"></button></div>
  <div id="brickColourRow"></div>
  <div id="brickGroutPaintRow"><span id="brickGroutPaintLabel"></span><span id="brickGroutPaintScope"></span><button id="brickGroutColorSwatch"></button>
  <button id="brickGroutColorNone"></button><input id="brickGroutEdge"></div>
  <div id="brickQuickSettings"></div>
  <div id="brickSidebarNoBricks" style="display:none;"></div><div id="brickStartHint" style="display:none;"></div>
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;
const $ = (id) => document.getElementById(id);
let root;
function setup() {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [] };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.lookMode = 'colour';
  P.brickSettings.colourByElement = { wall: {}, frame: {}, brush: {} };
  P.brickSettings.frameBandPreset = 'greek_key_mosaic';
  P.brickSettings.groutPaint = { color: '#cfc6b4', paintInsetIn: 0 };
  P.brickSettings.groutPaintByElement = { wall: null, frame: null, brush: null };
  initBrickPanel();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });
const swatches = () => [...$('brickColourRow').querySelectorAll('[id^=brickColour_]')].map((b) => b.id.replace('brickColour_', ''));

describe('the look: new boards in Colour, saved boards in Height', () => {
  it('a new board’s defaults are the Colour look with no colours of its own', () => {
    expect(DEFAULT.brickSettings.lookMode).toBe('colour');
    expect(DEFAULT.brickSettings.colourByElement).toEqual({ wall: {}, frame: {}, brush: {} });
  });
  it('a saved board without the key keeps the Height look; one that has it keeps its own', () => {
    const saved = { brickSettings: { pattern: 'stretcher' } };
    runMigrations(saved);
    expect(saved.brickSettings.lookMode).toBe('height');
    const chosen = { brickSettings: { lookMode: 'colour' } };
    runMigrations(chosen);
    expect(chosen.brickSettings.lookMode).toBe('colour');
  });
});

describe('the panel', () => {
  it('General’s switch sets the look, repaints the 2D rules and asks the 3D drape to repaint', () => {
    setup();
    const heard = vi.fn();
    document.addEventListener(BRICK_PALETTE_CHANGED, heard);
    $('brickLook_height').click();
    expect(P.brickSettings.lookMode).toBe('height');
    expect($('brickLook_height').classList.contains('active')).toBe(true);
    expect($(PALETTE_STYLE_ID)?.textContent || '').toBe('');
    setLookMode('colour');
    expect($(PALETTE_STYLE_ID).textContent).toContain('[data-brick="wall"][data-brick-role="field"]');
    expect(heard).toHaveBeenCalledTimes(2);
    document.removeEventListener(BRICK_PALETTE_CHANGED, heard);
  });

  it('each element’s Colour section lists its roles in its palette’s colours (the Greek key’s green / white)', () => {
    setup();
    expect(swatches()).toEqual(['field', 'accent']); // the Wall (the default tool)
    $('brickTool_frame').click();
    expect(swatches()).toEqual(['field', 'motif', 'accent', 'stone']);
    expect($('brickColour_motif').title).toContain('#3f8f72');
    expect($('brickColour_field').title).toContain('#f2efe6');
  });

  it('a colour of the user’s own: that element only, with a ↺ back to the default', () => {
    setup();
    $('brickTool_frame').click();
    expect($('brickColourReset_motif')).toBeNull();
    setElementColour('frame', 'motif', '#112233');
    expect(paletteOf(P.brickSettings, 'frame').motif).toBe('#112233');
    expect(paletteOf(P.brickSettings, 'wall').motif).toBe(ROLE_DEFAULT_COLOURS.motif);
    expect($(PALETTE_STYLE_ID).textContent).toContain('[data-brick="frame"][data-brick-role="motif"]{fill:#112233 !important}');
    $('brickColourReset_motif').click();
    expect(paletteOf(P.brickSettings, 'frame').motif).toBe('#3f8f72');
    expect($('brickColourReset_motif')).toBeNull();
    expect(setElementColour('frame', 'motif', 'not-a-colour')).toBe(false);
  });

  it('the grout colour is the active element’s own; an untouched element reads the board-wide one', () => {
    setup();
    expect(groutPaintOf(P.brickSettings, 'frame').color).toBe('#cfc6b4'); // the old global: the fallback
    $('brickTool_frame').click();
    expect($('brickGroutPaintScope').textContent).toContain('Brick frame');
    expect($('brickGroutPaintLabel').textContent).toBe('Grout'); // not "Colour" under the Colour header (advisor 2026-10-15)
  });
});

describe('the Fusion decal keeps today’s look', () => {
  it('its drape SVG is byte-identical to a board drawn without roles, and carries no palette', () => {
    const roles = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 9" width="7" height="9">'
      + '<polygon data-layer="1" data-brick="wall" data-brick-role="field" fill="#808080" points="0,0 1,0 1,1"/>'
      + '<polygon data-layer="1" data-brick="frame" data-brick-role="motif" fill="#909090" points="2,0 3,0 3,1"/></svg>';
    const before = roles.replace(/ data-brick-role="[a-z]*"/g, '');
    const layers = [{ id: '1', visible: true, showColor: true }];
    expect(decalDrapeSvg(layers, roles)).toBe(buildDrapeSvg(layers, before));
    expect(decalDrapeSvg(layers, roles)).not.toContain('<style>');
    expect(BRICK_SET_COLOURS[1]).toBe('#a5432e'); // Red brick reads red (Fred, fork 3)
  });
});
