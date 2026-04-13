import { P, preDelta, postDelta } from '../core/state.js';
import { applySnapshot } from './snapshot-manager.js';

export function bindPresets(preview) {
  const btnPresetSave = document.getElementById('btnPresetSave');
  const btnPresetDelete = document.getElementById('btnPresetDelete');
  const presetSelect = document.getElementById('presetSelect');

  const renderList = () => {
    if (!presetSelect) return;
    const store = JSON.parse(localStorage.getItem('splineGenPresets') || '{}');
    const names = Object.keys(store).sort();
    presetSelect.innerHTML = names.length
      ? names.map(n => `<option value="${n}">${n}</option>`).join('')
      : '<option value="">— none saved —</option>';
  };

  btnPresetSave?.addEventListener('click', () => {
    const nameInput = document.getElementById('presetName');
    const name = (nameInput?.value || '').trim();
    if (!name) return;
    const store = JSON.parse(localStorage.getItem('splineGenPresets') || '{}');
    store[name] = {
      P: { ...P },
      preDelta: preDelta ? Array.from(preDelta) : null,
      postDelta: postDelta ? Array.from(postDelta) : null
    };
    localStorage.setItem('splineGenPresets', JSON.stringify(store));
    renderList();
    if (presetSelect) presetSelect.value = name;
  });

  const btnPresetLoad = document.getElementById('btnPresetLoad');
  btnPresetLoad?.addEventListener('click', () => {
    const name = presetSelect?.value;
    if (!name) return;
    const store = JSON.parse(localStorage.getItem('splineGenPresets') || '{}');
    const snap = store[name];
    if (!snap) return;
    applySnapshot(snap, preview);
  });

  btnPresetDelete?.addEventListener('click', () => {
    const name = presetSelect?.value;
    if (!name) return;
    const store = JSON.parse(localStorage.getItem('splineGenPresets') || '{}');
    delete store[name];
    localStorage.setItem('splineGenPresets', JSON.stringify(store));
    renderList();
  });

  renderList();
}
