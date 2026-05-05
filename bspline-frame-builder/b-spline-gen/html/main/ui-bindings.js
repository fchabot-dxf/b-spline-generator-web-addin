import { P, SLIDER_PAIRS, lastResult, updateP } from '../core/state.js';
import { bind, syncPair, syncUItoParam } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { updateStampMasks, refreshAllStampMasks } from './stamp-mask-manager.js';
import { applyParam, updateSculptToolButtons } from './param-manager.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updatePreviewSculptMode, sculptClear } from '../core/sculpt-interaction.js';
import { setStampLayerSvg, setStampLayerMask } from '../core/state.js';
import { fusLog } from '../core/fusion-bridge.js';
import { SvgEditorSnapshot } from './app-init.js';

export function bindControls(preview) {
  Object.keys(P).forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;

    let type = 'number';
    if (el.tagName === 'SELECT') type = 'select';
    if (el.type === 'checkbox') type = 'checkbox';
    if (el.type === 'text') type = 'string';

    bind(key, type, v => applyParam(key, v));
  });

  Object.keys(SLIDER_PAIRS).forEach(key => {
    syncPair(key, SLIDER_PAIRS[key]);
  });

  const bindTogglePanel = (id, targetId) => {
    const cb = document.getElementById(id);
    const panel = document.getElementById(targetId);
    if (cb && panel) {
      cb.addEventListener('change', () => {
        panel.style.display = cb.checked ? 'flex' : 'none';
      });
      panel.style.display = cb.checked ? 'flex' : 'none';
    }
  };

  bindTogglePanel('thickenEnabled', 'thickenOptions');

  const bindToolBtn = (btnId, layer, mode) => {
    const btn = document.getElementById(btnId);
    if (btn) {
      btn.addEventListener('click', () => {
        console.log(`[DEBUG] Sculpt ${layer} ${mode} button pressed`);
        applyParam('activeSculptLayer', layer);
        applyParam(layer === 'top' ? 'sculptTopMode' : 'sculptBotMode', mode);
        updateSculptToolButtons();
      });
    }
  };

  updateSculptToolButtons();
  bindToolBtn('btnToolTopDraw', 'top', 'draw');
  bindToolBtn('btnToolTopSmooth', 'top', 'smooth');
  bindToolBtn('btnToolTopNoise', 'top', 'noise');
  bindToolBtn('btnToolTopInflate', 'top', 'inflate');
  bindToolBtn('btnToolTopErase', 'top', 'erase');

  bindToolBtn('btnToolBotDraw', 'bot', 'draw');
  bindToolBtn('btnToolBotSmooth', 'bot', 'smooth');
  bindToolBtn('btnToolBotNoise', 'bot', 'noise');
  bindToolBtn('btnToolBotInflate', 'bot', 'inflate');
  bindToolBtn('btnToolBotErase', 'bot', 'erase');

  document.getElementById('btnSculptTopClear')?.addEventListener('click', () => sculptClear('top', scheduleRebuild));
  document.getElementById('btnSculptBotClear')?.addEventListener('click', () => sculptClear('bot', scheduleRebuild));

  const stampProfile = document.getElementById('stampProfile');
  if (stampProfile) {
    const updateStampUI = () => {
      const container = document.getElementById('vBitAngleContainer');
      if (container) container.style.display = (stampProfile.value === 'vbit' || stampProfile.value === 'adaptive') ? 'block' : 'none';
    };
    stampProfile.addEventListener('change', () => {
      updateStampUI();
      const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
      refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
    });
    updateStampUI();
  }


  const attachNumberSteppers = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
    inputs.forEach(input => {
      if (!input.isConnected) return;
      if (input.classList.contains('no-stepper')) return;
      if (input.closest('label')?.classList.contains('no-stepper')) return;

      // Check if already in a stepper container (legacy)
      if (input.closest('.stepper-container')) return;

      // Check if already in our new cad-stepper
      let wrapper = input.closest('.cad-stepper');
      
      // If it exists but already has buttons, skip
      if (wrapper && wrapper.querySelectorAll('button').length > 0) return;

      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'cad-stepper';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input); // move input INTO the wrapper
      }

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';

      const step = Number(input.step) || 1;
      const min = input.min !== '' ? Number(input.min) : -Infinity;
      const max = input.max !== '' ? Number(input.max) : Infinity;

      const clamp = (value) => {
        if (!Number.isFinite(value)) return input.value;
        return Math.min(max, Math.max(min, value));
      };

      const adjust = (delta) => {
        const current = Number(input.value);
        const next = Number.isFinite(current) ? current + delta : delta;
        input.value = clamp(Number(next.toFixed(10)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      minus.addEventListener('click', () => adjust(-step));
      plus.addEventListener('click', () => adjust(step));

      // Order: [-] [input] [+]
      wrapper.insertBefore(minus, input);
      wrapper.appendChild(plus);
    });
  };

  attachNumberSteppers();

  // Helper used here and by the active-layer handler below — keeps the
  // "On" checkbox in sync with the layer's `enabled` flag whenever
  // upload/clear toggles it implicitly.
  const syncLayerEnabledCheckbox = () => {
    const cb = document.getElementById('stampLayerEnabled');
    if (!cb) return;
    const layer = P.stampLayers && P.stampLayers[P.activeLayerIdx];
    cb.checked = !!(layer && layer.enabled);
  };

  const btnStampChoose = document.getElementById('btnStampChoose');
  const stampUpload = document.getElementById('stampUpload');
  if (btnStampChoose && stampUpload) {
    btnStampChoose.addEventListener('click', () => stampUpload.click());
    stampUpload.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const fileNameSpan = document.getElementById('stampFileName');
      if (fileNameSpan) fileNameSpan.textContent = file.name;
      const text = await file.text();
      setStampLayerSvg(P.activeLayerIdx, text);
      syncLayerEnabledCheckbox();
      const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
      refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
    });
  }

  const btnStampClear = document.getElementById('btnStampClear');
  if (btnStampClear) {
    btnStampClear.addEventListener('click', () => {
      setStampLayerSvg(P.activeLayerIdx, null);
      setStampLayerMask(P.activeLayerIdx, null);
      // Mirror setStampLayerSvg's auto-enable: clearing should disable the layer
      // so re-uploading is what re-enables it (matching the assign path).
      if (P.stampLayers[P.activeLayerIdx]) P.stampLayers[P.activeLayerIdx].enabled = false;
      syncLayerEnabledCheckbox();
      const fileNameSpan = document.getElementById('stampFileName');
      if (fileNameSpan) fileNameSpan.textContent = 'No file chosen';
      scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
    });
  }

  const btnStampEdit = document.getElementById('btnStampEdit');
  if (btnStampEdit) {
    btnStampEdit.addEventListener('click', () => {
      const modal = document.getElementById('svgEditorModal');
      if (modal) {
        modal.style.display = 'flex';
        const currentLayer = P.stampLayers[P.activeLayerIdx];
        // Capture pre-edit snapshot so Cancel can actually undo. onChange
        // will overwrite the layer's svg/mask while the user types — we
        // need to remember what to roll back to.
        if (currentLayer) {
          SvgEditorSnapshot.active = true;
          SvgEditorSnapshot.layerIdx = P.activeLayerIdx;
          SvgEditorSnapshot.svg = currentLayer.svg;
          SvgEditorSnapshot.mask = currentLayer.mask;
          SvgEditorSnapshot.enabled = !!currentLayer.enabled;
        }
        if (window.svgEditor && currentLayer) window.svgEditor.open(currentLayer.svg, P.widthIn, P.heightIn);
      }
    });
  }

  const stampActiveLayer = document.getElementById('stampActiveLayer');
  const stampLayerEnabled = document.getElementById('stampLayerEnabled');

  // Populate the active-layer dropdown from the current layer names.
  // Driven by P.stampLayers so adding/renaming a layer in state.js
  // doesn't require touching the HTML.
  if (stampActiveLayer && Array.isArray(P.stampLayers)) {
    stampActiveLayer.innerHTML = '';
    P.stampLayers.forEach((layer, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = layer.name || `Layer ${i + 1}`;
      stampActiveLayer.appendChild(opt);
    });
    stampActiveLayer.value = String(P.activeLayerIdx || 0);
  }

  // Reflect the active layer's `enabled` flag in the checkbox.
  syncLayerEnabledCheckbox();

  if (stampLayerEnabled) {
    stampLayerEnabled.addEventListener('change', () => {
      const layer = P.stampLayers && P.stampLayers[P.activeLayerIdx];
      if (!layer) return;
      layer.enabled = stampLayerEnabled.checked;
      // Mask doesn't need recomputing — only the apply step in engine.js
      // gates on layer.enabled. A plain rebuild is enough.
      scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
    });
  }

  if (stampActiveLayer) {
    stampActiveLayer.addEventListener('change', () => {
      const idx = parseInt(stampActiveLayer.value, 10);
      updateP('activeLayerIdx', idx);
      const layer = P.stampLayers[idx];
      if (layer) {
        syncUItoParam('stampDepth',               layer.depth);
        syncUItoParam('stampProfile',             layer.profile);
        syncUItoParam('stampVBitAngle',           layer.angle);
        syncUItoParam('stampBlur',                layer.blur);
        syncUItoParam('stampSmoothingRadius',     layer.smoothing);
        syncUItoParam('stampTextureSuppression',  layer.suppression);
        syncUItoParam('stampEdgeFilletRadius',    layer.edgeFilletRadius);
        syncUItoParam('stampFilletPower',         layer.filletPower);
        syncLayerEnabledCheckbox();

        const vBitAngleContainer = document.getElementById('vBitAngleContainer');
        if (vBitAngleContainer) {
          vBitAngleContainer.style.display = (layer.profile === 'vbit' || layer.profile === 'adaptive') ? 'block' : 'none';
        }

        const fileNameSpan = document.getElementById('stampFileName');
        if (fileNameSpan) fileNameSpan.textContent = layer.svg ? 'Loaded' : 'No file chosen';

        if (window.svgEditor) {
          window.svgEditor.open(layer.svg || '', P.widthIn, P.heightIn);
        }
      }
    });
  }

  const btnAutoThickenThin = document.getElementById('btnAutoThickenThin');
  if (btnAutoThickenThin) {
    btnAutoThickenThin.addEventListener('click', () => {
      fusLog('Auto Thicken Thin Parts triggered');
      scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
    });
  }

  const btnUseMaxSafe = document.getElementById('btnUseMaxSafe');
  if (btnUseMaxSafe) {
    btnUseMaxSafe.addEventListener('click', () => {
      const maxSafe = lastResult?.thickenData?.maxSafe || 0;
      if (maxSafe > 0) applyParam('thickness', parseFloat(maxSafe.toFixed(3)));
    });
  }
}
