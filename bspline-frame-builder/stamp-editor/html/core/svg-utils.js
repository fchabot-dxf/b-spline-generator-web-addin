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

/**
 * Wrap the SVG content in a flip-Y group so the carving path renders with
 * the orientation Fusion's importer expects. Idempotent — recognizes the
 * wrapper from an earlier call and skips re-flipping.
 */
export function normalizeSvgForCarving(svgText) {
  if (!svgText) return svgText;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return svgText;
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return svgText;

    let height = NaN;
    const viewBox = svg.getAttribute('viewBox');
    if (viewBox) {
      const parts = viewBox.trim().split(/\s+/).map(parseFloat);
      if (parts.length === 4 && !Number.isNaN(parts[3])) height = parts[3];
    }
    if ((!height || height <= 0) && svg.hasAttribute('height')) {
      height = parseFloat(svg.getAttribute('height'));
    }
    if (!height || height <= 0) return svgText;

    const flipTransform = `translate(0 ${height}) scale(1 -1)`;
    const firstChild = svg.firstElementChild;
    if (firstChild && firstChild.tagName.toLowerCase() === 'g' &&
        firstChild.getAttribute('transform') === flipTransform) {
      return svgText;
    }

    const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrapper.setAttribute('transform', flipTransform);
    while (svg.firstChild) wrapper.appendChild(svg.firstChild);
    svg.appendChild(wrapper);
    if (!svg.hasAttribute('preserveAspectRatio')) {
      svg.setAttribute('preserveAspectRatio', 'none');
    }
    return new XMLSerializer().serializeToString(svg);
  } catch (e) {
    console.warn('normalizeSvgForCarving failed:', e);
    return svgText;
  }
}

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
