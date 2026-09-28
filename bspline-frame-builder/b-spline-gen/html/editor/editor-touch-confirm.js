/**
 * Touch confirm for the one-shot line tools (scissors, stripe) -- Fred: "the mechanics of the tool aren't
 * ideal on mobile ... I'd want to avoid precisely tapping and would prefer a press down and drag to hover on
 * selection ... Could a green check mark and a red x on screen help with mobile confirmation? Like line
 * drawing in Fusion, I'd like to press anywhere and hold drag to selection with hover feedback, release show
 * the confirm or abort, click anywhere to cancel" / "not release over check or x, I want to click again on it".
 *
 * On TOUCH only (mouse/pen keep the instant click):
 *   1. press ANYWHERE and drag: the aim (the touch-marker point, above the finger) follows, and the tool's own
 *      hover preview shows what it would act on;
 *   2. release: nothing is done yet -- if the aim is on a target, its preview stays and a green check + red X
 *      appear just above it; over nothing, nothing is kept;
 *   3. a separate TAP on the check acts (one undo step, the tool stays active); a tap on the X, or anywhere
 *      else, cancels; pressing and dragging again re-aims instead.
 * The pending action survives a pinch/pan (the buttons live in the handle layer, in model space, so they move
 * with the view and are re-drawn on every handle render) and is dropped on a tool switch.
 *
 * `tool` = { name, preview(editor, pt) -> boolean (draws the hover preview; true = a target is under pt),
 *            clearPreview(editor), act(editor, pt) }.
 */

export const TOUCH_CONFIRM_ID = 'touch-confirm';
/** Button radius and the gap above the target, in SCREEN px (converted at draw time). */
const BUTTON_R_PX = 22;
const BUTTON_GAP_PX = 58;
const BUTTON_SPREAD_PX = 34;
export const CONFIRM_COLORS = Object.freeze({ ok: '#2e7d32', cancel: '#c62828' });

export const isTouchPress = (editor, e) => ((e && e.pointerType) || editor._pointerType) === 'touch';

const _px = (editor, px) => (typeof editor._getDynamicTolerance === 'function' ? editor._getDynamicTolerance(px) : px / 100);

/** Where the two buttons sit (model units) for a pending action at `pt`. */
export function confirmButtons(editor, pt) {
  const r = _px(editor, BUTTON_R_PX), up = _px(editor, BUTTON_GAP_PX), dx = _px(editor, BUTTON_SPREAD_PX);
  return {
    r,
    cancel: { x: pt.x - dx, y: pt.y - up },
    ok: { x: pt.x + dx, y: pt.y - up },
  };
}

/** Draws the pending action's buttons (and re-draws its preview) -- called on every handle render. */
export function renderTouchConfirm(editor) {
  const pend = editor._touchConfirm;
  const layer = editor._handleLayer;
  if (!layer) return;
  const old = layer.findOne ? layer.findOne('#' + TOUCH_CONFIRM_ID) : null;
  if (old) old.remove();
  if (!pend) return;
  pend.tool.preview(editor, pend.pt);
  const b = confirmButtons(editor, pend.pt);
  const g = layer.group().id(TOUCH_CONFIRM_ID).attr('pointer-events', 'none');
  const w = b.r * 0.16;
  g.circle(2 * b.r).center(b.cancel.x, b.cancel.y).fill(CONFIRM_COLORS.cancel).stroke({ color: '#fff', width: w * 0.6 });
  const k = b.r * 0.42;
  g.path(`M${b.cancel.x - k} ${b.cancel.y - k} L${b.cancel.x + k} ${b.cancel.y + k} M${b.cancel.x + k} ${b.cancel.y - k} L${b.cancel.x - k} ${b.cancel.y + k}`)
    .fill('none').stroke({ color: '#fff', width: w, linecap: 'round' });
  g.circle(2 * b.r).center(b.ok.x, b.ok.y).fill(CONFIRM_COLORS.ok).stroke({ color: '#fff', width: w * 0.6 });
  g.path(`M${b.ok.x - b.r * 0.45} ${b.ok.y + b.r * 0.02} L${b.ok.x - b.r * 0.12} ${b.ok.y + b.r * 0.35} L${b.ok.x + b.r * 0.48} ${b.ok.y - b.r * 0.35}`)
    .fill('none').stroke({ color: '#fff', width: w, linecap: 'round', linejoin: 'round' });
}

/** Drops a pending action and its preview/buttons (a cancel, a tool switch). */
export function clearTouchConfirm(editor) {
  const pend = editor._touchConfirm;
  editor._touchConfirm = null;
  if (pend) pend.tool.clearPreview(editor);
  const layer = editor._handleLayer;
  const old = layer && layer.findOne ? layer.findOne('#' + TOUCH_CONFIRM_ID) : null;
  if (old) old.remove();
}

/** The tool's `start` on touch. `pt` = the aim point (touch-marker offset), `raw` = under the finger (the
 *  buttons are hit where they are drawn, under the finger). Returns nothing; always handles the press. */
export function touchConfirmStart(editor, tool, pt, raw) {
  const pend = editor._touchConfirm;
  if (pend) {
    const b = confirmButtons(editor, pend.pt);
    const hit = (c) => raw && Math.hypot(raw.x - c.x, raw.y - c.y) <= b.r * 1.25;
    if (hit(b.ok)) { // confirm
      const p = pend.pt;
      clearTouchConfirm(editor);
      pend.tool.act(editor, p);
      return;
    }
    clearTouchConfirm(editor); // the X, or anywhere else: cancel -- and a drag from here re-aims
    editor._touchAim = { pt, moved: false, cancelled: true };
  } else {
    editor._touchAim = { pt, moved: false, cancelled: false };
  }
  editor._isDrawing = true;
  tool.preview(editor, pt);
}

export function touchConfirmUpdate(editor, tool, pt) {
  const aim = editor._touchAim;
  if (!aim) return;
  aim.pt = pt;
  aim.moved = true;
  tool.preview(editor, pt);
}

/** Release: keep a target as the pending action (buttons shown), or drop everything. A tap that only
 *  cancelled a pending action (no drag) leaves nothing pending. */
export function touchConfirmFinish(editor, tool) {
  const aim = editor._touchAim;
  editor._touchAim = null;
  editor._isDrawing = false;
  if (!aim) return;
  if (aim.cancelled && !aim.moved) { tool.clearPreview(editor); return; }
  if (tool.preview(editor, aim.pt)) {
    editor._touchConfirm = { tool, pt: aim.pt };
    renderTouchConfirm(editor);
  } else {
    tool.clearPreview(editor);
  }
}
