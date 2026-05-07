/**
 * "Expand" turns a selected element into a filled outline path. Three
 * strategies are tried in order; the first one that handles the element
 * wins. Each strategy lives in its own file:
 *
 *   1. editor-expand-text.js  — text via opentype.js fast path.
 *   2. editor-expand-shape.js — geometric stroke offset for vector shapes.
 *   3. editor-expand-trace.js — canvg trace fallback for everything else.
 *
 * Each `expandX(editor, el, opts)` returns true if it handled the
 * element (success, original removed, replacement selected) and false
 * if the orchestrator should fall through to the next strategy.
 */
import { expandText } from './editor-expand-text.js';
import { expandShape } from './editor-expand-shape.js';
import { expandTrace } from './editor-expand-trace.js';

export async function expandCurrent(editor, detail = 1.0, simplify = 15, accuracy = 1.0, commit = true) {
    if (!editor._selectedElement) return;
    const el = editor._selectedElement;
    const opts = { detail, simplify, accuracy, commit };

    if (await expandText(editor, el, opts)) return;
    if (expandShape(editor, el, opts)) return;
    await expandTrace(editor, el, opts);
}
