import { P, updateP } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updateStampMasks, refreshAllStampMasks } from './stamp-mask-manager.js';
import { AppState } from './app-state.js';

const immediateRebuildParams = [
  'widthIn', 'heightIn', 'spacing', 'seed', 'noiseType',
  'seedType', 'seedOffsetX', 'seedOffsetY', 'seedRotation',
  'symmetry', 'symOffsetX', 'symOffsetY', 'carveZ', 'scale', 'macroScale', 'warpIntensity',
  'peakShape', 'density', 'clustering',
  'thickenEnabled', 'thickness', 'thickenDir', 'thickenMode',
  'edgeMarginIn', 'stampDepth', 'stampBlur', 'stampSmoothingRadius',
  'stampEdgeFilletRadius', 'stampFilletPower', 'stampProfile',
  'isolateSkeleton'
];

// Params that change the rasterized mask itself (require re-rasterize).
// stampDepth IS here despite the "depth-independent mask" comment in stamp.js
// — that comment is true only for flat/ballnose. vbit's slope cap is at
// distIn = maxDepth/vSlope, adaptive's outer ramp width = maxDepth/1.3032,
// and the fillet's rampPhysicalHeight clamp uses maxDepth — so changing
// the depth slider actually changes the mask SHAPE for those profiles.
// stampSmoothingRadius is NOT here — it's only consumed by engine.js when
// blending stamped pixels with smoothed terrain; the mask itself is
// independent of it.
const stampMaskParams = [
  'stampBlur',
  'stampEdgeFilletRadius', 'stampFilletPower',
  'stampProfile', 'stampVBitAngle', 'stampDepth'
];

// Params where the mask SHAPE is depth-dependent (vbit/adaptive/fillet),
// but where it's far better UX to repaint immediately with the existing
// mask scaled by the new depth and re-rasterize only after the slider
// settles. Without this, dragging the depth slider feels jumpy because
// each tick triggers a 50–100ms rasterize and intermediate ticks get
// dropped by the in-flight cancellation. Adaptive feels worst because
// its outer ramp width also scales with depth — each "skipped" frame
// is a visibly bigger jump than for flat/vbit.
const debouncedMaskParams = new Set(['stampDepth']);
let _debouncedMaskTimer = null;
function scheduleDebouncedMaskRefresh(nx, nz) {
  clearTimeout(_debouncedMaskTimer);
  _debouncedMaskTimer = setTimeout(() => {
    refreshAllStampMasks(nx, nz, AppState.preview, updatePreviewSculptMode);
  }, 180);
}

export function updateSculptToolButtons() {
  const ids = [
    'btnToolTopDraw', 'btnToolTopSmooth', 'btnToolTopNoise', 'btnToolTopInflate', 'btnToolTopErase',
    'btnToolBotDraw', 'btnToolBotSmooth', 'btnToolBotNoise', 'btnToolBotInflate', 'btnToolBotErase'
  ];
  ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
  if (!P.activeSculptLayer) return;

  const layerName = P.activeSculptLayer.charAt(0).toUpperCase() + P.activeSculptLayer.slice(1);
  const mode = P.activeSculptLayer === 'top' ? P.sculptTopMode : P.sculptBotMode;
  const activeId = `btnTool${layerName}${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
  document.getElementById(activeId)?.classList.add('active');
}

export function applyParam(key, value) {
  console.log(`[DEBUG] applyParam called: key=${key}, value=${value}`);
  updateP(key, value);
  syncUItoParam(key, value);

  if (key === 'widthIn' || key === 'heightIn') {
    updateSpacingLabels(P.widthIn, P.heightIn);
  }

  if (key === 'activeSculptLayer' || key === 'sculptTopMode' || key === 'sculptBotMode') {
    console.log(`[DEBUG] applyParam triggers updatePreviewSculptMode: key=${key}, value=${value}`);
    updatePreviewSculptMode(AppState.preview, scheduleRebuild);
    updateSculptToolButtons();
  }

  // Live-update sculpt mirror axes when symmetry or its offsets change.
  if (key === 'symmetry' || key === 'symOffsetX' || key === 'symOffsetY') {
    updatePreviewSculptMode(AppState.preview, scheduleRebuild);
  }

  if (key === 'showMesh') {
    AppState.preview?.setCurvesVisible(value);
  }

  if (key === 'thickenEnabled') {
    const thickenCon = document.getElementById('thickenOptions');
    if (thickenCon) thickenCon.style.display = value ? 'flex' : 'none';
  }

  if (key === 'thickenWireframe') {
    scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode), 0);
  }

  if (key === 'stampProfile') {
    const vBitExtra = document.getElementById('vBitAngleContainer');
    if (vBitExtra) vBitExtra.style.display = (value === 'vbit' || value === 'adaptive') ? 'block' : 'none';
  }

  const delay = immediateRebuildParams.includes(key) ? 0 : 200;
  if (!AppState.isInitializing) {
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    const gridChanged = nx !== AppState.lastNx || nz !== AppState.lastNz;
    if (debouncedMaskParams.has(key) && !gridChanged) {
      // Fast path: repaint immediately with the existing mask scaled by
      // the new depth (engine multiplies normVal by layerDepth, so even
      // a stale mask scales proportionally and looks smooth). Re-rasterize
      // for an accurate mask shape only after the user stops dragging.
      scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode), 0);
      scheduleDebouncedMaskRefresh(nx, nz);
    } else if (gridChanged || stampMaskParams.includes(key)) {
      refreshAllStampMasks(nx, nz, AppState.preview, updatePreviewSculptMode);
    } else {
      scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode), delay);
    }
    AppState.lastNx = nx;
    AppState.lastNz = nz;
  }
}
