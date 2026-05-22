/**
 * Update-request shortcuts for stamp-panel modules. Each kind of UI
 * change maps to one of these so per-control modules don't have to know
 * about scheduleRebuild / refreshAllStampMasks directly.
 *
 *   - requestRebuild       cheapest: rebuild the mesh from existing masks.
 *   - requestRemask        re-rasterize all masks AND rebuild. Use when
 *                          the mask shape changed (profile, blur, fillet,
 *                          vbit angle, depth shape).
 *   - requestDepthChange   instant rebuild + smart remask: immediate when
 *                          fillet is active (the fillet zone needs the
 *                          up-to-date mask to stay continuous), debounced
 *                          180ms otherwise so dragging the slider stays
 *                          smooth.
 *
 * Owns the debounce timer for requestDepthChange.
 */
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks, refreshAllStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';
import { AppState } from '../app-state.js';

export function createUpdateScheduler({ preview, grid, isFilletActive }) {
  let debouncedMaskTimer = null;

  const rasterizeAll = (nx, nz) => {
    refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
    AppState.lastNx = nx;
    AppState.lastNz = nz;
  };

  const requestRebuild = () => {
    scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
  };

  const requestRemask = () => {
    const { nx, nz } = grid();
    rasterizeAll(nx, nz);
  };

  const requestDepthChange = () => {
    const { nx, nz } = grid();
    requestRebuild();
    if (isFilletActive()) {
      rasterizeAll(nx, nz);
    } else {
      clearTimeout(debouncedMaskTimer);
      debouncedMaskTimer = setTimeout(() => rasterizeAll(nx, nz), 180);
    }
  };

  return { requestRebuild, requestRemask, requestDepthChange };
}
