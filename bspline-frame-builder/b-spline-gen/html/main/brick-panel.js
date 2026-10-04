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
import { runBricks, runBricksPreview, runBricksOutlinePreview, buildRibbonPrimitives, resolvedSetFor } from '../editor/editor-brick-tool.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { frameContourSilhouette } from '../editor/contour-from-frame.js';
import { FRAME_PRESETS, BRICK_PATTERNS, brickSetById } from '../core/bricks/library.js';
import { applyParam } from './param-manager.js';
import { setEditorTab } from './editor-tabs.js';
import { renderToolRegistry, syncToolRegistryButtons } from '../editor/editor-tool-registry.js';

/** The declared tool list (Fred's own UI lock: "a declared tool list
 * [{id,label,icon,settingsSection,engineEntry}]... more tools added as data
 * entries plus their engine function, no UI rework"). `settingsSection` is
 * reserved for a future per-tool settings block (Wall's zones, Frame's band
 * picker) -- null for now, every tool uses only the common controls below.
 * `run` is this file's own entry point for that tool (not re-exported --
 * core/bricks/ itself stays engine-agnostic of "how a UI triggers it"). */
const BRICK_TOOLS = [
  { id: 'brush', buttonId: 'brickTool_brush', label: 'Brush', icon: '✏️', settingsSection: null,
    hint: 'Click here, then drag a stroke on the canvas to lay bricks along it.' },
  { id: 'wall', buttonId: 'brickTool_wall', label: 'Wall', icon: '🧱', settingsSection: null,
    hint: 'Fills the whole board with bricks.' },
  { id: 'frame', buttonId: 'brickTool_frame', label: 'Frame', icon: '🖼️', settingsSection: null,
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
 *  `toBrickOpts` always applies verbatim regardless of which set is active. */
function selectSet(setId) {
  const set = brickSetById(setId);
  if (!set) return;
  P.brickSettings.setId = setId;
  P.brickSettings.grout.widthIn = set.grout.widthIn;
  P.brickSettings.frameBrickLengthIn = set.brickLengthIn;
  syncSetPicker();
  syncControlsFromState();
  notifyChange();
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

/** Shown only while Brush is the active tool (BRICK_TOOLS' own
 *  `settingsSection` field is reserved for exactly this per-tool-section
 *  concept but unused elsewhere yet -- Brush is the first tool that needs
 *  one, so this stays a direct `_activeTool === 'brush'` check rather than
 *  generalizing settingsSection for a single consumer). */
function syncBrushSection() {
  const el = document.getElementById('brickBrushSection');
  if (el) el.style.display = _activeTool === 'brush' ? '' : 'none';
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
  setPair('brickFrameLengthSlider', 'brickFrameLength', s.frameBrickLengthIn);
  syncProfileToggle();
  syncOrientationToggle();
  syncBrushSection();
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
    runBricks(editor, P.brickSettings, resolveFrameGeom(editor));
  } else if (_activeTool === 'frame') {
    const frameGeom = resolveFrameGeom(editor);
    if (frameGeom) runBricks(editor, P.brickSettings, frameGeom);
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
  syncBrushSection();
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

/** The current frame's own contour, as `{primitives, bands, set}` for
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
 *  builds the real band list, nothing else. */
function resolveFrameGeom(editor) {
  const ctx = frameContext(editor);
  const sil = ctx ? frameContourSilhouette(ctx, 0, 0) : { error: 'noFrame' };
  if (sil.error) return null;
  const primitives = buildRibbonPrimitives(sil.primitives);
  const basePreset = FRAME_PRESETS[P.brickSettings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  const overrides = P.brickSettings.frameBandPatterns || [];
  const bands = basePreset.map((band, i) => (overrides[i] ? { ...band, pattern: overrides[i] } : band));
  return { primitives, bands, set: resolveFrameBrickSet() };
}

/** F35 item 5 review (Fred, via advisor correction): "frame thickness" = the
 *  LENGTH of the bricks across a Frame band (a soldier band's own width IS
 *  the brick length) -- a per-frame brick-length OVERRIDE, not a band-width
 *  scaler. `brickHeightIn` is recomputed to keep the set's own declared
 *  aspect ratio, so the brick's own proportions never distort. Returns the
 *  base set UNCHANGED when the override equals its own declared length (the
 *  default, reset on every set switch -- selectSet above) so every OTHER
 *  caller of this set (Wall's own interior fill, via generateBricks' own
 *  top-level `input.set`) is completely unaffected -- this is carried
 *  separately as frameGeom's own `set`, generateBricks' optional
 *  `frame.set` override. */
function resolveFrameBrickSet() {
  // resolvedSetFor (editor-brick-tool.js), NOT a raw brickSetById -- so this
  // starts from the SAME grout-width-overridden set Wall/Brush already use
  // (runBricks' own `input.set`), rather than silently dropping the user's
  // current grout-width slider value for Frame bricks specifically.
  const base = resolvedSetFor(P.brickSettings);
  const overrideLength = P.brickSettings.frameBrickLengthIn;
  if (!overrideLength || overrideLength === base.brickLengthIn) return base;
  const aspect = base.brickHeightIn / base.brickLengthIn;
  return { ...base, brickLengthIn: overrideLength, brickHeightIn: overrideLength * aspect };
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

  document.getElementById('editorTabBrick')?.addEventListener('click', () => setEditorTab('brick'));
  renderToolList(document.getElementById('editorToolbarBrick'));
  syncToolButtons();
  renderFramePresetList(document.getElementById('brickFramePresetList'));
  syncFramePresetButtons();
  renderBrushPresetList(document.getElementById('brickBrushPresetList'));
  syncBrushPresetButtons();
  renderWallPatternList(document.getElementById('brickPatternList'));
  syncWallPatternButtons();

  document.getElementById('brickSetRed')?.addEventListener('click', () => selectSet(1));
  // F35 item 4 (c): White Rocks (Set 3, f3's item 74 fieldstone layout) is
  // now real -- un-greyed, selectable like Red Brick.
  document.getElementById('brickSetWhite')?.addEventListener('click', () => selectSet(3));

  bindSlider('brickScaleSlider', 'brickScale', 'scale');
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
  bindSlider('brickFrameLengthSlider', 'brickFrameLength', 'frameBrickLengthIn');
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
