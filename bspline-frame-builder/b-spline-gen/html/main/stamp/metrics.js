/**
 * Live metrics readout for the active stamp layer. Reads layer.mask.metrics
 * (computed by the rasterizer in core/stamp/index.js) and prints a few
 * lines of plain-language status:
 *
 *   - Inscribed radius (how thick the geometry is at its widest point)
 *   - Fillet cap (warns when the slider is asking for more reach than
 *     the geometry can hold)
 *   - Body cap (vbit/ballnose can't always reach the requested depth on
 *     narrow features)
 *
 * Updates fire on:
 *   - the `stampMaskUpdated` custom event (dispatched by
 *     refreshAllStampMasks after a rasterize completes)
 *   - active-layer change (via syncFromLayer)
 */
const N_INCH = 3;   // decimal places for inch values

function fmt(n, digits = N_INCH) {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

function render(metrics) {
  const el = document.getElementById('stampMetrics');
  if (!el) return;
  if (!metrics) {
    el.textContent = '';
    return;
  }
  const lines = [];
  lines.push(`Profile: <b>${metrics.profileId}</b> · inscribed radius <b>${fmt(metrics.inscribedRadiusIn)}″</b>`);

  // Depth-cap warning: if the geometry won't let the profile reach the
  // user's set depth, say so loudly. This is what makes the depth
  // slider "stop working" past a certain value on narrow vbit/ballnose
  // features — it's a tool-geometry limit, not a bug.
  if (metrics.depthCapped) {
    lines.push(`<span style="color:#d97706;">⚠ Depth capped: reaching <b>${fmt(metrics.depthReachedIn)}″</b> of <b>${fmt(metrics.maxDepth)}″</b> set (limited by inscribed radius — the tool can't fit deeper)</span>`);
  } else {
    lines.push(`Depth reached: ${fmt(metrics.depthReachedIn)}″`);
  }

  if (metrics.requestedFilletIn > 0) {
    if (metrics.filletRadiusCapped) {
      lines.push(`<span style="color:#d97706;">⚠ Fillet capped: requested ${fmt(metrics.requestedFilletIn)}″, using ${fmt(metrics.effectiveFilletIn)}″ (limited by inscribed radius)</span>`);
    } else {
      lines.push(`Fillet ${fmt(metrics.effectiveFilletIn)}″ · outer reach ${fmt(metrics.filletOuterReachIn)}″`);
    }
  }
  el.innerHTML = lines.join('<br>');
}

export function initMetrics(ctx) {
  const update = () => {
    const layer = ctx.activeLayer();
    const m = layer && layer.mask && !ArrayBuffer.isView(layer.mask) ? layer.mask.metrics : null;
    render(m);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('stampMaskUpdated', update);
  }
  // Initial render (in case a mask already exists from a loaded session).
  update();

  return ctx.registerModule({
    id: 'metrics',
    syncFromLayer: update,
  });
}
