export const AppState = {
  preview: null,
  isInitializing: false,
  lastNx: null,
  lastNz: null,
  // The stamp panel's ctx (main/stamp/_shared.js's createStampCtx), set by
  // bindControls once initStampPanel runs. Lets applySnapshot (UX-UNDO/
  // SE5c) call ctx.broadcastSyncFromLayer() to refresh the panel's own
  // inputs after an undo/redo restores per-layer tooling, the same
  // refresh a layer switch triggers.
  stampCtx: null,
};
