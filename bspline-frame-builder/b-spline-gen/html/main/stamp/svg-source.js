/**
 * SVG Source — the three buttons (Browse / Clear / Edit) that mutate
 * the active layer's `svg` field, plus the filename label and the
 * editor-modal Cancel-snapshot.
 */
import { P, setStampLayerSvg, setStampLayerMask, setStampLayerEnabled } from '../../core/state.js';
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';
import { SvgEditorSnapshot } from '../app-init.js';
import { addLayer, setActiveLayer } from '../../editor/layers.js';

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

  // Browse → file picker → read → validate → import into the active
  // editor layer (Step 3 of the unification). Falls back to the legacy
  // per-stamp-layer svg field when the editor isn't loaded.
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

      const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
      const imported = editor ? _importSvgIntoEditor(editor, text) : false;
      if (!imported) {
        // Legacy fallback path.
        setStampLayerSvg(P.activeLayerIdx, text);
        if (layerModule && layerModule.syncEnabled) layerModule.syncEnabled();
        ctx.requestRemask();
      }
    });
  }

  // Clear → null svg+mask, disable layer (mirrors auto-enable on assign).
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      setStampLayerSvg(P.activeLayerIdx, null);
      setStampLayerMask(P.activeLayerIdx, null);
      setStampLayerEnabled(P.activeLayerIdx, false);
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

/**
 * Import the children of an uploaded SVG into the editor's active layer.
 * Sets data-layer on each imported child so it belongs to that layer,
 * then triggers the editor's onChange to persist + remask. Returns true
 * if the import succeeded.
 *
 * Step 3 of the stamp-layer → editor-layer unification: replaces the
 * old "each stamp layer has its own svg" model with "everything lives
 * in the editor, layers partition it."
 */
function _importSvgIntoEditor(editor, svgText) {
  try {
    if (!editor || !editor._sketchLayer) return false;
    const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return false;

    // Drop any editor-metadata defs so they don't clutter the sketch.
    const metadata = root.querySelector('.editor-metadata');
    if (metadata) metadata.remove();

    // Make sure the editor has an active layer; create Layer 1 if not.
    let activeId = editor._activeLayer;
    if (activeId == null || !Array.isArray(editor._layers) || editor._layers.length === 0) {
      const newLayer = addLayer(editor, { skipUndo: true });
      setActiveLayer(editor, newLayer.id);
      activeId = newLayer.id;
    }
    const targetId = String(activeId);

    // Append each child to the sketch layer with data-layer set.
    const sketchNode = editor._sketchLayer.node;
    Array.from(root.children).forEach((ch) => {
      ch.setAttribute('data-layer', targetId);
      sketchNode.appendChild(ch);
    });

    // Trigger persistence + remask via the editor's onChange callback.
    if (typeof editor._onChange === 'function') {
      try { editor._onChange(); } catch (_) {}
    }
    if (typeof editor.pushState === 'function') {
      try { editor.pushState(); } catch (_) {}
    }
    return true;
  } catch (e) {
    console.warn('[STAMP] _importSvgIntoEditor failed:', e);
    return false;
  }
}
