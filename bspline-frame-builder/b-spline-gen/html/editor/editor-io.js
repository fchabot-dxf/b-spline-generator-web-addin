/**
 * editor-io.js - persistence logic for VectorEditor.
 * Handles SVG serialization and re-import.
 */

import { stripSvgjsAttributes, stripOriginalAttrs, decodeSnapshot } from '../core/svg-utils.js';
import { migrateTextElement } from './editor-text-baseline.js';
import { fusLog } from '../core/fusion-bridge.js';
import { applyToolingDefaults, addLayer, setActiveLayer, isExported } from './layers.js';
import { OWNERSHIP_ATTR } from './editor-lattice-pattern.js';
import { carveMatrix, transformPoint } from './editor-coords.js';
import { bakeMatrixIntoElement } from './editor-transform-handles.js';
import { textGlyphPathD } from './editor-expand-text.js';
import { resetPanState } from './editor-interaction.js';
import { clearSnapCursor, clearGridHover } from './editor-grid.js';
import { dbg } from '../core/debug.js';
import { OUTLINE_KINDS } from './editor-outline-preview.js';

/** Editor-IO diagnostic logging — fusLog goes to the Fusion log file so
 *  layer-restore regressions stay observable. Console output is quiet by
 *  default; flip window.__editorDebug = 'EDITOR-IO' in devtools to enable.
 *  SE8c/SA-DEAD-1: routed through the declared dbg() gate instead of
 *  hand-rolling the window.__editorDebug check. */
function _ioLog(msg) {
    dbg('EDITOR-IO', msg);
    try { fusLog(`[EDITOR-IO] ${msg}`); } catch (_) {}
}

/** THE one editor-content serializer (EDM3). Serializes the sketch-layer content
 *  — ALL children, ALL layers — with svg.js bookkeeping attrs stripped.
 *
 *  Hidden layers are intentionally KEPT: their `visible` flag is persisted
 *  separately in data-editor-layers, so on reopen applyLayerState re-hides them
 *  for the view. Dropping their geometry here loses it permanently on
 *  save/reopen and on file download (B6). The stamp/rasterize exclusion of
 *  hidden layers lives in getLayerSvg (per-visible-layer), NOT here.
 *
 *  opts.forRaster (default false): also strip data-original-* metadata — the
 *  raster path doesn't need it, and legacy raw-markup snapshots would otherwise
 *  break a strict image/svg+xml parse (EDM2). Persistence/re-edit callers pass
 *  false so the (base64) re-edit metadata round-trips. */
function serializeEditor(editor, { forRaster = false } = {}) {
    let raw = editor._sketchLayer.node.innerHTML;
    if (forRaster) raw = stripOriginalAttrs(raw);
    return stripSvgjsAttributes(raw);
}

/** T27: the SVG DOWNLOAD (saveWithTextCopies, below) exports isExported()
 *  layers only — same rule the editor canvas and the 3D vector overlay
 *  (seat A) read. This does NOT touch serializeEditor itself, which every
 *  OTHER caller (the regular save/persist path, saveForRasterization,
 *  getLayerSvg) needs to keep including hidden layers for — per that
 *  function's own docstring, hidden-layer content must survive
 *  save/reopen, and a hidden-but-carving layer still needs its real SVG
 *  for masking. Filters the live sketch-layer children by their layer's
 *  isExported() result BEFORE the same svg.js-attr-stripping pass
 *  serializeEditor itself runs — same output shape, smaller input. */
function _serializeVisibleLayers(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    const exportedIds = new Set(
        layers.filter(l => isExported(l)).map(l => String(l.id))
    );
    const raw = editor._sketchLayer.children().toArray()
        .filter(ch => exportedIds.has(String(ch.attr('data-layer'))))
        .map(ch => ch.node.outerHTML)
        .join('');
    return stripSvgjsAttributes(raw);
}

export function initIO(editor) {
    editor.logEditorEvent = (msg, data) => {
        console.log(`[SVG EDITOR] ${msg}`, data || '');
    };
}

/** Layer fields persisted on the root <svg> via data-editor-layers.
 *  Identity fields (id/name/visible) plus the per-pass CNC tooling so a
 *  saved drawing round-trips its full carving spec. Kept in lockstep
 *  with TOOLING_DEFAULTS in editor/layers.js — adding a new tooling
 *  field there means adding it here too. */
const _PERSISTED_LAYER_FIELDS = [
    'id', 'name', 'visible',
    'carve', 'showColor', 'fusionGeometry',
    'depth', 'profile', 'angle',
    'tx', 'ty', 'rotation', 'scale', 'mirrorX', 'mirrorY',
    'blur', 'smoothing', 'suppression',
    'edgeFilletRadius', 'filletPower',
    // SE7i: this layer's own Lattice PATTERN (if it's ever run Generate) —
    // a plain nested object, no special-casing needed in the loop below
    // (JSON.stringify handles it directly, same as any other field this
    // list's generic `l[field] !== undefined` branch already copies).
    'pattern',
];

/** Serialize the layer roster as a string attribute we can stamp onto
 *  the root <svg>. Empty layers (no elements yet) and per-layer state
 *  (name, visibility, tooling) would otherwise be lost on save→load —
 *  the data-layer attrs on children alone only tell us about layers
 *  that hold content. Returns "" if there's nothing to write. */
function _serializeLayersAttr(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    if (!layers.length) return '';
    try {
        const minimal = layers.map(l => {
            const out = {};
            for (const field of _PERSISTED_LAYER_FIELDS) {
                if (field === 'id')      out.id      = String(l.id);
                else if (field === 'name')    out.name    = l.name || '';
                else if (field === 'visible') out.visible = l.visible !== false;
                // SE10: same boolean-coercion treatment as `visible` —
                // carve/showColor default true, regardless of what odd
                // value might be sitting on the in-memory layer object
                // (defensive: a stray non-boolean here should coerce
                // sanely, not round-trip verbatim).
                else if (field === 'carve')     out.carve     = l.carve !== false;
                else if (field === 'showColor') out.showColor = l.showColor !== false;
                else if (l[field] !== undefined) out[field] = l[field];
            }
            return out;
        });
        // JSON quotes need HTML entity encoding so they survive being an
        // attribute value. Single-quote the attr so we only escape ".
        return JSON.stringify(minimal).replace(/"/g, '&quot;');
    } catch (e) {
        console.warn('[editor-io] _serializeLayersAttr failed', e);
        return '';
    }
}

/** Shared parse+filter step for getLayerSvg's two modes (the plain
 *  centerline output below, and _getLayerSvgForFusion's geometry-aware
 *  swap) — one parse, not two copies. Returns null if there's nothing
 *  to export for this layer.
 *
 *  Route the raster content through the one serializer (EDM3b): forRaster:true
 *  strips data-original-* (legacy raw <>-markup would break the strict parse
 *  below — the fill=none cause, EDM2) AND svg.js attrs BEFORE the parse. We then
 *  filter to the requested layer. Stripping svgjs BEFORE the parse also fixes a
 *  latent bug: an undeclared `svgjs:` attr made this strict parse error and return
 *  "" (empty stamp); a clean parse now returns the content. Real sketch children
 *  carry no svgjs: attrs, so output stays byte-identical there.
 */
function _parseLayerContent(editor, layerId, dpi) {
    if (!editor || !editor._draw || !editor._sketchLayer) return null;
    const targetId = String(layerId);
    const raw = serializeEditor(editor, { forRaster: true });
    if (!raw) return null;

    // Walk a parsed copy and keep only children whose data-layer matches.
    // Using DOMParser keeps the original markup's quoting/entities intact.
    const wrapper = `<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`;
    let doc;
    try {
        doc = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    } catch {
        return null;
    }
    const root = doc.documentElement;
    if (!root) return null;

    // T72 (SE14c, Fred: "sometimes don't want the contour profile"): a
    // contour hidden via PATTERN.contour.show=false stays a REAL, live
    // element (regenerateSilhouette only ever sets `display:none` on it,
    // never removes it — the lattice fill's own boundary lookup still
    // needs a live element to read stroke-width/`d` from) but must never
    // appear in an exported/Fusion-bound SVG. One declared signal
    // (`display:none`), two consumers: the browser's own renderer skips
    // it for free on-canvas; this export path drops it explicitly here,
    // since a serialized SVG string has no renderer of its own to rely on.
    let kept = 0;
    Array.from(root.children).forEach(ch => {
        const lid = ch.getAttribute('data-layer');
        if (lid == null || String(lid) !== targetId || ch.getAttribute('display') === 'none') ch.remove();
        else kept++;
    });
    if (kept === 0) return null;

    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">`;
    return { doc, root, svgOpen, targetId };
}

/** A DOMParser'd element (plain DOM, not a live svg.js instance) adapted
 *  to the small interface OUTLINE_KINDS' table entries need (`.attr()`,
 *  `.array()`, `.type`, `.node`, `.text()`) — see _getLayerSvgForFusion's
 *  own header for why this adapter exists instead of reusing the preview's
 *  live svg.js children directly. `.array()` mirrors svg.js's own
 *  points-attribute parsing (comma AND/OR whitespace separated pairs). */
function _outlineAdapter(node) {
    return {
        type: node.tagName ? node.tagName.toLowerCase() : '',
        node,
        attr: (name) => node.getAttribute(name),
        text: () => node.textContent || '',
        array: () => {
            const raw = (node.getAttribute('points') || '').trim();
            if (!raw) return [];
            const nums = raw.split(/[\s,]+/).filter(Boolean).map(Number);
            const pts = [];
            for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
            return pts;
        },
    };
}

/**
 * SE12 Slice 4: the Fusion-export geometry swap — for a layer whose
 * fusionGeometry pick is 'outline' or 'both', each exportable element is
 * replaced (outline) or joined by (both) its true offset outline, via
 * OUTLINE_KINDS — the SAME table (editor-outline-preview.js) that drives
 * the live, on-canvas outline preview, so there is exactly one geometry
 * engine, not a second copy for export. This function can't hand
 * OUTLINE_KINDS the preview's own live svg.js children (it works from a
 * DOMParser'd copy of the serialized layer content, same as getLayerSvg's
 * default path) — _outlineAdapter bridges that gap; the geometry
 * functions themselves (lineOutlinePathD, pathOutlinePathD, ...) are
 * identical code either way.
 *
 * 'centerline' (the default, and any layer never given a pick) returns
 * the same bytes getLayerSvg's default path would, just wrapped in a
 * resolved Promise so every {geometry:'fusion'} caller has ONE calling
 * convention regardless of the layer's own pick.
 *
 * Returns { svg, declined, declinedKinds }. `declined` counts elements
 * this layer's outline/both pick could NOT outline — no OUTLINE_KINDS
 * entry for the element type, or the entry's own decline (e.g. text with
 * no font mapping, an unsupported line cap) — each exports its centerline
 * instead (never dropped), individually console-warned, and summed here
 * for the caller to log/show. `declinedKinds` (T44) is the DISTINCT set
 * of element type names that declined on this layer — export-flow.js's
 * own user-facing notice names the kinds, not just a bare count.
 */
/**
 * T45 ADD-ON (Fred, via Fusion measurement): the outline replacement
 * node(s) for one source element — normally a single `<path>`, but when
 * the OUTLINE_KINDS result carries `circles` (a full circle expressed as
 * two coincident-center semicircle `A`s — SVG's own workaround for "one
 * `A` can't express a full circle" — never a genuinely partial arc; see
 * circleOutlinePathD/lineOutlinePathD's own zero-length case, the two
 * producers wired up this turn), a native `<circle>` per entry instead.
 * Fusion's importSVG turns a `<circle>` into a true SketchCircle at exact
 * radius; two `A`s import as two separate SketchArcs — measured directly
 * (the advisor's own Fusion sketch: 82 SketchArcs, 0 SketchCircles before
 * this fix), not assumed. Every producer wired up this turn has its own
 * `d` ENTIRELY composed of the same circles it declares — never a mix
 * with other path geometry — so `circles` present means `d` is skipped
 * here, not supplemented; a future producer that DOES mix would need its
 * own handling, not silently assumed to fit this one.
 */
function _buildOutlineReplacementNodes(doc, result, ch) {
    const dataAttrs = Array.from(ch.attributes).filter((attr) => attr.name.startsWith('data-'));
    // Same contract as the live preview (refreshOutlinePreview): the
    // outline geometry is in the element's own LOCAL frame, so its
    // `transform` attribute — uncomposed — carries over unchanged.
    const t = ch.getAttribute('transform');
    const stroke = ch.getAttribute('stroke') || '#000000';
    const strokeWidth = ch.getAttribute('stroke-width') || '0.01';

    const decorate = (node) => {
        if (t) node.setAttribute('transform', t);
        // SA-ROUNDTRIP-2's _carveText already established this precedent
        // (a text->path swap at bake time carries every data-* attr over)
        // — followed here for the same reason: whatever metadata the
        // source element carried stays on whatever geometry now stands in
        // for it in the export.
        for (const attr of dataAttrs) node.setAttribute(attr.name, attr.value);
        return node;
    };

    if (result.circles && result.circles.length) {
        return result.circles.map(({ cx, cy, r }) => {
            const circle = doc.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx);
            circle.setAttribute('cy', cy);
            circle.setAttribute('r', r);
            circle.setAttribute('fill', 'none');
            circle.setAttribute('stroke', stroke);
            circle.setAttribute('stroke-width', strokeWidth);
            return decorate(circle);
        });
    }

    const outlinePath = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    outlinePath.setAttribute('d', result.d);
    outlinePath.setAttribute('fill', 'none');
    outlinePath.setAttribute('stroke', stroke);
    outlinePath.setAttribute('stroke-width', strokeWidth);
    return [decorate(outlinePath)];
}

async function _getLayerSvgForFusion(editor, layerId, dpi) {
    const parsed = _parseLayerContent(editor, layerId, dpi);
    if (!parsed) return { svg: '', declined: 0, declinedKinds: [] };
    const { doc, root, svgOpen, targetId } = parsed;

    const layer = Array.isArray(editor._layers) ? editor._layers.find((l) => String(l.id) === targetId) : null;
    const kind = (layer && layer.fusionGeometry) || 'centerline';
    if (kind === 'centerline') {
        const inner = stripSvgjsAttributes(root.innerHTML);
        return { svg: `${svgOpen}${inner}</svg>`, declined: 0, declinedKinds: [] };
    }

    let declined = 0;
    const declinedKindSet = new Set();
    for (const ch of Array.from(root.children)) {
        const type = ch.tagName ? ch.tagName.toLowerCase() : '';
        if (NON_GEOMETRY_NODE_TYPES.includes(type)) continue; // metadata (defs/etc) — never a geometry candidate
        const outlineFor = OUTLINE_KINDS[type];
        const result = outlineFor ? await outlineFor(_outlineAdapter(ch)) : { d: null, unsupported: 'no-outline-kind' };
        if (!result || result.unsupported || !result.d) {
            declined++;
            declinedKindSet.add(type || '?');
            console.warn(`[EDITOR-IO] getLayerSvg: layer ${targetId} <${type || '?'}> declined outline geometry (${(result && result.unsupported) || 'no-outline-kind'}) — exporting its centerline instead.`);
            continue; // ch stays exactly as-is: its own centerline
        }
        const nodes = _buildOutlineReplacementNodes(doc, result, ch);
        if (kind === 'both') {
            let anchor = ch;
            for (const node of nodes) { // keep the centerline element too, then every replacement node after it, in order
                anchor.parentNode.insertBefore(node, anchor.nextSibling);
                anchor = node;
            }
        } else {
            ch.parentNode.replaceChild(nodes[0], ch);
            let anchor = nodes[0];
            for (let i = 1; i < nodes.length; i++) { // any remaining nodes (e.g. a stroke-mode circle's 2nd ring) go right after the first
                anchor.parentNode.insertBefore(nodes[i], anchor.nextSibling);
                anchor = nodes[i];
            }
        }
    }

    const inner = stripSvgjsAttributes(root.innerHTML);
    return { svg: `${svgOpen}${inner}</svg>`, declined, declinedKinds: [...declinedKindSet] };
}

/**
 * Build a self-contained SVG string that contains ONLY the children of
 * the editor's sketch layer that carry `data-layer="<layerId>"`. Used
 * by the rasterizer-compositor pipeline to produce one stamp pass per
 * editor layer (Step 3 of the stamp-layer → editor-layer unification).
 *
 * Returns "" if the editor isn't drawn yet, or if the layer has no
 * matching children — the caller is expected to treat empty content as
 * "skip this pass" rather than rasterize a blank mask.
 *
 * SE12 Slice 4: `options.geometry === 'fusion'` swaps in the layer's OWN
 * fusionGeometry pick (outline/both) instead of always emitting the raw
 * centerline — see _getLayerSvgForFusion. Every OTHER caller (the
 * default, no options — the carve mask in stamp-mask-manager.js in
 * particular) is untouched: same code path, same bytes, as before this
 * slice. `options.geometry === 'fusion'` returns a Promise ({svg,
 * declined}) instead of a plain string — text glyph outlines need an
 * async font fetch, so any 'fusion' caller must await regardless of
 * whether THIS layer's own pick happens to need one.
 */
export function getLayerSvg(editor, layerId, dpi = 96, options = {}) {
    if (options.geometry === 'fusion') return _getLayerSvgForFusion(editor, layerId, dpi);
    const parsed = _parseLayerContent(editor, layerId, dpi);
    if (!parsed) return "";
    const inner = stripSvgjsAttributes(parsed.root.innerHTML);
    return `${parsed.svgOpen}${inner}</svg>`;
}

/**
 * Bake the board→Fusion carve transform into every element's geometry and
 * return a Fusion-ready SVG. This is THE single, authoritative carve
 * transform (Option A): it replaces the old normalizeSvgForCarving `<g>`
 * flip AND the Python _prescale_svg regex — which together double-flipped,
 * and (comma-only) failed to scale the space-separated path `d` svg.js
 * emits, so every path came through at 1/dpi (micro), unflipped, uncentered.
 *
 * Fusion's importer reads raw pixel coords (1 unit = 1/dpi inch) and ignores
 * viewBox/scale/element transforms, so the mapping (carveMatrix: ×dpi, flip
 * Y, center) MUST be baked into the coordinates. Each element bakes
 * (carveMatrix × el.matrix()), folding in its own drag/scale transform.
 * Uses svg.js (a real SVG engine) so all path syntaxes/curves bake
 * correctly. Returns the input unchanged if svg.js is unavailable.
 *
 * SE8d / SA-ROUNDTRIP-2: a rotated/skewed/non-uniformly-scaled <text> is
 * converted to a glyph-outline path before baking (see _carveText below) —
 * Fusion's importer ignoring element transforms (this docstring's own
 * point, above) means leaving the rotation ON the <text> as a `transform`
 * would import upright regardless; only baked path geometry survives the
 * importer. Async because that conversion loads a font file over the
 * network (opentype.js) — both call sites (main/export-flow.js) already
 * run inside an async function, so this just adds one more `await`.
 * Upright / uniformly-scaled text (the common case) skips the font-fetch
 * entirely and keeps the cheap anchor+font-size bake.
 */
export async function bakeSvgForCarving(svgText, widthIn, heightIn, dpi = 96) {
    if (!svgText) return svgText;
    if (typeof SVG === 'undefined' || !SVG.Matrix) return svgText;
    try {
        const carve = new SVG.Matrix(carveMatrix(widthIn, heightIn, dpi));
        const root = SVG(svgText);
        if (!root || typeof root.children !== 'function') return svgText;
        await _carveChildren(root, carve);
        const halfW = widthIn * dpi / 2, halfH = heightIn * dpi / 2;
        try { root.viewbox(-halfW, -halfH, widthIn * dpi, heightIn * dpi); } catch (_) {}
        const out = root.svg();
        try { root.remove(); } catch (_) {}
        return out;
    } catch (e) {
        try { fusLog('[CARVE] bakeSvgForCarving failed: ' + e.message); } catch (_) {}
        return svgText;
    }
}

/** SE8b / SA-TEXT-3: node types that are metadata/definitions, never
 *  drawable sketch geometry — declared once, used by BOTH the carve-bake
 *  walk below (which must not try to carve them) and
 *  _reconcileLayersFromSvg's orphan-adoption walk (which must not stamp
 *  a data-layer onto them either — see that function's own comment). */
const NON_GEOMETRY_NODE_TYPES = ['defs', 'title', 'desc', 'style'];

/** Bake carve into each geometry leaf, descending through <g> (composing the
 *  group's own transform) so any wrapped content still bakes correctly.
 *  `Array.from` up front — svg.js's own List can be walked live, but this
 *  loop MUTATES the tree (text -> path swaps out a child mid-walk), which
 *  would skip/repeat siblings if the loop re-read a live collection. */
async function _carveChildren(container, carve) {
    for (const ch of Array.from(container.children())) {
        const type = ch.type;
        if (NON_GEOMETRY_NODE_TYPES.includes(type)) continue;
        if (type === 'g') {
            await _carveChildren(ch, carve.multiply(ch.matrix()));
            ch.attr('transform', null);   // the group's transform is now baked into its children
            continue;
        }
        const combined = carve.multiply(ch.matrix());
        if (type === 'text') { await _carveText(container, ch, combined); continue; }
        bakeMatrixIntoElement(ch, combined);
    }
}

/** SA-ROUNDTRIP-2: does the FULL bake matrix (carve x el.matrix(), and any
 *  ancestor <g> transforms already folded in by _carveChildren) carry
 *  rotation, skew, or non-uniform scale? If so, `_carveTextAnchor`'s
 *  font-size x |m.a| shortcut is wrong — it only accounts for x-scale and
 *  drops rotation/skew outright (a 45°-rotated text carved perfectly
 *  upright at cos(45°) of its real size, silently, no error). Checked with
 *  a RELATIVE epsilon (scaled to the matrix's own magnitude) rather than a
 *  fixed one, since `m` already has carve's dpi (e.g. 96x) baked in here —
 *  a fixed absolute epsilon tuned for inch-scale numbers would misfire at
 *  pixel scale. */
export function _needsGlyphBake(m) {
    if (!m) return false;
    if (Math.abs(m.b) > 1e-9 || Math.abs(m.c) > 1e-9) return true; // rotation/skew
    const scale = Math.max(Math.abs(m.a), Math.abs(m.d), 1);
    return Math.abs(Math.abs(m.a) - Math.abs(m.d)) > scale * 1e-6; // non-uniform scale
}

/** <text> carve dispatcher: the common case (no rotation/skew/non-uniform
 *  scale) stays the cheap anchor+font-size bake; anything else converts to
 *  a glyph-outline path first (textGlyphPathD, editor-expand-text.js —
 *  the SAME font-loading/glyph-generation code the interactive Expand
 *  tool uses, not a second copy) so orientation and per-axis size survive
 *  the bake. Falls back to the anchor-only bake (with a loud, non-silent
 *  warning) if the glyph bake itself fails (no font mapping for the
 *  family, or the font fetch failed) — the audit's own point is that this
 *  defect must never be SILENT; a degraded-but-logged carve beats a
 *  vanished layer or an unhandled rejection aborting the whole export. */
async function _carveText(container, textEl, m) {
    if (_needsGlyphBake(m)) {
        const d = await textGlyphPathD(textEl, m);
        if (d) {
            const newPath = container.path(d)
                .fill(textEl.attr('fill') || '#000000')
                .stroke('none')
                .attr('fill-rule', 'evenodd');
            const node = textEl.node;
            for (const attr of Array.from(node.attributes)) {
                if (attr.name.startsWith('data-')) newPath.attr(attr.name, attr.value);
            }
            try { newPath.insertAfter(textEl); } catch (_) {}
            textEl.remove();
            return;
        }
        try {
            fusLog('[CARVE] SA-ROUNDTRIP-2: glyph bake failed for a rotated/scaled <text> ' +
                '(no font mapping or fetch failure) — falling back to the anchor-only bake, ' +
                'which will carve it upright/wrong-size.');
        } catch (_) {}
    }
    _carveTextAnchor(textEl, m);
}

/** <text> carve: position the anchor + scale font-size (no glyph flip).
 *  Correct only when `m` carries no rotation/skew/non-uniform scale — see
 *  _needsGlyphBake, which gates every call site that reaches this. */
function _carveTextAnchor(textEl, m) {
    const p = transformPoint(m, { x: parseFloat(textEl.attr('x')) || 0, y: parseFloat(textEl.attr('y')) || 0 });
    textEl.attr('x', p.x);
    textEl.attr('y', p.y);
    const fs = parseFloat(textEl.attr('font-size'));
    if (fs) textEl.attr('font-size', fs * Math.abs(m.a));
    textEl.attr('transform', null);
}

export function save(editor, dpi = 96) {
    if (!editor._draw) return "";
    // Serialize the FULL document (all layers, incl. hidden). Hidden layers'
    // visibility is persisted in data-editor-layers and re-applied on reopen,
    // so their geometry must NOT be dropped here (B6). Stamp exclusion of
    // hidden layers is handled in getLayerSvg, not here.
    const content = serializeEditor(editor);
    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const layersAttr = _serializeLayersAttr(editor);
    const layersAttrStr = layersAttr ? ` data-editor-layers="${layersAttr}"` : '';
    const activeAttrStr = editor._activeLayer != null ? ` data-editor-active-layer="${String(editor._activeLayer)}"` : '';
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}"${layersAttrStr}${activeAttrStr}>${content}</svg>`;
    return svgString;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function guessFontMime(url) {
    const ext = url.split('.').pop().toLowerCase();
    switch (ext) {
        case 'otf': return 'font/otf';
        case 'woff': return 'font/woff';
        case 'woff2': return 'font/woff2';
        case 'eot': return 'application/vnd.ms-fontobject';
        case 'svg': return 'image/svg+xml';
        default: return 'font/ttf';
    }
}

async function resolveFontUrl(rule, defaultFamily) {
    const src = rule.style.getPropertyValue('src');
    if (!src) return null;
    const urlMatch = src.match(/url\(([^)]+)\)/);
    if (!urlMatch) return null;
    let url = urlMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (url.startsWith('data:')) return url;
    try {
        const absolute = new URL(url, window.location.href).href;
        const resp = await fetch(absolute);
        if (!resp.ok) return null;
        const buffer = await resp.arrayBuffer();
        const base64 = arrayBufferToBase64(buffer);
        const formatMatch = src.match(/format\(([^)]+)\)/);
        const format = formatMatch ? formatMatch[1].trim().replace(/^['"]|['"]$/g, '') : null;
        const mime = guessFontMime(absolute);
        const dataUrl = `data:${mime};base64,${base64}`;
        return `url('${dataUrl}')${format ? ` format('${format}')` : ''}`;
    } catch {
        return null;
    }
}

async function getEmbeddedFontCss(family) {
    const familyName = family.replace(/['"]+/g, '').trim();
    for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
            if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
            const ruleFamily = rule.style.getPropertyValue('font-family').replace(/['"]+/g, '').trim();
            if (ruleFamily !== familyName) continue;
            const src = await resolveFontUrl(rule, familyName);
            if (!src) continue;
            const weight = rule.style.getPropertyValue('font-weight') || '400';
            return `@font-face { font-family: '${familyName}'; font-weight: ${weight}; src: ${src}; }`;
        }
    }
    return null;
}

/**
 * Like save() but scans every <text> element in the sketch layer for its
 * font-family and embeds matching @font-face rules (with base64 data:
 * URLs) inside a <defs><style> block. Required by the stamp/rasterization
 * pipeline on iOS, where the rasterizer loads the SVG as a detached
 * data: URL — document-level @font-face does NOT apply, and iOS does
 * not ship Symbol/Wingdings/Webdings/Segoe UI Symbol as system fonts,
 * so without embedded fonts those text elements rasterize as plain
 * Latin glyphs. Async because of the font fetch + base64 conversion.
 */
/** SE8a / SA-TEXT-2: the ONE class name saveForRasterization's embedded
 *  font-face block carries, and both strip sites (here, and open() below)
 *  look for. */
const RASTERIZATION_FONTS_CLASS = 'rasterization-fonts';

/** Remove any existing rasterization-fonts <defs> block from a content
 *  string BEFORE embedding a fresh one — without this, saving a document
 *  that already carries one from a previous cycle (open() injects the
 *  WHOLE saved document, defs block included, straight into the live
 *  sketch layer) would nest one more copy on top of it, growing the
 *  persisted payload (and localStorage) unboundedly per open/edit/close
 *  cycle. Global (`g`) in case more than one has already accumulated
 *  from before this fix landed. Exported for direct testing (a pure
 *  string function — no need to drive it only through saveForRasterization,
 *  whose own font-embedding step can't be exercised in a test environment
 *  with no real @font-face rules to find). */
export function stripRasterizationFontDefs(svgText) {
    const re = new RegExp(`<defs class="${RASTERIZATION_FONTS_CLASS}">[\\s\\S]*?</defs>`, 'g');
    return svgText.replace(re, '');
}

export async function saveForRasterization(editor, dpi = 96) {
    if (!editor._draw) return "";
    const content = stripRasterizationFontDefs(serializeEditor(editor));

    // Collect every font-family referenced by a <text> in the content.
    // Parse via DOMParser so we work on real elements regardless of how
    // svg.js serialized the markup.
    const fontFamilies = new Set();
    try {
        const tempSvg = `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
        const parsed = new DOMParser().parseFromString(tempSvg, 'image/svg+xml');
        parsed.querySelectorAll('text').forEach(textEl => {
            const family = textEl.getAttribute('font-family');
            if (family) fontFamilies.add(family.replace(/['"]/g, '').trim());
        });
    } catch (err) {
        console.warn('[editor-io] saveForRasterization: font-family scan failed', err);
    }

    // Embed @font-face for every family we have a webfont registered for.
    // getEmbeddedFontCss returns null for families we don't ship — those
    // fall through to OS fonts (fine for Arial / Tahoma / etc.).
    const fontCss = [];
    for (const family of fontFamilies) {
        const css = await getEmbeddedFontCss(family);
        if (css) fontCss.push(css);
    }

    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const styleBlock = fontCss.length
        ? `<defs class="${RASTERIZATION_FONTS_CLASS}"><style type="text/css">${fontCss.join('\n')}</style></defs>`
        : '';
    const layersAttr = _serializeLayersAttr(editor);
    const layersAttrStr = layersAttr ? ` data-editor-layers="${layersAttr}"` : '';
    const activeAttrStr = editor._activeLayer != null ? ` data-editor-active-layer="${String(editor._activeLayer)}"` : '';
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}"${layersAttrStr}${activeAttrStr}>${styleBlock}${content}</svg>`;
    return svgString;
}

export async function saveWithTextCopies(editor, dpi = 96) {
    if (!editor._draw) return "";
    // SE10 AMEND: SHOWN layers only (_serializeVisibleLayers) — this is
    // the Download SVG export path specifically, not the regular save.
    const content = _serializeVisibleLayers(editor);
    const textCopies = [];
    const fontFamilies = new Set();
    editor._sketchLayer.children().forEach(ch => {
        const originalTextSvg = decodeSnapshot(ch.attr('data-original-text-svg'));
        if (originalTextSvg) {
            textCopies.push(originalTextSvg);
            const tempEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            tempEl.innerHTML = originalTextSvg;
            const textEl = tempEl.querySelector('text');
            if (textEl) {
                const family = textEl.getAttribute('font-family');
                if (family) fontFamilies.add(family.replace(/['"]/g, '').trim());
            }
        }
    });
    const fontCss = [];
    for (const family of fontFamilies) {
        const css = await getEmbeddedFontCss(family);
        if (css) fontCss.push(css);
    }
    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    
    // v49: Seal text copies in a proper <defs> block to ensure they never render.
    const textContent = textCopies.length ? `<defs class="editor-metadata">${textCopies.join('')}</defs>` : '';


    const styleBlock = fontCss.length ? `<defs><style type="text/css">${fontCss.join('\n')}</style></defs>` : '';
    const layersAttr = _serializeLayersAttr(editor);
    const layersAttrStr = layersAttr ? ` data-editor-layers="${layersAttr}"` : '';
    const activeAttrStr = editor._activeLayer != null ? ` data-editor-active-layer="${String(editor._activeLayer)}"` : '';
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}"${layersAttrStr}${activeAttrStr}>${styleBlock}${content}${textContent}</svg>`;
    return svgString;
}

/**
 * Bring all <text> elements in the sketch layer into the editor's
 * baseline convention (alphabetic baseline + data-anchor-y). The
 * per-element migration logic lives in editor-text-baseline.js; this
 * is just the bulk-walk on import.
 *
 * Why care: the hanging baseline is honored in the live SVG renderer
 * but NOT when the same SVG is rasterized via <img> in the stamp
 * pipeline (which falls back to alphabetic). Rewriting to alphabetic
 * + anchor-y keeps live render, stamp, and opentype expand all aligned.
 */
function _migrateHangingBaselineTexts(sketchLayer, defaultFontSize) {
    sketchLayer.children().forEach(ch => migrateTextElement(ch, defaultFontSize));
}

/**
 * Reconstitute the layers panel from data-layer attributes on the
 * loaded SVG so the invariant "every element is on a layer" survives a
 * round trip. Walk every child:
 *   - if it carries a data-layer id, make sure that id exists in
 *     editor._layers (create a Layer N entry if not)
 *   - if it carries no data-layer at all (legacy SVG / pasted markup),
 *     stamp it onto the first reconciled layer
 * Returns the id of the layer we picked as active, or null if the
 * sketch was empty (in which case the user's first draw will trigger
 * ensureActiveLayer).
 *
 * Exported (despite the underscore) for direct testing — open() itself
 * needs a much heavier mock (clear/svg/children/_bgLayer/_gridLayer/
 * _deselect/resetPanState/sync3DBackground) than this one function alone.
 */
export function _reconcileLayersFromSvg(editor) {
    if (!editor._sketchLayer) {
        _ioLog('reconcile: no _sketchLayer, bail');
        return null;
    }
    const children = editor._sketchLayer.children().toArray();
    _ioLog(`reconcile: childCount=${children.length}`);
    if (children.length === 0) {
        // No children to reconcile, but still create a Layer 1 so the
        // layer panel isn't empty when the user opens an SVG that
        // happens to have no shapes (e.g. just <defs> from font embed).
        // Matches the BUG-10 fix's auto-create behavior on init.
        const anchor = applyToolingDefaults({ id: '0', name: 'Layer 1', visible: true });
        editor._layers = [anchor];
        editor._nextLayerId = 1;
        return anchor.id;
    }

    // Reset the runtime roster — we trust the SVG as the source of truth.
    editor._layers = [];

    const seen = new Map(); // id (string) -> layer object
    const orphans = [];     // children with no data-layer

    children.forEach((ch, i) => {
        // SE8b / SA-TEXT-3: metadata (e.g. the embedded rasterization-
        // fonts <defs> block) carries no data-layer and would otherwise
        // be adopted as an "orphan" below — stamping a data-layer onto a
        // <defs> block and treating it as sketch content it isn't.
        if (NON_GEOMETRY_NODE_TYPES.includes(ch.type)) return;
        const raw = ch.attr('data-layer');
        const tag = ch.node?.tagName || '?';
        const cls = ch.node?.getAttribute?.('class') || '';
        if (i < 5) _ioLog(`  child[${i}] tag=${tag} data-layer="${raw}" class="${cls}"`);
        if (raw == null || raw === '') {
            orphans.push(ch);
            return;
        }
        const id = String(raw);
        if (!seen.has(id)) {
            // applyToolingDefaults so reconciled-from-legacy-SVG layers
            // carry the same per-pass CNC fields that addLayer() seeds.
            const layer = applyToolingDefaults({ id, name: `Layer ${seen.size + 1}`, visible: true });
            editor._layers.push(layer);
            seen.set(id, layer);
        }
    });

    // If we found orphans (or zero data-layer'd elements), ensure we
    // have at least one layer to anchor them to.
    let anchor = editor._layers[0];
    if (!anchor) {
        anchor = applyToolingDefaults({ id: '0', name: 'Layer 1', visible: true });
        editor._layers.push(anchor);
    }
    if (orphans.length > 0) {
        _ioLog(`reconcile: ${orphans.length} orphan(s) -> anchored to layer ${anchor.id}`);
        orphans.forEach(ch => ch.attr('data-layer', anchor.id));
    }

    // Keep _nextLayerId ahead of the highest numeric id we've seen so
    // future addLayer() calls don't collide.
    const numericIds = editor._layers
        .map(l => Number(l.id))
        .filter(n => !isNaN(n));
    editor._nextLayerId = numericIds.length ? Math.max(...numericIds) + 1 : 0;

    _ioLog(`reconcile done: layers=${editor._layers.map(l => l.id).join(',')}  anchor=${anchor.id}  nextId=${editor._nextLayerId}`);
    return anchor.id;
}

/** SE7i MIGRATION: attach a COPY of a legacy (pre-SE7i, file-level)
 *  Lattice pattern to every layer that actually holds that pattern's
 *  generated pieces (data-lattice-gen) — under the old 3-layer-per-
 *  pattern model (Rails/Ties/Nodes) that can be more than one layer; each
 *  gets its own independent copy (not a shared reference) so editing one
 *  later doesn't retroactively change another's settings. No-op when
 *  there's no legacy pattern to migrate, or once ANY layer already
 *  carries a `.pattern` (a document saved AFTER this migration shipped)
 *  — so this only ever runs once per legacy file. Extracted as its own
 *  function (called from open(), below) so the DECISION — which layers
 *  qualify — is unit-testable without open()'s own heavy DOMParser/svg.js
 *  machinery: only `editor._sketchLayer.children()` and `editor._layers`
 *  are read here. */
export function _migrateLegacyPatternOntoLayers(editor, legacyPattern) {
    if (!legacyPattern || !Array.isArray(editor._layers)) return;
    if (editor._layers.some(l => l.pattern)) return;
    if (!editor._sketchLayer) return;
    const ownedLayerIds = new Set(
        editor._sketchLayer.children().toArray()
            .filter(ch => ch && ch.node && ch.node.hasAttribute(OWNERSHIP_ATTR))
            .map(ch => ch.node.getAttribute('data-layer'))
    );
    for (const layer of editor._layers) {
        if (ownedLayerIds.has(layer.id)) {
            layer.pattern = JSON.parse(JSON.stringify(legacyPattern));
        }
    }
    if (ownedLayerIds.size) _ioLog(`open: migrated legacy pattern onto layer(s) [${[...ownedLayerIds].join(',')}]`);
}

export function open(editor, svgString, w, h) {
    _ioLog(`open() called  svgLen=${(svgString || '').length}  w=${w} h=${h}`);
    editor.setModelMetrics(w, h);
    editor._sketchLayer.clear();
    // T8: the wiped sketch layer's old selection (if any) would otherwise
    // leave its highlight halo / transform handles ghosted on screen — they
    // live in separate layers (_highlightLayer/_handleLayer) that
    // _sketchLayer.clear() never touches.
    if (typeof editor._deselect === 'function') editor._deselect();
    // SE7a: the hover snap-cursor is scoped to a mode/session — a reopen
    // shouldn't carry the previous session's marker (or reference) across.
    clearSnapCursor(editor);
    // T31: same reason for the grid hover highlight.
    clearGridHover(editor);
    sync3DBackground(editor);
    // T6: a fresh session must never start pan-ready — the previous
    // session's Space/pan state has no meaning here.
    resetPanState(editor);

    // Fresh editor session: wipe any leftover undo history from a previous
    // session so the user can't Ctrl+Z back into someone else's design.
    // We push an initial snapshot at the end (whether content was loaded
    // or not) so the very first user action — including the very first
    // stroke in an empty session — is undoable.
    editor._undoStack = [];
    editor._redoStack = [];
    // Reset the layer roster too so it can't bleed across sessions.
    // _reconcileLayersFromSvg below will rebuild it from the loaded SVG.
    editor._layers = [];
    editor._activeLayer = null;

    if (!svgString) {
        _ioLog('open: no svgString -> empty editor');
        // Same auto-create as initLayerControls (BUG-10) so a fresh
        // editor session always has a Layer 1 ready to go, instead of
        // showing an empty layers list and the user wondering where to
        // draw. skipUndo so this doesn't pollute the undo stack.
        const layer = addLayer(editor, { skipUndo: true });
        setActiveLayer(editor, layer.id);
        if (typeof editor.pushState === 'function') editor.pushState();
        return;
    }
    try {
        let svgEl = new DOMParser().parseFromString(svgString, 'image/svg+xml').querySelector('svg');
        if (!svgEl) {
            // Legacy poison: an old save whose data-original-* holds raw <>-markup
            // (invalid XML) makes the strict parse fail (querySelector -> null),
            // which used to reopen a BLANK editor. Strip those attrs and retry so
            // the drawing still restores (re-edit metadata for those elements is
            // lost, but the geometry survives). New saves are base64 = valid XML
            // and parse on the first try. (EDM2)
            const cleaned = stripOriginalAttrs(svgString);
            svgEl = new DOMParser().parseFromString(cleaned, 'image/svg+xml').querySelector('svg');
            if (svgEl) _ioLog('open: recovered from legacy data-original poison (stripped attrs)');
        }
        if (svgEl) {
            // v47: Filter out metadata elements so they don't clutter the sketch layer
            // v49: Filter out Defs-based metadata so it doesn't clutter the sketch layer
            const metadata = svgEl.querySelector('.editor-metadata');
            if (metadata) metadata.remove();
            // SE8a / SA-TEXT-2: strip on open too (belt-and-suspenders with
            // the save-side strip above, and a one-time cleanup for any
            // document that already accumulated copies before this fix).
            // querySelectorAll, not querySelector — a document saved
            // several open/edit/close cycles before this fix could carry
            // more than one.
            svgEl.querySelectorAll(`.${RASTERIZATION_FONTS_CLASS}`).forEach((d) => d.remove());

            // Pull persisted layer metadata BEFORE injecting innerHTML — once
            // we hand the markup to svg.js the root attrs are gone.
            const layersJson = svgEl.getAttribute('data-editor-layers');
            const persistedActive = svgEl.getAttribute('data-editor-active-layer');
            let persistedLayers = null;
            if (layersJson) {
                try {
                    persistedLayers = JSON.parse(layersJson);
                    _ioLog(`open: found data-editor-layers (${persistedLayers.length} layer(s)), active="${persistedActive}"`);
                } catch (e) {
                    _ioLog(`open: data-editor-layers JSON parse failed (${e.message}) — falling back to reconcile`);
                    persistedLayers = null;
                }
            }

            // SE7i MIGRATION: data-lattice-pattern was the OLD file-level
            // pattern attribute (one shared PATTERN for the whole document,
            // SE7b) — settings now live per-layer (layer.pattern,
            // persisted inside data-editor-layers instead). Pulled into a
            // local here, BEFORE injecting innerHTML (same reason as
            // data-editor-layers above), and attached to whichever
            // layer(s) actually hold this pattern's generated pieces once
            // the roster is restored below — never assigned to a live
            // editor._latticePattern field, which retires entirely.
            let legacyPattern = null;
            const latticePatternJson = svgEl.getAttribute('data-lattice-pattern');
            if (latticePatternJson) {
                try {
                    legacyPattern = JSON.parse(latticePatternJson);
                    _ioLog(`open: found LEGACY data-lattice-pattern (id="${legacyPattern && legacyPattern.id}") — migrating to per-layer`);
                } catch (e) {
                    _ioLog(`open: data-lattice-pattern JSON parse failed (${e.message})`);
                    legacyPattern = null;
                }
            }

            editor._sketchLayer.svg(svgEl.innerHTML);
            editor._sketchLayer.children().forEach(ch => {
                if (ch.hasClass('calib-anchor')) ch.remove();
                // DO NOT strip transform here. The select-mode drag
                // writes its offset as transform="translate(dx, dy)" on
                // the element (SVG.js's translate() helper). Wiping that
                // on reopen sends every dragged element back to its
                // original x/y attrs.
                ch.css('cursor', ch.type === 'text' ? 'text' : 'pointer');
            });

            _migrateHangingBaselineTexts(editor._sketchLayer, editor._fontSize);

            // Layer-roster restore: prefer the persisted roster (preserves
            // empty layers, names, visibility, tooling). Fall back to
            // reconciling from data-layer attrs for legacy / imported
            // SVGs that don't carry the metadata.
            //
            // applyToolingDefaults fills in any tooling field the saved
            // roster doesn't carry — backward-compat for SVGs saved
            // before the tooling fields were persisted.
            let firstLayerId = null;
            if (Array.isArray(persistedLayers) && persistedLayers.length > 0) {
                editor._layers = persistedLayers.map(l => {
                    const restored = {
                        ...l,                           // tooling fields first
                        id: String(l.id),                // identity overrides
                        name: l.name || `Layer`,
                        visible: l.visible !== false,
                    };
                    return applyToolingDefaults(restored);
                });
                // Bump _nextLayerId past any numeric id we just restored.
                const numericIds = editor._layers
                    .map(l => Number(l.id))
                    .filter(n => !isNaN(n));
                editor._nextLayerId = numericIds.length ? Math.max(...numericIds) + 1 : 0;
                // Active: persisted choice if it still exists, else first.
                firstLayerId = (persistedActive != null && editor._layers.some(l => l.id === String(persistedActive)))
                    ? String(persistedActive)
                    : editor._layers[0].id;
                _ioLog(`open: restored roster from attr  layers=[${editor._layers.map(l => l.id).join(',')}]  active=${firstLayerId}`);
            } else {
                firstLayerId = _reconcileLayersFromSvg(editor);
                _ioLog(`open: reconciled (no persisted attr)  firstLayer=${firstLayerId}`);
            }

            _migrateLegacyPatternOntoLayers(editor, legacyPattern);

            if (typeof editor.setActiveLayer === 'function') {
                editor.setActiveLayer(firstLayerId);
            }
        }
    } catch (err) { console.error('[SVG EDITOR] Re-import failure:', err); }

    // Capture the post-load state as the baseline. The first user edit
    // pushes state #2, and Ctrl+Z restores #1 (this freshly-loaded state)
    // — so even an edit applied to the very first stroke is reversible.
    if (typeof editor.pushState === 'function') editor.pushState();
}

export function sync3DBackground(editor) {
    const topViewCanvas = document.getElementById('svgEditorTopView');
    if (topViewCanvas && editor._draw) {
        editor._bgLayer.clear();
        editor._bgLayer.image(topViewCanvas.toDataURL("image/png"))
            .size(editor._mW, editor._mH)
            .attr({ opacity: 1.0, preserveAspectRatio: 'none' });
        
        if (editor._border) editor._border.remove();
        editor._border = editor._bgLayer.rect(editor._mW, editor._mH)
          .fill('none')
          .stroke({ color: '#ff0000', width: 0.01, dasharray: '0.1,0.1' });
    }
}

export function getPointerPos(editor, e) {
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }
    return editor._draw.point(clientX, clientY);
}
