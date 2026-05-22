import { expandCurrent } from './editor-expand.js';

export async function performExpand(editor) {
  editor._commitText();
  await expandCurrent(editor, editor._expandDetail, editor._expandSimplify, editor._expandAccuracy, true);
  if (editor._onChange) editor._onChange();
}
