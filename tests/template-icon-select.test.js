/**
 * advisor turn 203 (Fred's rule): the frame template picker is an ICON dropdown -- icons drawn by the frame
 * engine from each template's own outline (editor/frame-template-icon.js), icons only in the list, the name
 * as the tooltip (main/icon-select.js over the <select>, which stays the source of truth).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { templateIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-template-icon.js';
import { mountIconSelect, refreshIconSelect } from '../bspline-frame-builder/b-spline-gen/html/main/icon-select.js';

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
