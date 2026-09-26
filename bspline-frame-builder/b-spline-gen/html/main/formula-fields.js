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
 * Deliberately NOT here (see WORK-LOG-reg-addin.md, R2): seed (an integer id, not a quantity), the FRAME section
 * (seat C), the per-layer stamp transform (tx/ty/rotation/scale — own layer-only binder, not bind()), the sculpt
 * "hardness" fields (not in P), the lattice/editor panels (R3, frozen for seat A's UI5).
 */
import { P } from '../core/state.js';
import { attachFormula } from '../core/formula-field.js';

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
    section: 'SEED',
    ids: ['macroScale', 'seedOffsetX', 'seedOffsetY', 'seedRotation'],
    names: [
      pname('region', 'macroScale', 'Region scale'),
      pname('offsetx', 'seedOffsetX', 'Seed offset X'),
      pname('offsety', 'seedOffsetY', 'Seed offset Y'),
      pname('rotation', 'seedRotation', 'Seed rotation', DEG),
    ],
  },
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
    section: 'SCULPT TOP',
    ids: ['sculptTopRadius', 'sculptTopNoiseScale'],
    names: [pname('brush', 'sculptTopRadius', 'Brush size'), pname('noise', 'sculptTopNoiseScale', 'Noise scale')],
  },
  {
    section: 'THICKEN',
    ids: ['thickenOffset'],
    names: [pname('thickness', 'thickness', 'Offset (thickness)', IN)],
  },
  {
    section: 'SCULPT BOTTOM',
    ids: ['sculptBotRadius', 'sculptBotNoiseScale'],
    names: [pname('brush', 'sculptBotRadius', 'Brush size'), pname('noise', 'sculptBotNoiseScale', 'Noise scale')],
  },
].map((s) => Object.freeze({ ...s, scope: Object.freeze([...STOCK_SCOPE, ...s.names]) })));

/** field id -> scope (derived from the sections — one source). */
export const FORMULA_FIELDS = Object.freeze(
  FORMULA_SECTIONS.flatMap((s) => s.ids.map((id) => Object.freeze({ id, section: s.section, scope: s.scope }))));

export function attachFormulaFields(doc = document) {
  FORMULA_FIELDS.forEach(({ id, scope }) => attachFormula(doc.getElementById(id), scope));
}
