/**
 * Export flow — the "Export STEP" / "Send to Fusion" pipeline.
 *
 *   onGenerate(preview)   opens the export wizard modal and runs the
 *                         option-availability checks (Clean Surface vs
 *                         Solid, Stamped Surface vs Solid, includeSVG).
 *   onFusionApply(preview) one-shot Fusion path: skip the wizard and
 *                         send the current scene to Python directly.
 *   executeExport(preview, options, isAppend, filename_hint)
 *                         the actual export — generates STEP text,
 *                         packages SVG layers, sends via Fusion bridge
 *                         or downloads via FileSaver/JSZip.
 *   closeWizard()         dismiss the wizard modal.
 */

import { P, lastResult, isFusionMode } from '../core/state.js';
import { rebuild } from '../core/engine.js';
import { generateThickenedStep } from '../core/stepWriter.js';
import {
    fusLog,
    sendFusionPreview,
    sendFusionPayloadChunked,
    startFusionPolling,
    stopFusionPolling,
} from '../core/fusion-bridge.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { normalizeSvgForCarving } from '../core/svg-utils.js';

// ── Stamp-layer helpers ──────────────────────────────────────────────────
//
// Two filters with different semantics:
//   • activeStampLayers: layers that actually carve (have mask + non-trivial
//     depth). Drives wizard option availability and onFusionApply's hasStamp.
//   • exportableStampLayers: layers with payload to ship (have svg). Looser
//     because the SVG can be exported even before its mask has been baked.
//     Used by includeSVG. Mask-less layers contribute artwork but no carve.
const isCarvingLayer = (l) => l.enabled && l.svg && l.mask && Math.abs(l.depth) > 0.001;
const hasShippableSvg = (l) => l.enabled && l.svg;

const activeStampLayers     = () => P.stampLayers?.filter(isCarvingLayer)   || [];
const exportableStampLayers = () => P.stampLayers?.filter(hasShippableSvg) || [];

// ── Wizard option assembly ───────────────────────────────────────────────

/** Build the export options object from explicit booleans (Fusion direct path). */
function defaultExportOptions(hasThicken, hasStamp, includeSVG) {
    return {
        clean:       hasThicken,
        stamped:     hasThicken && hasStamp,
        cleanSurf:   true,
        stampedSurf: hasStamp,
        includeSVG,
    };
}

/** Read the export options object from the wizard modal's checkboxes. */
function readWizardOptions() {
    const checked = (id) => !!document.getElementById(id)?.checked;
    return {
        clean:       checked('wizCleanSolid'),
        stamped:     checked('wizStampedSolid'),
        cleanSurf:   checked('wizCleanSurface'),
        stampedSurf: checked('wizStampedSurface'),
        includeSVG:  checked('includeSVG'),
    };
}

export function onGenerate(preview) {
    const modal = document.getElementById('exportWizardModal');
    if (!modal) return;
    modal.style.display = 'flex';

    const hasStamp   = activeStampLayers().length > 0;
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
    check('wizCleanSolid',   hasThicken);
    check('wizStampedSurface', hasStamp);
    check('wizStampedSolid',   hasThicken && hasStamp);

    if (isFusionMode) sendFusionPreview(preview);

    const svgCb = document.getElementById('includeSVG');
    if (svgCb) {
        const hasAnySvg = exportableStampLayers().length > 0;
        svgCb.disabled = !hasAnySvg;
        if (!hasAnySvg) svgCb.checked = false;
    }
}

export function closeWizard() {
    const modal = document.getElementById('exportWizardModal');
    if (modal) modal.style.display = 'none';
}

export function onFusionApply(preview) {
    if (!lastResult) {
        rebuild(preview, updateStampMasks, updatePreviewSculptMode);
        return;
    }

    const hasStamp   = activeStampLayers().length > 0;
    const hasThicken = !!(P.thickenEnabled && lastResult.thickenData?.offsetPts);

    // Single-batch export (post-architectural-rewrite):
    // Previously this function split the export into 1-4 batches and sent
    // each as a separate STEP file with isAppend=true. The Python side then
    // had to merge them across components, which is the worst-supported
    // operation in Fusion's API and produced a long string of workarounds
    // (CopyPasteBodies dangling refs, BaseFeature held-ref invalidation,
    // orphan tracking, etc.).
    //
    // The right architecture is: ONE export call, ONE STEP file, ONE Python
    // import. stepWriter.js's generateThickenedStep already supports
    // multiple bodies per file, and groups them by 'base' ('Clean',
    // 'Stamped') into separate PRODUCTs so Fusion imports them as two
    // components with two bodies each ('panel' + 'surface'). No cross-
    // component body merge ever needs to happen.
    const includeSVG = hasStamp && !!document.getElementById('includeSVG')?.checked;
    const options = { ...defaultExportOptions(hasThicken, hasStamp, includeSVG), isVisible: true };

    if (isFusionMode) {
        (async () => {
            const btn = document.getElementById('btnFusionApply');
            if (btn) {
                btn.disabled    = true;
                btn.textContent = 'Baking...';
            }
            try {
                await executeExport(preview, options, false, 'B-Spline.step');
            } finally {
                if (btn) {
                    btn.disabled    = false;
                    btn.textContent = 'OK';
                }
            }
        })();
    } else {
        executeExport(preview, options);
    }
}

export async function executeExport(preview, options = null, isAppend = false, filename_hint = null) {
    const btn = isFusionMode
        ? document.getElementById('btnFusionApply')
        : document.getElementById('btnWizardExport');

    if (btn && !isAppend) {
        btn.disabled = true;
        btn.textContent = isFusionMode ? 'Baking...' : 'Generating...';
        if (isFusionMode) stopFusionPolling();
    }

    if (!options) options = readWizardOptions();

    try {
        const heights   = lastResult.heights;
        const offsetPts = lastResult.thickenData?.offsetPts;
        const unstamped = lastResult.cleanHeights || heights;

        const shared = {
            widthIn: P.widthIn,
            heightIn: P.heightIn,
            carveZ: P.carveZ,
            nx: lastResult.nx,
            nz: lastResult.nz,
            orientation: P.exportOrientation,
            options,
        };

        const variants = [
            { key: 'cleanSurf',   label: 'cleanSurface',   fileLabel: 'clean-surface',   opts: { cleanSurf: true } },
            { key: 'clean',       label: 'cleanSolid',     fileLabel: 'clean-solid',     opts: { clean: true } },
            { key: 'stampedSurf', label: 'stampedSurface', fileLabel: 'stamped-surface', opts: { stampedSurf: true } },
            { key: 'stamped',     label: 'stampedSolid',   fileLabel: 'stamped-solid',   opts: { stamped: true } },
        ];
        const selectedVariants = variants.filter(v => options[v.key]);
        const layersToExport   = options.includeSVG ? exportableStampLayers() : [];

        if (isFusionMode) {
            await sendToFusion({
                shared, heights, offsetPts, unstamped,
                options, layersToExport,
                isAppend, filename_hint, btn,
            });
        } else {
            await downloadFiles({
                shared, heights, offsetPts, unstamped,
                selectedVariants, layersToExport, btn,
            });
        }
    } catch (e) {
        console.error('Export Failed:', e);
        if (btn) { btn.disabled = false; btn.textContent = 'Try Again'; }
    }
}

async function sendToFusion({ shared, heights, offsetPts, unstamped, options, layersToExport, isAppend, filename_hint, btn }) {
    // Per-base STEP files. Each PRODUCT in its own file → Fusion's multi-
    // PRODUCT auto-wrapper never triggers, so each variant imports as a
    // single component directly under B-Spline Set with both panel and
    // surface bodies inside it.
    const bases = [];
    if (options.clean   || options.cleanSurf)   bases.push('Clean');
    if (options.stamped || options.stampedSurf) bases.push('Stamped');

    const stepVariants = bases
        .map(baseName => ({
            name: baseName,
            stepText: generateThickenedStep(heights, offsetPts,
                { ...shared, baseFilter: baseName }, unstamped),
        }))
        .filter(v => v.stepText && v.stepText.length > 0);

    if (stepVariants.length === 0) {
        if (typeof fusLog === 'function') fusLog('[EXPORT] No bodies selected; skipping Fusion send.');
        if (btn) { btn.disabled = false; btn.textContent = 'OK'; }
        return;
    }

    const totalLen = stepVariants.reduce((s, v) => s + v.stepText.length, 0);
    const payload = JSON.stringify({
        params: { ...P },
        stepVariants,
        filename: filename_hint || `B-Spline-${Date.now()}.step`,
        isPreview: false,
        isAppend,
        isVisible: options.isVisible !== undefined ? options.isVisible : true,
        stamp: {
            enabled: options.includeSVG,
            layers: options.includeSVG ? layersToExport.map((l, i) => ({
                index: i + 1,
                config: { profile: l.profile, depth: l.depth },
                svg: normalizeSvgForCarving(l.svg),
            })) : [],
            dpi: 96,
        },
    });
    if (typeof fusLog === 'function') {
        fusLog(`[EXPORT] variants=${stepVariants.length} bases=${stepVariants.map(v => v.name).join(',')} totalStepLen=${totalLen} stampLayers=${layersToExport.length}`);
    }
    await sendFusionPayloadChunked(payload);
    if (!isAppend) startFusionPolling(btn);
}

async function downloadFiles({ shared, heights, offsetPts, unstamped, selectedVariants, layersToExport, btn }) {
    const exportFiles = [];

    if (selectedVariants.length > 0) {
        for (const variant of selectedVariants) {
            const variantOptions = { ...shared, options: { ...variant.opts } };
            const variantText = generateThickenedStep(heights, offsetPts, variantOptions, unstamped);
            exportFiles.push({
                name: `B-Spline-${variant.fileLabel}.step`,
                blob: new Blob([variantText], { type: 'text/plain' }),
            });
        }
    } else {
        const stepText = generateThickenedStep(heights, offsetPts, shared, unstamped);
        exportFiles.push({
            name: `B-Spline-${Date.now()}.step`,
            blob: new Blob([stepText], { type: 'text/plain' }),
        });
    }

    if (layersToExport.length > 0) {
        layersToExport.forEach((l, i) => {
            exportFiles.push({
                name: `B-Spline-artwork-layer-${i + 1}.svg`,
                blob: new Blob([normalizeSvgForCarving(l.svg)], { type: 'image/svg+xml' }),
            });
        });
    }

    if (exportFiles.length > 1 && typeof JSZip !== 'undefined') {
        const zip = new JSZip();
        exportFiles.forEach(file => zip.file(file.name, file.blob));
        const blob = await zip.generateAsync({ type: 'blob' });
        saveAs(blob, `B-Spline-${Date.now()}_export.zip`);
    } else {
        const file = exportFiles[0];
        saveAs(file.blob, file.name);
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Export STEP ✨'; }
    closeWizard();
}
