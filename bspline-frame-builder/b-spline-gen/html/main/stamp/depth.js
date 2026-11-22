/**
 * Relief (Raised | Carved) + Height (in) — how far the stamp rises above (+) or is carved into (-) the terrain.
 *
 * LABELS T: the stored value is unchanged — ONE signed `depth` on the layer (+ raised, - carved) with the
 * P.stampDepth mirror. This panel shows it as a magnitude ("Height (in)", #stampHeight / #stampHeightSlider) plus
 * a Raised | Carved toggle. Every edit writes sign * |height| into the hidden signed #stampDepth input and fires its
 * input/change, so the generic binder (ui-bindings.js -> applyParam -> updateP) does exactly what the old "Plunge
 * Depth" control did: P.stampDepth, the editor layer's depth, the rebuild/remask scheduling and the undo step.
 * Loading a board never writes: syncFromLayer only reads the layer's depth into the controls.
 *
 * The mask shape is technically depth-dependent for vbit/adaptive (the slope cap moves with depth), so changing it
 * needs a re-rasterize; ctx.requestDepthChange handles that split (param-manager.js).
 */
import { attachFormula } from '../../core/formula-field.js';
import { FORMULA_FIELDS } from '../formula-fields.js';

export function initDepth(ctx) {
  const byId = (id) => document.getElementById(id);
  const raisedBtn = byId('stampBtnReliefRaised');
  const carvedBtn = byId('stampBtnReliefCarved');
  const heightNum = byId('stampHeight');
  // a formula field on the VECTOR STAMPING scope (main/formula-fields.js): the committed number is the height
  const stampScope = FORMULA_FIELDS.find((f) => f.id === 'stampDepth');
  if (heightNum && stampScope) attachFormula(heightNum, stampScope.scope);
  const heightSld = byId('stampHeightSlider');
  const signedNum = byId('stampDepth');
  let carved = false;

  const showSign = () => {
    raisedBtn?.classList.toggle('active', !carved);
    carvedBtn?.classList.toggle('active', carved);
  };
  const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));
  /** Write sign * |height| to the signed field the generic binder owns. `commit` also fires its change (undo step). */
  const writeSigned = (height, commit) => {
    if (!signedNum || !Number.isFinite(height)) return;
    const magnitude = Math.abs(height);
    signedNum.value = String(carved ? -magnitude : magnitude);
    fire(signedNum, 'input');
    if (commit) fire(signedNum, 'change');
  };

  if (heightNum) {
    heightNum.addEventListener('input', () => {
      const v = parseFloat(heightNum.value);
      if (Number.isNaN(v)) return;                      // mid-edit text: leave it alone
      if (heightSld) heightSld.value = String(Math.abs(v));
      writeSigned(v, false);
    });
    heightNum.addEventListener('change', () => {
      const v = parseFloat(heightNum.value);
      if (Number.isNaN(v)) return;
      if (v < 0) heightNum.value = String(Math.abs(v));  // a typed / computed negative is a magnitude; the toggle owns the sign
      writeSigned(v, true);
    });
  }
  if (heightSld) {
    heightSld.addEventListener('input', () => {
      if (heightNum) heightNum.value = heightSld.value;
      writeSigned(parseFloat(heightSld.value), false);
    });
    heightSld.addEventListener('change', () => writeSigned(parseFloat(heightSld.value), true));
  }
  const pick = (isCarved) => () => {
    if (carved === isCarved) return;
    carved = isCarved;
    showSign();
    writeSigned(parseFloat(heightNum ? heightNum.value : '') || 0, true);
  };
  raisedBtn?.addEventListener('click', pick(false));
  carvedBtn?.addEventListener('click', pick(true));

  const syncVisible = (layer) => {
    const d = layer && layer.depth != null ? layer.depth : ctx.P.stampDepth;
    if (!Number.isFinite(d)) return;
    carved = d < 0;
    showSign();
    if (heightNum && document.activeElement !== heightNum) heightNum.value = String(Math.abs(d));
    if (heightSld) heightSld.value = String(Math.abs(d));
  };

  return ctx.registerSyncs('depth',
    ctx.bindNumberSlider('stampDepth', 'stampDepthSlider', 'depth'),
    syncVisible,
  );
}
