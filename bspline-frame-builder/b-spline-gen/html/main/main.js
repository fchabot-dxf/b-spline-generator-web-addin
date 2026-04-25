/**
 * main.js — Application entry point and UI orchestration.
 * 
 * This module bootstraps the B-Spline Generator, initializes the 3D preview 
 * and SVG Editor, and wires up ALL UI event listeners.
 */
import { 
    P, updateP, loadLastSession, isFusionMode, preDelta, postDelta,
    setStampLayerSvg, setStampLayerMask, setSuppressionMask,
    setPreDelta, setPostDelta,
    lastResult, 
    SLIDER_PAIRS, DEFAULT
} from '../core/state.js';
import { 
    bind, syncPair, syncUItoParam, updateSpacingLabels, 
    initResizer, resizeApp, setupMobileViewportHandling 
} from '../core/ui-utils.js';
import { 
    takeSnapshot, unifiedUndo, unifiedRedo, updateGlobalButtons, isEditorOpen 
} from '../core/history.js';
import { 
    rebuild, scheduleRebuild
} from '../core/engine.js';
import { 
    onSculptStart, onSculptStroke, onSculptStrokeEnd, 
    updatePreviewSculptMode, sculptClear 
} from '../core/sculpt-interaction.js';
import { 
    fusLog, pollMode, startFusionPolling, stopFusionPolling, sendFusionPreview, sendFusionPayloadChunked, sendFusionMeshPreview 
} from '../core/fusion-bridge.js';

import { TerrainPreview } from '../core/preview.js';
import { generateStep, generateThickenedStep } from '../core/stepWriter.js';
import { resolveGrid } from '../core/terrain.js';
import { populateNoiseDropdown } from '../core/noise/index.js';
import { bindTweaksUI, renderTweaksPanel } from '../core/noise/tweaks-ui.js';
import { VectorEditor } from '../editor/index.js';
import { AppState } from './app-state.js';
import { applyParam, updateSculptToolButtons } from './param-manager.js';
import { updateStampMasks, refreshAllStampMasks } from './stamp-mask-manager.js';
import { initApp, initSvgEditor } from './app-init.js';
import { bindControls } from './ui-bindings.js';
import { bindPresets } from './preset-manager.js';
import { applySnapshot } from './snapshot-manager.js';

// --- Global Instances ---
let preview = null;
window.svgEditor = null; // Exposed for editor.js logic


// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    fusLog('[main.js] DOMContentLoaded: Initializing application');

    // Clear last session to reset SVG editor canvas on refresh
    localStorage.removeItem('splineGenLastSession');

    // 1. Initialize 3D Preview
    const canvas = document.getElementById('previewCanvas');
    preview = new TerrainPreview(canvas);
    AppState.preview = preview;

    // 2. UI Hookups & Resizing
    initResizer(preview);
    setupMobileViewportHandling();
    window.addEventListener('resize', () => resizeApp(preview));

    // 2b. Populate noise-type dropdown from the noise modules (single source of truth).
    // Must run before bindControls so listeners read a fully-populated <select>.
    const noiseSelect = document.getElementById('noiseType');
    populateNoiseDropdown(noiseSelect);

    // 2c. Edit-Filter slider panel — per-filter UI knobs from each mode's
    // `tweaks` schema. Render the initial filter and re-render whenever the
    // noise type changes. Slider edits write into P.filterTweaks and trigger
    // a rebuild via scheduleRebuild (debounced; smooth during drag).
    const tweaksPanelEl = document.getElementById('filterTweaksPanel');
    const tweaksBodyEl  = document.getElementById('filterTweaksBody');
    const tweaksResetEl = document.getElementById('filterTweaksReset');
    bindTweaksUI({
        panelEl:  tweaksPanelEl,
        bodyEl:   tweaksBodyEl,
        resetBtnEl: tweaksResetEl,
        getActiveFilterId: () => noiseSelect?.value || 'simplex',
        onChange: () => {
            scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
        },
    });
    renderTweaksPanel(noiseSelect?.value || 'simplex');
    if (noiseSelect) {
        noiseSelect.addEventListener('change', (e) => {
            renderTweaksPanel(e.target.value);
        });
    }

    // 3. Bind ALL Controls (Sidebar, Header, Presets)
    bindControls(preview);
    bindPresets(preview);
    bindHeaderAndSettings();
    if (window.initBsplineTheme) window.initBsplineTheme();

    // 4. Fusion 360 Detection
    // REWIRE 2: Double requestAnimationFrame to yield to browser paint
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            pollMode(
                async () => {
                    fusLog('Fusion 360 Mode Detected');
                    document.body.classList.add('fusion-mode');
                    const dlBtn = document.getElementById('btnDownloadAddin');
                    if (dlBtn) dlBtn.style.display = 'none';
                    const headerBtn = document.getElementById('btnDownload');
                    if (headerBtn) headerBtn.textContent = 'Send to Fusion';
                    // On every Fusion-mode load (including palette hide/re-show HTML reloads),
                    // reset the Apply button to 'OK' so it never shows the default text.
                    const applyBtn = document.getElementById('btnFusionApply');
                    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = 'OK'; }
                    initApp(preview, () => wireGlobalEvents(preview));
                    initSvgEditor(preview);
                },
                async () => {
                    fusLog('Web/Browser Mode Detected');
                    const headerBtn = document.getElementById('btnDownload');
                    if (headerBtn) headerBtn.textContent = 'STEP';
                    initApp(preview, () => wireGlobalEvents(preview));
                    initSvgEditor(preview);
                }
            );
        });
    });

    // Bridge callbacks from Python (onFusionNotify in index.html).
    // Without this, stale polling can continue after first export and re-hide the palette.
    window.addEventListener('fusionHandshake', (ev) => {
        const action = ev?.detail?.action;
        if (!action) return;

        if (action === 'import_ready') {
            stopFusionPolling();
            const btn = document.getElementById('btnFusionApply');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'OK';
            }
            return;
        }

        if (action === 'reset_ui') {
            stopFusionPolling();
            const btn = document.getElementById('btnFusionApply');
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'OK';
            }
            return;
        }

        if (action === 'pong') {
            return;
        }
    });
});

const ADDIN_RELEASE_URL = 'https://github.com/fchabot-dxf/b-spline-generator-web-addin/releases/download/latest/bspline-frame-builder.zip';

function bindHeaderAndSettings() {
    const btnDownload = document.getElementById('btnDownload'); // STEP
    if (btnDownload) btnDownload.addEventListener('click', () => {
        if (isFusionMode) {
            onFusionApply();
        } else {
            onGenerate();
        }
    });

    const btnDownloadAddin = document.getElementById('btnDownloadAddin');
    if (btnDownloadAddin) {
        btnDownloadAddin.addEventListener('click', () => {
            window.location.href = ADDIN_RELEASE_URL;
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

function wireGlobalEvents(preview) {
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') {
                e.preventDefault();
                unifiedUndo(snap => applySnapshot(snap, preview));
            }
            if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) {
                e.preventDefault();
                unifiedRedo(snap => applySnapshot(snap, preview));
            }
        }
    });

    const uBtn = document.getElementById('btnGlobalUndo');
    const rBtn = document.getElementById('btnGlobalRedo');
    if (uBtn) uBtn.addEventListener('click', () => unifiedUndo(snap => applySnapshot(snap, preview)));
    if (rBtn) rBtn.addEventListener('click', () => unifiedRedo(snap => applySnapshot(snap, preview)));

    const clearTop = document.getElementById('btnSculptTopClear');
    const clearBot = document.getElementById('btnSculptBotClear');
    if (clearTop) clearTop.addEventListener('click', () => {
        sculptClear('top', (d) => scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), d));
    });
    if (clearBot) clearBot.addEventListener('click', () => {
        sculptClear('bot', (d) => scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), d));
    });

    const undoTop = document.getElementById('btnSculptTopUndo');
    const undoBot = document.getElementById('btnSculptBotUndo');
    if (undoTop) undoTop.addEventListener('click', () => {
        unifiedUndo(snap => applySnapshot(snap, preview));
    });
    if (undoBot) undoBot.addEventListener('click', () => {
        unifiedUndo(snap => applySnapshot(snap, preview));
    });

    const redoTop = document.getElementById('btnSculptTopRedo');
    const redoBot = document.getElementById('btnSculptBotRedo');
    if (redoTop) redoTop.addEventListener('click', () => {
        unifiedRedo(snap => applySnapshot(snap, preview));
    });
    if (redoBot) redoBot.addEventListener('click', () => {
        unifiedRedo(snap => applySnapshot(snap, preview));
    });
}

// --- PRESET MANAGER ---

// --- EXPORT FLOW ---
function onGenerate() {
    const modal = document.getElementById('exportWizardModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Wizard Option Logic
    const activeLayers = P.stampLayers?.filter(l => l.enabled && l.svg && l.mask && Math.abs(l.depth) > 0.001) || [];
    const hasStamp = activeLayers.length > 0;
    const hasThicken = !!(P.thickenEnabled && lastResult?.thickenData?.offsetPts);

    const check = (id, cond) => {
        const cb = document.getElementById(id);
        const opt = document.getElementById('wizOpt' + id.charAt(3).toUpperCase() + id.slice(4));
        if (cb && opt) {
            cb.disabled = !cond;
            cb.checked = cond;
            opt.classList.toggle('disabled', !cond);
        }
    };

    check('wizCleanSurface', true);
    check('wizCleanSolid', hasThicken);
    check('wizStampedSurface', hasStamp);
    check('wizStampedSolid', hasThicken && hasStamp);

    if (isFusionMode) sendFusionPreview(preview);
    
    const svgCb = document.getElementById('includeSVG');
    if (svgCb) {
        const hasAnySvg = P.stampLayers?.some(l => l.svg && l.enabled);
        svgCb.disabled = !hasAnySvg;
        if (!hasAnySvg) svgCb.checked = false;
    }
}

function closeWizard() {
    const modal = document.getElementById('exportWizardModal');
    if (modal) modal.style.display = 'none';
}

function onFusionApply() {
    if (!lastResult) {
        rebuild(preview, updateStampMasks, updatePreviewSculptMode);
        return;
    }

    const activeLayers = P.stampLayers?.filter(l => l.enabled && l.svg && l.mask && Math.abs(l.depth) > 0.001) || [];
    const hasStamp = activeLayers.length > 0;
    const hasThicken = !!(P.thickenEnabled && lastResult.thickenData?.offsetPts);

    const check = (id) => document.getElementById(id)?.checked;
    
    // Determine batches
    const batches = [];
    if (hasThicken) batches.push({ clean: true, name: 'cleanSolid' });
    if (hasThicken && hasStamp) batches.push({ stamped: true, name: 'stampedSolid' });
    batches.push({ cleanSurf: true, name: 'cleanSurface' });
    if (hasStamp) batches.push({ stampedSurf: true, name: 'stampedSurface' });

    let visibleBatchIndex = -1;
    const priority = ['stampedSolid', 'cleanSolid', 'stampedSurface', 'cleanSurface'];
    for (const p of priority) {
        const idx = batches.findIndex(b => b.name === p);
        if (idx !== -1) {
            visibleBatchIndex = idx;
            break;
        }
    }

    const includeSVG = hasStamp && !!document.getElementById('includeSVG')?.checked;
    console.log('[SVG DEBUG] onFusionApply hasStamp=', hasStamp, 'includeSVG checkbox=', !!document.getElementById('includeSVG')?.checked, 'resolved includeSVG=', includeSVG);

    if (isFusionMode) {
        (async () => {
            const btn = document.getElementById('btnFusionApply');
            if (btn) btn.disabled = true;

            for (let i = 0; i < batches.length; i++) {
                if (btn) btn.textContent = `Baking [${i+1}/${batches.length}]...`;
                
                const batch = batches[i];
                let label = "Terrain";
                if (batch.stamped && batch.clean) label = "Stamped Solid";
                else if (batch.stamped) label = "Stamped Surface";
                else if (batch.clean) label = "Clean Solid";
                else if (batch.cleanSurf) label = "Clean Surface";

                const isAppend = i > 0;
                const options = { 
                    ...batch, 
                    includeSVG: (i === batches.length - 1) && includeSVG,
                    isVisible: (i === visibleBatchIndex)
                };
                
                // Pass the specific label as a filename hint
                const filename = `terrain_${label.replace(/\s+/g, '_').toLowerCase()}.step`;
                await executeExport(options, isAppend, filename);
            }
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'OK';
            }
        })();
    } else {
        const options = {
            clean: hasThicken,
            stamped: hasThicken && hasStamp,
            stampedSurf: hasStamp,
            cleanSurf: true,
            includeSVG: includeSVG
        };
        executeExport(options);
    }
}

function normalizeSvgForCarving(svgText) {
    if (!svgText) return svgText;
    try {
        const viewBoxMatch = svgText.match(/viewBox="([^"]+)"/i);
        let height = null;
        let viewBox = null;
        if (viewBoxMatch) {
            viewBox = viewBoxMatch[1];
            const parts = viewBox.trim().split(/\s+/).map(v => parseFloat(v));
            if (parts.length === 4 && !Number.isNaN(parts[3])) {
                height = parts[3];
            }
        }
        if ((height === null || height <= 0) && svgText.match(/\bheight="([\d.]+)"/i)) {
            height = parseFloat(svgText.match(/\bheight="([\d.]+)"/i)[1]);
        }
        console.log('[SVG DEBUG] normalizeSvgForCarving viewBox=', viewBox, 'height=', height, 'hasTransform=', /transform="translate\(0 [^\)]+\) scale\(1 -1\)"/.test(svgText));
        if (!height || height <= 0) return svgText;

        const flipTransform = `translate(0 ${height}) scale(1 -1)`;
        if (svgText.includes(flipTransform)) {
            console.log('[SVG DEBUG] normalizeSvgForCarving already flipped; returning original');
            return svgText;
        }

        const transformed = svgText.replace(/<svg([^>]*)>/i, `<svg$1><g transform="${flipTransform}">`).replace(/<\/svg>/i, '</g></svg>');
        console.log('[SVG DEBUG] normalizeSvgForCarving applied flip transform');
        return transformed;
    } catch (e) {
        console.warn('normalizeSvgForCarving failed:', e);
        return svgText;
    }
}

async function executeExport(options = null, isAppend = false, filename_hint = null) {
    const btn = isFusionMode 
        ? document.getElementById('btnFusionApply') 
        : document.getElementById('btnWizardExport');

    if (btn && !isAppend) {
        btn.disabled = true;
        btn.textContent = isFusionMode ? 'Baking...' : 'Generating...';
        if (isFusionMode) stopFusionPolling();
    }

    // If options not provided (e.g. direct call from Wizard), pull from Wizard checkboxes
    if (!options) {
        options = {
            clean: document.getElementById('wizCleanSolid').checked,
            stamped: document.getElementById('wizStampedSolid').checked,
            cleanSurf: document.getElementById('wizCleanSurface').checked,
            stampedSurf: document.getElementById('wizStampedSurface').checked,
            includeSVG: document.getElementById('includeSVG').checked
        };
    }

    console.log('[EXPORT DEBUG] options read:', options);
    console.log('[EXPORT DEBUG] wizard toggles:', {
        clean: document.getElementById('wizCleanSolid')?.checked,
        stamped: document.getElementById('wizStampedSolid')?.checked,
        cleanSurf: document.getElementById('wizCleanSurface')?.checked,
        stampedSurf: document.getElementById('wizStampedSurface')?.checked,
        includeSVG: document.getElementById('includeSVG')?.checked
    });

    try {
        const heights = lastResult.heights;
        const offsetPts = lastResult.thickenData?.offsetPts;
        const unstamped = lastResult.cleanHeights || heights;

        const shared = {
            widthIn: P.widthIn,
            heightIn: P.heightIn,
            carveZ: P.carveZ,
            nx: lastResult.nx,
            nz: lastResult.nz,
            orientation: P.exportOrientation,
            options
        };

        const stampCount = options.includeSVG ? P.stampLayers.filter(l => l.enabled && l.svg).length : 0;
        const svgLayerSummary = options.includeSVG ? P.stampLayers.filter(l => l.enabled && l.svg).map((l, i) => ({ idx: i, len: (l.svg || '').length, hasViewBox: /viewBox=/.test(l.svg || '') })) : [];
        console.log('[SVG DEBUG] executeExport orientation=', P.exportOrientation, 'options=', options, 'stampCount=', stampCount, 'svgLayerSummary=', svgLayerSummary);
        if (typeof fusLog === 'function') {
            fusLog(`[COORD_STD] executeExport orientation=${P.exportOrientation} options=${JSON.stringify(options)} stampCount=${stampCount} svgSummary=${JSON.stringify(svgLayerSummary)}`);
        }

        const variants = [
            { key: 'cleanSurf', label: 'cleanSurface', fileLabel: 'clean-surface', opts: { cleanSurf: true } },
            { key: 'clean', label: 'cleanSolid', fileLabel: 'clean-solid', opts: { clean: true } },
            { key: 'stampedSurf', label: 'stampedSurface', fileLabel: 'stamped-surface', opts: { stampedSurf: true } },
            { key: 'stamped', label: 'stampedSolid', fileLabel: 'stamped-solid', opts: { stamped: true } }
        ];

        const selectedVariants = variants.filter(v => options[v.key]);
        const layersToExport = options.includeSVG ? P.stampLayers.filter(l => l.enabled && l.svg) : [];
        console.log('[EXPORT DEBUG] selectedVariants=', selectedVariants.map(v => v.label));
        console.log('[EXPORT DEBUG] layersToExport=', layersToExport.length, layersToExport.map((l, i) => ({ index: i + 1, profile: l.profile, hasViewBox: /viewBox=/.test(l.svg || '') })));

        if (isFusionMode) {
            const stepText = generateThickenedStep(heights, offsetPts, shared, unstamped);
            const payload = JSON.stringify({
                params: { ...P },
                stepText,
                filename: filename_hint || `B-Spline-${Date.now()}.step`,
                isSolid: options.clean || options.stamped,
                isPreview: false,
                isAppend: isAppend,
                isVisible: options.isVisible !== undefined ? options.isVisible : true,
                stamp: {
                    enabled: options.includeSVG,
                    layers: options.includeSVG ? layersToExport.map((l, i) => ({
                        index: i + 1,
                        config: { profile: l.profile, depth: l.depth },
                        svg: normalizeSvgForCarving(l.svg)
                    })) : [],
                    dpi: 96
                }
            });
            if (typeof fusLog === 'function') {
                fusLog(`[SVG DEBUG] sendFusionPayload payload stepLen=${stepText.length} stampEnabled=${options.includeSVG} stampLayers=${layersToExport.length}`);
            }
            await sendFusionPayloadChunked(payload);
            if (!isAppend) startFusionPolling(btn);
        } else {
            const exportFiles = [];

            if (selectedVariants.length > 0) {
                for (const variant of selectedVariants) {
                    const variantOptions = {
                        ...shared,
                        options: { ...variant.opts }
                    };
                    const variantText = generateThickenedStep(heights, offsetPts, variantOptions, unstamped);
                    exportFiles.push({
                        name: `B-Spline-${variant.fileLabel}.step`,
                        blob: new Blob([variantText], { type: 'text/plain' })
                    });
                }
            } else {
                const stepText = generateThickenedStep(heights, offsetPts, shared, unstamped);
                exportFiles.push({
                    name: `B-Spline-${Date.now()}.step`,
                    blob: new Blob([stepText], { type: 'text/plain' })
                });
            }

            if (options.includeSVG && layersToExport.length > 0) {
                layersToExport.forEach((l, i) => {
                    exportFiles.push({
                        name: `B-Spline-artwork-layer-${i+1}.svg`,
                        blob: new Blob([normalizeSvgForCarving(l.svg)], { type: 'image/svg+xml' })
                    });
                });
            }

            console.log('[EXPORT DEBUG] exportFiles=', exportFiles.map(f => f.name));
            console.log('[EXPORT DEBUG] falling back to saveAs/ZIP fallback, exportFiles length=', exportFiles.length);
            if (exportFiles.length > 1 && typeof JSZip !== 'undefined') {
                const zip = new JSZip();
                exportFiles.forEach(file => zip.file(file.name, file.blob));
                const blob = await zip.generateAsync({ type: 'blob' });
                saveAs(blob, `B-Spline-${Date.now()}_export.zip`);
            } else {
                const file = exportFiles[0];
                console.log('[EXPORT DEBUG] saving single file=', file.name);
                saveAs(file.blob, file.name);
            }

            if (btn) { btn.disabled = false; btn.textContent = 'Export STEP ✨'; }
            closeWizard();
        }
    } catch (e) {
        console.error('Export Failed:', e);
        if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
    }
}