// cloud-preset-manager.js — preset save/load via Cloudflare Worker.
//
// Drop-in alongside preset-manager.js. Activates only if
// window.BSPLINE_PRESETS_API_URL is set (configure before module load).
//
// Reuses the same snapshot shape as preset-manager.js:
//   - stampLayers[*].mask stripped (regenerates from .svg on next rebuild)
//   - P.points converted UI -> physical on save, physical -> UI on load
//   - extraThickenThinMask round-tripped
// applySnapshot is the same shared handler used by undo/redo and local
// presets, so on load the snapshot lands the same way as a local preset.

import { P, preDelta, postDelta, extraThickenThinMask } from '../core/state.js';
import { COORD_SYSTEM } from '../core/coords.js';
import { applySnapshot } from './snapshot-manager.js';

function getApiUrl() {
  const url = (typeof window !== 'undefined' && window.BSPLINE_PRESETS_API_URL) || null;
  return url ? url.replace(/\/+$/, '') : null;
}

function buildSnapshot() {
  const cleanLayers = (P.stampLayers || []).map((L) => ({ ...L, mask: null }));
  const cleanP = { ...P, stampLayers: cleanLayers };
  if (cleanP.points && Array.isArray(cleanP.points)) {
    cleanP.points = cleanP.points.map((pt) => {
      const phys = COORD_SYSTEM.toPhysical(pt[0], pt[1]);
      return [phys.x, phys.y];
    });
  }
  return {
    P: cleanP,
    preDelta: preDelta ? Array.from(preDelta) : null,
    postDelta: postDelta ? Array.from(postDelta) : null,
    extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
  };
}

function unpackPoints(snap) {
  if (snap && snap.P && Array.isArray(snap.P.points)) {
    snap.P.points = snap.P.points.map((pt) => {
      const ui = COORD_SYSTEM.toUI(pt[0], pt[1]);
      return [ui.x, ui.y];
    });
  }
  return snap;
}

export function bindCloudPresets(preview) {
  const API_URL = getApiUrl();
  if (!API_URL) {
    console.info('[cloud-presets] BSPLINE_PRESETS_API_URL not set; cloud preset UI disabled');
    return;
  }

  const btnSave = document.getElementById('btnCloudPresetSave');
  const btnLoad = document.getElementById('btnCloudPresetLoad');
  const btnDelete = document.getElementById('btnCloudPresetDelete');
  const select = document.getElementById('cloudPresetSelect');
  const nameInput = document.getElementById('cloudPresetName');

  // If the HTML doesn't have these controls, do nothing — keeps the module
  // safe to import unconditionally.
  if (!btnSave && !btnLoad && !btnDelete && !select) {
    console.info('[cloud-presets] no cloud preset UI elements present; skipping bind');
    return;
  }

  const renderList = async () => {
    if (!select) return;
    try {
      const r = await fetch(`${API_URL}/presets`, { method: 'GET' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      const names = (data.names || []).slice().sort();
      select.innerHTML = names.length
        ? names.map((n) => `<option value="${escapeAttr(n)}">${escapeText(n)}</option>`).join('')
        : '<option value="">— none saved —</option>';
    } catch (e) {
      console.warn('[cloud-presets] list failed:', e);
      select.innerHTML = '<option value="">— offline —</option>';
    }
  };

  btnSave?.addEventListener('click', async () => {
    const name = (nameInput?.value || '').trim();
    if (!name) {
      alert('Enter a cloud preset name first.');
      return;
    }
    try {
      const r = await fetch(`${API_URL}/presets/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSnapshot()),
      });
      if (!r.ok) {
        const err = await safeJson(r);
        throw new Error(err.error || `HTTP ${r.status}`);
      }
      await renderList();
      if (select) select.value = name;
    } catch (e) {
      console.warn('[cloud-presets] save failed:', e);
      alert(`Couldn't save cloud preset "${name}": ${e.message}`);
    }
  });

  btnLoad?.addEventListener('click', async () => {
    const name = select?.value;
    if (!name) return;
    try {
      const r = await fetch(`${API_URL}/presets/${encodeURIComponent(name)}`, { method: 'GET' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const snap = await r.json();
      applySnapshot(unpackPoints(snap), preview);
    } catch (e) {
      console.warn('[cloud-presets] load failed:', e);
      alert(`Couldn't load cloud preset "${name}": ${e.message}`);
    }
  });

  btnDelete?.addEventListener('click', async () => {
    const name = select?.value;
    if (!name) return;
    if (!confirm(`Delete cloud preset "${name}"? This is shared and permanent.`)) return;
    try {
      const r = await fetch(`${API_URL}/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await renderList();
    } catch (e) {
      console.warn('[cloud-presets] delete failed:', e);
      alert(`Couldn't delete cloud preset "${name}": ${e.message}`);
    }
  });

  renderList();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
