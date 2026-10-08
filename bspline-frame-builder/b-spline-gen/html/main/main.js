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
import { paintFusionMemory } from '../core/fusion-memory-line.js';
import { initMobilePreviewResizer } from './mobile-resizer.js';
import { initSidebarLayout } from './sidebar-layout.js';
import { initSidebarTabs } from './sidebar-tabs.js';
import { initArtTabs } from './art-tabs.js';
import { applySectionThemes } from './section-themes.js';
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
import { inEditor3dAction } from '../core/in-editor-3d.js';
import { refreshEditorTopView } from '../core/render-topview.js';
import { bindControls } from './ui-bindings.js';
import { bindProjectManager } from './cloud-project-manager.js';
import { receiveEditPasswordFromFusion } from './edit-password.js';
import { initFramePanel, onFrameResult, onDeleteFrameResult, syncFramePanel } from './frame-panel.js';
import { initClearMenu } from './editor-clear-menu.js';
import { initViewModeToggle } from './view-mode-toggle.js';
import { bindHeaderAndSettings } from './header-controls.js';
import { paintBuildInfo } from './build-badge.js';
import { wireGlobalEvents } from './global-events.js';
import { installGestureWatch, holdLoadingStage, releaseHeldStage } from '../core/loading-signal.js';
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
    installGestureWatch(); // item 41: a slider drag's rebuilds show the loading pill, not the card

    // 2. Resizer + mobile viewport
    initResizer(preview);
    initMobilePreviewResizer();
    initSidebarLayout();
    initSidebarTabs(); // F35 items 48 + 47: the sidebar's tabs + pinned sections
    applySectionThemes(); // F35 item 30: the declared section tints (sidebar + editor panels)
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
    // core/in-editor-3d.js 'photo': with the editor open a photo edit repaints its backdrop only (no 3D while editing)
    initPhotoPanel({
        onChange: () => (inEditor3dAction('photo') === 'backdrop'
            ? refreshEditorTopView()
            : scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0)),
    });

    // F35 item 1: the Brick tab (set picker + declared tool list + common
    // controls). Output lands on the editor's own layers -- rebuilds happen
    // through the SAME commitEdit -> editor._onChange -> updateStampMasks
    // path every other carved layer already triggers, so this needs no
    // onChange callback of its own.
    initBrickPanel();
    initArtTabs(); // the Artwork editor's tabs (mockup v2)

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
    // F35 item 25: the [2D | 3D] pill on the 3D viewport and in the editor
    initViewModeToggle();

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
        releaseHeldStage(); // item 70
        return;
    }
    // item 70: the add-in reports each step of a Send by its declared id (data/fusion-send-stages.js) -- held on the
    // card ("Waiting - Fusion: building the frame, step 9 of 11") until the next step or the end
    if (action === 'import_stage') {
        let id = ''; try { id = JSON.parse(ev.detail.data || '{}').id || ''; } catch (e) {}
        if (id) holdLoadingStage(id);
        return;
    }

    if (action === 'import_progress') {
        let msg = ''; try { msg = JSON.parse(ev.detail.data || '{}').msg || ''; } catch (e) {}
        if (msg) setFusionStatus(msg, 'busy');
        return;
    }
    if (action === 'import_success') {
        releaseHeldStage(); // item 70: Fusion's stages end; the button was held until now
        setFusionActionState(FUSION_IDLE_LABEL, false);
        setFusionStatus('Imported into Fusion ✓', 'ok');
        return;
    }
    // workflow audit #15: a failed Send reports at once (the palette used to wait out its whole poll)
    if (action === 'import_failed') {
        let msg = ''; try { msg = JSON.parse(ev.detail.data || '{}').msg || ''; } catch (e) {}
        stopFusionPolling();
        setFusionActionState(FUSION_IDLE_LABEL, false);
        releaseHeldStage(); // item 70
        setFusionStatus(msg || 'The Send failed in Fusion', 'warn');
        return;
    }
    if (action === 'frame_result') { onFrameResult(ev.detail.data); return; } // the frame, built by the one Send
    if (action === 'delete_frame_result') { onDeleteFrameResult(ev.detail.data); return; } // F26 item 2 (b)
    if (action === 'clear_result') { // Fred: "Clear Fusion design"
        let r = {}; try { r = JSON.parse(ev.detail.data || '{}'); } catch (e) {}
        if (!r.ok) { setFusionStatus(r.error || 'The Fusion design was not cleared.', 'warn'); return; }
        const n = (r.frames || []).length + (r.bsplineSets || 0);
        setFusionStatus(n ? 'Fusion design cleared' : 'Nothing to clear in this Fusion design', 'ok');
        return;
    }

    if (action === 'pong') return;

    // F35 item 34: the add-in's cached edit password (its config outside the deployed folder), at startup
    if (action === 'edit_password') {
        let d = {}; try { d = JSON.parse(ev.detail.data || '{}'); } catch (e) {}
        receiveEditPasswordFromFusion(d.password || null);
        return;
    }

    // the add-in's Fusion memory reading before each Send (fb_shared/fusion_memory.py): one line, detection only
    if (action === 'fusion_memory') {
        try { paintFusionMemory(JSON.parse(ev.detail.data || '{}')); } catch (e) { fusLog(`fusion_memory parse failed: ${e.message}`); }
        return;
    }

    if (action === 'build_info') {
        // Python pushed the deployed build stamp {sha, built_at, dirty, status,
        // message}: the Settings > Version badge, and a stale mark on the Settings
        // button -- never the status line over the header (H23 item 93, build-badge.js).
        try {
            paintBuildInfo(JSON.parse(ev.detail.data || '{}'));
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
