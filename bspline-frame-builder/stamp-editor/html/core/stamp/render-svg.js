/**
 * SVG → canvas rendering for the stamp rasterizer. Two paths:
 *   1. native: Blob URL → <img> → drawImage. Uses the browser's own SVG
 *      engine, so fonts/styles render exactly as in the editor.
 *   2. canvg fallback: for environments that block blob URLs.
 *
 * Plus the SVG preprocessing (font-family substitution, dimension
 * override) needed to make the SVG safe to rasterize.
 */
import { stripSvgjsAttributes } from './svg-utils.js';

const KNOWN_FONTS = [
    // Sans-serif
    "Arial", "Tahoma", "Verdana", "Bahnschrift", "Impact",
    // Serif
    "Georgia", "Times New Roman",
    // Monospace
    "Courier New", "Cascadia Code", "Cascadia Mono",
    // Symbol / icon fonts
    "Marlett", "Symbol", "Webdings", "Wingdings",
    "Segoe UI Symbol", "Segoe MDL2 Assets", "Segoe Fluent Icons", "Segoe UI Emoji",
    // CSS generic families (fallback)
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
];

/**
 * Sanitize an editor-produced SVG before rasterization:
 *   - Strip svg.js-only style metadata (preserve real <style> blocks
 *     and embedded @font-face rules).
 *   - Strip svgjs:* attributes.
 *   - Substitute unknown font-family values with Arial so missing fonts
 *     don't fall through to a wildly different glyph metric.
 *   - Inject font-family="Arial" on bare <text> elements.
 */
export function sanitizeSvgForRaster(svgText) {
    let out = svgText.replace(/<style[\s\S]*?<\/style>/gi, (match) => {
        if (!/svgjs/i.test(match)) return match;
        const fontFaceRules = match.match(/@font-face\s*\{[^}]*\}/g);
        if (!fontFaceRules || fontFaceRules.length === 0) return '';
        return `<style type="text/css">${fontFaceRules.join('\n')}</style>`;
    });
    out = stripSvgjsAttributes(out);
    // Strip data-original-svg / data-original-text-svg metadata attrs.
    // Their HTML-serialized values contain raw `<` and `>` (svg.js's
    // innerHTML doesn't escape them in attribute values), which breaks
    // strict XML parsing in prepareSvgForRaster and silently drops the
    // host element. Editor doesn't need these for rasterization.
    out = out.replace(/\s+data-original-svg="[^"]*"/g, '');
    out = out.replace(/\s+data-original-text-svg="[^"]*"/g, '');
    out = out.replace(/(<text[^>]*?)font-family=(["'])([^"']*?)\2/gi, (_match, pre, quote, fams) => {
        const found = KNOWN_FONTS.find((f) => fams.toLowerCase().includes(f.toLowerCase()));
        return pre + 'font-family=' + quote + (found || 'Arial') + quote;
    });
    out = out.replace(/(<text(?![^>]*font-family)[^>]*?)(>)/gi, '$1 font-family="Arial"$2');
    return out;
}

/**
 * Override the SVG's outer width/height + preserveAspectRatio so it
 * rasterizes to the exact buffer size we want, stretched non-uniformly
 * (the engine applies aspect via the user-space viewBox).
 */
export function prepareSvgForRaster(svgString, bufferW, bufferH) {
    if (typeof DOMParser !== 'undefined' && typeof XMLSerializer !== 'undefined') {
        try {
            const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
            const svg = doc.querySelector('svg');
            if (svg) {
                svg.setAttribute('width', String(bufferW));
                svg.setAttribute('height', String(bufferH));
                svg.setAttribute('preserveAspectRatio', 'none');
                return new XMLSerializer().serializeToString(svg);
            }
        } catch (e) {
            console.warn('[SVG DEBUG] prepareSvgForRaster failed:', e);
        }
    }
    // Fallback string-only path for non-DOM environments.
    return svgString
        .replace(/width="[^"]+"/i, `width="${bufferW}"`)
        .replace(/height="[^"]+"/i, `height="${bufferH}"`)
        .replace(/preserveAspectRatio="[^"]*"/gi, '')
        .replace(/<svg\b/i, `<svg preserveAspectRatio="none"`);
}

/**
 * Render an SVG string to a 2D canvas context using the browser's own
 * SVG engine via Blob URL → <img> → drawImage. Resolves on success,
 * rejects if the image fails to load.
 */
export function renderSvgNative(ctx, svgString, w, h) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(true);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

// Lazy-loaded canvg v3, used as a fallback for sandboxed environments
// that block blob URLs (some Fusion 360 hosts have done this in the past).
let _CanvgClass = null;

export async function loadCanvg() {
    if (_CanvgClass) return _CanvgClass;
    try {
        const mod = await import('https://esm.sh/canvg@3');
        _CanvgClass = mod.Canvg || mod.default?.Canvg || mod.default;
        if (!_CanvgClass) console.error('[SVG DEBUG] canvg@3 imported but no Canvg export found');
        return _CanvgClass || null;
    } catch (e) {
        console.error('[SVG DEBUG] Failed to dynamically load canvg v3:', e);
        return null;
    }
}
