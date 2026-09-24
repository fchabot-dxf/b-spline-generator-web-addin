/**
 * SVG Source — the three buttons (Browse / Clear / Edit) that mutate
 * the active layer's `svg` field, plus the filename label and the
 * editor-modal Cancel-snapshot.
 */
import { P } from '../../core/state.js';
import { SvgEditorSnapshot, editorRestoreSvg } from '../app-init.js';
import { addLayer, setActiveLayer, setLayerVisible } from '../../editor/layers.js';

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
  // editor layer (Step 3 of the unification).
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
      const imported = editor ? importSvgIntoLayer(editor, text) : false;
      if (imported) {
        // SE4b: the deleted content-mirror setter used to auto-enable the
        // layer as a side effect of writing its mirror svg field —
        // DEFAULT.stampLayers[1]/[2] start `enabled: false`, so without
        // this, drawing into Layer 2/3 for the first time via Browse would
        // leave it silently excluded from activeStampLayers/
        // exportableStampLayers even though it has real content and
        // displays fine in the 3D preview. Preserve the effect directly now
        // that the write that used to carry it is gone.
        // SE5a: writes the editor layer's `visible` (single tooling store)
        // instead of the now-inert P.stampLayers `.enabled`. NOTE: until
        // SE5 slice (b) repoints export-flow.js's isCarvingLayer/
        // hasShippableSvg off P.stampLayers[idx].enabled onto this same
        // `visible` field, a layer enabled here can still read as excluded
        // by Export STEP / Send-to-Fusion — the live 3D preview and
        // rebuild are unaffected (already editor._layers-only). Flagged,
        // not fixed here: this slice's own scope is updateP/isFilletActive/
        // this file only, per the dispatch.
        const layer = ctx.activeLayer();
        if (layer && layer.id != null) setLayerVisible(editor, layer.id, true);
        if (layerModule && layerModule.syncEnabled) layerModule.syncEnabled();
      } else {
        // SE4b: the content-mirror fallback this used to write to is gone
        // — it's being deleted from core/state.js this same slice, so
        // there's nothing left to silently absorb into. SE4a already found
        // no structural guarantee the editor exists by the time Browse is
        // clickable (only a practical timing gap, always closed for a real
        // human click) — surface that instead of pretending it worked.
        if (fileNameSpan) fileNameSpan.textContent = '⚠ Editor not ready — try again.';
        console.warn('[STAMP] Browse import failed: editor not ready.');
      }
    });
  }

  // Clear → remove the ACTIVE layer's real content from the editor's
  // sketch, disable the layer (mirrors auto-enable on assign). SE4b/B15:
  // this used to only null the P.stampLayers mirror, leaving the editor's
  // actual drawing (and therefore the next Apply's carve) untouched — two
  // buttons named "Clear" with two different real effects. Now mirrors the
  // editor modal's own Clear (editorClear, editor/tools/action-tools.js):
  // deselect, mutate, pushState, onChange — just scoped to one layer's
  // children instead of the whole sketch.
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
      const currentLayer = ctx.activeLayer();
      if (!editor || !editor._sketchLayer || !currentLayer || currentLayer.id == null) {
        if (fileNameSpan) fileNameSpan.textContent = '⚠ Editor not ready — try again.';
        return;
      }
      const targetId = String(currentLayer.id);
      if (typeof editor._deselect === 'function') editor._deselect();
      const sketchNode = editor._sketchLayer.node;
      Array.from(sketchNode.children).forEach((ch) => {
        if (ch.getAttribute('data-layer') === targetId) ch.remove();
      });
      if (typeof editor.pushState === 'function') { try { editor.pushState(); } catch (_) {} }
      if (typeof editor._onChange === 'function') { try { editor._onChange(); } catch (_) {} }

      // SE5a: writes `visible` on the editor layer (single tooling store)
      // — see the Browse-import branch above for the same transitional
      // note re: export-flow.js until slice (b).
      setLayerVisible(editor, targetId, false);
      if (layerModule && layerModule.syncEnabled) layerModule.syncEnabled();
      if (fileNameSpan) fileNameSpan.textContent = 'No file chosen';
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
        // SE3a: snapshot the unified document BEFORE this session, not the
        // active editor layer's own fields (ctx.activeLayer() returns an
        // EDITOR layer here — id/name/tooling, no `.svg` — so capturing
        // currentLayer.svg was always undefined; see editorRestoreSvg's
        // own comment for the same RO1 history).
        SvgEditorSnapshot.active = true;
        SvgEditorSnapshot.editorSvg = P.editorSvg ?? null;
      }
      if (window.svgEditor && currentLayer) {
        // Restore the unified editor document (P.editorSvg), NOT currentLayer.svg:
        // in the unified model ctx.activeLayer() returns an EDITOR layer with no
        // `.svg`, so the old code passed undefined and reopened blank (RO1).
        window.svgEditor.open(editorRestoreSvg(), P.widthIn, P.heightIn);
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
 * in the editor, layers partition it." SE4a: exported — this is the one
 * declared entry the mirror-retirement design (§3) asks for; it already
 * did the job, it just wasn't public.
 */
export function importSvgIntoLayer(editor, svgText) {
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
