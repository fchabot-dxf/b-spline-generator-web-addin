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
import { withLoadingStageShownFirst, beginLoadingSequence } from '../core/loading-signal.js';
import { recordBoardStep } from '../core/history.js';
import { joinRebuildHold } from '../core/engine/scheduler.js';
import { showToast } from '../core/toast.js';
import {
  runBricks, runBricksPreview, runBricksOutlinePreview, buildRibbonPrimitives, layerOfElement, BRICK_KINDS,
  BRICK_STRIPE_STYLES, DEFAULT_STRIPE_STYLE_PICKS, brushExclusions, wallLayoutFor, wallPatternIconSvg,
  accentIconSvg, syncAccentHighlight, wallBrickPolygons,
  BRICK_SET_IDS, FRAME_SET_IDS, setsOfferedFor, frameModeOfSet, elementSetId, isRockFrame, brickRecordNode, BRICK_LAID_ATTR, brickElementAt, showElementSelection, isRunningBond,
  syncRunAccentHighlight,
  elementGroutWidth, JOINT_ELEMENT, patternParamsFor,
  FRAME_CORNERS, FOLDED_FRAME_PRESETS, topBiasOf, frameSuppressionOf, windowSurroundOf, SURROUND_NONE, SURROUND_FOLLOW, SURROUND_CORNER_LIST, frameCornerOf, frameBandsOf, frameCornerIconSvg, framePresetIconSvg, frameCornerEffectFor,
  FRAME_FAN_CENTRES, frameFanCentreOf, fanCentreIconSvg, frameHasFanFor,
  addWallAreaStroke, clearWallAreas, wallAreaRecords, withWallFields, patternSetId,
  brushStrokeSettings, restyleBrushStroke, groutCutPolylines, strokesFollowGlobals, STROKE_FOLLOWS_GLOBAL, STROKE_FOLLOWS_QUICK_SET,
  groutPaintOf, repaintGrout, GROUT_ELEMENT_KINDS, GROUT_PAINT_DEFAULT, elementsWithoutGrout, forceRegenerateOwnedBrickElements,
} from '../editor/editor-brick-tool.js';
import { openColorMosaic } from '../editor/editor-color.js';
import {
  ACCENT_PRESETS, ACCENT_CUSTOM, DEFAULT_ACCENT, toggleAccentClick, ACCENT_LEVEL_RANGE, clampAccentLevel, ACCENT_TILE,
  ACCENT_TILE_LIMITS, ACCENT_TILE_UNITS, PATTERN_BUILDER_SCOPE, makeTile, tileOf, userPatternFrom, accentOfUserPattern,
  accentLayInput, BOND_CUSTOM, isCustomBondTile, blankBond, resizeBond, pieceOfCells, bondTogglePiece, bondJoin, bondSplit,
  bondShift, wallPatternOfBase,
} from '../editor/brick-accents.js';
import { commitEdit } from '../editor/editor-commit.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { BRICK_CONTROL_REQUIRES, requirementMet, FRAME_NEEDS_A_FRAME, cornerFact, FAN_FACT } from './brick-control-requires.js';
import { ENGINE_OPTIONS } from '../core/bricks/index.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { frameContourSilhouette, hasFrame } from '../editor/contour-from-frame.js';
import { rectToPrimitives, insetWindowOuterRect } from '../core/inset-window.js';
import { getFrameRecord } from '../core/frame-record.js';
import { FRAME_PRESETS, BRICK_PATTERNS, brickSetById } from '../core/bricks/library.js';
import { setEditorTab, getEditorTab } from './editor-tabs.js';
import { renderTabStrip } from '../editor/tab-strip.js';
import { BRICK_SURFACE_STYLES, surfaceStyleById } from '../editor/brick-surface-styles.js';
import { brickToolIconSvg } from '../editor/brick-tool-icons.js';
import { applyBrickTabSections, brickTabOfControl } from './brick-tab-sections.js';

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
// `iconSvg` (F35 item 24 step 2): the tool's line icon (editor/brick-tool-icons.js); `icon` = the text fallback
// `tab` (F35 item 43, Fred: "a tab system instead of a left toolbar"): the tool's tab in the Brick panel's strip --
// `order` after General, `label` the short name under the icon. `tabOf` (advisor, v2 review): a tool with no tab of
// its own, reached as a sub-tool of that tool's tab (Stripe acts on brush strokes: Brush > Stripe).
const BRICK_TOOLS = [
  // `ownsSet` (F35 item 23): the tool lays an ELEMENT with its own brick set (P.brickSettings.setIds[tool id]);
  // the Set row edits the active tool's.
  { id: 'brush', buttonId: 'brickTool_brush', iconSvg: () => brickToolIconSvg('brush'), label: 'Brush', icon: '✏️', settingsSection: 'brickBrushSection', ownsSet: true,
    tab: { order: 3, label: 'Brush' },
    subTools: ['draw', 'select', 'stripe'], // F35 item 36; item 43: + Stripe (its tab is Brush's)
    hint: 'Click here, then drag a stroke on the canvas to lay bricks along it.' },
  // F35 item 16 (turn 201): the RAISED BRUSH -- a variant of Brush (`variantOf`: the same brickBrush mode,
  // same stroke machinery) whose strokes carry `strokeOverrides` (its Level + mode), frozen per stroke.
  { id: 'raisedBrush', buttonId: 'brickTool_raisedBrush', iconSvg: () => brickToolIconSvg('raisedBrush'), label: 'Raised brush', icon: '⏫', settingsSection: 'brickRaisedSection', ownsSet: true,
    variantOf: 'brush', strokeOverrides: () => ({ levelIn: P.brickSettings.raisedLevelIn, strokeMode: P.brickSettings.raisedMode }),
    tab: { order: 4, label: 'Raised' },
    subTools: ['draw', 'select'], // F35 item 36
    hint: 'Drag a stroke: bricks laid proud of the others by Level.' },
  // `generates` (audit C9): Generate re-lays this tool's output, so the pinned Generate shows for it.
  // Brush/Scissors/Stripe act on drawn strokes, whose settings freeze at draw time.
  // `lays` (audit C1): the ONE element kind this tool lays (editor-brick-tool.js BRICK_KINDS). Since item 27 a
  // setting change lays it at once; Generate re-lays it (audit B7: the hints say so).
  // `subTools` (F35 item 22): the element tool's own sub-tools (BRICK_SUB_TOOLS below), shown in its section
  { id: 'wall', buttonId: 'brickTool_wall', iconSvg: () => brickToolIconSvg('wall'), label: 'Wall', icon: '🧱', settingsSection: 'brickWallSection', generates: true, lays: 'wall', ownsSet: true,
    tab: { order: 1, label: 'Wall' },
    subTools: ['select', 'area'],
    hint: 'Fills the frame\'s interior with bricks (the whole board when there is no frame). Change a setting to lay it; Generate re-lays.' },
  { id: 'frame', buttonId: 'brickTool_frame', iconSvg: () => brickToolIconSvg('frame'), label: 'Frame', icon: '⬚', settingsSection: 'brickFrameSection', generates: true, lays: 'frame', ownsSet: true,
    tab: { order: 2, label: 'Frame' },
    subTools: ['select'],
    hint: 'Bands of bricks along the frame\'s outer edge (the board\'s edge when no frame template is picked). Change a setting to lay them; Generate re-lays.' },
  // F35 item 3: arm the EXISTING, unmodified editor cut/stripe modes --
  // a Brush stroke's own spine is a plain <line> chain, already isCuttable
  // (editor-cut-tool.js) with zero changes needed there. Only applies to
  // Brush strokes today (Wall/Frame have no drawn spine to tap -- see
  // editor-brick-tool.js's own header on why that's a deliberate scope,
  // not an oversight).
  // sharedRows: false (audit v2 N7) -- a cut keeps each piece's draw-time settings, so the shared rows do nothing
  { id: 'scissors', buttonId: 'brickTool_scissors', iconSvg: () => brickToolIconSvg('scissors'), label: 'Scissors', icon: '✂️', settingsSection: null, sharedRows: false,
    tab: { order: 5, label: 'Scissors' },
    hint: 'Tap a brush stroke to split it -- each piece regenerates its own bricks independently once moved apart.' },
  // sharedRows: false (turn 197) -- a stripe pick restyles EXISTING strokes, so the panel's shared rows
  // (BRICK_ROW_SCOPES' element / both blocks) don't apply and are hidden
  { id: 'stripe', iconSvg: () => brickToolIconSvg('stripe'), label: 'Stripe', icon: '📏', settingsSection: 'brickStripeSection', sharedRows: false,
    tabOf: 'brush', subTools: ['draw', 'select', 'stripe'], // item 43: Brush's sub-tool row stays in view while striping
    hint: 'Tap a brush stroke to split it into alternating brick-style runs.' },
];

/** F35 item 43: the Brick panel's TAB STRIP = General (not a tool: the board-wide settings; picking it leaves the
 *  active tool as it is) + one tab per BRICK_TOOLS entry that declares `tab`, in its declared order. A tab's button
 *  keeps the tool's `buttonId`, so a click on it is a click on the tool. */
// `generates: false` (Fred 2026-10-10: "in the General tab the Generate button has no purpose"): General holds only the
// board-wide settings; each element's tab keeps its own Generate (BRICK_TOOLS' `generates`)
export const BRICK_GENERAL_TAB = Object.freeze({ id: 'general', buttonId: 'brickTab_general', label: 'General', generates: false,
  iconSvg: () => brickToolIconSvg('general'), title: 'General -- the board-wide brick settings (every element)' });
export const brickTabs = () => [BRICK_GENERAL_TAB, ...BRICK_TOOLS.filter((t) => t.tab).sort((a, b) => a.tab.order - b.tab.order)
  .map((t) => ({ id: t.id, buttonId: t.buttonId, label: t.tab.label, iconSvg: t.iconSvg, title: `${t.label} -- ${t.hint}` }))];
/** F35 item 43 (each setting's scope declared once): the panel's shared rows. 'global' = board-wide, shown ONLY in the
 *  General tab; 'element' = edits the active tool's element, shown in its tab (not for a tool with sharedRows: false);
 *  'both' = General AND the element tabs. Brick-tab v2 (Fred, 2026-10-07): the grout paint (Colour + Edge) is General's
 *  own "Look" section and Suppression .. Seed its Crumble / Randomness sections (main/brick-tab-sections.js), so the
 *  Grout and Scatter blocks -- the only 'both' and the other 'global' scope -- are gone. */
export const BRICK_ROW_SCOPES = Object.freeze({
  brickSharedSet: 'element', brickSizeBlock: 'global', brickGroutWidthRow: 'element',
});

let _activeTool = null;
let _generalTab = false; // item 43: the General tab is open (the tool stays as it is underneath)
/** The tab the strip shows active: General when picked or with no tool, else the active tool's (its `tabOf`'s). */
export function activeBrickTab() {
  const tool = BRICK_TOOLS.find((t) => t.id === _activeTool);
  if (_generalTab || !tool) return BRICK_GENERAL_TAB.id;
  return tool.tabOf || tool.id;
}
let _syncTabs = null;
/** Brings up the tab that shows control `id` (BRICK_ROW_SCOPES): General for a global block, the active tool's tab for an
 *  element block ('both' and a tool section show where they are). For code that sends the user (or the brick matrix) to
 *  a setting -- a control hidden by the other tab is never mistaken for a greyed-out one. */
export function revealBrickControl(id) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
  if (!el) return false;
  // Brick-tab v2: a control in a declared section belongs to that section's tab (a shared row: the active tool's)
  const sectionTab = brickTabOfControl(el);
  if (sectionTab) {
    const general = activeBrickTab() === BRICK_GENERAL_TAB.id;
    if (sectionTab === BRICK_GENERAL_TAB.id && !general) pickBrickTab(BRICK_GENERAL_TAB.id);
    else if (sectionTab !== BRICK_GENERAL_TAB.id && general && _activeTool) { _generalTab = false; syncToolButtons(); }
    return true;
  }
  const block = Object.keys(BRICK_ROW_SCOPES).filter((b) => document.getElementById(b)?.contains(el))
    .sort((a, b) => (document.getElementById(a).contains(document.getElementById(b)) ? 1 : -1))[0]; // the innermost
  const scope = block ? BRICK_ROW_SCOPES[block] : null;
  const general = activeBrickTab() === BRICK_GENERAL_TAB.id;
  if (scope === 'global' && !general) pickBrickTab(BRICK_GENERAL_TAB.id);
  else if (scope === 'element' && general && _activeTool) { _generalTab = false; syncToolButtons(); }
  return true;
}
function pickBrickTab(id) {
  if (id === BRICK_GENERAL_TAB.id) { _generalTab = true; syncToolButtons(); return; }
  selectTool(id);
}
/** The panel's PAGE-level event listeners (document), each wired ONCE per page however often initBrickPanel runs (the
 *  app runs it once; a test file once per test). Their handlers call module functions only, so a second copy adds
 *  nothing but a second run -- a re-lay twice for frameRecordChanged, and in a test file every earlier init's copy
 *  re-syncing the panel (item 67 measured brickSettingsRestored at 3.7 s after ~80 inits vs 0.28 s alone). */
const _pageWired = new Set();
function onPageEvent(key, type, fn) {
  if (_pageWired.has(key) || typeof document === 'undefined') return;
  _pageWired.add(key);
  document.addEventListener(type, fn);
}

function notifyChange() { saveLastSession(); _scheduleStrokeRestyle(); }

/** F35 item 23: the Set row lists the BRICK sets (editor-brick-tool.js BRICK_SET_IDS, from each set's declared
 *  layout -- a new brick set appears by itself) and edits the ACTIVE tool's element (BRICK_TOOLS `ownsSet`;
 *  the Wall with no element tool active). A rock element (Fieldstone) shows no brick set active. */
const SET_LABELS = { 1: 'Red Brick' };
const _setLabel = (id) => SET_LABELS[id] || (brickSetById(id) || {}).name || `Set ${id}`;
const SET_KINDS = () => BRICK_TOOLS.filter((t) => t.ownsSet).map((t) => t.id);
function _setKind() {
  const tool = BRICK_TOOLS.find((t) => t.id === _activeTool);
  return tool && tool.ownsSet ? tool.id : 'wall';
}

// F35 item 61: one button per set any element can take (the row shows the active element's own, syncSetPicker)
const SET_ROW_IDS = () => [...new Set([...BRICK_SET_IDS, ...FRAME_SET_IDS])].sort((a, b) => a - b);
function renderSetRow(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const id of SET_ROW_IDS()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `brickSet_${id}`;
    btn.className = 'cad-btn brick-set-btn';
    btn.textContent = _setLabel(id);
    btn.addEventListener('click', () => selectSet(id));
    container.appendChild(btn);
  }
}

function syncSetPicker() {
  const kind = _setKind(), current = elementSetId(P.brickSettings, kind), offered = setsOfferedFor(kind);
  for (const id of SET_ROW_IDS()) {
    const btn = document.getElementById(`brickSet_${id}`);
    if (!btn) continue;
    btn.classList.toggle('active', id === current);
    btn.style.display = offered.includes(id) ? '' : 'none'; // item 61: the Frame lists every band-capable set
  }
  syncQuickSettings();
  syncLargeStonesRow();
  syncRusticRows();
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
export function selectSet(setId, commit = 'generate', kinds = [_setKind()], { strokes = false } = {}) {
  const set = brickSetById(setId);
  if (!set || !kinds.every((k) => setsOfferedFor(k).includes(setId))) return;
  P.brickSettings.setIds = { ...(P.brickSettings.setIds || {}) };
  for (const kind of kinds) {
    // item 61: a set whose layout is a band pattern (White rocks) makes the frame rock -- the pattern implies the set
    // (setFrameRock's rule, elementSetId derives the rock set); its own brick set (setIds.frame) is left as it was
    if (kind === 'frame' && frameModeOfSet(setId) === 'pattern') {
      const bands = FRAME_PRESETS[P.brickSettings.frameBandPreset] || [];
      P.brickSettings.frameBandPatterns = bands.map(() => set.layout);
      continue;
    }
    P.brickSettings.setIds[kind] = setId;
    // a brick set on a ROCK element turns it back into bricks (the Fieldstone pattern is what made it rock)
    if (kind === 'wall' && patternSetId(P.brickSettings.pattern) != null) P.brickSettings.pattern = DEFAULT_WALL_PATTERN;
    if (kind === 'frame' && isRockFrame(P.brickSettings)) P.brickSettings.frameBandPatterns = [];
  }
  // (the elements' joints fall back to the new set's own: _resetJointsOnSetChange, in commitBrickSetting)
  syncSetPicker();
  syncControlsFromState();
  // A6 (advisor): only the quick Set ("apply to all") reaches the drawn strokes; an element's own Set row never does
  commitBrickSetting(commit, 'onRelease', strokes ? Object.fromEntries(STROKE_FOLLOWS_QUICK_SET.map((k) => [k, setId])) : null);
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
  { id: 'one', label: '1″', lengthIn: 1 },
  { id: 'one_quarter1', label: '1¼″', lengthIn: 1.25 }, // Fred (2026-10-05): the new-board default, so it shows as picked
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
  syncQuickSettings();
}

export function setBrickSize(lengthIn, commit = 'generate') {
  const v = Math.min(BRICK_SIZE_MAX_IN, Math.max(BRICK_SIZE_MIN_IN, lengthIn));
  P.brickSettings.brickLengthIn = v;
  syncBrickSizeControls(v);
  syncBrickSizePresetButtons();
  commitBrickSetting(commit);
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

function _writeGroutProfile(profile) {
  P.brickSettings.grout.profile = profile;
  document.getElementById('brickBtnGroutRecessed')?.classList.toggle('active', profile === 'recessed');
  document.getElementById('brickBtnGroutFlush')?.classList.toggle('active', profile === 'flush');
}

export function setGroutProfile(profile, commit = 'surface') { // F35 item 18: height-only (the joint recess)
  _writeGroutProfile(profile);
  delete P.brickSettings.groutProfileBeforeStyle; // the user's own pick wins over a style's restore
  commitBrickSetting(commit);
}

function syncReliefToggle() {
  const inverted = !!P.brickSettings.invert;
  document.getElementById('brickBtnReliefRaised')?.classList.toggle('active', !inverted);
  document.getElementById('brickBtnReliefCarved')?.classList.toggle('active', inverted);
}

export function setInvert(on, commit = 'generate') {
  P.brickSettings.invert = on;
  syncReliefToggle();
  commitBrickSetting(commit);
}

/** F35 item 18 (1): brick top FLAT | ORGANIC -- same 2-state `.relief-toggle` as Relief above. */
function syncBrickTopToggle() {
  const flat = P.brickSettings.brickTopMode === 'flat';
  document.getElementById('brickBtnTopOrganic')?.classList.toggle('active', !flat);
  document.getElementById('brickBtnTopFlat')?.classList.toggle('active', flat);
}

/** F35 item 16: an element's LEVEL (height offset, inches), read by the height mask. Audit v2 N6: in the editor
 *  a Level change showed nothing at all (3D-only, and the editor never re-masks) -- it is now in the laid key
 *  and commits like the other editor settings: it re-lays at once (item 27), Apply builds the 3D.
 *  One input per kind: #brickLevel_<kind>. */
export function setElementLevel(kind, levelIn, commit = 'generate') {
  const v = Number(levelIn);
  if (!Number.isFinite(v)) return;
  P.brickSettings.elementLevelIn = { ...(P.brickSettings.elementLevelIn || {}), [kind]: v };
  syncElementLevels();
  commitBrickSetting(commit);
}

/** F35 item 15: RAISED ACCENTS on the Wall (editor/brick-accents.js). 3D-only like Level: a change re-tags
 *  the 2D highlight and re-masks, never re-lays. The picker = None + ACCENT_PRESETS as engine-drawn icons
 *  (icons only, the name as tooltip); Custom = the "Click bricks" toggle, which arms the canvas mode. */
const _accent = () => ({ ...DEFAULT_ACCENT, ...(P.brickSettings.accent || {}) });
const ACCENT_CHOICES = [{ id: 'none', label: 'None' }, ...ACCENT_PRESETS];
let _accentClickArmed = false;

function renderAccentList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const choice of ACCENT_CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-accent-icon';
    btn.id = `brickAccent_${choice.id}`;
    btn.title = choice.label;
    btn.setAttribute('aria-label', choice.label);
    btn.style.cssText = 'padding:2px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = accentIconSvg(choice.id, 30, { sunk: _accent().levelIn < 0 }) || choice.label; // item 32: sunk drawn lower
    if (btn.firstElementChild) btn.firstElementChild.style.cssText = 'width:100%; height:auto; display:block;'; // scales to its grid cell
    btn.addEventListener('click', () => setAccentPreset(choice.id));
    container.appendChild(btn);
  }
}

function syncAccentControls() {
  const a = _accent();
  for (const choice of ACCENT_CHOICES) document.getElementById(`brickAccent_${choice.id}`)?.classList.toggle('active', a.preset === choice.id);
  document.getElementById('brickAccentClick')?.classList.toggle('active', a.preset === ACCENT_CUSTOM.id && _accentClickArmed && _accentClickTarget.kind === 'wall');
  const row = document.getElementById('brickAccentLevelRow');
  if (row) row.style.display = a.preset === 'none' ? 'none' : '';
  const level = document.getElementById('brickAccentLevel');
  if (level) {
    level.min = String(ACCENT_LEVEL_RANGE.min); level.max = String(ACCENT_LEVEL_RANGE.max); // item 32: the declared range
    if (document.activeElement !== level) level.value = a.levelIn;
  }
  // the builder: open while editing; its tile's saved pattern (if any) active in the Wall grid
  document.getElementById('brickAccentCustomOpen')?.classList.toggle('active', _builder.open || a.preset === ACCENT_TILE.id);
  for (const u of _userPatterns()) document.getElementById(_userPatternButtonId(u))?.classList.toggle('active', a.preset === ACCENT_TILE.id && a.tile && a.tile.userId === u.id);
}

/** item 31b / 31e: what the Wall accent adds to the LAY (brick-accents.js accentLayInput: the engine cuts of a tile at
 *  1/2 or 1/4, a custom bond), as a key. An edit that changes it re-lays the wall (the pieces themselves change), not
 *  just its heights -- `before` = the key captured before the edit (settings and canvas agree then: undo restores both). */
const _cutsKey = () => JSON.stringify(accentLayInput(P.brickSettings.accent, ENGINE_OPTIONS));
function _accentChanged(commit, before = null) {
  if (before !== null && before !== _cutsKey()) commit = 'generate';
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor) { syncAccentHighlight(editor, P.brickSettings.accent, P.brickSettings.seed); syncRunAccentHighlight(editor, P.brickSettings); }
  syncAccentControls();
  commitBrickSetting(commit);
}

export function setAccentPreset(id, commit = 'surface') {
  if (id !== 'none' && id !== ACCENT_CUSTOM.id && !ACCENT_PRESETS.some((p) => p.id === id)) return;
  if (id !== ACCENT_CUSTOM.id) _disarmAccentClick();
  if (_builder.open) { _builder.open = false; renderPatternBuilder(); } // a preset pick ends the builder's live tile
  const before = _cutsKey();
  P.brickSettings.accent = { ..._accent(), preset: id };
  _accentChanged(commit, before);
}

export function setAccentLevel(levelIn, commit = 'surface') {
  const v = Number(levelIn);
  if (!Number.isFinite(v)) return;
  const was = _accent().levelIn < 0;
  P.brickSettings.accent = { ..._accent(), levelIn: clampAccentLevel(v) }; // item 32: signed, within its range
  if ((P.brickSettings.accent.levelIn < 0) !== was) renderAccentList(document.getElementById('brickAccentList')); // icons: raised <-> sunk
  _accentChanged(commit);
}

/* ------------------------------------------------------------------------------------------------------------
 * F35 item 31 step 2, the PATTERN BUILDER (Fred: "love it"; scope ['wall']): a sub-panel under the Accent row,
 * closed at rest. A TILE of courses x bricks on a BASE bond (31c), its cells raised / sunk (the signed level, 32),
 * at a UNIT of a brick (31b: 1/2, 1/4 hidden until the engine's 'accentCuts'). While open, the wall's accent IS
 * the builder's tile (a live preview, 2D highlight + 3D). Save -> a pattern of its own in the Wall pattern grid
 * (bond + tile + unit + level; with the project + in this browser). 31e: base 'Custom' (hidden until the engine's
 * 'customBond') edits the BOND too -- drag across cells to join them into one brick, tap a joint to split, offset each
 * course; the tile then carries its own bond (brick-accents.js BOND_CUSTOM).
 * ---------------------------------------------------------------------------------------------------------- */
const USER_PATTERNS_KEY = 'bspline.brick.userPatterns';
/** The bases a tile can be drawn on: the COURSED bonds (a tile is courses x bricks). */
const BUILDER_BASES = () => [...Object.keys(BRICK_PATTERNS).filter((id) => ['course', 'course-alternating'].includes(BRICK_PATTERNS[id].kind)),
  ...(_engineHas({ engineOption: 'customBond' }) ? [BOND_CUSTOM] : [])]; // 31e: 'Custom' = a blank grid, its own bond
/** A builder tile copied (makeTile keeps cells / unit / base), with its custom bond resized to it (31e). */
const _tileCopy = (rows, cols, from, extra = {}) => {
  const t = makeTile(rows, cols, from, extra);
  const bond = extra.bond || (from && from.bond);
  if (t.base === BOND_CUSTOM && bond) t.bond = resizeBond(bond, t.rows, t.cols);
  return t;
};
const _builder = { open: false, tile: null, name: '' };
const _browserPatterns = () => { try { return JSON.parse(localStorage.getItem(USER_PATTERNS_KEY) || '[]') || []; } catch { return []; } };
/** Every saved pattern offered: the board's own + the browser's (the board's copy wins by id). */
function _userPatterns() {
  const own = Array.isArray(P.brickSettings.userPatterns) ? P.brickSettings.userPatterns : [];
  const ids = new Set(own.map((u) => u.id));
  return [...own, ..._browserPatterns().filter((u) => u && u.id && !ids.has(u.id))];
}
const _userPatternButtonId = (u) => `brickUserPattern_${String(u.id).replace(/^user:/, '')}`;
const _staggerOf = (base) => { const d = BRICK_PATTERNS[base]; return d && Number(d.staggerFrac) > 0 ? Number(d.staggerFrac) : (d && d.kind === 'course-alternating' ? 0.25 : 0); };
const _engineHas = (req) => !req || (ENGINE_OPTIONS || []).includes(req.engineOption);

export function openPatternBuilder() {
  if (!PATTERN_BUILDER_SCOPE.includes('wall')) return;
  const a = _accent();
  const base = BUILDER_BASES().includes(P.brickSettings.pattern) ? P.brickSettings.pattern : 'stretcher';
  _builder.tile = a.preset === ACCENT_TILE.id && a.tile ? _tileCopy(a.tile.rows, a.tile.cols, a.tile) : makeTile(ACCENT_TILE_LIMITS.rows, ACCENT_TILE_LIMITS.cols, null, { base });
  _builder.tile.base = _builder.tile.base || base;
  _builder.open = true;
  _builder.name = '';
  _disarmAccentClick();
  _applyBuilderTile('surface');
  renderPatternBuilder();
}
export function closePatternBuilder() {
  _builder.open = false;
  renderPatternBuilder();
  syncAccentControls();
}
export const patternBuilderState = () => (_builder.open ? { tile: _tileCopy(_builder.tile.rows, _builder.tile.cols, _builder.tile), name: _builder.name } : null);

/** The live preview: the wall's accent = the builder's tile; a base change re-lays the wall on that bond. */
function _applyBuilderTile(commit = 'surface') {
  const t = _builder.tile;
  const before = _cutsKey();
  P.brickSettings.accent = { ..._accent(), preset: ACCENT_TILE.id, tile: { rows: t.rows, cols: t.cols, cells: t.cells.map((r) => r.slice()), unit: t.unit, base: t.base,
    ...(isCustomBondTile(t) ? { bond: { courses: t.bond.courses.map((c) => ({ ...c, pieces: c.pieces.slice() })) } } : {}) } };
  const pattern = wallPatternOfBase(t.base); // 31e: a custom bond lays on the stretcher course grid
  if (P.brickSettings.pattern !== pattern) { P.brickSettings.pattern = pattern; syncWallPatternButtons(); commit = 'generate'; }
  _accentChanged(commit, before);
}
export function builderToggleCell(row, col) {
  if (!_builder.open || !_builder.tile.cells[row] || _builder.tile.cells[row][col] === undefined) return;
  if (isCustomBondTile(_builder.tile)) _builder.tile = bondTogglePiece(_builder.tile, row, col); // 31e: the whole piece
  else _builder.tile.cells[row][col] = !_builder.tile.cells[row][col];
  _applyBuilderTile();
  renderPatternBuilder();
}
/** 31e, the bond edits on a Custom base (one commit each = one undo step; the wall re-lays at once). */
const _bondEdit = (next) => {
  if (!_builder.open || !isCustomBondTile(_builder.tile)) return;
  const tile = next(_builder.tile);
  if (tile === _builder.tile) return; // nothing to join / split
  _builder.tile = tile;
  _applyBuilderTile();
  renderPatternBuilder();
};
/** Drag across cells `a`..`b` of a course: one brick. */
export const builderJoin = (row, a, b) => _bondEdit((t) => (t.bond.courses[row] ? bondJoin(t, row, a, b) : t));
/** Tap the joint before cell `col`: split the brick there. */
export const builderSplit = (row, col) => _bondEdit((t) => (t.bond.courses[row] ? bondSplit(t, row, col) : t));
/** Offset a course by `delta` cells (+ = right). */
export const builderShift = (row, delta) => _bondEdit((t) => (t.bond.courses[row] ? bondShift(t, row, delta) : t));
export function builderResize(rows, cols) {
  if (!_builder.open) return;
  _builder.tile = _tileCopy(rows, cols, _builder.tile);
  _applyBuilderTile();
  renderPatternBuilder();
}
export function builderSetBase(base) {
  if (!_builder.open || !BUILDER_BASES().includes(base)) return;
  _builder.tile.base = base;
  // 31e: Custom starts from a blank grid (every cell its own piece); a built-in base drops the custom bond
  if (base === BOND_CUSTOM) _builder.tile.bond = blankBond(_builder.tile.rows, _builder.tile.cols);
  else delete _builder.tile.bond;
  _applyBuilderTile('generate');
  renderPatternBuilder();
}
export function builderSetUnit(unit) {
  const u = ACCENT_TILE_UNITS.find((x) => x.id === unit);
  if (!_builder.open || !u || !_engineHas(u.requires)) return;
  _builder.tile.unit = unit;
  _applyBuilderTile();
  renderPatternBuilder();
}
/** Start from a built-in preset: its tile (tileOf), copied into the builder -- the preset itself stays. */
export function builderStartFrom(presetId) {
  const preset = ACCENT_PRESETS.find((x) => x.id === presetId);
  const t = preset && tileOf(preset);
  if (!_builder.open || !t) return;
  _builder.tile = _tileCopy(t.rows, t.cols, t, { base: _builder.tile.base, unit: _builder.tile.unit, bond: _builder.tile.bond });
  _applyBuilderTile();
  renderPatternBuilder();
}
/** Save: a pattern of its own (with the project + in this browser), shown in the Wall pattern grid. */
export function builderSave(name) {
  if (!_builder.open) return null;
  const before = _cutsKey();
  const u = userPatternFrom(name || _builder.name || 'My pattern', _builder.tile, _accent().levelIn);
  const keep = (list) => [...list.filter((x) => x && x.id !== u.id), u];
  P.brickSettings.userPatterns = keep(Array.isArray(P.brickSettings.userPatterns) ? P.brickSettings.userPatterns : []);
  try { localStorage.setItem(USER_PATTERNS_KEY, JSON.stringify(keep(_browserPatterns()))); } catch { /* private mode: the project still has it */ }
  P.brickSettings.accent = { ...accentOfUserPattern(u), clicks: _accent().clicks || [] };
  _builder.open = false;
  renderWallPatternList(document.getElementById('brickPatternList'));
  renderPatternBuilder();
  _accentChanged('surface', before);
  return u;
}
/** A saved pattern picked in the Wall grid: bond + its accent tile + level at once. */
export function applyUserPattern(id) {
  const u = _userPatterns().find((x) => x.id === id);
  if (!u) return;
  _disarmAccentClick();
  P.brickSettings.accent = { ...accentOfUserPattern(u), clicks: _accent().clicks || [] };
  P.brickSettings.pattern = wallPatternOfBase(P.brickSettings.accent.tile.base); // 31e: a custom bond on the stretcher grid
  syncWallPatternButtons();
  syncSetPicker();
  _accentChanged('generate');
}

/** 31e: press on a cell, move across its course, release: a drag over 2+ cells JOINS them into one brick, a press and
 *  release on one cell raises its brick. Pointer capture is released so a touch drag reaches the cells it crosses. */
let _drag = null;
function _dragJoin(cell, row, col) {
  cell.addEventListener('pointerdown', (e) => {
    try { if (e.pointerId != null && cell.releasePointerCapture) cell.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    _drag = { row, from: col, to: col };
    const done = () => {
      window.removeEventListener('pointerup', done);
      const d = _drag; _drag = null;
      if (!d) return;
      if (d.to === d.from) builderToggleCell(d.row, d.from); else builderJoin(d.row, Math.min(d.from, d.to), Math.max(d.from, d.to));
    };
    window.addEventListener('pointerup', done);
  });
  cell.addEventListener('pointerenter', () => { if (_drag && _drag.row === row) _drag.to = col; });
}

export function renderPatternBuilder() {
  const box = document.getElementById('brickPatternBuilder');
  if (!box) return;
  box.style.display = _builder.open ? '' : 'none';
  if (!_builder.open) { box.innerHTML = ''; return; }
  const t = _builder.tile;
  const L = ACCENT_TILE_LIMITS;
  box.innerHTML = '';
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; };
  const label = (text) => el('div', 'font-size:10px; font-weight:600; opacity:0.7; margin:6px 0 3px;', text);
  // base pattern (31c): the coursed bonds as engine-drawn icons
  box.appendChild(label('Base pattern'));
  const bases = el('div', 'display:flex; gap:4px; flex-wrap:wrap;');
  for (const id of BUILDER_BASES()) {
    const b = el('button', 'padding:2px; min-width:0; height:auto; line-height:0;');
    b.type = 'button'; b.className = 'cad-btn' + (id === t.base ? ' active' : ''); b.id = `brickBuilderBase_${id}`;
    if (id === BOND_CUSTOM) {
      b.style.cssText = 'padding:2px 6px; min-width:0; font-size:11px;';
      b.textContent = 'Custom'; b.title = 'Custom bond: start from a blank grid -- drag across cells to join them into one brick, tap a joint to split it';
    } else { b.title = _patternLabel(id); b.innerHTML = wallPatternIconSvg(id) || _patternLabel(id); }
    b.addEventListener('click', () => builderSetBase(id));
    bases.appendChild(b);
  }
  box.appendChild(bases);
  // unit (31b): 1 | 1/2 | 1/4 -- the fractions hidden until the engine cuts bricks for them
  box.appendChild(label('Unit (of a brick)'));
  const units = el('div', 'display:flex; gap:4px;');
  for (const u of ACCENT_TILE_UNITS) {
    const b = el('button', 'flex:1; min-width:0; padding-left:0; padding-right:0;', u.label); // 31b: three fit the panel (measured: 3 x 75 px overflowed 162)
    b.type = 'button'; b.className = 'cad-btn' + (u.id === t.unit ? ' active' : ''); b.title = u.title;
    b.id = `brickBuilderUnit_${{ 1: 'whole', 0.5: 'half', 0.25: 'quarter' }[u.id]}`;
    if (!_engineHas(u.requires)) b.style.display = 'none';
    b.addEventListener('click', () => builderSetUnit(u.id));
    units.appendChild(b);
  }
  box.appendChild(units);
  // size: courses x bricks, 2..8 each
  const size = el('div', 'display:flex; flex-wrap:wrap; gap:6px 10px; margin:6px 0;');
  const unit = t.unit || 1, custom = isCustomBondTile(t), cut = unit < 1 || custom; // 31b: at 1/2 or 1/4 a column is that fraction of a brick
  for (const [key, text, val] of [['rows', 'Courses', t.rows], ['cols', cut ? 'Cells' : 'Bricks', t.cols]]) {
    const w = el('div', 'display:flex; align-items:center; gap:4px; font-size:11px;', '');
    w.appendChild(el('span', '', text));
    for (const [d, sym] of [[-1, '-'], [1, '+']]) {
      const b = el('button', 'width:22px; min-width:0; padding:0;', sym);
      b.type = 'button'; b.className = 'cad-btn'; b.id = `brickBuilder_${key}_${d > 0 ? 'more' : 'less'}`;
      b.disabled = (d < 0 && val <= L.min) || (d > 0 && val >= L.max);
      b.addEventListener('click', () => (key === 'rows' ? builderResize(t.rows + d, t.cols) : builderResize(t.rows, t.cols + d)));
      if (d < 0) w.appendChild(b);
      else { w.appendChild(el('span', 'width:14px; text-align:center;', String(val))); w.appendChild(b); }
    }
    size.appendChild(w);
  }
  box.appendChild(size);
  // the tile: row 0 = the BOTTOM course; caps at ~16 cells across and zooms (the cell width shrinks to fit), scrolling
  // beyond. At 1 a cell is a brick, staggered per the base (accentGrid's half-bond rule); at 1/2 or 1/4 a cell is that
  // fraction of a brick on the engine's own grid (accentCuts: columns from the wall's left edge, no stagger), drawn
  // that fraction of a brick wide
  const OFFSET_COL = 30; // 31e: the course offsets' column (2 x 12 px buttons), reserved so the cells shrink instead
  const avail = custom ? Math.max(60, (box.clientWidth || 200) - 18 - OFFSET_COL) : Math.max(120, (box.clientWidth || 200) - 18);
  const stagger = cut ? 0 : _staggerOf(t.base), gap = custom ? 4 : 2; // 31e: a joint wide enough to tap
  const cw = Math.max(9, Math.min(30 * unit, avail / (Math.min(t.cols, L.maxCellsAcross) + stagger) - gap)); // the stagger's half brick too
  const ch = Math.max(8, Math.round(Math.min(30, (cw + gap) / unit) * 0.45)); // a course is as high as a whole brick reads
  const grid = el('div', `position:relative; height:${t.rows * (ch + gap)}px; width:${(t.cols + stagger) * (cw + gap) + (custom ? OFFSET_COL : 0)}px; margin:4px 0 8px;`);
  grid.id = 'brickBuilderTile';
  const wrap = el('div', 'overflow-x:auto;');
  const fill = (on) => (on ? 'background:#8e2f1c; box-shadow:1px 1px 0 #2b1a14;' : 'background:#d07a5c; opacity:0.85;');
  for (let r = 0; r < t.rows; r++) {
    const shift = (r % 2) * stagger * (cw + gap);
    const top = (t.rows - 1 - r) * (ch + gap);
    const pieceOf = custom ? pieceOfCells(t.bond.courses[r], t.cols) : null;
    for (let i = 0; i < t.cols; i++) {
      const on = t.cells[r][i];
      const c = el('button', `position:absolute; left:${shift + i * (cw + gap)}px; top:${top}px; width:${cw}px; height:${ch}px; padding:0; min-width:0; border:0; border-radius:2px; cursor:pointer; `
        + fill(on));
      c.type = 'button'; c.id = `brickBuilderCell_${r}_${i}`; c.title = `course ${r + 1}, ${cut ? 'cell' : 'brick'} ${i + 1}`;
      if (custom) _dragJoin(c, r, i);
      else c.addEventListener('click', () => builderToggleCell(r, i));
      grid.appendChild(c);
      // 31e: inside a piece the gap before a cell is a JOINT handle drawn in the piece's colour (the piece reads as one
      // brick); tapping it splits the brick there. Between pieces the gap stays open (a real joint).
      if (custom && i > 0 && pieceOf[i] === pieceOf[i - 1]) {
        const j = el('button', `position:absolute; left:${shift + i * (cw + gap) - gap - 1}px; top:${top}px; width:${gap + 2}px; height:${ch}px; padding:0; min-width:0; border:0; cursor:col-resize; z-index:1; ` + fill(on));
        j.type = 'button'; j.id = `brickBuilderJoint_${r}_${i}`; j.title = 'Split the brick here';
        j.addEventListener('click', () => builderSplit(r, i));
        grid.appendChild(j);
      }
    }
    if (custom) { // 31e: offset this course by one cell
      for (const [d, sym, side] of [[-1, '‹', 'left'], [1, '›', 'right']]) {
        const o = el('button', `position:absolute; left:${t.cols * (cw + gap) + 4 + (d > 0 ? 14 : 0)}px; top:${top}px; width:12px; height:${ch}px; padding:0; min-width:0; font-size:10px; line-height:${ch}px;`, sym);
        o.type = 'button'; o.className = 'cad-btn'; o.id = `brickBuilderOffset_${r}_${side}`; o.title = `Offset course ${r + 1} ${side}`;
        o.addEventListener('click', () => builderShift(r, d));
        grid.appendChild(o);
      }
    }
  }
  wrap.appendChild(grid);
  box.appendChild(wrap);
  if (custom) box.appendChild(el('div', 'font-size:10px; opacity:0.7; margin:-4px 0 6px;', 'Tap a brick to raise it · drag across cells to join · tap a joint to split · ‹ › offset a course'));
  // start from a built-in preset (its tile; the preset itself stays)
  const from = el('select', 'width:100%; font-size:11px; margin-bottom:6px;');
  from.id = 'brickBuilderStartFrom';
  const opt = (text, value) => { const o = document.createElement('option'); o.textContent = text; o.value = value; return o; };
  from.appendChild(opt('Start from a preset…', ''));
  for (const preset of ACCENT_PRESETS) { const tt = tileOf(preset); if (tt) from.appendChild(opt(`${preset.label} (${tt.rows}x${tt.cols})`, preset.id)); }
  from.addEventListener('change', () => builderStartFrom(from.value));
  box.appendChild(from);
  // name + save / close
  // the name on its own line, Save + Close sharing the next (measured: in one row the name field was 8 px wide)
  const row = el('div', 'display:flex; flex-wrap:wrap; gap:4px;');
  const name = el('input', 'flex:1 1 100%; min-width:0; font-size:11px;');
  name.id = 'brickBuilderName'; name.placeholder = 'Name'; name.value = _builder.name;
  name.addEventListener('input', () => { _builder.name = name.value; });
  const save = el('button', 'flex:1; min-width:0;', 'Save'); save.type = 'button'; save.className = 'cad-btn cad-btn-primary'; save.id = 'brickBuilderSave';
  save.addEventListener('click', () => builderSave(name.value));
  const close = el('button', 'flex:1; min-width:0;', 'Close'); close.type = 'button'; close.className = 'cad-btn'; close.id = 'brickBuilderClose';
  close.addEventListener('click', () => closePatternBuilder());
  row.append(name, save, close);
  box.appendChild(row);
}

/** Custom: arm (or disarm) the canvas click mode. Each click toggles the brick under it -- stored as a
 *  POINT (brick-accents.js toggleAccentClick), so it follows a re-lay to whichever brick lies there. */
export function toggleAccentClickMode(target = { kind: 'wall' }) {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) return;
  const same = _accentClickArmed && JSON.stringify(_accentClickTarget) === JSON.stringify(target);
  if (_accentClickArmed) _disarmAccentClick();
  if (same) return;
  _accentClickArmed = true;
  _accentClickTarget = target;
  const acc = ELEMENT_ACCENTS[target.kind];
  editor._brickAccentClick = (pt) => {
    const a = acc.get(target);
    acc.set(target, { ...a, preset: ACCENT_CUSTOM.id, clicks: toggleAccentClick(a.clicks || [], pt, acc.bricks(editor, target)) });
    _accentChanged('surface');
  };
  const before = _cutsKey(); // Click bricks over a CUT tile: the wall goes back to whole bricks
  acc.set(target, { ...acc.get(target), preset: ACCENT_CUSTOM.id });
  editor.setMode('brickAccentClick');
  _accentChanged('surface', before);
}

/* Per-element ACCENTS (advisor: Frame bands + Brush strokes, like the Wall): where each element's accent lives and
 * which bricks Click bricks hits, declared once. The Wall's keeps its own row + the builder; a band / the Brush get
 * the periodic presets + Click bricks (no Custom: PATTERN_BUILDER_SCOPE). */
const _runPolys = (editor, sel) => [...(editor?._sketchLayer?.node?.querySelectorAll?.(sel) || [])].map((n) => ({
  polygon: (n.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((p) => { const [x, y] = p.split(',').map(Number); return { x, y }; }) }));
const ELEMENT_ACCENTS = {
  wall: { get: () => _accent(), set: (t, a) => { P.brickSettings.accent = a; }, bricks: (editor) => wallBrickPolygons(editor) },
  frameBand: {
    get: (t) => ({ ...DEFAULT_ACCENT, ...((P.brickSettings.frameBandAccents || [])[t.band] || {}) }),
    set: (t, a) => { const list = [...(P.brickSettings.frameBandAccents || [])]; list[t.band] = a; P.brickSettings.frameBandAccents = list; },
    bricks: (editor, t) => _runPolys(editor, `[data-brick-gen="1"][data-brick="frame"][data-brick-band="${t.band}"]`),
  },
  brush: {
    get: () => ({ ...DEFAULT_ACCENT, ...(P.brickSettings.brushAccent || {}) }),
    set: (t, a) => { P.brickSettings.brushAccent = a; },
    bricks: (editor) => _runPolys(editor, '[data-brick-gen="1"][data-brick="brush"]'),
  },
};
let _accentClickTarget = { kind: 'wall' };
const _targetKey = (t) => (t.kind === 'frameBand' ? `band${t.band}` : t.kind);

/** An element's accent preset / level (Frame band i, the Brush): the same rules as the Wall's. */
export function setElementAccent(target, patch, commit = 'surface') {
  const acc = ELEMENT_ACCENTS[target.kind];
  if (!acc) return;
  const next = { ...acc.get(target), ...patch };
  if ('levelIn' in patch) next.levelIn = clampAccentLevel(patch.levelIn);
  if (patch.preset && patch.preset !== ACCENT_CUSTOM.id && _accentClickArmed && _targetKey(_accentClickTarget) === _targetKey(target)) _disarmAccentClick();
  acc.set(target, next);
  renderElementAccentRows();
  _accentChanged(commit);
}

/** One Accent row (None + the presets as engine icons, the name as tooltip; Click bricks; the signed level) for a
 *  non-Wall element, ids prefixed per element: brickAccent_<key>_<preset>, brickAccentClick_<key>, brickAccentLevel_<key>. */
function renderAccentRowFor(container, target, iconPx) {
  const key = _targetKey(target);
  const a = ELEMENT_ACCENTS[target.kind].get(target);
  const row = document.createElement('div');
  row.className = 'brick-element-accent';
  row.dataset.accentFor = key;
  row.style.cssText = 'display:flex; gap:3px; flex-wrap:wrap; align-items:center; margin:2px 0 6px;';
  const label = document.createElement('span');
  label.textContent = 'Accent';
  label.style.cssText = 'font-size:10px; opacity:0.65; width:44px; flex:0 0 auto;';
  row.appendChild(label);
  for (const choice of ACCENT_CHOICES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-accent-icon' + (a.preset === choice.id ? ' active' : '');
    btn.id = `brickAccent_${key}_${choice.id}`;
    btn.title = choice.label;
    btn.setAttribute('aria-label', choice.label);
    btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = choice.id === 'none' ? '<span style="font-size:9px; line-height:16px; padding:0 3px;">None</span>' : (accentIconSvg(choice.id, iconPx, { sunk: a.levelIn < 0 }) || choice.label);
    btn.addEventListener('click', () => setElementAccent(target, { preset: choice.id }));
    row.appendChild(btn);
  }
  const click = document.createElement('button');
  click.type = 'button';
  click.className = 'cad-btn' + (a.preset === ACCENT_CUSTOM.id && _accentClickArmed && _targetKey(_accentClickTarget) === key ? ' active' : '');
  click.id = `brickAccentClick_${key}`;
  click.textContent = 'Click';
  click.title = 'Click bricks of this element on the canvas to raise / sink them';
  click.style.cssText = 'font-size:10px; padding:0 6px; min-width:0;';
  click.addEventListener('click', () => toggleAccentClickMode(target));
  row.appendChild(click);
  if (a.preset !== 'none') {
    const level = document.createElement('input');
    level.type = 'number'; level.id = `brickAccentLevel_${key}`; level.value = String(a.levelIn);
    level.min = String(ACCENT_LEVEL_RANGE.min); level.max = String(ACCENT_LEVEL_RANGE.max); level.step = String(ACCENT_LEVEL_RANGE.step);
    level.title = 'Accent level (in): + raises, - sinks';
    level.style.cssText = 'width:64px; font-size:10px;';
    level.addEventListener('change', () => setElementAccent(target, { levelIn: level.value }));
    row.appendChild(level);
  }
  container.appendChild(row);
}
/** Re-render every non-Wall element's Accent row (the Frame bands' + the Brush's). */
function renderElementAccentRows() {
  renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
  syncFrameBandPatternButtons();
  const brush = document.getElementById('brickBrushAccentRow');
  if (brush) { brush.innerHTML = ''; renderAccentRowFor(brush, { kind: 'brush' }, 22); }
}

function _disarmAccentClick() {
  if (!_accentClickArmed) return;
  _accentClickArmed = false;
  _accentClickTarget = { kind: 'wall' };
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor && editor._currentMode === 'brickAccentClick') editor.setMode('select');
  syncAccentControls();
}

function syncElementLevels() {
  const levels = P.brickSettings.elementLevelIn || {};
  for (const kind of BRICK_KINDS) {
    const el = document.getElementById(`brickLevel_${kind}`);
    if (el && document.activeElement !== el) el.value = levels[kind] || 0;
  }
}

/** Audit C6: the Stripe panel in the Brick tab -- its A/B/C slots pick a brick STYLE (thumbnails from
 *  BRICK_STRIPE_STYLES), Artwork's colour swatches/presets/reset are hidden. Elsewhere it is untouched. */
const STRIPE_SLOTS = ['A', 'B', 'C'];
const _thumbOf = (style) => { const set = brickSetById(style.setId); return set && set.samples && set.samples[0] ? set.samples[0].image : ''; };

function renderStripeBrickStyles(container) {
  if (!container) return;
  container.innerHTML = '';
  STRIPE_SLOTS.forEach((slot, i) => {
    const row = document.createElement('div');
    row.id = `stripeBrickSlot_${slot}`;
    row.style.cssText = 'display:flex; align-items:center; gap:4px;';
    const tag = document.createElement('span');
    tag.textContent = slot;
    tag.style.cssText = 'width:12px; font-weight:600;';
    row.appendChild(tag);
    for (const style of BRICK_STRIPE_STYLES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `stripeBrickStyle_${slot}_${style.id}`;
      btn.title = style.label;
      btn.className = 'stripe-brick-style-btn';
      btn.style.cssText = 'flex:1; height:30px; padding:2px; border:1px solid #ccc; border-radius:3px; background:#fff; cursor:pointer; position:relative;';
      const img = document.createElement('img');
      img.src = _thumbOf(style);
      img.alt = style.label;
      img.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;'
        + (style.profile === 'continuous' ? ' filter:blur(0.6px) saturate(0.85);' : '');
      btn.appendChild(img);
      if (style.profile === 'continuous') {
        const band = document.createElement('span'); // "one band": no joints
        band.textContent = '=';
        band.style.cssText = 'position:absolute; right:2px; bottom:0; font-size:10px; font-weight:700; color:#fff; text-shadow:0 0 2px #000;';
        btn.appendChild(band);
      }
      btn.addEventListener('click', () => setStripeStyle(i, style.id));
      row.appendChild(btn);
    }
    container.appendChild(row);
  });
}

function syncStripeBrickStyles() {
  const picks = P.brickSettings.stripeStyles || DEFAULT_STRIPE_STYLE_PICKS;
  const useC = !!document.getElementById('stripeThree')?.checked;
  STRIPE_SLOTS.forEach((slot, i) => {
    const row = document.getElementById(`stripeBrickSlot_${slot}`);
    if (row) row.style.display = i < 2 || useC ? 'flex' : 'none';
    for (const style of BRICK_STRIPE_STYLES) {
      const btn = document.getElementById(`stripeBrickStyle_${slot}_${style.id}`);
      if (!btn) continue;
      const on = (picks[i] || DEFAULT_STRIPE_STYLE_PICKS[i]) === style.id;
      btn.classList.toggle('active', on);
      btn.style.outline = on ? '2px solid #0078d4' : 'none';
    }
  });
}

function syncStripePanelContext() {
  const brick = getEditorTab() === 'brick';
  const show = (id, on, display = '') => { const el = document.getElementById(id); if (el) el.style.display = on ? display : 'none'; };
  show('stripeColorPresets', !brick, 'flex');
  show('stripeColorSwatches', !brick, 'flex');
  show('stripeColorsReset', !brick);
  show('stripeBrickStyles', brick, 'flex');
  const label = document.getElementById('stripeColoursLabel');
  if (label) label.textContent = brick ? 'Brick styles' : 'Colours';
  const hint = document.getElementById('stripeTargetHint');
  if (hint) {
    if (hint.dataset.artworkText == null) hint.dataset.artworkText = hint.textContent;
    hint.textContent = brick ? 'Tap a brush stroke to split it into runs; each run takes brick style A / B (/ C), in order. Tap it again to re-stripe.' : hint.dataset.artworkText;
  }
  if (brick) syncStripeBrickStyles();
}

/** Audit C6: pick slot `slot`'s (0 = A) brick style. Brush strokes only (never pending the Wall/Frame);
 *  re-commits so every striped run shows the new pick at once (regenerateOwnedBrickElements on commit). */
export function setStripeStyle(slot, styleId) {
  if (!BRICK_STRIPE_STYLES.some((s) => s.id === styleId)) return;
  const picks = [...(P.brickSettings.stripeStyles || DEFAULT_STRIPE_STYLE_PICKS)];
  picks[slot] = styleId;
  P.brickSettings.stripeStyles = picks;
  syncStripeBrickStyles();
  notifyChange();
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor) { editor._brickSettings = P.brickSettings; commitEdit(editor); }
}

/** turn 201: the Raised brush's modes, declared. 'grout' needs the engine's grout cut (BRICK_CONTROL_REQUIRES
 *  hides it until core/bricks ENGINE_OPTIONS lists 'groutCut'). */
const RAISED_BRUSH_MODES = [
  { id: 'bricks', label: 'Raised bricks', title: 'Lay bricks along the stroke, proud of the others by Level' },
  { id: 'grout', label: 'Grout cut', title: 'Cut grout joints through the existing bricks wherever the stroke goes' },
];

function renderRaisedModeToggle(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const mode of RAISED_BRUSH_MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'relief-toggle-btn';
    btn.id = `brickRaisedMode_${mode.id}`;
    btn.title = mode.title;
    const span = document.createElement('span');
    span.textContent = mode.label;
    btn.appendChild(span);
    btn.addEventListener('click', () => setRaisedMode(mode.id));
    container.appendChild(btn);
  }
}

function syncRaisedSection() {
  for (const mode of RAISED_BRUSH_MODES) {
    const btn = document.getElementById(`brickRaisedMode_${mode.id}`);
    if (!btn) continue;
    btn.classList.toggle('active', mode.id === P.brickSettings.raisedMode);
    btn.style.display = _hiddenUntilMet(btn.id) ? 'none' : '';
  }
  const lvl = document.getElementById('brickRaisedLevel');
  if (lvl && document.activeElement !== lvl) lvl.value = Number.isFinite(P.brickSettings.raisedLevelIn) ? P.brickSettings.raisedLevelIn : 0.0625;
}

/** turn 201: a Raised-brush setting -- read at the next stroke (frozen per stroke), never pending the Wall. */
export function setRaisedMode(modeId) {
  if (!RAISED_BRUSH_MODES.some((m) => m.id === modeId) || _hiddenUntilMet(`brickRaisedMode_${modeId}`)) return;
  P.brickSettings.raisedMode = modeId;
  syncRaisedSection();
  commitBrickSetting('settings');
}

export function setBrickTopMode(mode, commit = 'surface') {
  P.brickSettings.brickTopMode = mode === 'flat' ? 'flat' : 'organic';
  syncBrickTopToggle();
  commitBrickSetting(commit);
}

/** F35 item 18 (2): the Surface style toggle, one button per declared BRICK_SURFACE_STYLES entry. */
function renderSurfaceStyleToggle(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const style of Object.values(BRICK_SURFACE_STYLES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'relief-toggle-btn';
    btn.id = `brickSurfaceStyle_${style.id}`;
    btn.title = style.title;
    const label = document.createElement('span');
    label.textContent = style.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => setSurfaceStyle(style.id));
    container.appendChild(btn);
  }
}

function syncSurfaceStyleToggle() {
  const current = surfaceStyleById(P.brickSettings.surfaceStyle);
  for (const style of Object.values(BRICK_SURFACE_STYLES)) {
    document.getElementById(`brickSurfaceStyle_${style.id}`)?.classList.toggle('active', style.id === current.id);
  }
  // the Wear slider shows only for a style that declares `wear` (Weathered)
  const row = document.getElementById('brickSurfaceWearRow');
  if (row) row.style.display = current.wear ? '' : 'none';
  if (current.wear) {
    const w = Number.isFinite(P.brickSettings.surfaceWear) ? P.brickSettings.surfaceWear : current.wear.default;
    setPair('brickSurfaceWearSlider', 'brickSurfaceWear', w);
  }
}

export function setSurfaceStyle(styleId, commit = 'surface') {
  const style = surfaceStyleById(styleId);
  P.brickSettings.surfaceStyle = style.id;
  // the style's declared grout profile (Weathered -> Recessed); a style without one restores what it replaced
  const s = P.brickSettings;
  if (style.groutProfile) {
    if (s.grout.profile !== style.groutProfile) {
      if (s.groutProfileBeforeStyle == null) s.groutProfileBeforeStyle = s.grout.profile;
      _writeGroutProfile(style.groutProfile);
    }
  } else if (s.groutProfileBeforeStyle != null) {
    _writeGroutProfile(s.groutProfileBeforeStyle);
    delete s.groutProfileBeforeStyle;
  }
  syncSurfaceStyleToggle();
  commitBrickSetting(commit);
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
  commitBrickSetting('settings');
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
  commitBrickSetting('settings');
}

/** Shows ONLY the active tool's own settings section (BRICK_TOOLS' own declared
 *  `settingsSection`), hides every other tool's -- Scissors/Stripe have none (null), so
 *  selecting either hides Brush/Wall/Frame's sections with nothing of their own to show. */
/** Turn 197 + F35 item 43: the shared rows by their declared scope (BRICK_ROW_SCOPES): global rows in the General
 *  tab only; element rows in a tool's tab unless the tool declares `sharedRows: false`. */
function syncToolSections() {
  const general = activeBrickTab() === BRICK_GENERAL_TAB.id;
  for (const tool of BRICK_TOOLS) {
    if (!tool.settingsSection) continue;
    const el = document.getElementById(tool.settingsSection);
    if (el) el.style.display = !general && tool.id === _activeTool ? '' : 'none';
  }
  const active = BRICK_TOOLS.find((t) => t.id === _activeTool);
  const elementRows = !general && !!active && active.sharedRows !== false;
  for (const [id, scope] of Object.entries(BRICK_ROW_SCOPES)) {
    const el = document.getElementById(id);
    const on = scope === 'global' ? general : scope === 'element' ? elementRows : general || elementRows;
    if (el) el.style.display = on ? '' : 'none';
  }
  const hint = document.getElementById('brickToolHint');
  if (hint) hint.style.display = general ? 'none' : '';
  // Brick-tab v2: the active tab's own sections (and the shared rows moved into them)
  applyBrickTabSections(general ? BRICK_GENERAL_TAB.id : _activeTool);
}

/** F35 item 21: the Large stones row shows only while the Wall's layout is fieldstone. */
const _hiddenUntilMet = (id) => {
  const rule = BRICK_CONTROL_REQUIRES.find((r) => r.hides && r.controls.includes(id));
  return !!rule && !requirementMet(rule.requires, document.getElementById(rule.requires.control), { engineOptions: ENGINE_OPTIONS });
};

/** F35 item 29 (a): the Rustic rows -- hidden until the engine lists 'rustic'; the Wall's only for a running bond
 *  (isRunningBond), the Brush's always (a stroke is a run). One value per element: rusticByElement. */
const RUSTIC_ELEMENTS = ['wall', 'brush'];
const _rustic = (kind) => Number((P.brickSettings.rusticByElement || {})[kind]) || 0;
function syncRusticRows() {
  for (const kind of RUSTIC_ELEMENTS) {
    const row = document.getElementById(`brickRusticRow_${kind}`);
    const applies = kind !== 'wall' || isRunningBond(P.brickSettings.pattern);
    if (row) row.style.display = applies && !_hiddenUntilMet(`brickRusticRow_${kind}`) ? '' : 'none';
    setPair(`brickRusticSlider_${kind}`, `brickRustic_${kind}`, _rustic(kind));
  }
}
export function setRustic(kind, value, phase = 'onRelease') {
  const v = Math.max(0, Math.min(1, Number(value)));
  if (!Number.isFinite(v) || !RUSTIC_ELEMENTS.includes(kind)) return;
  P.brickSettings.rusticByElement = { ...(P.brickSettings.rusticByElement || {}), [kind]: v };
  setPair(`brickRusticSlider_${kind}`, `brickRustic_${kind}`, v);
  // the Wall re-lays; a Brush value only applies to strokes drawn from now on (each freezes its own)
  if (kind === 'wall') commitBrickSetting('generate', phase); else commitBrickSetting('settings', phase);
}

function syncLargeStonesRow() {
  const row = document.getElementById('brickLargeStonesRow');
  // fieldstone walls only, AND only once the engine honours the option (turn 199: never a dead control)
  if (row) row.style.display = wallLayoutFor(P.brickSettings) === 'fieldstone' && !_hiddenUntilMet('brickLargeStonesRow') ? '' : 'none';
  setPair('brickLargeStonesSlider', 'brickLargeStones', Number.isFinite(P.brickSettings.largeStones) ? P.brickSettings.largeStones : 0.5);
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
  // item 68 (audit: after Undo the brush accent row / Stripe styles kept showing the undone pick, the settings were back)
  renderElementAccentRows(); syncStripeBrickStyles(); syncBrushPresetButtons(); syncRusticRows();
  syncSetPicker();
  syncFramePresetButtons();
  syncWallPatternButtons();
  renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
  syncFrameBandPatternButtons();
  syncBrickSizeControls(s.brickLengthIn);
  syncBrickSizePresetButtons();
  syncGroutWidthBox();
  syncGroutPaintRow(); // item 55
  document.getElementById('brickGroutDepth').value = s.grout.depthIn;
  document.getElementById('brickBtnGroutRecessed')?.classList.toggle('active', s.grout.profile === 'recessed');
  document.getElementById('brickBtnGroutFlush')?.classList.toggle('active', s.grout.profile === 'flush');
  syncReliefToggle();
  syncControlRequires();
  syncRaisedSection();
  syncBrickTopToggle();
  syncSurfaceStyleToggle();
  syncElementLevels();
  syncAccentControls();
  setPair('brickReliefHeightSlider', 'brickReliefHeight', s.reliefIn);
  setPair('brickSuppressionSlider', 'brickSuppression', s.suppression);
  setPair('brickClumpingSlider', 'brickClumping', s.clumping);
  setPair('brickTopBiasSlider', 'brickTopBias', topBiasOf(s)); // item 9
  syncFrameCrumble();
  syncWindowSurround();
  document.getElementById('brickSeed').value = s.seed;
  syncProfileToggle();
  syncOrientationToggle();
  syncToolSections();
}

/** F35 item 10 follow-up (Fred, folded in with the slider-timing ask): an 'auto'-committed brick
 *  slider (the main sidebar's -- BRICK_COMMIT below) regenerates on RELEASE ('change': blur/Enter/
 *  mouse-up), not on every raw drag tick ('input'), WITH a live, throttled 2D-only preview while
 *  dragging. The editor Brick tab's own sliders are 'generate' bindings: no preview, no re-lay,
 *  they only mark Generate pending (audit K4: this header used to describe them as re-laying).
 *  Declared ONCE here -- every bindSlider call site below shares this one mechanism. Wall/Frame only: a Brush stroke's own settings are frozen at
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
  runBricksPreview(editor, P.brickSettings, frameGeom, _kindsToLay(editor, frameGeom)); // Wall: frameGeom may be undefined (whole-board fill)
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

/** How a brick-setting change is committed -- declared per control binding, never an ad-hoc if at the call
 *  site. Same P.brickSettings underneath.
 *  - 'auto' (a LAYOUT setting): the change re-lays straight away (brick layout + layer tooling -> height/3D,
 *    via runBricks), with the live 2D preview while a slider drags.
 *  - 'generate' = 'auto'. F35 item 27 (Fred, 2026-10-04 evening, reversing the morning's "the editor waits for
 *    Generate"): the editor Brick tab re-lays at once exactly like the sidebar. The name stays: it is what the
 *    editor's bindings declare (their entry point), it simply commits the same way. Nothing is ever pending;
 *    the Generate button is "re-lay now".
 *  onDrag = a slider/field's raw 'input' tick; onRelease = a slider's 'change' or a discrete click. */
const AUTO_COMMIT = {
  onDrag: () => { notifyChange(); _scheduleLivePreview(); },
  onRelease: () => { notifyChange(); _relayOnRelease(); },
};

/** Blind-spot audit B8 + F35 item 41 (Fred: "the screen looks frozen"): the lay is synchronous, so its 'bricks' stage
 *  can only paint if it is shown FIRST and the lay runs after it. EVERY re-lay a gesture causes does that (advisor,
 *  after item 41 measured lays the old 300 ms prediction missed: Generate on a new Wall+Frame mix 747 ms, a rock set ->
 *  new pattern 1.6 s, both at CPU x10, nothing shown). One queued lay reads the LATEST settings when it runs. */
let _relayQueued = null; // the queued lay's options
function _relayStaged(opts = {}) {
  if (_relayQueued) { _relayQueued = { amend: _relayQueued.amend || opts.amend || null }; return; }
  _relayQueued = { amend: opts.amend || null };
  const closeHoldStage = _takeBoardRelayHold(); // a board-size re-lay: its stage closes once the lay has committed
  withLoadingStageShownFirst('bricks', () => {
    try { const o = _relayQueued; _relayQueued = null; generateBricks(o); flushControlRequires(); } finally { closeHoldStage(); }
  });
}
function _relayOnRelease() { _relayStaged(); }
const BRICK_COMMIT = {
  generate: AUTO_COMMIT,
  auto: AUTO_COMMIT,
  // F35 item 18: a 3D-only setting (SURFACE_ONLY_SETTING_KEYS below) -- the 2D layout is unchanged,
  // so nothing to re-lay and nothing pending: just re-mask the heights through the editor's own
  // change pipeline (main/app-init.js onChange -> refreshAllStampMasks), from either entry point.
  // a drag tick only saves; the re-mask (the expensive height pass) runs once on release
  surface: {
    onDrag: () => { notifyChange(); },
    onRelease: () => { notifyChange(); _remaskSurface(); },
  },
  // item 68 (advisor, item 38's precedent): a setting for the NEXT stroke (Brush profile / orientation / preset /
  // rustic, Raised level / mode) changes no canvas, but it is still an undo step of its own -- before, Undo right after
  // one took back the previous canvas edit (the last stroke) and left the setting. One push, nothing re-laid.
  settings: {
    onDrag: () => { notifyChange(); },
    onRelease: () => { notifyChange(); _settingsStep(); },
  },
};

function _settingsStep() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor && typeof editor.pushState === 'function') commitEdit(editor); // the entry carries the settings (item 38)
}

function _remaskSurface() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  // F35 item 38: a 3D-only change is an undo step of its own too (its entry carries the settings; the canvas is the
  // same) -- commitEdit = push + the same commit pipeline the bare _notifyChange ran
  if (editor && typeof editor.pushState === 'function') commitEdit(editor);
  else if (editor && typeof editor._notifyChange === 'function') editor._notifyChange('commit');
}

/** F35 item 38: the brick SETTINGS ride in every editor undo entry (editor/undo-parts.js), so Undo / Redo put back the
 *  settings that laid the canvas they restore -- every brick element setting at once (pattern, set, unit, accent +
 *  builder tile, level, rustic, rotation, area width ...), one stack. BRICK_UNDO_KEEPS = what an undo never takes back:
 *  the saved patterns are a library the user keeps, not an edit of this canvas. Restoring replaces P.brickSettings and
 *  announces it ('brickSettingsRestored': the panel re-syncs, no re-lay -- the canvas came back with the entry). */
export const BRICK_UNDO_KEEPS = Object.freeze(['userPatterns']);
const _cloneSettings = (s) => (typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s)));
function _takeBrickSettings() {
  const s = _cloneSettings(P.brickSettings || {});
  for (const k of BRICK_UNDO_KEEPS) delete s[k];
  return s;
}
function _restoreBrickSettings(snap) {
  if (!snap) return;
  const keep = Object.fromEntries(BRICK_UNDO_KEEPS.filter((k) => P.brickSettings && k in P.brickSettings).map((k) => [k, P.brickSettings[k]]));
  P.brickSettings = { ..._cloneSettings(snap), ...keep };
  // the open builder follows the restored accent (its tile), or closes when the accent is no longer a tile
  if (_builder.open) {
    const a = P.brickSettings.accent;
    if (a && a.preset === ACCENT_TILE.id && a.tile) _builder.tile = _tileCopy(a.tile.rows, a.tile.cols, a.tile);
    else _builder.open = false;
    renderPatternBuilder();
  }
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
}
registerUndoPart('brickSettings', { take: _takeBrickSettings, restore: _restoreBrickSettings });

/** Grout per element: the Grout box shows + edits the ACTIVE element's joint (the Raised brush shares the Brush's;
 *  no element tool = the Wall's). */
const JOINT_ELEMENTS = ['wall', 'frame', 'brush'];
const _jointKind = () => JOINT_ELEMENT[_setKind()] || 'wall';
function syncGroutWidthBox() {
  const box = document.getElementById('brickGroutWidth');
  if (box) box.value = String(+elementGroutWidth(P.brickSettings, _jointKind()).toFixed(4));
}
export function setElementGrout(kind, widthIn, phase = 'onRelease') {
  const v = Number(widthIn);
  if (!Number.isFinite(v) || v < 0) return;
  P.brickSettings.groutByElement = { ...(P.brickSettings.groutByElement || {}), [JOINT_ELEMENT[kind] || kind]: v };
  commitBrickSetting('generate', phase);
}
/** F35 item 55: the grout PAINT (colour + Edge) -- the selected Wall / Frame element's own (groutPaintByElement) when
 *  Select picked one, else the board-wide one (groutPaint, the General value every element inherits). Paint only: the
 *  grout nodes repaint (editor-brick-tool.js repaintGrout), nothing re-lays, one undo step. */
function _groutPaintTarget() {
  const kind = _selectedElement && (JOINT_ELEMENT[_selectedElement.kind] || _selectedElement.kind);
  return kind && GROUT_ELEMENT_KINDS.includes(kind) ? kind : null;
}
export function setGroutPaint(patch, target = _groutPaintTarget()) {
  const p = { ...patch };
  if ('paintInsetIn' in p) { const v = Number(p.paintInsetIn); if (!Number.isFinite(v) || v < 0) return false; p.paintInsetIn = v; }
  if ('color' in p && p.color != null && !/^#[0-9a-f]{3,8}$/i.test(String(p.color))) return false;
  const s = P.brickSettings;
  if (target) s.groutPaintByElement = { ...(s.groutPaintByElement || {}), [target]: { ...groutPaintOf(s, target), ...p } };
  else s.groutPaint = { ...GROUT_PAINT_DEFAULT, ...(s.groutPaint || {}), ...p };
  syncGroutPaintRow();
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  // a board laid before item 55 has no grout node yet: its strokes regenerate, its Wall / Frame re-lay (the same bricks:
  // same settings + seed), which draws them
  if (editor && elementsWithoutGrout(editor).length) {
    forceRegenerateOwnedBrickElements(editor);
    if (elementsWithoutGrout(editor).length) { commitBrickSetting('generate'); syncQuickSettings(); return true; }
  }
  if (editor && repaintGrout(editor, s)) commitEdit(editor);
  notifyChange();
  syncQuickSettings();
  return true;
}
function syncGroutPaintRow() {
  const target = _groutPaintTarget();
  const paint = groutPaintOf(P.brickSettings, target || 'wall');
  const base = target ? paint : { ...GROUT_PAINT_DEFAULT, ...(P.brickSettings.groutPaint || {}) };
  const swatch = document.getElementById('brickGroutColorSwatch');
  if (swatch) {
    swatch.style.background = base.color || 'repeating-linear-gradient(45deg, #ddd 0 4px, #fff 4px 8px)';
    swatch.setAttribute('aria-label', base.color ? `Grout colour ${base.color}` : 'Grout colour: none');
  }
  document.getElementById('brickGroutColorNone')?.classList.toggle('active', !base.color);
  const edge = document.getElementById('brickGroutEdge');
  if (edge && document.activeElement !== edge) edge.value = String(+(Number(base.paintInsetIn) || 0).toFixed(4));
  const scope = document.getElementById('brickGroutPaintScope');
  if (scope) scope.textContent = target ? `this ${ELEMENT_LABELS[target] || target}` : 'every element';
}

/** An element whose SET changed (the Set picker, the quick Set, a Fieldstone pick making it rock) drops its own
 *  joint: it lays with the new set's declared one. Watched here, in the one commit entry point, so every path
 *  that changes a set is covered without each one remembering to. */
let _jointSets = null;
const _currentJointSets = () => Object.fromEntries(JOINT_ELEMENTS.map((k) => [k, elementSetId(P.brickSettings, k)]));
function _resetJointsOnSetChange() {
  const now = _currentJointSets();
  if (_jointSets) {
    for (const k of JOINT_ELEMENTS) {
      if (now[k] !== _jointSets[k]) P.brickSettings.groutByElement = { ...(P.brickSettings.groutByElement || {}), [k]: null };
    }
  }
  _jointSets = now;
  syncGroutWidthBox();
}

/** The one entry point every brick-setting control calls after writing P.brickSettings. */
export function commitBrickSetting(commit = 'generate', phase = 'onRelease', strokeValues = null) {
  if (phase === 'onRelease') for (const cancel of [..._pendingSettles]) cancel(); // item 68: this release is the commit
  _resetJointsOnSetChange();
  // A6: the drawn strokes follow the global settings (STROKE_FOLLOWS_GLOBAL, the brick size) -- plus, from the one control
  // that applies to ALL elements (the quick Set), `strokeValues`; they regenerate with the re-lay's own commit -- or,
  // with no Wall / Frame on the board to re-lay, their own one
  const editor = phase === 'onRelease' && typeof window !== 'undefined' ? window.svgEditor : null;
  const strokeKeys = [...STROKE_FOLLOWS_GLOBAL, ...Object.keys(strokeValues || {})];
  const strokesMoved = editor ? strokesFollowGlobals(editor, { ...P.brickSettings, ...(strokeValues || {}) }, strokeKeys) : 0;
  const relayCommits = strokesMoved > 0 && _kindsToLay(editor, resolveFrameGeom(editor)).length > 0;
  (BRICK_COMMIT[commit] || BRICK_COMMIT.generate)[phase]();
  if (strokesMoved && !relayCommits) commitEdit(editor);
  // Seat D 2026-10-08 (phone profile, CPU x4): this sync's corner facts run a full contour-band pass (~55 ms cold);
  // inline, it held the staged lay's card back -- the first Generate froze 81-101 ms with no card. With a lay staged
  // it now runs inside that lay's stage (after the lay, before the card clears); a press before then flushes it first
  // (flushControlRequires), so no tap lands on a control that should already be greyed.
  if (_relayQueued) _requiresPending = true; else syncControlRequires();
}

/** A requires sync deferred into the staged lay (commitBrickSetting): run it now if still pending. Called by the
 *  staged lay and, capture-phase, by any press or key on the page -- a press comes before its click, so a control
 *  that should be greyed is disabled before it could take one. */
let _requiresPending = false, _requiresFlushBound = false;
export function flushControlRequires() {
  if (!_requiresPending) return;
  _requiresPending = false;
  syncControlRequires();
}

/** Item 74b: per cutting corner style, whether it changes the frame these settings lay (no facts = met: never greyed) */
function cornerFacts(editor) {
  const effect = frameCornerEffectFor(editor, P.brickSettings, resolveFrameGeom(editor));
  return effect ? Object.fromEntries(Object.keys(effect).map((style) => [cornerFact(style), effect[style]])) : {};
}
/** T86 item 16e: whether the frame these settings lay has a corner fan (no facts = met: never greyed) */
function fanFacts(editor) {
  const has = frameHasFanFor(editor, P.brickSettings, resolveFrameGeom(editor));
  return has === null ? {} : { [FAN_FACT]: has };
}

/** frameRecordChanged fires on EVERY frame-handle drag move (MEASURED 2026-10-08: the corner facts 35 - 57 ms each at
 *  4x CPU): its control requirements are synced once per animation frame, from the record as it is then -- the same
 *  end state as a sync per move. */
let _requiresQueued = false;
function syncControlRequiresSoon() {
  if (_requiresQueued) return;
  _requiresQueued = true;
  const run = () => { _requiresQueued = false; syncControlRequires(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
}

/** Audit (88's matrix): grey out every control whose declared requirement is unmet
 *  (main/brick-control-requires.js) -- disabled, with the reason as its tooltip. */
function syncControlRequires() {
  _requiresPending = false; // this sync covers a deferred one (a lay's own sync, after it: the staged flush is then a no-op)
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  // item 63: a frame contour to lay bands along (none only for an outline that can't carry one); unknown without an editor
  const ctx = { engineOptions: ENGINE_OPTIONS, facts: { bricksLaid: _bricksLaid(), ...(editor ? { frameContour: !!frameBandContour(editor), ...cornerFacts(editor), ...fanFacts(editor) } : {}) } };
  // a control under several rules is greyed while ANY is unmet (the first unmet rule's reason shows)
  const unmet = new Map(), ruled = new Set(), whys = new Set();
  for (const rule of BRICK_CONTROL_REQUIRES) {
    if (rule.hides) continue; // hidden-while-unmet rules are applied by the control's own row sync
    whys.add(rule.why);
    const met = requirementMet(rule.requires, document.getElementById(rule.requires.control), ctx);
    const own = [...rule.controls.map((id) => document.getElementById(id)),
      ...(rule.within || []).flatMap((id) => [...(document.getElementById(id)?.querySelectorAll('button, input') || [])])];
    // A2 (3D-panel audit): a number field's -/+ stepper (ui-bindings.js attachNumberSteppers, buttons with no ids) is
    // part of that control -- greyed with it, or + still changed a greyed Grout depth (0.05 -> 0.055, no effect)
    const els = own.flatMap((el) => [el, ...(el && el.closest ? el.closest('.cad-stepper')?.querySelectorAll('button') || [] : [])]);
    for (const el of els) {
      if (!el) continue;
      ruled.add(el);
      if (!met && !unmet.has(el)) unmet.set(el, rule.why);
    }
  }
  // the control's OWN tooltip (e.g. an icon's name) is kept aside while the reason shows, then put back
  for (const el of ruled) {
    el.disabled = unmet.has(el);
    if (unmet.has(el)) {
      if (!el.hasAttribute('data-own-title')) el.setAttribute('data-own-title', whys.has(el.title) ? '' : (el.title || ''));
      el.title = unmet.get(el);
    } else if (el.hasAttribute('data-own-title')) {
      const own = el.getAttribute('data-own-title');
      if (own) el.title = own; else el.removeAttribute('title');
      el.removeAttribute('data-own-title');
    }
  }
  // N5: the sidebar says WHY its controls are greyed, not just in a tooltip
  const note = document.getElementById('brickSidebarNoBricks');
  if (note) note.style.display = ctx.facts.bricksLaid ? 'none' : '';
}

/** Settings keys a Wall/Frame layout never reads -- a Brush stroke's own settings freeze at draw
 *  time, so changing them never makes the Wall/Frame layout pending. */
const BRUSH_ONLY_SETTING_KEYS = ['brushBandPreset', 'profile', 'orientation', 'stripeStyles', 'raisedLevelIn', 'raisedMode'];
/** F35 item 18: keys only the 3D height pass reads (main/stamp-mask-manager.js), never a 2D layout --
 *  changing them never makes the Wall/Frame layout pending either. Committed with 'surface'. */
// (Level, elementLevelIn, left this list for audit v2 N6: an editor Level change re-lays like a layout setting)
const SURFACE_ONLY_SETTING_KEYS = ['brickTopMode', 'surfaceStyle', 'surfaceWear', 'groutProfileBeforeStyle', 'accent'];
/** The same, inside the grout group: only the joint recess reads them (turn 181); grout WIDTH stays layout. */
const SURFACE_ONLY_GROUT_KEYS = ['profile', 'depthIn'];
/** F35 item 55: the grout PAINT -- 2D + the drape only, never a layout (repaintGrout, no re-lay). */
const PAINT_ONLY_SETTING_KEYS = ['groutPaint', 'groutPaintByElement'];
const LAYOUT_IGNORED_SETTING_KEYS = [...BRUSH_ONLY_SETTING_KEYS, ...SURFACE_ONLY_SETTING_KEYS, ...PAINT_ONLY_SETTING_KEYS];
// The replacer's `this` is the holder: top-level keys, plus the grout group's own surface-only keys.
const _settingsKey = () => JSON.stringify(P.brickSettings, function (k, v) {
  if (this === P.brickSettings && LAYOUT_IGNORED_SETTING_KEYS.includes(k)) return undefined;
  if (this === P.brickSettings.grout && SURFACE_ONLY_GROUT_KEYS.includes(k)) return undefined;
  return v;
});
/** F35 item 20: the Wall flows around the brush strokes, so its layout ALSO depends on them -- the brush
 *  footprints (every brush brick's points) join the laid key. Item 27: adding, editing or deleting a stroke
 *  re-lays the Wall at once (_relayIfBrushChanged, below). Always the footprints now (it used to be '' with no
 *  Wall on the canvas -- which only mattered for the retired pending dot, and made a first lay's key omit them). */
// T86 item 10: the grout cuts' part of a laid key (the Raised brush's grout-mode strokes); absent with no cut, so a board
// without one keeps the key it always had
const CUT_KEY = '#cut:';
function _brushKey() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const strokes = brushExclusions(editor).map((e) => e.polygon.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')).sort().join('|');
  const cuts = groutCutPolylines(editor).map((c) => c.polyline.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')).sort().join('|');
  return cuts ? `${strokes}${CUT_KEY}${cuts}` : strokes;
}
const _cutPartOf = (brushKey) => { const at = brushKey.indexOf(CUT_KEY); return at < 0 ? '' : brushKey.slice(at); };
/** Turn 207 (Fred / 88's finding: after a template change the old Frame bricks stayed, and would still carve):
 *  the Frame bands follow the frame, and the Wall fills its interior -- so the FRAME RECORD (template, its
 *  params and seeds) and the board size are part of what was laid. A change makes the layout pending in the
 *  editor and re-lays it in the sidebar ('frameRecordChanged', below). */
const _frameKey = () => JSON.stringify({ frame: P.frame || null, w: P.widthIn, h: P.heightIn });
const _layoutKey = () => {
  const brush = _brushKey();
  const base = `${_settingsKey()}#frame:${_frameKey()}`;
  return brush ? `${base}#brush:${brush}` : base;
};
// Audit B1-B3 + item 22 step 3: the settings an element's bricks were laid with live ON that element's record
// (BRICK_LAID_ATTR, stamped by runBricks before its undo commit, saved in the drawing), so undo/redo, Cancel and
// reload all carry them. Since item 27 nothing is ever PENDING (every change re-lays at once); the key stays the
// record of what is on the canvas, and the frame / brush re-lays below read its parts.

/** The key `kind`'s bricks were laid with: its record's (a board saved before item 22 got its records on load,
 *  editor-brick-tool.js migrateBrickRecords). */
function _laidKeyOf(editor, kind) {
  return brickRecordNode(editor, kind)?.getAttribute(BRICK_LAID_ATTR) ?? null;
}

/** The element kinds on the board: those with a record (item 22: an element exists by its record, even laid
 *  to zero bricks -- audit B1), plus any bricks on the canvas. */
function _presentKinds(editor) {
  const node = editor?._sketchLayer?.node;
  return BRICK_KINDS.filter((kind) => !!brickRecordNode(editor, kind)
    || !!node?.querySelector?.(`[data-brick-gen="1"][data-brick="${kind}"]`));
}

/** Audit v2 N5: does the board have bricks? The live canvas, or the saved drawing while the editor has not loaded it
 *  yet (after a reload, before it is opened). Advisor (seat E, brush grout): ANY brick element counts -- a Wall / Frame
 *  record or piece, a Brush / Raised stroke (its spine or pieces) -- so the sidebar's quick rows (the grout colour of a
 *  stroke-only board) are not greyed while the board holds strokes. */
export function boardHasBricks(editor, savedSvg) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (_presentKinds(editor).length) return true;
  if (node && node.querySelector && node.querySelector('[data-brick-gen="1"], [data-brick="brush-spine"]')) return true;
  return typeof savedSvg === 'string' && /data-brick="(wall|frame|brush|brush-spine)"/.test(savedSvg);
}
function _bricksLaid() {
  return boardHasBricks(typeof window !== 'undefined' ? window.svgEditor : null, P.editorSvg);
}

/** F35 item 27: the frame part of a laid key (`#frame:` -- the frame record + board size those bricks were laid
 *  on), or null when the key has none (no bricks laid, or laid before turn 207). */
function _framePartOf(laid) {
  const at = laid ? laid.indexOf('#frame:') : -1;
  if (at < 0) return null;
  const rest = laid.slice(at + '#frame:'.length);
  const end = rest.indexOf('#brush:');
  return end < 0 ? rest : rest.slice(0, end);
}

/** F35 item 27: a frame change (template, a handle drag, thickness...) re-lays the Wall/Frame bricks at once,
 *  in the editor as in the sidebar -- after FRAME_RELAY_SETTLE_MS, and never while a frame handle is still
 *  being dragged (Cowork's handoff: one re-lay when the drag settles, not one per drag tick). Only a REAL frame
 *  write triggers it ('frameRecordChanged'; a tab switch never does, so an old board is never re-laid by
 *  surprise), and only when the bricks were laid on a different frame than the current one. */
/** F35 item 27: the brush part of the WALL's laid key -- the strokes it flows around (null = no key). */
function _laidBrushKey() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const laid = _laidKeyOf(editor, 'wall') ?? _laidKeyOf(editor, 'frame'); // T86 item 10: a frame-only board's cuts
  if (laid == null) return null;
  const at = laid.indexOf('#brush:');
  return at < 0 ? '' : laid.slice(at + '#brush:'.length);
}

/** F35 items 20 + 27: a brush stroke added / edited / deleted (an editor commit) changes what the Wall flows
 *  around -- re-lay the Wall at once when the strokes on the canvas differ from those it was laid around. The
 *  re-lay's own commit then finds them equal, so it stops there. */
function _relayIfBrushChanged() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const present = _presentKinds(editor);
  if (!present.includes('wall') && !present.includes('frame')) return;
  const laid = _laidBrushKey(), now = _brushKey();
  if (laid === null || laid === now) return;
  // the Wall flows around every stroke; the Frame only follows the grout cuts (T86 item 10)
  if (!present.includes('wall') && _cutPartOf(laid) === _cutPartOf(now)) return;
  // item 68 (measured: one Brick size change on a board with a stroke = TWO undo steps -- the strokes follow the size,
  // their new footprints re-lay the wall from inside the first lay's commit): one gesture = one undo step. This runs on
  // the editorCommit a commit dispatches BEFORE its push, so the re-lay is queued a microtask later, once the gesture's
  // step is on top, and corrects that step in place (commitEdit `amend`), as a frame re-lay does (_frameRelayAmend).
  queueMicrotask(() => _relayStaged({ amend: editor._lastPushedState || null }));
}

const FRAME_RELAY_SETTLE_MS = 350;
let _frameRelayTimer = null;
// audit B9: a frame UNDO (detail.restored) -> its re-lay corrects the editor step that was on top then, in place
// (commitEdit's `amend`), instead of pushing a new one a Brick-tab Ctrl+Z would then undo
let _frameRelayAmend = null;
function _scheduleFrameRelay(restored = false) {
  clearTimeout(_frameRelayTimer);
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const stack = editor && Array.isArray(editor._undoStack) ? editor._undoStack : null;
  _frameRelayAmend = restored && stack ? stack[stack.length - 1] : null;
  _frameRelayTimer = setTimeout(_relayIfFrameChanged, FRAME_RELAY_SETTLE_MS);
}
// the board-size change's 'brick-relay' stage (main/app-init.js STOCK_CHANGE_STAGES): joined when the editor reports the
// new board, closed by the lay it causes -- or at once when nothing needs re-laying
let _boardRelayHoldClose = null;
function _takeBoardRelayHold() { const close = _boardRelayHoldClose || (() => {}); _boardRelayHoldClose = null; return close; }
function _relayIfFrameChanged() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor && editor._frameHandleDrag) { _frameRelayTimer = setTimeout(_relayIfFrameChanged, FRAME_RELAY_SETTLE_MS); return; } // still dragging: wait for the release
  if (!_relayIfFrameChangedNow(editor)) _takeBoardRelayHold()(); // no lay: the stage is over
}
function _relayIfFrameChangedNow(editor) {
  if (!editor || !_presentKinds(editor).length) return false;
  // item 22 step 3: per element -- re-lay when ANY element on the board was laid on another frame
  const frameKey = _frameKey();
  if (_presentKinds(editor).every((kind) => _framePartOf(_laidKeyOf(editor, kind)) === frameKey)) return false;
  const amend = _frameRelayAmend;
  _frameRelayAmend = null;
  _relayStaged({ amend });
  return true;
}

/** Lay the given element kinds with the current settings, stamping their key on the Bricks layer. */
/** Blind-spot audit B1: what a lay can produce that the user must be TOLD, declared once -- the toast after the
 *  lay and the sidebar note (#brickLayWarnings) read the same entry. `when(counts, kinds)`. */
/** F35 item 35: the engine's band-fit note (generateBricks `bandsReduced`, T86 item 28) in plain words: how many
 *  of the requested bands were laid, and which ones were narrowed (a row / a course fewer). */
export function bandsReducedText(note) {
  if (!note) return '';
  const narrowed = [...new Set((note.steps || []).filter((s) => s.step !== 'drop').map((s) => s.band + 1))]
    .filter((b) => b <= note.kept);
  const parts = [`Bands reduced to fit the board: ${note.kept} of ${note.requested} laid`];
  if (narrowed.length) parts.push(`band ${narrowed.join(', ')} narrowed`);
  // T86 item 30: a band narrowed to fit a feature is one row shallower than its bricks -- they are cut to the row depth
  if ((note.steps || []).some((s) => s.step === 'narrow')) parts.push('bricks cut to the row depth');
  return parts.join('; ') + '.';
}
/** `where` = which note line shows it: none = the lay warnings (sidebar + editor Brick tab), 'frame' = the Frame
 *  section's own note line. `text` may read the counts. */
export const BRICK_LAY_WARNINGS = Object.freeze([
  // F35 item 35: no longer when the frame stack was reduced and now FITS (the note below says it instead) -- unless a
  // band was NARROWED (T86 item 30): that fit is to a feature, not the board, and can leave no wall (T9 7x9 1.5 in: the
  // band fills the web) -- the Brick tab said nothing about the empty wall (brick-matrix lay row, the stack gate)
  { id: 'wallEmpty', text: 'The frame bands cover the whole board -- no room for the wall: fewer bands or smaller bricks.',
    when: (c, kinds, s) => kinds.includes('wall') && s.pattern !== 'none' && c.frameCount > 0 && c.wallCount === 0
      && !(c.bandsReduced && c.bandsReduced.fits && !(c.bandsReduced.steps || []).some((st) => st.step === 'narrow')) },
  { id: 'bandsReduced', where: 'frame', text: (c) => bandsReducedText(c.bandsReduced),
    when: (c) => !!c.bandsReduced },
]);
// F35 item 35: the last lay's band-fit note (the Frame section greys out the bands it dropped)
let _bandsReduced = null;
export const lastBandsReduced = () => _bandsReduced;
let _layWarnings = [];
let _layCounts = null;
export const currentLayWarnings = () => _layWarnings.slice();
const _warningText = (w) => (typeof w.text === 'function' ? w.text(_layCounts || {}) : w.text);
function _syncLayWarnings() {
  if (typeof document === 'undefined') return;
  // every place that shows them is marked data-brick-lay-warnings (the general ones: the sidebar's note + the editor
  // Brick tab's) and/or data-brick-lay-notes="<where> ..." (a section's notes: F35 item 35, the Frame section's). A1
  // (3D-panel audit): the sidebar lists 'frame' too -- a quick Frame bands pick that only partly fits said nothing there
  const shows = (el, w) => (w.where ? (el.getAttribute('data-brick-lay-notes') || '').split(/\s+/).includes(w.where) : el.hasAttribute('data-brick-lay-warnings'));
  for (const el of document.querySelectorAll('[data-brick-lay-warnings], [data-brick-lay-notes]')) {
    const list = _layWarnings.filter((w) => shows(el, w));
    el.textContent = list.map(_warningText).join(' ');
    el.style.display = list.length ? '' : 'none';
  }
}

function _layBricks(editor, frameGeom, kinds, { amend = null } = {}) {
  // Turn 195: an engine throw keeps the previous bricks (runBricks computes before it clears) and says
  // so -- never an empty canvas with no message. The layout stays pending (nothing new was laid).
  let failed = null, counts = null;
  // the 'bricks' stage is entered by the caller BEFORE this (_relayStaged): a synchronous lay cannot paint it
  try { counts = runBricks(editor, P.brickSettings, frameGeom, { laidKey: _layoutKey(), kinds, amend }); }
  catch (e) { failed = e; }
  if (failed) {
    console.error('Brick Generate failed:', failed);
    showToast(`Generate failed -- the previous bricks are kept (${(failed && failed.message) || failed})`, 'error');
    return false;
  }
  // audit B1: a lay that leaves something the user must know about says so: a toast when it starts, the sidebar
  // note for as long as it lasts
  const before = new Set(_layWarnings.map((w) => w.id));
  _layCounts = counts;
  _layWarnings = counts ? BRICK_LAY_WARNINGS.filter((w) => w.when(counts, kinds, P.brickSettings)) : [];
  for (const w of _layWarnings) if (!before.has(w.id)) showToast(_warningText(w), 'warn');
  _syncLayWarnings();
  // F35 item 35: a frame lay's band-fit note decides which band rows are greyed (only a frame lay changes it)
  if (counts && (kinds || BRICK_KINDS).includes('frame')) {
    const next = counts.bandsReduced || null;
    if (JSON.stringify(next) !== JSON.stringify(_bandsReduced)) {
      _bandsReduced = next;
      renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
      syncFrameBandPatternButtons();
    }
  }
  if (_selectedElement) showElementSelection(editor, _selectedElement.id); // item 22: the re-laid bricks keep the outline
  syncControlRequires(); // audit v2 N5: the board now has bricks -- the sidebar controls apply
  // Audit C8: the layer's visibility is the user's choice, so it is not flipped back on -- but a
  // re-lay nobody can see must not pass silently.
  // item 22 slice 3: each laid element on its own layer -- any of those layers hidden says so
  const hidden = [...new Set((kinds || BRICK_KINDS).map((k) => layerOfElement(editor, k)).filter(Boolean))].filter((l) => l.visible === false);
  if (hidden.length) showToast(`Bricks re-laid on the hidden layer ${hidden.map((l) => `"${l.name}"`).join(', ')} -- show it in Layers to see them`, 'warn');
}

/** Audit C1: what Generate lays -- every element kind already on the canvas, plus the active tool's
 *  own kind (BRICK_TOOLS `lays`). Frame needs a usable frame. A Wall alone never brings Frame bands. */
/** F35 item 63: an element a control asks to LAY even though it is not on the canvas yet (the sidebar's Frame bands
 *  pick, BRICK_QUICK_SETTINGS `lays`). Kept until the next lay runs -- a deferred lay (_relayOnRelease) still sees
 *  it -- and dropped by that lay. */
const _requestedKinds = new Set();
export function requestLay(kind) { if (BRICK_KINDS.includes(kind)) _requestedKinds.add(kind); }

function _kindsToLay(editor, frameGeom) {
  const present = [..._presentKinds(editor), ..._requestedKinds];
  const active = BRICK_TOOLS.find((t) => t.id === _activeTool);
  // a Frame element ON the canvas is always re-laid: with no frame contour left (template Rectangle, Offset on)
  // that lays nothing, i.e. clears it -- stale bands must not stay and carve (turn 207)
  return BRICK_KINDS.filter((kind) => (present.includes(kind) || (active && active.lays === kind)) && (kind !== 'frame' || !!frameGeom || present.includes('frame')));
}

/** Generate: re-lay the Wall/Frame bricks with the CURRENT settings -- whatever Wall/Frame bricks
 *  are already on the canvas, or the active Wall/Frame tool's own output (Frame needs a usable
 *  frame). Wall and Frame are laid together by one runBricks call (editor-brick-tool.js), so there
 *  is no per-element subset to pick. Brush strokes are untouched (frozen at draw time). */
/** Audit v2 N9: Generate with the Frame tool on a board with no usable frame outline laid nothing and said so only in
 *  the console. Since item 66 a board with NO template lays the bands along its rectangle; this is left for a template
 *  whose outline cannot carry a contour. */
export { FRAME_NEEDS_A_FRAME }; // declared once in brick-control-requires.js (the toast and the greyed row's reason)

/** F35 item 39 (Fred, on a restored board: "the opened geometry isn't refreshable by a simple Generate; it needs a
 *  setting changed"): the Generate BUTTON = re-lay now with a NEW brick seed, like the terrain's Generate New Seed --
 *  unconditionally, every brick element on the board, one undo step (setSeed's re-lay). Measured before: a restored
 *  board whose settings already matched its pieces re-laid byte-identical bricks (205#yd55hp -> 205#yd55hp), so the
 *  press showed nothing. The re-lays the app runs by itself (a setting change, a frame or brush change) keep calling
 *  generateBricks() and keep the seed. BRICK_SEED_RANGE / newBrickSeed: the one seed rule (Random seed reads it too). */
export const BRICK_SEED_RANGE = 1000000;
export const newBrickSeed = () => Math.floor(Math.random() * BRICK_SEED_RANGE);
export function generateNow() {
  // item 41: Generate is a declared sequence (lay -> carve -> build). Its lay shows first like every re-lay
  // (_relayStaged); the steps after it read "step 2 of 3", "step 3 of 3".
  beginLoadingSequence('generate');
  setSeed(newBrickSeed());
}

export function generateBricks({ amend = null } = {}) {
  _cancelLivePreview();
  _dragSlow = false;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) return false;
  const frameGeom = resolveFrameGeom(editor);
  const kinds = _kindsToLay(editor, frameGeom);
  _requestedKinds.clear(); // item 63: a request is for the next lay only
  if (!frameGeom && BRICK_TOOLS.find((t) => t.id === _activeTool)?.lays === 'frame') showToast(FRAME_NEEDS_A_FRAME, 'warn');
  if (!kinds.length) return false;
  return _layBricks(editor, frameGeom, kinds, { amend }) !== false;
}

/** Turn 197 (88's matrix): a NUMBER BOX applies while typing, like a slider's release -- for a commit
 *  that applies at once ('surface' re-mask, 'auto' re-lay), each keystroke saves and the apply runs once
 *  typing pauses for NUMBER_BOX_SETTLE_MS (a re-mask per keystroke would be the expensive height pass).
 *  'generate' boxes already mark pending on every keystroke. */
const NUMBER_BOX_SETTLE_MS = 400;
const APPLIES_AT_ONCE = new Set(['surface', 'auto', 'generate']); // item 27: 'generate' applies at once too
// item 68 (the editor audit, measured: a Grout width change by its stepper -- 'input' + 'change' -- pushed TWO undo
// entries, Undo kept the new value): a release commits the latest values, so a typing settle still pending is dropped
// then (commitBrickSetting 'onRelease'). One edit = one re-lay = one undo step.
const _pendingSettles = new Set();
function settleAfterTyping(commit) {
  if (!APPLIES_AT_ONCE.has(commit)) return () => {};
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; _pendingSettles.delete(cancel); };
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => { _pendingSettles.delete(cancel); timer = null; commitBrickSetting(commit, 'onRelease'); }, NUMBER_BOX_SETTLE_MS);
    _pendingSettles.add(cancel);
  };
}

export function bindSlider(sliderId, numberId, key, parse = parseFloat, commit = 'generate') {
  const slider = document.getElementById(sliderId);
  const number = document.getElementById(numberId);
  const apply = (raw) => {
    const v = parse(raw);
    if (!Number.isFinite(v)) return;
    if (slider) slider.value = String(v);
    if (number) number.value = String(v);
    P.brickSettings[key] = v;
    return true;
  };
  const drag = (raw) => { if (apply(raw)) commitBrickSetting(commit, 'onDrag'); };
  const release = (raw) => { if (apply(raw)) commitBrickSetting(commit, 'onRelease'); };
  const settle = settleAfterTyping(commit);
  slider?.addEventListener('input', (e) => drag(e.target.value));
  slider?.addEventListener('change', (e) => release(e.target.value));
  number?.addEventListener('input', (e) => { drag(e.target.value); settle(); });
  number?.addEventListener('change', (e) => release(e.target.value));
}

/** Brick size's own binder, not the shared bindSlider above: the slider's raw DOM value is a LOG
 *  position (brickSizeToSliderPos/sliderPosToBrickSize), while `#brickSize` (the number stepper)
 *  stays real inches throughout -- the two controls no longer share one raw value the way every
 *  other bindSlider pair does, so this mirrors bindSlider's own input/change-commit shape with that
 *  one difference instead of forcing a log-aware `parse` through the generic helper. */
function bindBrickSizeControls(commit = 'generate') {
  const slider = document.getElementById('brickSizeSlider');
  const number = document.getElementById('brickSize');
  const apply = (v) => {
    if (!Number.isFinite(v)) return false;
    const clamped = Math.min(BRICK_SIZE_MAX_IN, Math.max(BRICK_SIZE_MIN_IN, v));
    if (slider) slider.value = String(brickSizeToSliderPos(clamped));
    if (number) number.value = String(clamped);
    P.brickSettings.brickLengthIn = clamped;
    return true;
  };
  const drag = (v) => { if (apply(v)) commitBrickSetting(commit, 'onDrag'); };
  const release = (v) => { if (apply(v)) commitBrickSetting(commit, 'onRelease'); };
  slider?.addEventListener('input', (e) => drag(sliderPosToBrickSize(parseFloat(e.target.value))));
  slider?.addEventListener('change', (e) => release(sliderPosToBrickSize(parseFloat(e.target.value))));
  number?.addEventListener('input', (e) => drag(parseFloat(e.target.value)));
  number?.addEventListener('change', (e) => release(parseFloat(e.target.value)));
}

function bindGroutField(id, key, commit = 'generate') {
  const write = (e, phase) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    P.brickSettings.grout[key] = v;
    commitBrickSetting(commit, phase);
  };
  const settle = settleAfterTyping(commit);
  document.getElementById(id)?.addEventListener('input', (e) => { write(e, 'onDrag'); settle(); });
  document.getElementById(id)?.addEventListener('change', (e) => write(e, 'onRelease')); // typed value settled
}

/** F35 item 10: this list now renders into the left-rail toolbar
 *  (#editorToolbarBrick, icon-only, same convention Artwork's own tool rail
 *  already uses), not the old sidebar's horizontal icon+label row -- the
 *  label moves into the button's own title tooltip instead.
 *  F35 (advisor, UX unification): rendering + the active-class toggle are the
 *  shared editor-tool-registry.js mechanism now, the same one Photo uses --
 *  this file no longer carries its own copy of either loop. */
function renderToolList(container) {
  // F35 item 43: the tools are TABS at the top of the Brick panel (#editorToolbarBrick moved there; the left rail no
  // longer shows for Brick, main/editor-tabs.js), General first
  _syncTabs = renderTabStrip(container, brickTabs(), pickBrickTab, { variant: 'icons' });
  _renderSubTools(); // item 22: the element tools' Select (+ Area) rows
}

function syncToolButtons() {
  if (_syncTabs) _syncTabs(activeBrickTab());
  const hint = BRICK_TOOLS.find((t) => t.id === _activeTool);
  const hintEl = document.getElementById('brickToolHint');
  if (hintEl) hintEl.textContent = hint ? hint.hint : '';
  syncToolSections();
  syncEmptySelectionPanel();
  syncGenerateVisibility();
}

/** Audit C9: the pinned Generate shows only where it applies -- the active tab's declared `generates` (General's own,
 *  else the tool's in BRICK_TOOLS; no tool picked = the General tab). */
function syncGenerateVisibility() {
  // item 43: the button only -- the tab strip shares its pinned block
  const button = document.getElementById('brickGenerate');
  if (!button) return;
  const tool = BRICK_TOOLS.find((t) => t.id === _activeTool);
  const shown = activeBrickTab() === BRICK_GENERAL_TAB.id ? BRICK_GENERAL_TAB.generates : !!tool?.generates;
  button.style.display = shown ? '' : 'none';
}

/** F35 item 16 follow-up (Fred, live use: "don't see the layers"): with no Brick tool picked yet,
 *  the tab's own panel has nothing contextual to show (syncToolSections hides every section) --
 *  show the shared editor Layers panel instead of a near-empty Brick panel. Only touches these two
 *  panels while the Brick tab is actually active (getEditorTab) -- never fights editor-tabs.js's
 *  own per-tab panel toggle for Artwork/Photo/Frame, which this deliberately leaves alone (not the
 *  reported problem). */
/** Audit v2 N11: a new board's Brick tab, no tool picked, showed only Layers ("Layer 1") and unlabelled
 *  toolbar icons. The start hint names the tools that lay bricks (BRICK_TOOLS: those that `lay` an element,
 *  plus Brush), shown in the Brick tab with no tool picked on a board that has no bricks yet. */
function syncStartHint() {
  const hint = document.getElementById('brickStartHint');
  if (!hint) return;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const anyBricks = !!editor?._sketchLayer?.node?.querySelector?.('[data-brick-gen="1"]')
    || (typeof P.editorSvg === 'string' && P.editorSvg.includes('data-brick-gen="1"'));
  if (!hint.textContent) {
    const starters = BRICK_TOOLS.filter((t) => t.lays || t.id === 'brush').map((t) => `${t.icon} ${t.label}`);
    hint.textContent = `Pick ${starters.slice(0, -1).join(', ')} or ${starters.at(-1)} in the tabs above to start laying bricks.`;
  }
  hint.style.display = getEditorTab() === 'brick' && _activeTool === null && !anyBricks ? '' : 'none';
}

/** F35 item 40 (supersedes item 16's swap): the Brick tab shows its OWN panel always -- the pinned Generate and the
 *  shared Layers component it hosts (editor-tabs.js EDITOR_TABS brick.panelHosts) -- with or without a tool. Measured
 *  before: with a tool picked the layers were hidden (desktop + 900 px), and with none the panel swapped to Layers,
 *  which hid Generate on a restored board (item 39 (c)). Only the start hint still depends on "no tool". */
function syncEmptySelectionPanel() {
  syncStartHint();
}

/** F35 (advisor: "Esc = back to the select tool in every tab"): Brick has no Select tool of its
 *  own to click -- clears this tab's own active-tool state and returns the editor's underlying
 *  interaction mode to plain Select, the same real effect Artwork's Escape-to-toolSelect has. */
export function deselectTool() {
  // item 22: Esc first drops a selected element (the tool stays); the next Esc leaves the tool as before
  if (_selectedElement) { selectBrickElement(null); return; }
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
    btn.className = 'cad-btn brick-accent-icon'; // item 33 (audit N10): the band stack as an icon, the name as the tooltip
    btn.id = `brickFramePreset_${preset.id}`;
    btn.title = preset.label;
    btn.setAttribute('aria-label', preset.label);
    btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = framePresetIconSvg(preset.id, 30) || preset.label;
    btn.addEventListener('click', () => setFrameBandPreset(preset.id));
    container.appendChild(btn);
  }
}

/** F35 item 23: the frame's rock state -- every band of the current preset fieldstone (rock), or back to the
 *  preset's own patterns (the Set row does that, through selectSet). */
export function setFrameRock(rock, commit = 'generate') {
  const bands = FRAME_PRESETS[P.brickSettings.frameBandPreset] || [];
  P.brickSettings.frameBandPatterns = rock ? bands.map(() => 'fieldstone') : [];
  renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
  syncFrameBandPatternButtons();
  syncFrameCornerButtons();
  syncSetPicker();
  commitBrickSetting(commit);
}

/** F35 item 46: a course pattern picked on band `i`. The pattern implies the set, both ways, in one place: Fieldstone
 *  makes the whole frame rock (setFrameRock; its set is DERIVED, editor-brick-tool.js elementSetId -> the rock set),
 *  and a course pattern on a rock frame leaves rock first -- every band back to the preset's own, then band `i` --
 *  so the frame's own brick set (setIds.frame, never overwritten while rock; else the default Red Brick) is back. */
export function setFrameBandPattern(i, patternId, commit = 'generate') {
  if (isRockFrame(P.brickSettings)) P.brickSettings.frameBandPatterns = [];
  if (!P.brickSettings.frameBandPatterns) P.brickSettings.frameBandPatterns = [];
  P.brickSettings.frameBandPatterns[i] = patternId;
  syncFrameBandPatternButtons();
  syncFrameCornerButtons();
  syncSetPicker();
  commitBrickSetting(commit);
}

/** What a new Frame band PRESET drops, declared once (Fred, item 33: "a pick is dropped on a preset change"):
 *  the corner pick (the preset starts on its OWN corner) and, F35 item 58 follow-up, the per-band accents (and
 *  with them their levels) -- they are stored by band NUMBER, so an old pick would land on the new preset's band.
 *  A pattern change on one band keeps that band's accent (setFrameBandPattern does not read this). */
export const FRAME_PRESET_DROPS = Object.freeze({ frameCorner: () => null, frameBandAccents: () => [] });

export function setFrameBandPreset(presetId, commit = 'generate') {
  const wasRock = isRockFrame(P.brickSettings);
  P.brickSettings.frameBandPreset = presetId;
  for (const [key, fresh] of Object.entries(FRAME_PRESET_DROPS)) P.brickSettings[key] = fresh();
  if (_accentClickArmed && _accentClickTarget.kind === 'frameBand') _disarmAccentClick(); // its band's pick is gone
  // a rock frame stays rock with another band count: every band of the new preset fieldstone
  if (wasRock) P.brickSettings.frameBandPatterns = (FRAME_PRESETS[presetId] || []).map(() => 'fieldstone');
  syncFramePresetButtons();
  // F35 item 8: a different preset can have a different BAND COUNT, so the per-band pattern
  // picker is fully re-rendered here (not just re-synced) every time the preset changes.
  renderFrameBandPatternList(document.getElementById('brickFrameBandPatternList'));
  syncFrameBandPatternButtons();
  commitBrickSetting(commit);
}

function syncFramePresetButtons() {
  for (const preset of FRAME_PRESET_LIST) {
    document.getElementById(`brickFramePreset_${preset.id}`)?.classList.toggle('active', preset.id === P.brickSettings.frameBandPreset);
  }
  syncFrameCornerButtons();
  syncQuickSettings();
}

/** Item 33: the Frame element's CORNERS row -- one engine-drawn mini corner per FRAME_CORNERS entry (the name
 *  + what it does as the tooltip). The active one = frameCornerOf (the element's pick, else its preset's own). */
function renderFrameCornerList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const corner of FRAME_CORNERS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-accent-icon'; // the same small icon button as the Accent row
    btn.id = `brickFrameCorner_${corner.id}`;
    btn.title = corner.title;
    btn.setAttribute('aria-label', corner.label);
    btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = frameCornerIconSvg(corner.id, 30) || corner.label;
    btn.addEventListener('click', () => setFrameCorner(corner.id));
    container.appendChild(btn);
  }
  syncFrameCornerButtons();
}
/** The corners row shows for a brick frame with bands (a rock frame is one fieldstone ring: no corner joints). */
function syncFrameCornerButtons() {
  const bands = FRAME_PRESETS[P.brickSettings.frameBandPreset] || [];
  const show = bands.length > 0 && !isRockFrame(P.brickSettings);
  for (const id of ['brickFrameCornerLabel', 'brickFrameCornerList']) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }
  const active = frameCornerOf(P.brickSettings);
  for (const corner of FRAME_CORNERS) {
    document.getElementById(`brickFrameCorner_${corner.id}`)?.classList.toggle('active', corner.id === active);
  }
  syncFrameFanCentreButtons(show);
}
/** T86 item 16e: the Frame element's FAN CENTRE row -- one engine-drawn fan per FRAME_FAN_CENTRES entry (the name + what
 *  it does as the tooltip). The active one = frameFanCentreOf (the element's pick, else the Needle). */
function renderFrameFanCentreList(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const centre of FRAME_FAN_CENTRES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-accent-icon'; // the Corners row's own small icon button
    btn.id = `brickFrameFanCentre_${centre.id}`;
    btn.title = centre.title;
    btn.setAttribute('aria-label', centre.label);
    btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = fanCentreIconSvg(centre.id, 30) || centre.label;
    btn.addEventListener('click', () => setFrameFanCentre(centre.id));
    container.appendChild(btn);
  }
  syncFrameCornerButtons();
}
/** Shown with the Corners row (a brick frame with bands). */
function syncFrameFanCentreButtons(show) {
  for (const id of ['brickFrameFanCentreLabel', 'brickFrameFanCentreList']) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }
  const active = frameFanCentreOf(P.brickSettings);
  for (const centre of FRAME_FAN_CENTRES) {
    document.getElementById(`brickFrameFanCentre_${centre.id}`)?.classList.toggle('active', centre.id === active);
  }
}
/** T86 item 16e: pick how the Frame's corner fans end -- re-lays at once (one undo step, like a corner pick). */
export function setFrameFanCentre(centreId, commit = 'generate') {
  if (!FRAME_FAN_CENTRES.some((c) => c.id === centreId)) return;
  P.brickSettings.frameFanCentre = centreId;
  syncFrameCornerButtons();
  commitBrickSetting(commit);
}
/** Item 33: pick the Frame element's corner -- re-lays at once. */
export function setFrameCorner(cornerId, commit = 'generate') {
  if (!FRAME_CORNERS.some((c) => c.id === cornerId)) return;
  P.brickSettings.frameCorner = cornerId;
  syncFrameCornerButtons();
  commitBrickSetting(commit);
}

/** Item 9: "Crumble frame too" -- on writes the amount the frame crumbles by (its own, else the declared default) so the
 *  slider shows what is laid; off drops nothing but the switch (the amount comes back with it). One undo step. */
export function setFrameCrumble(on, commit = 'generate') {
  P.brickSettings.suppressFrame = !!on;
  if (on) P.brickSettings.frameSuppression = frameSuppressionOf(P.brickSettings);
  syncFrameCrumble();
  commitBrickSetting(commit);
}
function syncFrameCrumble() {
  const box = document.getElementById('brickSuppressFrame');
  if (box) box.checked = !!P.brickSettings.suppressFrame;
  setPair('brickFrameSuppressionSlider', 'brickFrameSuppression', frameSuppressionOf(P.brickSettings));
}

/** Item 9: the Window surround rows -- the Frame's own preset list (its empty 'none' preset = no surround) and icons,
 *  then the corners (SURROUND_CORNER_LIST, the Frame's own corner icons). Shown while the frame's inset window is on,
 *  else the hint. */
const SURROUND_CHOICES = () => FRAME_PRESET_LIST;
function _iconButton(id, label, title, svg, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cad-btn brick-accent-icon'; // the same small icon button as the Frame's preset / corner rows
  btn.id = id;
  btn.title = title;
  btn.setAttribute('aria-label', label);
  btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
  btn.innerHTML = svg || label;
  btn.addEventListener('click', onClick);
  return btn;
}
function renderWindowSurround() {
  const presets = document.getElementById('brickSurroundPresetList');
  const corners = document.getElementById('brickSurroundCornerList');
  if (presets) {
    presets.innerHTML = '';
    // Fred 2026-10-10: "Same as frame" first -- the surround lays the Frame's own bands + corner (SURROUND_FOLLOW)
    presets.appendChild(_iconButton(`brickSurroundPreset_${SURROUND_FOLLOW}`, 'Same as frame', "Same as frame: the window's surround lays the Frame's own bands and corner",
      '<span style="font-size:10px; line-height:30px; padding:0 6px;">Same as frame</span>', () => setWindowSurround({ preset: SURROUND_FOLLOW })));
    for (const c of SURROUND_CHOICES()) {
      presets.appendChild(_iconButton(`brickSurroundPreset_${c.id}`, c.label, c.id === SURROUND_NONE ? 'No surround' : c.label, framePresetIconSvg(c.id, 30),
        () => setWindowSurround({ preset: c.id })));
    }
  }
  if (corners) {
    corners.innerHTML = '';
    for (const c of SURROUND_CORNER_LIST) {
      corners.appendChild(_iconButton(`brickSurroundCorner_${c.id}`, c.label, c.title, frameCornerIconSvg(c.id, 30),
        () => setWindowSurround({ corner: c.id })));
    }
  }
  syncWindowSurround();
}
function syncWindowSurround() {
  const on = !!(getFrameRecord().insetWindow && getFrameRecord().insetWindow.enabled);
  const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
  show('brickSurroundHint', !on);
  show('brickSurroundRows', on);
  const w = windowSurroundOf(P.brickSettings);
  show('brickSurroundCornerLabel', w.preset !== SURROUND_NONE);
  show('brickSurroundCornerList', w.preset !== SURROUND_NONE);
  document.getElementById(`brickSurroundPreset_${SURROUND_FOLLOW}`)?.classList.toggle('active', !!w.follows);
  for (const c of SURROUND_CHOICES()) document.getElementById(`brickSurroundPreset_${c.id}`)?.classList.toggle('active', !w.follows && c.id === w.preset);
  for (const c of SURROUND_CORNER_LIST) document.getElementById(`brickSurroundCorner_${c.id}`)?.classList.toggle('active', c.id === w.corner);
}
/** Item 9: a surround pick (`patch`: preset and/or corner) -- re-lays at once, one undo step. */
export function setWindowSurround(patch, commit = 'generate') {
  // "Same as frame" stores just that; any other pick stores an explicit preset + corner (a corner picked while following
  // keeps the frame's preset it was showing, now its own)
  const cur = windowSurroundOf(P.brickSettings);
  P.brickSettings.windowSurround = patch.preset === SURROUND_FOLLOW ? { preset: SURROUND_FOLLOW } : { preset: cur.preset, corner: cur.corner, ...patch };
  syncWindowSurround();
  commitBrickSetting(commit);
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
    btn.style.cssText = 'height:auto; min-height:22px; white-space:normal; line-height:1.25; padding:3px 6px;'; // audit v3 #2
    btn.addEventListener('click', () => {
      P.brickSettings.brushBandPreset = preset.id;
      syncBrushPresetButtons();
      commitBrickSetting('settings');
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
  // F35 item 13: the sheet's own names
  stacked_horizontal: 'Stacked horizontal', chevron: 'Chevron', stacked_variation: 'Stacked variation',
  basketweave_variation: 'Basketweave variation', basketweave_stacked: 'Basketweave + stacked',
  // F35 item 14: the tiles (named by what the sheet draws; the sheet has no captions)
  square_grid: 'Square grid', square_diamond: 'Square + diamond inserts', octagon_square: 'Octagon + small square',
  hexagon: 'Hexagon', lozenge: 'Lozenge', framed_square: 'Framed square',
  fieldstone: 'Fieldstone', coursed_rubble: 'Coursed rubble',
};
// item 23: what a ROCK wall becomes when a brick set is picked for it
const DEFAULT_WALL_PATTERN = 'stretcher';
const WALL_PATTERN_LIST = Object.keys(BRICK_PATTERNS).map((id) => ({ id, label: WALL_PATTERN_LABELS[id] || id }));

/** F35 item 13 (Fred's sheets: "group the picker into families"): the Wall pattern picker's FAMILIES, in
 *  order. Any BRICK_PATTERNS key not listed lands in the last family ('More'), so a new pattern is never
 *  lost from the picker. Combinations / Tiles join here as their patterns land. Since the flattening the picker
 *  shows no family headings: this table is the ORDER (and the place a new family is declared). */
const WALL_PATTERN_FAMILIES = [
  { id: 'bonds', label: 'Bonds', patterns: ['none', 'stretcher', 'stack', 'soldier', 'header', 'flemish', 'stacked_horizontal', 'stacked_variation'] },
  { id: 'herringbone', label: 'Herringbone', patterns: ['herringbone', 'chevron'] },
  { id: 'basketweave', label: 'Basketweave', patterns: ['basketweave', 'basketweave_variation', 'basketweave_stacked'] },
  { id: 'fieldstone', label: 'Fieldstone', patterns: ['fieldstone'] },
  // F35 item 14: every BRICK_PATTERNS entry declaring `family: 'tiles'` lands here, under its own heading
  { id: 'tiles', label: 'Tiles', heading: true, patterns: [] },
  { id: 'more', label: 'More', patterns: [] },
];
function wallPatternFamilies() {
  // a pattern entry may declare its own family (F35 item 14: `family: 'tiles'`)
  const byFamily = (fid) => WALL_PATTERN_LIST.map((p) => p.id).filter((id) => BRICK_PATTERNS[id] && BRICK_PATTERNS[id].family === fid);
  const listed = new Set(WALL_PATTERN_FAMILIES.flatMap((f) => [...f.patterns, ...byFamily(f.id)]));
  const extra = WALL_PATTERN_LIST.map((p) => p.id).filter((id) => !listed.has(id));
  return WALL_PATTERN_FAMILIES
    .map((f) => ({ ...f, patterns: [...f.patterns, ...byFamily(f.id), ...(f.id === 'more' ? extra : [])].filter((id) => BRICK_PATTERNS[id]) }))
    .filter((f) => f.patterns.length);
}
const _patternLabel = (id) => WALL_PATTERN_LABELS[id] || id;

function renderWallPatternList(container) {
  if (!container) return;
  container.innerHTML = '';
  // F35 item 13: an engine-drawn ICON grid, icons only (the name is the tooltip). Flattened (advisor): ONE grid
  // in the declared family ORDER (WALL_PATTERN_FAMILIES), no family sub-headings.
  container.style.flexDirection = 'row';
  container.style.flexWrap = 'wrap';
  for (const fam of wallPatternFamilies()) for (const id of fam.patterns) {
    if (fam.heading && id === fam.patterns[0]) { // F35 item 14: a family that declares a heading starts a labelled row
      const h = document.createElement('div');
      h.className = 'brick-pattern-family-heading';
      h.id = `brickPatternFamily_${fam.id}`;
      h.textContent = fam.label;
      h.style.cssText = 'flex:0 0 100%; font-size:10px; opacity:0.65; margin:4px 0 2px;';
      container.appendChild(h);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-pattern-icon';
    btn.id = `brickPattern_${id}`;
    btn.title = _patternLabel(id);
    btn.setAttribute('aria-label', _patternLabel(id));
    btn.style.cssText = 'padding:2px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = wallPatternIconSvg(id) || _patternLabel(id);
    btn.addEventListener('click', () => setWallPattern(id));
    container.appendChild(btn);
  }
  // item 31d: each SAVED custom pattern is a pattern of its own here (its icon drawn on its bond with its accents)
  for (const u of _userPatterns()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cad-btn brick-pattern-icon brick-user-pattern';
    btn.id = _userPatternButtonId(u);
    btn.title = u.label;
    btn.setAttribute('aria-label', u.label);
    btn.style.cssText = 'padding:2px; min-width:0; height:auto; line-height:0;';
    btn.innerHTML = accentIconSvg(accentOfUserPattern(u), 26, { sunk: u.level < 0, bond: u.bond.builtin }) || u.label;
    btn.addEventListener('click', () => applyUserPattern(u.id));
    container.appendChild(btn);
  }
}

export function setWallPattern(patternId, commit = 'generate') {
  // item 31 (Fred: "pattern and raised data can conflict"): a custom tile's marks belong to ITS bond -- picking
  // another bond drops them; a periodic preset stays (it is re-applied on the new bond)
  const a = _accent();
  if (a.preset === ACCENT_TILE.id && a.tile && a.tile.base !== patternId) {
    P.brickSettings.accent = { ...a, preset: 'none', tile: undefined };
    if (_builder.open) _builder.open = false;
    renderPatternBuilder();
  }
  P.brickSettings.pattern = patternId;
  syncWallPatternButtons();
  syncSetPicker(); // item 23: Fieldstone makes the wall rock (no brick set active), another pattern gives it back
  commitBrickSetting(commit);
}

function syncWallPatternButtons() {
  for (const pattern of WALL_PATTERN_LIST) {
    document.getElementById(`brickPattern_${pattern.id}`)?.classList.toggle('active', pattern.id === P.brickSettings.pattern);
  }
  syncQuickSettings();
  syncLargeStonesRow();
  syncRusticRows();
  renderPatternParams();
  renderWallRotation();
}

/** F35 item 13: the Wall pattern's ROTATION, declared: the chips the Wall section offers (degrees), 0 = as laid. */
export const WALL_ROTATIONS = Object.freeze([0, 45, 90]);
function renderWallRotation() {
  const row = document.getElementById('brickWallRotationRow');
  if (!row) return;
  row.style.display = _hiddenUntilMet('brickWallRotationRow') ? 'none' : 'flex';
  row.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = 'Rotation';
  label.style.cssText = 'font-size:10px; opacity:0.65; width:70px;';
  row.appendChild(label);
  const current = Number(P.brickSettings.wallRotationDeg) || 0;
  for (const deg of WALL_ROTATIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cad-btn' + (deg === current ? ' active' : '');
    b.id = `brickWallRotation_${deg}`;
    b.textContent = `${deg}\u00b0`;
    b.title = deg ? `Turn the wall pattern ${deg}\u00b0` : 'The wall pattern as laid (not turned)';
    b.style.cssText = 'flex:0 0 auto; min-width:0; width:auto; padding:2px 10px;';
    b.addEventListener('click', () => setWallRotation(deg));
    row.appendChild(b);
  }
}
/** F35 item 13: turn the Wall pattern (a WALL_ROTATIONS angle) -- re-lays at once. */
export function setWallRotation(deg, commit = 'generate') {
  if (!WALL_ROTATIONS.includes(deg)) return;
  P.brickSettings.wallRotationDeg = deg;
  renderWallRotation();
  commitBrickSetting(commit);
}

/** F35 item 14: the active Wall pattern's declared params (BRICK_PATTERNS[id].params) as chip rows under the grid --
 *  one chip per declared option, the user's pick (else the default) active. Hidden for a pattern with none. */
function renderPatternParams() {
  const grid = document.getElementById('brickPatternList');
  if (!grid || !grid.parentNode) return;
  let row = document.getElementById('brickPatternParams');
  if (!row) {
    row = document.createElement('div');
    row.id = 'brickPatternParams';
    row.style.cssText = 'margin:4px 0 8px;';
    grid.parentNode.insertBefore(row, grid.nextSibling);
  }
  row.innerHTML = '';
  const id = P.brickSettings.pattern;
  const def = BRICK_PATTERNS[id];
  const params = Object.entries((def && def.params) || {}).filter(([, p]) => p && Array.isArray(p.options));
  row.style.display = params.length ? '' : 'none';
  const current = patternParamsFor(P.brickSettings, id);
  for (const [key, p] of params) {
    const line = document.createElement('div');
    line.style.cssText = 'display:flex; gap:4px; align-items:center; flex-wrap:nowrap; margin-bottom:4px;';
    const label = document.createElement('span');
    label.textContent = p.label || key;
    label.style.cssText = 'font-size:10px; opacity:0.65; width:70px;';
    line.appendChild(label);
    p.options.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cad-btn' + (v === current[key] ? ' active' : '');
      b.id = `brickPatternParam_${key}_${i}`;
      b.textContent = ['S', 'M', 'L'][i] || String(v);
      b.style.cssText = 'flex:0 0 auto; min-width:0; width:auto; padding:2px 10px;';
      b.title = `${p.label || key}: ${v}`;
      b.addEventListener('click', () => setPatternParam(id, key, v));
      line.appendChild(b);
    });
    row.appendChild(line);
  }
}
/** F35 item 14: pick a pattern param (kept per pattern) -- re-lays at once. */
export function setPatternParam(patternId, key, value, commit = 'generate') {
  const all = P.brickSettings.patternParams || {};
  P.brickSettings.patternParams = { ...all, [patternId]: { ...(all[patternId] || {}), [key]: value } };
  renderPatternParams();
  commitBrickSetting(commit);
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
  // Audit K2: a preset with no bands (None) has no band rows -- its heading goes too.
  const show = bands.length > 0;
  const heading = document.getElementById('brickFrameBandPatternLabel');
  if (heading) heading.style.display = show ? '' : 'none';
  container.style.display = show ? '' : 'none';
  // F35 item 46 (Fred: "these can't be changed back after clicking"): a band row ALWAYS lists every pattern a band can
  // lay, whatever the frame's set -- item 23 listed only Fieldstone on a rock frame, and the user was trapped there.
  // What a pick does to the set is setFrameBandPattern's rule below.
  // A band the last lay dropped to fit the board (bandsReduced.kept) is HIDDEN -- its pattern row and its accent block (Fred
  // 2026-10-10: "unused band should just be hidden"; it was greyed, F35 item 35). The Frame note still says "Bands reduced
  // to fit the board: N of M laid"; the band comes back when a lay fits it again (this list re-renders on every lay's note).
  // Not the Corners row's rule ("grey + explain"): that one stays.
  const keptBands = _bandsReduced ? _bandsReduced.kept : bands.length;
  bands.forEach((band, i) => {
    if (i >= keptBands) return;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:4px; margin-bottom:4px; flex-wrap:wrap; align-items:center;';
    const label = document.createElement('span');
    label.textContent = `Band ${i + 1}`;
    label.style.cssText = 'font-size:10px; opacity:0.65; width:44px; flex:0 0 auto;';
    row.appendChild(label);
    for (const pattern of WALL_PATTERN_LIST) {
      const def = BRICK_PATTERNS[pattern.id];
      if (!bandCanLay(def)) continue; // advisor (turn 261): a band lists only what a band can lay; the rest is absent
      const btn = document.createElement('button');
      btn.type = 'button';
      // item 33 (audit N10): the Wall grid's own engine icon, the name as the tooltip
      btn.className = 'cad-btn brick-accent-icon';
      btn.id = `brickFrameBandPattern_${i}_${pattern.id}`;
      btn.title = pattern.label;
      btn.setAttribute('aria-label', pattern.label);
      btn.style.cssText = 'padding:1px; min-width:0; height:auto; line-height:0;';
      btn.innerHTML = wallPatternIconSvg(pattern.id, 22) || pattern.label;
      if (def && def.bandCapable) {
        // picking it on one band makes the whole frame rock: every band fieldstone (one set per element)
        btn.addEventListener('click', () => setFrameRock(true));
      } else {
        btn.addEventListener('click', () => setFrameBandPattern(i, pattern.id));
      }
      row.appendChild(btn);
    }
    container.appendChild(row);
    renderAccentRowFor(container, { kind: 'frameBand', band: i }, 16); // per-band accent (advisor)
  });
}

/** What a Frame BAND can lay: a course pattern (a run of bricks along the band) or an entry declaring `bandCapable`
 *  (fieldstone). Tiles, the sheet's 2D weaves and 'none' are Wall-only, so a band row does not list them. */
export const bandCanLay = (def) => !!def && (def.kind === 'course' || def.kind === 'course-alternating' || !!def.bandCapable);

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
/** F35 item 22 slice 1 step 4: an element tool's sub-tools. Select = click a brick: its element is selected (an
 *  outline on its bricks) and the section edits only that element; nothing selected = the section shows the
 *  settings the next element gets; Esc deselects. Area = paint a wall area (slice 2) -- hidden until the engine
 *  lists 'wallRegion' (brick-control-requires.js). `mode` = the editor mode it arms. */
export const BRICK_SUB_TOOLS = Object.freeze({
  // F35 item 36: a brush draws strokes (its own mode, armed on picking it) or selects one
  draw: { label: 'Draw', mode: 'brickBrush', title: 'Drag a stroke on the canvas to lay bricks along it.' },
  select: { label: 'Select', mode: 'brickElementSelect',
    title: 'Click a brick: its element is selected and this section edits only it. Esc deselects.' },
  // F35 item 43: Stripe has no tab of its own -- a sub-tool of the Brush tab that picks the Stripe TOOL (`tool`)
  stripe: { label: 'Stripe', tool: 'stripe', title: 'Tap a brush stroke to split it into alternating brick-style runs.' },
  area: { label: 'Area', mode: 'brickWallArea',
    title: 'Paint an area: it fills with this wall -- once an area is painted, only painted areas get bricks. A stroke adds to the selected area; with none selected it starts a new one.' },
});
/** F35 item 22 slice 2: the Area brush's widths (inches), declared; P.brickSettings.wallAreaWidthIn. */
export const WALL_AREA_WIDTHS = Object.freeze([0.5, 1, 2]);
const _isArea = (editor, id) => !!id && wallAreaRecords(editor).some((a) => a.id === id);
/** The Area row (width chips + Clear areas): shown with the Area sub-tool only (and while the engine reads
 *  wallRegion). */
/** Item 68 (the editor audit, advisor): with painted areas and none selected, a Wall pattern / rotation pick changes no
 *  area (each keeps its own settings, slice 2) -- it applies to the next area painted. Said, never silent: this line in
 *  the Wall section while areas exist and none is selected. */
export const WALL_AREA_HINT = 'Select an area to change its pattern; new areas use this pattern.';
function syncWallAreaHint() {
  const el = typeof document !== 'undefined' ? document.getElementById('brickWallAreaHint') : null;
  if (!el) return;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const on = !!editor && wallAreaRecords(editor).length > 0 && !editor._brickWallAreaId;
  el.textContent = on ? WALL_AREA_HINT : '';
  el.style.display = on ? '' : 'none';
}

function renderWallAreaRow() {
  syncWallAreaHint();
  const row = typeof document !== 'undefined' ? document.getElementById('brickWallAreaRow') : null;
  if (!row) return;
  const on = _activeTool === 'wall' && _subTool === 'area' && !_hiddenUntilMet('brickWallAreaRow');
  row.style.display = on ? 'flex' : 'none';
  row.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = 'Width';
  label.style.cssText = 'font-size:10px; opacity:0.65; margin-right:2px;';
  row.appendChild(label);
  const current = Number(P.brickSettings.wallAreaWidthIn) || 1;
  for (const w of WALL_AREA_WIDTHS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cad-btn' + (w === current ? ' active' : '');
    b.id = `brickWallAreaWidth_${String(w).replace('.', '_')}`;
    b.textContent = `${w} in`;
    b.title = `Paint ${w} in wide`;
    b.style.cssText = 'flex:0 0 auto; min-width:0; width:auto; padding:2px 5px;';
    b.addEventListener('click', () => setWallAreaWidth(w));
    row.appendChild(b);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'cad-btn';
  clear.id = 'brickWallAreasClear';
  clear.textContent = 'Clear areas';
  clear.title = 'Remove every painted area: the wall fills the whole frame again';
  clear.style.cssText = 'flex:1 0 100%; min-width:0; padding:2px 8px;'; // its own line
  clear.addEventListener('click', () => clearAllWallAreas());
  row.appendChild(clear);
}
/** The Area brush width (a WALL_AREA_WIDTHS value) -- for the next strokes; nothing re-lays. Fred 2026-10-09 (seat D's
 *  undo map: the pick was no step, so undoing a painted area also reverted the width): a CHANGED width is an undo step of
 *  its own -- the 'settings' commit, like every next-stroke setting (item 68) and Art's (74d). */
export function setWallAreaWidth(w) {
  if (!WALL_AREA_WIDTHS.includes(w)) return;
  const changed = P.brickSettings.wallAreaWidthIn !== w;
  P.brickSettings.wallAreaWidthIn = w;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor) editor._brickAreaWidthIn = w;
  saveLastSession();
  if (changed) commitBrickSetting('settings'); // a repeat tap on the same chip is no step
  renderWallAreaRow();
}
/** One painted stroke (board points): onto the selected area, else a new area with the section's settings; the
 *  area becomes the selected one, the wall re-lays -- one undo step. */
export function paintWallArea(points) {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor || !points || !points.length) return null;
  const into = _selectedElement && _isArea(editor, _selectedElement.id) ? _selectedElement.id : null;
  const id = addWallAreaStroke(editor, { points, widthIn: Number(P.brickSettings.wallAreaWidthIn) || 1 }, P.brickSettings, into);
  _selectedElement = { id, kind: 'wall' };
  editor._brickWallAreaId = id;
  _relayStaged();
  _syncSubTools();
  return id;
}
/** Clear areas: every painted area goes, the wall fills the whole frame again -- one undo step. */
export function clearAllWallAreas() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor || !clearWallAreas(editor)) return false;
  selectBrickElement(null);
  _relayStaged();
  return true;
}
const ELEMENT_LABELS = { wall: 'Wall', frame: 'Frame', brush: 'stroke', raisedBrush: 'raised stroke' };
/** F35 item 36: what a selected STROKE's snapshot means in the section -- [panel field, snapshot field] ('{kind}' =
 *  the stroke's tool). Loading a stroke copies these into P.brickSettings; any edit writes the stroke back as the
 *  Brush tool freezes a new one ({ ...P.brickSettings, ...its strokeOverrides }). */
export const STROKE_FIELDS = Object.freeze([
  ['brushBandPreset', 'brushBandPreset'], ['profile', 'profile'], ['orientation', 'orientation'], ['brushAccent', 'brushAccent'],
  ['rusticByElement.brush', 'rustic'], ['groutByElement.brush', 'grout.widthIn'], ['setIds.{kind}', 'setId'],
  ['raisedLevelIn', 'levelIn'], ['raisedMode', 'strokeMode'],
]);
const _getPath = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o);
function _loadStroke(snap, kind) {
  for (const [field, from] of STROKE_FIELDS) {
    const v = _getPath(snap, from);
    if (v === undefined) continue;
    const [k, sub] = field.replace('{kind}', kind).split('.');
    if (sub) P.brickSettings[k] = { ...(P.brickSettings[k] || {}), [sub]: JSON.parse(JSON.stringify(v)) };
    else P.brickSettings[k] = JSON.parse(JSON.stringify(v));
  }
}
const _isStroke = (el) => !!el && (el.kind === 'brush' || el.kind === 'raisedBrush');
export const STROKE_RESTYLE_SETTLE_MS = 300;
let _strokeRestyleTimer = null;
function _scheduleStrokeRestyle() {
  if (!_isStroke(_selectedElement)) return;
  clearTimeout(_strokeRestyleTimer);
  _strokeRestyleTimer = setTimeout(restyleSelectedStroke, STROKE_RESTYLE_SETTLE_MS);
}
/** The selected stroke takes the section's settings now (its bricks re-lay; one undo step). */
export function restyleSelectedStroke() {
  clearTimeout(_strokeRestyleTimer);
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor || !_isStroke(_selectedElement)) return false;
  const overrides = typeof editor._brickStrokeOverrides === 'function' ? editor._brickStrokeOverrides() : {};
  const changed = restyleBrushStroke(editor, _selectedElement.id, { ...P.brickSettings, ...overrides });
  if (changed) showElementSelection(editor, _selectedElement.id);
  return changed;
}
let _subTool = 'select';
let _selectedElement = null; // { id, kind } -- the selected Wall/Frame element (its record), or null

export const selectedBrickElement = () => (_selectedElement ? { ..._selectedElement } : null);

function _renderSubTools() {
  for (const tool of BRICK_TOOLS) {
    if (!tool.subTools) continue;
    const row = document.getElementById(`brickSubTools_${tool.id}`);
    if (!row) continue;
    row.innerHTML = '';
    for (const sid of tool.subTools) {
      const def = BRICK_SUB_TOOLS[sid];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cad-btn';
      btn.id = `brickSubTool_${tool.id}_${sid}`;
      btn.textContent = def.label;
      btn.title = def.title;
      if (_hiddenUntilMet(btn.id)) btn.style.display = 'none';
      btn.addEventListener('click', () => _pickSubTool(tool.id, sid));
      row.appendChild(btn);
    }
  }
  _syncSubTools();
}

function _syncSubTools() {
  for (const tool of BRICK_TOOLS) {
    for (const sid of tool.subTools || []) {
      document.getElementById(`brickSubTool_${tool.id}_${sid}`)?.classList.toggle('active', tool.id === _activeTool && sid === _subTool);
    }
    const label = document.getElementById(`brickElementLabel_${tool.id}`);
    const own = tool.lays || tool.id;
    if (label) {
      label.textContent = _selectedElement && _selectedElement.kind === own
        ? `Editing: this ${ELEMENT_LABELS[own]}` : `Settings for the next ${(ELEMENT_LABELS[own] || '').toLowerCase()}`;
    }
  }
}

/** A sub-tool button of `rowTool`'s row: one that names a `tool` picks that tool (Brush > Stripe); any other arms
 *  on the row's home tool (from the Stripe tool's row, Draw / Select go back to the Brush). */
function _pickSubTool(rowTool, sid) {
  const def = BRICK_SUB_TOOLS[sid];
  if (def && def.tool) {
    if (_activeTool !== def.tool) selectTool(def.tool);
    _subTool = sid;
    _syncSubTools();
    return;
  }
  const row = BRICK_TOOLS.find((t) => t.id === rowTool);
  const home = (row && row.tabOf) || rowTool;
  if (_activeTool !== home) selectTool(home);
  _armSubTool(sid);
}

function _armSubTool(sid) {
  const def = BRICK_SUB_TOOLS[sid];
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  _subTool = sid;
  if (editor && def && def.mode === 'brickElementSelect') {
    editor._brickElementSelect = (pt) => {
      const hit = brickElementAt(editor, pt);
      if (!hit) { selectBrickElement(null); return; }
      selectBrickElement(hit);
    };
    editor.setMode('brickElementSelect');
  }
  if (editor && def && def.mode === 'brickBrush') { // F35 item 36: back to drawing strokes (nothing selected)
    if (_selectedElement) selectBrickElement(null);
    _subTool = sid;
    editor.setMode('brickBrush');
  }
  if (editor && def && def.mode === 'brickWallArea') { // slice 2: paint wall areas
    editor._brickAreaWidthIn = Number(P.brickSettings.wallAreaWidthIn) || 1;
    editor._brickWallArea = (points) => paintWallArea(points);
    editor.setMode('brickWallArea');
  }
  _syncSubTools();
  renderWallAreaRow();
}

/** Select an element ({ id, kind }) -- its tool becomes the active one (its section shows), its bricks are
 *  outlined -- or clear the selection (null). */
export function selectBrickElement(element) {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  _selectedElement = element ? { id: element.id, kind: element.kind, ...(element.part ? { part: element.part } : {}) } : null;
  // slice 2: a painted area's OWN settings come into the section (it edits them); the next lay keeps them on it
  const area = editor && element ? wallAreaRecords(editor).find((a) => a.id === element.id) : null;
  if (editor) editor._brickWallAreaId = area ? area.id : null;
  if (area && area.settings) { Object.assign(P.brickSettings, withWallFields(P.brickSettings, area.settings)); syncControlsFromState(); }
  // F35 item 36: a STROKE's own settings come into its brush's section
  const stroke = editor && _isStroke(element) ? brushStrokeSettings(editor, element.id) : null;
  if (stroke) _loadStroke(stroke, element.kind);
  if (element) {
    const tool = BRICK_TOOLS.find((t) => (t.lays || t.id) === element.kind);
    // a stroke's brush is (re)armed even when already active: its editor needs the brush's stroke overrides
    if (tool && (tool.id !== _activeTool || stroke)) selectTool(tool.id, { keepSelection: true });
    if (stroke) { _armSubTool('select'); syncControlsFromState(); syncBrushPresetButtons(); syncProfileToggle(); syncOrientationToggle(); syncRaisedSection(); syncAccentControls(); }
  }
  showElementSelection(editor, _selectedElement && _selectedElement.id);
  _syncSubTools();
  syncWallAreaHint(); // item 68: the hint follows the area selection
  syncGroutPaintRow(); // item 55: the Grout block edits the picked element's paint
  if (_selectedElement && _selectedElement.part === 'grout') document.getElementById('brickGroutPaintRow')?.scrollIntoView?.({ block: 'nearest' });
}

function selectTool(id, { keepSelection = false } = {}) {
  if (typeof document !== 'undefined') queueMicrotask(renderWallAreaRow); // the Area row follows the tool
  _disarmAccentClick(); // F35 item 15: a tool pick ends Click bricks
  if (!keepSelection && _selectedElement) {
    _selectedElement = null;
    const ed = typeof window !== 'undefined' ? window.svgEditor : null;
    if (ed) ed._brickWallAreaId = null;
    showElementSelection(ed, null);
  }
  _activeTool = id;
  _generalTab = false; // item 43: a tool pick (a tab, a sub-tool or Select on the canvas) shows that tool's tab
  if (id === 'stripe') _subTool = 'stripe';
  syncToolButtons();
  syncGroutWidthBox(); // the Grout box follows the active element's joint
  syncGroutPaintRow();
  syncSetPicker(); // item 61: the Set row shows the active element's own sets (the Frame: every band-capable one)
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor) {
    console.warn('Brick tool: open the SVG editor first (Edit Artwork) -- no editor instance yet.');
    return;
  }
  const tool = BRICK_TOOLS.find((t) => t.id === id);
  if (id === 'brush' || (tool && tool.variantOf === 'brush')) {
    editor._brickSettings = P.brickSettings; // same object, mutated in place -- see header
    // turn 201: a variant's own stroke fields; item 23: + the tool's own set, frozen into each stroke
    editor._brickStrokeOverrides = () => ({ setId: elementSetId(P.brickSettings, tool.id), rustic: _rustic('brush'),
      grout: { ...P.brickSettings.grout, widthIn: elementGroutWidth(P.brickSettings, tool.id) }, // its own joint, frozen
      ...(tool.strokeOverrides ? tool.strokeOverrides() : {}) });
    editor.setMode('brickBrush');
    if (!keepSelection) { _subTool = 'draw'; _syncSubTools(); } // F35 item 36: a brush opens on Draw
    return;
  }
  // Audit C2: picking Wall or Frame only shows its settings (and the pinned Generate); it never lays.
  // Generate lays the tool's own kind (audit C1, _kindsToLay). Wall stays clipped to an existing frame's
  // interior via the composer (advisor review, turn 131).
  if (id === 'wall' || id === 'frame') {
    if (id === 'frame' && !resolveFrameGeom(editor)) console.warn('Brick Frame tool: no usable frame contour on this board.');
    _armSubTool('select'); // item 22: an element tool opens on Select (Frame has nothing else)
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
    // tagged pieces on the next commit, giving each run its picked brick style (audit C6).
    editor._brickSettings = P.brickSettings;
    editor.setMode('stripe');
    syncStripePanelContext();
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
  // item 33: butt_frame / quoin_corners are folded into Soldier + the Corners row (FOLDED_FRAME_PRESETS)
  double_course: 'Soldier x2',
  header_band: 'Header',
  mixed_bands: 'Header / Flemish / Soldier',
};
const FRAME_PRESET_LIST = Object.keys(FRAME_PRESETS).filter((id) => !FOLDED_FRAME_PRESETS[id])
  .map((id) => ({ id, label: FRAME_PRESET_LABELS[id] || id }));

/** F35 item 18 (3), the sidebar's QUICK settings (#brickQuickSettings, main sidebar 🧱 BRICK): a few
 *  2D settings mirrored from the editor's Brick tab -- the SAME P.brickSettings and the SAME setters,
 *  committed 'auto' (re-lay at once), the sidebar's own rule. Declared here as data: each row names its
 *  choices (the editor's own declared lists), which choice is current, and how to apply one. */
// F35 item 23: the brick sets (rock is implied by the Fieldstone pattern); the sidebar's quick Set applies to ALL
// elements at once. `mixed` (BRICK audit A5): the text shown when NO choice is current (the elements differ, after a
// per-element pick in the editor) -- the row says so instead of showing nothing active; `when` = it applies (the
// elements' sets really differ: an all-rock board shows no brick set active without being mixed). `columns` (A9): an icon grid of
// that many columns (the Wall pattern's 21 icons took 11 rows). `stage` (seat D 2026-10-09, phone feedback audit on seat
// A's loaded board): the loading stage a pick shows FIRST -- the pick re-renders the Brick panel (~73 ms at 4x CPU) before
// its own re-lay / re-mask stage could paint: 53-79 ms frozen with no card. The stage named is the work it starts.
export const BRICK_QUICK_SETTINGS = [
  { id: 'set', label: 'Set', stage: 'bricks', choices: () => BRICK_SET_IDS.map((id) => ({ id, label: _setLabel(id) })),
    mixed: { label: 'Mixed', title: 'The elements use different sets (picked per element in the Brick tab); a pick here applies to every element',
      when: () => new Set(SET_KINDS().map((k) => elementSetId(P.brickSettings, k))).size > 1 },
    isCurrent: (c) => SET_KINDS().every((k) => elementSetId(P.brickSettings, k) === c.id), apply: (c) => selectSet(c.id, 'auto', SET_KINDS(), { strokes: true }) }, // A6: applies to every element, strokes too
  { id: 'size', label: 'Brick size', stage: 'bricks', choices: () => BRICK_SIZE_PRESETS,
    isCurrent: (c) => c.lengthIn === P.brickSettings.brickLengthIn, apply: (c) => setBrickSize(c.lengthIn, 'auto') },
  { id: 'pattern', label: 'Wall pattern', stage: 'bricks', choices: () => WALL_PATTERN_LIST, iconFor: (c) => wallPatternIconSvg(c.id, 24), columns: 4,
    isCurrent: (c) => c.id === P.brickSettings.pattern, apply: (c) => setWallPattern(c.id, 'auto') },
  // F35 item 63 (Fred: the pick "does nothing" with no Frame element on the board): a pick LAYS the frame
  // (`lays`), or re-lays it; greyed while the board has no frame contour (BRICK_CONTROL_REQUIRES 'frameContour')
  { id: 'frameBands', label: 'Frame bands', stage: 'bricks', choices: () => FRAME_PRESET_LIST, iconFor: (c) => framePresetIconSvg(c.id, 24),
    lays: 'frame', isCurrent: (c) => c.id === P.brickSettings.frameBandPreset, apply: (c) => setFrameBandPreset(c.id, 'auto') },
  // F35 item 55: the board-wide grout colour (paint only, nothing re-lays); any other hex from the Brick tab's picker
  { id: 'groutColor', label: 'Grout colour', stage: 'heightMask', choices: () => GROUT_COLOR_CHOICES, iconFor: _groutSwatchSvg, // paint only: the re-mask
    isCurrent: (c) => c.color === ((P.brickSettings.groutPaint || {}).color ?? null), apply: (c) => setGroutPaint({ color: c.color }, null) },
];
const quickButtonId = (row, choice) => `brickQuick_${row.id}_${choice.id}`;
const quickRowId = (row) => `brickQuickRow_${row.id}`;
const quickMixedId = (row) => `brickQuickMixed_${row.id}`; // its own namespace: never a choice's (brickQuick_<row>_<choice>)
/** F35 item 55: the sidebar's grout colours, declared -- None (the board shows through) + a few mortar shades. */
export const GROUT_COLOR_CHOICES = Object.freeze([
  { id: 'none', label: 'None (the board shows through)', color: null },
  { id: 'mortar', label: 'Mortar', color: '#cfc6b4' },
  { id: 'white', label: 'White', color: '#f2efe8' },
  { id: 'grey', label: 'Grey', color: '#8f8f8a' },
  { id: 'charcoal', label: 'Charcoal', color: '#3b3b3b' },
]);
function _groutSwatchSvg(c) {
  const fill = c.color || '#ffffff';
  const slash = c.color ? '' : '<line x1="3" y1="21" x2="21" y2="3" stroke="#c0392b" stroke-width="2"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="3" fill="${fill}" stroke="#888"/>${slash}</svg>`;
}

function renderQuickSettings(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const row of BRICK_QUICK_SETTINGS) {
    const label = document.createElement('label');
    label.className = 'cad-label';
    label.textContent = row.label;
    container.appendChild(label);
    const list = document.createElement('div');
    list.id = quickRowId(row);
    list.style.cssText = row.columns
      ? `display:grid; grid-template-columns:repeat(${row.columns}, minmax(0, 1fr)); gap:4px; margin-bottom:10px;`
      : 'display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;';
    for (const choice of row.choices()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cad-btn';
      btn.id = quickButtonId(row, choice);
      // F35 item 13: a visual row (iconFor) shows icons only, the name as the tooltip
      const icon = row.iconFor && row.iconFor(choice);
      if (icon) { btn.innerHTML = icon; btn.title = choice.label; btn.setAttribute('aria-label', choice.label); btn.style.padding = '2px'; }
      else btn.textContent = choice.label;
      if (row.columns) btn.style.minWidth = '0'; // A9: a grid cell, not .cad-btn's 75 px floor (4 x 75 overflowed the sidebar)
      // item 71: one global undo step per pick (core/history.js recordBoardStep: the settings AND the laid bricks)
      btn.addEventListener('click', () => withLoadingStageShownFirst(row.stage, () => recordBoardStep(`Bricks: ${row.label}`, () => { if (row.lays) requestLay(row.lays); row.apply(choice); })));
      list.appendChild(btn);
    }
    if (row.mixed) { // A5: shown by syncQuickSettings while no choice is current and the row's `when` holds
      const chip = document.createElement('span');
      chip.id = quickMixedId(row);
      chip.className = 'brick-quick-mixed';
      chip.textContent = row.mixed.label;
      chip.title = row.mixed.title;
      chip.style.cssText = 'display:none; align-self:center; font-size:10px; font-style:italic; opacity:0.75; padding:2px 6px; border:1px dashed currentColor; border-radius:4px;';
      list.appendChild(chip);
    }
    container.appendChild(list);
  }
  syncQuickSettings();
}

function syncQuickSettings() {
  for (const row of BRICK_QUICK_SETTINGS) {
    let any = false;
    for (const choice of row.choices()) {
      const on = row.isCurrent(choice);
      any = any || on;
      document.getElementById(quickButtonId(row, choice))?.classList.toggle('active', on);
    }
    const mixed = row.mixed ? document.getElementById(quickMixedId(row)) : null;
    if (mixed) mixed.style.display = !any && row.mixed.when() ? '' : 'none';
  }
}

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
/** The contour the Frame bands follow -- and, with no Frame element, the wall (item 42): F35 item 66 (Fred: "the brick
 *  frame is always offset from frame anyway, so remove that"): the frame's OUTER edge; with no frame template, the board
 *  rectangle. LEGACY_FRAME_OFFSET: the retired Offset-from-frame control is no longer shown or written, but a board saved
 *  with it keeps laying as before (OFF = the board rectangle, a distance = the edge offset by it). null = a template whose
 *  outline cannot carry a contour (FRAME_NEEDS_A_FRAME). */
const LEGACY_FRAME_OFFSET = Object.freeze({ on: true, distance: 0 });
function frameBandContour(editor) {
  const off = P.brickSettings.frameOffset || LEGACY_FRAME_OFFSET;
  const rect = () => rectToPrimitives({ x1: 0, y1: 0, x2: editor._mW, y2: editor._mH });
  if (off.on === false) return rect();
  const ctx = frameContext(editor);
  // item 66: no frame template = the board rectangle. MEASURED live (seat D, item 63): under template None the
  // provider still returns a context ({defs, record} with no templateId), so `!ctx` alone never fired there
  if (!ctx || !hasFrame(ctx)) return rect();
  const sil = frameContourSilhouette(ctx, Number(off.distance) || 0, 0);
  return sil.error ? null : sil.primitives;
}

/** Item 9: the frame record's inset window, ON, as its outer rect on the board (core/inset-window.js); else null. */
function _insetWindowRect(editor) {
  const w = getFrameRecord().insetWindow;
  return w && w.enabled && editor ? insetWindowOuterRect(w, editor._mW, editor._mH) : null;
}
function resolveFrameGeom(editor) {
  const contour = frameBandContour(editor);
  if (!contour) return null;
  const primitives = buildRibbonPrimitives(contour);
  // item 33: + the element's corner (frameBandsOf -- the preset's own unless the Corners row picked one)
  // item 9: + the inset window's outer rect while it is on (the Window surround lays around it)
  return { primitives, bands: frameBandsOf(P.brickSettings), insetRect: _insetWindowRect(editor) };
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
  const gw = groutWidthIn ?? Math.min(...BRICK_KINDS.map((k) => elementGroutWidth(P.brickSettings, k)));
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
  _jointSets = _currentJointSets(); // grout per element: the sets at init are the baseline, not a set change
  onPageEvent('spacingHint', 'bricksGenerated', (e) => updateSpacingHint(e.detail?.groutWidthIn));
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
  onPageEvent('toolButtons', 'editorTabChanged', (e) => { if (e.detail?.tab === 'brick') syncToolButtons(); else syncStartHint(); });
  renderToolList(document.getElementById('editorToolbarBrick'));
  syncToolButtons();
  renderFramePresetList(document.getElementById('brickFramePresetList'));
  renderFrameCornerList(document.getElementById('brickFrameCornerList'));
  renderFrameFanCentreList(document.getElementById('brickFrameFanCentreList')); // T86 item 16e
  syncFramePresetButtons();
  renderBrushPresetList(document.getElementById('brickBrushPresetList'));
  syncBrushPresetButtons();
  renderWallPatternList(document.getElementById('brickPatternList'));
  syncWallPatternButtons();
  renderAccentList(document.getElementById('brickAccentList'));
  renderElementAccentRows(); // the Frame bands' + the Brush's Accent rows
  document.getElementById('brickAccentClick')?.addEventListener('click', () => toggleAccentClickMode({ kind: 'wall' }));
  // item 41: opening the builder renders its grid + previews (279 ms blocked at 900 px / CPU x4): its pill paints first
  document.getElementById('brickAccentCustomOpen')?.addEventListener('click', () => (_builder.open ? closePatternBuilder()
    : withLoadingStageShownFirst('openBuilder', openPatternBuilder)));
  document.getElementById('brickAccentLevel')?.addEventListener('change', (e) => setAccentLevel(e.target.value));
  syncAccentControls();
  renderBrickSizePresetList(document.getElementById('brickSizePresetList'));
  syncBrickSizePresetButtons();
  renderQuickSettings(document.getElementById('brickQuickSettings'));

  renderSetRow(document.getElementById('brickSetRow')); // item 23: from the brick sets' declarations

  bindBrickSizeControls();
  // the joint WIDTH is per element (setElementGrout); depth + profile stay board-wide (bindGroutField)
  const groutBox = document.getElementById('brickGroutWidth');
  const groutSettle = settleAfterTyping('generate');
  groutBox?.addEventListener('input', (e) => { setElementGrout(_jointKind(), e.target.value, 'onDrag'); groutSettle(); });
  groutBox?.addEventListener('change', (e) => setElementGrout(_jointKind(), e.target.value, 'onRelease'));
  // F35 item 55: the grout paint -- the app's colour mosaic, None, and the Edge (paint inset)
  const swatch = document.getElementById('brickGroutColorSwatch');
  swatch?.addEventListener('click', (e) => { e.stopPropagation(); openColorMosaic(swatch, (hex) => setGroutPaint({ color: hex })); });
  document.getElementById('brickGroutColorNone')?.addEventListener('click', () => setGroutPaint({ color: null }));
  document.getElementById('brickGroutEdge')?.addEventListener('change', (e) => setGroutPaint({ paintInsetIn: e.target.value }));
  syncGroutPaintRow();
  bindGroutField('brickGroutDepth', 'depthIn', 'surface'); // F35 item 18: the joint recess depth, height-only
  document.getElementById('brickBtnGroutRecessed')?.addEventListener('click', () => setGroutProfile('recessed'));
  document.getElementById('brickBtnGroutFlush')?.addEventListener('click', () => setGroutProfile('flush'));
  // F35 item 18 (3): Relief + Max Height moved to the main sidebar -- 'auto' there (re-lay at once)
  document.getElementById('brickBtnReliefRaised')?.addEventListener('click', () => setInvert(false, 'auto'));
  document.getElementById('brickBtnReliefCarved')?.addEventListener('click', () => setInvert(true, 'auto'));
  document.getElementById('brickBtnTopOrganic')?.addEventListener('click', () => setBrickTopMode('organic'));
  document.getElementById('brickBtnTopFlat')?.addEventListener('click', () => setBrickTopMode('flat'));
  renderSurfaceStyleToggle(document.getElementById('brickSurfaceStyleToggle'));
  renderRaisedModeToggle(document.getElementById('brickRaisedModeToggle'));
  document.getElementById('brickRaisedLevel')?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    P.brickSettings.raisedLevelIn = v;
    notifyChange();
  });
  // item 68: the typed / stepped level is one settings step once it is committed ('change'), not one per keystroke
  document.getElementById('brickRaisedLevel')?.addEventListener('change', () => commitBrickSetting('settings'));
  renderStripeBrickStyles(document.getElementById('stripeBrickStyles'));
  document.getElementById('stripeThree')?.addEventListener('change', () => { syncStripeBrickStyles(); });
  onPageEvent('stripeContext', 'editorTabChanged', () => syncStripePanelContext());
  bindSlider('brickSurfaceWearSlider', 'brickSurfaceWear', 'surfaceWear', (v) => Math.max(0, Math.min(1, parseFloat(v))), 'surface');
  for (const kind of BRICK_KINDS) {
    document.getElementById(`brickLevel_${kind}`)?.addEventListener('change', (e) => setElementLevel(kind, e.target.value));
  }
  // F35 item 29 (a): Rustic per element -- applies on release / Enter (the Wall re-lays; Brush = next strokes)
  for (const kind of RUSTIC_ELEMENTS) {
    document.getElementById(`brickRusticSlider_${kind}`)?.addEventListener('change', (e) => setRustic(kind, e.target.value));
    document.getElementById(`brickRustic_${kind}`)?.addEventListener('change', (e) => setRustic(kind, e.target.value));
  }
  document.getElementById('brickBtnProfileStripped')?.addEventListener('click', () => setProfile('bricks'));
  document.getElementById('brickBtnProfileContinuous')?.addEventListener('click', () => setProfile('continuous'));
  document.getElementById('brickBtnOrientationStretcher')?.addEventListener('click', () => setOrientation('stretcher'));
  document.getElementById('brickBtnOrientationSoldier')?.addEventListener('click', () => setOrientation('soldier'));
  bindSlider('brickReliefHeightSlider', 'brickReliefHeight', 'reliefIn', parseFloat, 'auto');
  // F35 item 21: a LAYOUT setting -- the editor marks it pending (Generate)
  bindSlider('brickLargeStonesSlider', 'brickLargeStones', 'largeStones', (v) => Math.max(0, Math.min(1, parseFloat(v))));
  bindSlider('brickSuppressionSlider', 'brickSuppression', 'suppression');
  bindSlider('brickClumpingSlider', 'brickClumping', 'clumping');
  // item 9: the crumble's top bias (General), the frame's own crumble + the window surround (Frame tab)
  bindSlider('brickTopBiasSlider', 'brickTopBias', 'topBias');
  bindSlider('brickFrameSuppressionSlider', 'brickFrameSuppression', 'frameSuppression');
  document.getElementById('brickSuppressFrame')?.addEventListener('change', (e) => setFrameCrumble(e.target.checked));
  renderWindowSurround();
  onPageEvent('windowSurround', 'frameRecordChanged', () => syncWindowSurround());
  const settleSeed = settleAfterTyping('generate'); // item 27: a typed seed re-lays once the typing pauses
  document.getElementById('brickSeed')?.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) return;
    P.brickSettings.seed = v;
    commitBrickSetting('generate', 'onDrag');
    settleSeed();
  });
  document.getElementById('brickBtnRandomSeed')?.addEventListener('click', () => setSeed(newBrickSeed()));
  document.getElementById('brickGenerate')?.addEventListener('click', () => generateNow()); // item 39: a new seed, every element
  if (!_requiresFlushBound) { // once per page (a document listener per init re-ran every handler)
    _requiresFlushBound = true;
    for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, flushControlRequires, true); // commitBrickSetting's deferred sync
  }
  onPageEvent('editorCommit', 'editorCommit', () => { _relayIfBrushChanged(); syncControlRequires(); syncStartHint(); syncWallAreaHint(); });
  onPageEvent('controlRequires', 'bricksGenerated', () => syncControlRequires()); // audit v2 N5: bricks now laid
  onPageEvent('controlRequiresFrame', 'frameRecordChanged', () => syncControlRequiresSoon()); // item 74b: a new outline, new corner facts
  // the frame changed (template, shape): re-lay once it settles (item 27 -- the editor too; a template with no
  // contour clears the Frame). Wired ONCE per page (onPageEvent): it RE-LAYS, so a second copy would re-lay twice
  onPageEvent('frameRelay', 'frameRecordChanged', (e) => _scheduleFrameRelay(!!(e && e.detail && e.detail.restored)));
  // 2026-10-07: the board size is part of the frame key (_frameKey) -- a new board re-lays too, once the editor has it
  onPageEvent('frameRelayBoard', 'editorBoardResized', () => {
    if (!_boardRelayHoldClose) _boardRelayHoldClose = joinRebuildHold('brick-relay');
    _scheduleFrameRelay();
  });
  // Audit B1 + v2 N2: P.brickSettings was replaced (Cancel, session restore, project load, global undo --
  // app-init.js announceBrickSettingsRestored). A load swaps in a NEW object: an armed Brush keeps
  // reading the editor's own reference, so it is re-pointed too.
  onPageEvent('settingsRestored', 'brickSettingsRestored', () => {
    _jointSets = _currentJointSets(); // a replaced P.brickSettings: its sets are the new baseline, not a set change
    const editor = typeof window !== 'undefined' ? window.svgEditor : null;
    if (editor && editor._brickSettings) editor._brickSettings = P.brickSettings;
    // the Area brush width (its own undo step, seat D 2026-10-09): the brush's live width and its chips follow too
    if (editor) editor._brickAreaWidthIn = Number(P.brickSettings.wallAreaWidthIn) || 1;
    renderWallAreaRow();
    syncControlsFromState();
  });

  syncControlsFromState();
}

export function setSeed(v, commit = 'generate') {
  P.brickSettings.seed = v;
  const field = document.getElementById('brickSeed');
  if (field) field.value = v;
  commitBrickSetting(commit);
}
