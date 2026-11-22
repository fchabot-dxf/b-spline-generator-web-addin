/**
 * editor/editor-height-tool.js -- HEIGHT-PAINTER: the Height tab's brush as an editor gesture MODE ('heightBrush', declared
 * in main/editor-tabs.js EDITOR_TABS height.modes; main/global-events.js drops it on a switch to another tab). It paints on
 * the SHARED editor canvas: `pt` is the editor's own point (board inches, y down) after its pan / zoom, so a stroke lands
 * where the patch is drawn (main/height-panel.js syncHeightOverlay).
 *
 * The editor never knows what a height patch is (editor/ never imports main/): main/height-panel.js sets
 * `editor._heightTool` = { start(pt, e) -> true when a stroke began, move(pt, e), end() -> its commit's promise,
 * hover(pt), cancel() }, the same hand-off as editor._brickSettings for the Brick brush.
 */
export const heightBrushHandler = {
  start(editor, pt, e) {
    const t = editor._heightTool;
    editor._isDrawing = !!(t && t.start(pt, e));
  },
  update(editor, pt, e) {
    if (editor._isDrawing && editor._heightTool) editor._heightTool.move(pt, e);
  },
  finish(editor) {
    const was = editor._isDrawing;
    editor._isDrawing = false;
    return was && editor._heightTool ? editor._heightTool.end() : undefined;
  },
  hover(editor, pt) {
    if (editor._heightTool) editor._heightTool.hover(pt);
  },
};
