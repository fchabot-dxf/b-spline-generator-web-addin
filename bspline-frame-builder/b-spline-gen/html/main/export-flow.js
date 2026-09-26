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
    sendFusionPayloadChunked,
    startFusionPolling,
    stopFusionPolling,
    fusionActionButton,
    setFusionActionState,
    FUSION_IDLE_LABEL,
    setFusionStatus,
} from '../core/fusion-bridge.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { bakeSvgForCarving, getLayerSvg } from '../editor/editor-io.js';
import { isCarved, isExported } from '../editor/layers.js';
import { buildSketchManifest } from '../editor/editor-sketch-manifest.js';
import { boardRegion } from '../editor/editor-shape-lattice-interaction.js';
import { latticeOwnedElementsOnLayer } from '../editor/editor-lattice-pattern.js';

// ── Stamp-layer helpers ──────────────────────────────────────────────────
//
// SE5b: tooling (depth/profile/visible) now reads the editor layer
// directly too — editor._layers is the single store for content AND
// tooling (SE5-TOOLING-STORE-DESIGN.md). No read of the old per-stamp-
// layer tooling mirror left in this file. `enabled` retires in favor of
// `visible`, which is what the Vector Stamping panel's one checkbox has
// actually written since the editor loads (design doc finding #2) — this
// was the riskiest single change in the whole SE5 plan (no dual-path
// fallback), shipped alone in
// its own slice per that same design doc's own risk note.
//
// Two filters with different semantics:
//   • activeStampLayers: layers that actually carve (have mask + non-trivial
//     depth). Drives wizard option availability and onFusionApply's hasStamp.
//   • exportableStampLayers: layers with payload to ship (have svg). Looser
//     because the SVG can be exported even before its mask has been baked.
//     Used by includeSVG. Mask-less layers contribute artwork but no carve.
//
// T27: `enabled`/`carve` on the candidate view are the ALREADY-COMPOUND
// isExported()/isCarved() results (computed once in _stampExportCandidates
// below, off the raw editor layer) — isCarvingLayer/hasShippableSvg just
// read them back, so the visible-is-master rule lives in one place
// (editor/layers.js), not re-derived here.
const isCarvingLayer = (l) => l.carve && l.mask && Math.abs(l.depth) > 0.001;
const hasShippableSvg = (l) => l.enabled && l.svg;

/**
 * Build one {enabled, carve, depth, profile, mask, svg} view per editor
 * layer, reading tooling AND content from the same editor layer object —
 * no position-based cross-store lookup, so reorder/delete-in-middle can't
 * desync the two (SA-LAYER-1 finding #3). Returns [] when the editor
 * isn't loaded (nothing to build a candidate list from).
 *
 * `enabled`/`carve` are isExported(layer)/isCarved(layer) — a hidden
 * layer's mask/svg are still read here (getLayerSvg doesn't care about
 * `visible`; see its own docstring), but `carve` comes back false for it
 * regardless of its own carve flag, same as every other gate.
 */
function _stampExportCandidates() {
    const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
    const editorLayers = (editor && Array.isArray(editor._layers)) ? editor._layers : [];
    return editorLayers.map((layer) => {
        if (!layer) return { id: null, enabled: false, carve: false, depth: 0, profile: null, mask: null, svg: null };
        return {
            // SE12 Slice 4: the layer id, so the actual export step (below)
            // can re-derive this layer's fusionGeometry-aware SVG right
            // before baking — this candidate's own `svg` stays the plain
            // centerline read (availability checks only; see _fusionLayerSvg).
            id: layer.id,
            enabled: isExported(layer),
            carve: isCarved(layer),
            depth: layer.depth,
            profile: layer.profile,
            mask: layer._mask || null,
            svg: editor ? (getLayerSvg(editor, layer.id) || null) : null,
        };
    });
}

/** SE12 Slice 4: swap in this layer's OWN fusionGeometry pick
 *  (outline/both) right before baking for the actual export payload.
 *  The plain `l.svg` from _stampExportCandidates stays centerline-only —
 *  it's also what wizard-availability checks and the carve mask read,
 *  and getLayerSvg's own docstring promises those stay byte-for-byte
 *  untouched by this slice. Only this one call site (the real export)
 *  asks for the geometry-aware variant. Returns {svg, declined,
 *  declinedKinds} — the caller (T44: _reportDeclinedOutlines) aggregates
 *  across every exported layer for the ONE user-facing notice; individual
 *  per-layer declines are already console-warned inside getLayerSvg
 *  itself. Falls back to the plain centerline svg already on `l` if the
 *  editor isn't live — shouldn't happen (export only runs with one), but
 *  matches every other defensive `editor ? ... : null` in this file.
 *
 *  T74 AMEND 5: `excludePattern`, when given (a MIXED layer that's ALSO
 *  earning a sketchManifest below), strips that pattern's own lattice/
 *  contour content out of the returned SVG — it's already fully
 *  represented by the manifest, so sending it again as plain SVG curves
 *  would duplicate the geometry in Fusion. `null`/omitted (the common,
 *  non-lattice-layer case) keeps this byte-for-byte the same as before. */
export async function _fusionLayerSvg(editor, l, excludePattern) {
    if (!editor || l.id == null) return { svg: excludePattern ? '' : l.svg, declined: 0, declinedKinds: [] };
    const opts = excludePattern ? { geometry: 'fusion', excludeLatticeOwnedFor: excludePattern } : { geometry: 'fusion' };
    const { svg, declined, declinedKinds } = await getLayerSvg(editor, l.id, 96, opts);
    // T74 AMEND 5: excluding this pattern's own content, an empty result
    // means "nothing else in this layer" -- never fall back to the
    // UNFILTERED l.svg (that would silently reintroduce the exact
    // duplicate-geometry bug this exclusion exists to prevent).
    return { svg: svg || (excludePattern ? '' : l.svg), declined, declinedKinds };
}

/** T62 (SE15): a layer's own SE15 sketch manifest, or `null` when the
 *  layer has no `.pattern` (a hand-drawn/text layer — declined gracefully,
 *  same convention `_fusionLayerSvg` itself already uses). Deliberately
 *  its OWN small function, not inlined into `sendToFusion`'s own
 *  `bakedLayers` map, so it's directly testable without the heavier
 *  STEP-generation/Fusion-bridge machinery — same "_fusionLayerSvg is its
 *  own function for the same reason" convention already established here.
 *  Gated on the SAME `includeSVG` toggle as `.svg` itself (§7's own "the
 *  smaller change": no new checkbox — a layer's sketch manifest rides on
 *  the SAME "ship this layer's artwork" decision the user already makes,
 *  rather than a second, parallel toggle for a shape most users won't
 *  distinguish from the SVG they already asked to send).
 *
 *  T74 AMEND 5 (Fred, live: a hand-drawn layer got sent to Fusion as a
 *  LATTICE constrained sketch instead of its own artwork): `.pattern`
 *  EXISTING is not enough — the Lattice tool merely having been opened on
 *  a layer once (materializing a stored, possibly now-STALE `.pattern`)
 *  is not the same as the layer actually containing that pattern's own
 *  drawn content right now. Gated on `latticeOwnedElementsOnLayer` (the
 *  SAME declared "does this layer really have lattice content" check the
 *  mixed-layer SVG exclusion below reuses), so a layer only ever earns a
 *  manifest when there's something real for it to represent. */
export function _fusionLayerManifest(editor, l) {
    if (!editor || l.id == null) return null;
    const editorLayer = Array.isArray(editor._layers) ? editor._layers.find((el) => el.id === l.id) : null;
    if (!editorLayer || !editorLayer.pattern) return null;
    if (!latticeOwnedElementsOnLayer(editor, l.id, editorLayer.pattern).length) return null;
    return buildSketchManifest(editorLayer.pattern, boardRegion(editor), {
        layerId: l.id, sketchName: `Layer ${l.id}`,
    });
}

/** T44: after "Send to Fusion" completes, tell the user when any element
 *  had no outline available and exported as centerline instead — the
 *  dispatch's own example format. Silent when nothing declined (the
 *  common case). Uses the app's one reusable status-line surface
 *  (`#fusion-status`, core/fusion-bridge.js's setFusionStatus) rather than
 *  inventing new UI — kind:'warn' persists until replaced (unlike 'ok',
 *  which auto-clears in 3s), so this stays visible; a later
 *  import_success ping from Fusion's own handshake (main.js) can still
 *  overwrite it once the import genuinely finishes — a pre-existing
 *  single-status-line limitation this slice doesn't attempt to solve.
 *  Exported (despite the underscore) for direct testing, same convention
 *  editor-io.js's own `_reconcileLayersFromSvg` already uses — a pure
 *  aggregation step, testable without mocking sendToFusion's own much
 *  heavier STEP-generation/Fusion-bridge machinery. */
export function _reportDeclinedOutlines(results) {
    const totalDeclined = results.reduce((s, r) => s + (r.declined || 0), 0);
    if (totalDeclined === 0) return;
    const kinds = [...new Set(results.flatMap((r) => r.declinedKinds || []))];
    const noun = totalDeclined === 1 ? 'element' : 'elements';
    setFusionStatus(`${totalDeclined} ${noun} exported as centerline — no outline for: ${kinds.join(', ')}`, 'warn');
}

export const activeStampLayers     = () => _stampExportCandidates().filter(isCarvingLayer);
export const exportableStampLayers = () => _stampExportCandidates().filter(hasShippableSvg);

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

    const svgCb = document.getElementById('includeSVG');
    if (svgCb) {
        const hasAnySvg = exportableStampLayers().length > 0;
        svgCb.disabled = !hasAnySvg;
        svgCb.checked = hasAnySvg;  // default-on when available, off otherwise
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
    // Fusion-mode "OK" bypasses the export wizard, so there is no
    // checkbox in the DOM to read. Always ship the SVG when any stamp
    // layer carries one — the user already designed it, there's no
    // reason to silently drop it. (The wizard download path still
    // honours the explicit `includeSVG` checkbox via readWizardOptions.)
    // Fred: "send to fusion doesn't get the sketches" — this used to also
    // require hasStamp (a CARVING layer), so a layer with 3D off (inlay /
    // paint-only / not yet baked) silently shipped no sketch. Sketches are
    // the layer's artwork, independent of whether it carves: ship them
    // whenever any shown layer has any.
    const includeSVG = exportableStampLayers().length > 0;
    const options = { ...defaultExportOptions(hasThicken, hasStamp, includeSVG), isVisible: true };

    if (isFusionMode) {
        (async () => {
            setFusionActionState('Baking...', true);
            try {
                await executeExport(preview, options, false, 'B-Spline.step');
            } finally {
                setFusionActionState(FUSION_IDLE_LABEL, false);
            }
        })();
    } else {
        executeExport(preview, options);
    }
}

export async function executeExport(preview, options = null, isAppend = false, filename_hint = null) {
    const btn = isFusionMode
        ? fusionActionButton()
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
        if (btn) { btn.disabled = false; btn.textContent = FUSION_IDLE_LABEL; }
        return;
    }

    const totalLen = stepVariants.reduce((s, v) => s + v.stepText.length, 0);
    // SE8d: bakeSvgForCarving is now async (a rotated/scaled <text> layer's
    // glyph bake loads a font over the network) — await every layer's bake
    // BEFORE building the payload object, not inside .map() (an async map
    // callback would hand JSON.stringify an array of unresolved Promises).
    // SE12 Slice 4: _fusionLayerSvg swaps in this layer's fusionGeometry
    // pick before the bake — same await-before-build reasoning. Resolved
    // as its own pass (not inline in the bakedLayers map) so T44's
    // declined-outline notice can see every layer's result in one place.
    const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
    // T74 AMEND 5: manifests are resolved BEFORE the SVG pass now (was
    // after) — a layer that earns one needs its own PATTERN threaded into
    // _fusionLayerSvg below, so that layer's own lattice/contour content
    // is excluded from the plain SVG it sends alongside the manifest
    // (else Fusion would import that geometry twice: once as a
    // constrained sketch, once as flat curves).
    const manifests = options.includeSVG
        ? layersToExport.map((l) => _fusionLayerManifest(editor, l))
        : [];
    const editorLayerFor = (l) => (Array.isArray(editor && editor._layers) ? editor._layers.find((el) => el.id === l.id) : null);
    const fusionResults = options.includeSVG
        ? await Promise.all(layersToExport.map((l, i) => _fusionLayerSvg(editor, l, manifests[i] && editorLayerFor(l).pattern)))
        : [];
    const bakedLayers = options.includeSVG
        ? await Promise.all(fusionResults.map(async (r, i) => {
            const manifest = manifests[i];
            return {
                index: i + 1,
                config: { profile: layersToExport[i].profile, depth: layersToExport[i].depth },
                svg: await bakeSvgForCarving(r.svg, P.widthIn, P.heightIn, 96),
                ...(manifest ? { sketchManifest: manifest } : {}),
            };
        }))
        : [];
    const payload = JSON.stringify({
        params: { ...P },
        stepVariants,
        filename: filename_hint || `B-Spline-${Date.now()}.step`,
        isPreview: false,
        isAppend,
        isVisible: options.isVisible !== undefined ? options.isVisible : true,
        stamp: {
            enabled: options.includeSVG,
            layers: bakedLayers,
            dpi: 96,
        },
    });
    if (typeof fusLog === 'function') {
        fusLog(`[EXPORT] variants=${stepVariants.length} bases=${stepVariants.map(v => v.name).join(',')} totalStepLen=${totalLen} layers=${layersToExport.length}`);
    }
    await sendFusionPayloadChunked(payload);
    _reportDeclinedOutlines(fusionResults); // T44: user-facing notice, after the payload is safely on its way
    if (!isAppend) startFusionPolling();
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
        // SE8d: bakeSvgForCarving is now async (see sendToFusion's own note
        // on why) — a plain .forEach can't await, so a for-of loop instead.
        // SE12 Slice 4: swap in each layer's fusionGeometry pick first.
        const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
        for (let i = 0; i < layersToExport.length; i++) {
            const { svg: fusionSvg } = await _fusionLayerSvg(editor, layersToExport[i]);
            const bakedSvg = await bakeSvgForCarving(fusionSvg, P.widthIn, P.heightIn, 96);
            exportFiles.push({
                name: `B-Spline-artwork-layer-${i + 1}.svg`,
                blob: new Blob([bakedSvg], { type: 'image/svg+xml' }),
            });
        }
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
