// The add-in's 'fusion_memory' reading (fb_shared/fusion_memory.py, before each Send and each BUILD) -> one line at the
// bottom of the palette: hidden while Fusion's memory is fine, amber above the declared soft threshold, red above the
// hard one. Detection only (2026-10-07: each Send+BUILD+APPLY doc leaves ~2.6 GB inside Fusion; long sessions reached
// 65 GB). One painter for both palettes (the B-Spline palette's main.js; the CAM palette through window).

/** payload {gb, level: 'ok' | 'soft' | 'hard', text} -> the #fusion-memory-line element. */
export function paintFusionMemory(payload, doc = typeof document !== 'undefined' ? document : null) {
  const el = doc && doc.getElementById('fusion-memory-line');
  if (!el) return;
  const level = payload && payload.level;
  if (level !== 'soft' && level !== 'hard') { el.hidden = true; delete el.dataset.level; el.textContent = ''; return; }
  el.dataset.level = level;
  el.textContent = payload.text || `Fusion is using ${payload.gb} GB: save and restart Fusion soon (closing documents does not free memory)`; // fb_shared/fusion_memory.py's own words
  el.hidden = false;
}

if (typeof window !== 'undefined') window.paintFusionMemory = paintFusionMemory; // the CAM palette's classic script
