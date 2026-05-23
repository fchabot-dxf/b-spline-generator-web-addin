import { expandCurrent } from './editor-expand.js';
import { fusLog } from '../core/fusion-bridge.js';

function _pLog(msg) {
  if (typeof window !== 'undefined' && window.__editorDebug === 'PERFORM-EXPAND') {
    try { console.log('[PERFORM-EXPAND] ' + msg); } catch (_) {}
  }
  try { fusLog('[PERFORM-EXPAND] ' + msg); } catch (_) {}
}

export async function performExpand(editor) {
  _pLog('start  hasSelection=' + !!editor._selectedElement +
        '  selType=' + (editor._selectedElement && editor._selectedElement.type) +
        '  sketchChildren=' + editor._sketchLayer.children().toArray().length);
  editor._commitText();
  try {
    await expandCurrent(editor, editor._expandDetail, editor._expandSimplify, editor._expandAccuracy, true);
  } catch (e) {
    _pLog('expandCurrent THREW: ' + e.message + '  stack: ' + (e.stack || '').split('\n').slice(0, 3).join(' | '));
  }
  _pLog('after expandCurrent  sketchChildren=' + editor._sketchLayer.children().toArray().length +
        '  hasSelection=' + !!editor._selectedElement +
        '  selType=' + (editor._selectedElement && editor._selectedElement.type));
  if (editor._onChange) {
    _pLog('firing _onChange');
    try { editor._onChange(); } catch (e) { _pLog('_onChange THREW: ' + e.message); }
    _pLog('_onChange done  sketchChildren=' + editor._sketchLayer.children().toArray().length);
  }
}
