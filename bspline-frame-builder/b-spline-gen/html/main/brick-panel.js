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
import { P, saveLastSession, RESOLUTIONS, effectiveExportSpacing } from '../core/state.js';
import { withLoadingStage } from '../core/loading-signal.js';
import { runBricks, runBricksPreview, runBricksOutlinePreview, buildRibbonPrimitives } from '../editor/editor-brick-tool.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { frameContourSilhouette } from '../editor/contour-from-frame.js';
import { FRAME_PRESETS, BRICK_PATTERNS, brickSetById } from '../core/bricks/library.js';
import { setEditorTab, getEditorTab } from './editor-tabs.js';
import { renderToolRegistry, syncToolRegistryButtons } from '../editor/editor-tool-registry.js';

/** The declared tool list (Fred's own UI lock: "a declared tool list
 * [{id,label,icon,settingsSection,engineEntry}]... more tools added as data
 * entries plus their engine function, no UI rework"). `settingsSection` names
 * the DOM id of that tool's own settings block, shown ONLY while it's the
 * active tool (syncToolSections, below) -- null for a tool with none of its
 * own (Scissors/Stripe act on an existing stroke, no settings to show).
 * F35 item 16 follow-up (Fred, live use: "shows every section at once, can't
 * tell what applies"): Brush was the only consumer when this field was first
 * declared (a direct `_activeTool === 'brush'` check, not worth generalizing
 * for one); Wall and Frame needing the exact same treatment is the 3rd
 * consumer that justifies the declared table this always meant to become.
 * `run` is this file's own entry point for that tool (not re-exported --
 * core/bricks/ itself stays engine-agnostic of "how a UI triggers it"). */
const BRICK_TOOLS = [
  { id: 'brush', buttonId: 'brickTool_brush', label: 'Brush', icon: '✏️', settingsSection: 'brickBrushSection',
    hint: 'Click here, then drag a stroke on the canvas to lay bricks along it.' },
  { id: 'wall', buttonId: 'brickTool_wall', label: 'Wall', icon: '🧱', settingsSection: 'brickWallSection',
    hint: 'Fills the whole board with bricks.' },
  { id: 'frame', buttonId: 'brickTool_frame', label: 'Frame', icon: '⬚', settingsSection: 'brickFrameSection',
    hint: 'Bands of bricks along the current frame\'s own contour.' },
  // F35 item 3: arm the EXISTING, unmodified editor cut/stripe modes --
  // a Brush stroke's own spine is a plain <line> chain, already isCuttable
  // (editor-cut-tool.js) with zero changes needed there. Only applies to
  // Brush strokes today (Wall/Frame have no drawn spine to tap -- see
  // editor-brick-tool.js's own header on why that's a deliberate scope,
  // not an oversight).
  { id: 'scissors', buttonId: 'brickTool_scissors', label: 'Scissors', icon: '✂️', settingsSection: null,
    hint: 'Tap a brush stroke to split it -- each piece regenerates its own bricks independently once moved apart.' },
  { id: 'stripe', buttonId: 'brickTool_stripe', label: 'Stripe', icon: '📏', settingsSection: null,
    hint: 'Tap a brush stroke to split it into alternating brick-style runs.' },
];

let _activeTool = null;

function notifyChange() { saveLastSession(); }

function syncSetPicker() {
  document.getElementById('brickSetRed')?.classList.toggle('active', P.brickSettings.setId === 1);
  document.getElementById('brickSetWhite')?.classList.toggle('active', P.brickSettings.setId === 3);
}

/** Switching sets also resets the grout WIDTH field to that set's own
 *  declared default (Set 3's own fieldstone joints are genuinely wider,
 *  0.12in vs Set 1's measured 0.06in) -- otherwise the slider would silently
 *  keep showing/using the PREVIOUS set's own width after a switch, which
 *  `toBrickOpts` always applies verbatim regardless of which set is active.
 *  F35 item 16: brickLengthIn is now a GLOBAL, absolute real-world size --
 *  deliberately NOT reset here (unlike the old Frame-only frameBrickLengthIn
 *  it replaced, which WAS force-synced to the new set on every switch): a
 *  user who picked "2 inch bricks" means 2 inches regardless of which photo
 *  texture is applied, the same way Wall/Brush's own old relative Scale
 *  multiplier never needed a reset either. */
function selectSet(setId) {
  const set = brickSetById(setId);
  if (!set) return;
  P.brickSettings.setId = setId;
  P.brickSettings.grout.widthIn = set.grout.widthIn;
  syncSetPicker();
  syncControlsFromState();
  notifyChange();
}

/** F35 item 16 (Fred, "replacing the 0.5-2x multiplier with a BRICK SIZE control in inches"):
 *  quick-access real-world sizes, declared as data -- a new preset is one more entry here, no UI
 *  rework. Advisor follow-up (Fred: "is scale easy?" -- the linear slider crammed every everyday
 *  size into ~15% of the travel): the preset list itself was widened from 3 points (2/4/8in) to the
 *  5 values that actually span the control's own min/max, matching the measured resolution grid's
 *  own columns (shots/seatC/resolution_scale_grid.png) -- "Life size" is a real US brick's own
 *  actual length (8in x 2.25in). */
const BRICK_SIZE_PRESETS = [
  { id: 'eighth3', label: '⅜″', lengthIn: 0.375 },
  { id: 'quarter3', label: '¾″', lengthIn: 0.75 },
  { id: 'half1', label: '1½″', lengthIn: 1.5 },
  { id: 'three', label: '3″', lengthIn: 3 },
  { id: 'life', label: 'Life 8″', lengthIn: 8 },
];
const BRICK_SIZE_MIN_IN = 0.375;
const BRICK_SIZE_MAX_IN = 8;

/** The range input's OWN raw value is a LOG position (0..BRICK_SIZE_SLIDER_STEPS), never the real
 *  inches value -- a plain linear 0.375-8in slider put every everyday size (0.375-1.5in) in the
 *  first ~15% of the handle's travel, since 8in is >20x the minimum (Fred's own "is scale easy?"
 *  review). `#brickSize` (the number stepper) stays in REAL inches throughout, exact, never
 *  log-mapped -- only the draggable handle's own position is remapped, via these two inverse
 *  functions, so dragging feels evenly spaced across the whole 0.375-8in range. */
export const BRICK_SIZE_SLIDER_STEPS = 1000;
export function brickSizeToSliderPos(inches) {
  const clamped = Math.min(BRICK_SIZE_MAX_IN, Math.max(BRICK_SIZE_MIN_IN, inches));
  const t = Math.log(clamped / BRICK_SIZE_MIN_IN) / Math.log(BRICK_SIZE_MAX_IN / BRICK_SIZE_MIN_IN);
  return Math.round(t * BRICK_SIZE_SLIDER_STEPS);
}
export function sliderPosToBrickSize(pos) {
  const t = Math.min(BRICK_SIZE_SLIDER_STEPS, Math.max(0, pos)) / BRICK_SIZE_SLIDER_STEPS;
  return BRICK_SIZE_MIN_IN * Math.pow(BRICK_SIZE_MAX_IN / BRICK_SIZE_MIN_IN, t);
}

function renderBrickSizePresetList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const preset of BRICK_SIZE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn';
    btn.id = `brickSizePreset_${preset.id}`;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => setBrickSize(preset.lengthIn));
    container.appendChild(btn);
  }
}

function syncBrickSizePresetButtons() {
  for (const preset of BRICK_SIZE_PRESETS) {
    document.getElementById(`brickSizePreset_${preset.id}`)?.classList.toggle('active', preset.lengthIn === P.brickSettings.brickLengthIn);
  }
}

function setBrickSize(lengthIn) {
  const v = Math.min(BRICK_SIZE_MAX_IN, Math.max(BRICK_SIZE_MIN_IN, lengthIn));
  P.brickSettings.brickLengthIn = v;
  syncBrickSizeControls(v);
  syncBrickSizePresetButtons();
  notifyChange();
  _scheduleLivePreview();
}

/** Writes the real inches value `v` to BOTH controls -- the slider's own raw DOM value is its LOG
 *  position (brickSizeToSliderPos), never `v` itself; `#brickSize` (the number stepper) gets `v`
 *  directly, exact, same as every other bound control here. */
function syncBrickSizeControls(v) {
  const slider = document.getElementById('brickSizeSlider');
  const number = document.getElementById('brickSize');
  if (slider) slider.value = String(brickSizeToSliderPos(v));
  if (number) number.value = String(v);
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

/** F35 item 10 follow-up: the Brush tool's own Profile/Orientation toggles --
 *  same 2-state `.relief-toggle` convention as Relief above. Both settings
 *  already had real engine support (bricksAlongPath's own opts.profile/
 *  opts.orientation) with no UI control before now; like every other
 *  Brick-tab setting these affect NEW strokes going forward only -- there is
 *  no existing mechanism in this codebase to rewrite an already-drawn
 *  element's own stored BRICK_SETTINGS_ATTR snapshot (see editor-brick-tool.js's
 *  own regenerateOwnedBrickElements), so Orientation/Profile follow the same
 *  precedent Scale/Grout/Relief/etc. already set rather than inventing a new
 *  "edit an existing element" capability nothing else here has either. */
function syncProfileToggle() {
  const continuous = P.brickSettings.profile === 'continuous';
  document.getElementById('brickBtnProfileStripped')?.classList.toggle('active', !continuous);
  document.getElementById('brickBtnProfileContinuous')?.classList.toggle('active', continuous);
  syncOrientationAvailability();
}

function setProfile(v) {
  P.brickSettings.profile = v;
  syncProfileToggle();
  notifyChange();
}

/** T86 item 7 merge note (advisor asked: "decide which wins, or disable orientation when a
 *  multi-row preset is picked"): traced `bricksForBrushStroke` (editor-brick-tool.js) -- it reads
 *  `opts.orientation` ONLY on the `profile:'continuous'` path (bricksAlongPath); the Stripped path
 *  (the DEFAULT profile, every brushBandPreset including the 1-wide stretcher one) goes through
 *  `bricksContourBands` instead, which derives each band's own brick orientation from ITS pattern
 *  name (stretcher/soldier/flemish), never reading `opts.orientation` at all. So the two settings
 *  never actually COLLIDE in the engine -- Orientation is simply INERT for Stripped, every preset,
 *  not just multi-row ones. Disabling it there (rather than leaving a control that silently does
 *  nothing) is the honest fix; Continuous keeps it fully live. */
function syncOrientationAvailability() {
  const inert = P.brickSettings.profile !== 'continuous';
  const title = inert ? 'Only affects the Continuous profile -- Stripped\'s own band pattern already sets each row\'s orientation' : '';
  for (const id of ['brickBtnOrientationStretcher', 'brickBtnOrientationSoldier']) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.disabled = inert;
    btn.title = title;
  }
}

function syncOrientationToggle() {
  const soldier = P.brickSettings.orientation === 'soldier';
  document.getElementById('brickBtnOrientationStretcher')?.classList.toggle('active', !soldier);
  document.getElementById('brickBtnOrientationSoldier')?.classList.toggle('active', soldier);
  syncOrientationAvailability();
}

function setOrientation(v) {
  P.brickSettings.orientation = v;
  syncOrientationToggle();
  notifyChange();
}

/** Shows ONLY the active tool's own settings section (BRICK_TOOLS' own declared
 *  `settingsSection`), hides every other tool's -- Scissors/Stripe have none (null), so
 *  selecting either hides Brush/Wall/Frame's sections with nothing of their own to show. */
function syncToolSections() {
  for (const tool of BRICK_TOOLS) {
    if (!tool.settingsSection) continue;
    const el = document.getElementById(tool.settingsSection);
    if (el) el.style.display = tool.id === _activeTool ? '' : 'none';
  }
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
  syncFramePresetButtons();
  syncWallPatternButtons();
  renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
  syncFrameBandPatternButtons();
  syncBrickSizeControls(s.brickLengthIn);
  syncBrickSizePresetButtons();
  document.getElementById('brickGroutWidth').value = s.grout.widthIn;
  document.getElementById('brickGroutDepth').value = s.grout.depthIn;
  document.getElementById('brickBtnGroutRecessed')?.classList.toggle('active', s.grout.profile === 'recessed');
  document.getElementById('brickBtnGroutFlush')?.classList.toggle('active', s.grout.profile === 'flush');
  syncReliefToggle();
  setPair('brickReliefHeightSlider', 'brickReliefHeight', s.reliefIn);
  setPair('brickSuppressionSlider', 'brickSuppression', s.suppression);
  setPair('brickClumpingSlider', 'brickClumping', s.clumping);
  document.getElementById('brickSeed').value = s.seed;
  syncProfileToggle();
  syncOrientationToggle();
  syncToolSections();
}

/** F35 item 10 follow-up (Fred, folded in with the slider-timing ask): a Brick-tab slider
 *  regenerates on RELEASE ('change': blur/Enter/mouse-up), not on every raw drag tick ('input') --
 *  but WITH a live, throttled 2D-only preview while dragging so the canvas doesn't sit stale for
 *  the length of the drag. Declared ONCE here -- every bindSlider call site below shares this one
 *  mechanism, not a per-slider copy. Wall/Frame only: a Brush stroke's own settings are frozen at
 *  draw time (no existing "edit an already-drawn element" mechanism, see the Brush-section header
 *  above), so there is nothing for a slider to live-preview while Brush is the active tool. */
const LIVE_PREVIEW_INTERVAL_MS = 100; // ~10/sec, Fred's own spec
const SLOW_PREVIEW_MS = 50; // measured (not guessed) threshold for falling back to outline-only
let _liveFrame = null, _lastLiveAt = 0, _dragSlow = false;

function _cancelLivePreview() {
  if (_liveFrame != null) { cancelAnimationFrame(_liveFrame); _liveFrame = null; }
}

function _runLivePreview() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) return;
  if (_activeTool !== 'wall' && _activeTool !== 'frame') return; // Brush/other: nothing to live-preview
  const frameGeom = resolveFrameGeom(editor);
  if (_activeTool === 'frame' && !frameGeom) return; // Frame tool, no usable frame: nothing to preview
  if (_dragSlow) { runBricksOutlinePreview(editor); return; }
  const t0 = performance.now();
  runBricksPreview(editor, P.brickSettings, frameGeom); // Wall: frameGeom may legitimately be undefined (whole-board fill)
  if (performance.now() - t0 > SLOW_PREVIEW_MS) _dragSlow = true; // this drag only -- commit resets it
}

function _scheduleLivePreview() {
  if (_liveFrame != null) return; // already queued -- the frame that runs reads the LATEST settings
  _liveFrame = requestAnimationFrame(() => {
    _liveFrame = null;
    const now = performance.now();
    if (now - _lastLiveAt < LIVE_PREVIEW_INTERVAL_MS) { _scheduleLivePreview(); return; } // throttle window not up yet
    _lastLiveAt = now;
    _runLivePreview();
  });
}

function _commitBrickSlider() {
  _cancelLivePreview();
  _dragSlow = false;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) return;
  if (_activeTool === 'wall') {
    withLoadingStage('bricks', () => runBricks(editor, P.brickSettings, resolveFrameGeom(editor)));
  } else if (_activeTool === 'frame') {
    const frameGeom = resolveFrameGeom(editor);
    if (frameGeom) withLoadingStage('bricks', () => runBricks(editor, P.brickSettings, frameGeom));
  }
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
    _scheduleLivePreview();
  };
  const commit = (raw) => { apply(raw); _commitBrickSlider(); };
  slider?.addEventListener('input', (e) => apply(e.target.value));
  slider?.addEventListener('change', (e) => commit(e.target.value));
  number?.addEventListener('input', (e) => apply(e.target.value));
  number?.addEventListener('change', (e) => commit(e.target.value));
}

/** Brick size's own binder, not the shared bindSlider above: the slider's raw DOM value is a LOG
 *  position (brickSizeToSliderPos/sliderPosToBrickSize), while `#brickSize` (the number stepper)
 *  stays real inches throughout -- the two controls no longer share one raw value the way every
 *  other bindSlider pair does, so this mirrors bindSlider's own input/change-commit shape with that
 *  one difference instead of forcing a log-aware `parse` through the generic helper. */
function bindBrickSizeControls() {
  const slider = document.getElementById('brickSizeSlider');
  const number = document.getElementById('brickSize');
  const apply = (v) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(BRICK_SIZE_MAX_IN, Math.max(BRICK_SIZE_MIN_IN, v));
    if (slider) slider.value = String(brickSizeToSliderPos(clamped));
    if (number) number.value = String(clamped);
    P.brickSettings.brickLengthIn = clamped;
    notifyChange();
    _scheduleLivePreview();
  };
  const commit = (v) => { apply(v); _commitBrickSlider(); };
  slider?.addEventListener('input', (e) => apply(sliderPosToBrickSize(parseFloat(e.target.value))));
  slider?.addEventListener('change', (e) => commit(sliderPosToBrickSize(parseFloat(e.target.value))));
  number?.addEventListener('input', (e) => apply(parseFloat(e.target.value)));
  number?.addEventListener('change', (e) => commit(parseFloat(e.target.value)));
}

function bindGroutField(id, key) {
  document.getElementById(id)?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    P.brickSettings.grout[key] = v;
    notifyChange();
  });
}

/** F35 item 10: this list now renders into the left-rail toolbar
 *  (#editorToolbarBrick, icon-only, same convention Artwork's own tool rail
 *  already uses), not the old sidebar's horizontal icon+label row -- the
 *  label moves into the button's own title tooltip instead.
 *  F35 (advisor, UX unification): rendering + the active-class toggle are the
 *  shared editor-tool-registry.js mechanism now, the same one Photo uses --
 *  this file no longer carries its own copy of either loop. */
function renderToolList(container) {
  renderToolRegistry(container, BRICK_TOOLS, selectTool);
}

function syncToolButtons() {
  syncToolRegistryButtons(BRICK_TOOLS, _activeTool);
  const hint = BRICK_TOOLS.find((t) => t.id === _activeTool);
  const hintEl = document.getElementById('brickToolHint');
  if (hintEl) hintEl.textContent = hint ? hint.hint : '';
  syncToolSections();
  syncEmptySelectionPanel();
}

/** F35 item 16 follow-up (Fred, live use: "don't see the layers"): with no Brick tool picked yet,
 *  the tab's own panel has nothing contextual to show (syncToolSections hides every section) --
 *  show the shared editor Layers panel instead of a near-empty Brick panel. Only touches these two
 *  panels while the Brick tab is actually active (getEditorTab) -- never fights editor-tabs.js's
 *  own per-tab panel toggle for Artwork/Photo/Frame, which this deliberately leaves alone (not the
 *  reported problem). */
function syncEmptySelectionPanel() {
  if (getEditorTab() !== 'brick') return;
  const brickPanel = document.getElementById('editorBrickPanel');
  const layersPanel = document.getElementById('editorLayersPanel');
  const showLayers = _activeTool === null;
  if (brickPanel) brickPanel.style.display = showLayers ? 'none' : '';
  if (layersPanel) layersPanel.style.display = showLayers ? '' : 'none';
}

/** F35 (advisor: "Esc = back to the select tool in every tab"): Brick has no Select tool of its
 *  own to click -- clears this tab's own active-tool state and returns the editor's underlying
 *  interaction mode to plain Select, the same real effect Artwork's Escape-to-toolSelect has. */
export function deselectTool() {
  _activeTool = null;
  syncToolButtons();
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor && typeof editor.setMode === 'function') editor.setMode('select');
}

function renderFramePresetList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const preset of FRAME_PRESET_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn';
    btn.id = `brickFramePreset_${preset.id}`;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      P.brickSettings.frameBandPreset = preset.id;
      syncFramePresetButtons();
      // F35 item 8: a different preset can have a different BAND COUNT, so the per-band pattern
      // picker is fully re-rendered here (not just re-synced) every time the preset changes.
      renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
      syncFrameBandPatternButtons();
      notifyChange();
    });
    container.appendChild(btn);
  }
}

function syncFramePresetButtons() {
  for (const preset of FRAME_PRESET_LIST) {
    document.getElementById(`brickFramePreset_${preset.id}`)?.classList.toggle('active', preset.id === P.brickSettings.frameBandPreset);
  }
}

/** T86 item 7 (Fred: "a brush line can have a few brick patterns, maybe 2 and 3 bricks wide") --
 *  same button-list precedent as `renderFramePresetList` above, reading/writing
 *  `P.brickSettings.brushBandPreset` instead. A deliberately small, named list (not a per-band
 *  picker like Frame's own item 8 -- Fred asked for a FEW whole combinations, not band-by-band
 *  customization of a thin stroke). */
function renderBrushPresetList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const preset of BRUSH_PRESET_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn';
    btn.id = `brickBrushPreset_${preset.id}`;
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      P.brickSettings.brushBandPreset = preset.id;
      syncBrushPresetButtons();
      notifyChange();
    });
    container.appendChild(btn);
  }
}

function syncBrushPresetButtons() {
  for (const preset of BRUSH_PRESET_LIST) {
    document.getElementById(`brickBrushPreset_${preset.id}`)?.classList.toggle('active', preset.id === P.brickSettings.brushBandPreset);
  }
}

/** F35 item 7 (advisor-approved proposal): the Wall pattern picker -- every BRICK_PATTERNS key
 *  (library.js) that applies to a whole-fill Wall pattern, text-button list (same precedent as
 *  FRAME_PRESET_LIST above; a real graphical thumbnail-per-pattern is a declared, not-yet-built
 *  follow-up -- see editor-brick-tool.js's own STYLE_CYCLE comment for the SAME "no thumbnail
 *  rendering exists in this codebase yet" gap already flagged for Stripe). Reads the table's own
 *  keys directly rather than a second, hand-maintained list, so a pattern added to BRICK_PATTERNS
 *  later needs no change here. */
const WALL_PATTERN_LABELS = {
  none: 'None', stretcher: 'Stretcher', stack: 'Stack', soldier: 'Soldier', header: 'Header',
  flemish: 'Flemish', herringbone: 'Herringbone', basketweave: 'Basketweave',
  fieldstone: 'Fieldstone',
};
const WALL_PATTERN_LIST = Object.keys(BRICK_PATTERNS).map((id) => ({ id, label: WALL_PATTERN_LABELS[id] || id }));

function renderWallPatternList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const pattern of WALL_PATTERN_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn';
    btn.id = `brickPattern_${pattern.id}`;
    btn.textContent = pattern.label;
    btn.addEventListener('click', () => {
      P.brickSettings.pattern = pattern.id;
      syncWallPatternButtons();
      notifyChange();
    });
    container.appendChild(btn);
  }
}

function syncWallPatternButtons() {
  for (const pattern of WALL_PATTERN_LIST) {
    document.getElementById(`brickPattern_${pattern.id}`)?.classList.toggle('active', pattern.id === P.brickSettings.pattern);
  }
}

/** F35 item 8: the per-band pattern picker -- one row per band in the CURRENT frameBandPreset, each
 *  offering every BRICK_PATTERNS key (the same table/labels the Wall picker above reads). 'tile2d'
 *  entries (herringbone/basketweave) are disabled here -- bricks must never stretch around a curve,
 *  and tile2d-on-a-curve is still an open design (library.js's own BRICK_PATTERNS header names it
 *  that way; `bricksContourBands`, T86 item 2, only ever handles 'course'/'course-alternating' kinds).
 *  Fully re-rendered (not just re-synced) whenever the band PRESET changes, since a different preset
 *  can have a different band COUNT. */
function renderFrameBandPatternList(container) {
  if (!container) return;
  container.innerHTML = '';
  const bands = FRAME_PRESETS[P.brickSettings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  bands.forEach((band, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:4px; margin-bottom:4px; flex-wrap:wrap; align-items:center;';
    const label = document.createElement('span');
    label.textContent = `Band ${i + 1}`;
    label.style.cssText = 'font-size:10px; opacity:0.65; width:44px; flex:0 0 auto;';
    row.appendChild(label);
    for (const pattern of WALL_PATTERN_LIST) {
      const def = BRICK_PATTERNS[pattern.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cad-btn';
      btn.id = `brickFrameBandPattern_${i}_${pattern.id}`;
      btn.textContent = pattern.label;
      if (def && (def.kind === 'tile2d' || def.kind === 'none')) {
        btn.disabled = true;
        btn.title = def.kind === 'none' ? 'A band needs a real pattern -- use the Frame band preset\'s own None instead' : 'Wall only for now';
        btn.style.opacity = '0.4';
      } else {
        btn.addEventListener('click', () => {
          if (!P.brickSettings.frameBandPatterns) P.brickSettings.frameBandPatterns = [];
          P.brickSettings.frameBandPatterns[i] = pattern.id;
          syncFrameBandPatternButtons();
          notifyChange();
        });
      }
      row.appendChild(btn);
    }
    container.appendChild(row);
  });
}

function syncFrameBandPatternButtons() {
  const bands = FRAME_PRESETS[P.brickSettings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  const overrides = P.brickSettings.frameBandPatterns || [];
  bands.forEach((band, i) => {
    const active = overrides[i] || band.pattern || 'stretcher';
    for (const pattern of WALL_PATTERN_LIST) {
      document.getElementById(`brickFrameBandPattern_${i}_${pattern.id}`)?.classList.toggle('active', pattern.id === active);
    }
  });
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
    withLoadingStage('bricks', () => runBricks(editor, P.brickSettings, resolveFrameGeom(editor)));
    notifyChange();
    return;
  }
  if (id === 'frame') {
    const frameGeom = resolveFrameGeom(editor);
    if (!frameGeom) {
      console.warn('Brick Frame tool: no usable frame contour on this board.');
      return;
    }
    withLoadingStage('bricks', () => runBricks(editor, P.brickSettings, frameGeom));
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

/** F35 item 4 (advisor) + item 10 follow-up: a Frame band-preset picker above the band list, read
 *  directly from library.js's own declared FRAME_PRESETS keys (same WALL_PATTERN_LABELS/
 *  WALL_PATTERN_LIST precedent below) -- a hand-maintained parallel list here had already drifted
 *  once (only showing 3 of the now-8 declared presets after more landed on main), the exact
 *  "a reusable concept deserves one declared source, not a second copy that rots" lesson this
 *  project already applies elsewhere. A preset without its own label here just shows its own key. */
const FRAME_PRESET_LABELS = {
  none: 'None',
  single_soldier: 'Soldier',
  soldier_stretcher: 'Soldier + Stretcher',
  three_band: 'Soldier / Stretcher / Soldier',
  butt_frame: 'Soldier (butt corners)',
  quoin_corners: 'Soldier (quoin corners)',
  double_course: 'Soldier x2 (lapped)',
  header_band: 'Header',
  mixed_bands: 'Header / Flemish / Soldier',
};
const FRAME_PRESET_LIST = Object.keys(FRAME_PRESETS).map((id) => ({ id, label: FRAME_PRESET_LABELS[id] || id }));

/** T86 item 7: labels for core/bricks/library.js's own declared BRUSH_PRESETS keys (the 3
 *  combinations Fred actually asked for -- "maybe 2 and 3 bricks wide"). */
const BRUSH_PRESET_LIST = [
  { id: 'stretcher_1', label: '1-wide (Stretcher)' },
  { id: 'stretcher_2_running', label: '2-wide (Running bond)' },
  { id: 'flemish_soldier_flemish_3', label: '3-wide (Flemish / Soldier / Flemish)' },
];

/** The current frame's own contour, as `{primitives, bands}` for
 *  generateBricks/bricksContourBands -- or null when no real frame resolves (no template selected,
 *  or the offset is degenerate). H23 item 76 (the primitive-ribbon.js rebuild): `sil.primitives`
 *  converts DIRECTLY to raw lines+arcs via buildRibbonPrimitives -- no polyline, no declared corner
 *  indices; bricksContourBands derives every joint (corner or otherwise) straight from where
 *  consecutive primitives actually meet.
 *
 *  F35 item 8: each declared band's own `pattern` is overridden by the per-band picker's own choice
 *  (`frameBandPatterns[i]`) when one was made for that index -- a NEW array (never mutates
 *  FRAME_PRESETS' own frozen entries), falling back to the preset's own declared pattern for any
 *  index the user hasn't touched. T86 item 2: every pattern now builds through the SAME
 *  `bricksContourBands` call (generateBricks' own composer, via `runBricks`) -- no per-band engine
 *  split any more (editor-brick-tool.js's own now-retired `frameBricksFor`), so this function just
 *  builds the real band list, nothing else.
 *
 *  F35 item 16: no longer returns its own `set` override (the retired resolveFrameBrickSet, Frame's
 *  own brick-length-only special case) -- Frame bands now resolve the SAME global brick length as
 *  Wall/Brush, via `scale` (editor-brick-tool.js's own scaleFor), which generateBricks already
 *  threads to both uniformly. */
function resolveFrameGeom(editor) {
  const ctx = frameContext(editor);
  const sil = ctx ? frameContourSilhouette(ctx, 0, 0) : { error: 'noFrame' };
  if (sil.error) return null;
  const primitives = buildRibbonPrimitives(sil.primitives);
  const basePreset = FRAME_PRESETS[P.brickSettings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  const overrides = P.brickSettings.frameBandPatterns || [];
  const bands = basePreset.map((band, i) => (overrides[i] ? { ...band, pattern: overrides[i] } : band));
  return { primitives, bands };
}

// F35 (Fred: "resolution is his own responsibility via the resolution panel" -- REVERSING the
// earlier auto-tighten below): a grout groove needs the terrain's own mesh to sample it at least
// 2-3 times across, or it reads as a blur rather than a visible line -- a 0.06in groove needs
// spacing <= ~0.02in, well finer than this app's own 0.05in default (tuned for smooth terrain,
// not brick-scale features). This USED to auto-tighten P.spacing itself (applyParam('spacing', ...))
// whenever bricks existed; Fred ruled that his own call to make, not automatic. Detection only now
// -- never writes any resolution field -- surfacing a plain, non-blocking hint instead.
const GROUT_SAMPLES_ACROSS = 3;

// F35 item 16 follow-up (the measured resolution x brick-size grid, shots/seatC/
// resolution_scale_grid.png): finer resolution only ever fixes grout-joint CARVING -- it does
// nothing for the separate, measured finding that bricks > 1.5in read as the board's own sculpted
// terrain rather than distinct bricks (a scale/relief-dominance issue, not a sampling one). The hint
// is deliberately SILENT above this size rather than recommending an 8-second Masonry-max rebuild
// that would not actually fix what the user is seeing.
const BRICK_HINT_MAX_SIZE_IN = 1.5;

/** The hint targets the EFFECTIVE EXPORT resolution (Send is what actually needs to carve cleanly),
 *  not Display -- but when they're the same value (sameAsDisplayResolution, the default for every
 *  existing board) the message still surfaces through the always-visible Display panel's own
 *  #spacingGroutHint, since #exportSpacingGroutHint lives inside the Export section that's hidden
 *  in exactly that default case. */
function updateSpacingHint(groutWidthIn) {
  const gw = groutWidthIn ?? P.brickSettings.grout.widthIn;
  const bricksExist = document.querySelectorAll('[data-brick-gen="1"]').length > 0;
  const smallEnoughToHelp = P.brickSettings.brickLengthIn <= BRICK_HINT_MAX_SIZE_IN;
  const targetSpacing = gw > 0 ? gw / GROUT_SAMPLES_ACROSS : null;
  const exportSpacing = effectiveExportSpacing();
  const show = bricksExist && smallEnoughToHelp && targetSpacing != null && exportSpacing > targetSpacing;
  // The coarsest (cheapest) resolutions that are STILL fine enough, named -- e.g. "Extreme (0.02")
  // or Masonry (0.015")" for a typical 0.06in grout width's own 0.02in target.
  const sufficient = RESOLUTIONS.filter((r) => r.val <= targetSpacing).sort((a, b) => b.val - a.val).slice(0, 2);
  const suggestion = sufficient.map((r) => `${r.name} (${r.val}")`).join(' or ');
  const msg = show
    ? `Grout joints need Export resolution ≤ ${targetSpacing.toFixed(3)} in to carve cleanly (current ${exportSpacing}in)${suggestion ? ` -- try ${suggestion}` : ''}`
    : '';
  for (const id of ['brickGroutSpacingHint', P.sameAsDisplayResolution ? 'spacingGroutHint' : 'exportSpacingGroutHint']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = msg;
    el.style.display = show ? '' : 'none';
  }
  // Clear whichever hint element ISN'T the active one this time, so flipping "same as display"
  // never leaves a stale message showing under the wrong control.
  const inactiveId = P.sameAsDisplayResolution ? 'exportSpacingGroutHint' : 'spacingGroutHint';
  const inactiveEl = document.getElementById(inactiveId);
  if (inactiveEl) { inactiveEl.textContent = ''; inactiveEl.style.display = 'none'; }
}

export function initBrickPanel() {
  document.addEventListener('bricksGenerated', (e) => updateSpacingHint(e.detail?.groutWidthIn));
  // setTimeout(0): this listener's own registration order relative to the generic param-input
  // binding that actually writes P.spacing isn't declared anywhere -- deferring one tick guarantees
  // P.spacing already reflects the new value by the time the hint re-reads it, regardless of order.
  document.getElementById('spacing')?.addEventListener('change', () => setTimeout(() => updateSpacingHint(), 0));
  // F35 item 16 follow-up: the hint now targets the EFFECTIVE export resolution, which these two
  // controls can also change -- same deferred-by-one-tick convention as #spacing above.
  document.getElementById('exportSpacing')?.addEventListener('change', () => setTimeout(() => updateSpacingHint(), 0));
  document.getElementById('sameAsDisplayResolution')?.addEventListener('change', () => setTimeout(() => updateSpacingHint(), 0));
  updateSpacingHint();

  document.getElementById('editorTabBrick')?.addEventListener('click', () => setEditorTab('brick'));
  // F35 item 16 follow-up: re-sync which panel (Brick's own settings vs the shared Layers panel)
  // shows every time the Brick tab itself becomes active -- syncToolButtons (called from
  // selectTool/deselectTool already) only runs on a TOOL change, not a bare tab switch, so entering
  // the tab with no tool yet picked needs its own trigger here.
  document.addEventListener('editorTabChanged', (e) => { if (e.detail?.tab === 'brick') syncToolButtons(); });
  renderToolList(document.getElementById('editorToolbarBrick'));
  syncToolButtons();
  renderFramePresetList(document.getElementById('brickFramePresetList'));
  syncFramePresetButtons();
  renderBrushPresetList(document.getElementById('brickBrushPresetList'));
  syncBrushPresetButtons();
  renderWallPatternList(document.getElementById('brickPatternList'));
  syncWallPatternButtons();
  renderBrickSizePresetList(document.getElementById('brickSizePresetList'));
  syncBrickSizePresetButtons();

  document.getElementById('brickSetRed')?.addEventListener('click', () => selectSet(1));
  // F35 item 4 (c): White Rocks (Set 3, f3's item 74 fieldstone layout) is
  // now real -- un-greyed, selectable like Red Brick.
  document.getElementById('brickSetWhite')?.addEventListener('click', () => selectSet(3));

  bindBrickSizeControls();
  bindGroutField('brickGroutWidth', 'widthIn');
  bindGroutField('brickGroutDepth', 'depthIn');
  document.getElementById('brickBtnGroutRecessed')?.addEventListener('click', () => setGroutProfile('recessed'));
  document.getElementById('brickBtnGroutFlush')?.addEventListener('click', () => setGroutProfile('flush'));
  document.getElementById('brickBtnReliefRaised')?.addEventListener('click', () => setInvert(false));
  document.getElementById('brickBtnReliefCarved')?.addEventListener('click', () => setInvert(true));
  document.getElementById('brickBtnProfileStripped')?.addEventListener('click', () => setProfile('bricks'));
  document.getElementById('brickBtnProfileContinuous')?.addEventListener('click', () => setProfile('continuous'));
  document.getElementById('brickBtnOrientationStretcher')?.addEventListener('click', () => setOrientation('stretcher'));
  document.getElementById('brickBtnOrientationSoldier')?.addEventListener('click', () => setOrientation('soldier'));
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
