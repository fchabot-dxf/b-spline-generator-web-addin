/**
 * main/pull-changelist.js -- Pull from Fusion, step (b) (seat D 2026-10-16; advisor 45, Fred): the change-list
 * dialog (Fred-approved mockup, shots/seatD/pull/01_desktop_changelist.png, 02_phone_changelist.png) over
 * core/pull-changelist.js's own buildChangeList -- reuses .cad-modal-overlay/.cad-modal-window/.cad-modal-header/
 * .cad-modal-body/.cad-modal-footer + .cad-btn/.cad-btn-primary/.cad-btn-secondary (base.css), the same vocabulary
 * the export wizard and the editor's own modal already use, not a new dialog system. Nothing changes until Apply;
 * Cancel removes the dialog and writes nothing.
 */
import { applyRows } from '../core/pull-changelist.js';
import { applyParam } from './param-manager.js';
import { getFrameRecord, setFrameRecord } from '../core/frame-record.js';
import { resolvePatternLayer, rewidthOwnedKindsAcrossLayers } from '../editor/editor-lattice-pattern.js';
import { recordStep } from '../core/history.js';

// live Fusion test (seat D 2026-10-16): `row.from` is `undefined` whenever the app has no value yet for a Fusion
// param it otherwise recognizes (core/pull-changelist.js's own diffScope doc comment -- "the row still shows,
// from is undefined", already covered by its own tests) -- the dialog itself never handled that case and threw
// (v.toFixed on undefined), caught by onSketchPulled's own try/catch, silently swallowing the WHOLE pull (no
// dialog at all, not even the rows that DID have a real `from`).
const _fmtIn = (v) => (Number.isFinite(v) ? `${v.toFixed(2)}"` : '(none)');
const ROW_LABEL = (row) => row.label;

function _row(label, fromText, toText) {
  const el = document.createElement('div');
  el.className = 'pull-changelist-row';
  el.innerHTML = `<span>${label}</span><span>${fromText} &rarr; ${toText}</span>`;
  return el;
}

function _groupHeader(text) {
  const el = document.createElement('div');
  el.className = 'pull-changelist-group-header';
  el.textContent = text;
  return el;
}

function _divider() {
  const el = document.createElement('div');
  el.className = 'pull-changelist-divider';
  return el;
}

/** The body's own rows, grouped exactly as the mockup: Board, one group per lattice layer, Wood frame, then the
 *  informational curve note and the kept/not-mapped summary line. */
function _renderBody(changeList) {
  const body = document.createElement('div');
  body.className = 'pull-changelist-body';

  if (changeList.boardRows.length) {
    body.appendChild(_groupHeader('Board'));
    for (const row of changeList.boardRows) body.appendChild(_row(ROW_LABEL(row), _fmtIn(row.from), _fmtIn(row.to)));
    body.appendChild(_divider());
  }

  for (const group of changeList.layerGroups) {
    body.appendChild(_groupHeader(`${group.layerName} · Lattice`));
    for (const row of group.rows) body.appendChild(_row(ROW_LABEL(row), _fmtIn(row.from), _fmtIn(row.to)));
    body.appendChild(_divider());
  }

  if (changeList.frameRows.length) {
    body.appendChild(_groupHeader('Wood frame'));
    for (const row of changeList.frameRows) body.appendChild(_row(ROW_LABEL(row), _fmtIn(row.from), _fmtIn(row.to)));
    body.appendChild(_divider());
  }

  // rails move freely in Fusion now (no driving param) -- their new positions come back as geometry; the
  // rails-lock slice (Send-tagged rail ids, matched and applied) isn't built yet, so this is informational only,
  // never applied by this dialog's own Apply (core/pull-changelist.js buildChangeList's own doc comment).
  if (changeList.curveCount > 0) {
    const note = document.createElement('div');
    note.className = 'pull-changelist-note';
    note.textContent = `${changeList.curveCount} rail${changeList.curveCount === 1 ? '' : 's'} moved in Fusion — not pulled yet.`;
    body.appendChild(note);
  }

  const summary = document.createElement('div');
  summary.className = 'pull-changelist-summary';
  summary.textContent = `Kept in Fusion: ${changeList.keptCount} unchanged · Not mapped: ${changeList.notMappedCount} param${changeList.notMappedCount === 1 ? '' : 's'}`;
  body.appendChild(summary);

  return body;
}

/** True if there is anything to show at all -- an all-kept, no-curve pull has nothing for a dialog to say. */
export function hasChanges(changeList) {
  return changeList.boardRows.length > 0 || changeList.layerGroups.length > 0 || changeList.frameRows.length > 0
    || changeList.curveCount > 0;
}

/** The frame scope's own patch: a FULL copy of the current record (params included, one level deep), with every
 *  changed row's own `to` written on top via the same `applyRows` the other scopes use. Starting from a full copy
 *  -- not a bare `{ [key]: value }` -- matters because setFrameRecord's own merge is shallow on `.params`: a bare
 *  `{ params: { frame_thickness: 0.8 } }` patch would silently drop every OTHER params.* field the record already
 *  held (boundingboxoffset, etc.), not just leave it alone. */
function _frameApplyPatch(frameRows) {
  const cur = getFrameRecord();
  const patch = { ...cur, params: { ...cur.params } };
  applyRows(frameRows, patch);
  return patch;
}

/** Writes every row in `changeList` back onto the app's own board/layer/frame state, in ONE global undo step
 *  (core/history.js recordStep -- the same "sidebar change becomes one step" convention frame-panel.js's
 *  editFrameNow and brick-panel.js's recordBoardStep already use) PLUS one editor-instance pushState/commit, so
 *  the change is undoable both from the main Undo button and from inside the drawing editor's own Undo, same
 *  belt-and-suspenders two-undo-system split core/history.js's own UNDO_KEEPS doc comment already describes.
 *  `editor` is the live SVG editor instance (window.svgEditor) -- optional: a pull with no layer/geometry rows at
 *  all (board/frame only) never needs it. Nothing here decides WHEN to show a dialog or whether to Cancel --
 *  that's showChangeListDialog's own job; this is the one write path Apply calls into. */
export function applyChangeList(changeList, { editor } = {}) {
  const { boardRows, layerGroups, frameRows } = changeList;
  if (!boardRows.length && !layerGroups.length && !frameRows.length) return;

  recordStep('Pull from Fusion', ['frame', 'editorSvg'], () => {
    for (const row of boardRows) applyParam(row.appPath, row.to);

    const widthTriples = [];
    for (const group of layerGroups) {
      const patternLayer = resolvePatternLayer(editor, group.layerId);
      if (patternLayer && patternLayer.pattern) applyRows(group.rows, patternLayer.pattern);
      for (const row of group.rows) if (row.kind) widthTriples.push([group.layerId, row.kind, row.to]);
    }
    // rewidthOwnedKindsAcrossLayers pushes/commits ITSELF once it actually re-paints something -- calling it again
    // below would double the editor's own undo step. It only skips that when nothing was owned yet to re-paint
    // (e.g. a layer with no drawn content), in which case the pattern config above still changed underneath it and
    // this is the one place left to sync P.editorSvg (data-editor-layers' own round-trip of that pattern config).
    const repainted = widthTriples.length && editor ? rewidthOwnedKindsAcrossLayers(editor, widthTriples) : 0;

    if (frameRows.length) setFrameRecord(_frameApplyPatch(frameRows));

    if (editor && layerGroups.length && repainted === 0) {
      if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
      if (typeof editor.pushState === 'function') editor.pushState();
    }
  });
}

/** Builds and shows the dialog; `onApply(changeList)` fires on Apply (the caller owns the actual writes + undo
 *  step -- this function only ever builds/removes DOM), `onCancel()` (optional) on Cancel or an outside-overlay
 *  click. Returns the overlay element (for a caller that wants to remove it itself, e.g. in a test). */
export function showChangeListDialog(changeList, { onApply, onCancel } = {}, doc = document) {
  const overlay = doc.createElement('div');
  overlay.className = 'cad-modal-overlay';
  overlay.style.display = 'flex';
  overlay.id = 'pullChangeListOverlay';

  const win = doc.createElement('div');
  win.className = 'cad-modal-window';
  win.style.width = '420px';

  const header = doc.createElement('div');
  header.className = 'cad-modal-header';
  header.innerHTML = '<span>Changes from Fusion</span>';

  const body = _renderBody(changeList);
  body.classList.add('cad-modal-body');

  const footer = doc.createElement('div');
  footer.className = 'cad-modal-footer';
  const cancelBtn = doc.createElement('button');
  cancelBtn.type = 'button'; cancelBtn.className = 'cad-btn cad-btn-secondary'; cancelBtn.textContent = 'Cancel';
  const applyBtn = doc.createElement('button');
  applyBtn.type = 'button'; applyBtn.className = 'cad-btn cad-btn-primary'; applyBtn.textContent = 'Apply';
  footer.append(cancelBtn, applyBtn);

  win.append(header, body, footer);
  overlay.appendChild(win);
  doc.body.appendChild(overlay);

  const close = () => overlay.remove();
  cancelBtn.addEventListener('click', () => { close(); if (onCancel) onCancel(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { close(); if (onCancel) onCancel(); } });
  applyBtn.addEventListener('click', () => { close(); if (onApply) onApply(changeList); });

  return overlay;
}
