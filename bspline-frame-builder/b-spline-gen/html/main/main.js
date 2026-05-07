/**
 * main.js — Application composition root.
 *
 * Boots the 3D preview, populates the noise/seed dropdowns, wires the
 * sidebar/header/keyboard/export modules, then defers Fusion-mode
 * detection to the next paint frame so the palette has time to lay out.
 *
 * Most concrete logic lives in:
 *   - main/header-controls.js     header + settings buttons
 *   - main/global-events.js       keyboard shortcuts + sculpt buttons
 *   - main/export-flow.js         export wizard + STEP / Fusion send
 *   - main/skeleton-editor.js     fullscreen seed editor
 *   - core/noise/tweaks-ui.js     per-filter knob panel
 *   - core/ui-utils.js            resizer + mobile viewport
 *   - core/fusion-bridge.js       Python ↔ palette bridge
 *
 * This file just orders the boot steps and bridges the Fusion-mode
 * handshake (sync_board / import_ready / reset_ui) into applyParam.
 */
import { initResizer, resizeApp, setupMobileViewportHandling } from '../core/ui-utils.js';
import { rebuild, scheduleRebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { fusLog, pollMode, stopFusionPolling } from '../core/fusion-bridge.js';
import { TerrainPreview } from '../core/preview.js';
import { populateNoiseDropdown } from '../core/noise/index.js';
import { populateSeedDropdown } from '../core/seed/index.js';
import { bindTweaksUI, renderTweaksPanel } from '../core/noise/tweaks-ui.js';
import { AppState } from './app-state.js';
import { applyParam } from './param-manager.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { initApp, initSvgEditor } from './app-init.js';
import { bindControls } from './ui-bindings.js';
import { bindProjectManager } from './cloud-project-manager.js';
import { initSkeletonEditor } from './skeleton-editor.js';
import { bindHeaderAndSettings } from './header-controls.js';
import { wireGlobalEvents } from './global-events.js';
import {
    onGenerate, onFusionApply, executeExport, closeWizard,
} from './export-flow.js';

let preview = null;
window.svgEditor = null; // exposed for editor.js

document.addEventListener('DOMContentLoaded', () => {
    fusLog('[main.js] DOMContentLoaded: Initializing application');

    // Clear last session to reset SVG editor canvas on refresh.
    localStorage.removeItem('splineGenLastSession');

    // 1. 3D Preview
    const canvas = document.getElementById('previewCanvas');
    preview = new TerrainPreview(canvas);
    AppState.preview = preview;

    // 2. Resizer + mobile viewport
    initResizer(preview);
    setupMobileViewportHandling();
    window.addEventListener('resize', () => resizeApp(preview));

    // 3. Dropdowns from registries (must run before bindControls so the
    //    <select>s are populated when the listeners attach).
    const noiseSelect = document.getElementById('noiseType');
    populateNoiseDropdown(noiseSelect);
    populateSeedDropdown(document.getElementById('seedType'));

    // 4. Edit-Filter slider panel — per-filter knobs from each mode's
    //    `tweaks` schema.
    bindTweaksUI({
        panelEl:  document.getElementById('filterTweaksPanel'),
        bodyEl:   document.getElementById('filterTweaksBody'),
        resetBtnEl: document.getElementById('filterTweaksReset'),
        getActiveFilterId: () => noiseSelect?.value || 'simplex',
        onChange: () => scheduleRebuild(
            () => rebuild(preview, updateStampMasks, updatePreviewSculptMode),
            0,
        ),
    });
    renderTweaksPanel(noiseSelect?.value || 'simplex');
    if (noiseSelect) {
        noiseSelect.addEventListener('change', (e) => renderTweaksPanel(e.target.value));
    }

    // 5. Sidebar / header / theme / project manager.
    bindControls(preview);
    bindProjectManager(preview);
    bindHeaderAndSettings(preview, {
        onGenerate,
        onFusionApply,
        onWizardExport: () => executeExport(preview),
        onWizardCancel: closeWizard,
    });
    if (window.initBsplineTheme) window.initBsplineTheme();

    // 6. Skeleton (seed) editor — must run after bindControls so the
    //    sidebar's "Edit Skeleton" button exists and isn't double-wired.
    initSkeletonEditor();

    // 7. Fusion 360 detection. Two RAFs to yield to browser paint so
    //    the palette has settled before we start polling.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            pollMode(onFusionDetected, onWebDetected);
        });
    });

    // 8. Bridge callbacks from Python (onFusionNotify in index.html).
    //    Without this, stale polling can continue after first export
    //    and re-hide the palette.
    window.addEventListener('fusionHandshake', handleFusionHandshake);
});

async function onFusionDetected() {
    fusLog('Fusion 360 Mode Detected');
    document.body.classList.add('fusion-mode');
    const dlBtn = document.getElementById('btnDownloadAddin');
    if (dlBtn) dlBtn.style.display = 'none';
    const headerBtn = document.getElementById('btnDownload');
    if (headerBtn) headerBtn.textContent = 'Send to Fusion';
    // On every Fusion-mode load (including palette hide/re-show HTML
    // reloads), reset the Apply button to 'OK' so it never shows the
    // default text.
    const applyBtn = document.getElementById('btnFusionApply');
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'OK'; }

    initApp(preview, () => wireGlobalEvents(preview));
    initSvgEditor(preview);

    // Ask Python for the design's widthIn/heightIn parameters. Python
    // responds via 'sync_board' (handled below). If the params don't
    // exist in the design, Python returns an empty dict and the palette
    // keeps its last-session values. Delay slightly so initApp's UI
    // sync runs first; otherwise applyParam writes during the initApp
    // sweep can overwrite the values we just received.
    setTimeout(() => {
        try {
            adsk.fusionSendData('get_design_params', '{}');
            fusLog('get_design_params sent to Python');
        } catch (e) {
            fusLog(`get_design_params send failed: ${e.message}`);
        }
    }, 250);
}

async function onWebDetected() {
    fusLog('Web/Browser Mode Detected');
    const headerBtn = document.getElementById('btnDownload');
    if (headerBtn) headerBtn.textContent = 'STEP';
    initApp(preview, () => wireGlobalEvents(preview));
    initSvgEditor(preview);
}

function handleFusionHandshake(ev) {
    const action = ev?.detail?.action;
    if (!action) return;

    if (action === 'import_ready' || action === 'reset_ui') {
        stopFusionPolling();
        const btn = document.getElementById('btnFusionApply');
        if (btn) { btn.disabled = false; btn.textContent = 'OK'; }
        return;
    }

    if (action === 'pong') return;

    if (action === 'sync_board') {
        // Python pushed widthIn / heightIn from the active Fusion design.
        // Apply via applyParam so the full plumbing runs: state update,
        // input sync, spacing labels, stamp-mask refresh against the new
        // grid, and rebuild. Inputs remain editable — manual changes
        // still flow through the same applyParam path.
        fusLog(`sync_board received: data=${ev.detail.data}`);
        try {
            const board = JSON.parse(ev.detail.data || '{}');
            if (typeof board.widthIn === 'number' && isFinite(board.widthIn)) {
                applyParam('widthIn', board.widthIn);
                // Belt-and-suspenders: write the DOM directly too, in
                // case some later sweep clobbers the input value.
                const w = document.getElementById('widthIn');
                if (w) w.value = board.widthIn;
                fusLog(`sync_board: applied widthIn=${board.widthIn} (DOM=${w?.value})`);
            }
            if (typeof board.heightIn === 'number' && isFinite(board.heightIn)) {
                applyParam('heightIn', board.heightIn);
                const h = document.getElementById('heightIn');
                if (h) h.value = board.heightIn;
                fusLog(`sync_board: applied heightIn=${board.heightIn} (DOM=${h?.value})`);
            }
        } catch (e) {
            fusLog(`sync_board parse failed: ${e.message}`);
        }
    }
}
