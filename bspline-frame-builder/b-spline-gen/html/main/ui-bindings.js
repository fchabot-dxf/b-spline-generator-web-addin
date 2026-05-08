import { P, INPUT_PAIRS, SLIDER_PAIRS, lastResult } from '../core/state.js';
import { bind, syncPair } from '../core/ui-utils.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { applyParam, updateSculptToolButtons } from './param-manager.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updatePreviewSculptMode, sculptClear } from '../core/sculpt-interaction.js';
import { fusLog } from '../core/fusion-bridge.js';
import { initStampPanel } from './stamp/index.js';

export function bindControls(preview) {
  Object.keys(P).forEach(key => {
    const inputId = INPUT_PAIRS[key] || key;
    const el = document.getElementById(inputId);
    if (!el) return;

    let type = 'number';
    if (el.tagName === 'SELECT') type = 'select';
    if (el.type === 'checkbox') type = 'checkbox';
    if (el.type === 'text') type = 'string';

    bind(inputId, type, v => applyParam(key, v));
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

  // All stamp-panel controls are now owned by main/stamp/* — one module
  // per slider/control, composed by initStampPanel.
  initStampPanel(preview);

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
