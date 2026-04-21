import { bindClick } from '../dom.js';
import { performExpand } from '../expand.js';

export function registerExpandTool(editor) {
  bindClick('toolExpand', () => editor.setMode('expand'));
}
