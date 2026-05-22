/**
 * Per-layer transform: applies tx/ty/rotation/scale/mirror to the
 * layer's SVG before rasterization by wrapping its content in a
 * `<g transform="...">`. The viewBox is preserved, so the transform's
 * units are inches (the same as the model's user-space).
 *
 * Order applied (matches typical CAD intuition):
 *   1. Translate to the stamp's pivot (center of viewBox).
 *   2. Scale (uniform) and mirror (axis flips).
 *   3. Rotate around that pivot.
 *   4. Translate back, then apply the user's tx / ty offset.
 */

/** True if the transform is the identity (== nothing to do). */
export function isIdentityTransform(t) {
  if (!t) return true;
  return (t.tx || 0) === 0
    && (t.ty || 0) === 0
    && (t.rotation || 0) === 0
    && (t.scale == null || t.scale === 1)
    && !t.mirrorX
    && !t.mirrorY;
}

/**
 * Build the SVG `transform` attribute string for a layer.
 * widthIn / heightIn = viewBox dimensions in inches; the rotation pivot
 * is the center.
 */
export function buildTransformAttr(t, widthIn, heightIn) {
  const tx = +t.tx || 0;
  const ty = +t.ty || 0;
  const rot = +t.rotation || 0;
  const s = (t.scale == null || +t.scale === 0) ? 1 : +t.scale;
  const sx = s * (t.mirrorX ? -1 : 1);
  const sy = s * (t.mirrorY ? -1 : 1);
  const cx = widthIn * 0.5;
  const cy = heightIn * 0.5;

  // Equivalent to: T(tx,ty) ∘ T(cx,cy) ∘ R(rot) ∘ S(sx,sy) ∘ T(-cx,-cy)
  // SVG composes transforms left-to-right (rightmost applies first to
  // the point), so we list them in reverse intuition order.
  const parts = [];
  parts.push(`translate(${tx + cx} ${ty + cy})`);
  if (rot !== 0) parts.push(`rotate(${rot})`);
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx} ${sy})`);
  parts.push(`translate(${-cx} ${-cy})`);
  return parts.join(' ');
}

/**
 * Wrap the SVG content in a `<g transform="...">` so the layer's
 * transform applies before rasterization. Returns the original
 * svgString untouched when the transform is identity.
 */
export function applyLayerTransform(svgString, layerTransform, widthIn, heightIn) {
  if (isIdentityTransform(layerTransform)) return svgString;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    // Non-DOM env (shouldn't happen in the browser path, but fall back
    // gracefully to the untransformed SVG).
    return svgString;
  }
  try {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return svgString;
    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', buildTransformAttr(layerTransform, widthIn, heightIn));
    // Move all of <svg>'s children into the new <g>.
    while (svg.firstChild) g.appendChild(svg.firstChild);
    svg.appendChild(g);
    return new XMLSerializer().serializeToString(svg);
  } catch (e) {
    console.warn('[STAMP] applyLayerTransform failed:', e);
    return svgString;
  }
}
