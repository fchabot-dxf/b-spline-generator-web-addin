/**
 * editor-io.js - persistence logic for VectorEditor.
 * Handles SVG serialization and re-import.
 */

import { stripSvgjsAttributes } from '../core/svg-utils.js';
import { migrateTextElement } from './editor-text-baseline.js';
import { fusLog } from '../core/fusion-bridge.js';
import { applyToolingDefaults, addLayer, setActiveLayer } from './layers.js';

/** Editor-IO diagnostic logging — fusLog goes to the Fusion log file so
 *  layer-restore regressions stay observable. Console output is quiet by
 *  default; flip window.__editorDebug = 'EDITOR-IO' in devtools to enable. */
function _ioLog(msg) {
    if (typeof window !== 'undefined' && window.__editorDebug === 'EDITOR-IO') {
        try { console.log(`[EDITOR-IO] ${msg}`); } catch (_) {}
    }
    try { fusLog(`[EDITOR-IO] ${msg}`); } catch (_) {}
}

/** Build the sketch-layer content string with elements on hidden layers
 *  filtered out. The visibility flag is meant to affect both the live
 *  view (CSS) AND the stamp geometry sent to Fusion, so save() needs to
 *  drop those elements rather than carrying them through. Returns the
 *  stripped innerHTML. If no hidden layers exist, returns the raw
 *  innerHTML unchanged. */
function _visibleContent(editor) {
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    const hidden = new Set(layers.filter(l => l.visible === false).map(l => l.id));
    const raw = editor._sketchLayer.node.innerHTML;
    if (hidden.size === 0) return stripSvgjsAttributes(raw);

    // Walk a parsed copy and drop hidden-layer elements before
    // serializing. Using DOMParser keeps quoting/entities sane.
    const wrapper = `<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`;
    let doc;
    try {
        doc = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    } catch {
        return stripSvgjsAttributes(raw);
    }
    const root = doc.documentElement;
    if (!root) return stripSvgjsAttributes(raw);
    Array.from(root.children).forEach(ch => {
        const lid = ch.getAttribute('data-layer');
        if (lid != null && hidden.has(String(lid))) ch.remove();
    });
    return stripSvgjsAttributes(root.innerHTML);
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
    'depth', 'profile', 'angle',
    'tx', 'ty', 'rotation', 'scale', 'mirrorX', 'mirrorY',
    'blur', 'smoothing', 'suppression',
    'edgeFilletRadius', 'filletPower',
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

/**
 * Build a self-contained SVG string that contains ONLY the children of
 * the editor's sketch layer that carry `data-layer="<layerId>"`. Used
 * by the rasterizer-compositor pipeline to produce one stamp pass per
 * editor layer (Step 3 of the stamp-layer → editor-layer unification).
 *
 * Returns "" if the editor isn't drawn yet, or if the layer has no
 * matching children — the caller is expected to treat empty content as
 * "skip this pass" rather than rasterize a blank mask.
 */
export function getLayerSvg(editor, layerId, dpi = 96) {
    if (!editor || !editor._draw || !editor._sketchLayer) return "";
    const targetId = String(layerId);
    const raw = editor._sketchLayer.node.innerHTML;
    if (!raw) return "";

    // Walk a parsed copy and keep only children whose data-layer matches.
    // Using DOMParser keeps the original markup's quoting/entities intact.
    const wrapper = `<svg xmlns="http://www.w3.org/2000/svg">${raw}</svg>`;
    let doc;
    try {
        doc = new DOMParser().parseFromString(wrapper, 'image/svg+xml');
    } catch {
        return "";
    }
    const root = doc.documentElement;
    if (!root) return "";

    let kept = 0;
    Array.from(root.children).forEach(ch => {
        const lid = ch.getAttribute('data-layer');
        if (lid == null || String(lid) !== targetId) ch.remove();
        else kept++;
    });
    if (kept === 0) return "";

    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const inner = stripSvgjsAttributes(root.innerHTML);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">${inner}</svg>`;
}

export function save(editor, dpi = 96) {
    if (!editor._draw) return "";
    // _visibleContent drops elements on hidden layers so stamp output
    // matches what the user sees. stripSvgjsAttributes is folded in.
    const content = _visibleContent(editor);
    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const layersAttr = _serializeLayersAttr(editor);
    const layersAttrStr = layersAttr ? ` data-editor-layers="${layersAttr}"` : '';
    const activeAttrStr = editor._activeLayer != null ? ` data-editor-active-layer="${String(editor._activeLayer)}"` : '';
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}"${layersAttrStr}${activeAttrStr}>${content}</svg>`;
    editor.lastSvg = svgString;
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
export async function saveForRasterization(editor, dpi = 96) {
    if (!editor._draw) return "";
    const content = _visibleContent(editor);

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
        ? `<defs class="rasterization-fonts"><style type="text/css">${fontCss.join('\n')}</style></defs>`
        : '';
    const layersAttr = _serializeLayersAttr(editor);
    const layersAttrStr = layersAttr ? ` data-editor-layers="${layersAttr}"` : '';
    const activeAttrStr = editor._activeLayer != null ? ` data-editor-active-layer="${String(editor._activeLayer)}"` : '';
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}"${layersAttrStr}${activeAttrStr}>${styleBlock}${content}</svg>`;
    editor.lastSvg = svgString;
    return svgString;
}

export async function saveWithTextCopies(editor, dpi = 96) {
    if (!editor._draw) return "";
    const content = _visibleContent(editor);
    const textCopies = [];
    const fontFamilies = new Set();
    editor._sketchLayer.children().forEach(ch => {
        const originalTextSvg = ch.attr('data-original-text-svg');
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
    editor.lastSvg = svgString;
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
 */
function _reconcileLayersFromSvg(editor) {
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

export function open(editor, svgString, w, h) {
    _ioLog(`open() called  svgLen=${(svgString || '').length}  w=${w} h=${h}`);
    editor.setModelMetrics(w, h);
    editor._sketchLayer.clear();
    sync3DBackground(editor);

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
        const svgEl = new DOMParser().parseFromString(svgString, 'image/svg+xml').querySelector('svg');
        if (svgEl) {
            // v47: Filter out metadata elements so they don't clutter the sketch layer
            // v49: Filter out Defs-based metadata so it doesn't clutter the sketch layer
            const metadata = svgEl.querySelector('.editor-metadata');
            if (metadata) metadata.remove();

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
