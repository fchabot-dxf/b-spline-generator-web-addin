/**
 * properties-stripe.js — F27 item 3: the STRIPE tool's panel (#editorStripePanel, shown only while the stripe tool
 * is active; editor-ui.js TOOLBAR_GROUPS, editor-drawer.js TOOL_PANELS). The tool itself is editor-stripe-tool.js.
 *
 *   Count / Length -- a switch (Fred: "just make it a switch no readout"): `settings.drive` picks one, and only that
 *     field shows. By Count every line gets that many equal stripes; by Length as many as fit at about that
 *     length (the old greyed "follower" field, computed for the line under the pointer, is gone). Neither snaps for
 *     colour reasons (Fred: "I don't really care if colours don't end the same as start"); both are held to the
 *     stroke width (Fred: "The only distance it should use is the stroke width").
 *   Colours A / B / C -- C is optional, off by default. Each swatch shows the ACTIVE layer's lattice
 *     Rails/Ties/Nodes colour for that slot until a colour is picked (then it is fixed; ↺ goes back to the
 *     lattice's). A line on a layer with no lattice defaults to black / white (/ grey), Fred's stripe image.
 */
import { el, on } from './dom.js';
import { openColorMosaic } from './editor-color.js';
import { getLayerPattern } from './editor-lattice-pattern.js';
import { stripeSettings, defaultStripeColors } from './editor-stripe-tool.js';

const fmtLen = (v) => (Math.round(v * 1000) / 1000).toString();

export function initStripeProperties(editor) {
  const countEl = el('stripeCount');
  const lengthEl = el('stripeLength');
  const threeEl = el('stripeThree');
  const resetEl = el('stripeColorsReset');
  const swatches = [el('stripeColorA'), el('stripeColorB'), el('stripeColorC')];
  if (!countEl || !lengthEl) return; // panel not in this host
  const byCountEl = el('stripeByCount');
  const byLengthEl = el('stripeByLength');
  const countRowEl = el('stripeCountRow');
  const lengthRowEl = el('stripeLengthRow');

  const settings = () => stripeSettings(editor);

  function refreshFields() {
    const s = settings();
    const driveCount = s.drive !== 'length';
    if (byCountEl) byCountEl.classList.toggle('active', driveCount);
    if (byLengthEl) byLengthEl.classList.toggle('active', !driveCount);
    if (countRowEl) countRowEl.style.display = driveCount ? 'flex' : 'none';
    if (lengthRowEl) lengthRowEl.style.display = driveCount ? 'none' : 'flex';
    if (document.activeElement !== countEl) countEl.value = s.count;
    if (document.activeElement !== lengthEl) lengthEl.value = fmtLen(Number(s.length) || 0);
  }
  if (byCountEl) on(byCountEl, 'click', () => { settings().drive = 'count'; refreshFields(); });
  if (byLengthEl) on(byLengthEl, 'click', () => { settings().drive = 'length'; refreshFields(); });

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
    document.addEventListener('editorModeChanged', (e) => {
      if (!e.detail || e.detail.editor !== editor || e.detail.mode !== 'stripe') return;
      paintSwatches(); // the active layer (so the lattice default colours) may have changed since last time
      refreshFields();
    });
  }
  paintSwatches();
  refreshFields();
}
