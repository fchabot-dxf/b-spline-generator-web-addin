/**
 * properties-stripe.js — F27 item 3: the STRIPE tool's panel (#editorStripePanel, shown only while the stripe tool
 * is active; editor-ui.js TOOLBAR_GROUPS, editor-drawer.js TOOL_PANELS). The tool itself is editor-stripe-tool.js.
 *
 *   Count / Length -- "same interplay as the Rails spacing/count fields: set one, the other follows". The field
 *     set last DRIVES (`settings.drive`); the other one FOLLOWS, shown greyed, for the line under the pointer (and,
 *     after a tap, the line just striped): a stripe's size only exists relative to a line. Neither snaps for
 *     colour reasons (Fred: "I don't really care if colours don't end the same as start"); both are held to the
 *     stroke width (Fred: "The only distance it should use is the stroke width").
 *   Colours A / B / C -- C is optional, off by default. Each swatch shows the ACTIVE layer's lattice
 *     Rails/Ties/Nodes colour for that slot until a colour is picked (then it is fixed; ↺ goes back to the
 *     lattice's). A line on a layer with no lattice defaults to black / white (/ grey), Fred's stripe image.
 */
import { el, on } from './dom.js';
import { openColorMosaic } from './editor-color.js';
import { getLayerPattern } from './editor-lattice-pattern.js';
import { stripeSettings, stripeCountFor, defaultStripeColors } from './editor-stripe-tool.js';

const fmtLen = (v) => (Math.round(v * 1000) / 1000).toString();

export function initStripeProperties(editor) {
  const countEl = el('stripeCount');
  const lengthEl = el('stripeLength');
  const threeEl = el('stripeThree');
  const resetEl = el('stripeColorsReset');
  const swatches = [el('stripeColorA'), el('stripeColorB'), el('stripeColorC')];
  if (!countEl || !lengthEl) return; // panel not in this host
  let plan = null; // the last line hovered / striped: what the follower field is computed against

  const settings = () => stripeSettings(editor);

  function refreshFields() {
    const s = settings();
    const driveCount = s.drive !== 'length';
    countEl.style.color = driveCount ? '' : '#888';
    lengthEl.style.color = driveCount ? '#888' : '';
    if (driveCount) {
      countEl.value = s.count;
      lengthEl.value = plan ? fmtLen(plan.length / stripeCountFor(s, plan.length, plan.minLength)) : '';
    } else {
      lengthEl.value = s.length;
      countEl.value = plan ? stripeCountFor(s, plan.length, plan.minLength) : '';
    }
  }

  function paintSwatches() {
    const s = settings();
    let pattern = null;
    try { pattern = getLayerPattern(editor); } catch (_) { /* no layers yet */ }
    const defaults = defaultStripeColors(pattern);
    swatches.forEach((btn, i) => {
      if (!btn) return;
      btn.style.background = s.colors[i] || defaults[i];
      btn.title = `Colour ${'ABC'[i]}${s.colors[i] ? '' : ' (lattice default)'}`;
    });
    if (swatches[2]) {
      swatches[2].disabled = !s.three;
      swatches[2].style.opacity = s.three ? '1' : '0.35';
    }
    if (threeEl) threeEl.checked = !!s.three;
  }

  on(countEl, 'input', () => {
    const n = parseInt(countEl.value, 10);
    if (!(n >= 1)) return;
    Object.assign(settings(), { drive: 'count', count: n });
    refreshFields();
  });
  on(lengthEl, 'input', () => {
    const v = parseFloat(lengthEl.value);
    if (!(v > 0)) return;
    Object.assign(settings(), { drive: 'length', length: v });
    refreshFields();
  });
  // on commit (blur/Enter) the follower settles and the driver shows its own clean value
  on(countEl, 'change', refreshFields);
  on(lengthEl, 'change', refreshFields);
  if (threeEl) on(threeEl, 'change', () => { settings().three = threeEl.checked; paintSwatches(); });
  swatches.forEach((btn, i) => {
    if (!btn) return;
    on(btn, 'click', (e) => {
      e.stopPropagation();
      openColorMosaic(btn, (hex) => { settings().colors[i] = hex; paintSwatches(); });
    });
  });
  if (resetEl) on(resetEl, 'click', () => { settings().colors = [null, null, null]; paintSwatches(); });

  if (typeof document !== 'undefined') {
    document.addEventListener('editorStripeTarget', (e) => {
      if (!e.detail || e.detail.editor !== editor) return;
      plan = e.detail.plan;
      refreshFields();
    });
    document.addEventListener('editorModeChanged', (e) => {
      if (!e.detail || e.detail.editor !== editor || e.detail.mode !== 'stripe') return;
      paintSwatches(); // the active layer (so the lattice default colours) may have changed since last time
      refreshFields();
    });
  }
  paintSwatches();
  refreshFields();
}
