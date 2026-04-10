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
} from './state.js';
import { 
    bind, syncPair, syncUItoParam, updateSpacingLabels, 
    initResizer, resizeApp, setupMobileViewportHandling 
} from './ui-utils.js';
import { 
    takeSnapshot, unifiedUndo, unifiedRedo, updateGlobalButtons, isEditorOpen 
} from './history.js';
import { 
    rebuild, scheduleRebuild, updateEditorTopView 
} from './engine.js';
import { 
    onSculptStart, onSculptStroke, onSculptStrokeEnd, 
    updatePreviewSculptMode, sculptClear 
} from './sculpt-interaction.js';
import { 
    fusLog, pollMode, startFusionPolling, stopFusionPolling, sendFusionPreview, sendFusionPayloadChunked, sendFusionMeshPreview 
} from './fusion-bridge.js';

import { TerrainPreview } from './preview.js';
import { rasterizeSvg } from './stamp.js';
import { generateStep, generateThickenedStep } from './stepWriter.js';
import { resolveGrid } from './terrain.js';
import { VectorEditor } from './editor.js';

// --- Global Instances ---
let preview = null;
window.svgEditor = null; // Exposed for editor.js logic

// Track last grid resolution for applyParam
let lastNx = null;
let lastNz = null;

// REWIRE 1: Flag to prevent redundant rebuilds during the massive localStorage restoration
let isInitializing = false;

function updateSculptToolButtons() {
    const ids = ['btnToolTopDraw', 'btnToolTopSmooth', 'btnToolBotDraw', 'btnToolBotSmooth'];
    ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
    if (!P.activeSculptLayer) return;

    const layerName = P.activeSculptLayer.charAt(0).toUpperCase() + P.activeSculptLayer.slice(1);
    const mode = P.activeSculptLayer === 'top' ? P.sculptTopMode : P.sculptBotMode;
    const activeId = `btnTool${layerName}${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
    document.getElementById(activeId)?.classList.add('active');
}

/**
 * The central parameter application sink.
 */
function applyParam(key, value) {
    console.log(`[DEBUG] applyParam called: key=${key}, value=${value}`);
    updateP(key, value);
    syncUItoParam(key, value);
    
    if (key === 'widthIn' || key === 'heightIn') {
        updateSpacingLabels(P.widthIn, P.heightIn);
    }
    
    if (key === 'activeSculptLayer' || key === 'sculptTopMode' || key === 'sculptBotMode') {
        console.log(`[DEBUG] applyParam triggers updatePreviewSculptMode: key=${key}, value=${value}`);
        updatePreviewSculptMode(preview, scheduleRebuild);
        updateSculptToolButtons();
    }
    
    if (key === 'showMesh') {
        preview.setCurvesVisible(value);
    }

    if (key === 'thickenEnabled') {
        const thickenCon = document.getElementById('thickenOptions');
        if (thickenCon) thickenCon.style.display = value ? 'flex' : 'none';
    }

    if (key === 'thickenWireframe') {
        // Trigger immediate rebuild so wireframe/shaded toggle takes effect.
        scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), 0);
    }

    const immediateRebuildParams = [
        'widthIn', 'heightIn', 'spacing', 'seed', 'noiseType', 
        'symmetry', 'carveZ', 'scale', 'macroScale', 'warpIntensity',
        'thickenEnabled', 'thickness', 'thickenDir', 'thickenMode',
        'edgeMarginIn', 'stampDepth', 'stampBlur', 'stampSmoothingRadius',
        'stampEdgeFilletRadius', 'stampFilletPower', 'stampProfile'
    ];

    if (key === 'stampProfile') {
        const vBitExtra = document.getElementById('vBitAngleContainer');
        if (vBitExtra) vBitExtra.style.display = (value === 'vbit' || value === 'adaptive') ? 'block' : 'none';
    }

    // Parameters that require a full SVG re-rasterize of the stamp mask.
    // NOTE: stampDepth is intentionally excluded — the mask is now normalized 0..1
    // and depth is applied at render time, so depth changes are instant.
    const stampMaskParams = [
        'stampBlur', 'stampSmoothingRadius',
        'stampEdgeFilletRadius', 'stampFilletPower',
        'stampProfile', 'stampVBitAngle'
    ];

    const delay = immediateRebuildParams.includes(key) ? 0 : 200;
    if (!isInitializing) {
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        if (nx !== lastNx || nz !== lastNz || stampMaskParams.includes(key)) {
            // Resolution changed OR a stamp mask param changed: must re-rasterize first
            refreshAllStampMasks(nx, nz);
        } else {
            scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), delay);
        }
        lastNx = nx;
        lastNz = nz;
    }
}

/**
 * Pure data update: Re-rasterizes all active SVG stamp layers.
 */
async function updateStampMasks(nx, nz) {
    if (!P.stampLayers) return;
    const promises = P.stampLayers.map(async (layer, idx) => {
        if (!layer.svg || !layer.enabled) return;
        // rasterizeSvg(svgText, nx, nz, blurIn, widthIn, heightIn, stampProfile, stampDepth, stampVBitAngle, edgeFilletRadius, filletPower)
        const blurIn            = layer.blur             ?? 0;
        const stampProfile      = layer.profile          ?? P.stampProfile;
        const stampDepth        = layer.depth            ?? P.stampDepth;
        const stampVBitAngle    = layer.angle            ?? P.stampVBitAngle;
        const edgeFilletRadius  = layer.edgeFilletRadius ?? P.stampEdgeFilletRadius ?? 0;
        const filletPower       = layer.filletPower      ?? P.stampFilletPower ?? 2.2;
        const result = await rasterizeSvg(
            layer.svg,
            nx,
            nz,
            blurIn,
            P.widthIn,
            P.heightIn,
            stampProfile,
            stampDepth,
            stampVBitAngle,
            edgeFilletRadius,
            filletPower
        );
        // result is a Float32Array depth mask — set it without touching the suppression scalar
        setStampLayerMask(idx, result);
    });
    await Promise.all(promises);
}

/**
 * Re-rasterizes all active SVG stamp layers and triggers a 3D rebuild.
 */
async function refreshAllStampMasks(nx, nz) {
    try {
        await updateStampMasks(nx, nz);
        scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView));
    } catch (e) {
        console.error('Failed to refresh stamp masks:', e);
    }
}

// --- BOOTSTRAP ---
document.addEventListener('DOMContentLoaded', () => {
    fusLog('[main.js] DOMContentLoaded: Initializing application');

    // Clear last session to reset SVG editor canvas on refresh
    localStorage.removeItem('splineGenLastSession');

    // 1. Initialize 3D Preview
    const canvas = document.getElementById('previewCanvas');
    preview = new TerrainPreview(canvas);

    // 2. UI Hookups & Resizing
    initResizer(preview);
    setupMobileViewportHandling();
    window.addEventListener('resize', () => resizeApp(preview));
    
    // 3. Bind ALL Controls (Sidebar, Header, Presets)
    bindControls();
    bindPresets();
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
                    initApp();
                    initSvgEditor();
                },
                async () => {
                    fusLog('Web/Browser Mode Detected');
                    const headerBtn = document.getElementById('btnDownload');
                    if (headerBtn) headerBtn.textContent = 'STEP';
                    initApp();
                    initSvgEditor();
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

async function initApp() {
    // REWIRE 3: Lock engine during session load
    isInitializing = true;
    loadLastSession();
    // 6. Batch Sync UI
    Object.keys(P).forEach(k => syncUItoParam(k, P[k]));
    updateSpacingLabels(P.widthIn, P.heightIn);
    
    // Synchronize preview state with loaded P
    if (preview) preview.setCurvesVisible(P.showMesh);
    
    isInitializing = false;
    // 7. Initial Rebuild
    let grid = lastResult ?? resolveGrid(P.widthIn, P.heightIn, P.spacing);
    if (!grid.nx || grid.nx < 4 || !grid.nz || grid.nz < 4) {
        grid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    }
    const { nx, nz } = grid;
    
    if (P.stampLayers && P.stampLayers.some(l => l.svg)) {
        await refreshAllStampMasks(nx, nz);
    } else {
        rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView);
    }
    
    updateGlobalButtons();

    // 8. Wire up Global Actions
    wireGlobalEvents();
}

/**
 * Initializes the SVG Editor instance and its callbacks.
 */
function initSvgEditor() {
    if (!window.svgEditor) window.svgEditor = new VectorEditor();
    
    window.svgEditor.initEditor(
        'editorSVGContainer',
        'svgEditorTopView',
        () => {
            // v42: Real-time stamping sync (Debounced via scheduleRebuild)
            const svg = window.svgEditor.save();
            if (svg) {
                setStampLayerSvg(P.activeLayerIdx, svg);
                const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
                // Trigger an immediate mask refresh and 3D rebuild
                refreshAllStampMasks(nx, nz);
            }
        },
        (svg) => {
            if (svg === 'push') return; // History push only
            if (svg) {
                setStampLayerSvg(P.activeLayerIdx, svg);
                const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
                refreshAllStampMasks(nx, nz);
            }
            const modal = document.getElementById('svgEditorModal');
            if (modal) modal.style.display = 'none';
        }
    );
}

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
            window.location.href = './b-spline-gen.zip';
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

function bindControls() {
    // 1. Generic Bindings for all parameters in P
    Object.keys(P).forEach(key => {
        const el = document.getElementById(key);
        if (!el) return;

        let type = 'number';
        if (el.tagName === 'SELECT') type = 'select';
        if (el.type === 'checkbox') type = 'checkbox';
        if (el.type === 'text') type = 'string';

        bind(key, type, v => applyParam(key, v));
    });

    // 2. Synchronize Slider Pairs
    Object.keys(SLIDER_PAIRS).forEach(key => {
        syncPair(key, SLIDER_PAIRS[key]);
    });

    // 3. Special Case: Panel Visibility & Logic
    const bindTogglePanel = (id, targetId) => {
        const cb = document.getElementById(id);
        const panel = document.getElementById(targetId);
        if (cb && panel) {
            cb.addEventListener('change', () => {
                panel.style.display = cb.checked ? 'flex' : 'none';
            });
            panel.style.display = cb.checked ? 'flex' : 'none';
        }
    };

    bindTogglePanel('thickenEnabled', 'thickenOptions');

    // 4. Sculpt Tool Buttons
    const updateSculptToolButtons = () => {
        const ids = ['btnToolTopDraw', 'btnToolTopSmooth', 'btnToolBotDraw', 'btnToolBotSmooth'];
        ids.forEach(id => document.getElementById(id)?.classList.remove('active'));
        if (!P.activeSculptLayer) return;

        const layerName = P.activeSculptLayer.charAt(0).toUpperCase() + P.activeSculptLayer.slice(1);
        const mode = P.activeSculptLayer === 'top' ? P.sculptTopMode : P.sculptBotMode;
        const activeId = `btnTool${layerName}${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
        document.getElementById(activeId)?.classList.add('active');
    };

    const bindToolBtn = (btnId, layer, mode) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                // Log button press for Draw and Smooth
                console.log(`[DEBUG] Sculpt ${layer} ${mode} button pressed`);
                // Activate this layer so updatePreviewSculptMode knows which surface to sculpt
                applyParam('activeSculptLayer', layer);
                applyParam(layer === 'top' ? 'sculptTopMode' : 'sculptBotMode', mode);
                updateSculptToolButtons();
            });
        }
    };

    // Initialize sculpt tool button state at startup.
    updateSculptToolButtons();
    bindToolBtn('btnToolTopDraw', 'top', 'draw');
    bindToolBtn('btnToolTopSmooth', 'top', 'smooth');
    bindToolBtn('btnToolBotDraw', 'bot', 'draw');
    bindToolBtn('btnToolBotSmooth', 'bot', 'smooth');

    // 5. Special Case: Stamp Profile Display & Logic
    const stampProfile = document.getElementById('stampProfile');
    if (stampProfile) {
        const updateStampUI = () => {
            const container = document.getElementById('vBitAngleContainer');
            if (container) container.style.display = (stampProfile.value === 'vbit' || stampProfile.value === 'adaptive') ? 'block' : 'none';
        };
        stampProfile.addEventListener('change', () => {
            updateStampUI();
            const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
            refreshAllStampMasks(nx, nz);
        });
        updateStampUI();
    }

    // 6. Stamp Depth Steppers
    const bindStepper = (minusId, plusId, targetId, step) => {
        const m = document.getElementById(minusId);
        const p = document.getElementById(plusId);
        const t = document.getElementById(targetId);
        if (m && p && t) {
            m.addEventListener('click', () => {
                const val = parseFloat(t.value) - step;
                applyParam(targetId, parseFloat(val.toFixed(3)));
            });
            p.addEventListener('click', () => {
                const val = parseFloat(t.value) + step;
                applyParam(targetId, parseFloat(val.toFixed(3)));
            });
        }
    };
    bindStepper('stampDepthMinus', 'stampDepthPlus', 'stampDepth', 0.05);

    const attachNumberSteppers = () => {
        const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
        inputs.forEach(input => {
            if (!input.isConnected) return;
            if (input.closest('.stepper-container')) return;
            if (input.closest('label')?.classList.contains('no-stepper')) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'stepper-container';

            const minus = document.createElement('button');
            minus.type = 'button';
            minus.className = 'stepper-btn';
            minus.textContent = '−';

            const plus = document.createElement('button');
            plus.type = 'button';
            plus.className = 'stepper-btn';
            plus.textContent = '+';

            const step = Number(input.step) || 1;
            const min = input.min !== '' ? Number(input.min) : -Infinity;
            const max = input.max !== '' ? Number(input.max) : Infinity;

            const clamp = (value) => {
                if (!Number.isFinite(value)) return input.value;
                return Math.min(max, Math.max(min, value));
            };

            const adjust = (delta) => {
                const current = Number(input.value);
                const next = Number.isFinite(current) ? current + delta : delta;
                input.value = clamp(Number(next.toFixed(10)));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            };

            minus.addEventListener('click', () => adjust(-step));
            plus.addEventListener('click', () => adjust(step));

            input.parentNode.insertBefore(wrapper, input);
            wrapper.appendChild(minus);
            wrapper.appendChild(input);
            wrapper.appendChild(plus);
        });
    };

    attachNumberSteppers();

    // 7. Stamp File Handling
    const btnStampChoose = document.getElementById('btnStampChoose');
    const stampUpload = document.getElementById('stampUpload');
    if (btnStampChoose && stampUpload) {
        btnStampChoose.addEventListener('click', () => stampUpload.click());
        stampUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const fileNameSpan = document.getElementById('stampFileName');
            if (fileNameSpan) fileNameSpan.textContent = file.name;
            const text = await file.text();
            setStampLayerSvg(P.activeLayerIdx, text);
            const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
            refreshAllStampMasks(nx, nz);
        });
    }

    const btnStampClear = document.getElementById('btnStampClear');
    if (btnStampClear) {
        btnStampClear.addEventListener('click', () => {
            setStampLayerSvg(P.activeLayerIdx, null);
            setStampLayerMask(P.activeLayerIdx, null);
            const fileNameSpan = document.getElementById('stampFileName');
            if (fileNameSpan) fileNameSpan.textContent = 'No file chosen';
            scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), 0);
        });
    }

    // 8. Vector Editor Open
    const btnStampEdit = document.getElementById('btnStampEdit');
    if (btnStampEdit) {
        btnStampEdit.addEventListener('click', () => {
            const modal = document.getElementById('svgEditorModal');
            if (modal) {
                modal.style.display = 'flex';
                const currentLayer = P.stampLayers[P.activeLayerIdx];
                if (window.svgEditor && currentLayer) window.svgEditor.open(currentLayer.svg, P.widthIn, P.heightIn);
            }
        });
    }

    // 9. Stamp Layer Selector
    const stampActiveLayer = document.getElementById('stampActiveLayer');
    if (stampActiveLayer) {
        stampActiveLayer.addEventListener('change', () => {
            const idx = parseInt(stampActiveLayer.value, 10);
            updateP('activeLayerIdx', idx);
            const layer = P.stampLayers[idx];
            if (layer) {
                // Sync ALL controls to the newly selected layer's values
                syncUItoParam('stampDepth',               layer.depth);
                syncUItoParam('stampProfile',             layer.profile);
                syncUItoParam('stampVBitAngle',           layer.angle);
                syncUItoParam('stampBlur',                layer.blur);
                syncUItoParam('stampSmoothingRadius',     layer.smoothing);
                syncUItoParam('stampTextureSuppression',  layer.suppression);
                syncUItoParam('stampEdgeFilletRadius',    layer.edgeFilletRadius);
                syncUItoParam('stampFilletPower',         layer.filletPower);
                
                // Toggle V-Bit Angle visibility based on the newly selected layer's profile
                const vBitAngleContainer = document.getElementById('vBitAngleContainer');
                if (vBitAngleContainer) {
                    vBitAngleContainer.style.display = (layer.profile === 'vbit' || layer.profile === 'adaptive') ? 'block' : 'none';
                }

                const fileNameSpan = document.getElementById('stampFileName');
                if (fileNameSpan) fileNameSpan.textContent = layer.svg ? 'Loaded' : 'No file chosen';

                // If editor is open/exists, sync it
                if (window.svgEditor) {
                  window.svgEditor.open(layer.svg || "", P.widthIn, P.heightIn);
                }
            }
        });
    }

    // 10. Auto Thicken Button
    const btnAutoThickenThin = document.getElementById('btnAutoThickenThin');
    if (btnAutoThickenThin) {
        btnAutoThickenThin.addEventListener('click', () => {
            fusLog('Auto Thicken Thin Parts triggered');
            // This logic is usually deep in the engine; we trigger a rebuild with a flag or special param if needed
            // For now, ensure the params are synced and trigger a full analysis rebuild
            scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), 0);
        });
    }

    // 11. Max Safe Thickness Button
    const btnUseMaxSafe = document.getElementById('btnUseMaxSafe');
    if (btnUseMaxSafe) {
        btnUseMaxSafe.addEventListener('click', () => {
            const maxSafe = lastResult?.thickenData?.maxSafe || 0;
            if (maxSafe > 0) applyParam('thickness', parseFloat(maxSafe.toFixed(3)));
        });
    }

    // 12. Wizard Listeners
    const btnWizardCancel = document.getElementById('btnWizardCancel');
    if (btnWizardCancel) btnWizardCancel.addEventListener('click', closeWizard);
    
    const btnWizardExport = document.getElementById('btnWizardExport');
    if (btnWizardExport) btnWizardExport.addEventListener('click', () => executeExport());

    // 13. Fusion 360 Action Bar
    const btnFusionApply = document.getElementById('btnFusionApply');
    const btnFusionCancel = document.getElementById('btnFusionCancel');
    if (btnFusionApply) btnFusionApply.addEventListener('click', onFusionApply); 
    if (btnFusionCancel) {
        btnFusionCancel.addEventListener('click', () => {
            try { 
                if (typeof adsk !== 'undefined') adsk.fusionSendData('cancel', '{}'); 
                else window.close(); 
            } catch (e) { console.error('Fusion cancel failed:', e); }
        });
    }
}

function wireGlobalEvents() {
    window.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') {
                e.preventDefault();
                unifiedUndo(snap => applySnapshot(snap));
            }
            if (e.key === 'y' || (e.key === 'Z' && e.shiftKey)) {
                e.preventDefault();
                unifiedRedo(snap => applySnapshot(snap));
            }
        }
    });

    const uBtn = document.getElementById('btnGlobalUndo');
    const rBtn = document.getElementById('btnGlobalRedo');
    if (uBtn) uBtn.addEventListener('click', () => unifiedUndo(snap => applySnapshot(snap)));
    if (rBtn) rBtn.addEventListener('click', () => unifiedRedo(snap => applySnapshot(snap)));

    const clearTop = document.getElementById('btnSculptTopClear');
    const clearBot = document.getElementById('btnSculptBotClear');
    if (clearTop) clearTop.addEventListener('click', () => {
        sculptClear('top', (d) => scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), d));
    });
    if (clearBot) clearBot.addEventListener('click', () => {
        sculptClear('bot', (d) => scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), d));
    });

    const undoTop = document.getElementById('btnSculptTopUndo');
    const undoBot = document.getElementById('btnSculptBotUndo');
    if (undoTop) undoTop.addEventListener('click', () => {
        unifiedUndo(snap => applySnapshot(snap));
    });
    if (undoBot) undoBot.addEventListener('click', () => {
        unifiedUndo(snap => applySnapshot(snap));
    });

    const redoTop = document.getElementById('btnSculptTopRedo');
    const redoBot = document.getElementById('btnSculptBotRedo');
    if (redoTop) redoTop.addEventListener('click', () => {
        unifiedRedo(snap => applySnapshot(snap));
    });
    if (redoBot) redoBot.addEventListener('click', () => {
        unifiedRedo(snap => applySnapshot(snap));
    });
}

function applySnapshot(snap) {
    if (!snap) return;
    isInitializing = true;
    Object.keys(snap.P).forEach(k => {
        P[k] = snap.P[k];
        syncUItoParam(k, P[k]);
    });
    isInitializing = false;
    if (snap.preDelta) setPreDelta(new Float32Array(snap.preDelta));
    if (snap.postDelta) setPostDelta(new Float32Array(snap.postDelta));
    // Legacy support: if snap had stampSvgText, push it into layer0
    if (snap.stampSvgText !== undefined && P.stampLayers && P.stampLayers[0]) {
        P.stampLayers[0].svg = snap.stampSvgText;
    }
    updateGlobalButtons();
    scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView), 0);
}

// --- PRESET MANAGER ---
function bindPresets() {
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
        applySnapshot(snap);
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
        rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView);
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