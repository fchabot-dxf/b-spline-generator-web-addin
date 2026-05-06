/**
 * SVG Source — the three buttons (Browse / Clear / Edit) that mutate
 * the active layer's `svg` field, plus the filename label and the
 * editor-modal Cancel-snapshot.
 */
import { P, setStampLayerSvg, setStampLayerMask } from '../../core/state.js';
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';
import { SvgEditorSnapshot } from '../app-init.js';

/**
 * Lightweight SVG validation: parses the upload and checks that the
 * root element is `<svg>`. Catches non-SVG files renamed with a `.svg`
 * extension, malformed XML, and empty content. Returns null on success
 * or a human-readable error message.
 */
function validateSvgContent(text) {
  if (!text || text.trim().length === 0) return 'File is empty.';
  if (typeof DOMParser === 'undefined') return null;   // can't validate — let it through
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch (e) {
    return `Could not parse: ${e.message || e}`;
  }
  const parserError = doc.querySelector('parsererror');
  if (parserError) return 'Not valid XML.';
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return 'File is not an SVG (root element must be <svg>).';
  return null;
}

export function initSvgSource(ctx, layerModule) {
  const fileNameSpan = document.getElementById('stampFileName');
  const btnChoose = document.getElementById('btnStampChoose');
  const upload = document.getElementById('stampUpload');
  const btnClear = document.getElementById('btnStampClear');
  const btnEdit = document.getElementById('btnStampEdit');

  // Browse → file picker → read → validate → assign to layer.svg →
  // re-rasterize. setStampLayerSvg auto-enables the layer.
  if (btnChoose && upload) {
    btnChoose.addEventListener('click', () => upload.click());
    upload.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const error = validateSvgContent(text);
      if (error) {
        if (fileNameSpan) fileNameSpan.textContent = `⚠ ${error}`;
        console.warn('[STAMP] SVG upload rejected:', error);
        // Reset the file input so re-selecting the same file fires change again.
        upload.value = '';
        return;
      }
      if (fileNameSpan) fileNameSpan.textContent = file.name;
      setStampLayerSvg(P.activeLayerIdx, text);
      if (layerModule && layerModule.syncEnabled) layerModule.syncEnabled();
      ctx.requestRemask();
    });
  }

  // Clear → null svg+mask, disable layer (mirrors auto-enable on assign).
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      setStampLayerSvg(P.activeLayerIdx, null);
      setStampLayerMask(P.activeLayerIdx, null);
      if (P.stampLayers[P.activeLayerIdx]) P.stampLayers[P.activeLayerIdx].enabled = false;
      if (layerModule && layerModule.syncEnabled) layerModule.syncEnabled();
      if (fileNameSpan) fileNameSpan.textContent = 'No file chosen';
      scheduleRebuild(() => rebuild(ctx.preview, updateStampMasks, updatePreviewSculptMode), 0);
    });
  }

  // Edit → open the SVG editor modal with the active layer's SVG.
  // Snapshot first so Cancel can actually restore.
  if (btnEdit) {
    btnEdit.addEventListener('click', () => {
      const modal = document.getElementById('svgEditorModal');
      if (!modal) return;
      modal.style.display = 'flex';
      const currentLayer = ctx.activeLayer();
      if (currentLayer) {
        SvgEditorSnapshot.active = true;
        SvgEditorSnapshot.layerIdx = P.activeLayerIdx;
        SvgEditorSnapshot.svg = currentLayer.svg;
        SvgEditorSnapshot.mask = currentLayer.mask;
        SvgEditorSnapshot.enabled = !!currentLayer.enabled;
      }
      if (window.svgEditor && currentLayer) {
        window.svgEditor.open(currentLayer.svg, P.widthIn, P.heightIn);
      }
    });
  }

  return ctx.registerModule({
    id: 'svg-source',
    syncFromLayer(layer) {
      if (fileNameSpan) {
        fileNameSpan.textContent = (layer && layer.svg) ? 'Loaded' : 'No file chosen';
      }
    },
  });
}
