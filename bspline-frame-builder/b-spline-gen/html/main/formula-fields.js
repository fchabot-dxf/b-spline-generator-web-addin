/**
 * formula-fields.js — FORMULA-FIELDS (R1 item 5): which sidebar number fields accept formulas, and the names each
 * one can use. DECLARED here; core/formula-field.js does the binding, core/formula.js the evaluation.
 *
 * Stage 1 proves the widget on the STOCK DIMENSIONS pair: their handler is the generic bind() -> applyParam path
 * (main/ui-bindings.js), outside the files frozen for seat A's UI5. The lattice panels get their own scopes in R2.
 */
import { P } from '../core/state.js';
import { attachFormula } from '../core/formula-field.js';

/** Names every stock-dimension field can reference — current values read live from P. */
export const STOCK_SCOPE = Object.freeze([
  { name: 'width', label: 'Stock width (X)', get: () => P.widthIn, unit: '"' },
  { name: 'height', label: 'Stock height (Y)', get: () => P.heightIn, unit: '"' },
  { name: 'depth', label: 'Carve depth (Z)', get: () => P.carveZ, unit: '"' },
]);

/** field id -> scope declaration. */
export const FORMULA_FIELDS = Object.freeze([
  { id: 'widthIn', scope: STOCK_SCOPE },
  { id: 'heightIn', scope: STOCK_SCOPE },
]);

export function attachFormulaFields(doc = document) {
  FORMULA_FIELDS.forEach(({ id, scope }) => attachFormula(doc.getElementById(id), scope));
}
