import { P, INPUT_PAIRS, SLIDER_PAIRS, lastResult } from '../core/state.js';
import { bind, syncPair } from '../core/ui-utils.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { applyParam, updateSculptToolButtons } from './param-manager.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updatePreviewSculptMode, sculptClear } from '../core/sculpt-interaction.js';
import { fusLog } from '../core/fusion-bridge.js';
import { initStampPanel } from './stamp/index.js';
import { AppState } from './app-state.js';
import { scheduleUndoSnapshot } from '../core/history.js';
import { attachSliderScrollGuard } from './slider-scroll-guard.js';
import { attachFormulaFields } from './formula-fields.js';

export function bindControls(preview) {
  // UX-UNDO: the layer row's 👁/3D/palette toggles (editor/layers.js —
  // shared between the sidebar and the SVG editor's own Layers panel)
  // commit via setLayerVisible/Carve/ShowColor directly, not through
  // bind()/the stamp-panel binders, so they dispatch this CustomEvent
  // instead of importing core/history.js themselves (that file already
  // imports FROM editor/layers.js for TOOLING_DEFAULTS — importing back
  // would be circular). scheduleUndoSnapshot's own isEditorOpen() gate
  // still applies, so a toggle flipped from inside the editor modal
  // goes through the editor's own undo stack only, per the ROADMAP
  // ruling ("undo follows where the change was made").
  document.addEventListener('layer-tooling-commit', (e) => {
    scheduleUndoSnapshot('layer:' + (e.detail && e.detail.field));
  });

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
    syncPair(INPUT_PAIRS[key] || key, SLIDER_PAIRS[key]);
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
        // Fred (option 3): picking a tool turns Sculpt on; tapping the tool that is already on turns it off
        const cur = layer === 'top' ? P.sculptTopMode : P.sculptBotMode;
        if (P.activeSculptLayer === layer && cur === mode) { sculptOff(); return; }
        applyParam('activeSculptLayer', layer);
        applyParam(layer === 'top' ? 'sculptTopMode' : 'sculptBotMode', mode);
        updateSculptToolButtons();
      });
    }
  };

  // Fred (option 3): Sculpt is only on while you are in its panel. It turns itself off when that panel is closed,
  // or when another page opens (the drawing editor, Settings, Projects).
  const sculptOff = () => { if (P.activeSculptLayer) { applyParam('activeSculptLayer', null); updateSculptToolButtons(); } };
  const watch = (el, isGone, onlyLayer) => {
    if (!el || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => { if (isGone(el) && (!onlyLayer || P.activeSculptLayer === onlyLayer)) sculptOff(); })
      .observe(el, { attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
  };
  const hiddenBody = (el) => el.classList.contains('hidden');
  const shown = (el) => el.style.display && el.style.display !== 'none';
  watch(document.querySelector('.panel-sculpt-top > .panel-body'), hiddenBody, 'top');
  watch(document.querySelector('.panel-sculpt-bot > .panel-body'), hiddenBody, 'bot');
  for (const id of ['svgEditorModal', 'settings-panel-overlay', 'projectManagerModal']) watch(document.getElementById(id), shown);
  // Fred: Esc, or a quick tap on the empty background around the board (not a drag -- that still turns the view),
  // also turns Sculpt off
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !P.activeSculptLayer) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    sculptOff();
  });
  const cv = preview && preview._canvas;
  if (cv) {
    let down = null;
    const start = (x, y) => { down = P.activeSculptLayer ? { x, y, t: Date.now() } : null; };
    const end = (x, y) => {
      const d = down; down = null;
      if (!d || !P.activeSculptLayer) return;
      if (Math.hypot(x - d.x, y - d.y) > 8 || Date.now() - d.t > 400) return;       // a drag or a hold, not a tap
      if (typeof preview.isOnSculptBoard === 'function' && !preview.isOnSculptBoard(x, y)) sculptOff();
    };
    cv.addEventListener('mousedown', (e) => { if (e.button === 0) start(e.clientX, e.clientY); });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) end(e.clientX, e.clientY); });
    cv.addEventListener('touchstart', (e) => { if (e.touches.length === 1) start(e.touches[0].clientX, e.touches[0].clientY); else down = null; }, { passive: true });
    cv.addEventListener('touchend', (e) => { const t = e.changedTouches && e.changedTouches[0]; if (t && e.touches.length === 0) end(t.clientX, t.clientY); }, { passive: true });
  }

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
  // FORMULA-FIELDS: after the steppers (they only wrap type="number" inputs; the binder switches its fields to text).
  attachFormulaFields();
  attachSliderScrollGuard();

  // All stamp-panel controls are now owned by main/stamp/* — one module
  // per slider/control, composed by initStampPanel. Stored on AppState so
  // applySnapshot (UX-UNDO/SE5c) can refresh these inputs after an undo
  // restores per-layer tooling, the same way a layer switch does.
  AppState.stampCtx = initStampPanel(preview);

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
