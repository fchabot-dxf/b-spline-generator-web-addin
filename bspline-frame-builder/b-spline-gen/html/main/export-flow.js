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
 *
 * normalizeSvgForCarving lives here because it's only used by the
 * export path and only needs to survive one round-trip to Python.
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

export function onGenerate(preview) {
    const modal = document.getElementById('exportWizardModal');
    if (!modal) return;
    modal.style.display = 'flex';

    // Wizard option availability: each toggle's enabled-ness depends on
    // what the current scene actually contains.
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

export function closeWizard() {
    const modal = document.getElementById('exportWizardModal');
    if (modal) modal.style.display = 'none';
}

export function onFusionApply(preview) {
    if (!lastResult) {
        rebuild(preview, updateStampMasks, updatePreviewSculptMode);
        return;
    }

    const activeLayers = P.stampLayers?.filter(l => l.enabled && l.svg && l.mask && Math.abs(l.depth) > 0.001) || [];
    const hasStamp = activeLayers.length > 0;
    const hasThicken = !!(P.thickenEnabled && lastResult.thickenData?.offsetPts);

    // Single-batch export (post-architectural-rewrite):
    // Previously this function split the export into 1-4 batches and
    // sent each as a separate STEP file with isAppend=true. The Python
    // side then had to merge them across components, which is the worst-
    // supported operation in Fusion's API and produced a long string of
    // workarounds (CopyPasteBodies dangling refs, BaseFeature held-ref
    // invalidation, orphan tracking, etc.).
    //
    // The right architecture is: ONE export call, ONE STEP file, ONE
    // Python import. stepWriter.js's generateThickenedStep already
    // supports multiple bodies per file, and (as of this rewrite)
    // groups them by 'base' ('Clean', 'Stamped') into separate
    // PRODUCTs so Fusion imports them as two components with two
    // bodies each ('panel' + 'surface'). No cross-component body merge
    // ever needs to happen.
    const includeSVG = hasStamp && !!document.getElementById('includeSVG')?.checked;
    console.log('[SVG DEBUG] onFusionApply hasStamp=', hasStamp, 'includeSVG=', includeSVG);

    const options = {
        clean:       hasThicken,
        stamped:     hasThicken && hasStamp,
        cleanSurf:   true,
        stampedSurf: hasStamp,
        includeSVG,
        isVisible:   true,
    };

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

/**
 * Wrap the SVG content in a flip-Y group so the carving path renders
 * with the same orientation Fusion's importer expects. Idempotent —
 * recognizes the wrapper from an earlier call and skips re-flipping.
 */
function normalizeSvgForCarving(svgText) {
    if (!svgText) return svgText;
    try {
        if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svgText;
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        if (!svg) return svgText;

        let height = NaN;
        const viewBox = svg.getAttribute('viewBox');
        if (viewBox) {
            const parts = viewBox.trim().split(/\s+/).map(v => parseFloat(v));
            if (parts.length === 4 && !Number.isNaN(parts[3])) height = parts[3];
        }
        if ((!height || height <= 0) && svg.hasAttribute('height')) {
            height = parseFloat(svg.getAttribute('height'));
        }
        if (!height || height <= 0) return svgText;

        const flipTransform = `translate(0 ${height}) scale(1 -1)`;
        const firstChild = svg.firstElementChild;
        if (firstChild && firstChild.tagName.toLowerCase() === 'g' && firstChild.getAttribute('transform') === flipTransform) {
            console.log('[SVG DEBUG] normalizeSvgForCarving already flipped; returning original');
            return svgText;
        }

        const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapper.setAttribute('transform', flipTransform);
        while (svg.firstChild) wrapper.appendChild(svg.firstChild);
        svg.appendChild(wrapper);
        if (!svg.hasAttribute('preserveAspectRatio')) {
            svg.setAttribute('preserveAspectRatio', 'none');
        }
        const result = new XMLSerializer().serializeToString(svg);
        console.log('[SVG DEBUG] normalizeSvgForCarving applied flip transform');
        return result;
    } catch (e) {
        console.warn('normalizeSvgForCarving failed:', e);
    }
    return svgText;
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

    // If options not provided (e.g. direct call from Wizard), pull from Wizard checkboxes.
    if (!options) {
        options = {
            clean: document.getElementById('wizCleanSolid').checked,
            stamped: document.getElementById('wizStampedSolid').checked,
            cleanSurf: document.getElementById('wizCleanSurface').checked,
            stampedSurf: document.getElementById('wizStampedSurface').checked,
            includeSVG: document.getElementById('includeSVG').checked,
        };
    }

    console.log('[EXPORT DEBUG] options read:', options);
    console.log('[EXPORT DEBUG] wizard toggles:', {
        clean: document.getElementById('wizCleanSolid')?.checked,
        stamped: document.getElementById('wizStampedSolid')?.checked,
        cleanSurf: document.getElementById('wizCleanSurface')?.checked,
        stampedSurf: document.getElementById('wizStampedSurface')?.checked,
        includeSVG: document.getElementById('includeSVG')?.checked,
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
            options,
        };

        const stampCount = options.includeSVG ? P.stampLayers.filter(l => l.enabled && l.svg).length : 0;
        const svgLayerSummary = options.includeSVG
            ? P.stampLayers.filter(l => l.enabled && l.svg).map((l, i) => ({ idx: i, len: (l.svg || '').length, hasViewBox: /viewBox=/.test(l.svg || '') }))
            : [];
        console.log('[SVG DEBUG] executeExport orientation=', P.exportOrientation, 'options=', options, 'stampCount=', stampCount, 'svgLayerSummary=', svgLayerSummary);
        if (typeof fusLog === 'function') {
            fusLog(`[COORD_STD] executeExport orientation=${P.exportOrientation} options=${JSON.stringify(options)} stampCount=${stampCount} svgSummary=${JSON.stringify(svgLayerSummary)}`);
        }

        const variants = [
            { key: 'cleanSurf',   label: 'cleanSurface',   fileLabel: 'clean-surface',   opts: { cleanSurf: true } },
            { key: 'clean',       label: 'cleanSolid',     fileLabel: 'clean-solid',     opts: { clean: true } },
            { key: 'stampedSurf', label: 'stampedSurface', fileLabel: 'stamped-surface', opts: { stampedSurf: true } },
            { key: 'stamped',     label: 'stampedSolid',   fileLabel: 'stamped-solid',   opts: { stamped: true } },
        ];

        const selectedVariants = variants.filter(v => options[v.key]);
        const layersToExport = options.includeSVG ? P.stampLayers.filter(l => l.enabled && l.svg) : [];
        console.log('[EXPORT DEBUG] selectedVariants=', selectedVariants.map(v => v.label));
        console.log('[EXPORT DEBUG] layersToExport=', layersToExport.length, layersToExport.map((l, i) => ({ index: i + 1, profile: l.profile, hasViewBox: /viewBox=/.test(l.svg || '') })));

        if (isFusionMode) {
            // Per-base STEP files. Each PRODUCT in its own file → Fusion's
            // multi-PRODUCT auto-wrapper never triggers, so each variant
            // imports as a single component directly under B-Spline Set
            // with both panel and surface bodies inside it.
            const bases = [];
            if (options.clean || options.cleanSurf) bases.push('Clean');
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
                fusLog(`[SVG DEBUG] sendFusionPayload variants=${stepVariants.length} bases=${stepVariants.map(v => v.name).join(',')} totalStepLen=${totalLen} stampEnabled=${options.includeSVG} stampLayers=${layersToExport.length}`);
            }
            await sendFusionPayloadChunked(payload);
            if (!isAppend) startFusionPolling(btn);
        } else {
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

            if (options.includeSVG && layersToExport.length > 0) {
                layersToExport.forEach((l, i) => {
                    exportFiles.push({
                        name: `B-Spline-artwork-layer-${i + 1}.svg`,
                        blob: new Blob([normalizeSvgForCarving(l.svg)], { type: 'image/svg+xml' }),
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
