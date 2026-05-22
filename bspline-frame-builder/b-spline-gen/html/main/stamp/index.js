/**
 * Stamp panel composition root. Replaces the inline stamp section that
 * used to live in `ui-bindings.js`. Each per-control file is responsible
 * for its own DOM wiring; this file just wires them all together with a
 * shared ctx.
 *
 * Order matters in two places:
 *   1. layer.js is initialized BEFORE svg-source.js because Browse/Clear
 *      need to call back into layer.js's syncEnabled to keep the
 *      "Enabled" checkbox in sync with the auto-enable behavior.
 *   2. profile-control.js comes early so the dropdown is populated
 *      before the active-layer handler tries to set its value.
 *
 * This file does NOT bind the basic input → applyParam path — that's
 * still handled by the generic `bindControls` in ui-bindings.js, which
 * iterates Object.keys(P) and binds each control. These modules add
 * the stamp-specific UI logic on top of that.
 */
import { createStampCtx } from './_shared.js';
import { initDepth } from './depth.js';
import { initProfileControl } from './profile-control.js';
import { initLayer } from './layer.js';
import { initSvgSource } from './svg-source.js';
import { initBlur } from './blur.js';
import { initSmoothing } from './smoothing.js';
import { initSuppression } from './suppression.js';
import { initFillet } from './fillet.js';
import { initTransform } from './transform.js';
import { initMetrics } from './metrics.js';

export function initStampPanel(preview) {
  const ctx = createStampCtx(preview);

  // Single-control modules first.
  initDepth(ctx);
  initBlur(ctx);
  initSmoothing(ctx);
  initSuppression(ctx);
  initFillet(ctx);
  initTransform(ctx);
  initMetrics(ctx);

  // Profile-control before layer so the dropdown is populated when the
  // initial active-layer sync fires.
  initProfileControl(ctx);

  // Layer is the orchestrator: its change handler calls
  // ctx.broadcastSyncFromLayer to push the new layer's values to every
  // other module.
  const layerModule = initLayer(ctx);

  // SVG source after layer so it can call back into layer.syncEnabled.
  initSvgSource(ctx, layerModule);

  return ctx;
}
