/**
 * The CAM palette's Toolpaths list (CAM-builder/ui/html/cam-op-list.js), Fred 2026-10-20: each operation by setup, its
 * tool, its state and its own Generate button, plus "Generate all missing"; one generation at a time with a Stop. Buttons,
 * states and text ONLY -- no input fields. The add-in side: CAM-builder/test_op_list.py.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OP_STATES, elapsedText, summaryText, missingCount, rowView, groupView, bannerView, listView, renderOpList } from '../bspline-frame-builder/CAM-builder/ui/html/cam-op-list.js';

const PALETTE = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf8');
const MODULE = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam-op-list.js', 'utf8');

const op = (name, state, extra = {}) => ({ key: `k-${name}`, name, tool: '3/16 flat', rest: false, strategy: 'pocket_clearing', state, why: '', src: 'addin', dup: false, ...extra });
const payload = (setups, run = {}) => ({ setups, run: { on: false, durations: {}, failed: {}, ...run } });

describe('the declared states', () => {
  it('every state Fusion can give has a dot, a label and a button word; stale says why', () => {
    expect(Object.keys(OP_STATES).sort()).toEqual(['error', 'none', 'stale', 'suppressed', 'valid', 'warn']);
    expect(OP_STATES.none.button).toBe('Generate');
    expect(OP_STATES.error.button).toBe('Retry');
    expect(OP_STATES.stale.button).toBe('Regenerate');
    expect(OP_STATES.stale.why).toMatch(/changed since/);
  });
});

describe('a row', () => {
  it('not generated -> grey dot, "Generate"', () => {
    const r = rowView(op('A', 'none'), {});
    expect(r.dot).toBe('none');
    expect(r.button).toEqual({ label: 'Generate', kind: '', disabled: false, action: 'generate' });
    expect(r.sub.map((p) => (p.bold || '') + p.text).join('')).toBe('3/16 flatnot generated');
  });
  it('generated -> green dot, "Regenerate", the last time when the add-in knows it', () => {
    const r = rowView(op('A', 'valid'), { durations: { 'k-A': 4.1 } });
    expect(r.dot).toBe('valid');
    expect(r.button.label).toBe('Regenerate');
    expect(r.sub.at(-1)).toEqual({ cls: 'valid', bold: 'generated', text: ' · 4.1 s' });
  });
  it('out of date (a tool or setting edited in Fusion) -> amber, "Regenerate", and the reason', () => {
    const r = rowView(op('A', 'stale'), {});
    expect(r.dot).toBe('stale');
    expect(r.sub.at(-1).bold).toBe('out of date');
    expect(r.sub.at(-1).text).toContain('changed');
  });
  it('error -> red dot, "Retry", Fusion\'s own words', () => {
    const r = rowView(op('A', 'error', { why: 'Out of memory.' }), {});
    expect(r.dot).toBe('error');
    expect(r.button.label).toBe('Retry');
    expect(r.sub.at(-1).text).toBe(' · Fusion says “Out of memory.”');
  });
  it('warning -> amber, still generated (its button regenerates)', () => {
    const r = rowView(op('A', 'warn', { why: 'Tool is too short.' }), {});
    expect(r.dot).toBe('warn');
    expect(r.button.label).toBe('Regenerate');
  });
  it('rest on shows next to the tool', () => {
    expect(rowView(op('B', 'none', { rest: true, tool: '1/8 flat' }), {}).sub[0].text).toBe('1/8 flat · rest on');
  });
  it('hand-added ops are tagged and still get a button; one that would double-cut the holes says so', () => {
    const r = rowView(op('Roughing6', 'valid', { src: 'hand', dup: true }), {});
    expect(r.tags).toEqual([{ cls: 'hand', text: 'hand-added' }]);
    expect(r.button.disabled).toBe(false);
    expect(r.sub.at(-1)).toEqual({ cls: 'warn', text: 'also cuts the holes' });
  });
  it('a suppressed op is tagged, greyed and has NO button (never generated from the list)', () => {
    const r = rowView(op('Old', 'suppressed', { src: 'hand' }), {});
    expect(r.suppressed).toBe(true);
    expect(r.button).toBe(null);
    expect(r.tags.map((t) => t.text)).toEqual(['hand-added', 'suppressed']);
  });
});

describe('a running generation: one at a time, with progress and a Stop', () => {
  const run = { on: true, setup: 'B-spline Back', key: 'k-A', name: 'A', elapsed: 102, percent: 58.5, queued: 1, next: 'k-B' };
  it('the running row shows elapsed time and percent and its button is Stop; every other button is disabled', () => {
    const a = rowView(op('A', 'none'), run), b = rowView(op('B', 'none'), run);
    expect(a.running).toBe(true);
    expect(a.dot).toBe('run');
    expect(a.button).toEqual({ label: 'Stop', kind: 'stop', disabled: false, action: 'stop' });
    expect(a.sub.at(-1)).toEqual({ cls: 'run', bold: 'generating', text: ' · 1 min 42 s · 59%' });
    expect(b.button.disabled).toBe(true);
  });
  it('the banner names the op, the clock and what is queued next; the group buttons are disabled', () => {
    const p = payload([{ name: 'B-spline Back', ops: [op('A', 'none'), op('B', 'none')] }], run);
    expect(bannerView(p)).toEqual({ idle: false, title: 'B-spline Back / A', line: '1 min 42 s · 1 queued · next: B', percent: 58.5 });
    const v = listView(p);
    expect(v.all.disabled).toBe(true);
    expect(v.groups[0].button.disabled).toBe(true);
  });
  it('after a run the add-in\'s last message stays as a note ("Stopped.", "Done.")', () => {
    expect(bannerView(payload([], { message: 'Stopped.' }))).toEqual({ idle: true, text: 'Stopped.' });
    expect(bannerView(payload([], {}))).toBe(null);
  });
});

describe('the counts', () => {
  const setups = [
    { name: 'Stock', ops: [] },
    { name: 'B-spline Back', ops: [op('a', 'valid'), op('b', 'stale'), op('c', 'none'), op('d', 'suppressed'), op('e', 'warn')] },
    { name: 'Frame', ops: [op('f', 'error')] },
  ];
  it('missing = no valid toolpath and not suppressed (none, stale, error); a warning is generated', () => {
    expect(missingCount(setups[1].ops)).toBe(2);
    expect(missingCount(setups[2].ops)).toBe(1);
  });
  it('the summary line and the buttons carry them', () => {
    expect(summaryText(setups)).toBe('2 of 6 generated · 1 out of date · 2 need a look');
    expect(summaryText([{ name: 'Stock', ops: [] }])).toBe('no operations yet');
    const v = listView(payload(setups));
    expect(v.all).toEqual({ label: 'Generate all missing (3)', disabled: false });
    expect(v.groups.map((g) => g.count)).toEqual(['no operations', '2/5 generated', '0/1 generated']);
    expect(v.groups[0].button).toBe(null);
    expect(v.groups[1].button).toEqual({ label: 'Generate missing (2)', disabled: false });
  });
  it('nothing missing -> the buttons are disabled', () => {
    const v = listView(payload([{ name: 'Back', ops: [op('a', 'valid')] }]));
    expect(v.all.disabled).toBe(true);
    expect(v.groups[0].button.disabled).toBe(true);
  });
  it('elapsed text', () => {
    expect(elapsedText(4.1)).toBe('4.1 s');
    expect(elapsedText(61)).toBe('1 min 1 s');
    expect(elapsedText(null)).toBe('');
  });
});

describe('painting: buttons send the add-in\'s actions; nothing in it is an input', () => {
  const setups = [{ name: 'B-spline Back', ops: [op('A', 'none'), op('B', 'valid'), op('Old', 'suppressed', { src: 'hand' })] }];
  const paint = (p) => { const root = document.createElement('div'); const sent = []; renderOpList(root, p, (a, d) => sent.push([a, d])); return { root, sent }; };

  it('a row\'s Generate sends its setup and key; the group button and Generate all send "missing"', () => {
    const { root, sent } = paint(payload(setups));
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Generate all missing (1)', 'Generate missing (1)', 'Generate', 'Regenerate']);
    buttons[0].click(); buttons[1].click(); buttons[2].click(); buttons[3].click();
    expect(sent).toEqual([
      ['generate_ops', { scope: 'missing', setup: null }],
      ['generate_ops', { scope: 'missing', setup: 'B-spline Back' }],
      ['generate_ops', { targets: [['B-spline Back', 'k-A']] }],
      ['generate_ops', { targets: [['B-spline Back', 'k-B']] }],
    ]);
  });
  it('while a generation runs the Stop buttons send stop_generate and the other buttons are disabled', () => {
    const { root, sent } = paint(payload(setups, { on: true, setup: 'B-spline Back', key: 'k-A', name: 'A', elapsed: 3, percent: 10, queued: 0 }));
    const stops = [...root.querySelectorAll('button.stop')];
    expect(stops.length).toBe(2);                       // the banner's and the running row's
    stops.forEach((b) => b.click());
    expect(sent).toEqual([['stop_generate', {}], ['stop_generate', {}]]);
    expect([...root.querySelectorAll('button:not(.stop)')].every((b) => b.disabled)).toBe(true);
  });
  it('the parts of a sub line read tool · state · note', () => {
    const { root } = paint(payload([{ name: 'Back', ops: [op('A', 'valid', { rest: true, src: 'hand', dup: true })] }], { durations: { 'k-A': 4.1 } }));
    expect(root.querySelector('.tp-sub').textContent).toBe('3/16 flat · rest on · generated · 4.1 s · also cuts the holes');
  });
  it('the painted list holds no input, select or textarea (Fred: no input fields in the CAM add-in)', () => {
    const { root } = paint(payload(setups));
    expect(root.querySelectorAll('input, select, textarea').length).toBe(0);
  });
});

describe('the palette wiring', () => {
  it('has the Toolpaths card, loads the module, paints op_states and asks for them on boot, focus, a poll and a report', () => {
    expect(PALETTE).toContain('<section class="tp-card" id="toolpaths-card"');
    expect(PALETTE).toContain('<script type="module" src="./cam-op-list.js"></script>');
    expect(PALETTE).toMatch(/action === 'op_states'\) \{ paintOpList\(payload\); return; \}/);
    expect(PALETTE).toMatch(/send\('get_op_states'\);\s+\/\/ the Toolpaths list the same way/);
    expect(PALETTE).toMatch(/window\.addEventListener\('focus', pollOpStates\)/);
    expect(PALETTE).toMatch(/setInterval\(pollOpStates, \d+\)/);
    expect(PALETTE).toMatch(/send\('get_op_states'\); \/\/ a BUILD \/ APPLY changed the operations/);
  });
  it('no field anywhere in the Toolpaths card or its module', () => {
    const card = PALETTE.slice(PALETTE.indexOf('<section class="tp-card"'), PALETTE.indexOf('</section>', PALETTE.indexOf('<section class="tp-card"')));
    expect(card).not.toMatch(/<(input|select|textarea)/i);
    expect(MODULE).not.toMatch(/createElement\(['"](input|select|textarea)/);
    expect(MODULE).not.toMatch(/el\(doc, '(input|select|textarea)'/);
  });
});
