import { bindClick } from '../dom.js';

export function registerExpandTool(editor) {
  bindClick('toolExpand', () => editor.setMode('expand'));
}
