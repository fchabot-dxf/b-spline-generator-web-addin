/**
 * Composition root for the stamp panel's `ctx`. One ctx is created per
 * panel init and passed to every per-control module. The ctx itself is
 * intentionally thin — it owns three pieces of UI state (state accessors,
 * a module registry, and the current preview reference) and composes
 * the heavier behaviour from `_update-scheduler.js` and `_dom-binders.js`.
 *
 * Per-control modules use ctx to:
 *   - read the active layer + grid (state accessors)
 *   - schedule rebuilds / remasks (update scheduler)
 *   - bind their DOM controls (dom binders)
 *   - register themselves so the layer-switch handler can broadcast
 *     a syncFromLayer to every module in one shot (registry)
 */
import { P } from '../../core/state.js';
import { resolveGrid } from '../../core/terrain.js';
import { createUpdateScheduler } from './_update-scheduler.js';
import { createDomBinders } from './_dom-binders.js';

export function createStampCtx(preview) {
  const modules = [];   // each: { syncFromLayer?: (layer) => void }

  // ─── State accessors ──────────────────────────────────────────────
  const activeLayer = () => (P.stampLayers ? P.stampLayers[P.activeLayerIdx] : undefined);
  const grid = () => resolveGrid(P.widthIn, P.heightIn, P.spacing);
  const isFilletActive = () => {
    if ((P.stampEdgeFilletRadius || 0) > 0) return true;
    if (!Array.isArray(P.stampLayers)) return false;
    return P.stampLayers.some((L) => L && (L.edgeFilletRadius || 0) > 0 && L.enabled !== false);
  };

  // ─── Composed behaviour ───────────────────────────────────────────
  const scheduler = createUpdateScheduler({ preview, grid, isFilletActive });
  const binders = createDomBinders({ activeLayer, requestRemask: scheduler.requestRemask });

  // ─── Registry ─────────────────────────────────────────────────────
  const registerModule = (mod) => {
    if (mod) modules.push(mod);
    return mod;
  };

  /** Convenience wrapper for the common case: a module whose only job is
   *  to combine a few bind* sync fns. Composes them into a single
   *  syncFromLayer and registers. Use registerModule directly if the
   *  module needs extra fields (e.g., layer.js exposes syncEnabled). */
  const registerSyncs = (id, ...syncs) => registerModule({
    id,
    syncFromLayer(layer) {
      for (const s of syncs) if (s) s(layer);
    },
  });

  /** Push the active layer's values out to every registered module's UI. */
  const broadcastSyncFromLayer = () => {
    const layer = activeLayer();
    modules.forEach((m) => {
      if (m && typeof m.syncFromLayer === 'function') m.syncFromLayer(layer);
    });
  };

  return {
    preview,
    P,
    activeLayer,
    grid,
    isFilletActive,
    registerModule,
    registerSyncs,
    broadcastSyncFromLayer,
    ...scheduler,
    ...binders,
  };
}
