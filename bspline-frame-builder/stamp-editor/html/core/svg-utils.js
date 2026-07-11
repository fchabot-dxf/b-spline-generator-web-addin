/**
 * Shared SVG string utilities used by both the editor (when serializing
 * sketch-layer markup) and the stamp rasterizer (when sanitizing input
 * before drawing to canvas). Anything that touches raw SVG strings and
 * needs to behave the same in both places lives here.
 */

/**
 * Strip svg.js' internal `svgjs:*` attributes from serialized markup.
 * svg.js writes them on every node it manages; they're noise everywhere
 * else and break some XML parsers in strict mode. The leading `\s+` in
 * the pattern is intentional — without it we'd nibble the space before
 * the attribute and concatenate it with whatever comes next.
 */
export function stripSvgjsAttributes(svgText) {
  return svgText.replace(/\s+svgjs:[^=]+="[^"]*"/g, '');
}

/* normalizeSvgForCarving (a flip-Y <g> wrapper) was removed with SC2: the
 * board→Fusion carve transform is now baked into the coordinates in ONE
 * place — editor-io.js bakeSvgForCarving (carveMatrix). The old wrapper was
 * one of two competing Y-flips (the other being the Python _prescale_svg,
 * now pass-through). */

/**
 * Encode a raw SVG-markup snapshot (the pre-expand element, kept for the
 * expand re-edit flow) as base64 so it can be stashed in a data-original-*
 * attribute WITHOUT the raw `<`/`>` that make the containing SVG invalid XML.
 * A strict image/svg+xml DOMParser silently drops elements carrying such an
 * attribute — that was the fill=none (stamp) + reopen-blank (persistence) root
 * cause (EDM2). Unicode-safe. Returns '' on failure.
 */
export function encodeSnapshot(svgMarkup) {
  if (!svgMarkup) return '';
  try { return btoa(unescape(encodeURIComponent(svgMarkup))); }
  catch (_) { return ''; }
}

/**
 * Decode a snapshot produced by encodeSnapshot. Backward-compatible: a LEGACY
 * value that still holds raw markup (contains `<`) is returned unchanged.
 */
export function decodeSnapshot(value) {
  if (!value) return '';
  if (value.indexOf('<') !== -1) return value;            // legacy raw markup
  try { return decodeURIComponent(escape(atob(value))); }
  catch (_) { return value; }
}

/**
 * Remove data-original-svg / data-original-text-svg attributes from serialized
 * markup. Needed as a safety net before a strict image/svg+xml parse of LEGACY
 * content whose snapshot values still hold raw `<`/`>` (invalid XML). New
 * content is base64 (valid XML), so this is a harmless no-op there.
 */
export function stripOriginalAttrs(svgText) {
  return svgText
    .replace(/\s+data-original-svg="[^"]*"/g, '')
    .replace(/\s+data-original-text-svg="[^"]*"/g, '');
}
