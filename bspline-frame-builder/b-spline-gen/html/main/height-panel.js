/**
 * main/height-panel.js -- HEIGHT-PAINTER slice 1 (HEIGHT-PAINTER-DESIGN.md): the editor's Height tab. Paint height patches
 * -- placeable rectangles of heights in inches (core/height/layer.js) -- ON the shared editor canvas (the advisor's
 * amendment 2, Fred: "tabs content carry over visually"): each patch is a hill-shaded image in the editor's own coordinate
 * space, in the same group the photo footprint draws in, visible in every tab (faded outside this one). The brush is the
 * editor gesture mode 'heightBrush' (editor/editor-height-tool.js); this module is its `editor._heightTool`.
 *
 * The panel and the rail are RENDERED from one declared table, HEIGHT_CONTROLS (a new setting is one entry). The brush
 * settings are UI state (this session); every patch setting lives in its own record, P.heightLayers[i]. COPY-ON-WRITE like
 * the STL panel: a write builds a new list holding a new record and assigns it to P.heightLayers (the history and the
 * editor's undo part hold the old list by reference). A stroke commits ONCE on release: encode (core/height/raster.js),
 * then the new record, then ONE editor undo step (the 'heightLayers' undo part rides in it) and the session save.
 * Nothing here rewrites a loaded board (AGENTS.md rule 3): a control writes only when the user moves it.
 */
import { P, scheduleSessionSave } from '../core/state.js';
import { scheduleUndoSnapshot } from '../core/history.js';
import { withLoadingStage } from '../core/loading-signal.js';
import { encodeRaster, decodedRaster, ensureRasterDecoded, RASTER_ENC_U16 } from '../core/height/raster.js';
import { BRUSH_DEFAULTS, BRUSH_MODES, BRUSH_FALLOFFS, BRUSH_TIPS, BRUSH_PRESETS, BRUSH_ALT_MODE, brushPresetOf, brushFalloff, createStroke, curveFromPoints, curvePointsFromProfile } from '../core/height/brush.js';
import { liftPiece, placePiece, shiftMask } from '../core/height/move.js';
import { _isTypingTarget } from '../editor/dom.js';
import { newHeightLayer, newHeightId, normaliseHeightLayer, boardToPatchPixel, sampleRaster, HEIGHT_PX_PER_IN } from '../core/height/layer.js';
import {
  PATCH_LAYER_BLENDS, BASE_LAYER_ID, IMAGE_MAPPING_DEFAULTS, isLayered, patchLayers, patchGrid, layeredRecord, patchComposite, compositeKey, ensurePatchDecoded, patchRasters,
} from '../core/height/compose.js';
import { shadeRaster, shadeSize } from '../core/height/shade.js';
import { rectMask, ellipseMask, lassoMask, featherMask, invertMask, maskOutline, maskFromSvg, maskAny } from '../core/height/selection.js';
import { getLayerSvg } from '../editor/editor-io.js';
import { GRADIENT_DEFAULTS, applyGradient } from '../core/height/gradient.js';
import { FILL_DEFAULTS, applyFill } from '../core/height/fill.js';
import { HEIGHTMAP_LOADERS, decodeHeightmap, resampleToGrid, mappingFromName } from '../core/height/import.js';
import { exportHeightmapPng } from '../core/height/export.js';
import { applyLayerTransform } from '../core/stamp/transform.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { commitEdit } from '../editor/editor-commit.js';
import { EDITOR_TAB_FOCUS } from '../editor/editor-frame-profile.js';
import { setEditorTab, getEditorTab } from './editor-tabs.js';
import { mountIconGrid } from './icon-select.js';

/** The canvas view: the shaded picture's longest side in pixels (display only; the raster keeps its 100 px/in). */
export const HEIGHT_VIEW = Object.freeze({
  maxImagePx: 512,
  outline: '#7a4fd6', ring: '#7a4fd6', halo: '#ffffff',
});

export const HEIGHT_GROUPS = Object.freeze([
  // the Brush AND the Eraser (HEIGHT_TOOLS rows with rush) share this section: the picker + the brush settings (slice 3b)
  Object.freeze({ id: 'brush', label: 'Brush', note: 'pick a brush, then paint; Alt while painting: Raise <-> Lower', showWhen: (ctx) => !ctx || usesBrush(ctx.tool) }),
  Object.freeze({ id: 'patch', label: 'Patch', note: 'inches from the board centre; +Y is up the screen' }),
  Object.freeze({ id: 'stamp', label: 'Stamp' }),
]);

const MODE_LABELS = Object.freeze({ raise: ['▲', 'Raise', 'Add height'], lower: ['▼', 'Lower', 'Take height away'], set: ['＝', 'Set', 'Move toward the target height'], smooth: ['≈', 'Smooth', 'Blur the heights under the brush'], erase: ['⌫', 'Erase', 'Back to 0 (no effect on the board)'] });

/**
 * Every control, once. target 'brush' = the brush (UI state, key `path[0]`), 'patch' = the ACTIVE patch's record (`path`).
 * kind 'slider' (range + number), 'choice' (segmented buttons), 'check' or 'curve' (the falloff curve widget). An entry's optional\n * showWhen(brush, patch) hides its control while false; lsoSet(prev, next, brush) (choice) returns extra brush keys to write with it. `range(P)` is only the slider's travel, NOT a
 * rule: a typed value outside it is stored as typed (no clamp; AGENTS.md "ask before any clamp").
 */
const sameCurve = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

export const HEIGHT_CONTROLS = Object.freeze([
  // Fred 2026-11-22 (slice 3b): ONE Brush tool on the rail; its modes are this row in the panel, and erase is the Eraser tool
  { id: 'mode', group: 'brush', target: 'brush', kind: 'choice', path: ['mode'], label: 'Mode', showWhen: (b, p, ctx) => !ctx || ctx.tool !== 'eraser',
    options: BRUSH_MODES.filter((m) => m !== 'erase').map((m) => [m, MODE_LABELS[m][1], MODE_LABELS[m][2]]) },
  { id: 'sizeIn', group: 'brush', target: 'brush', kind: 'slider', path: ['sizeIn'], label: 'Size (in)', step: 0.01, range: () => [0.02, 4] },
  { id: 'hardness', group: 'brush', target: 'brush', kind: 'slider', path: ['hardness'], label: 'Hardness', step: 0.01, range: () => [0, 1], note: '1 = a hard edge, 0 = all soft' },
  // Fred 2026-11-22: the shape of the roll-off outside the hard core (core/height/brush.js BRUSH_FALLOFFS)
  { id: 'falloff', group: 'brush', target: 'brush', kind: 'choice', path: ['falloff'], label: 'Falloff',
    options: Object.entries(BRUSH_FALLOFFS).map(([k, p]) => [k, p.label, p.title]),
    // Custom starts from the shape the brush had: while the curve is still the default, seed it from the previous profile
    alsoSet: (prev, next, brush) => (next === 'custom' && prev !== 'custom' && BRUSH_FALLOFFS[prev] && !BRUSH_FALLOFFS[prev].custom && sameCurve(brush.customCurve, BRUSH_DEFAULTS.customCurve)
      ? { customCurve: curvePointsFromProfile(prev, 6) } : null) },
  // Fred 2026-11-22: a small widget to design a custom falloff (points [t, value]; t 0 = the hardness edge, 1 = the rim)
  { id: 'customCurve', group: 'brush', target: 'brush', kind: 'curve', path: ['customCurve'], label: 'Custom falloff', showWhen: (brush) => brush.falloff === 'custom' },
  { id: 'opacity', group: 'brush', target: 'brush', kind: 'slider', path: ['opacity'], label: 'Opacity', step: 0.01, range: () => [0, 1], note: 'the most one stroke can do' },
  { id: 'flow', group: 'brush', target: 'brush', kind: 'slider', path: ['flow'], label: 'Flow', step: 0.01, range: () => [0, 1], note: 'how fast a stroke builds up to its opacity' },
  { id: 'spacing', group: 'brush', target: 'brush', kind: 'slider', path: ['spacing'], label: 'Spacing (x size)', step: 0.01, range: () => [0.01, 1] },
  { id: 'amountIn', group: 'brush', target: 'brush', kind: 'slider', path: ['amountIn'], label: 'Amount (in, raise / lower)', step: 0.005, range: () => [0, 1], showWhen: (b, p, ctx) => !ctx || ctx.tool !== 'eraser' },
  { id: 'targetIn', group: 'brush', target: 'brush', kind: 'slider', path: ['targetIn'], label: 'Set to height (in)', step: 0.005, range: () => [-1, 1.5], showWhen: (b, p, ctx) => !ctx || ctx.tool !== 'eraser',
    note: '0 = transparent (no effect on the board)' },
  { id: 'pressureSize', group: 'brush', target: 'brush', kind: 'check', path: ['pressureSize'], label: 'Pen pressure → size' },
  { id: 'pressureOpacity', group: 'brush', target: 'brush', kind: 'check', path: ['pressureOpacity'], label: 'Pen pressure → opacity' },
  { id: 'posX', group: 'patch', target: 'patch', kind: 'slider', path: ['position', 'x'], label: 'X', step: 0.05, range: (p) => [-p.widthIn, p.widthIn] },
  { id: 'posY', group: 'patch', target: 'patch', kind: 'slider', path: ['position', 'y'], label: 'Y', step: 0.05, range: (p) => [-p.heightIn, p.heightIn] },
  { id: 'rotation', group: 'patch', target: 'patch', kind: 'slider', path: ['rotation'], label: 'Turn (degrees)', step: 1, range: () => [-180, 180] },
  { id: 'sizeW', group: 'patch', target: 'patch', kind: 'slider', path: ['sizeIn', 'w'], label: 'Width (in)', step: 0.05, range: (p) => [0.1, 2 * p.widthIn],
    note: 'a new size stretches the painting' },
  { id: 'sizeH', group: 'patch', target: 'patch', kind: 'slider', path: ['sizeIn', 'h'], label: 'Height (in)', step: 0.05, range: (p) => [0.1, 2 * p.heightIn] },
  { id: 'raise', group: 'stamp', target: 'patch', kind: 'choice', path: ['raise'], label: 'Relief',
    options: [[true, 'Raised', 'The painted heights stand out of the surface'], [false, 'Carved', 'The painted heights are cut into the surface']] },
  { id: 'blend', group: 'stamp', target: 'patch', kind: 'choice', path: ['blend'], label: 'Blend',
    options: [['add', 'Add', 'The painted height is added to the surface'], ['max', 'Max', 'Only what stands above the surface shows; nothing is dug']] },
  { id: 'zOffset', group: 'stamp', target: 'patch', kind: 'slider', path: ['zOffset'], label: 'Z offset (in)', step: 0.005, range: () => [-1, 1],
    note: 'added where the patch is painted' },
  // no "On the terrain" choice: a height patch always follows the terrain, like an SVG layer (Fred 2026-11-22, "No rigid")
  { id: 'placement', group: 'stamp', target: 'patch', kind: 'choice', path: ['placement'], label: 'Thicken',
    options: [['withSurface', 'Before thicken', 'The back follows the patch'], ['afterBack', 'After thicken', 'Top only: the back stays as it is without this patch']] },
]);

/**
 * HEIGHT-PAINTER slice 2: the controls of the layers and the precision tools, in the SAME shape as HEIGHT_CONTROLS and read
 * by the same renderer / setter (one mechanism; a second table only so the slice-1 table stays as it was). target 'layer' =
 * the ACTIVE layer of the active patch (`path` in that layer). Each group shows by its own showWhen(ctx).
 */
/** The canvas tools (the rail's first buttons, `data-height-tool`); the gesture each one runs is GESTURES[id] below. */
export const HEIGHT_TOOLS = Object.freeze([
  Object.freeze({ id: 'brush', icon: '🖌', label: 'Brush', title: 'Paint heights: pick a brush and a mode in the panel (Alt: Raise <-> Lower)', brush: { mode: null } }),
  // Fred 2026-11-22 ("we need an eraser too"): the SAME brush (picker + settings), its mode 'erase' (toward transparent 0)
  Object.freeze({ id: 'eraser', icon: '⌫', label: 'Eraser', title: 'Erase toward transparent (0) with the picked brush', brush: { mode: 'erase' } }),
  Object.freeze({ id: 'selectRect', icon: '⬚', label: 'Rectangle select', title: 'Drag a rectangle: the tools work only inside it' }),
  Object.freeze({ id: 'selectEllipse', icon: '◯', label: 'Ellipse select', title: 'Drag an ellipse: the tools work only inside it' }),
  Object.freeze({ id: 'selectLasso', icon: '➰', label: 'Lasso select', title: 'Draw round an area: the tools work only inside it' }),
  // slice 3 (Fred 2026-11-22: "even if height map is pixel we can still have a select or move tool")
  Object.freeze({ id: 'move', icon: '✥', label: 'Move', title: 'Drag the selection (no selection: the whole layer); Alt+drag moves the marquee only; arrows nudge; Enter drops, Esc cancels' }),
  Object.freeze({ id: 'gradient', icon: '◩', label: 'Gradient', title: 'Drag from the start stop to the end stop (applied on release)' }),
  Object.freeze({ id: 'fill', icon: '▣', label: 'Fill', title: 'Tap the patch: the selection (or the whole layer) to the fill height' }),
]);
/** Each precision tool's settings at the start of a session (UI state; HEIGHT_TOOL_CONTROLS targets them by key). */
export const TOOL_DEFAULTS = Object.freeze({
  select: Object.freeze({ featherIn: 0.05 }),
  gradient: GRADIENT_DEFAULTS,
  fill: FILL_DEFAULTS,
  file: Object.freeze({ asNewPatch: false }),
});
/** A group's place in the panel: first (default), `after: true` (at the end) or `follows: <group id>` (right after it). */
export const HEIGHT_TOOL_GROUPS = Object.freeze([
  Object.freeze({ id: 'layers', label: 'Layers', note: 'top first; the tools edit the selected one' }),
  Object.freeze({ id: 'move', label: 'Move', note: 'drag: lift the selection (none: the whole layer) -- it floats until Enter / Drop; Esc / Cancel puts it back; Alt+drag: the marquee only; arrows: 1 px, Shift: 10 px', needsPatch: true, showWhen: (ctx) => ctx.tool === 'move' }),
  // slice 3 (Fred 2026-11-22: "a brush shape tool too, square, circle, bevel brush, angle adjustment")
  // the tip settings show only for a non-round tip (a round brush is set by its falloff); a preset picks the tip (slice 3b)
  Object.freeze({ id: 'tip', label: 'Tip shape', showWhen: (ctx) => usesBrush(ctx.tool) && (ctx.brush.tip || 'round') !== 'round', follows: 'brush' }),
  Object.freeze({ id: 'select', label: 'Selection', note: 'the tools work only inside it', needsPatch: true }),
  Object.freeze({ id: 'gradient', label: 'Gradient', note: 'drag on the patch: start stop -> end stop', showWhen: (ctx) => ctx.tool === 'gradient' }),
  Object.freeze({ id: 'fill', label: 'Fill', note: 'the selection, or the whole layer', showWhen: (ctx) => ctx.tool === 'fill' }),
  Object.freeze({ id: 'file', label: 'Heightmap file', note: '8 / 16-bit PNG, JPG, WebP, EXR', after: true }),
]);
const BLEND_LABELS = Object.freeze({ normal: ['Normal', 'Covers what is under it by the opacity'], add: ['Add', 'Adds its heights'], max: ['Max', 'Only where it stands higher'], min: ['Min', 'Only where it is lower'], subtract: ['Subtract', 'Takes its heights away'] });
export const HEIGHT_TOOL_CONTROLS = Object.freeze([
  { id: 'layerOpacity', group: 'layers', target: 'layer', kind: 'slider', path: ['opacity'], label: 'Layer opacity', step: 0.01, range: () => [0, 1] },
  { id: 'layerBlend', group: 'layers', target: 'layer', kind: 'choice', path: ['blend'], label: 'Layer blend',
    options: PATCH_LAYER_BLENDS.map((b) => [b, BLEND_LABELS[b][0], BLEND_LABELS[b][1]]) },
  // an IMAGE layer's LIVE mapping (core/height/compose.js mapImageValue): a change re-composites, never re-imports
  { id: 'imageZero', group: 'layers', target: 'layer', kind: 'choice', path: ['mapping', 'zero'], label: 'Grey -> height',
    options: [['black', 'Black = 0', 'Black is transparent; white is the White height'], ['mid', 'Mid-grey = 0', 'Mid-grey is transparent; white raises, black lowers']],
    showWhen: (b, p, ctx) => !!ctx && !!ctx.layer && ctx.layer.kind === 'image' },
  { id: 'imageWhiteIn', group: 'layers', target: 'layer', kind: 'slider', path: ['mapping', 'whiteIn'], label: 'White height (in)', step: 0.005, range: () => [0, 2],
    showWhen: (b, p, ctx) => !!ctx && !!ctx.layer && ctx.layer.kind === 'image' },
  { id: 'imageDarkIn', group: 'layers', target: 'layer', kind: 'slider', path: ['mapping', 'darkIn'], label: 'Black depth (in)', step: 0.005, range: () => [0, 2],
    showWhen: (b, p, ctx) => !!ctx && !!ctx.layer && ctx.layer.kind === 'image' && ctx.layer.mapping && ctx.layer.mapping.zero === 'mid' },
  { id: 'gradType', group: 'gradient', target: 'gradient', kind: 'choice', path: ['type'], label: 'Gradient',
    options: [['linear', 'Linear', 'Along the drag'], ['radial', 'Radial', 'Round the start point; the drag length is the radius']] },
  { id: 'gradStartIn', group: 'gradient', target: 'gradient', kind: 'slider', path: ['startIn'], label: 'Start height (in)', step: 0.001, range: () => [-1, 1.5],
    note: 'exact at the start point; type any value' },
  { id: 'gradEndIn', group: 'gradient', target: 'gradient', kind: 'slider', path: ['endIn'], label: 'End height (in)', step: 0.001, range: () => [-1, 1.5] },
  { id: 'gradFalloff', group: 'gradient', target: 'gradient', kind: 'choice', path: ['falloff'], label: 'Curve',
    options: Object.entries(BRUSH_FALLOFFS).map(([k, p]) => [k, p.label, p.title]),
    alsoSet: (prev, next, st) => (next === 'custom' && prev !== 'custom' && BRUSH_FALLOFFS[prev] && !BRUSH_FALLOFFS[prev].custom && sameCurve(st.customCurve, BRUSH_DEFAULTS.customCurve)
      ? { customCurve: curvePointsFromProfile(prev, 6) } : null) },
  { id: 'gradCurve', group: 'gradient', target: 'gradient', kind: 'curve', path: ['customCurve'], label: 'Custom curve (start -> end)',
    showWhen: (b, p, ctx) => !!ctx && ctx.tools.gradient.falloff === 'custom' },
  { id: 'gradOpacity', group: 'gradient', target: 'gradient', kind: 'slider', path: ['opacity'], label: 'Opacity', step: 0.01, range: () => [0, 1] },
  { id: 'gradMode', group: 'gradient', target: 'gradient', kind: 'choice', path: ['mode'], label: 'Mode',
    options: [['normal', 'Normal', 'The gradient covers what is there by the opacity'], ['add', 'Add', 'Adds the gradient'], ['max', 'Max', 'Only where the gradient is higher']] },
  { id: 'fillHeightIn', group: 'fill', target: 'fill', kind: 'slider', path: ['heightIn'], label: 'Fill height (in)', step: 0.001, range: () => [-1, 1.5],
    note: '0 = transparent (no effect on the board); type any value' },
  { id: 'fillOpacity', group: 'fill', target: 'fill', kind: 'slider', path: ['opacity'], label: 'Opacity', step: 0.01, range: () => [0, 1] },
  { id: 'importAsNew', group: 'file', target: 'file', kind: 'check', path: ['asNewPatch'], label: 'Import as a new patch (sized to the image)' },
  { id: 'featherIn', group: 'select', target: 'select', kind: 'slider', path: ['featherIn'], label: 'Feather (in)', step: 0.01, range: () => [0, 1],
    note: 'Feather softens the selection edge by this much' },
  // slice 3b: build-up on (slice 1: each dab adds to the stroke) / off (the stroke keeps the tip's profile); a preset sets it
  { id: 'buildUp', group: 'brush', target: 'brush', kind: 'check', path: ['buildUp'], label: 'Build up (off: a stroke keeps the brush profile)' },
  // slice 3: the brush TIP (core/height/brush.js BRUSH_TIPS; brush UI state like the slice-1 brush controls)
  { id: 'tip', group: 'tip', target: 'brush', kind: 'choice', path: ['tip'], label: 'Tip',
    options: Object.entries(BRUSH_TIPS).map(([k, t]) => [k, t.label, t.title]),
    // a tip with a declared seedRoundness (the chisel's flat blade) starts there while the roundness is still 1
    alsoSet: (prev, next, brush) => (next !== prev && BRUSH_TIPS[next] && BRUSH_TIPS[next].seedRoundness && brush.roundness === 1 ? { roundness: BRUSH_TIPS[next].seedRoundness } : null) },
  { id: 'roundness', group: 'tip', target: 'brush', kind: 'slider', path: ['roundness'], label: 'Roundness', step: 0.01, range: () => [0.05, 1],
    note: '1 = a full circle / square; lower = squashed across the tip' },
  { id: 'angle', group: 'tip', target: 'brush', kind: 'slider', path: ['angle'], label: 'Angle (degrees)', step: 1, range: () => [0, 180],
    note: 'counter-clockwise; with Turn with the stroke, from the drag direction' },
  { id: 'followStroke', group: 'tip', target: 'brush', kind: 'check', path: ['followStroke'], label: 'Turn with the stroke' },
]);
/** Both tables, the one list the renderer and the setter read. */
const allControls = () => [...HEIGHT_CONTROLS, ...HEIGHT_TOOL_CONTROLS];

// ── state (UI only; the data is P.heightLayers) ─────────────────────────────────────────────────────────────────────
let _active = null;          // the active record's id
let _brush = { ...BRUSH_DEFAULTS };
let _work = null;            // { id, h, cols, rows, data } the active patch's working heights (the painter's own copy)
let _stroke = null;          // { s, id } the stroke being painted
let _pending = 0;            // commits not finished yet (their encode is async)
let _strokeSeq = 0;
let _chain = Promise.resolve();
let _hooks = { onChange: () => {} };
let _hover = null;           // the last pointer point (editor coordinates)
const _activeLayer = new Map(); // patch id -> the id of the layer the tools edit (session UI state)
/** Each precision tool's settings (UI state), by HEIGHT_TOOL_CONTROLS target, fresh from their declared defaults. */
const freshTools = () => Object.fromEntries(Object.entries(TOOL_DEFAULTS).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
let _tools = freshTools();
let _tool = 'brush';         // the HEIGHT_TOOLS entry the canvas gesture runs
const _selections = new Map(); // patch id -> { cols, rows, mask, path } (session UI state: never saved, never in undo)
let _drag = null;            // a selection being dragged: { kind, id, pts: [[c, r], ...] }
let _float = null;           // the Move tool's floating piece: { id, layerId, lift, sel, dc, dr, drag, frame } (session state)
let _marq = null;            // an Alt+drag of the marquee: { id, c0, r0, dc, dr }
let _cursorDir = 0;          // degrees on the board: the pointer's travel direction (the followStroke cursor)
let _dirFrom = null;         // the point that direction is measured from

const list = () => (Array.isArray(P.heightLayers) ? P.heightLayers : []);
const find = (id) => list().find((l) => l && l.id === id) || null;
export function activeHeightLayer() { return find(_active) || list()[0] || null; }
const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
const board = () => ({ widthIn: P.widthIn, heightIn: P.heightIn });
const getPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
function withPath(rec, path, v) {
  const [k, ...rest] = path;
  if (!rest.length) return { ...rec, [k]: v };
  const inner = rec[k] != null && typeof rec[k] === 'object' ? rec[k] : {};
  return { ...rec, [k]: withPath(inner, rest, v) };
}
function updateRecord(id, change) { P.heightLayers = list().map((r) => (r && r.id === id ? change(r) : r)); }
/** A record as the editor sees it: its size given (an absent one reads as the board's). */
const placed = (rec) => ({ ...normaliseHeightLayer(rec), sizeIn: rec.sizeIn || { w: P.widthIn, h: P.heightIn } });
/** Editor point (inches, y down) -> board point (inches from the centre, +Y up). */
const toBoard = (pt) => [pt.x - P.widthIn / 2, P.heightIn / 2 - pt.y];
const status = (text, isError = false) => {
  const s = byId('heightStatus');
  if (!s) return;
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('stl-error', !!isError);
};

/** ONE step: the editor's own undo entry (the 'heightLayers' part rides in it) + its persist; outside the editor the
 *  global history. Then the host's onChange (main.js: the rebuild, which waits for the editor to close -- Fred's "no 3D
 *  while editing", core/in-editor-3d.js). */
function commitStep(what) {
  const ed = editor();
  if (ed && typeof ed.pushState === 'function') commitEdit(ed);
  else scheduleUndoSnapshot(`height:${what}`, 'Height');
  scheduleSessionSave();
  _hooks.onChange();
}

// ── the layers of a patch (slice 2; core/height/compose.js) ─────────────────────────────────────────────────────────
/** The layer of patch `rec` the tools edit: the selected one, else the TOP layer (a slice-1 record: its one 'base'). */
function layerOf(rec) {
  const ls = patchLayers(rec);
  if (!ls.length) return null;
  const id = rec && _activeLayer.get(rec.id);
  return ls.find((l) => l.id === id) || ls[ls.length - 1];
}
export function activePatchLayer() { return layerOf(activeHeightLayer()); }
/** A new record for patch `rec` with layer `layerId` changed by `change(layer)`: a slice-1 record's one layer writes its
 *  `raster` back in place (the record keeps its slice-1 shape); any other change makes the record layered (a user action). */
function withLayer(rec, layerId, change) {
  if (!isLayered(rec) && layerId === BASE_LAYER_ID) {
    const next = change(patchLayers(rec)[0]);
    const onlyRaster = Object.keys(next).every((k) => k === 'raster' || next[k] === patchLayers(rec)[0][k]);
    if (onlyRaster) return { ...rec, raster: next.raster };
  }
  const L = layeredRecord(rec);
  return { ...L, layers: L.layers.map((l) => (l && l.id === layerId ? change(l) : l)) };
}
let _layerSeq = 0;
const newLayerId = () => `hl${Date.now().toString(36)}${(_layerSeq++).toString(36)}`;

// ── the working copy + the stroke ───────────────────────────────────────────────────────────────────────────────────
/** The active LAYER's working heights (sync), or null while its raster is being decoded (the decode then redraws). */
function workingCopy(rec) {
  const layer = layerOf(rec);
  if (!layer || !layer.raster) return null;
  if (_work && _work.id === rec.id && _work.layerId === layer.id && (_work.h === layer.raster.h || _pending > 0)) return _work;
  const d = decodedRaster(layer.raster);
  if (!d) {
    ensureRasterDecoded(layer.raster).then(() => syncHeightOverlay(), (e) => status(`Could not read the height patch: ${e && e.message ? e.message : e}`, true));
    return null;
  }
  _work = { id: rec.id, layerId: layer.id, kind: layer.kind, h: layer.raster.h, cols: layer.raster.cols, rows: layer.raster.rows, data: Float32Array.from(d) };
  return _work;
}
/** The working copy for a tool that paints heights: never an image layer (its grey values stay as imported). */
function paintableCopy(rec) {
  const layer = layerOf(rec);
  if (layer && layer.kind === 'image') { status('An image layer keeps its grey values: add a paint layer above it to paint.'); return null; }
  return workingCopy(rec);
}
const pressureOf = (e) => (e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1); // a mouse reports 0.5 while pressed
function pixelOf(rec, pt) { const [X, Y] = toBoard(pt); return boardToPatchPixel(placed(rec), X, Y); }

function cancelStroke() {
  if (!_stroke) return;
  _stroke.s.cancel();
  _stroke = null;
  syncHeightOverlay();
}
/** True for a HEIGHT_TOOLS row that paints with the brush (the Brush, the Eraser): they share its picker and settings. */
function usesBrush(toolId) { const t = HEIGHT_TOOLS.find((x) => x.id === toolId); return !!(t && t.brush); }
/** The brush a stroke of tool `toolId` paints with: the shared brush, the tool's own mode (the Eraser's 'erase'), and with
 *  Alt held the Brush's BRUSH_ALT_MODE flip (raise <-> lower; set / smooth unchanged). */
function strokeBrush(toolId, e) {
  const t = HEIGHT_TOOLS.find((x) => x.id === toolId);
  const mode = (t && t.brush && t.brush.mode) || _brush.mode;
  const flipped = e && e.altKey && !(t && t.brush && t.brush.mode) ? BRUSH_ALT_MODE[mode] : null;
  return mode === _brush.mode && !flipped ? _brush : { ..._brush, mode: flipped || mode };
}
function beginStroke(pt, pressure, brush = _brush) {
  cancelStroke(); // a stroke the editor abandoned (a pinch, a tool switch) is put back, never half-committed
  const rec = activeHeightLayer();
  const work = paintableCopy(rec);
  if (!work) return false;
  const pr = placed(rec), size = pr.sizeIn;
  // rotationDeg: the tip's angle is on the BOARD, the raster turns with the patch
  const s = createStroke(work, brush, { pxPerInX: work.cols / size.w, pxPerInY: work.rows / size.h, mask: maskOf(rec), rotationDeg: pr.rotation });
  _stroke = { s, id: rec.id };
  const q = pixelOf(rec, pt);
  s.addPoint(q.c, q.r, pressure);
  liveRedraw();
  return true;
}
function moveStroke(pt, pressure) {
  trackDir(pt);
  _hover = pt;
  if (!_stroke) return;
  const rec = find(_stroke.id);
  if (!rec) return;
  const q = pixelOf(rec, pt);
  _stroke.s.addPoint(q.c, q.r, pressure);
  liveRedraw();
}
/** The stroke's release: one commit (or nothing, when it touched no pixel). Resolves when it is stored. */
function endStroke() {
  const st = _stroke;
  _stroke = null;
  if (st) st.s.finish(); // a followStroke tap's one dab
  if (!st || !st.s.bbox) return _chain;
  return commitWorking(st.id, 'stroke');
}
/** The pointer's travel direction on the board (degrees, +Y up), once it has gone a little way: the followStroke cursor. */
function trackDir(pt) {
  if (!pt) return;
  if (!_dirFrom) { _dirFrom = pt; return; }
  const dx = pt.x - _dirFrom.x, dy = _dirFrom.y - pt.y; // editor y is down
  if (Math.hypot(dx, dy) < 0.02) return;
  _cursorDir = (Math.atan2(dy, dx) * 180) / Math.PI;
  _dirFrom = pt;
}

/** Store the working heights of patch `id` as its working layer's new raster, then the step. Commits run one after the
 *  other. */
function commitWorking(id, what) {
  const work = _work;
  if (!work || work.id !== id) return _chain;
  const snap = Float32Array.from(work.data);
  const seq = ++_strokeSeq;
  _pending++;
  _chain = _chain.then(() => withLoadingStage('heightPatch', async () => {
    const raster = await encodeRaster(snap, work.cols, work.rows);
    const rec = find(id);
    if (!rec || !patchLayers(rec).some((l) => l.id === work.layerId)) return; // the patch / layer was deleted meanwhile
    updateRecord(id, (r) => withLayer(r, work.layerId, (l) => ({ ...l, raster })));
    if (_work === work) {
      _work.h = raster.h;
      if (seq === _strokeSeq && !_stroke && !_float) _work.data.set(decodedRaster(raster)); // the painter shows what is stored (a piece lifted meanwhile keeps its preview)
    }
    commitStep(what);
  })).catch((e) => status(`Could not store the stroke: ${e && e.message ? e.message : e}`, true))
    .finally(() => { _pending--; syncHeightPanel(); syncHeightOverlay(); });
  return _chain;
}
/** Resolves once every stroke commit so far is stored. */
export const whenHeightIdle = () => _chain;

/** `editor._heightTool` (editor/editor-height-tool.js): paints only in the Height tab. */
const TOOL = Object.freeze({
  start: (pt, e) => (getEditorTab() === 'height' ? gesture().start(pt, e) : false),
  move: (pt, e) => gesture().move(pt, e),
  end: () => gesture().end(),
  hover: (pt) => { trackDir(pt); _hover = pt; drawCursor(); },
  cancel: () => { for (const g of Object.values(GESTURES)) g.cancel(); },
});
function ensureTool() { const ed = editor(); if (ed && ed._heightTool !== TOOL) ed._heightTool = TOOL; }

/** The canvas gesture of each HEIGHT_TOOLS entry: start(pt, e) -> true when it began, move, end -> a promise, cancel. */
const selectGesture = (kind) => ({ start: (pt) => beginSelect(kind, pt), move: (pt) => moveSelect(pt), end: () => endSelect(), cancel: () => cancelSelect() });
const GESTURES = {
  brush: { start: (pt, e) => beginStroke(pt, pressureOf(e), strokeBrush('brush', e)), move: (pt, e) => moveStroke(pt, pressureOf(e)), end: () => endStroke(), cancel: () => cancelStroke() },
  eraser: { start: (pt, e) => beginStroke(pt, pressureOf(e), strokeBrush('eraser', e)), move: (pt, e) => moveStroke(pt, pressureOf(e)), end: () => endStroke(), cancel: () => cancelStroke() },
  selectRect: selectGesture('rect'),
  selectEllipse: selectGesture('ellipse'),
  selectLasso: selectGesture('lasso'),
  gradient: { start: (pt) => beginGradient(pt), move: (pt) => moveGradient(pt), end: () => endGradient(), cancel: () => cancelGradient() },
  fill: { start: (pt) => beginFill(pt), move: () => {}, end: () => endFill(), cancel: () => { _fillTap = false; } },
  // slice 3: a drag moves the floating piece (lifting it first); its cancel puts back the drag in flight, the piece floats on
  move: { start: (pt, e) => beginMove(pt, e), move: (pt) => moveMove(pt), end: () => endMove(), cancel: () => cancelMoveDrag() },
};
const gesture = () => GESTURES[_tool] || GESTURES.brush;
/** The canvas tool (HEIGHT_TOOLS). In the Height tab its gesture mode is armed. A floating piece is dropped first. */
export function setHeightTool(id) {
  if (!HEIGHT_TOOLS.some((t) => t.id === id)) return false;
  if (id !== _tool) { dropHeightMove(); TOOL.cancel(); }
  _tool = id;
  const ed = editor();
  if (ed && typeof ed.setMode === 'function' && getEditorTab() === 'height' && ed._currentMode !== 'heightBrush') ed.setMode('heightBrush');
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}
export const heightTool = () => _tool;

/** A whole stroke through the same path as the pointer: `points` = [[X, Y, pressure?], ...] in board inches (+Y up),
 *  `brush` over the current one for this stroke only. Resolves when it is stored. (Tests, probes.) */
export function paintHeightStroke(points, brush = {}) {
  const was = _brush;
  _brush = { ..._brush, ...brush };
  try {
    const pt = ([X, Y]) => ({ x: X + P.widthIn / 2, y: P.heightIn / 2 - Y });
    if (!points.length || !beginStroke(pt(points[0]), points[0][2] ?? 1)) return _chain;
    for (const q of points.slice(1)) moveStroke(pt(q), q[2] ?? 1);
    return endStroke();
  } finally { _brush = was; }
}

// ── the selection (slice 2; core/height/selection.js): per patch, session UI state ─────────────────────────────────
/** The active patch's selection { cols, rows, mask } (its grid), or null = none (the tools work everywhere). */
export function heightSelection() {
  const rec = activeHeightLayer();
  const sel = rec ? _selections.get(rec.id) : null;
  const g = rec ? patchGrid(rec) : null;
  return sel && g && sel.cols === g.cols && sel.rows === g.rows ? sel : null;
}
/** The mask a tool multiplies by on patch `rec` (null = everywhere). */
function maskOf(rec) {
  const sel = rec ? _selections.get(rec.id) : null;
  const g = rec ? patchGrid(rec) : null;
  return sel && g && sel.cols === g.cols && sel.rows === g.rows ? sel.mask : null;
}
/** Set the active patch's selection mask (null / nothing selected = clear), redraw its outline. */
function setSelection(mask) {
  dropHeightMove(); // another action drops a floating piece first
  const rec = activeHeightLayer();
  if (!rec) return false;
  const g = patchGrid(rec);
  if (!mask || !maskAny(mask)) _selections.delete(rec.id);
  else _selections.set(rec.id, { cols: g.cols, rows: g.rows, mask, path: null });
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}
/** Board inches (+Y up) -> the active patch's raster pixel [c, r]. */
function patchPx(rec, [X, Y]) { const q = boardToPatchPixel(placed(rec), X, Y); return [q.c, q.r]; }
const shapeMask = (rec, kind, pts) => {
  const { cols, rows } = patchGrid(rec);
  if (kind === 'lasso') return lassoMask(cols, rows, pts);
  const [[c0, r0], [c1, r1]] = [pts[0], pts[pts.length - 1]];
  return (kind === 'ellipse' ? ellipseMask : rectMask)(cols, rows, c0, r0, c1, r1);
};
/** A rectangle / ellipse between two board points, or a lasso through board points ([X, Y], inches, +Y up): the new selection. */
export function selectHeightRect(p0, p1) { const rec = activeHeightLayer(); return !!rec && setSelection(shapeMask(rec, 'rect', [patchPx(rec, p0), patchPx(rec, p1)])); }
export function selectHeightEllipse(p0, p1) { const rec = activeHeightLayer(); return !!rec && setSelection(shapeMask(rec, 'ellipse', [patchPx(rec, p0), patchPx(rec, p1)])); }
export function selectHeightLasso(points) { const rec = activeHeightLayer(); return !!rec && setSelection(shapeMask(rec, 'lasso', points.map((q) => patchPx(rec, q)))); }
export function invertHeightSelection() { const s = heightSelection(); return !!s && setSelection(invertMask(s.mask)); }
export function clearHeightSelection() { return setSelection(null); }
/** Soften the selection edge by `inches` (a blur; a stretched patch blurs by its own pixels per inch on each axis). */
export function featherHeightSelection(inches) {
  const s = heightSelection();
  const rec = activeHeightLayer();
  if (!s || !(inches > 0)) return false;
  const size = placed(rec).sizeIn;
  return setSelection(featherMask(s.mask, s.cols, s.rows, (inches * s.cols) / size.w, (inches * s.rows) / size.h));
}
/** An editor SVG's shapes (editor coordinates: a Draw-tab layer) as the selection. `opts.render`: the renderer (tests). */
export async function selectHeightFromSvg(svgText, opts = {}) {
  const rec = activeHeightLayer();
  if (!rec || !svgText) return false;
  let mask = null;
  await withLoadingStage('heightPatch', async () => { mask = await maskFromSvg(svgText, placed(rec), board(), opts); });
  if (activeHeightLayer() !== find(rec.id)) return false;
  if (!maskAny(mask)) { status('That shape does not reach this patch.'); return false; }
  return setSelection(mask);
}
/** A Draw-tab layer (its art, as its stamp sees it: getLayerSvg + the layer's own transform) as the selection. */
export function selectHeightFromLayer(layerId) {
  const ed = editor();
  const layer = ed && Array.isArray(ed._layers) ? ed._layers.find((l) => l && String(l.id) === String(layerId)) : null;
  if (!layer) return Promise.resolve(false);
  const t = { tx: layer.tx ?? 0, ty: layer.ty ?? 0, rotation: layer.rotation ?? 0, scale: layer.scale ?? 1, mirrorX: !!layer.mirrorX, mirrorY: !!layer.mirrorY };
  const svg = getLayerSvg(ed, layer.id);
  if (!svg) { status('That layer has no shape to select.'); return Promise.resolve(false); }
  return selectHeightFromSvg(applyLayerTransform(svg, t, P.widthIn, P.heightIn));
}
/** The 'From a Draw-tab shape' list: the editor's layers. */
function syncSelectionSources() {
  const sel = byId('heightSelSource');
  if (!sel) return;
  const ed = editor();
  const layers = ed && Array.isArray(ed._layers) ? ed._layers.filter(Boolean) : [];
  const want = layers.map((l) => `${l.id}|${l.name || `Layer ${l.id}`}`).join('\n');
  if (sel.getAttribute('data-sources') === want) return;
  const was = sel.value;
  sel.innerHTML = '';
  for (const l of layers) { const o = document.createElement('option'); o.value = String(l.id); o.textContent = l.name || `Layer ${l.id}`; sel.appendChild(o); }
  if (layers.some((l) => String(l.id) === was)) sel.value = was;
  sel.setAttribute('data-sources', want);
  const btn = byId('heightSelFromShape'); if (btn) btn.disabled = !layers.length;
}

// the selection gestures: drag a rectangle / ellipse, draw a lasso; one selection on release (a tap clears it)
function beginSelect(kind, pt) {
  const rec = activeHeightLayer();
  if (!rec || !patchGrid(rec)) return false;
  const q = pixelOf(rec, pt);
  _drag = { kind, id: rec.id, pts: [[q.c, q.r]] };
  syncHeightOverlay();
  return true;
}
function moveSelect(pt) {
  _hover = pt;
  const rec = _drag && find(_drag.id);
  if (!rec) return;
  const q = pixelOf(rec, pt);
  if (_drag.kind === 'lasso') _drag.pts.push([q.c, q.r]); else _drag.pts[1] = [q.c, q.r];
  syncHeightOverlay();
}
function endSelect() {
  const d = _drag;
  _drag = null;
  const rec = d && find(d.id);
  if (!rec) return Promise.resolve();
  const moved = d.kind === 'lasso' ? d.pts.length >= 3 : d.pts.length === 2 && Math.hypot(d.pts[1][0] - d.pts[0][0], d.pts[1][1] - d.pts[0][1]) >= 1;
  if (!moved) { setSelection(null); return Promise.resolve(); }
  if (activeHeightLayer() === rec) setSelection(shapeMask(rec, d.kind, d.pts));
  return Promise.resolve();
}
function cancelSelect() { if (_drag) { _drag = null; syncHeightOverlay(); } }

/** The selection's outline on patch node `node` (image pixel coordinates -> the patch's own box), marching ants. */
function drawSelection(node, rec, p, show) {
  let path = node.querySelector('.height-selection');
  const sel = show ? _selections.get(rec.id) : null;
  const g = patchGrid(rec);
  let d = '';
  if (show && _drag && _drag.id === rec.id) {
    const img = ([c, r]) => [c + 0.5, g.rows - r - 0.5];
    let pts = _drag.pts.map(img);
    if (_drag.kind !== 'lasso' && pts.length === 2) {
      const [[x0, y0], [x1, y1]] = pts;
      if (_drag.kind === 'rect') pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      else { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2; pts = Array.from({ length: 64 }, (_, i) => [cx + rx * Math.cos((i * Math.PI) / 32), cy + ry * Math.sin((i * Math.PI) / 32)]); }
    }
    d = pts.length > 1 ? `M${pts.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L')} Z` : '';
  } else if (sel && sel.cols === g.cols && sel.rows === g.rows) {
    if (sel.path == null) sel.path = maskOutline(sel.mask, sel.cols, sel.rows).map((q) => `M${fmt(q[0])} ${fmt(q[1])}L${fmt(q[2])} ${fmt(q[3])}`).join('');
    d = sel.path;
  }
  if (!d) { if (path) path.remove(); return; }
  if (!path) { // marching ants: a white line under a dashed one, readable on any shade
    path = svgEl('g', { class: 'height-selection', fill: 'none' }, node);
    svgEl('path', { 'vector-effect': 'non-scaling-stroke', stroke: HEIGHT_VIEW.halo, 'stroke-width': 2.5 }, path);
    const ants = svgEl('path', { 'vector-effect': 'non-scaling-stroke', stroke: HEIGHT_VIEW.outline, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, path);
    svgEl('animate', { attributeName: 'stroke-dashoffset', from: '0', to: '9', dur: '0.6s', repeatCount: 'indefinite' }, ants);
  }
  // the Move tool: the outline rides with a floating piece / a marquee drag (image y is down, raster r is up)
  const off = _float && _float.id === rec.id && _float.sel ? _float : _marq && _marq.id === rec.id ? _marq : null;
  const shift = off && (off.dc || off.dr) ? ` translate(${off.dc} ${-off.dr})` : '';
  path.setAttribute('transform', `translate(${fmt(-p.sizeIn.w / 2)} ${fmt(-p.sizeIn.h / 2)}) scale(${fmt(p.sizeIn.w / g.cols)} ${fmt(p.sizeIn.h / g.rows)})${shift}`);
  for (const q of path.querySelectorAll('path')) q.setAttribute('d', d);
  if (path !== node.lastChild) node.appendChild(path);
}

// ── the gradient tool (slice 2; core/height/gradient.js): drag the start -> end stops, applied ONCE on release ─────────
let _grad = null; // { id, start: [c, r], end: [c, r], base: the layer's heights before the drag, frame }
/** A tool's settings now (a copy). */
export const heightToolSettings = (id) => (_tools[id] ? JSON.parse(JSON.stringify(_tools[id])) : null);
function densityOf(rec) { const size = placed(rec).sizeIn, g = patchGrid(rec); return { pxPerInX: g.cols / size.w, pxPerInY: g.rows / size.h }; }
const gradMoved = (g) => Math.hypot(g.end[0] - g.start[0], g.end[1] - g.start[1]) >= 1;
/** The working layer = its heights before the drag + the gradient to the current end point. */
function gradientOnto(g) {
  const rec = find(g.id);
  if (!rec || !_work || _work.id !== g.id) return;
  _work.data.set(g.base);
  if (gradMoved(g)) applyGradient(_work.data, _work.cols, _work.rows, _tools.gradient, { start: g.start, end: g.end, ...densityOf(rec), mask: maskOf(rec) });
}
function beginGradient(pt) {
  cancelGradient();
  const rec = activeHeightLayer();
  const work = paintableCopy(rec);
  if (!work) return false;
  const q = pixelOf(rec, pt);
  _grad = { id: rec.id, start: [q.c, q.r], end: [q.c, q.r], base: Float32Array.from(work.data), frame: 0 };
  syncHeightOverlay();
  return true;
}
function moveGradient(pt) {
  _hover = pt;
  const g = _grad;
  const rec = g && find(g.id);
  if (!rec) return;
  const q = pixelOf(rec, pt);
  g.end = [q.c, q.r];
  if (g.frame) return; // one preview per animation frame
  const run = () => { if (_grad !== g) return; g.frame = 0; gradientOnto(g); liveRedraw(); syncHeightOverlay(); };
  if (typeof requestAnimationFrame === 'function') g.frame = requestAnimationFrame(run); else run();
}
/** Release: the gradient to the release point, ONE commit (nothing when the drag did not move). */
function endGradient() {
  const g = _grad;
  _grad = null;
  if (!g) return _chain;
  if (g.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(g.frame);
  if (!gradMoved(g)) { if (_work && _work.id === g.id) _work.data.set(g.base); syncHeightOverlay(); return _chain; }
  gradientOnto(g);
  return commitWorking(g.id, 'gradient');
}
function cancelGradient() {
  const g = _grad;
  if (!g) return;
  _grad = null;
  if (g.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(g.frame);
  if (_work && _work.id === g.id) _work.data.set(g.base);
  syncHeightOverlay();
}
/** A whole gradient through the same path as the pointer: board inches (+Y up) start -> end, `over` = settings for this one.
 *  Resolves when it is stored. (Tests, probes.) */
export function applyHeightGradient(p0, p1, over = {}) {
  const was = _tools.gradient;
  _tools.gradient = { ...was, ...over };
  try {
    const pt = ([X, Y]) => ({ x: X + P.widthIn / 2, y: P.heightIn / 2 - Y });
    if (!beginGradient(pt(p0))) return _chain;
    const rec = find(_grad.id), q = pixelOf(rec, pt(p1));
    _grad.end = [q.c, q.r];
    return endGradient();
  } finally { _tools.gradient = was; }
}
/** The gradient's start -> end line on patch node `node` while dragging. */
function drawGradientLine(node, rec, p) {
  let line = node.querySelector('.height-gradient-line');
  if (!_grad || _grad.id !== rec.id) { if (line) line.remove(); return; }
  const g = patchGrid(rec);
  if (!line) line = svgEl('line', { class: 'height-gradient-line', 'vector-effect': 'non-scaling-stroke', stroke: HEIGHT_VIEW.outline, 'stroke-width': 2 }, node);
  const [x1, y1, x2, y2] = [_grad.start[0] + 0.5, g.rows - _grad.start[1] - 0.5, _grad.end[0] + 0.5, g.rows - _grad.end[1] - 0.5];
  for (const [k, v] of [['x1', x1], ['y1', y1], ['x2', x2], ['y2', y2]]) line.setAttribute(k, fmt(v));
  line.setAttribute('transform', `translate(${fmt(-p.sizeIn.w / 2)} ${fmt(-p.sizeIn.h / 2)}) scale(${fmt(p.sizeIn.w / g.cols)} ${fmt(p.sizeIn.h / g.rows)})`);
  if (line !== node.lastChild) node.appendChild(line);
}

// ── the fill tool (slice 2; core/height/fill.js): one step ──────────────────────────────────────────────────────────
let _fillTap = false;
/** Fill the active layer (inside the selection, else everywhere) to the fill height; `over` = settings for this one.
 *  ONE step. Resolves when it is stored. */
export function fillHeight(over = {}) {
  dropHeightMove();
  const rec = activeHeightLayer();
  const work = paintableCopy(rec);
  if (!work) return _chain;
  const f = { ..._tools.fill, ...over };
  if (!applyFill(work.data, f.heightIn, f.opacity, maskOf(rec))) return _chain;
  return commitWorking(rec.id, 'fill');
}
function beginFill(pt) { const rec = activeHeightLayer(); _fillTap = !!rec && !!patchGrid(rec) && pixelOf(rec, pt).inside; return _fillTap; }
function endFill() { const go = _fillTap; _fillTap = false; return go ? fillHeight() : _chain; }

// ── the move tool (slice 3; core/height/move.js): lift, float, drop -- Photoshop semantics ─────────────────────────────
// A drag LIFTS the selection (no selection: the whole layer) into a floating piece; the release keeps it floating; Enter, the
// Drop button, a tool switch or another action DROPS it (ONE commit = one undo step); Esc / Cancel puts everything back.
// Offsets are whole patch pixels (no resampling). The selection moves with the piece; Alt+drag moves the marquee only.
/** Arrow keys -> a direction on the screen ([right, up]); the nudge in patch pixels (Shift: the big one). */
const NUDGE_KEYS = Object.freeze({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] });
export const MOVE_NUDGE_PX = Object.freeze({ step: 1, shift: 10 });
/** The editor's own buttons that settle a floating piece: Apply keeps the move (drop), Cancel throws it away. */
const MOVE_SETTLE_BUTTONS = Object.freeze({ editorApply: 'drop', editorCancel: 'cancel' });
/** Lift the active layer's selected pixels (or the whole layer) of patch `rec` into the floating piece. */
function liftHeightMove(rec) {
  const work = paintableCopy(rec);
  if (!work) return false;
  const sel = maskOf(rec);
  const lift = liftPiece(work.data, work.cols, work.rows, sel);
  if (!lift.box) return false;
  _float = { id: rec.id, layerId: work.layerId, lift, sel, dc: 0, dr: 0, drag: null, frame: 0 };
  syncMoveBar();
  return true;
}
/** The working layer = the lifted layer with the piece placed at its offset. */
function floatOnto(f) { if (_work && _work.id === f.id && _work.layerId === f.layerId) placePiece(f.lift, f.dc, f.dr, _work.data); }
function setFloatOffset(dc, dr) {
  const f = _float;
  if (!f || (dc === f.dc && dr === f.dr)) return;
  f.dc = dc; f.dr = dr;
  if (f.frame) return; // one preview per animation frame
  const run = () => { f.frame = 0; if (_float !== f) return; floatOnto(f); liveRedraw(); syncHeightOverlay(); };
  if (typeof requestAnimationFrame === 'function') f.frame = requestAnimationFrame(run); else run();
}
function beginMove(pt, e) {
  const rec = activeHeightLayer();
  if (!rec || !patchGrid(rec)) return false;
  const q = pixelOf(rec, pt);
  if (e && e.altKey && maskOf(rec)) { // Alt: the marquee only (a floating piece is dropped first)
    dropHeightMove();
    _marq = { id: rec.id, c0: q.c, r0: q.r, dc: 0, dr: 0 };
    return true;
  }
  if (_float && _float.id !== rec.id) dropHeightMove();
  if (!_float && !liftHeightMove(rec)) return false;
  _float.drag = { c0: q.c, r0: q.r, dc0: _float.dc, dr0: _float.dr };
  return true;
}
function moveMove(pt) {
  _hover = pt;
  const m = _marq;
  if (m) {
    const rec = find(m.id);
    if (!rec) return;
    const q = pixelOf(rec, pt);
    m.dc = Math.round(q.c - m.c0); m.dr = Math.round(q.r - m.r0);
    syncHeightOverlay();
    return;
  }
  const f = _float;
  const rec = f && f.drag && find(f.id);
  if (!rec) return;
  const q = pixelOf(rec, pt);
  setFloatOffset(f.drag.dc0 + Math.round(q.c - f.drag.c0), f.drag.dr0 + Math.round(q.r - f.drag.r0));
}
/** The release: a marquee drag moves the selection; a piece drag leaves it floating (nothing is stored yet). */
function endMove() {
  const m = _marq;
  if (m) {
    _marq = null;
    const sel = _selections.get(m.id);
    if (sel && (m.dc || m.dr)) _selections.set(m.id, { ...sel, mask: shiftMask(sel.mask, sel.cols, sel.rows, m.dc, m.dr), path: null });
    syncHeightPanel();
    syncHeightOverlay();
    return Promise.resolve();
  }
  if (_float) _float.drag = null;
  return _chain;
}
/** A drag the editor abandoned (a pinch): the piece goes back to where that drag started and keeps floating. */
function cancelMoveDrag() {
  if (_marq) { _marq = null; syncHeightOverlay(); }
  const f = _float;
  if (f && f.drag) { const d = f.drag; f.drag = null; setFloatOffset(d.dc0, d.dr0); }
}
/** DROP the floating piece where it is: normal blend over what is there, the hole it left = 0; the selection follows.
 *  ONE commit (one undo step); a piece dropped where it was lifted changes nothing and stores nothing. */
export function dropHeightMove() {
  const f = _float;
  if (!f) return _chain;
  _float = null;
  if (f.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(f.frame);
  syncMoveBar();
  const ours = !!_work && _work.id === f.id && _work.layerId === f.layerId && !!find(f.id);
  if (!ours) { syncHeightOverlay(); return _chain; }
  if (!f.dc && !f.dr) { _work.data.set(f.lift.piece); syncHeightOverlay(); return _chain; }
  placePiece(f.lift, f.dc, f.dr, _work.data);
  const sel = f.sel && _selections.get(f.id);
  if (sel) _selections.set(f.id, { ...sel, mask: shiftMask(f.sel, sel.cols, sel.rows, f.dc, f.dr), path: null });
  const done = commitWorking(f.id, 'move');
  syncHeightPanel();
  syncHeightOverlay();
  return done;
}
/** CANCEL the floating piece: the layer and the selection exactly as before the lift; nothing stored. */
export function cancelHeightMove() {
  const f = _float;
  if (!f) return false;
  _float = null;
  if (f.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(f.frame);
  if (_work && _work.id === f.id && _work.layerId === f.layerId) _work.data.set(f.lift.piece);
  syncMoveBar();
  syncHeightOverlay();
  return true;
}
/** Nudge the floating piece (lifting it first) by `n` patch pixels toward screen direction (sx right, sy up): along the
 *  patch's own axis nearest to it (a turned patch moves along its pixels). */
export function nudgeHeightMove(sx, sy, n = MOVE_NUDGE_PX.step) {
  const rec = activeHeightLayer();
  if (!rec || !patchGrid(rec)) return false;
  if (_float && _float.id !== rec.id) dropHeightMove();
  if (!_float && !liftHeightMove(rec)) return false;
  const a = (placed(rec).rotation * Math.PI) / 180;
  const du = sx * Math.cos(a) + sy * Math.sin(a), dv = sy * Math.cos(a) - sx * Math.sin(a);
  const [dc, dr] = Math.abs(du) >= Math.abs(dv) ? [Math.sign(du) * n, 0] : [0, Math.sign(dv) * n];
  setFloatOffset(_float.dc + dc, _float.dr + dr);
  return true;
}
/** The move tool's state (the panel, tests, probes). */
export const heightMoveState = () => ({ tool: _tool, floating: !!_float, dc: _float ? _float.dc : 0, dr: _float ? _float.dr : 0, marquee: !!_marq, pending: _pending });
const editorShown = () => { const m = byId('svgEditorModal'); return !m || m.style.display !== 'none'; };
/** The keys of the Move tool (window, capture phase: Esc cancels the piece without also leaving the tool). */
function onMoveKey(e) {
  if (_tool !== 'move' || getEditorTab() !== 'height' || !editorShown()) return;
  if (e.ctrlKey || e.metaKey || e.altKey || _isTypingTarget(e.target) || _isTypingTarget(document.activeElement)) return;
  const dir = NUDGE_KEYS[e.key];
  let used = false;
  if (dir) used = nudgeHeightMove(dir[0], dir[1], e.shiftKey ? MOVE_NUDGE_PX.shift : MOVE_NUDGE_PX.step);
  else if (e.key === 'Enter' && _float) { dropHeightMove(); used = true; }
  else if (e.key === 'Escape' && (_float || _marq)) { cancelMoveDrag(); cancelHeightMove(); used = true; }
  if (used) { e.preventDefault(); e.stopPropagation(); }
}
/** The Drop / Cancel pair on the canvas while a piece floats (the touch way to Enter / Esc). */
function ensureMoveBar() {
  const container = byId('editorCanvasContainer');
  if (!container || byId('heightMoveBar')) return;
  const btn = (id, text, title) => el('button', { type: 'button', id, class: 'cad-btn cad-btn-secondary', text, title, style: 'min-height:32px; min-width:84px; padding:4px 12px;' });
  // above the phone drawer and the job strip (the same offsets as #editorStatusHint), and above that hint itself
  const bar = el('div', { id: 'heightMoveBar', hidden: '', style: 'position:absolute; left:50%; bottom:calc(44px + var(--drawer-height, 0px) + var(--job-strip-height, 0px)); transform:translateX(-50%); z-index:11; display:none; gap:8px;' }, [
    btn('heightMoveDrop', '✓ Drop', 'Put the moved piece down here (Enter)'),
    btn('heightMoveCancel', '✕ Cancel', 'Put everything back as it was (Esc)'),
  ]);
  container.appendChild(bar);
  byId('heightMoveDrop').addEventListener('click', () => { dropHeightMove(); });
  byId('heightMoveCancel').addEventListener('click', () => { cancelHeightMove(); });
}
function syncMoveBar() {
  const bar = byId('heightMoveBar');
  if (!bar) return;
  bar.hidden = !_float;
  bar.style.display = _float ? 'flex' : 'none'; // the inline display would beat [hidden]
}

// ── heightmap import (slice 2; core/height/import.js): an IMAGE layer, its grey kept, its mapping live ────────────────
/**
 * Import a heightmap file (`file`: a File, or { name, bytes }) as an image layer: into the active patch (resampled to its
 * grid, above its active layer) or, with `asNewPatch` (or no patch yet), as a new patch sized to the image's aspect (the
 * largest that fits the board, 100 px/in). The mapping comes from an exported file's name (name_0-0.5in.png), else the
 * declared default. ONE step. `loaders`: the file readers (tests). Resolves to the new layer, or null.
 */
export async function importHeightmap(file, { asNewPatch = _tools.file.asNewPatch, loaders = HEIGHTMAP_LOADERS } = {}) {
  const name = (file && file.name) || 'heightmap';
  dropHeightMove();
  let made = null, info = null;
  try {
    await withLoadingStage('heightImport', async () => {
      // a File / Blob (its own .bytes is a METHOD in current browsers), or { name, bytes } (tests, probes)
      const bytes = typeof Blob !== 'undefined' && file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
      const img = await decodeHeightmap(name, bytes, loaders);
      info = img;
      const mapping = mappingFromName(name) || { ...IMAGE_MAPPING_DEFAULTS };
      const into = asNewPatch ? null : activeHeightLayer();
      const g = into ? patchGrid(into) : null;
      let sizeIn = null, cols, rows;
      if (g) ({ cols, rows } = g);
      else {
        const k = Math.min(P.widthIn / img.width, P.heightIn / img.height);
        sizeIn = { w: img.width * k, h: img.height * k };
        cols = Math.max(1, Math.round(sizeIn.w * HEIGHT_PX_PER_IN)); rows = Math.max(1, Math.round(sizeIn.h * HEIGHT_PX_PER_IN));
      }
      const raster = await encodeRaster(resampleToGrid(img.values, img.width, img.height, cols, rows), cols, rows, RASTER_ENC_U16);
      const layer = { id: newLayerId(), name, kind: 'image', visible: true, opacity: 1, blend: 'normal', raster, mapping, source: { name, width: img.width, height: img.height, bits: img.bits } };
      made = into ? { id: into.id, layer } : { rec: { ...normaliseHeightLayer({}), id: newHeightId(), name: name.replace(/\.[a-z0-9]+$/i, ''), sizeIn, layers: [layer] }, layer };
    });
  } catch (e) {
    status(`Could not read the heightmap: ${e && e.message ? e.message : e}`, true);
    return null;
  }
  if (!made) return null;
  if (made.rec) {
    P.heightLayers = [...list(), made.rec];
    _active = made.rec.id;
    _activeLayer.set(made.rec.id, made.layer.id);
    commitStep('import');
    syncHeightPanel();
    syncHeightOverlay();
  } else {
    if (!find(made.id)) return null;
    _active = made.id;
    insertLayer(made.layer, 'import');
  }
  status(`${name}: ${info.width} x ${info.height} px, ${info.bits === 32 ? 'float' : `${info.bits}-bit`}. Paint over it on a paint layer above.`);
  return made.layer;
}

// ── heightmap export (slice 2; core/height/export.js): the composite as a 16-bit grey PNG ─────────────────────────────
/** The browser's download of `bytes` as `fileName`. */
function saveBytes(bytes, fileName, type) {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
/**
 * 'Export heightmap': the active patch's composite (every visible layer) as a 16-bit greyscale PNG named with its range
 * (name_0-0.5in.png). `png16`: the library loader (tests); `download` false: only return it. Resolves to
 * { bytes, fileName, range } or null (the reason in the panel status).
 */
export async function exportHeightmap({ png16 = null, download = true } = {}) {
  dropHeightMove();
  const rec = activeHeightLayer();
  if (!rec || !patchGrid(rec)) return null;
  let out = null;
  try {
    await withLoadingStage('heightExport', async () => {
      const comp = patchComposite(rec) || await ensurePatchDecoded(rec);
      const g = patchGrid(rec);
      out = await exportHeightmapPng(comp, g.cols, g.rows, rec.name || 'height', png16 ? { png16 } : {});
    });
  } catch (e) {
    status(`Could not write the heightmap: ${e && e.message ? e.message : e}`, true);
    return null;
  }
  if (download) saveBytes(out.bytes, out.fileName, 'image/png');
  status(`${out.fileName}: 16-bit grey, ${out.range.lo === 0 ? 'black = 0' : 'mid-grey = 0'}, ${out.range.lo} to ${out.range.hi} in.`);
  return out;
}

// ── patches ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 'New height patch': an unpainted patch over the whole board, made active. One step. */
export async function newHeightPatch() {
  dropHeightMove();
  let rec = null;
  await withLoadingStage('heightPatch', async () => { rec = await newHeightLayer(board(), `Height ${list().length + 1}`); });
  P.heightLayers = [...list(), rec];
  _active = rec.id;
  commitStep('add');
  syncHeightPanel();
  syncHeightOverlay();
  return rec;
}
export function removeHeightPatch(id) {
  if (!find(id)) return;
  dropHeightMove();
  if (_stroke && _stroke.id === id) cancelStroke();
  P.heightLayers = list().filter((l) => !(l && l.id === id));
  if (_work && _work.id === id) _work = null;
  _activeLayer.delete(id);
  _selections.delete(id);
  if (_active === id) _active = list()[0]?.id ?? null;
  commitStep('remove');
  syncHeightPanel();
  syncHeightOverlay();
}
export function setHeightEnabled(id, on) {
  if (!find(id)) return;
  dropHeightMove();
  updateRecord(id, (r) => ({ ...r, enabled: !!on }));
  commitStep('enabled');
  syncHeightPanel();
  syncHeightOverlay();
}

// ── the layers of the active patch (slice 2): each change ONE step ─────────────────────────────────────────────────
/** Insert `layer` (a full layer object) into the active patch just above its active layer, make it active. One step. */
function insertLayer(layer, what) {
  dropHeightMove();
  const rec = activeHeightLayer();
  if (!rec) return null;
  const at = layerOf(rec);
  updateRecord(rec.id, (r) => {
    const L = layeredRecord(r);
    const i = at ? L.layers.findIndex((l) => l.id === at.id) : L.layers.length - 1;
    const layers = [...L.layers];
    layers.splice(i + 1, 0, layer);
    return { ...L, layers };
  });
  _activeLayer.set(rec.id, layer.id);
  commitStep(what);
  syncHeightPanel();
  syncHeightOverlay();
  return layer;
}
/** '＋ Paint layer': an unpainted paint layer (the patch's grid) above the active layer. */
export async function addPaintLayer() {
  const rec = activeHeightLayer();
  const g = patchGrid(rec);
  if (!g) return null;
  let raster = null;
  await withLoadingStage('heightPatch', async () => { raster = await encodeRaster(new Float32Array(g.cols * g.rows), g.cols, g.rows); });
  if (!find(rec.id)) return null;
  const n = patchLayers(find(rec.id)).length + 1;
  return insertLayer({ id: newLayerId(), name: `Paint ${n}`, kind: 'paint', visible: true, opacity: 1, blend: 'normal', raster }, 'layer-add');
}
/** Delete a layer of the active patch (never its last one: the patch's own Delete removes that). */
export function removePatchLayer(layerId) {
  dropHeightMove();
  const rec = activeHeightLayer();
  const ls = patchLayers(rec);
  if (!rec || ls.length < 2 || !ls.some((l) => l.id === layerId)) return false;
  if (_stroke && _stroke.id === rec.id) cancelStroke();
  const i = ls.findIndex((l) => l.id === layerId);
  updateRecord(rec.id, (r) => { const L = layeredRecord(r); return { ...L, layers: L.layers.filter((l) => l.id !== layerId) }; });
  if (_work && _work.id === rec.id && _work.layerId === layerId) _work = null;
  if (layerOf(rec).id === layerId) _activeLayer.set(rec.id, (ls[i - 1] || ls[i + 1]).id); // the layer under it becomes active
  commitStep('layer-remove');
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}
/** Move a layer one place up (+1, toward the top) or down (-1). */
export function movePatchLayer(layerId, dir) {
  dropHeightMove();
  const rec = activeHeightLayer();
  const ls = patchLayers(rec);
  const i = ls.findIndex((l) => l.id === layerId), j = i + (dir > 0 ? 1 : -1);
  if (i < 0 || j < 0 || j >= ls.length) return false;
  updateRecord(rec.id, (r) => { const L = layeredRecord(r); const layers = [...L.layers]; [layers[i], layers[j]] = [layers[j], layers[i]]; return { ...L, layers }; });
  commitStep('layer-move');
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}
/** The layer the tools edit. */
export function selectPatchLayer(layerId) {
  dropHeightMove();
  const rec = activeHeightLayer();
  if (!rec || !patchLayers(rec).some((l) => l.id === layerId)) return false;
  if (_stroke) cancelStroke();
  _activeLayer.set(rec.id, layerId);
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}
/** One field of a layer of the active patch (`path`: a key or a key path, e.g. ['mapping', 'whiteIn']). `commit` false =
 *  a slider's drag tick (written and drawn; the step comes with its release). */
export function setPatchLayerField(layerId, path, value, { commit = true } = {}) {
  dropHeightMove();
  const rec = activeHeightLayer();
  if (!rec || !patchLayers(rec).some((l) => l.id === layerId)) return false;
  const p = Array.isArray(path) ? path : [path];
  updateRecord(rec.id, (r) => withLayer(r, layerId, (l) => withPath(l, p, p[0] === 'visible' ? !!value : value)));
  if (commit) commitStep(`layer-${p.join('.')}`);
  syncHeightPanel();
  syncHeightOverlay();
  return true;
}

/** One control's value: a brush setting (UI state), or the ACTIVE patch's field (`commit` false: a slider's drag tick --
 *  written and drawn, the step comes with its release). */
export function setHeightField(controlId, value, { commit = true } = {}) {
  const c = allControls().find((x) => x.id === controlId);
  if (!c) return false;
  let v = value;
  if (c.kind === 'slider') { v = parseFloat(value); if (!Number.isFinite(v)) return false; }
  if (c.kind === 'choice') v = c.options.find(([k]) => String(k) === String(value))?.[0];
  if (c.kind === 'check') v = !!value;
  if (c.kind === 'curve') {
    const ok = Array.isArray(value) && value.length >= 2 && value.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    v = ok ? value.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0]) : undefined;
  }
  if (v === undefined) return false;
  if (c.target === 'brush') { _brush = { ..._brush, ...(c.alsoSet ? c.alsoSet(_brush[c.path[0]], v, _brush) : null), [c.path[0]]: v }; syncBrushPicker(); drawCursor(); return true; }
  if (_tools[c.target]) { // a tool's UI state
    const st = _tools[c.target];
    _tools[c.target] = withPath({ ...st, ...(c.alsoSet ? c.alsoSet(getPath(st, c.path), v, st) : null) }, c.path, v);
    syncHeightOverlay();
    return true;
  }
  const rec = activeHeightLayer();
  if (!rec) return false;
  dropHeightMove(); // a patch / layer field is another action
  if (c.target === 'layer') { const l = layerOf(rec); return !!l && setPatchLayerField(l.id, c.path, v, { commit }); }
  if (c.path[0] === 'sizeIn' && !rec.sizeIn) updateRecord(rec.id, (r) => ({ ...r, sizeIn: placed(r).sizeIn }));
  updateRecord(rec.id, (r) => withPath(r, c.path, v));
  if (commit) commitStep(c.id);
  syncHeightOverlay();
  return true;
}
export const heightBrush = () => ({ ..._brush });
let _lastPreset = 'softRound'; // the preset last picked (the "Modified (from ...)" note)
/** A BRUSH_PRESETS entry over the current brush: its tip and profile; the size, opacity, flow and amount stay. */
export function applyHeightBrushPreset(id) {
  const p = BRUSH_PRESETS[id];
  if (!p) return false;
  _brush = { ..._brush, ...p.brush };
  _lastPreset = id;
  syncHeightPanel();
  drawCursor();
  return true;
}
/** The picker follows the brush: the preset it matches is the active tile; none (an edit after a pick) = no tile and the
 *  note "Modified (from <last pick>)". The tip group follows the tip (its declared showWhen). */
function syncBrushPicker() {
  if (typeof document === 'undefined') return;
  const cur = brushPresetOf(_brush);
  if (cur) _lastPreset = cur;
  for (const b of document.querySelectorAll('[data-height-brush-preset]')) b.classList.toggle('active', b.getAttribute('data-height-brush-preset') === cur);
  const note = byId('heightBrushPresetNote');
  if (note) { note.textContent = cur ? '' : `Modified (from ${BRUSH_PRESETS[_lastPreset] ? BRUSH_PRESETS[_lastPreset].label : 'a preset'})`; note.hidden = !!cur; }
  const tipBox = byId('heightGroup_tip'), g = HEIGHT_TOOL_GROUPS.find((x) => x.id === 'tip');
  if (tipBox && g) tipBox.hidden = !g.showWhen(panelCtx());
}

// ── the canvas overlay (the shared editor canvas) ───────────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
let _g = null;
const _images = new Map(); // raster h -> data URL (LRU 16)
const _live = { id: null, canvas: null, frame: 0 };
const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
function canvas2d(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  let ctx = null;
  try { ctx = c.getContext && c.getContext('2d'); } catch (_) { ctx = null; }
  return ctx && typeof ctx.createImageData === 'function' ? { c, ctx } : null;
}
/** The shaded picture of `data` (a patch's heights) as a data URL, or null where there is no 2D canvas. */
function pictureOf(rec, data, reuse = null) {
  const { cols, rows } = patchGrid(rec);
  const size = placed(rec).sizeIn;
  const { w, h } = shadeSize(cols, rows, HEIGHT_VIEW.maxImagePx);
  const cv = reuse && reuse.c.width === w && reuse.c.height === h ? reuse : canvas2d(w, h);
  if (!cv) return null;
  const img = cv.ctx.createImageData(w, h);
  shadeRaster(data, cols, rows, w, h, cols / size.w, rows / size.h, img.data);
  cv.ctx.putImageData(img, 0, 0);
  return { url: cv.c.toDataURL('image/png'), cv };
}
function stillImageOf(rec) {
  const h = compositeKey(rec); // a slice-1 patch: its raster's h, as before
  if (!h) return null;
  if (_images.has(h)) { const u = _images.get(h); _images.delete(h); _images.set(h, u); return u; }
  const d = patchComposite(rec);
  if (!d) { ensurePatchDecoded(rec).then(() => syncHeightOverlay(), () => {}); return null; }
  const p = pictureOf(rec, d);
  if (!p) return null;
  _images.set(h, p.url);
  while (_images.size > 16) _images.delete(_images.keys().next().value);
  return p.url;
}
/** The composite of `rec` with the working layer's heights in place of its stored ones (what a stroke shows now). A
 *  slice-1 patch: the working heights themselves. Falls back to the working heights while another layer is decoding. */
function liveComposite(rec) {
  if (!_work || _work.id !== rec.id) return patchComposite(rec) || null;
  if (_work.kind === 'image') return patchComposite(rec) || null; // an image layer's working values are grey, not heights
  const wl = patchLayers(rec).find((l) => l.id === _work.layerId);
  const stored = !_stroke && !_grad && !_float && _pending === 0 && wl && wl.raster && wl.raster.h === _work.h;
  if (stored) { const c = patchComposite(rec); if (c) return c; } // nothing in flight: the cached composite
  return patchComposite(rec, { layerId: _work.layerId, data: _work.data }) || _work.data;
}
/** During a stroke: the active patch's picture from the working heights, once per animation frame. */
function liveRedraw() {
  if (_live.frame) return;
  const run = () => {
    _live.frame = 0;
    const rec = _work && find(_work.id);
    if (!rec || !_g) return;
    const p = pictureOf(rec, liveComposite(rec), _live.id === rec.id ? _live.canvas : null);
    _live.id = rec.id;
    _live.canvas = p ? p.cv : null;
    const img = _g.querySelector(`[data-height-patch="${rec.id}"] image`);
    if (p && img) img.setAttribute('href', p.url);
    drawCursor();
  };
  if (typeof requestAnimationFrame === 'function') _live.frame = requestAnimationFrame(run); else run();
}
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
/** One CSS pixel in editor inches (the stroke widths), from the canvas's own transform. */
function cssPx() {
  const ctm = _g && _g.getScreenCTM && _g.getScreenCTM();
  return ctm && ctm.a ? 1 / Math.abs(ctm.a) : 0.01;
}

/** Draw every patch on the shared editor canvas, in the editor's coordinates (inches, y down), for the current tab: on top
 *  of the drawing and in full in the Height tab (with the active patch's outline), under it and faded elsewhere. */
export function syncHeightOverlay() {
  ensureTool();
  const ed = editor();
  const sketch = ed && ed._sketchLayer && ed._sketchLayer.node;
  const host = sketch && sketch.parentNode;
  if (!host) return;
  if (!_g) {
    _g = svgEl('g', { id: 'heightPatches', 'pointer-events': 'none' });
  }
  const inTab = getEditorTab() === 'height';
  const anchor = inTab ? sketch.nextSibling : sketch;
  if (_g.parentNode !== host || (inTab ? _g.previousSibling !== sketch : _g.nextSibling !== sketch)) host.insertBefore(_g, anchor);
  // the fade is the focus table's (editor/editor-frame-profile.js EDITOR_TAB_FOCUS heightPatches), never a rule of its own
  const fade = (EDITOR_TAB_FOCUS[getEditorTab()] || EDITOR_TAB_FOCUS.artwork).heightPatches;
  if (fade >= 1) _g.removeAttribute('opacity'); else _g.setAttribute('opacity', String(fade));
  const recs = list().filter((r) => r && r.enabled !== false && patchGrid(r));
  const keep = new Set(recs.map((r) => String(r.id)));
  for (const n of [..._g.querySelectorAll('[data-height-patch]')]) if (!keep.has(n.getAttribute('data-height-patch'))) n.remove();
  const px = cssPx();
  const active = activeHeightLayer();
  for (const rec of recs) {
    const p = placed(rec);
    let node = _g.querySelector(`[data-height-patch="${rec.id}"]`);
    if (!node) {
      node = svgEl('g', { 'data-height-patch': rec.id }, _g);
      svgEl('image', { preserveAspectRatio: 'none' }, node);
      svgEl('rect', { fill: 'none', class: 'height-patch-outline' }, node);
    }
    node.setAttribute('transform', `translate(${fmt(P.widthIn / 2 + p.position.x)} ${fmt(P.heightIn / 2 - p.position.y)}) rotate(${fmt(-p.rotation)})`);
    const img = node.querySelector('image');
    for (const [k, v] of [['x', -p.sizeIn.w / 2], ['y', -p.sizeIn.h / 2], ['width', p.sizeIn.w], ['height', p.sizeIn.h]]) img.setAttribute(k, fmt(v));
    const wl = _work && _work.id === rec.id ? patchLayers(rec).find((l) => l.id === _work.layerId) : null;
    const live = !!wl && (_stroke || _grad || _float || _pending > 0 || _work.h !== (wl.raster && wl.raster.h));
    const url = live ? null : stillImageOf(rec);
    if (url) img.setAttribute('href', url);
    else if (live) liveRedraw();
    const box = node.querySelector('rect');
    for (const [k, v] of [['x', -p.sizeIn.w / 2], ['y', -p.sizeIn.h / 2], ['width', p.sizeIn.w], ['height', p.sizeIn.h]]) box.setAttribute(k, fmt(v));
    box.setAttribute('stroke', HEIGHT_VIEW.outline);
    box.setAttribute('stroke-width', fmt(1.5 * px));
    box.setAttribute('stroke-dasharray', `${fmt(4 * px)} ${fmt(3 * px)}`);
    box.style.display = inTab && active && rec.id === active.id ? '' : 'none';
    drawSelection(node, rec, p, inTab && active && rec.id === active.id);
    drawGradientLine(node, rec, p);
  }
  drawCursor();
}

/** The brush ring under the pointer and the height readout, in the Height tab only. */
function drawCursor() {
  if (!_g) return;
  let ring = _g.querySelector('#heightBrushRing');
  const inTab = getEditorTab() === 'height';
  const readout = byId('heightReadout');
  if (!inTab || !_hover) {
    if (ring) ring.style.display = 'none';
    if (readout) readout.hidden = true;
    return;
  }
  if (!ring) ring = svgEl('path', { id: 'heightBrushRing', fill: 'none' }, _g);
  if (ring !== _g.lastChild) _g.appendChild(ring);
  const px = cssPx();
  // the TIP's real footprint (slice 3, BRUSH_TIPS box): R along the tip, roundness x R across, turned by its board angle
  // (+ the travel direction with followStroke); editor y is down, so a counter-clockwise angle is a negative SVG rotate
  const tip = BRUSH_TIPS[_brush.tip] || BRUSH_TIPS.round;
  const R = _brush.sizeIn / 2, k = Number.isFinite(_brush.roundness) ? _brush.roundness : 1, ry = R * Math.abs(k);
  const deg = (Number.isFinite(_brush.angle) ? _brush.angle : 0) + (_brush.followStroke ? _cursorDir : 0);
  ring.setAttribute('d', tip.box === 'rect'
    ? `M${fmt(-R)} ${fmt(-ry)}H${fmt(R)}V${fmt(ry)}H${fmt(-R)}Z`
    : `M${fmt(-R)} 0A${fmt(R)} ${fmt(ry)} 0 1 0 ${fmt(R)} 0A${fmt(R)} ${fmt(ry)} 0 1 0 ${fmt(-R)} 0Z`);
  ring.setAttribute('transform', `translate(${fmt(_hover.x)} ${fmt(_hover.y)}) rotate(${fmt(-deg)})`);
  ring.setAttribute('stroke', HEIGHT_VIEW.ring);
  ring.setAttribute('stroke-width', fmt(1.5 * px));
  ring.style.display = _tool === 'move' ? 'none' : ''; // the Move tool has no brush
  if (readout) {
    const rec = activeHeightLayer();
    const work = rec ? workingCopy(rec) : null;
    const comp = rec && work ? liveComposite(rec) : null; // the patch's height there (all its layers)
    let text = '';
    if (rec && comp) {
      const q = pixelOf(rec, _hover);
      if (q.inside) text = `height ${sampleRaster(comp, work.cols, work.rows, q.c, q.r).toFixed(3)} in`;
    }
    readout.textContent = text;
    readout.hidden = !text;
  }
}

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────────────────────
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
const cad = (text) => el('label', { class: 'cad-label', text });

// ── the 'curve' control: the custom falloff widget (an inline SVG, Pointer Events) ─────────────────────────────────────
// viewBox 160 x 100 (scales uniformly to the panel width). t 0..1 maps to x CURVE_BOX.x0..x1; values 0..CURVE_BOX.vMax = 0..1.
// Fred 2026-11-22 (asked, "Stop at the box (0 to 1)"): a drag or a tap stops at the box's top and bottom, like a slider at
// its ends, so a falloff never passes full strength (opacity stays the most one stroke can do). A stored curve is never
// rewritten on load.
const CURVE_BOX = Object.freeze({ w: 160, h: 100, x0: 14, x1: 150, yZero: 84, yTop: 8, vMax: 1, hitR: 14, dotR: 5, tGap: 0.005, minGap: 0.01, longPressMs: 600, moveSlop: 4 });
const curveX = (t) => CURVE_BOX.x0 + t * (CURVE_BOX.x1 - CURVE_BOX.x0);
const curveY = (v) => CURVE_BOX.yZero - (v / CURVE_BOX.vMax) * (CURVE_BOX.yZero - CURVE_BOX.yTop);
const curveT = (x) => (x - CURVE_BOX.x0) / (CURVE_BOX.x1 - CURVE_BOX.x0);
const curveV = (y) => Math.min(CURVE_BOX.vMax, Math.max(0, ((CURVE_BOX.yZero - y) / (CURVE_BOX.yZero - CURVE_BOX.yTop)) * CURVE_BOX.vMax)); // Fred: the box's 0..1
let _curveLive = null; // { id, pts }: the points of curve control `id` being dragged (drawn live; written once on release)

function paintCurve(svg, pts) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const B = CURVE_BOX, ink = HEIGHT_VIEW.outline;
  const line = (x1, y1, x2, y2, extra = {}) => svgEl('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-opacity': 0.25, 'stroke-width': 1, ...extra }, svg);
  line(B.x0, B.yTop, B.x0, B.yZero); line(B.x1, B.yTop, B.x1, B.yZero);
  line(B.x0, B.yZero, B.x1, B.yZero); line(B.x0, curveY(1), B.x1, curveY(1), { 'stroke-dasharray': '3 3' });
  for (const [x, anchor, text] of [[B.x0, 'start', 'hard core'], [B.x1, 'end', 'rim']]) {
    const t = svgEl('text', { x, y: B.h - 3, 'text-anchor': anchor, 'font-size': 8, fill: 'currentColor', 'fill-opacity': 0.6 }, svg);
    t.textContent = text;
  }
  const f = curveFromPoints(pts), N = 48, d = [];
  for (let i = 0; i <= N; i++) { const t = i / N; d.push(`${i ? 'L' : 'M'}${curveX(t).toFixed(2)} ${curveY(f(t)).toFixed(2)}`); }
  svgEl('path', { d: d.join(' '), fill: 'none', stroke: ink, 'stroke-width': 2 }, svg);
  pts.forEach(([t, v], i) => {
    const g = svgEl('g', { 'data-curve-handle': i, style: 'cursor:grab' }, svg);
    svgEl('circle', { 'data-curve-hit': '', cx: curveX(t), cy: curveY(v), r: B.hitR, fill: 'transparent' }, g); // the touch target: 28 px across
    svgEl('circle', { cx: curveX(t), cy: curveY(v), r: B.dotR, fill: '#fff', stroke: ink, 'stroke-width': 2 }, g);
  });
}

/** A 'curve' control's points now: the ones being dragged, else its target's stored ones (the default line when none). */
const curvePointsNow = (c) => {
  if (_curveLive && _curveLive.id === c.id) return _curveLive.pts;
  const v = getPath(controlSource(c, activeHeightLayer()) || {}, c.path);
  return Array.isArray(v) ? v : BRUSH_DEFAULTS.customCurve;
};
function drawCurveControl(c) { const s = byId(`height_${c.id}`)?.querySelector('svg'); if (s) paintCurve(s, curvePointsNow(c)); }

function wireCurve(c) {
  const box = byId(`height_${c.id}`), svg = box && box.querySelector('svg');
  if (!svg) return;
  const B = CURVE_BOX;
  const vb = (e) => { const r = svg.getBoundingClientRect(); const k = B.w / (r.width || B.w); return [(e.clientX - r.left) * k, (e.clientY - r.top) * (B.h / (r.height || B.h))]; };
  const write = (pts) => { _curveLive = null; setHeightField(c.id, pts); syncHeightPanel(); };
  let drag = null;
  const clearTimer = () => { if (drag && drag.timer) { clearTimeout(drag.timer); drag.timer = null; } };
  const idxOf = (e) => { const h = e.target.closest && e.target.closest('[data-curve-handle]'); return h ? Number(h.getAttribute('data-curve-handle')) : -1; };
  const removeAt = (i) => { const pts = curvePointsNow(c); if (i > 0 && i < pts.length - 1) write(pts.filter((_, k) => k !== i)); };
  svg.addEventListener('pointerdown', (e) => {
    const [x, y] = vb(e), i = idxOf(e), pts = curvePointsNow(c).map((p) => [p[0], p[1]]);
    if (typeof svg.setPointerCapture === 'function' && e.pointerId != null) { try { svg.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ } }
    drag = { i, x, y, pts, moved: false, timer: null };
    if (i > 0 && i < pts.length - 1 && e.pointerType === 'touch') {
      drag.timer = setTimeout(() => { drag.timer = null; const k = drag.i; drag = null; _curveLive = null; removeAt(k); }, B.longPressMs); // long-press = remove
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [x, y] = vb(e);
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < B.moveSlop) return;
    drag.moved = true; clearTimer();
    if (drag.i < 0) return;
    const i = drag.i, pts = drag.pts, last = pts.length - 1;
    let t = pts[i][0];
    if (i > 0 && i < last) t = Math.min(pts[i + 1][0] - B.tGap, Math.max(pts[i - 1][0] + B.tGap, curveT(x))); // keeps the curve a function
    pts[i] = [t, curveV(y)];
    _curveLive = { id: c.id, pts };
    paintCurve(svg, pts);
  });
  const end = (e, cancelled) => {
    if (!drag) return;
    clearTimer();
    const d = drag; drag = null;
    if (cancelled) { _curveLive = null; paintCurve(svg, curvePointsNow(c)); return; }
    if (d.i >= 0) { if (d.moved && _curveLive) write(_curveLive.pts); else _curveLive = null; return; }
    if (d.moved) return; // a swipe over the empty area is not a tap
    const t = curveT(d.x), pts = curvePointsNow(c);
    if (!(t > 0 && t < 1) || pts.some((p) => Math.abs(p[0] - t) < B.minGap)) return;
    write([...pts, [t, curveV(d.y)]]);
  };
  svg.addEventListener('pointerup', (e) => end(e, false));
  svg.addEventListener('pointercancel', (e) => end(e, true));
  svg.addEventListener('dblclick', (e) => { const i = idxOf(e); if (i >= 0) removeAt(i); });
}

function renderControl(c) {
  if (c.kind === 'curve') {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${CURVE_BOX.w} ${CURVE_BOX.h}`);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Falloff curve: drag a point, tap to add one, double-click to remove one');
    svg.style.cssText = 'width:100%; height:auto; display:block; touch-action:none; user-select:none; margin-bottom:10px;';
    paintCurve(svg, curvePointsNow(c));
    const box = el('div', { id: `height_${c.id}` }, [cad(c.label)]);
    box.appendChild(svg);
    return box;
  }
  if (c.kind === 'choice') {
    return el('div', {}, [cad(c.label), el('div', { class: 'relief-toggle', id: `height_${c.id}`, style: 'margin-bottom:10px; flex-wrap:wrap;' },
      c.options.map(([key, text, title]) => el('button', { type: 'button', class: 'relief-toggle-btn', 'data-height-choice': `${c.id}:${key}`, title, text })))]);
  }
  if (c.kind === 'check') {
    // the box itself reaches the touch floor on a coarse pointer (--touch-target-min is declared only there, styles/editor.css;
    // a mouse keeps the platform box)
    return el('label', { class: 'cad-label photo-layer-check' }, [el('input', { type: 'checkbox', id: `height_${c.id}`, style: 'min-width:var(--touch-target-min, 0px); min-height:var(--touch-target-min, 0px);' }), el('span', { text: c.label })]);
  }
  const [min, max] = c.range(P);
  const s = el('input', { type: 'range', id: `height_${c.id}Slider`, class: 'cad-slider', min: String(min), max: String(max), step: String(c.step) });
  const n = el('input', { type: 'number', id: `height_${c.id}`, min: String(min), max: String(max), step: String(c.step) });
  return el('div', {}, [cad(c.label), el('div', { class: 'cad-slider-row', style: 'margin-bottom:10px;' }, [s, el('div', { class: 'cad-stepper', style: 'width:66px;' }, [n])]),
    c.note ? el('div', { class: 'photo-layer-note', text: c.note }) : null]);
}

/** The groups in panel order: the slice-2 tool groups first (the layers on top), the slice-1 groups, then the ones
 *  declared `after` (the file buttons). */
const panelGroups = () => {
  const out = [...HEIGHT_TOOL_GROUPS.filter((g) => !g.after && !g.follows), ...HEIGHT_GROUPS, ...HEIGHT_TOOL_GROUPS.filter((g) => g.after && !g.follows)];
  for (const g of HEIGHT_TOOL_GROUPS.filter((x) => x.follows)) { const i = out.findIndex((x) => x.id === g.follows); out.splice(i < 0 ? out.length : i + 1, 0, g); }
  return out;
};
/** What a showWhen reads. */
const panelCtx = () => { const rec = activeHeightLayer(); return { tool: _tool, brush: _brush, patch: rec ? placed(rec) : null, layer: rec ? layerOf(rec) : null, tools: _tools }; };
/** A control's source object (its target's state) for the active patch. */
function controlSource(c, rec) {
  if (c.target === 'brush') return _brush;
  if (_tools[c.target]) return _tools[c.target];
  if (!rec) return null;
  return c.target === 'layer' ? layerOf(rec) : placed(rec);
}
/** A brush preset's tile icon (64 x 64): its FOOTPRINT on top (the tip's BRUSH_TIPS box, squashed by its roundness; a
 *  stroke arrow when it turns with the stroke) and its PROFILE below (the falloff across the tip, hardness included). */
function brushPresetIcon(b) {
  const tip = BRUSH_TIPS[b.tip] || BRUSH_TIPS.round, k = Number.isFinite(b.roundness) ? b.roundness : 1;
  const ink = HEIGHT_VIEW.outline, R = 13, ry = Math.max(1.5, R * k);
  const foot = tip.box === 'rect'
    ? `<rect x="${32 - R}" y="${(19 - ry).toFixed(1)}" width="${2 * R}" height="${(2 * ry).toFixed(1)}" fill="${ink}" fill-opacity="0.25" stroke="${ink}" stroke-width="1.5"/>`
    : `<ellipse cx="32" cy="19" rx="${R}" ry="${ry.toFixed(1)}" fill="${ink}" fill-opacity="0.25" stroke="${ink}" stroke-width="1.5"/>`;
  const arrow = b.followStroke ? `<path d="M8 19H56M50 14L56 19L50 24" fill="none" stroke="${ink}" stroke-width="1.2" stroke-opacity="0.6"/>` : '';
  const pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 20 - 1; pts.push(`${(32 + 26 * t).toFixed(1)} ${(60 - 22 * brushFalloff(Math.abs(t), 1, b.hardness, b.falloff)).toFixed(1)}`); }
  const prof = `<path d="M6 60L${pts.join('L')}L58 60Z" fill="${ink}" fill-opacity="0.55" stroke="${ink}" stroke-width="1"/>`;
  return `<svg xmlns="${NS}" viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">${arrow}${foot}<line x1="4" y1="60" x2="60" y2="60" stroke="currentColor" stroke-opacity="0.35"/>${prof}</svg>`;
}
/** A group's own head (above its controls), by group id. */
const GROUP_HEADS = Object.freeze({
  // slice 3b: the BRUSH PICKER (core/height/brush.js BRUSH_PRESETS) -- its tiles, turned into the app's one picker by
  // main/icon-select.js mountIconGrid once the panel is on the page (renderHeightPanel)
  brush: () => el('div', { id: 'heightBrushPicker', style: 'margin-bottom:10px;' }, [
    el('div', { id: 'heightBrushPresets' }, Object.entries(BRUSH_PRESETS).map(([id, p]) => {
      const b = el('button', { type: 'button', id: `heightBrushPreset_${id}`, class: 'cad-btn icon-select-option', 'data-height-brush-preset': id, title: `${p.label}: ${p.title}`, 'aria-label': p.label });
      b.innerHTML = brushPresetIcon(p.brush);
      return b;
    })),
    el('div', { id: 'heightBrushPresetNote', class: 'photo-layer-note', hidden: '' }),
  ]),
  file: () => el('div', { class: 'photo-layer-buttons' }, [
    el('input', { type: 'file', id: 'heightImportFile', accept: '.png,.jpg,.jpeg,.webp,.exr,image/png,image/jpeg,image/webp', hidden: '' }),
    el('button', { type: 'button', id: 'heightImportBtn', class: 'cad-btn cad-btn-secondary', text: 'Import heightmap…', title: 'A grey picture as an image layer (its grey values kept; the mapping stays live)' }),
    el('button', { type: 'button', id: 'heightExportBtn', class: 'cad-btn cad-btn-secondary', text: 'Export heightmap', title: 'The patch (all its layers) as a 16-bit grey PNG; its height range is in the file name' }),
  ]),
  fill: () => el('div', { class: 'photo-layer-buttons' }, [
    el('button', { type: 'button', id: 'heightFillApply', class: 'cad-btn cad-btn-secondary', text: '▣ Fill', title: 'The selection (or the whole layer) to the fill height' }),
  ]),
  select: () => el('div', {}, [
    el('div', { class: 'photo-layer-buttons', style: 'flex-wrap:wrap;' }, [
      el('button', { type: 'button', id: 'heightSelFeather', class: 'cad-btn cad-btn-secondary', text: 'Feather', title: 'Soften the selection edge by the Feather amount' }),
      el('button', { type: 'button', id: 'heightSelInvert', class: 'cad-btn cad-btn-secondary', text: 'Invert' }),
      el('button', { type: 'button', id: 'heightSelClear', class: 'cad-btn cad-btn-secondary', text: 'Clear', title: 'No selection: the tools work everywhere' }),
    ]),
    el('label', { class: 'cad-label', text: 'From a Draw-tab shape' }),
    el('div', { class: 'photo-layer-buttons' }, [
      // a plain select in the row (the app's .cad-select is an overlay for a .cad-select-wrap: it would cover the canvas)
      el('select', { id: 'heightSelSource', title: 'The Draw-tab layer whose shapes become the selection', style: 'flex:1 1 110px; min-width:0; min-height:32px; font-size:11px;' }),
      el('button', { type: 'button', id: 'heightSelFromShape', class: 'cad-btn cad-btn-secondary', text: 'Select shape' }),
    ]),
  ]),
  layers: () => el('div', {}, [
    el('div', { id: 'heightLayerList', class: 'stl-list' }),
    el('div', { class: 'photo-layer-buttons' }, [
      el('button', { type: 'button', id: 'heightLayerAdd', class: 'cad-btn cad-btn-secondary', text: '＋ Paint layer', title: 'An unpainted layer above the selected one' }),
    ]),
  ]),
});

/** Build the panel from the declared tables into `body`, and the tools + brush modes into the rail. */
export function renderHeightPanel(body, rail = byId('editorToolbarHeight')) {
  if (rail) {
    rail.innerHTML = '';
    for (const t of HEIGHT_TOOLS) rail.appendChild(el('button', { type: 'button', class: 'tool-btn', 'data-height-tool': t.id, title: `${t.label}: ${t.title}`, 'aria-label': t.label, text: t.icon }));
    for (const c of HEIGHT_CONTROLS.filter((x) => x.rail)) {
      for (const [key, text, title] of c.options) {
        rail.appendChild(el('button', { type: 'button', class: 'tool-btn', 'data-height-choice': `${c.id}:${key}`, title: `${text}: ${title}`, 'aria-label': text, text: MODE_LABELS[key] ? MODE_LABELS[key][0] : text }));
      }
    }
  }
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'photo-layer-buttons' }, [
    el('button', { type: 'button', id: 'heightNew', class: 'cad-btn cad-btn-secondary', text: '＋ New height patch', title: 'An unpainted patch over the whole board (100 pixels per inch)' }),
    el('button', { type: 'button', id: 'heightRemove', class: 'cad-btn cad-btn-secondary', text: '🗑 Delete' }),
  ]));
  body.appendChild(el('div', { id: 'heightStatus', class: 'photo-layer-note', role: 'status', hidden: '' }));
  body.appendChild(el('div', { id: 'heightList', class: 'stl-list' }));
  const ctx = panelCtx();
  for (const g of panelGroups()) {
    const box = el('div', { id: `heightGroup_${g.id}` });
    box.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [el('span', { text: g.label }), g.note ? el('span', { class: 'photo-layer-group-note', text: ` ${g.note}` }) : null]));
    if (GROUP_HEADS[g.id]) box.appendChild(GROUP_HEADS[g.id]());
    for (const c of allControls().filter((x) => x.group === g.id)) {
      const w = el('div', { 'data-height-control': c.id }, [renderControl(c)]);
      if (c.showWhen) w.hidden = !c.showWhen(_brush, null, ctx);
      box.appendChild(w);
    }
    if (g.showWhen) box.hidden = !g.showWhen(ctx);
    body.appendChild(box);
  }
  body.appendChild(el('div', { id: 'heightStored', class: 'photo-layer-note' }));
  // the brush picker: its tiles become the app's one picker (AGENTS.md rule 2: never a hand-built popover)
  mountIconGrid(byId('heightBrushPresets'), { label: 'Brush', optionSelector: '[data-height-brush-preset]', ids: { wrap: 'heightBrushPickerWrap', chip: 'heightBrushChip', name: 'heightBrushName' } });
  syncBrushPicker();
}

/** The active patch's layers, TOP first: visible, name (select), up / down, delete. */
function syncLayerList(rec) {
  const box = byId('heightLayerList');
  if (!box) return;
  box.innerHTML = '';
  const ls = patchLayers(rec);
  const act = rec ? layerOf(rec) : null;
  for (const l of [...ls].reverse()) {
    const i = ls.indexOf(l);
    const row = el('div', { class: `stl-row${act && l.id === act.id ? ' stl-row-active' : ''}`, 'data-patch-layer': l.id, style: 'gap:2px; flex-wrap:wrap;' }, [
      el('input', { type: 'checkbox', 'data-patch-layer-visible': l.id, title: 'Show this layer (it counts in the patch)' }),
      // not .stl-row-name: its open / closed arrow belongs to a card, and a layer row needs the room for its name
      el('button', { type: 'button', class: 'height-layer-name', style: 'flex:1 0 auto; min-width:0; max-width:calc(100% - 24px); min-height:32px; text-align:left; background:none; border:0; font:inherit; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;', 'data-patch-layer-pick': l.id, text: `${l.kind === 'image' ? '🖼 ' : ''}${l.name || 'Layer'}`, title: l.kind === 'image' ? 'An imported heightmap (its grey values, mapped live)' : 'A paint layer' }),
      // a name longer than the row's free width takes the whole row and its buttons move under it together, right-aligned
      el('span', { style: 'display:flex; gap:2px; margin-left:auto;' }, [
        el('button', { type: 'button', class: 'stl-row-del', 'data-patch-layer-move': `${l.id}:1`, title: 'Move up', 'aria-label': 'Move up', text: '▲' }),
        el('button', { type: 'button', class: 'stl-row-del', 'data-patch-layer-move': `${l.id}:-1`, title: 'Move down', 'aria-label': 'Move down', text: '▼' }),
        el('button', { type: 'button', class: 'stl-row-del', 'data-patch-layer-remove': l.id, title: 'Delete this layer', 'aria-label': 'Delete layer', text: '🗑' }),
      ]),
    ]);
    row.querySelector('input').checked = l.visible !== false;
    row.querySelector(`[data-patch-layer-move="${l.id}:1"]`).disabled = i === ls.length - 1;
    row.querySelector(`[data-patch-layer-move="${l.id}:-1"]`).disabled = i === 0;
    row.querySelector('[data-patch-layer-remove]').disabled = ls.length < 2; // the patch's own Delete removes the last one
    box.appendChild(row);
  }
}

const KIB = 1024;
/** Reflect the state on the panel. Safe any time (a load, an undo, a stroke). */
export function syncHeightPanel() {
  const recs = list();
  if (!find(_active)) _active = recs[0]?.id ?? null;
  const listEl = byId('heightList');
  if (listEl) {
    listEl.innerHTML = '';
    if (!recs.length) listEl.appendChild(el('div', { class: 'photo-layer-note', text: 'No height patch yet. Add one, then paint on the board.' }));
    for (const r of recs) {
      const on = r.enabled !== false;
      const row = el('div', { class: `stl-row${r.id === _active ? ' stl-row-active' : ''}` }, [
        el('input', { type: 'checkbox', 'data-height-enable': r.id, title: 'Stamp this patch' }),
        el('button', { type: 'button', class: 'stl-row-name', 'data-height-pick': r.id, text: r.name || 'Height' }),
      ]);
      row.querySelector('input').checked = on;
      listEl.appendChild(row);
    }
  }
  const rec = activeHeightLayer();
  const n = rec ? placed(rec) : null;
  const ctx = panelCtx();
  syncLayerList(rec);
  for (const c of allControls()) {
    const src = controlSource(c, rec);
    const v = src ? getPath(src, c.path) : undefined;
    if (c.kind === 'slider') {
      const [min, max] = c.range(P);
      for (const id of [`height_${c.id}Slider`, `height_${c.id}`]) { const x = byId(id); if (x) { x.min = String(min); x.max = String(max); if (v !== undefined) x.value = String(v); x.disabled = !src; } }
    } else if (c.kind === 'check') {
      const x = byId(`height_${c.id}`); if (x) x.checked = !!v;
    } else if (c.kind === 'curve') {
      drawCurveControl(c);
    } else if (typeof document !== 'undefined') {
      for (const b of document.querySelectorAll(`[data-height-choice^="${c.id}:"]`)) b.classList.toggle('active', b.getAttribute('data-height-choice') === `${c.id}:${v}`);
    }
  }
  if (typeof document !== 'undefined') {
    for (const c of allControls()) if (c.showWhen) { const w = document.querySelector(`[data-height-control="${c.id}"]`); if (w) w.hidden = !c.showWhen(_brush, n, ctx); }
    for (const b of document.querySelectorAll('[data-height-tool]')) b.classList.toggle('active', b.getAttribute('data-height-tool') === _tool);
  }
  for (const g of panelGroups()) {
    const box = byId(`heightGroup_${g.id}`);
    if (!box) continue;
    const needsPatch = g.id === 'patch' || g.id === 'stamp' || g.id === 'layers' || !!g.needsPatch;
    box.hidden = (needsPatch && !rec) || (g.showWhen ? !g.showWhen(ctx) : false);
  }
  const rm = byId('heightRemove'); if (rm) rm.disabled = !rec;
  const add = byId('heightLayerAdd'); if (add) add.disabled = !rec;
  const exp = byId('heightExportBtn'); if (exp) exp.disabled = !rec;
  const hasSel = !!heightSelection();
  for (const id of ['heightSelFeather', 'heightSelInvert', 'heightSelClear']) { const b = byId(id); if (b) b.disabled = !hasSel; }
  syncSelectionSources();
  syncBrushPicker();
  const stored = byId('heightStored');
  if (stored) {
    const bytes = recs.reduce((s, r) => s + patchRasters(r).reduce((t, x) => t + ((x && x.data && x.data.length) || 0), 0), 0);
    const g = rec ? patchGrid(rec) : null;
    stored.hidden = !recs.length;
    stored.textContent = g ? `${g.cols} x ${g.rows} pixels (${HEIGHT_PX_PER_IN} per inch when made). Stored in the project: ${(bytes / KIB).toFixed(0)} KB.` : '';
  }
}

function onTabChanged(e) {
  const tab = e && e.detail ? e.detail.tab : getEditorTab();
  ensureTool();
  if (tab !== 'height') { cancelStroke(); dropHeightMove(); }
  const ed = editor();
  // the Height tab's own tool: its brush is armed on entry (global-events.js drops it again on a switch away)
  if (tab === 'height' && ed && typeof ed.setMode === 'function' && ed._currentMode !== 'heightBrush') ed.setMode('heightBrush');
  const readout = byId('heightReadout'); if (readout && tab !== 'height') readout.hidden = true;
  syncHeightOverlay();
}
const onViewChanged = () => syncHeightOverlay();

/** Wire the tab (main.js). `hooks.onChange`: a committed change (main.js rebuilds once the editor is closed). */
export function initHeightPanel(hooks = {}) {
  _hooks = { onChange: hooks.onChange || (() => {}) };
  renderHeightPanel(byId('heightPanelBody'));
  registerUndoPart('heightLayers', {
    take: () => P.heightLayers, // the copy-on-write list itself: an entry costs a reference
    restore: (v) => { if (v === P.heightLayers) return; cancelStroke(); cancelHeightMove(); P.heightLayers = v; syncHeightPanel(); syncHeightOverlay(); },
  });
  byId('editorTabHeight')?.addEventListener('click', () => setEditorTab('height'));
  byId('heightNew')?.addEventListener('click', () => { newHeightPatch().catch((e) => status(`Could not make the patch: ${e && e.message ? e.message : e}`, true)); });
  byId('heightRemove')?.addEventListener('click', () => { const r = activeHeightLayer(); if (r) removeHeightPatch(r.id); });
  byId('heightList')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-height-pick]');
    if (pick) { dropHeightMove(); _active = pick.getAttribute('data-height-pick'); syncHeightPanel(); syncHeightOverlay(); }
  });
  byId('heightList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-height-enable]');
    if (box) setHeightEnabled(box.getAttribute('data-height-enable'), box.checked);
  });
  byId('heightFillApply')?.addEventListener('click', () => { fillHeight(); });
  // the editor's own Apply / Cancel settle a floating piece first (pointerdown: before their click handlers run)
  for (const [btnId, how] of Object.entries(MOVE_SETTLE_BUTTONS)) byId(btnId)?.addEventListener('pointerdown', () => (how === 'drop' ? dropHeightMove() : cancelHeightMove()));
  if (typeof document !== 'undefined') {
    for (const b of document.querySelectorAll('[data-height-brush-preset]')) b.addEventListener('click', () => applyHeightBrushPreset(b.getAttribute('data-height-brush-preset')));
  }
  byId('heightImportBtn')?.addEventListener('click', () => byId('heightImportFile')?.click());
  byId('heightExportBtn')?.addEventListener('click', () => { exportHeightmap(); });
  byId('heightImportFile')?.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (file) importHeightmap(file);
  });
  byId('heightSelFeather')?.addEventListener('click', () => featherHeightSelection(_tools.select.featherIn));
  byId('heightSelInvert')?.addEventListener('click', () => invertHeightSelection());
  byId('heightSelClear')?.addEventListener('click', () => clearHeightSelection());
  byId('heightSelFromShape')?.addEventListener('click', () => {
    const id = byId('heightSelSource')?.value;
    if (id) selectHeightFromLayer(id).catch((e) => status(`Could not read the shape: ${e && e.message ? e.message : e}`, true));
  });
  byId('heightLayerAdd')?.addEventListener('click', () => { addPaintLayer().catch((e) => status(`Could not add the layer: ${e && e.message ? e.message : e}`, true)); });
  byId('heightLayerList')?.addEventListener('click', (e) => {
    const t = e.target.closest('[data-patch-layer-pick],[data-patch-layer-move],[data-patch-layer-remove]');
    if (!t || t.disabled) return;
    if (t.hasAttribute('data-patch-layer-pick')) selectPatchLayer(t.getAttribute('data-patch-layer-pick'));
    else if (t.hasAttribute('data-patch-layer-remove')) removePatchLayer(t.getAttribute('data-patch-layer-remove'));
    else { const v = t.getAttribute('data-patch-layer-move'); const k = v.lastIndexOf(':'); movePatchLayer(v.slice(0, k), Number(v.slice(k + 1))); }
  });
  byId('heightLayerList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-patch-layer-visible]');
    if (box) setPatchLayerField(box.getAttribute('data-patch-layer-visible'), 'visible', box.checked);
  });
  if (typeof document !== 'undefined') {
    for (const b of document.querySelectorAll('[data-height-tool]')) b.addEventListener('click', () => setHeightTool(b.getAttribute('data-height-tool')));
  }
  for (const c of allControls()) {
    if (c.kind === 'slider') {
      const s = byId(`height_${c.id}Slider`), n = byId(`height_${c.id}`);
      s?.addEventListener('input', (e) => { if (n) n.value = e.target.value; setHeightField(c.id, e.target.value, { commit: false }); });
      s?.addEventListener('change', (e) => { setHeightField(c.id, e.target.value); syncHeightPanel(); });
      n?.addEventListener('change', (e) => { setHeightField(c.id, e.target.value); syncHeightPanel(); });
    } else if (c.kind === 'curve') {
      wireCurve(c);
    } else if (c.kind === 'check') {
      byId(`height_${c.id}`)?.addEventListener('change', (e) => setHeightField(c.id, e.target.checked));
    } else if (typeof document !== 'undefined') {
      for (const b of document.querySelectorAll(`[data-height-choice^="${c.id}:"]`)) {
        b.addEventListener('click', () => {
          setHeightField(c.id, b.getAttribute('data-height-choice').slice(c.id.length + 1));
          if (c.rail) { setHeightTool('brush'); const ed = editor(); if (ed && typeof ed.setMode === 'function' && getEditorTab() === 'height') ed.setMode('heightBrush'); }
          syncHeightPanel();
        });
      }
    }
  }
  if (typeof document !== 'undefined') {
    const container = byId('editorCanvasContainer');
    if (container && !byId('heightReadout')) {
      container.appendChild(el('div', { id: 'heightReadout', class: 'heights-hud', hidden: '', style: 'position:absolute; top:12px; right:12px; z-index:10; pointer-events:none;' }));
    }
    ensureMoveBar();
    // capture: the Move tool's Esc cancels its piece before main/global-events.js's Esc (back to Select) sees it
    window.addEventListener('keydown', onMoveKey, true);
    document.addEventListener('editorTabChanged', onTabChanged); // the same function: one listener however often init runs
    for (const ev of ['editorBoardResized', 'editorViewChanged', 'editorTopViewUpdated']) document.addEventListener(ev, onViewChanged);
  }
  ensureTool();
  syncHeightPanel();
  syncHeightOverlay();
}

/** A load / a global undo replaced P.heightLayers (main/snapshot-manager.js): an open stroke is dropped, the panel and
 *  the pictures follow the restored records (the working copy reloads from the restored raster on the next use). */
export function syncHeightTab() {
  cancelStroke();
  cancelHeightMove();
  syncHeightPanel();
  syncHeightOverlay();
}

/** Test / host hook. */
export function _resetHeightPanelForTests() {
  _active = null; _brush = { ...BRUSH_DEFAULTS }; _tools = freshTools(); _tool = 'brush'; _activeLayer.clear(); _selections.clear(); _drag = null; _grad = null; _float = null; _marq = null; _lastPreset = 'softRound'; _cursorDir = 0; _dirFrom = null; _work = null; _stroke = null; _pending = 0; _chain = Promise.resolve(); _hover = null; _curveLive = null;
  _hooks = { onChange: () => {} };
  if (_g) _g.remove();
  _g = null; _images.clear(); _live.id = null; _live.canvas = null; _live.frame = 0;
}
