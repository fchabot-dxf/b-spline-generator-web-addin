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

import { P, lastResult, isFusionMode, RESOLUTIONS } from '../core/state.js';
import { resolveGrid } from '../core/terrain.js';
import { frameSendPayload } from './frame-panel.js';
import { confirmDialog } from '../core/confirm-dialog.js';
import { rebuild } from '../core/engine.js';
import { generateThickenedStep } from '../core/stepWriter.js';
import { withLoadingStage, beginLoadingSequence, holdLoadingStage } from '../core/loading-signal.js';
import FUSION_SEND_STAGES from '../data/fusion-send-stages.js';
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
import { isCarved, isExported, BRICK_SEND_SKIP } from '../editor/layers.js';
import {
    buildSketchManifest, splitManifestByKind, BOUNDARY_SKETCH_KIND, BOUNDARY_SKETCH_NAME,
} from '../editor/editor-sketch-manifest.js';
import { boardRegion } from '../editor/editor-shape-lattice-interaction.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { latticeOwnedElementsOnLayer, _ownedOnLayer, resolvePatternLayer, _findBoundaryElements } from '../editor/editor-lattice-pattern.js';
import { primitiveFromContourD } from '../editor/editor-contour-cut.js';
import { buildArtworkDecalPng } from '../core/stamp/decal-png.js';
import { showToast } from '../core/toast.js';
import { brickPieceLayers, BRICK_GEN_ATTR, groutNodes, GROUT_REGION_ATTR } from '../editor/editor-brick-tool.js';

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
 * layer SHIPS (turn 207, Fred: hidden is display-only) and keeps its own carve flag (audit B6): hidden or
 * shown, it lands in the same component. Its mask/svg are read here as for any layer (getLayerSvg doesn't care
 * about `visible`; see its own docstring).
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
            // item 22 slice 3: a layer holding only bricks carves through its brick mask (as the old brick layer
            // did), at the bricks' depth; its art (none) is not shipped as an art sketch -- the bricks go in the
            // Bricks sketch alone (the old duplicate "stamp layer" copy of them is gone)
            mask: layer._mask || layer._brickMask || null,
            ...(!layer._mask && layer._brickMask ? { depth: layer._brickDepth } : {}),
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

/** F35 item 11 (Fred: "I just want it sent with bspline"): the board's generated brick polygons
 *  (wall/frame/brush), as ONE Fusion-ready SVG string (the Bricks sketch), or '' when there's nothing
 *  to send (the explicit "no bricks" case, distinct from append's "no instruction" null, see
 *  sendToFusion's own `bricks` tri-state below).
 *
 *  Item 22 slice 3: bricks live on any layer. getLayerSvg's `bricks: 'only'` reads a layer's
 *  brick-tool nodes (layers.js isBrickToolNode; its art is everything else), and this keeps the laid
 *  pieces (BRICK_GEN_ATTR='1') -- a Brush stroke's invisible SPINE `<line>` (its hit-testing /
 *  regenerate anchor, never real geometry) is a brick-tool node too and is dropped here. */
export async function _bricksLayerSvg(editor) {
    if (!editor || !Array.isArray(editor._layers)) return '';
    // F35 item 22 slice 3: bricks live on any layer -- every layer's laid pieces, in roster order, into the ONE
    // Bricks sketch (a board with all its bricks on one layer: byte-identical to before)
    let root = null;
    let kept = 0;
    for (const layer of brickPieceLayers(editor)) {
        const { svg } = await getLayerSvg(editor, layer.id, 96, { geometry: 'fusion', bricks: 'only' });
        if (!svg) continue;
        let doc;
        try { doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); } catch { continue; }
        const r = doc.documentElement;
        if (!r) continue;
        Array.from(r.children).forEach((ch) => {
            if (ch.getAttribute(BRICK_GEN_ATTR) !== '1' || BRICK_SEND_SKIP.includes(ch.getAttribute('data-brick'))) { ch.remove(); return; }
            kept++;
            if (root) root.appendChild(ch);
        });
        if (!root) root = r;
    }
    if (!root || kept === 0) return '';
    return new XMLSerializer().serializeToString(root);
}

/** 2026-10-10 (Fred, via the advisor): beside the Bricks sketch, one OUTLINE sketch per brick element kind -- the region
 *  the engine laid that element into, as its grout node keeps it (editor-brick-tool.js GROUT_REGION_ATTR: the region
 *  itself, not a union of bricks, no grout joints). Fred's pick (a): each its own sketch. `loops`: 'outer' = each
 *  region's outer boundary (the Wall: one closed profile); 'all' = its outer and inner loops (the Frame's band ring: 2
 *  profiles, the ring and the opening inside it). A new outline is a new row; the add-in imports any row it is sent
 *  (b-spline-gen.py BRICK_OUTLINE_SKETCH_NAMES lists the names it may replace). */
export const BRICK_OUTLINE_SKETCHES = Object.freeze([
    Object.freeze({ kind: 'wall', name: 'Wall outline', loops: 'outer' }),
    Object.freeze({ kind: 'frame', name: 'Frame outline', loops: 'all' }),
]);

/** Each BRICK_OUTLINE_SKETCHES row's SVG (board inches, the layer SVG frame getLayerSvg uses), '' when no element of
 *  that kind is laid on a brick layer. One closed path per loop. */
export function _brickOutlineSvgs(editor) {
    const layers = new Set(brickPieceLayers(editor).map((l) => String(l.id)));
    const nodes = groutNodes(editor).filter((g) => layers.has(String(g.node.getAttribute('data-layer'))));
    const loopD = (pts) => `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`;
    return BRICK_OUTLINE_SKETCHES.map((row) => {
        const loops = [];
        for (const g of nodes.filter((n) => n.kind === row.kind)) {
            let region = [];
            try { region = JSON.parse(g.node.getAttribute(GROUT_REGION_ATTR) || '[]'); } catch { region = []; }
            for (const r of region) {
                if (r && r.outer && r.outer.length >= 3) loops.push(r.outer);
                if (row.loops === 'all') for (const h of (r && r.holes) || []) if (h.length >= 3) loops.push(h);
            }
        }
        if (!loops.length || !editor._mW || !editor._mH) return { name: row.name, svg: '' };
        const paths = loops.map((pts) => `<path d="${loopD(pts)}" fill="none" stroke="#000000" stroke-width="0.01"/>`).join('');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${editor._mW * 96}" height="${editor._mH * 96}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="96">${paths}</svg>`;
        return { name: row.name, svg };
    });
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
/** F17 (P1): the lattice pieces AS DRAWN, `{rails, ties, nodes}` for
 *  `latticeFromDrawn` (editor-sketch-manifest.js): every owned piece of each
 *  kind with its own endpoints (a lattice drag writes the DOM only).
 *  Replaces the old positional width arrays (T75 item 3), which lined DOM
 *  order up with computePattern order and broke on any hand move, delete
 *  or add.
 *
 *  H3 (NO-PIECE-WIDTH): no more per-piece width override to read here — a
 *  lattice piece has no width of its own any more, only the kind's shared
 *  parameter (stroke_width/node_diameter), so a Send never carries a
 *  per-piece hardcoded dimension. A stale `data-override-width` left on an
 *  element from before this turn is simply never read by anything any
 *  more, here included. */
// T76 (SE17, item 4): each kind's own pieces now come from THAT KIND's own
// layer (`pattern.layers[kind]`), not necessarily `layerId` itself --
// rails/ties/nodes each got their own layer in item 2's own split. Falls
// back to `layerId` for a pre-SE17 pattern with no `.layers` map yet
// (every kind still resolves to that one shared layer, unchanged).
function _drawnPiecesForLayer(editor, pattern, layerId) {
    const kindLayerId = (kind) => (pattern && pattern.layers && pattern.layers[kind]) || layerId;
    const num = (el, k) => parseFloat(el.node.getAttribute(k));
    const lines = (latticeKind, patternKind) => _ownedOnLayer(editor, kindLayerId(patternKind), latticeKind).map((el) => ({
        p1: { x: num(el, 'x1'), y: num(el, 'y1') }, p2: { x: num(el, 'x2'), y: num(el, 'y2') },
    }));
    const nodes = _ownedOnLayer(editor, kindLayerId('nodes'), 'node').map((el) => ({
        c: { x: num(el, 'cx'), y: num(el, 'cy') },
    }));
    return { rails: lines('rail', 'rails'), ties: lines('tie', 'ties'), nodes };
}

/** F27 (Fred: "the scissors tool doesn't cut contour, it should"): the contour's own pieces AS DRAWN --
 *  the SAME "send as drawn" reasoning as `_drawnPiecesForLayer` above (a rail/tie drag writes the DOM only;
 *  a contour CUT does too, via editor-cut-tool.js), applied to the boundary's own N per-segment `<path>`
 *  elements (T73/SE14b, `_findBoundaryElements`, in their own `CONTOUR_SEG_INDEX_ATTR` order) instead of the
 *  generator's fresh, un-cut output. `null` when there is no boundary shape at all (buildSketchManifest then
 *  falls back to its own existing regenerate-fresh path, unchanged). */
function _drawnContourPrimitives(editor, shapeId) {
    if (!shapeId) return null;
    const els = _findBoundaryElements(editor, shapeId);
    if (!els.length) return null;
    const primitives = els.map((el) => primitiveFromContourD(el.attr('d')));
    return primitives.every(Boolean) ? primitives : null; // decline gracefully on an unreadable d, never throw
}

export function _fusionLayerManifest(editor, l) {
    if (!editor || l.id == null) return null;
    // T76 (SE17): the pattern may live on a DIFFERENT layer than `l` itself
    // -- `l` could be any one of the pattern's own Contour/Rails/Ties/Nodes
    // kind-layers, only the rails/primary one actually holds `.pattern`.
    const patternLayer = resolvePatternLayer(editor, l.id);
    if (!patternLayer) return null;
    const pattern = patternLayer.pattern;
    if (!latticeOwnedElementsOnLayer(editor, l.id, pattern).length) return null;

    // A pattern already split across kind-layers (`pattern.layers` set --
    // item 2's own `_ensureKindLayers`) builds ONE manifest PER KIND-LAYER,
    // via splitManifestByKind, picking out just the slice for THIS layer's
    // own kind. A pre-SE17 pattern with no `.layers` map yet (still one
    // shared layer for everything) keeps building the single combined
    // manifest exactly as before this turn.
    const kind = pattern.layers && Object.keys(pattern.layers).find((k) => pattern.layers[k] === l.id);
    if (kind) {
        const perKind = splitManifestByKind(pattern, boardRegion(editor), {
            drawn: _drawnPiecesForLayer(editor, pattern, l.id),
            drawnContour: _drawnContourPrimitives(editor, pattern.boundary && pattern.boundary.shapeId),
            frame: frameContext(editor), // F21: an offset-from-frame contour follows the frame
        });
        const manifest = perKind[kind];
        if (!manifest) return null; // e.g. this pattern's own contour is empty/off
        return { ...manifest, layerId: l.id, sketchName: `Layer ${l.id}` };
    }
    return buildSketchManifest(pattern, boardRegion(editor), {
        layerId: l.id, sketchName: `Layer ${l.id}`,
        drawn: _drawnPiecesForLayer(editor, pattern, l.id),
        drawnContour: _drawnContourPrimitives(editor, pattern.boundary && pattern.boundary.shapeId),
        frame: frameContext(editor),
    });
}

/** BOUNDARY-GUIDE (L1 amend): one "Lattice Boundary" manifest per kind-split
 *  pattern this Send carries — the boundary has no editor layer of its own,
 *  so it rides as an extra, manifest-only payload entry (no svg). Python
 *  groups it with the pattern's other sketches by `patternId` and builds it
 *  FIRST (`buildOrder` 0, SKETCH_BUILD_ORDER). Only for patterns that are
 *  actually being sent (one of their layers produced a manifest). */
export function _boundarySketchManifests(editor, manifests) {
    const out = [];
    const seen = new Set();
    for (const m of manifests) {
        if (!m || !m.patternId || m.kind == null || seen.has(m.patternId)) continue;
        seen.add(m.patternId);
        const patternLayer = resolvePatternLayer(editor, m.layerId);
        if (!patternLayer) continue;
        const boundary = splitManifestByKind(patternLayer.pattern, boardRegion(editor))[BOUNDARY_SKETCH_KIND];
        if (boundary) out.push({ ...boundary, layerId: null, sketchName: BOUNDARY_SKETCH_NAME });
    }
    return out;
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

/** Fred ("i think id rather have a delete everything button"): remove what the add-in built in the Fusion design
 *  (b-spline-gen.py _handle_clear_design); the reply is 'clear_result' (main.js). */
export async function onClearFusionDesign() {
    if (!isFusionMode) return;
    const ok = await confirmDialog(
        'Remove everything the add-in built in this Fusion design: the B-spline body, the artwork and lattice sketches, '
        + 'and the frame?\nYour own sketches, bodies and CAM operations stay; CAM setups will need BUILD SETUPS again.',
        { okLabel: 'Clear', zIndex: 20000 });
    if (!ok) return;
    document.getElementById('settings-panel-overlay')?.style.setProperty('display', 'none');
    adsk.fusionSendData('clear_design', '{}');
    setFusionStatus('Clearing the Fusion design…', 'busy');
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
            // item 70 (advisor): the button is released by Fusion's own answer (import_success / import_failed,
            // main.js) or the poll timeout -- never when the payload leaves: a re-click mid-import is a real hazard.
            // A Send that fails or sends nothing before that releases it itself (executeExport / sendToFusion).
            await executeExport(preview, options, false, 'B-Spline.step');
        })();
    } else {
        executeExport(preview, options);
    }
}

/** F35 item 16 follow-up (Fred): Export can now use a DIFFERENT resolution than the live Display
 *  preview. `lastResult` (core/engine/rebuild.js's own output, read directly by the caller below) is
 *  a single global slot shared by both Display and Export -- when they differ, this brackets the
 *  caller's own read of it with a temporary resolution swap: rebuild `lastResult` at Export's own
 *  resolution (via `rebuild(null, ...)`, which skips `preview.update` so the LIVE 3D view never
 *  visibly jumps mid-Send), run `fn`, then rebuild back to Display's resolution so the live preview
 *  and `lastResult` are exactly as the user left them. Masks (`editor._layers[i]._mask`) are
 *  resolution-scoped too and must be re-rasterized on both ends of the swap -- core/engine/
 *  rebuild.js's own `rebuild()` only CONSUMES whatever mask is already there, it does not rasterize
 *  one itself (see main/stamp-mask-manager.js's own `updateStampMasks`, the same call
 *  `refreshAllStampMasks` makes before every real-UI rebuild). A plain state write (`P.spacing =`),
 *  not `applyParam`, so the Display dropdown's own displayed value never flickers to Export's during
 *  the swap. A no-op (straight to `fn`) when `sameAsDisplayResolution`, which is every existing
 *  board's own default -- behaviour is then byte-identical to before this split existed. */
export async function withExportResolution(preview, fn) {
    if (P.sameAsDisplayResolution) return fn();

    const savedSpacing = P.spacing;
    const exportGrid = resolveGrid(P.widthIn, P.heightIn, P.exportSpacing);
    const resName = RESOLUTIONS.find((r) => r.val === Number(P.exportSpacing))?.name;
    if (isFusionMode) setFusionStatus(`Building at ${resName ? `${resName} ` : ''}${P.exportSpacing}in…`, 'busy');

    P.spacing = P.exportSpacing;
    await updateStampMasks(exportGrid.nx, exportGrid.nz);
    await rebuild(null, updateStampMasks, updatePreviewSculptMode);

    try {
        return await fn();
    } finally {
        P.spacing = savedSpacing;
        const displayGrid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        await updateStampMasks(displayGrid.nx, displayGrid.nz);
        await rebuild(preview, updateStampMasks, updatePreviewSculptMode);
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
    beginLoadingSequence(isFusionMode ? 'send' : 'export'); // item 41; item 70: a Fusion Send runs on into Fusion's stages

    try {
        await withExportResolution(preview, () => withLoadingStage(isFusionMode ? 'stepBuild' : 'stepExport', async () => {
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
        }));
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
                // turn 193 (Fred): does this layer CARVE? The add-in puts a carving layer's sketch in the
                // Carved component and every other exported layer's sketch on root (b-spline-gen.py).
                config: { profile: layersToExport[i].profile, depth: layersToExport[i].depth, carve: isCarvingLayer(layersToExport[i]) },
                svg: await bakeSvgForCarving(r.svg, P.widthIn, P.heightIn, 96),
                ...(manifest ? { sketchManifest: manifest } : {}),
            };
        }))
        : [];
    // BOUNDARY-GUIDE: each sent pattern's own "Lattice Boundary" sketch (manifest only, no svg).
    if (options.includeSVG) {
        for (const bm of _boundarySketchManifests(editor, manifests)) {
            bakedLayers.push({
                index: bakedLayers.length + 1,
                config: { profile: 'flat', depth: 0 },
                svg: '',
                sketchName: BOUNDARY_SKETCH_NAME,
                sketchManifest: bm,
            });
        }
    }
    // H23 item 71: the optional "Fusion colour decal" -- a transparent PNG of the artwork's
    // colour layers, applied by the add-in as ONE real decal on the Stamped top face.
    // `decal: null` means NO INSTRUCTION -- the add-in leaves whatever's there alone -- used on
    // append (same reasoning as `frame` above: append doesn't rebuild the Stamped body this would
    // target) AND when a render failure happens while enabled (a transient PNG-build hiccup must
    // never silently delete a previously-working decal). `decal.enabled: false` is the one
    // EXPLICIT instruction to remove: only sent when the user actually turned the setting off.
    // "Never fails a Send": every failure path here is logged + a toast, never thrown.
    let decal = null;
    if (!isAppend) {
        if (P.decalEnabled) {
            try {
                const png = await buildArtworkDecalPng(editor, {
                    dpi: Number(P.decalResolution),
                    opacity: P.decalOpacity,
                    layerIds: P.decalLayerIds,
                });
                if (png) {
                    decal = { enabled: true, dpi: Number(P.decalResolution), opacity: P.decalOpacity, png };
                } else {
                    showToast('colour decal skipped: no colour-carrying artwork found', 'warn');
                }
            } catch (e) {
                if (typeof fusLog === 'function') fusLog('[EXPORT] colour decal PNG failed: ' + (e && e.message));
                showToast('colour decal skipped: ' + (e && e.message ? e.message : 'render failed'), 'warn');
            }
        } else {
            decal = { enabled: false };
        }
    }
    // F35 item 11 (Fred: "SEND BRICKS WITH THE B-SPLINE... no lock button, no line-by-line API
    // drawing"): the Bricks layer's own generated polygons, baked the SAME way every art layer
    // already is (bakeSvgForCarving, P.widthIn/heightIn, dpi=96) -- no new scale/offset math, reuses
    // the one proven-correct carve transform. Same tri-state contract as `decal` above: `null` = no
    // instruction (append -- the Stamped component this targets isn't rebuilt on append either, same
    // reasoning as `frame`/`decal`), `{enabled:false}` = the one explicit "remove whatever Bricks
    // sketch exists" instruction (sent whenever this Send genuinely has none), `{enabled:true, svg}`
    // = replace it with this. "Never fails a Send": a bake failure here is logged, never thrown, and
    // leaves `bricks` at `null` (no instruction) rather than risk an incorrect removal.
    let bricks = null;
    if (!isAppend) {
        try {
            const raw = await _bricksLayerSvg(editor);
            // turn 193: `carve` -- the Bricks sketch goes in the Carved component when its layer carves; otherwise
            // on root, like every other non-carving art layer. Item 22 slice 3: bricks on several layers share the
            // one sketch, Carved when ANY of their layers carves
            const carve = brickPieceLayers(editor).some((l) => isCarved(l));
            bricks = raw
                ? { enabled: true, carve, svg: await bakeSvgForCarving(raw, P.widthIn, P.heightIn, 96) }
                : { enabled: false };
        } catch (e) {
            if (typeof fusLog === 'function') fusLog('[EXPORT] Bricks SVG failed: ' + (e && e.message));
        }
    }
    // 2026-10-10: the brick OUTLINE sketches (BRICK_OUTLINE_SKETCHES), the same tri-state per row as `bricks` and in its
    // home (Carved when the bricks carve); null = no instruction (append, or a failure: never an incorrect removal)
    let brickOutlines = null;
    if (!isAppend) {
        try {
            const carve = brickPieceLayers(editor).some((l) => isCarved(l));
            brickOutlines = [];
            for (const o of _brickOutlineSvgs(editor)) {
                brickOutlines.push(o.svg
                    ? { name: o.name, enabled: true, carve, svg: await bakeSvgForCarving(o.svg, P.widthIn, P.heightIn, 96) }
                    : { name: o.name, enabled: false });
            }
        } catch (e) {
            brickOutlines = null;
            if (typeof fusLog === 'function') fusLog('[EXPORT] Brick outlines failed: ' + (e && e.message));
        }
    }
    const payload = JSON.stringify({
        params: { ...P },
        stepVariants,
        filename: filename_hint || `B-Spline-${Date.now()}.step`,
        isPreview: false,
        isAppend,
        // Fred ("send bspline and frame at same time" / "no send frame"): the frame goes with the Send and is built
        // right after the body; the add-in first clears the previous frame + B-Spline Set (b-spline-gen.py)
        frame: isAppend ? null : frameSendPayload(),
        isVisible: options.isVisible !== undefined ? options.isVisible : true,
        stamp: {
            enabled: options.includeSVG,
            layers: bakedLayers,
            dpi: 96,
            decal,
            bricks,
            brickOutlines,
        },
    });
    if (typeof fusLog === 'function') {
        fusLog(`[EXPORT] variants=${stepVariants.length} bases=${stepVariants.map(v => v.name).join(',')} totalStepLen=${totalLen} layers=${layersToExport.length}`);
    }
    // item 70: the transfer, then Fusion's first stage HELD and painted BEFORE generate_finish -- the add-in runs the
    // import from that call, and the palette must already say what Fusion is doing however long it takes
    if (btn) btn.textContent = 'Sending...';
    await holdLoadingStage('transfer');
    await sendFusionPayloadChunked(payload, { beforeFinish: () => holdLoadingStage(FUSION_SEND_STAGES.stages[0].id) });
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
