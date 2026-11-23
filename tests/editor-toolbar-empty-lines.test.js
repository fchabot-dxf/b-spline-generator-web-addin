/**
 * Owner 2026-11-23 (phone 390, Height tab): under the options row the editor's top bar showed an EMPTY second line with only
 * a thin divider -- measured: the touch-actions group (its buttons all moved out or hidden: editor-chrome.js TOUCH_ROW /
 * SELECTION_BAR) still forced display:flex on a coarse pointer, its lone divider wrapped under the 374 px options row (bar
 * 89 px instead of 44), and the bar's trailing flex spacer and the empty left rail (13 px) took lines of their own.
 * Nothing empty takes space: the REAL rules (styles/editor.css) matched against the REAL markup.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');
const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

/** A selector list split at its TOP-LEVEL commas (a `:not(a, b)` list stays whole). */
function splitSelectors(list) {
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur].map((s) => s.trim()).filter(Boolean);
}
/** The selectors of every rule in `css` whose body sets `decl` (inside any media block), comments dropped. */
function selectorsSetting(css, decl) {
  const out = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) if (m[2].replace(/\s+/g, ' ').includes(decl)) out.push(...splitSelectors(m[1]));
  return out;
}
/** `el` matches one of `sels` -- judged on a FRESH deep copy of its parent (happy-dom keeps a :has() answer when only a
 *  descendant changed; a browser re-evaluates), the copy of `el` at the same place. */
const matchesAny = (el, sels) => {
  const parent = el.parentElement.cloneNode(true);
  const twin = parent.children[[...el.parentElement.children].indexOf(el)];
  return sels.some((s) => { try { return twin.matches(s); } catch (_) { return false; } });
};

beforeEach(() => { document.body.innerHTML = BODY; });

describe('the editor top bar: nothing empty takes a line', () => {
  it('the touch-actions group is forced visible only while it holds a shown button', () => {
    const show = selectorsSetting(CSS, 'display: flex !important').filter((s) => s.includes('editor-touch-actions-group'));
    const g = document.getElementById('editorTouchActionsGroup');
    // as the app leaves it: Copy / Lock moved to the selection bar, Paste / Select all / Cancel hidden (editor-chrome.js)
    for (const id of ['editorTouchCopy', 'editorTouchLock']) document.getElementById(id).remove();
    for (const id of ['editorTouchPaste', 'editorTouchSelectAll', 'editorTouchCancel']) document.getElementById(id).style.display = 'none';
    expect(matchesAny(g, show)).toBe(false);
    document.getElementById('editorTouchCancel').style.display = ''; // a pen path being drawn: Cancel shows
    expect(matchesAny(g, show)).toBe(true);
  });
  it('the bar\'s empty spacer and a left rail with no shown toolbar take no space on a narrow screen', () => {
    const gone = selectorsSetting(CSS, 'display: none !important');
    const bar = document.getElementById('editorToolbarTop');
    const spacer = [...bar.children].at(-1);
    expect(spacer.children.length).toBe(0);
    expect(matchesAny(spacer, gone)).toBe(true);
    for (const id of ['editorGridGroup', 'editorHeightOptionsGroup', 'editorStrokeGroup']) expect(matchesAny(document.getElementById(id), gone), id).toBe(false);
    const rail = document.querySelector('.editor-sidebar');
    const frame = document.getElementById('editorToolbarFrame');
    // the Height / Draw / Brick tabs: every toolbar in the rail hidden -> the rail goes
    frame.style.display = 'none';
    expect(matchesAny(rail, gone)).toBe(true);
    // the Wood frame tab: its toolbar shown but empty -> the rail goes
    frame.style.display = 'flex';
    expect(matchesAny(rail, gone)).toBe(true);
    // a toolbar with tools shown (the Photo tab's was the last, Fred 2026-11-23: the rule is kept) -> the rail stays
    frame.appendChild(Object.assign(document.createElement('button'), { className: 'tool-btn' }));
    expect(matchesAny(rail, gone)).toBe(false);
  });
  it('the empty left rail takes no space at ANY width (advisor 2026-11-23: measured 44 px dead at 1400 on every tab)', () => {
    // the rule hiding the rail is not inside a media block (the bar's spacer rule stays narrow-only)
    const flat = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const media = (sel) => {
      const at = flat.indexOf(sel);
      expect(at, sel).toBeGreaterThan(0);
      let depth = 0;
      for (let i = at; i >= 0; i--) {
        if (flat[i] === '}') depth++;
        else if (flat[i] === '{') { if (depth === 0) { const head = flat.slice(flat.lastIndexOf('}', i) + 1, i); if (head.trim().startsWith('@')) return head.trim(); } else depth--; }
      }
      return null;
    };
    expect(media('.editor-sidebar:not(:has(> [id^="editorToolbar"]')).toBeNull();
    expect(media('#editorToolbarTop > :empty')).toMatch(/max-width: 900px/);
  });
});
