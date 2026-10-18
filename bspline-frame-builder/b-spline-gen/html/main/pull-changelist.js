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
import { resolvePatternLayer, rewidthOwnedKindsAcrossLayers, PATTERN_DEFAULTS, generatePattern } from '../editor/editor-lattice-pattern.js';
import { recordStep } from '../core/history.js';
import { _findRailElementById } from '../editor/editor-interaction.js';
import { getElementLayer } from '../editor/layers.js';
import { latticeExtentFor } from '../editor/editor-sketch-manifest.js';
import { matchPulledRails } from '../core/pull-rails.js';
import { boardRegion } from '../editor/editor-shape-lattice-interaction.js';

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

/** A frame-shape row with its own Apply checkbox (row.apply is read back by applyChangeList). */
function _shapeRow(row) {
  const el = document.createElement('div');
  el.className = 'pull-changelist-row';
  el.style.alignItems = 'center'; el.style.minHeight = '28px'; // touch target, phone first
  const left = document.createElement('label'); // the box + its name: one tap target
  left.style.display = 'flex'; left.style.flexDirection = 'row'; left.style.alignItems = 'center'; left.style.gap = '8px'; // base.css's global label is a column
  const box = document.createElement('input');
  box.type = 'checkbox'; box.checked = row.apply !== false; box.style.margin = '0';
  box.addEventListener('change', () => { row.apply = box.checked; });
  const text = document.createElement('span');
  text.textContent = row.label;
  left.append(box, text);
  const change = document.createElement('span');
  change.textContent = `${_fmtIn(row.from)} → ${_fmtIn(row.to)}${row.outOfRange ? " ⚠ outside the Frame tab's range" : ''}`;
  el.append(left, change);
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

  // Part 2: the wood frame's sketch SHAPE -- each moved handle is a checkbox row (one that fits outside the handle's
  // feasible range starts unchecked and says so: detection only, never a clamp); an edit the handles cannot
  // express is said, and nothing is written for it.
  const shapeRows = changeList.frameShapeRows || [];
  if (shapeRows.length) {
    body.appendChild(_groupHeader(`Wood frame: shape changed (${shapeRows.length} handle${shapeRows.length === 1 ? '' : 's'} moved)`));
    for (const row of shapeRows) body.appendChild(_shapeRow(row));
    body.appendChild(_divider());
  }
  if ((changeList.frameShapeBeyond || []).length) {
    const note = document.createElement('div');
    note.className = 'pull-changelist-note';
    note.textContent = `Wood frame: the sketch was edited beyond what the frame's handles can express (${changeList.frameShapeBeyond.join(', ')}) — left as is.`;
    body.appendChild(note);
  }

  // rails move freely in Fusion now (no driving param) -- their new positions come back as geometry. A matched
  // one (a real Send-tagged railId, still a live rail here) gets its own position locked on Apply; one that
  // can't be matched (a hand-drawn/legacy curve, or a rail since deleted) is still counted here but Apply
  // leaves it alone -- so this stays a plain count, not a promise every one of them will move.
  if (changeList.curveCount > 0) {
    const note = document.createElement('div');
    note.className = 'pull-changelist-note';
    note.textContent = `${changeList.curveCount} rail${changeList.curveCount === 1 ? '' : 's'} moved in Fusion — Apply locks each one at its new position.`;
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
    || (changeList.frameShapeRows || []).length > 0 || (changeList.frameShapeBeyond || []).length > 0 || changeList.curveCount > 0;
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

/** Rails custom-position + lock slice (seat D 2026-10-16; advisor 45, Fred's pre-decided design): the Pull-Apply
 *  write path for rail POSITIONS -- for every pulled curve that carries a real Send-tagged railId AND still has
 *  a live rail drawn for it, resolves the LAYER that rail currently belongs to (_findRailElementById +
 *  getElementLayer + resolvePatternLayer -- the SAME chain the lock badge's own hit-test uses), groups by that
 *  layer's own pattern, and writes/updates pattern.rails.custom for each one -- ALWAYS `locked: true` ("Pull
 *  reads each rail's real position ... and keeps it, with a lock on the pulled rails" -- Fred's own original
 *  wording: every pull-apply RE-locks what it touches, even a rail the user had since unlocked by hand).
 *  core/pull-rails.js's own matchPulledRails does the actual offset-fraction math, one copy shared with both the
 *  canvas-drag persistence (editor-interaction.js) and this. Returns the SET of pattern objects actually touched
 *  (never a bare count) -- the caller runs the SAME Generate on each one (advisor 45: "Apply must SHOW the
 *  rails where Fusion put them... have Apply call the SAME Generate for that lattice layer... one code path, no
 *  new risk" -- never a second, narrower placer re-deriving row placement here). */
function applyPulledRailPositions(editor, pulledCurves) {
  const touched = new Set();
  if (!editor || !Array.isArray(pulledCurves) || !pulledCurves.length) return touched;
  const byPattern = new Map(); // pattern object -> its own matched curves
  for (const curve of pulledCurves) {
    if (!curve || curve.type !== 'line' || !curve.railId) continue;
    const el = _findRailElementById(editor, curve.railId);
    if (!el) continue;
    const layerId = getElementLayer(el);
    const patternLayer = resolvePatternLayer(editor, layerId);
    const pattern = patternLayer && patternLayer.pattern;
    if (!pattern) continue;
    if (!byPattern.has(pattern)) byPattern.set(pattern, []);
    byPattern.get(pattern).push(curve);
  }
  for (const [pattern, curves] of byPattern) {
    const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
    const orientation = pattern.orientation || 'horizontal';
    const extent = latticeExtentFor(pattern, boardRegion(editor));
    const custom = Array.isArray(pattern.rails && pattern.rails.custom) ? pattern.rails.custom.slice() : [];
    let matched = 0;
    for (const m of matchPulledRails(curves, { spacing, orientation, extent })) {
      if (m.at == null) continue;
      const idx = custom.findIndex((c) => c.id === m.id);
      const entry = { id: m.id, at: m.at, locked: true };
      if (idx >= 0) custom[idx] = entry; else custom.push(entry);
      matched++;
    }
    if (!matched) continue;
    pattern.rails = { ...(pattern.rails || PATTERN_DEFAULTS.rails), custom };
    touched.add(pattern);
  }
  return touched;
}

/** Writes every row in `changeList` back onto the app's own board/layer/frame state, in ONE global undo step
 *  (core/history.js recordStep -- the same "sidebar change becomes one step" convention frame-panel.js's
 *  editFrameNow and brick-panel.js's recordBoardStep already use) PLUS one editor-instance pushState/commit, so
 *  the change is undoable both from the main Undo button and from inside the drawing editor's own Undo, same
 *  belt-and-suspenders two-undo-system split core/history.js's own UNDO_KEEPS doc comment already describes.
 *  `editor` is the live SVG editor instance (window.svgEditor) -- optional: a pull with no layer/geometry rows at
 *  all (board/frame only) never needs it. Nothing here decides WHEN to show a dialog or whether to Cancel --
 *  that's showChangeListDialog's own job; this is the one write path Apply calls into.
 *
 *  Async (advisor 45): a matched rail position isn't just data -- Fred's own "an action is never a silent no-op"
 *  rule means Apply must SHOW the rail where Fusion put it, not leave it drawn at its old spot until the user
 *  separately hits Generate. The one way to do that without a second, narrower placer re-deriving row placement
 *  is to call the SAME generatePattern Generate itself calls, for each layer a rail position actually touched,
 *  AFTER its own width rows are already applied (so Generate redraws with the CURRENT widths, not stale ones) --
 *  generatePattern is itself async (boundary-mode layers resolve their contour asynchronously), so this function
 *  is too; a caller that needs the drawn result to actually be settled (a test, primarily) awaits it.
 *  core/history.js's own recordStep never awaits its `change` callback, but that's fine here: its own GLOBAL
 *  snapshot (persistableP()) never includes editor._layers/pattern state at all (that's the SEPARATE 'editorSvg'
 *  restore key, itself only ever read LAZILY at undo time, not at record time) -- recordStep's own synchronous
 *  half (board/layer/frame writes, all plain data) is what it snapshots, already complete by the time it runs,
 *  regardless of how long the async Generate(s) below still have left to run. */
export async function applyChangeList(changeList, { editor, pulledCurves } = {}) {
  const { boardRows, layerGroups, frameRows } = changeList;
  const shapeRows = (changeList.frameShapeRows || []).filter((r) => r.apply !== false); // the checked ones
  const hasRailMoves = editor && Array.isArray(pulledCurves) && pulledCurves.some((c) => c && c.railId);
  if (!boardRows.length && !layerGroups.length && !frameRows.length && !shapeRows.length && !hasRailMoves) return;

  let genPromise = null;
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

    if (frameRows.length || shapeRows.length) {
      const patch = frameRows.length ? _frameApplyPatch(frameRows) : { ...getFrameRecord() };
      // the shape: the SEEDED handle values, merged over the record's own seeds (never a dimension or a param)
      if (shapeRows.length) patch.seeds = { ...(patch.seeds || {}), ...Object.fromEntries(shapeRows.map((r) => [r.key, r.toFrac])) };
      setFrameRecord(patch);
    }

    // rails-lock slice: write pattern.rails.custom for every matched rail FIRST (synchronous -- computePattern
    // needs it in place before it runs), then Generate each touched layer, ASYNCHRONOUSLY, started here but
    // held in `genPromise` for this function's own caller to await below -- recordStep itself never waits on it
    // (see this function's own doc comment for why that's safe).
    const touchedPatterns = hasRailMoves ? applyPulledRailPositions(editor, pulledCurves) : new Set();

    if (touchedPatterns.size) {
      // amendUndo: generatePattern's own "fold into whatever was JUST pushed" convention (editor.js's own
      // _lastPushedState) -- true only once something in THIS transaction has already pushed (the width
      // repaint above, or an earlier layer's own Generate in this same loop), so one Apply with BOTH a width
      // change and a rail-position change still ends as exactly ONE editor-local undo step, never two; the
      // FIRST push of this transaction (nothing to fold into yet) pushes fresh instead.
      let amend = repainted > 0;
      genPromise = (async () => {
        for (const pattern of touchedPatterns) {
          await generatePattern(editor, pattern, { amendUndo: amend });
          amend = true;
        }
      })();
    } else if (editor && layerGroups.length && repainted === 0) {
      if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
      if (typeof editor.pushState === 'function') editor.pushState();
    }
  });
  if (genPromise) await genPromise;
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
