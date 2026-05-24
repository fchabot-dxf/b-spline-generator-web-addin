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

// (Previously had a fast-path "scale stale mask by new layerDepth"
// approach for stampDepth. It produced visible overshoot on vbit and
// adaptive because their body-mask shape is depth-dependent: at
// rasterize-time depth=0.8 a vbit pixel at distIn=0.4 has Z_norm=0.5;
// scaled by new layerDepth=2 that's a 1.0″ contribution, but the
// physically-correct vbit at depth=2 with R_eff=0.4 caps at 0.4″.
// User saw this as "drag to max → stamp briefly grows huge → snaps
// back to default-looking depth", which read like a reset.
// Per-tick re-rasterize is slower but stable.)

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

// Hard cap on stock dimensions — matches Ultimate Bee 96"×96" envelope.
// (Lower bound 0.1 prevents degenerate / divide-by-zero rebuilds.)
const STOCK_MIN_IN = 0.1;
const STOCK_MAX_IN = 96;

export function applyParam(key, value) {
  console.log(`[DEBUG] applyParam called: key=${key}, value=${value}`);

  // Clamp stock dimensions BEFORE writing P / echoing UI. Doing this
  // here (not in the input handler) lets the user freely type "7." or
  // "0.5" without the clamp ever fighting them mid-keystroke — values
  // greater than 96 only snap back when the user blurs / commits, at
  // which point syncUItoParam writes the clamped value.
  if (key === 'widthIn' || key === 'heightIn') {
    if (Number.isFinite(value)) {
      value = Math.min(STOCK_MAX_IN, Math.max(STOCK_MIN_IN, value));
    }
  }

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
    if (gridChanged || stampMaskParams.includes(key)) {
      refreshAllStampMasks(nx, nz, AppState.preview, updatePreviewSculptMode);
    } else {
      scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode), delay);
    }
    AppState.lastNx = nx;
    AppState.lastNz = nz;
  }
}
