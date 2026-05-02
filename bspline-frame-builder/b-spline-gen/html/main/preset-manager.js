import { P, preDelta, postDelta, extraThickenThinMask } from '../core/state.js';
import { COORD_SYSTEM } from '../core/coords.js';
import { applySnapshot } from './snapshot-manager.js';

export function bindPresets(preview) {
  const btnPresetSave = document.getElementById('btnPresetSave');
  const btnPresetDelete = document.getElementById('btnPresetDelete');
  const presetSelect = document.getElementById('presetSelect');

  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem('splineGenPresets') || '{}');
    } catch {
      return {};
    }
  };

  const renderList = () => {
    if (!presetSelect) return;
    const store = readStore();
    const names = Object.keys(store).sort();
    presetSelect.innerHTML = names.length
      ? names.map(n => `<option value="${n}">${n}</option>`).join('')
      : '<option value="">— none saved —</option>';
  };

  btnPresetSave?.addEventListener('click', () => {
    const nameInput = document.getElementById('presetName');
    const name = (nameInput?.value || '').trim();
    if (!name) {
      alert('Enter a preset name first.');
      return;
    }

    // Build a clean, JSON-safe snapshot.
    //
    //  * stampLayers[*].mask is a typed array (Float32 / Uint8ClampedArray)
    //    that JSON.stringify serializes as an OBJECT ({"0":1,"1":0,...}),
    //    not an array. After load, it'd no longer be a typed array,
    //    breaking any code that does `instanceof Float32Array` or reads
    //    `.length`. Strip masks here -- updateStampMasks() regenerates
    //    them from .svg + .blur on the next rebuild, so they don't need
    //    to be persisted.
    //
    //  * P.points (if present) are stored in UI-space coordinates that
    //    depend on the current widthIn/heightIn. Convert to physical
    //    space before saving so the preset is portable; the load handler
    //    converts back.
    //
    //  * extraThickenThinMask used to be silently dropped from presets
    //    (regression -- saveLastSession had it, presets did not). Round-
    //    tripping it keeps the preset state identical to the in-memory
    //    state at save time.
    const cleanLayers = (P.stampLayers || []).map(L => ({ ...L, mask: null }));
    const cleanP = { ...P, stampLayers: cleanLayers };
    if (cleanP.points && Array.isArray(cleanP.points)) {
      cleanP.points = cleanP.points.map(pt => {
        const phys = COORD_SYSTEM.toPhysical(pt[0], pt[1]);
        return [phys.x, phys.y];
      });
    }

    const snapshot = {
      P: cleanP,
      preDelta: preDelta ? Array.from(preDelta) : null,
      postDelta: postDelta ? Array.from(postDelta) : null,
      extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
    };

    const store = readStore();
    store[name] = snapshot;

    try {
      localStorage.setItem('splineGenPresets', JSON.stringify(store));
    } catch (e) {
      // Most likely QuotaExceededError when many large presets accumulate.
      console.warn('Preset save failed:', e);
      alert(`Couldn't save preset "${name}" -- local storage is full or refused. ` +
            `Delete some presets and try again.`);
      return;
    }

    renderList();
    if (presetSelect) presetSelect.value = name;
  });

  const btnPresetLoad = document.getElementById('btnPresetLoad');
  btnPresetLoad?.addEventListener('click', () => {
    const name = presetSelect?.value;
    if (!name) return;
    const store = readStore();
    const snap = store[name];
    if (!snap) return;

    // Reverse the points conversion done at save time.
    if (snap.P && Array.isArray(snap.P.points)) {
      snap.P.points = snap.P.points.map(pt => {
        const ui = COORD_SYSTEM.toUI(pt[0], pt[1]);
        return [ui.x, ui.y];
      });
    }

    applySnapshot(snap, preview);
  });

  btnPresetDelete?.addEventListener('click', () => {
    const name = presetSelect?.value;
    if (!name) return;
    const store = readStore();
    delete store[name];
    try {
      localStorage.setItem('splineGenPresets', JSON.stringify(store));
    } catch (e) {
      console.warn('Preset delete failed:', e);
      return;
    }
    renderList();
  });

  renderList();
}
