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
