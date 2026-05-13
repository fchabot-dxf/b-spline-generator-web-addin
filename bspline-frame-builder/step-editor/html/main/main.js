/**
 * main.js — entry point for the step-editor palette UI.
 *
 * Fusion-only for now. The runtime helpers in core/runtime.js still
 * tolerate being loaded outside Fusion (they just no-op), so if you later
 * decide to publish this UI to step-editor.pages.dev nothing in this file
 * needs to change.
 *
 * Boot order:
 *   1. Wire DOM button handlers via ui-bindings.js.
 *   2. Register Python → JS message routes (pong, reset_ui).
 *   3. Send an initial ping so the Python side knows the palette loaded.
 */

import { sendToPython, pyLog, registerPythonRoutes } from '../core/runtime.js';
import { wireButtons, setStatus } from './ui-bindings.js';
import { init as initViewer, getScene } from '../core/three-viewer.js';
import { attachToScene as attachTextPreview } from '../core/three-text.js';

/** Shared editor state — passed by reference into UI bindings so handlers
 *  can mutate it without dragging in a global. Promote to a class if it
 *  grows past ~4 fields. */
const state = {
  filename: null,
  parsed:   null,
};

function boot() {
  wireButtons(state);

  registerPythonRoutes({
    pong:     () => { /* health-check round-trip OK */ },
    reset_ui: () => setStatus('Ready.'),
  });

  // Initialise the Three.js viewer on the viewport canvas. Fails
  // gracefully (just a console warning) if THREE didn't load — the
  // rest of the palette stays usable.
  const canvas = document.getElementById('viewportCanvas');
  if (canvas) {
    initViewer(canvas);
    // Hand the scene reference to the text-preview module so it can
    // attach its group as a sibling of the body meshes.
    attachTextPreview(getScene());
  }

  sendToPython('ping');
  pyLog('palette HTML loaded');
}

// Defer to DOMContentLoaded so this module can sit anywhere in the page.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
