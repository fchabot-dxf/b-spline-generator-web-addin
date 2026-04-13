import { queryAll } from './dom.js';

const PANEL_IDS = {
  shape: 'editorShapePanel',
  text: 'editorTextPanel',
  select: 'editorSelectPanel',
  default: 'editorDefaultPanel'
};

export function getActivePropertiesPanel(editor) {
  const el = editor._selectedElement;
  const mode = editor._currentMode;
  const isTextMode = mode === 'text' || (el && el.type === 'text');
  const isSelectMode = mode === 'select' || mode === 'node';
  const isShapeMode = ['draw', 'line', 'rect', 'circle'].includes(mode);
  const isShapeSelected = el && el.type && el.type !== 'text' && el.type !== 'image';

  if (isTextMode) return PANEL_IDS.text;
  if (isSelectMode) return PANEL_IDS.select;
  if (isShapeMode || isShapeSelected) return PANEL_IDS.shape;
  return PANEL_IDS.default;
}

export function renderPropertiesPanel(editor) {
  const activePanel = getActivePropertiesPanel(editor);
  const panels = queryAll('.editor-properties-pane');
  if (!panels.length) return;
  panels.forEach(panel => panel.classList.toggle('active', panel.id === activePanel));
}
