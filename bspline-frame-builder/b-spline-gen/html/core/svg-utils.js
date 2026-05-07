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
