import { expandCurrent } from './editor-expand.js';
import { fusLog } from '../core/fusion-bridge.js';
import { dbg } from '../core/debug.js';

// SE8c/SA-DEAD-1: routed through the declared dbg() gate instead of
// hand-rolling window.__editorDebug === 'PERFORM-EXPAND'.
function _pLog(msg) {
  dbg('PERFORM-EXPAND', msg);
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
