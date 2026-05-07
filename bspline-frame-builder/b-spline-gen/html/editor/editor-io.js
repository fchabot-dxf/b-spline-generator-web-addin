/**
 * editor-io.js - persistence logic for VectorEditor.
 * Handles SVG serialization and re-import.
 */

import { stripSvgjsAttributes } from '../core/svg-utils.js';
import { migrateTextElement } from './editor-text-baseline.js';

export function initIO(editor) {
    editor.logEditorEvent = (msg, data) => {
        console.log(`[SVG EDITOR] ${msg}`, data || '');
    };
}

export function save(editor, dpi = 96) {
    if (!editor._draw) return "";
    const rawContent = editor._sketchLayer.node.innerHTML;
    const content = stripSvgjsAttributes(rawContent);
    const wPx = editor._mW * dpi;
    const hPx = editor._mH * dpi;
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">${content}</svg>`;
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
    const rawContent = editor._sketchLayer.node.innerHTML;
    const content = stripSvgjsAttributes(rawContent);

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
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">${styleBlock}${content}</svg>`;
    editor.lastSvg = svgString;
    return svgString;
}

export async function saveWithTextCopies(editor, dpi = 96) {
    if (!editor._draw) return "";
    const rawContent = editor._sketchLayer.node.innerHTML;
    const content = stripSvgjsAttributes(rawContent);
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
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${editor._mW} ${editor._mH}" preserveAspectRatio="none" data-export-dpi="${dpi}">${styleBlock}${content}${textContent}</svg>`;
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

export function open(editor, svgString, w, h) {
    editor.setModelMetrics(w, h);
    editor._sketchLayer.clear();
    sync3DBackground(editor);
    if (!svgString) return;
    try {
        const svgEl = new DOMParser().parseFromString(svgString, 'image/svg+xml').querySelector('svg');
        if (svgEl) {
            // v47: Filter out metadata elements so they don't clutter the sketch layer
            // v49: Filter out Defs-based metadata so it doesn't clutter the sketch layer
            const metadata = svgEl.querySelector('.editor-metadata');
            if (metadata) metadata.remove();

            editor._sketchLayer.svg(svgEl.innerHTML);
            editor._sketchLayer.children().forEach(ch => {
                if (ch.hasClass('calib-anchor')) ch.remove();
                ch.attr('transform', null);
                ch.css('cursor', ch.type === 'text' ? 'text' : 'pointer');
            });

            _migrateHangingBaselineTexts(editor._sketchLayer, editor._fontSize);

            if (typeof editor.setActiveLayer === 'function') {
                editor.setActiveLayer(editor._activeLayer || '0');
            }
        }
    } catch (err) { console.error('[SVG EDITOR] Re-import failure:', err); }
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
