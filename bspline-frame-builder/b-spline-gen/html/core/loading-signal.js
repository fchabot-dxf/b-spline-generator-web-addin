/**
 * core/loading-signal.js — F35 item 16 follow-up (Fred: with the heavier geometry now possible
 * (brick generation, the height-mask pass, Masonry/Masonry max rebuilds at 4-8s), the existing
 * loading signal must cover them too -- reuse it, don't invent a new one). Reuses
 * core/fusion-bridge.js's own `setFusionStatus` -- already the app's one reusable status-line
 * surface (see main/export-flow.js's own `_reportDeclinedOutlines`, a non-Fusion-specific warning
 * routed through the same line) -- rather than a second status UI.
 *
 * Stages are declared data (LOADING_STAGES below), not a hand-rolled label per call site: a future
 * slow operation (e.g. the queued Flat-mode per-brick plane fit) is one more entry here, not a new
 * mechanism.
 *
 * `withLoadingStage(stageId, fn, ctx)` only shows the stage's own label if `fn` is STILL running
 * after SHOW_THRESHOLD_MS (250ms, Fred's own number) -- no flicker for the common fast case. Showing
 * it at all requires the awaited work to actually yield control back to the event loop at least once
 * during that window -- a fully synchronous `fn` blocks the pending timer along with everything else.
 * The operations this wraps already do: rebuild()'s own existing per-phase `yieldToMain` calls, and
 * rasterizeBrickHeightMask's new per-row yield (editor/editor-brick-height-mask.js).
 */
import { setFusionStatus } from './fusion-bridge.js';

const SHOW_THRESHOLD_MS = 250;

/** `label` is a plain string, or a function of the optional `ctx` passed to withLoadingStage (e.g.
 *  the current resolution's own value, for "Building surface 0.015″…"). */
export const LOADING_STAGES = {
  bricks: { label: 'Laying bricks…' },
  heightMask: { label: 'Carving relief…' },
  rebuild: { label: (ctx) => `Building surface${ctx?.spacing != null ? ` ${ctx.spacing}″` : ''}…` },
};

export async function withLoadingStage(stageId, fn, ctx) {
  const stage = LOADING_STAGES[stageId];
  const label = stage ? (typeof stage.label === 'function' ? stage.label(ctx) : stage.label) : null;
  let shown = false;
  const timer = label ? setTimeout(() => { shown = true; setFusionStatus(label, 'busy'); }, SHOW_THRESHOLD_MS) : null;
  try {
    return await fn();
  } finally {
    if (timer) clearTimeout(timer);
    // Only clear if THIS stage actually showed something -- a fast call that never crossed the
    // threshold must never blank out a message some OTHER status write put up in the meantime.
    if (shown) setFusionStatus('', 'busy');
  }
}
