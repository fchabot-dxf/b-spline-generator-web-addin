import { registerModeTools } from './mode-tools.js';
import { registerActionTools } from './action-tools.js';
import { registerExpandTool } from './expand-tool.js';

export function registerEditorTools(editor) {
  registerModeTools(editor);
  registerExpandTool(editor);
  registerActionTools(editor);
}
