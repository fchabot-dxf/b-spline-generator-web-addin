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
 *   - core/noise/tweaks-ui.js     per-filter knob panel
 *   - core/ui-utils.js            resizer + mobile viewport
 *   - core/fusion-bridge.js       Python ↔ palette bridge
 *
 * This file just orders the boot steps and bridges the Fusion-mode
 * handshake (sync_board / import_ready / reset_ui) into applyParam.
 */
import { initResizer, resizeApp, setupMobileViewportHandling } from '../core/ui-utils.js';
import { initMobilePreviewResizer } from './mobile-resizer.js';
import { rebuild, scheduleRebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { fusLog, pollMode, stopFusionPolling, setFusionActionState, FUSION_IDLE_LABEL, requestDesignParams, setFusionStatus } from '../core/fusion-bridge.js';
import { TerrainPreview } from '../core/preview.js';
import { populateNoiseDropdown } from '../core/noise/index.js';
import { bindTweaksUI, renderTweaksPanel } from '../core/noise/tweaks-ui.js';
import { initPhotoPanel, syncPhotoPanel } from './photo-panel.js';
import { initBrickPanel } from './brick-panel.js';
import { AppState } from './app-state.js';
import { saveLastSession, isFusionMode } from '../core/state.js';
import { isDirty } from '../core/dirty.js';
import { applyParam } from './param-manager.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { initApp, initSvgEditor } from './app-init.js';
import { bindControls } from './ui-bindings.js';
import { bindProjectManager } from './cloud-project-manager.js';
import { initFramePanel, onFrameResult, syncFramePanel } from './frame-panel.js';
import { initClearMenu } from './editor-clear-menu.js';
import { bindHeaderAndSettings } from './header-controls.js';
import { wireGlobalEvents } from './global-events.js';
import {
    onGenerate, onFusionApply, executeExport, closeWizard,
} from './export-flow.js';

let preview = null;
window.svgEditor = null; // exposed for editor.js

// H9: fades out and removes #app-splash (bspline_gen_palette.html). Called
// from the initApp callback in both onFusionDetected/onWebDetected below --
// the app's real "ready" point (after session load, migrations, mesh
// rebuild), not a fixed timer. Removing the element (not just hiding it)
// means it can't reappear later this session.
function hideSplashScreen() {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('app-splash-hidden');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
}

document.addEventListener('DOMContentLoaded', () => {
    fusLog('[main.js] DOMContentLoaded: Initializing application');

    // Save audit #4: the last session is NOT cleared any more -- a reload (or the phone evicting the tab) used to
    // throw away the drawing and every unsaved change. initApp restores it (loadLastSession).
    // Leaving the page: keep the session copy current (a phone can evict the tab without another chance), and in a
    // browser warn when there are changes not saved to the cloud (not inside Fusion: a palette reload must not block).
    window.addEventListener('pagehide', () => saveLastSession());
    window.addEventListener('beforeunload', (e) => {
        if (isFusionMode || !isDirty()) return;
        e.preventDefault();
        e.returnValue = '';
    });

    // 1. 3D Preview
    const canvas = document.getElementById('previewCanvas');
    preview = new TerrainPreview(canvas);
    AppState.preview = preview;
    // SE11: a purpose-built handle for headless verification (same idea as
    // window.__perfLog, SE8b-3) — AppState itself is a module-scoped
    // export, not a window global, so a CDP script can't reach
    // preview._drapeTexture any other way.
    window.__preview = preview;

    // 2. Resizer + mobile viewport
    initResizer(preview);
    initMobilePreviewResizer();
    setupMobileViewportHandling();
    window.addEventListener('resize', () => resizeApp(preview));

    // 3. Dropdowns from registries (must run before bindControls so the
    //    <select>s are populated when the listeners attach).
    const noiseSelect = document.getElementById('noiseType');
    populateNoiseDropdown(noiseSelect);

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
    syncPhotoPanel(noiseSelect?.value || 'simplex');
    if (noiseSelect) {
        noiseSelect.addEventListener('change', (e) => {
            renderTweaksPanel(e.target.value);
            syncPhotoPanel(e.target.value);
        });
    }

    // F34 item 1: the Photo filter's own small editor (pattern row, load-my-
    // own, crop/rotate/flip/levels/brightness/contrast/blur/invert, undo).
    initPhotoPanel({
        onChange: () => scheduleRebuild(
            () => rebuild(preview, updateStampMasks, updatePreviewSculptMode),
            0,
        ),
    });

    // F35 item 1: the Brick tab (set picker + declared tool list + common
    // controls). Output lands on the editor's own layers -- rebuilds happen
    // through the SAME commitEdit -> editor._onChange -> updateStampMasks
    // path every other carved layer already triggers, so this needs no
    // onChange callback of its own.
    initBrickPanel();

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

    // FB-APP S2 (F6): the sidebar FRAME section + the editor's cut-profile provider.
    initFramePanel();
    // F35 item 28: the editor header's Clear menu (All / one entry per tab that declares `clears`)
    initClearMenu();

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
    syncFramePanel(); // FB-APP S5: [Send frame] is enabled in Fusion mode only
    const dlBtn = document.getElementById('btnDownloadAddin');
    if (dlBtn) dlBtn.style.display = 'none';
    const headerBtn = document.getElementById('btnDownload');
    if (headerBtn) headerBtn.textContent = 'Send to Fusion';
    // On every Fusion-mode load (including palette hide/re-show HTML
    // reloads), reset the Send-to-Fusion button to its idle label so it
    // never shows a stale in-progress state.
    setFusionActionState(FUSION_IDLE_LABEL, false);

    initApp(preview, () => { wireGlobalEvents(preview); hideSplashScreen(); });
    initSvgEditor(preview);

    // Ask Python for the design's widthIn/heightIn parameters. Python
    // responds via 'sync_board' (handled below). If the params don't
    // exist in the design, Python returns an empty dict and the palette
    // keeps its last-session values. Delay slightly so initApp's UI
    // sync runs first; otherwise applyParam writes during the initApp
    // sweep can overwrite the values we just received.
    setTimeout(requestDesignParams, 250);
}

async function onWebDetected() {
    fusLog('Web/Browser Mode Detected');
    const headerBtn = document.getElementById('btnDownload');
    if (headerBtn) headerBtn.textContent = 'STEP';
    initApp(preview, () => { wireGlobalEvents(preview); hideSplashScreen(); });
    initSvgEditor(preview);
}

function handleFusionHandshake(ev) {
    const action = ev?.detail?.action;
    if (!action) return;

    if (action === 'import_ready' || action === 'reset_ui') {
        stopFusionPolling();
        setFusionActionState(FUSION_IDLE_LABEL, false);
        return;
    }

    if (action === 'import_progress') {
        let msg = ''; try { msg = JSON.parse(ev.detail.data || '{}').msg || ''; } catch (e) {}
        if (msg) setFusionStatus(msg, 'busy');
        return;
    }
    if (action === 'import_success') { setFusionStatus('Imported into Fusion ✓', 'ok'); return; }
    // workflow audit #15: a failed Send reports at once (the palette used to wait out its whole poll)
    if (action === 'import_failed') {
        let msg = ''; try { msg = JSON.parse(ev.detail.data || '{}').msg || ''; } catch (e) {}
        stopFusionPolling();
        setFusionActionState(FUSION_IDLE_LABEL, false);
        setFusionStatus(msg || 'The Send failed in Fusion', 'warn');
        return;
    }
    if (action === 'frame_result') { onFrameResult(ev.detail.data); return; } // the frame, built by the one Send
    if (action === 'clear_result') { // Fred: "Clear Fusion design"
        let r = {}; try { r = JSON.parse(ev.detail.data || '{}'); } catch (e) {}
        if (!r.ok) { setFusionStatus(r.error || 'The Fusion design was not cleared.', 'warn'); return; }
        const n = (r.frames || []).length + (r.bsplineSets || 0);
        setFusionStatus(n ? 'Fusion design cleared' : 'Nothing to clear in this Fusion design', 'ok');
        return;
    }

    if (action === 'pong') return;

    if (action === 'build_info') {
        // Python pushed the deployed build stamp {sha, built_at, dirty, status,
        // message}. Paint the header badge: ✓ up-to-date / ⚠ stale-or-dirty, with
        // the full detail in the tooltip. Unknown (no build-info.json / dev run)
        // keeps the fallback literal, just muted + explained via title.
        try {
            const badge = document.getElementById('build-badge');
            if (!badge) return;
            const info   = JSON.parse(ev.detail.data || '{}');
            const status = info.status || 'unknown';
            const sha    = info.sha || 'unknown';
            badge.title  = info.message || '';
            if (status !== 'ok') setFusionStatus(info.message || 'Deployed add-in is stale', 'warn');
            if (status === 'unknown' || sha === 'unknown') {
                badge.className = 'cad-nav-version build-unknown';
            } else {
                // Fred (2026-10-03): the date-based version (YYYY.MM.DD-N) leads; older
                // deploys without one fall back to the build date.
                const label = info.version || String(info.built_at || '').slice(0, 10);
                const glyph = status === 'ok' ? '✓' : '⚠';
                const edits = info.dirty ? ' +edits' : '';
                badge.textContent = `${glyph} ${label} · ${sha}${edits}`;
                badge.className   = `cad-nav-version build-${status}`;
            }
        } catch (e) {
            fusLog(`build_info parse failed: ${e.message}`);
        }
        return;
    }

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
