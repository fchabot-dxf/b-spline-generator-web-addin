/**
 * Header / settings-panel button wiring. Owns:
 *   - The "STEP" / "Send to Fusion" header button (mode-aware).
 *   - The export-wizard cancel/run buttons.
 *   - The "Download Add-in" link.
 *   - The app-refresh (cache-bust) button.
 *   - The "Random seed" button.
 *   - The Settings panel's "Haptic feedback" toggle.
 *
 * Takes onGenerate / onFusionApply as injected callbacks so the export
 * pipeline lives in its own module — header-controls just translates
 * clicks into invocations.
 */
import { beginLoadingSequence } from '../core/loading-signal.js';
import { isFusionMode } from '../core/state.js';
import { applyParam } from './param-manager.js';
import { isHapticEnabled, setHapticEnabled } from '../core/haptics.js';
import { isJobTimelineEnabled, setJobTimelineEnabled } from '../core/job-timeline-enabled.js';
import { renderJobStrips } from './job-timeline-strip.js';
import { onClearFusionDesign } from './export-flow.js';
import { copyLogToClipboard } from './copy-log.js';
import { pullSketchFromFusion } from '../core/fusion-bridge.js';
import { offeredSendTargets } from './send-targets.js';

const ADDIN_RELEASE_URL = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/bspline-frame-builder.zip';

export function bindHeaderAndSettings(preview, { onGenerate, onFusionApply, onWizardExport, onWizardCancel }) {
    const btnDownload = document.getElementById('btnDownload'); // STEP / Send to Fusion
    if (btnDownload) btnDownload.addEventListener('click', () => {
        if (isFusionMode) onFusionApply(preview);
        else              onGenerate(preview);
    });

    bindSendTargetMenu(preview, onFusionApply);

    const btnWizardExport = document.getElementById('btnWizardExport');
    if (btnWizardExport) btnWizardExport.addEventListener('click', onWizardExport);

    document.getElementById('btnPullFromFusion')?.addEventListener('click', pullSketchFromFusion);
    document.getElementById('btnMainLayersPullFusion')?.addEventListener('click', pullSketchFromFusion);

    document.getElementById('btnClearFusionDesign')?.addEventListener('click', onClearFusionDesign);
    document.getElementById('btnCopyLog')?.addEventListener('click', copyLogToClipboard);
    // the Clear section is Fusion-only; the settings panel is opened from the header (⚙)
    document.getElementById('settings-btn')?.addEventListener('click', () => {
        const sec = document.getElementById('clearFusionSection');
        if (sec) sec.style.display = isFusionMode ? '' : 'none';
    });
    const btnWizardCancel = document.getElementById('btnWizardCancel');
    if (btnWizardCancel) btnWizardCancel.addEventListener('click', onWizardCancel);

    const btnDownloadAddin = document.getElementById('btnDownloadAddin');
    if (btnDownloadAddin) {
        btnDownloadAddin.addEventListener('click', () => {
            window.location.href = ADDIN_RELEASE_URL;
        });
    }

    // App refresh — bypasses HTTP cache so new code is picked up without
    // hitting browser refresh. window.location.reload(true) is deprecated;
    // appending a cache-buster query forces all subresources to re-fetch.
    const btnAppRefresh = document.getElementById('btnAppRefresh');
    if (btnAppRefresh) {
        btnAppRefresh.addEventListener('click', () => {
            const url = new URL(window.location.href);
            url.searchParams.set('_r', Date.now().toString());
            window.location.href = url.toString();
        });
    }

    // Settings-panel open/close is owned SOLELY by the inline handler in
    // bspline_gen_palette.html (opens #settings-panel-overlay). A duplicate
    // toggle here referenced a wrong id ('settings-overlay') and toggled
    // `.hidden` onto #settings-panel, hiding the modal content (grey/empty
    // modal). Removed [SM1].

    const btnRandomSeed = document.getElementById('btnRandomSeed');
    if (btnRandomSeed) {
        btnRandomSeed.addEventListener('click', () => {
            beginLoadingSequence('newSeed'); // item 41: the carve + rebuild it causes read as steps
            applyParam('seed', Math.floor(Math.random() * 99999));
        });
    }

    // H13 HAPTICS: isHapticEnabled() already resolves the persisted value,
    // or the touch-device default when nothing was saved yet -- the
    // checkbox just mirrors it and writes back on change.
    const hapticCheckbox = document.getElementById('hapticEnabled');
    if (hapticCheckbox) {
        hapticCheckbox.checked = isHapticEnabled();
        hapticCheckbox.addEventListener('change', () => {
            setHapticEnabled(hapticCheckbox.checked);
        });
    }

    // Fred 2026-10-16: DEFAULT OFF (isJobTimelineEnabled's own unset-default, core/job-timeline-enabled.js) -- the
    // checkbox mirrors it and writes back on change, same shape as Haptic feedback above; re-renders at once so
    // flipping it shows/hides the strip live, not only on the next reload.
    const jobTimelineCheckbox = document.getElementById('jobTimelineEnabled');
    if (jobTimelineCheckbox) {
        jobTimelineCheckbox.checked = isJobTimelineEnabled();
        jobTimelineCheckbox.addEventListener('change', () => {
            setJobTimelineEnabled(jobTimelineCheckbox.checked);
            renderJobStrips();
        });
    }
}

/** Send targets (seat A 2026-10-14): the Send ▾ menu -- one entry per offered target (main/send-targets.js), each a
 *  Send to that target; the Send button itself stays "replace". Closes on a pick, a click outside or Escape. */
export function bindSendTargetMenu(preview, onFusionApply) {
    const toggle = document.getElementById('btnSendMenu');
    const menu = document.getElementById('sendTargetMenu');
    if (!toggle || !menu) return;
    menu.innerHTML = '';
    const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
    for (const t of offeredSendTargets()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cad-btn';
        b.id = `sendTarget_${t.id}`;
        b.setAttribute('role', 'menuitem');
        b.textContent = t.label;
        b.title = t.title;
        b.addEventListener('click', () => { close(); onFusionApply(preview, { sendTarget: t.id }); });
        menu.appendChild(b);
    }
    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        toggle.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
