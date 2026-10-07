/**
 * Item 74h (Fred: grey + explain, the 74b precedent; seat D measured: on T1 at the default 1 in spacing the Lattice's
 * Start / Center / End all laid the same 9 rails -- the 8 in span, j 2..34 at the 0.25 in grid, is an even multiple of
 * the step): an anchor that would lay the SAME rails as the current one is greyed with why, from the rail plan alone
 * (editor-lattice-pattern.js railAnchorsSameAsCurrent); the current one never is. The Shape Lattice on T1 spans j 1..35,
 * where the three differ (measured: Start 1.25.., Center 0.5.., End 0.75..) -- all live.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { railAnchorsSameAsCurrent } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { syncAnchorGrey, SAME_RAILS_WHY } from '../bspline-frame-builder/b-spline-gen/html/editor/lattice-anchor-grey.js';
import { initNextSettingsUndo, NEXT_SETTINGS_PART } from '../bspline-frame-builder/b-spline-gen/html/editor/next-settings-undo.js';
import { takeUndoParts, restoreUndoParts, UNDO_PARTS } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';

const GRID = 0.25, BOX_T1 = { jMin: 2, jMax: 34 }, SHAPE_T1 = { jMin: 1, jMax: 35 };
const rails = (over) => ({ mode: 'spacing', anchor: 'center', spacing: 1, spacingCount: null, ...over });

describe('item 74h: the rail plan says which anchors lay the same rails', () => {
  it('T1 box lattice, 1 in: Start and End lay the Center rails; Center (current) is never "same"', () => {
    expect(railAnchorsSameAsCurrent(BOX_T1, rails(), GRID)).toEqual({ start: true, center: false, end: true });
  });
  it('0.75 in and 1.5 in: all three differ', () => {
    expect(railAnchorsSameAsCurrent(BOX_T1, rails({ spacing: 0.75 }), GRID)).toEqual({ start: false, center: false, end: false });
    expect(railAnchorsSameAsCurrent(BOX_T1, rails({ spacing: 1.5 }), GRID)).toEqual({ start: false, center: false, end: false });
  });
  it('from Start at 1 in: End lays the same rails (both whole multiples), Center too (even multiple)', () => {
    expect(railAnchorsSameAsCurrent(BOX_T1, rails({ anchor: 'start' }), GRID)).toEqual({ start: false, center: true, end: true });
  });
  it('the T1 Shape Lattice span (j 1..35): all live; no span or another rails mode: no facts', () => {
    expect(railAnchorsSameAsCurrent(SHAPE_T1, rails(), GRID)).toEqual({ start: false, center: false, end: false });
    expect(railAnchorsSameAsCurrent(null, rails(), GRID)).toEqual({});
    expect(railAnchorsSameAsCurrent(BOX_T1, rails({ mode: 'every' }), GRID)).toEqual({});
  });
});

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');
const btn = (a) => document.getElementById(`latticeRailsAnchor${a}`);

describe('item 74h: a greyed segment LOOKS greyed', () => {
  it('base.css dims a disabled .editor-fillmode-btn (measured: without it a greyed anchor was the inactive grey exactly)', () => {
    const css = readFileSync('bspline-frame-builder/styles/base.css', 'utf8');
    const rule = css.match(/\.editor-fillmode-btn:disabled\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/opacity:\s*0\.4/);
  });
});

describe('item 74h: the panel row (real markup)', () => {
  let ed;
  beforeEach(() => {
    document.body.innerHTML = BODY;
    ed = { _activeLayer: 'L1', _layers: [{ id: 'L1', pattern: { railSpan: BOX_T1, spacing: GRID, rails: { mode: 'spacing' } } }] };
  });
  it('1 in: Start / End greyed with why, Center (current) live; 0.75 in: all live, own titles back', () => {
    const ownTitle = btn('Start').title;
    syncAnchorGrey(ed, 'lattice');
    expect([btn('Start').disabled, btn('Center').disabled, btn('End').disabled]).toEqual([true, false, true]);
    expect(btn('Start').title).toBe(SAME_RAILS_WHY);
    document.getElementById('latticeRailsSpacing').value = '0.75';
    syncAnchorGrey(ed, 'lattice');
    expect([btn('Start').disabled, btn('Center').disabled, btn('End').disabled]).toEqual([false, false, false]);
    expect(btn('Start').title).toBe(ownTitle);
  });
  it('no Generate yet (no stored span): nothing greyed', () => {
    ed._layers[0].pattern.railSpan = undefined;
    syncAnchorGrey(ed, 'lattice');
    expect([btn('Start').disabled, btn('End').disabled]).toEqual([false, false]);
  });
  it('74d: an Undo back to a stored anchor still restores it while that button is greyed', async () => {
    UNDO_PARTS.clear();
    const und = { _undoStack: [], _notifyChange: () => {} };
    und._snapshotState = () => ({ svg: '', parts: takeUndoParts() });
    und.pushState = () => { und._undoStack.push(und._snapshotState()); };
    for (const a of ['Start', 'Center', 'End']) btn(a).addEventListener('click', () => ['Start', 'Center', 'End'].forEach((x) => btn(x).classList.toggle('active', x === a)));
    initNextSettingsUndo(und);
    btn('Start').click(); und.pushState(); // an entry holding Start
    expect(und._undoStack[0].parts[NEXT_SETTINGS_PART].panel.latticeRailsAnchorStart).toBe('latticeRailsAnchorStart');
    // now Center (set directly: happy-dom forwards a click on a button inside a <label> to the label's first button)
    ['Start', 'Center', 'End'].forEach((x) => btn(x).classList.toggle('active', x === 'Center'));
    syncAnchorGrey(ed, 'lattice'); // Start is greyed now (same rails as Center at 1 in)
    expect(btn('Start').disabled).toBe(true);
    restoreUndoParts(und._undoStack[0].parts);
    expect(btn('Start').classList.contains('active')).toBe(true);
  });
});
