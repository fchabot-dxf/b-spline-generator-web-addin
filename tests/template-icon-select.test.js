/**
 * advisor turn 203 (Fred's rule): the frame template picker is an ICON dropdown -- icons drawn by the frame
 * engine from each template's own outline (editor/frame-template-icon.js), icons only in the list, the name
 * as the tooltip (main/icon-select.js over the <select>, which stays the source of truth).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { templateIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-template-icon.js';
import { mountIconSelect, refreshIconSelect, mountIconGrid, PICKER_TILE } from '../bspline-frame-builder/b-spline-gen/html/main/icon-select.js';

const offered = FRAME_DEFS.templates.filter((t) => !t.hidden);

describe('templateIconSvg (engine-drawn)', () => {
  it('every offered template gets an icon: one even-odd path from its own outline', () => {
    for (const t of offered) {
      const svg = templateIconSvg(FRAME_DEFS, t.id);
      expect(svg, t.id).toMatch(/^<svg[^>]*viewBox="0 0 7 9"/);
      expect(svg, t.id).toMatch(/<path d="M [^"]+" fill="#b07a4a" fill-rule="evenodd"/);
    }
  });
  it('different templates draw different icons; none/unknown = no icon', () => {
    const paths = new Set(offered.map((t) => templateIconSvg(FRAME_DEFS, t.id)));
    expect(paths.size).toBe(offered.length);
    expect(templateIconSvg(FRAME_DEFS, '')).toBe(null);
    expect(templateIconSvg(FRAME_DEFS, 'no_such_template')).toBe(null);
  });
});

describe('mountIconSelect over a <select>', () => {
  let root, sel, changes;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    sel = document.createElement('select');
    for (const [v, t] of [['', 'None'], ['template_1', '1. Hourglass'], ['template_2', '2. Something']]) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o);
    }
    root.appendChild(sel);
    changes = vi.fn();
    sel.addEventListener('change', changes);
    mountIconSelect(sel, { iconFor: (v) => (v ? `<svg data-icon="${v}"></svg>` : null), label: 'Frame template' });
  });
  afterEach(() => root.remove());
  const button = () => root.querySelector('.icon-select-button');
  const options = () => [...root.querySelectorAll('.icon-select-option')];

  it('the select is hidden but kept; the button shows the current option', () => {
    expect(sel.style.display).toBe('none');
    expect(button().textContent).toContain('None');
    sel.value = 'template_1';
    refreshIconSelect(sel);
    expect(button().querySelector('[data-icon="template_1"]')).not.toBeNull();
    expect(button().title).toBe('Frame template: 1. Hourglass');
  });
  it('the list: one button per option, icon only, the NAME as tooltip', () => {
    button().click();
    expect(options().map((b) => b.title)).toEqual(['None', '1. Hourglass', '2. Something']);
    const t1 = options()[1];
    expect(t1.querySelector('[data-icon="template_1"]')).not.toBeNull();
    expect(t1.textContent.trim()).toBe(''); // no visible name text, only the icon
  });
  it('turn 207: the open grid is FIXED under its button (an overflow:hidden parent -- the sidebar -- clipped it); a scroll closes it', () => {
    const btn = button();
    btn.getBoundingClientRect = () => ({ left: 30, right: 70, top: 100, bottom: 140, width: 40, height: 40, x: 30, y: 100 });
    btn.click();
    const grid = root.querySelector('.icon-select-grid');
    expect(grid.style.position).toBe('fixed');
    expect(grid.style.top).toBe('140px');
    expect(grid.style.left).toBe('30px');
    window.dispatchEvent(new Event('scroll'));
    expect(grid.style.display).toBe('none');
  });
  it('a pick sets the select and fires its own change, exactly once', () => {
    button().click();
    options()[2].click();
    expect(sel.value).toBe('template_2');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.icon-select-grid').style.display).toBe('none');
    button().click();
    options()[2].click(); // the same value again: no change
    expect(changes).toHaveBeenCalledTimes(1);
  });
});

describe('turn 207: a select inside a .cad-nested-input (the sidebar) mounts its dropdown AFTER that box', () => {
  it('the 24px overflow-hidden box would clip the 40px button: the wrap is its next sibling and the box hides', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="cad-nested-input" style="margin-bottom:12px"><select><option value="a">A</option></select></div>';
    document.body.appendChild(root);
    const host = root.querySelector('.cad-nested-input');
    const wrap = mountIconSelect(root.querySelector('select'), { iconFor: () => null, label: 'X' });
    expect(host.nextElementSibling).toBe(wrap);
    expect(host.contains(wrap)).toBe(false);
    expect(host.style.display).toBe('none');
    expect(wrap.style.marginBottom).toBe('12px');
    root.remove();
  });
});

// Redesign phase 1 (Fred): the sidebar Brick rows reuse THIS picker with three declared options.
describe('mountIconSelect options: optionId, pickSame, tilePx / columns', () => {
  const make = (opts) => {
    document.body.innerHTML = '<select id="s"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>';
    const sel = document.getElementById('s');
    const picks = [];
    sel.addEventListener('change', () => picks.push(sel.value));
    const wrap = mountIconSelect(sel, { iconFor: () => '<svg></svg>', label: 'L', ...opts });
    return { sel, picks, wrap, grid: wrap.querySelector('.icon-select-grid'), button: wrap.querySelector('.icon-select-button') };
  };
  it('optionId: the grid is built at mount, its items carry the ids, and stay the same elements across opens', () => {
    const { grid, button } = make({ optionId: (v) => 'opt_' + v });
    expect([...grid.children].map((b) => b.id)).toEqual(['opt_a', 'opt_b', 'opt_c']);
    const first = document.getElementById('opt_b');
    button.click(); button.click();
    expect(document.getElementById('opt_b')).toBe(first); // kept, so state set on it by id survives
  });
  it('pickSame: picking the current option still dispatches change (without it, it does not)', () => {
    const a = make({ optionId: (v) => 'opt_' + v, pickSame: true });
    document.getElementById('opt_a').click();
    expect(a.picks).toEqual(['a']);
    const b = make({ optionId: (v) => 'opt_' + v });
    document.getElementById('opt_a').click();
    expect(b.picks).toEqual([]);
  });
  it('tilePx / columns { phone, desktop }: the grid takes the declared size and the column count for the viewport', () => {
    const { grid, button } = make({ tilePx: 80, columns: { phone: 3, desktop: 4 } });
    window.innerWidth = 390; button.click();
    expect(grid.style.gridTemplateColumns).toBe('repeat(3, 80px)');
    expect(parseFloat(grid.children[0].style.width)).toBe(80);
    button.click(); window.innerWidth = 1280; button.click();
    expect(grid.style.gridTemplateColumns).toBe('repeat(4, 80px)');
  });
});

// Fred (the editor's Brick tabs on a phone): the SAME picker over a container of existing option buttons -- the renderers
// keep their buttons (ids, handlers, the sync code's active state); mountIconGrid turns the container into the grid.
describe('mountIconGrid: the picker over existing option buttons', () => {
  const setup = () => {
    document.body.innerHTML = '<div id="row"><div id="list">'
      + '<button id="opt_a" title="Alpha" aria-label="Alpha"><svg width="30" height="30"></svg></button>'
      + '<button id="opt_b" class="active" title="Beta" aria-label="Beta"><svg width="30" height="30"></svg></button>'
      + '<button id="opt_c" title="Gamma" aria-label="Gamma">C</button></div></div>';
    const picks = [];
    for (const id of ['opt_a', 'opt_b', 'opt_c']) document.getElementById(id).addEventListener('click', () => picks.push(id));
    const wrap = mountIconGrid(document.getElementById('list'), { label: 'Thing' });
    return { picks, wrap, grid: document.getElementById('list'), chip: wrap.querySelector('.icon-select-button'), name: wrap.querySelector('.icon-select-name') };
  };
  it('one chip showing the ACTIVE option (its icon) and its name; the options are the closed grid, kept with their ids', () => {
    const { wrap, grid, chip, name } = setup();
    expect(grid.parentElement).toBe(wrap);
    expect(chip.querySelector('svg')).not.toBeNull();
    expect(name.textContent).toBe('Beta');
    expect(chip.title).toBe('Thing: Beta');
    expect(grid.style.display).toBe('none');
    expect(parseFloat(document.getElementById('opt_a').style.width)).toBe(PICKER_TILE.tilePx);
  });
  it('the chip opens the grid; a pick runs the option\'s own handler and closes it', () => {
    const { picks, grid, chip } = setup();
    chip.click();
    expect(grid.style.display).toBe('grid');
    document.getElementById('opt_c').click();
    expect(picks).toEqual(['opt_c']);
    expect(grid.style.display).toBe('none');
  });
  it('the chip follows the active option when the panel\'s sync moves it', async () => {
    const { name } = setup();
    document.getElementById('opt_b').classList.remove('active');
    document.getElementById('opt_c').classList.add('active');
    await new Promise((r) => setTimeout(r, 0));
    expect(name.textContent).toBe('Gamma');
  });

  // the convergence (advisor 2026-10-14): main's hand-rolled popovers folded in -- their ids and behaviours, declared here
  it('ids: the wrap, chip and name take the declared ids of a picker', () => {
    document.body.innerHTML = '<div id="row"><div id="list2"><button id="o1" title="One" class="active">1</button></div></div>';
    mountIconGrid(document.getElementById('list2'), { label: 'X', ids: { wrap: 'xWrap', chip: 'xChip', name: 'xName' } });
    expect(document.getElementById('xWrap').classList.contains('icon-grid-picker')).toBe(true);
    expect(document.getElementById('xChip').classList.contains('icon-select-button')).toBe(true);
    expect(document.getElementById('xName').textContent).toBe('One');
  });
  it('a pick shows on the chip AT ONCE (no observer tick) and closes the grid; the name opens the grid too', () => {
    const { grid, chip, name } = setup();
    name.click();
    expect(grid.style.display).not.toBe('none');
    const c = document.getElementById('opt_c'); // B is active: picking C must show on the chip in the same tick
    c.addEventListener('click', () => { for (const o of grid.querySelectorAll('button')) o.classList.toggle('active', o === c); });
    c.click();
    expect(name.textContent).toBe('Gamma');
    expect(chip.title).toBe('Thing: Gamma');
    expect(grid.style.display).toBe('none');
  });
  it('preferActive: with two options active, the chip shows the preferred one (a saved pattern over its bond)', () => {
    document.body.innerHTML = '<div id="row"><div id="list3"><button id="bond" title="Bond" class="active">b</button>'
      + '<button id="mine" title="Mine" class="active user">m</button></div></div>';
    mountIconGrid(document.getElementById('list3'), { label: 'P', preferActive: '.user', ids: { name: 'pName' } });
    expect(document.getElementById('pName').textContent).toBe('Mine');
  });
});
