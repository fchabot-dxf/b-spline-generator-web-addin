/**
 * formula-fields.js — FORMULA-FIELDS: which sidebar number fields accept formulas, and the names each one can use.
 * DECLARED here (data only, no per-field code); core/formula-field.js does the binding, core/formula.js the maths.
 *
 * One entry per sidebar SECTION: the field ids it makes formula-capable + the names that section adds. Every
 * section's scope = the stock names (width, height, depth — useful everywhere) + its own names. Names read the
 * live value from P, so the dropdown always shows current values.
 *
 * Covered: the generic sidebar number fields whose handler is bind() -> applyParam (main/ui-bindings.js) — stage 1
 * (R1) proved it on Stock Width/Height, R2 extends it to every such section outside the frozen/other-seat files.
 * FRAME (FB-APP F9, F15): Trim offset, Frame bottom and the Frame tab's thickness (values in the frame record, not P).
 * SCULPT (F15): Strength / Hardness, now bound to P.sculpt{Top,Bot}Strength through INPUT_PAIRS (core/state.js).
 * STAMP TRANSFORM (F15): tx/ty/rotation/scale live on the LAYER, written by bindLayerOnlyNumber
 * (main/stamp/_dom-binders.js), which attaches them with STAMP_TRANSFORM_FIELDS' per-layer scope below.
 * Deliberately NOT here: seed (an integer id, not a quantity). The lattice panels have their own (R3).
 */
import { P } from '../core/state.js';
import { attachFormula } from '../core/formula-field.js';
import { FRAME_DEFS, getFrameRecord, frameParam } from '../core/frame-record.js';

const IN = '"';
const DEG = '°';
/** A declared name reading P[key] live. */
const pname = (name, key, label, unit = '') => ({ name, label, get: () => P[key], unit });

/** Names every section can reference. */
export const STOCK_SCOPE = Object.freeze([
  pname('width', 'widthIn', 'Stock width (X)', IN),
  pname('height', 'heightIn', 'Stock height (Y)', IN),
  pname('depth', 'carveZ', 'Carve depth (Z)', IN),
]);

/** section -> formula-capable field ids + the names that section adds to STOCK_SCOPE. */
export const FORMULA_SECTIONS = Object.freeze([
  { section: 'STOCK DIMENSIONS', ids: ['widthIn', 'heightIn', 'carveZ'], names: [] },
  {
    section: 'SKELETON',
    ids: ['peakShape', 'density', 'clustering', 'symOffsetX', 'symOffsetY', 'edgeMarginIn', 'smoothIntensity',
      'smoothRadius'],
    names: [
      pname('peak', 'peakShape', 'Peak shape'),
      pname('density', 'density', 'Density'),
      pname('clustering', 'clustering', 'Clustering'),
      pname('symx', 'symOffsetX', 'Symmetry offset X'),
      pname('symy', 'symOffsetY', 'Symmetry offset Y'),
      pname('border', 'edgeMarginIn', 'Flat border', IN),
      pname('smoothing', 'smoothIntensity', 'Smoothing intensity'),
      pname('smoothradius', 'smoothRadius', 'Smoothing radius'),
    ],
  },
  {
    section: 'FILTER',
    ids: ['scale', 'detailDensity', 'detailStrength'],
    names: [
      pname('finescale', 'scale', 'Fine scale'),
      pname('coverage', 'detailDensity', 'Detail coverage'),
      pname('detail', 'detailStrength', 'Empty zone detail'),
    ],
  },
  {
    section: 'VECTOR STAMPING',
    ids: ['stampDepth', 'stampVBitAngle', 'stampBlur', 'stampSmoothingRadius', 'stampTextureSuppression',
      'stampEdgeFilletRadius', 'stampFilletPower'],
    names: [
      pname('plunge', 'stampDepth', 'Plunge depth', IN),
      pname('angle', 'stampVBitAngle', 'V-bit angle', DEG),
      pname('blur', 'stampBlur', 'Blur radius'),
      pname('smoothing', 'stampSmoothingRadius', 'Smoothing'),
      pname('suppression', 'stampTextureSuppression', 'Texture suppression'),
      pname('fillet', 'stampEdgeFilletRadius', 'Edge fillet', IN),
      pname('sharpness', 'stampFilletPower', 'Fillet sharpness'),
    ],
  },
  {
    section: 'FRAME',
    // Fred: "mirrored" -- each frame field is in the main panel AND the editor's Frame tab.
    ids: ['frameTrimOffset', 'frameBottomZ', 'editorFrameThickness', 'framePanelLip',
      'frameThickness', 'editorFrameTrimOffset', 'editorFrameBottomZ', 'editorFramePanelLip'],
    names: [
      { name: 'trim', label: 'Trim offset', get: () => frameParam(FRAME_DEFS, getFrameRecord(), 'boundingboxoffset'), unit: IN },
      { name: 'bottom', label: 'Frame bottom (z)', get: () => getFrameRecord().frameBottomZ, unit: IN },
      { name: 'thickness', label: 'Frame thickness', get: () => frameParam(FRAME_DEFS, getFrameRecord(), 'frame_thickness'), unit: IN },
      { name: 'lip', label: 'Panel lip', get: () => getFrameRecord().panelLip ?? 0, unit: IN }, // F22
    ],
  },
  {
    section: 'SCULPT TOP',
    ids: ['sculptTopRadius', 'sculptTopHardness', 'sculptTopNoiseScale'],
    names: [pname('brush', 'sculptTopRadius', 'Brush size'), pname('strength', 'sculptTopStrength', 'Strength / Hardness'),
      pname('noise', 'sculptTopNoiseScale', 'Noise scale')],
  },
  {
    section: 'THICKEN',
    ids: ['thickenOffset'],
    names: [pname('thickness', 'thickness', 'Offset (thickness)', IN)],
  },
  {
    section: 'SCULPT BOTTOM',
    ids: ['sculptBotRadius', 'sculptBotHardness', 'sculptBotNoiseScale'],
    names: [pname('brush', 'sculptBotRadius', 'Brush size'), pname('strength', 'sculptBotStrength', 'Strength / Hardness'),
      pname('noise', 'sculptBotNoiseScale', 'Noise scale')],
  },
].map((s) => Object.freeze({ ...s, scope: Object.freeze([...STOCK_SCOPE, ...s.names]) })));

/** field id -> scope (derived from the sections — one source). */
export const FORMULA_FIELDS = Object.freeze(
  FORMULA_SECTIONS.flatMap((s) => s.ids.map((id) => Object.freeze({ id, section: s.section, scope: s.scope }))));

/**
 * F15: the per-layer stamp transform — layer fields (not P), written by bindLayerOnlyNumber. One row per field:
 * the input id (its slider is `${id}Slider`), the layer field, and the name it adds to its scope.
 */
export const STAMP_TRANSFORM_FIELDS = Object.freeze([
  { id: 'stampTx', field: 'tx', name: 'x', label: 'Layer offset X', unit: IN },
  { id: 'stampTy', field: 'ty', name: 'y', label: 'Layer offset Y', unit: IN },
  { id: 'stampRotation', field: 'rotation', name: 'rotation', label: 'Layer rotation', unit: DEG },
  { id: 'stampScale', field: 'scale', name: 'scale', label: 'Layer scale' },
].map(Object.freeze));

/** The stamp transform's scope: the stock names + the ACTIVE layer's own current transform values (read live). */
export function stampTransformScope(activeLayer) {
  return Object.freeze([...STOCK_SCOPE, ...STAMP_TRANSFORM_FIELDS.map((f) => Object.freeze({
    name: f.name, label: f.label, unit: f.unit || '', get: () => activeLayer()?.[f.field] ?? 0,
  }))]);
}

export function attachFormulaFields(doc = document) {
  FORMULA_FIELDS.forEach(({ id, scope }) => attachFormula(doc.getElementById(id), scope));
}
