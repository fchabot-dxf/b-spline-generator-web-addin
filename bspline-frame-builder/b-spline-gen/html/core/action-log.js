/**
 * Fred ("is there a way to have a log of my actions and of the data model, you can then look at" -> "a json copied
 * to clipboard"): a rolling log of what he does in the app, plus -- when he asks for it -- a compact snapshot of the
 * model, copied as JSON (Settings > Copy log) for him to paste into a Claude chat.
 *
 * The log: the last LOG_MAX entries `{ t, a, ...details }` (t = ms since the page loaded, a = what happened), kept in
 * localStorage so it survives a reload / tab eviction (the moment something odd happened is often just before one).
 * Recorded:
 *   - every button / tool click and every committed field change anywhere in the page (one capture listener each:
 *     id, label, value) -- no per-feature wiring to forget;
 *   - canvas presses and releases (editor-interaction.js: model point, pointer type, what was under it, moved);
 *   - tool switches (editor-ui setMode) and each committed edit (editor._notifyChange 'commit', with the undo depth);
 *   - uncaught errors.
 * Nothing leaves the device unless Fred copies it.
 */
const LOG_KEY = 'bspline.actionLog';
const LOG_MAX = 300;
const _t0 = typeof performance !== 'undefined' ? performance.now() : 0;
let _log = [];
try { _log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); if (!Array.isArray(_log)) _log = []; } catch (_) { _log = []; }
let _saveTimer = null;

const _r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

/** Record one action. `details` are plain values (numbers are rounded to 3 decimals). */
export function logAction(a, details = {}) {
  const e = { t: Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - _t0), a };
  for (const [k, v] of Object.entries(details)) e[k] = typeof v === 'number' ? _r3(v) : v;
  _log.push(e);
  if (_log.length > LOG_MAX) _log.splice(0, _log.length - LOG_MAX);
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { try { localStorage.setItem(LOG_KEY, JSON.stringify(_log)); } catch (_) { /* full */ } }, 500);
}

/** A new page load starts a new session in the log (the entries before it are the previous session's). */
logAction('page-load', { url: typeof location !== 'undefined' ? location.pathname : '' });

function _label(el) {
  const txt = (el.getAttribute('aria-label') || el.title || el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
  return txt.slice(0, 40);
}

if (typeof document !== 'undefined') {
  // every click on something clickable (button, tool, tab, swatch, menu row)
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('button, [role="button"], [role="menuitem"], .tool-btn, .panel-header, a') : null;
    if (!el) return;
    logAction('click', { id: el.id || undefined, label: _label(el) || undefined });
  }, true);
  // every committed field change (fires once per edit: release / blur / Enter / select)
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !el.tagName) return;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    logAction('change', { id: el.id || undefined, value: typeof value === 'string' ? value.slice(0, 60) : value });
  }, true);
}
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => logAction('error', { msg: String(e.message || e).slice(0, 200), at: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : undefined }));
  window.addEventListener('unhandledrejection', (e) => logAction('error', { msg: String((e.reason && e.reason.message) || e.reason).slice(0, 200) }));
}

/** The log entries (oldest first). */
export function actionLog() { return _log.slice(); }

// ─── the model snapshot ───────────────────────────────────────────────────────────────────────────────────────

const PIECE_ATTRS = ['data-layer', 'data-lattice', 'data-lattice-gen', 'data-override-color', 'data-stripe', 'data-contour-seg', 'data-boundary-ref', 'transform', 'display'];

/** One drawn element, compactly: its tag, the attributes that matter here, and its geometry rounded to 3 decimals. */
function _piece(node) {
  const g = (k) => node.getAttribute(k);
  const p = { tag: node.tagName.toLowerCase() };
  if (node.id) p.id = node.id;
  for (const k of PIECE_ATTRS) { const v = g(k); if (v != null) p[k.replace(/^data-/, '')] = v; }
  const n = (k) => _r3(parseFloat(g(k)));
  if (p.tag === 'line') Object.assign(p, { x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2') });
  else if (p.tag === 'circle') Object.assign(p, { cx: n('cx'), cy: n('cy'), r: n('r') });
  else if (p.tag === 'rect') Object.assign(p, { x: n('x'), y: n('y'), w: n('width'), h: n('height') });
  else if (p.tag === 'path') { const d = g('d') || ''; p.d = d.length > 300 ? d.slice(0, 300) + '…' : d; }
  else if (p.tag === 'text') p.text = (node.textContent || '').slice(0, 60);
  const stroke = g('stroke'); if (stroke) p.stroke = stroke;
  const sw = g('stroke-width'); if (sw) p.sw = _r3(parseFloat(sw));
  const fill = g('fill'); if (fill && fill !== 'none') p.fill = fill;
  return p;
}

/** A layer's pattern without its bulky / derived parts (the fill key is a JSON string of the whole contour). */
function _pattern(pattern) {
  if (!pattern) return undefined;
  const { fillInputs, ...rest } = pattern;
  return JSON.parse(JSON.stringify(rest));
}

/** The model right now: board, frame, editor layers + patterns, every drawn piece, the selection, undo depth. */
export function modelSnapshot(editor, P) {
  const snap = {
    board: P ? { widthIn: P.widthIn, heightIn: P.heightIn, carveZ: P.carveZ, spacing: P.spacing, seed: P.seed } : undefined,
    frame: P ? P.frame : undefined,
  };
  if (editor && editor._sketchLayer) {
    const nodes = [...editor._sketchLayer.node.children];
    const index = new Map(nodes.map((n, i) => [n, i]));
    snap.editor = {
      mode: editor._currentMode,
      model: { w: editor._mW, h: editor._mH },
      view: editor._view ? { cx: _r3(editor._view.cx), cy: _r3(editor._view.cy), zoom: _r3(editor._view.zoom) } : undefined,
      activeLayer: editor._activeLayer,
      layers: (editor._layers || []).map((l) => ({
        id: l.id, name: l.name, visible: l.visible !== false, locked: !!l.locked,
        pattern: _pattern(l.pattern), patternOwner: l.patternOwner,
      })),
      selection: (editor._selectedElements || []).map((el) => index.get(el.node)),
      undoDepth: Array.isArray(editor._undoStack) ? editor._undoStack.length : undefined,
      pieces: nodes.map(_piece), // in DOM (= drawing) order: a later piece is drawn on top
    };
  }
  return snap;
}

/** The JSON Fred copies: when, where, the log, the model. */
export function logReport(editor, P) {
  return JSON.stringify({
    app: 'b-spline frame builder',
    copiedAt: new Date().toISOString(),
    screen: typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio, touch: 'ontouchstart' in window } : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    log: actionLog(),
    model: modelSnapshot(editor, P),
  });
}
