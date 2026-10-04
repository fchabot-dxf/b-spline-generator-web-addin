/**
 * main/brick-panel.js — F35 item 1: the Brick tab's UI wiring. A declared
 * tool list (BRICK_TOOLS below) + a set picker + the common controls every
 * tool shares (Scale/Grout/Relief/Height/Suppression/Clumping/Seed), all
 * reading/writing the ONE shared `P.brickSettings` (core/state.js).
 *
 * This is the "main/" glue layer specifically because editor/ files never
 * import core/state.js directly (an existing, deliberate boundary — the
 * editor stays reusable/standalone; main/*-panel.js modules are the only
 * things that bridge app state to editor behavior). `editor._brickSettings`
 * is set to the SAME object as `P.brickSettings` (mutated in place by this
 * panel's own sliders, never replaced) right before arming the Brush mode,
 * so brickBrushHandler.finish() always reads live values with no re-sync.
 *
 * `window.svgEditor` (app-init.js) is created LAZILY, the first time the
 * SVG editor modal opens — it does NOT exist yet when this panel's own
 * initBrickPanel() runs at app start. Every tool action below reads
 * `window.svgEditor` fresh at the point of use instead of caching it.
 */
import { P, saveLastSession } from '../core/state.js';
import { runBricks, primitivesToPolyline } from '../editor/editor-brick-tool.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { frameContourSilhouette } from '../editor/contour-from-frame.js';
import { FRAME_PRESETS } from '../core/bricks/library.js';
import { applyParam } from './param-manager.js';

/** The declared tool list (Fred's own UI lock: "a declared tool list
 * [{id,label,icon,settingsSection,engineEntry}]... more tools added as data
 * entries plus their engine function, no UI rework"). `settingsSection` is
 * reserved for a future per-tool settings block (Wall's zones, Frame's band
 * picker) -- null for now, every tool uses only the common controls below.
 * `run` is this file's own entry point for that tool (not re-exported --
 * core/bricks/ itself stays engine-agnostic of "how a UI triggers it"). */
const BRICK_TOOLS = [
  { id: 'brush', label: 'Brush', icon: '✏️', settingsSection: null,
    hint: 'Click here, then drag a stroke on the canvas to lay bricks along it.' },
  { id: 'wall', label: 'Wall', icon: '🧱', settingsSection: null,
    hint: 'Fills the whole board with bricks.' },
  { id: 'frame', label: 'Frame', icon: '🖼️', settingsSection: null,
    hint: 'Bands of bricks along the current frame\'s own contour.' },
  // F35 item 3: arm the EXISTING, unmodified editor cut/stripe modes --
  // a Brush stroke's own spine is a plain <line> chain, already isCuttable
  // (editor-cut-tool.js) with zero changes needed there. Only applies to
  // Brush strokes today (Wall/Frame have no drawn spine to tap -- see
  // editor-brick-tool.js's own header on why that's a deliberate scope,
  // not an oversight).
  { id: 'scissors', label: 'Scissors', icon: '✂️', settingsSection: null,
    hint: 'Tap a brush stroke to split it -- each piece regenerates its own bricks independently once moved apart.' },
  { id: 'stripe', label: 'Stripe', icon: '📏', settingsSection: null,
    hint: 'Tap a brush stroke to split it into alternating brick-style runs.' },
];

let _activeTool = null;

function notifyChange() { saveLastSession(); }

function syncSetPicker() {
  document.getElementById('brickSetRed')?.classList.toggle('active', P.brickSettings.setId === 1);
}

function setGroutProfile(profile) {
  P.brickSettings.grout.profile = profile;
  document.getElementById('brickBtnGroutRecessed')?.classList.toggle('active', profile === 'recessed');
  document.getElementById('brickBtnGroutFlush')?.classList.toggle('active', profile === 'flush');
  notifyChange();
}

function syncReliefToggle() {
  const inverted = !!P.brickSettings.invert;
  document.getElementById('brickBtnReliefRaised')?.classList.toggle('active', !inverted);
  document.getElementById('brickBtnReliefCarved')?.classList.toggle('active', inverted);
}

function setInvert(on) {
  P.brickSettings.invert = on;
  syncReliefToggle();
  notifyChange();
}

function setPair(sliderId, numberId, v) {
  const s = document.getElementById(sliderId);
  const n = document.getElementById(numberId);
  if (s) s.value = String(v);
  if (n) n.value = String(v);
}

/** Reflect P.brickSettings' current values onto every control -- needed on
 *  init and whenever a saved session restores different values. */
function syncControlsFromState() {
  const s = P.brickSettings;
  syncSetPicker();
  setPair('brickScaleSlider', 'brickScale', s.scale);
  document.getElementById('brickGroutWidth').value = s.grout.widthIn;
  document.getElementById('brickGroutDepth').value = s.grout.depthIn;
  document.getElementById('brickBtnGroutRecessed')?.classList.toggle('active', s.grout.profile === 'recessed');
  document.getElementById('brickBtnGroutFlush')?.classList.toggle('active', s.grout.profile === 'flush');
  syncReliefToggle();
  setPair('brickReliefHeightSlider', 'brickReliefHeight', s.reliefIn);
  setPair('brickSuppressionSlider', 'brickSuppression', s.suppression);
  setPair('brickClumpingSlider', 'brickClumping', s.clumping);
  document.getElementById('brickSeed').value = s.seed;
}

function bindSlider(sliderId, numberId, key, parse = parseFloat) {
  const slider = document.getElementById(sliderId);
  const number = document.getElementById(numberId);
  const apply = (raw) => {
    const v = parse(raw);
    if (!Number.isFinite(v)) return;
    if (slider) slider.value = String(v);
    if (number) number.value = String(v);
    P.brickSettings[key] = v;
    notifyChange();
  };
  slider?.addEventListener('input', (e) => apply(e.target.value));
  number?.addEventListener('input', (e) => apply(e.target.value));
}

function bindGroutField(id, key) {
  document.getElementById(id)?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    P.brickSettings.grout[key] = v;
    notifyChange();
  });
}

function renderToolList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const tool of BRICK_TOOLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn';
    btn.id = `brickTool_${tool.id}`;
    btn.textContent = `${tool.icon} ${tool.label}`;
    btn.addEventListener('click', () => selectTool(tool.id));
    container.appendChild(btn);
  }
}

function syncToolButtons() {
  for (const tool of BRICK_TOOLS) {
    document.getElementById(`brickTool_${tool.id}`)?.classList.toggle('active', tool.id === _activeTool);
  }
  const hint = BRICK_TOOLS.find((t) => t.id === _activeTool);
  const hintEl = document.getElementById('brickToolHint');
  if (hintEl) hintEl.textContent = hint ? hint.hint : '';
}

/** Brush arms interactive stroke drawing (editor._currentMode =
 *  'brickBrush', editor-interaction.js's own mode dispatch); Wall/Frame are
 *  immediate button-driven actions -- there's no "mode" to arm for them, so
 *  selecting them just runs the tool right away and leaves the editor's own
 *  mode untouched (whatever the user was already doing, e.g. Select, stays
 *  active -- Wall/Frame don't need to claim the pointer). */
function selectTool(id) {
  _activeTool = id;
  syncToolButtons();
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) {
    console.warn('Brick tool: open the SVG editor first (Edit Artwork) -- no editor instance yet.');
    return;
  }
  if (id === 'brush') {
    editor._brickSettings = P.brickSettings; // same object, mutated in place -- see header
    editor.setMode('brickBrush');
    return;
  }
  if (id === 'wall') {
    // Advisor review (turn 131): Wall must respect an EXISTING frame's own
    // interior, not just fill the raw board -- resolve the frame the same
    // way the Frame tool does; runBricks clips Wall to it via generateBricks
    // when one is usable, and simply fills the whole board when there isn't.
    runBricks(editor, P.brickSettings, resolveFrameGeom(editor));
    notifyChange();
    return;
  }
  if (id === 'frame') {
    const frameGeom = resolveFrameGeom(editor);
    if (!frameGeom) {
      console.warn('Brick Frame tool: no usable frame contour on this board.');
      return;
    }
    runBricks(editor, P.brickSettings, frameGeom);
    notifyChange();
    return;
  }
  if (id === 'scissors') {
    // The EXISTING, unmodified Cut mode (editor-interaction.js's own
    // modeHandlers table) -- a brush spine's plain <line> segments are
    // already isCuttable, so this needs no brick-specific mode at all.
    editor.setMode('cut');
    return;
  }
  if (id === 'stripe') {
    // Same reuse, for the existing Stripe mode. editor-brick-tool.js's own
    // regenerateOwnedBrickElements reacts to the resulting STRIPE_ATTR-
    // tagged pieces on the next commit, cycling each its own brick style.
    editor.setMode('stripe');
    return;
  }
}

/** The current frame's own contour, as `{path, cornerIndices, bands}` for
 *  generateBricks/bricksContourBands -- or null when no real frame resolves
 *  (no template selected, or the offset is degenerate). `sil.corners` (NOT
 *  every primitive boundary) is passed through to primitivesToPolyline --
 *  see that function's own header for why marking every boundary broke
 *  curved runs (advisor review, turn 131). */
function resolveFrameGeom(editor) {
  const ctx = frameContext(editor);
  const sil = ctx ? frameContourSilhouette(ctx, 0, 0) : { error: 'noFrame' };
  if (sil.error) return null;
  const { points, cornerIndices } = primitivesToPolyline(sil.primitives, sil.corners);
  return { path: points, cornerIndices, bands: FRAME_PRESETS.single_soldier };
}

// Advisor review (turn 131, round 2): a grout groove needs the terrain's own
// mesh to sample it at least 2-3 times across, or it reads as a blur rather
// than a visible line -- a 0.06in groove needs P.spacing <= ~0.02in, well
// finer than this app's own 0.05in default (tuned for smooth terrain, not
// brick-scale features). Only TIGHTENS spacing (never loosens a user's own
// already-finer setting), and only when real brick content actually exists
// (editor-brick-tool.js's own 'bricksGenerated' event) -- not a blanket
// global default change for users who never touch the Brick tab.
const SAMPLES_ACROSS_GROUT = 3;

function ensureFineEnoughMesh(groutWidthIn) {
  if (!(groutWidthIn > 0)) return;
  const targetSpacing = groutWidthIn / SAMPLES_ACROSS_GROUT;
  if (P.spacing > targetSpacing) {
    applyParam('spacing', targetSpacing);
  }
}

export function initBrickPanel() {
  document.addEventListener('bricksGenerated', (e) => ensureFineEnoughMesh(e.detail?.groutWidthIn));

  renderToolList(document.getElementById('brickToolList'));
  syncToolButtons();

  document.getElementById('brickSetRed')?.addEventListener('click', () => {
    P.brickSettings.setId = 1;
    syncSetPicker();
    notifyChange();
  });

  bindSlider('brickScaleSlider', 'brickScale', 'scale');
  bindGroutField('brickGroutWidth', 'widthIn');
  bindGroutField('brickGroutDepth', 'depthIn');
  document.getElementById('brickBtnGroutRecessed')?.addEventListener('click', () => setGroutProfile('recessed'));
  document.getElementById('brickBtnGroutFlush')?.addEventListener('click', () => setGroutProfile('flush'));
  document.getElementById('brickBtnReliefRaised')?.addEventListener('click', () => setInvert(false));
  document.getElementById('brickBtnReliefCarved')?.addEventListener('click', () => setInvert(true));
  bindSlider('brickReliefHeightSlider', 'brickReliefHeight', 'reliefIn');
  bindSlider('brickSuppressionSlider', 'brickSuppression', 'suppression');
  bindSlider('brickClumpingSlider', 'brickClumping', 'clumping');
  document.getElementById('brickSeed')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    P.brickSettings.seed = v;
    notifyChange();
  });
  document.getElementById('brickBtnRandomSeed')?.addEventListener('click', () => {
    const v = Math.floor(Math.random() * 1000000);
    P.brickSettings.seed = v;
    document.getElementById('brickSeed').value = v;
    notifyChange();
  });

  syncControlsFromState();
}
