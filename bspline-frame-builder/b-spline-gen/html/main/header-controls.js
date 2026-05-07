/**
 * Header / settings-panel button wiring. Owns:
 *   - The "STEP" / "Send to Fusion" header button (mode-aware).
 *   - The export-wizard cancel/run buttons.
 *   - The "Download Add-in" link.
 *   - The app-refresh (cache-bust) button.
 *   - The Settings panel toggle.
 *   - The "Random seed" button.
 *
 * Takes onGenerate / onFusionApply as injected callbacks so the export
 * pipeline lives in its own module — header-controls just translates
 * clicks into invocations.
 */
import { isFusionMode } from '../core/state.js';
import { applyParam } from './param-manager.js';

const ADDIN_RELEASE_URL = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/bspline-frame-builder.zip';

export function bindHeaderAndSettings(preview, { onGenerate, onFusionApply, onWizardExport, onWizardCancel }) {
    const btnDownload = document.getElementById('btnDownload'); // STEP / Send to Fusion
    if (btnDownload) btnDownload.addEventListener('click', () => {
        if (isFusionMode) onFusionApply(preview);
        else              onGenerate(preview);
    });

    const btnWizardExport = document.getElementById('btnWizardExport');
    if (btnWizardExport) btnWizardExport.addEventListener('click', onWizardExport);

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

    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const settingsOverlay = document.getElementById('settings-overlay');

    const toggleSettings = () => {
        settingsPanel?.classList.toggle('hidden');
        settingsOverlay?.classList.toggle('hidden');
    };

    settingsBtn?.addEventListener('click', toggleSettings);
    closeSettingsBtn?.addEventListener('click', toggleSettings);
    settingsOverlay?.addEventListener('click', toggleSettings);

    const btnRandomSeed = document.getElementById('btnRandomSeed');
    if (btnRandomSeed) {
        btnRandomSeed.addEventListener('click', () => {
            applyParam('seed', Math.floor(Math.random() * 99999));
        });
    }
}
