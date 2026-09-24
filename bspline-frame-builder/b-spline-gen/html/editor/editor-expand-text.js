/**
 * Expand strategy 1: <text> via opentype.js. Loads the bundled .ttf for
 * the element's font-family, generates a glyph-outline path, bakes an
 * arbitrary matrix into the path data (textGlyphPathD, below — SE8d:
 * extracted so the Fusion carve-bake path (editor-io.js's SA-ROUNDTRIP-2
 * fix) can reuse the SAME font-loading/glyph-generation logic instead of
 * a second, drifting copy), then hands off to the shared
 * commitExpandedPath helper (fill, stroke, layer, snapshot, select,
 * pushState).
 *
 * Returns true if it handled the element (success or expected skip),
 * false if the orchestrator should fall through to the next strategy.
 *
 * Skip reasons that return false:
 *   - The element isn't a <text>.
 *   - The font-family isn't in FONT_MAP (orchestrator can try Step 3
 *     trace, which will at least rasterize the text via canvg).
 *   - opentype.js threw (network failure, font parse error). Logged.
 */
import { FONT_MAP } from './editor-fonts.js';
import { dbg } from './debug.js';
import { localAnchor, transformPoint } from './editor-coords.js';
import { commitExpandedPath } from './editor-expand-commit.js';

/**
 * Load the bundled font for `el`'s font-family, generate its glyph
 * outline, and bake matrix `m` into every coordinate. `m` is the FULL
 * bake matrix the caller wants applied — expandText composes
 * el.matrix().translate(ax, ay) (interactive Expand, in-place); the
 * carve-bake path (editor-io.js) composes carveMatrix x el.matrix()
 * translated the same way, folding the board->Fusion mapping and the
 * glyph bake into one step, exactly like bakeMatrixIntoElement does for
 * every other geometry type.
 *
 * Returns the baked path `d` string, or null on any failure (no font
 * mapping for the family, font fetch/parse error) — callers decide the
 * fallback; this never throws.
 */
export async function textGlyphPathD(el, m) {
    const rawFamily = el.attr('font-family') || "Arial";
    const fontFamily = rawFamily.replace(/['"]/g, '').trim();
    const fontSize = parseFloat(el.attr('font-size') || '3.0');

    const contentNodes = el.node.childNodes;
    let rawContent = "";
    contentNodes.forEach(node => {
        if (node.nodeType === 3) rawContent += node.nodeValue;
        else if (node.nodeName === 'tspan') rawContent += node.textContent;
    });
    if (!rawContent) rawContent = el.text() || "";

    const fontFile = FONT_MAP[fontFamily];
    if (!fontFile) {
        console.warn(`[EXPAND] No mapping for "${fontFamily}"`);
        return null;
    }

    try {
        dbg('EXPAND', `Starting: "${fontFamily}"`);
        const opentypeMod = await import('https://esm.sh/opentype.js');
        const opentype = opentypeMod.default || opentypeMod;

        // opentype.load() is deprecated in newer opentype.js builds and
        // the callback no longer fires reliably, which makes expand hang
        // silently. Fetch the font ourselves and feed the buffer to
        // opentype.parse — the supported path. URL is resolved against
        // THIS module so it survives different host page locations.
        const fontUrl = new URL(`../fonts/${fontFile}`, import.meta.url).href;
        const fontResp = await fetch(fontUrl);
        if (!fontResp.ok) throw new Error(`Font fetch failed: ${fontResp.status} ${fontUrl}`);
        const fontBuffer = await fontResp.arrayBuffer();
        const font = opentype.parse(fontBuffer);
        if (!font) return null;

        // Baseline mode depends on which convention the <text> was
        // placed under:
        //   - new (alphabetic): el.attr('y') is already the baseline →
        //     opentype generates path with baseline at y=0, translation
        //     by ay lands the baseline at the same world y as the live
        //     render and the stamp.
        //   - legacy (hanging): el.attr('y') is the visual top, so
        //     opentype keeps the historical +ascender shift.
        const ascentUnits = font.tables.hhea?.ascender || font.ascender || font.tables.os2?.sTypoAscender || 0;
        const scaleFactor = (1 / font.unitsPerEm) * fontSize;
        const ascender = ascentUnits * scaleFactor;
        const isLegacyHanging = el.attr('dominant-baseline') === 'hanging';
        const baselineYOffset = isLegacyHanging ? ascender : 0;

        // PUA Mapping for symbol fonts: ASCII chars map to the Private
        // Use Area block where the symbol glyphs actually live in the
        // bundled Symbol/Wingdings/Webdings TTFs.
        let processedContent = rawContent;
        const isSymbolic = ["Symbol", "Wingdings", "Webdings"].includes(fontFamily);
        if (isSymbolic) {
            processedContent = Array.from(rawContent).map(c => {
                const code = c.charCodeAt(0);
                return (code > 31 && code < 127) ? String.fromCharCode(0xF000 + code) : c;
            }).join('');
        }

        const pathObj = font.getPath(processedContent, 0, baselineYOffset, fontSize);
        const rawD = pathObj.toPathData(2);

        // Bake matrix `m` into every coord in the path. SVG.js's
        // .transform() API has historically failed to bake transforms
        // reliably for path elements, so walk the segments manually and
        // apply the matrix to each coord pair.
        const pArray = new SVG.PathArray(rawD);
        pArray.forEach(seg => {
            for (let i = 1; i < seg.length; i += 2) {
                if (typeof seg[i] === 'number' && typeof seg[i + 1] === 'number') {
                    // Manual affine (transformPoint), not SVG.Point.transform —
                    // the latter is unreliable/absent in some host builds and
                    // silently dropped the scale → micro text (EX1).
                    const pt = transformPoint(m, { x: seg[i], y: seg[i + 1] });
                    seg[i] = pt.x;
                    seg[i + 1] = pt.y;
                }
            }
        });
        return pArray.toString();
    } catch (e) {
        console.error("[EXPAND] Opentype logic failed:", e);
        return null;
    }
}

export async function expandText(editor, el, { commit = true } = {}) {
    if (el.type !== 'text') return false;

    // localAnchor reads the raw x/y attrs (NOT el.x() / el.y(), which
    // would return bbox.x/y with the transform already baked in — using
    // those here would double-count any prior drag).
    const { x: ax, y: ay } = localAnchor(el);
    const m = el.matrix().translate(ax, ay);

    const bakedD = await textGlyphPathD(el, m);
    if (!bakedD) return false;

    const expanded = commitExpandedPath(editor, el, bakedD, {
        commit,
        isText: true,
    });
    if (!expanded) return false;
    return true;
}
