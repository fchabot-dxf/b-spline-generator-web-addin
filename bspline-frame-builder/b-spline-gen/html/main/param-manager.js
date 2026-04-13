import { P, updateP } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { scheduleRebuild, rebuild, updateEditorTopView } from '../core/engine.js';
import { updateStampMasks, refreshAllStampMasks } from './stamp-mask-manager.js';
import { AppState } from './app-state.js';

const immediateRebuildParams = [
  'widthIn', 'heightIn', 'spacing', 'seed', 'noiseType',
  'symmetry', 'carveZ', 'scale', 'macroScale', 'warpIntensity',
  'thickenEnabled', 'thickness', 'thickenDir', 'thickenMode',
  'edgeMarginIn', 'stampDepth', 'stampBlur', 'stampSmoothingRadius',
  'stampEdgeFilletRadius', 'stampFilletPower', 'stampProfile'
];

const stampMaskParams = [
  'stampBlur', 'stampSmoothingRadius',
  'stampEdgeFilletRadius', 'stampFilletPower',
  'stampProfile', 'stampVBitAngle'
];

export function updateSculptToolButtons() {
  const ids = ['btnToolTopDraw', 'btnToolTopSmooth', 'btnToolBotDraw', 'btnToolBotSmooth'];
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

  if (key === 'showMesh') {
    AppState.preview?.setCurvesVisible(value);
  }

  if (key === 'thickenEnabled') {
    const thickenCon = document.getElementById('thickenOptions');
    if (thickenCon) thickenCon.style.display = value ? 'flex' : 'none';
  }

  if (key === 'thickenWireframe') {
    scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), 0);
  }

  if (key === 'stampProfile') {
    const vBitExtra = document.getElementById('vBitAngleContainer');
    if (vBitExtra) vBitExtra.style.display = (value === 'vbit' || value === 'adaptive') ? 'block' : 'none';
  }

  const delay = immediateRebuildParams.includes(key) ? 0 : 200;
  if (!AppState.isInitializing) {
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    if (nx !== AppState.lastNx || nz !== AppState.lastNz || stampMaskParams.includes(key)) {
      refreshAllStampMasks(nx, nz, AppState.preview, updatePreviewSculptMode, updateEditorTopView);
    } else {
      scheduleRebuild(() => rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), delay);
    }
    AppState.lastNx = nx;
    AppState.lastNz = nz;
  }
}
