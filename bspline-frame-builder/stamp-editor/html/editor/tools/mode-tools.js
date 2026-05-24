import { bindClick } from '../dom.js';

export function registerModeTools(editor) {
  const bind = (id, fn) => bindClick(id, fn);

  bind('toolSelect', () => editor.setMode('select'));
  bind('toolNode', () => editor.setMode('node'));
  bind('toolDraw', () => editor.setMode('draw'));
  bind('toolLine', () => editor.setMode('line'));
  bind('toolRect', () => editor.setMode('rect'));
  bind('toolCircle', () => editor.setMode('circle'));
  bind('toolText', () => editor.setMode('text'));
  // Vector eraser: drag a stroke to subtract from filled shapes and
  // split open strokes. Width follows the sidebar's stroke width.
  bind('toolErase', () => editor.setMode('erase'));
}
