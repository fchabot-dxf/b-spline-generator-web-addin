/**
 * Tool Profile + V-Bit Angle — the profile dropdown plus the conditional
 * V-Bit Angle input that only some profiles need.
 *
 * Which conditional inputs to show is data-driven: each profile module
 * declares its `uiParams` array, and this module reads it to flip the
 * vBitAngleContainer visibility. Adding a new profile that needs the
 * angle input is a one-line change in that profile's file.
 */
import { listProfiles, getProfile } from '../../core/stamp/profiles/index.js';

const ANGLE_CONTAINER_ID = 'vBitAngleContainer';

function syncConditionalInputs(profileId) {
  const profile = getProfile(profileId);
  const needsAngle = (profile.uiParams || []).includes('stampVBitAngle');
  const container = document.getElementById(ANGLE_CONTAINER_ID);
  if (container) container.style.display = needsAngle ? 'block' : 'none';
}

export function initProfileControl(ctx) {
  // Populate the profile dropdown from the registry so adding a new
  // profile shows up automatically. (Only does anything if the HTML
  // <select> is present and starts empty; we keep static <option>s as
  // a safety net so the panel still works without this module.)
  const sel = document.getElementById('stampProfile');
  if (sel) {
    // Only repopulate if we'd actually be changing anything — otherwise
    // we'd lose the user's selection when this re-runs.
    const registryIds = listProfiles().map((p) => p.id).join(',');
    const currentIds = Array.from(sel.options).map((o) => o.value).join(',');
    if (registryIds !== currentIds) {
      const previous = sel.value;
      sel.innerHTML = '';
      listProfiles().forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.label;
        sel.appendChild(opt);
      });
      // Restore previous selection if it still exists; else first option.
      sel.value = listProfiles().some((p) => p.id === previous) ? previous : listProfiles()[0]?.id || '';
    }

    // Show/hide the V-Bit Angle input based on the active profile.
    sel.addEventListener('change', () => syncConditionalInputs(sel.value));
    syncConditionalInputs(sel.value);
  }

  // V-Bit Angle is just a number input — bindNumberSlider with sliderId=null
  // because there's no slider, only a number stepper.
  const syncAngle = ctx.bindNumberSlider('stampVBitAngle', null, 'angle');

  return ctx.registerModule({
    id: 'profile-control',
    syncFromLayer(layer) {
      if (!layer) return;
      if (sel && layer.profile) sel.value = layer.profile;
      syncConditionalInputs(layer.profile || (sel && sel.value) || '');
      syncAngle(layer);
    },
  });
}
