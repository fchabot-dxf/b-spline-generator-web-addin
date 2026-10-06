/**
 * Item 74d (advisor, the item 68 / 73 precedent; seat D's Artwork audit, measured: an Artwork setting for the NEXT element
 * -- stroke width, fill mode, Expand detail, font, the Lattice / Shape Lattice rails / ties / nodes -- took no undo step, so
 * Undo took back the previous canvas edit and left the setting): editor/next-settings-undo.js -- the settings ride in every
 * undo entry, and each change is ONE step. Behaviour on the REAL panel markup with an editor stub that keeps the real undo
 * entry shape (svg + parts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { EDITOR_NEXT_SETTINGS, PANEL_NEXT_SETTINGS, NEXT_SETTINGS_PART, initNextSettingsUndo } from '../bspline-frame-builder/b-spline-gen/html/editor/next-settings-undo.js';
import { takeUndoParts, restoreUndoParts, UNDO_PARTS } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const flush = () => new Promise((r) => setTimeout(r, 0));
const ALL_IDS = [...EDITOR_NEXT_SETTINGS.flatMap((f) => [f.box, ...(f.triggers || []), ...Object.values(f.buttons || {})]).filter(Boolean),
  ...PANEL_NEXT_SETTINGS.flatMap((p) => [...p.values, ...p.checks, ...p.groups.flat()])];

function makeEditor() {
  const ed = { _strokeWidth: 0.5, _fillMode: 'stroke', _fontFamily: 'Arial', _fontSize: 3, _expandDetail: 1, _undoStack: [], _redoStack: [] };
  ed._snapshotState = () => ({ svg: '', parts: takeUndoParts() });
  ed.pushState = () => { ed._undoStack.push(ed._snapshotState()); };
  ed._notifyChange = () => {};
  return ed;
}
const undo = (ed) => { ed._redoStack.push(ed._undoStack.pop()); restoreUndoParts(ed._undoStack[ed._undoStack.length - 1].parts); };

describe('item 74d: the declared next-element settings', () => {
  it('every declared control exists in the real palette', () => {
    document.body.innerHTML = BODY;
    for (const id of ALL_IDS) expect(document.getElementById(id), id).not.toBeNull();
  });
});

describe('item 74d: one change = one undo step, Undo puts it back', () => {
  let ed;
  beforeEach(() => {
    UNDO_PARTS.clear();
    document.body.innerHTML = BODY;
    ed = makeEditor();
    // the panels' own handlers, as the app binds them first: they write the editor field (no selection: no commit)
    document.getElementById('editorStrokeWidth').addEventListener('change', (e) => { ed._strokeWidth = parseFloat(e.target.value); });
    document.getElementById('editorFillModeFill').addEventListener('click', () => { ed._fillMode = 'fill'; });
    initNextSettingsUndo(ed);
    ed.pushState(); // the opening entry
  });

  it('a stroke width typed in its box: one step; Undo -> the editor field and the box back', async () => {
    const box = document.getElementById('editorStrokeWidth'); box.value = '0.75'; box.dispatchEvent(new Event('change')); await flush();
    expect(ed._undoStack.length).toBe(2);
    expect(ed._undoStack[1].parts[NEXT_SETTINGS_PART].editor._strokeWidth).toBe(0.75);
    undo(ed);
    expect(ed._strokeWidth).toBe(0.5);
    expect(Number(box.value)).toBe(0.5);
  });

  it('the fill mode: one step; Undo -> the field and the active button back', async () => {
    document.getElementById('editorFillModeFill').click(); await flush();
    expect(ed._undoStack.length).toBe(2);
    undo(ed);
    expect(ed._fillMode).toBe('stroke');
    expect(document.getElementById('editorFillModeStroke').classList.contains('active')).toBe(true);
    expect(document.getElementById('editorFillModeFill').classList.contains('active')).toBe(false);
  });

  it('a Lattice next-Generate value, a checkbox and a button group: one step each, Undo puts each back', async () => {
    const count = document.getElementById('latticeTiesModeCount'), density = document.getElementById('latticeTiesModeDensity');
    expect(count.classList.contains('active')).toBe(true); // the markup opens on Count
    // the panel's own reflect handlers (properties-lattice.js _showTiesMode): the active class
    count.addEventListener('click', () => { count.classList.add('active'); density.classList.remove('active'); });
    density.addEventListener('click', () => { density.classList.add('active'); count.classList.remove('active'); });
    const sp = document.getElementById('latticeRailsSpacing'), ends = document.getElementById('latticeNodesEnds');
    const v0 = sp.value, c0 = ends.checked;
    sp.value = '1.5'; sp.dispatchEvent(new Event('change')); await flush();
    expect(ed._undoStack.length).toBe(2);
    ends.checked = !c0; ends.dispatchEvent(new Event('change')); await flush();
    expect(ed._undoStack.length).toBe(3);
    density.click(); await flush();
    expect(ed._undoStack.length).toBe(4);
    undo(ed);
    expect(count.classList.contains('active') && !density.classList.contains('active')).toBe(true);
    expect(ends.checked).toBe(!c0);
    undo(ed);
    expect(ends.checked).toBe(c0);
    expect(sp.value).toBe('1.5');
    undo(ed);
    expect(sp.value).toBe(v0);
  });

  it.each([['editorExpandDetail', '_expandDetail', '1.2'], ['editorFontSize', '_fontSize', '3.2']])(
    '%s: Undo puts the box back exactly as it was shown (the advisor gate: "1.0" came back as "1")', async (id, prop, next) => {
      const box = document.getElementById(id); const shown = box.value;
      expect(shown).toMatch(/\.0$/); // the markup's own "1.0" / "3.0"
      box.addEventListener('change', () => { ed[prop] = parseFloat(box.value); });
      box.value = next; box.dispatchEvent(new Event('change')); await flush();
      expect(ed._undoStack.length).toBe(2);
      undo(ed);
      expect(box.value).toBe(shown);
    });

  it('a setter that already committed (a selected shape restyled) is not stepped twice', async () => {
    const box = document.getElementById('editorStrokeWidth');
    box.addEventListener('change', () => ed.pushState()); // what setStrokeWidth's own commit does with a selection
    box.value = '0.6'; box.dispatchEvent(new Event('change')); await flush();
    expect(ed._undoStack.length).toBe(2);
  });

  it('no change (the same value again): no step', async () => {
    const box = document.getElementById('editorStrokeWidth'); box.value = '0.5'; box.dispatchEvent(new Event('change')); await flush();
    expect(ed._undoStack.length).toBe(1);
  });
});
