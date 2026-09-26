/**
 * FORMULA-FIELDS (R1) — core/formula.js (the safe parser) and core/formula-field.js (the input binder).
 *
 * The binder tests drive a real <input> in happy-dom: a listener registered the way bind() registers it
 * (parseFloat on input + change) stands in for the field's existing handler, so "existing handlers run unchanged"
 * is checked from the handler's point of view.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluate, tokenize, namesMatching, findName, isPlainNumber, FORMULA_ERRORS,
} from '../bspline-frame-builder/b-spline-gen/html/core/formula.js';
import {
  attachFormula, wordAtCaret, isFormulaField, clampToField, declaredRange,
} from '../bspline-frame-builder/b-spline-gen/html/core/formula-field.js';
import {
  FORMULA_FIELDS, FORMULA_SECTIONS, STOCK_SCOPE,
} from '../bspline-frame-builder/b-spline-gen/html/main/formula-fields.js';
import { P, INPUT_PAIRS } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const SCOPE = [
  { name: 'width', label: 'Width', get: () => 6, unit: '"' },
  { name: 'height', label: 'Height', get: () => 4, unit: '"' },
  { name: 'stroke', get: () => 0.25 },
  { name: 'count', get: () => 5 },
];
const val = (src, scope = SCOPE) => {
  const r = evaluate(src, scope);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.value;
};
const err = (src, scope = SCOPE) => {
  const r = evaluate(src, scope);
  expect(r.ok).toBe(false);
  return r;
};

describe('formula parser', () => {
  it('numbers and decimals', () => {
    expect(val('7')).toBe(7);
    expect(val('7.5')).toBe(7.5);
    expect(val('.25')).toBe(0.25);
    expect(val('3.')).toBe(3);
    expect(val('  2  ')).toBe(2);
  });
  it('precedence: * / bind tighter than + -, left-associative', () => {
    expect(val('1 + 2 * 3')).toBe(7);
    expect(val('10 - 4 - 3')).toBe(3);
    expect(val('8 / 4 / 2')).toBe(1);
    expect(val('2 * 3 + 4 * 5')).toBe(26);
    expect(val('1 - 6 / 3')).toBe(-1);
  });
  it('parentheses', () => {
    expect(val('(1 + 2) * 3')).toBe(9);
    expect(val('((2))')).toBe(2);
    expect(val('2 * (3 + (4 - 1)) / 3')).toBe(4);
  });
  it('unary minus / plus', () => {
    expect(val('-3')).toBe(-3);
    expect(val('--3')).toBe(3);
    expect(val('2 * -3')).toBe(-6);
    expect(val('-(1 + 2)')).toBe(-3);
    expect(val('+4')).toBe(4);
    expect(val('-width / 2')).toBe(-3);
  });
  it('names, case-insensitive', () => {
    expect(val('width')).toBe(6);
    expect(val('WIDTH - Height')).toBe(2);
    expect(val('height/2 - stroke/2')).toBe(1.875);
    expect(val('(width - 2*stroke) / (count - 1)')).toBeCloseTo(1.375);
  });
  it('names read their CURRENT value at evaluation time', () => {
    let w = 6;
    const scope = [{ name: 'w', get: () => w }];
    expect(val('w*2', scope)).toBe(12);
    w = 10;
    expect(val('w*2', scope)).toBe(20);
  });

  it('error: empty', () => {
    expect(err('').code).toBe(FORMULA_ERRORS.EMPTY);
    expect(err('   ').code).toBe(FORMULA_ERRORS.EMPTY);
  });
  it('error: unknown name (with its position)', () => {
    const r = err('2 + wdth');
    expect(r.code).toBe(FORMULA_ERRORS.UNKNOWN_NAME);
    expect(r.pos).toBe(4);
    expect(r.error).toMatch(/wdth/);
  });
  it('error: division by zero (literal and computed)', () => {
    expect(err('1/0').code).toBe(FORMULA_ERRORS.DIV_ZERO);
    expect(err('width / (height - 4)').code).toBe(FORMULA_ERRORS.DIV_ZERO);
  });
  it('error: trailing junk', () => {
    const r = err('2 3');
    expect(r.code).toBe(FORMULA_ERRORS.TRAILING);
    expect(r.pos).toBe(2);
    expect(err('(1+2))').code).toBe(FORMULA_ERRORS.TRAILING);
  });
  it('error: bad character', () => {
    const r = err('2 ^ 3');
    expect(r.code).toBe(FORMULA_ERRORS.BAD_CHAR);
    expect(r.pos).toBe(2);
    expect(err('width; alert(1)').code).toBe(FORMULA_ERRORS.BAD_CHAR);
  });
  it('error: unexpected token / dangling operator', () => {
    expect(err('2 +').code).toBe(FORMULA_ERRORS.UNEXPECTED);
    expect(err('* 2').code).toBe(FORMULA_ERRORS.UNEXPECTED);
    expect(err('()').code).toBe(FORMULA_ERRORS.UNEXPECTED);
  });
  it('error: missing close paren', () => {
    const r = err('(1 + 2');
    expect(r.code).toBe(FORMULA_ERRORS.MISSING_PAREN);
    expect(r.pos).toBe(6);
  });
  it('error: a declared name without a finite value', () => {
    expect(err('x', [{ name: 'x', get: () => NaN }]).code).toBe(FORMULA_ERRORS.BAD_NAME_VALUE);
  });
  it('JS-looking input is just text, never executed', () => {
    for (const src of ['constructor', 'this', 'globalThis', 'width.constructor', '__proto__', 'Math.PI']) {
      expect(evaluate(src, SCOPE).ok).toBe(false);
    }
  });

  it('tokenize positions', () => {
    expect(tokenize('a+12.5').map((t) => [t.t, t.v, t.pos])).toEqual([
      ['name', 'a', 0], ['op', '+', 1], ['num', 12.5, 2], ['end', null, 6],
    ]);
  });
  it('namesMatching filters the SAME declaration by prefix, case-insensitive, in order', () => {
    expect(namesMatching(SCOPE, 'h').map((d) => d.name)).toEqual(['height']);
    expect(namesMatching(SCOPE, 'S').map((d) => d.name)).toEqual(['stroke']);
    expect(namesMatching(SCOPE, '').map((d) => d.name)).toEqual(['width', 'height', 'stroke', 'count']);
    expect(namesMatching(SCOPE, 'zz')).toEqual([]);
    expect(findName(SCOPE, 'HeIgHt').name).toBe('height');
  });
  it('isPlainNumber', () => {
    for (const s of ['7', '7.5', '.5', '7.', '-3', ' 2 ', '+1']) expect(isPlainNumber(s), s).toBe(true);
    for (const s of ['', '-', '.', '7+1', 'w', '1e3', '(2)']) expect(isPlainNumber(s), s).toBe(false);
  });
});

describe('no eval path (static)', () => {
  const root = resolve(__dirname, '../bspline-frame-builder/b-spline-gen/html');
  for (const rel of ['core/formula.js', 'core/formula-field.js', 'main/formula-fields.js']) {
    it(`${rel} contains no eval( / new Function / Function(`, () => {
      // Strip comments so the doc text describing the rule doesn't trip it.
      const src = readFileSync(resolve(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(src).not.toMatch(/\beval\s*\(/);
      expect(src).not.toMatch(/new\s+Function\b/);
      expect(src).not.toMatch(/\bFunction\s*\(/);
      expect(src).not.toMatch(/setTimeout\s*\(\s*['"`]/);
    });
  }
});

describe('formula field binder', () => {
  let input, applied, changes;

  const type = (text) => {
    input.value = text;
    try { input.setSelectionRange(text.length, text.length); } catch { /* ignore */ }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (k) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    return e;
  };
  const dropdown = () => document.querySelector('.formula-dropdown');
  const preview = () => document.querySelector('.formula-preview');

  beforeEach(() => {
    document.body.innerHTML = '<div class="cad-stepper"><input type="number" id="f" value="7" step="any" min="0.1" max="96"></div>';
    input = document.getElementById('f');
    applied = [];
    changes = 0;
    // The field's EXISTING handler, shaped like core/ui-utils.js bind(): parseFloat on input and change.
    input.addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) applied.push(v); });
    input.addEventListener('change', () => { changes++; });
    attachFormula(input, SCOPE);
    input.focus();
  });

  it('switches a number input to text, keeps min/max/step', () => {
    expect(input.type).toBe('text');
    expect(input.getAttribute('max')).toBe('96');
    expect(isFormulaField(input)).toBe(true);
  });

  it('plain numbers behave exactly as today (events pass straight through)', () => {
    type('8');
    type('8.5');
    expect(applied).toEqual([8, 8.5]);
    expect(preview()).toBeNull();
    expect(key('Enter').defaultPrevented).toBe(false);
  });

  it('a half-typed formula never reaches the existing handler', () => {
    type('7');
    type('7+');
    type('7+1');
    expect(applied).toEqual([7]);          // "7+1" is NOT applied as 7
    expect(preview().textContent).toBe('= 8');
  });

  it('Enter commits the NUMBER and fires input + change', () => {
    type('width*2 - 1');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(input.value).toBe('11');
    expect(applied).toEqual([11]);
    expect(changes).toBe(1);
    expect(preview()).toBeNull();
  });

  it('blur (native change) with a formula commits too', () => {
    type('height/4');
    input.dispatchEvent(new Event('change', { bubbles: true }));   // what the browser fires on blur
    expect(input.value).toBe('1');
    expect(applied).toEqual([1]);
    expect(changes).toBe(1);                // only the committed change reached the handler
  });

  it('bad formula: inline error, old value kept, handler never called', () => {
    type('wdth/2');
    key('Enter');
    expect(applied).toEqual([]);
    expect(changes).toBe(0);
    expect(preview().classList.contains('is-error')).toBe(true);
    expect(preview().textContent).toMatch(/unknown name "wdth".*kept 7/);
    expect(input.value).toBe('wdth/2');     // Enter: text stays so it can be fixed
    input.dispatchEvent(new Event('change', { bubbles: true }));    // then blur
    expect(input.value).toBe('7');          // blur: reverts to the last good value
    expect(applied).toEqual([]);
    expect(changes).toBe(0);
  });

  it('division by zero is an error, not Infinity', () => {
    type('1/(width-6)');
    key('Enter');
    expect(preview().textContent).toMatch(/division by zero/);
    expect(applied).toEqual([]);
  });

  it('typing letters opens the dropdown of matching DECLARED names with current values', () => {
    type('h');
    const items = [...dropdown().querySelectorAll('li')];
    expect(items.map((li) => li.dataset.name)).toEqual(['height']);
    expect(items[0].textContent).toBe('height4.000"');
    expect(preview().textContent).toBe('= …');                 // mid-name is not shown as an error
    expect(preview().classList.contains('is-error')).toBe(false);
    type('');
    type('2*');
    expect(dropdown()).toBeNull();          // no word at the caret -> no dropdown
    type('2*w');
    expect([...dropdown().querySelectorAll('li')].map((li) => li.dataset.name)).toEqual(['width']);
  });

  it('arrows move, Enter inserts the active name (does not commit)', () => {
    type('(c');
    expect([...dropdown().querySelectorAll('li')].map((li) => li.dataset.name)).toEqual(['count']);
    const scope2 = [{ name: 'wa', get: () => 1 }, { name: 'wb', get: () => 2 }];
    attachFormula(input, scope2);           // idempotent re-attach just swaps the scope
    type('3*w');
    expect([...dropdown().querySelectorAll('li')].map((li) => li.dataset.name)).toEqual(['wa', 'wb']);
    key('ArrowDown');
    expect(dropdown().querySelector('li.is-active').dataset.name).toBe('wb');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(input.value).toBe('3*wb');
    expect(dropdown()).toBeNull();
    expect(applied).toEqual([]);            // inserting is not committing
    expect(preview().textContent).toBe('= 6');
    key('Enter');                           // now Enter commits
    expect(input.value).toBe('6');
    expect(applied).toEqual([6]);
  });

  it('Tab inserts; Esc closes without inserting', () => {
    type('wi');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(input.value).toBe('width');
    type('width+h');
    expect(dropdown()).not.toBeNull();
    key('Escape');
    expect(dropdown()).toBeNull();
    expect(input.value).toBe('width+h');
  });

  it('tap/click on an item inserts it and keeps focus (mousedown swallowed)', () => {
    type('he');
    const li = dropdown().querySelector('li');
    const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    li.dispatchEvent(md);
    expect(md.defaultPrevented).toBe(true);
    li.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(input.value).toBe('height');
  });

  it('a fully typed name does not keep the dropdown open (Enter commits)', () => {
    type('width');
    expect(dropdown()).toBeNull();
    key('Enter');
    expect(applied).toEqual([6]);
  });

  it('attaching twice is harmless (one binding, one commit)', () => {
    attachFormula(input, SCOPE);
    attachFormula(input, SCOPE);
    type('width/2');
    key('Enter');
    expect(applied).toEqual([3]);
    expect(changes).toBe(1);
    expect(document.querySelectorAll('#formula-field-style').length).toBe(1);
  });

  it('wordAtCaret', () => {
    expect(wordAtCaret('2*wid', 5)).toEqual({ start: 2, prefix: 'wid' });
    expect(wordAtCaret('2*wid+1', 5)).toEqual({ start: 2, prefix: 'wid' });
    expect(wordAtCaret('2*', 2)).toBeNull();
  });
});

describe('range: a formula result is clamped to the declared min/max (R2 item 1)', () => {
  let input, applied;
  const type = (text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const enter = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const preview = () => document.querySelector('.formula-preview')?.textContent || '';
  const mount = (attrs) => {
    document.body.innerHTML = `<input type="number" id="r" value="7" ${attrs}>`;
    input = document.getElementById('r');
    applied = [];
    input.addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) applied.push(v); });
    attachFormula(input, SCOPE);
  };

  it('declaredRange reads min/max attributes; blank/missing = unbounded', () => {
    mount('min="0.1" max="96"');
    expect(declaredRange(input)).toEqual([0.1, 96]);
    mount('min="" ');
    expect(declaredRange(input)).toEqual([-Infinity, Infinity]);
    expect(clampToField(input, -1e9)).toEqual({ value: -1e9, bound: null });
  });
  it('above max -> committed as max, shown while typing and after commit', () => {
    mount('min="0.1" max="96"');
    type('width*20');
    expect(preview()).toBe('= 120 → 96 (max)');
    expect(applied).toEqual([]);
    enter();
    expect(input.value).toBe('96');
    expect(applied).toEqual([96]);
    expect(preview()).toMatch(/120 clamped to 96 \(max\)/);
  });
  it('below min -> committed as min', () => {
    mount('min="0.1" max="96"');
    type('width-10');
    enter();
    expect(input.value).toBe('0.1');
    expect(applied).toEqual([0.1]);
  });
  it('negative results allowed where min is negative', () => {
    mount('min="-0.45" max="0.45"');
    type('-stroke');
    enter();
    expect(applied).toEqual([-0.25]);
    type('-width');
    enter();
    expect(applied).toEqual([-0.25, -0.45]);
  });
  it('in range -> unchanged; no bounds -> unchanged', () => {
    mount('min="0.1" max="96"');
    type('width+1'); enter();
    expect(applied).toEqual([7]);
    mount('');
    type('width*100'); enter();
    expect(applied).toEqual([600]);
  });
  it('plain typed numbers are NOT clamped by the binder (behave as today)', () => {
    mount('min="0.1" max="96"');
    type('200');
    expect(applied).toEqual([200]);
    expect(input.value).toBe('200');
  });
});

describe('declared formula fields (R1 item 5 + R2 item 2)', () => {
  const html = readFileSync(resolve(__dirname, '../bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html'), 'utf8');
  // Only the markup matters here — drop <link>/<script> so happy-dom doesn't try to fetch them.
  const doc = new DOMParser().parseFromString(
    html.replace(/<link\b[^>]*>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, ''), 'text/html');
  const pKeyFor = (id) => Object.keys(P).find((k) => (INPUT_PAIRS[k] || k) === id);

  it('stock scope + stock section', () => {
    expect(STOCK_SCOPE.map((d) => d.name)).toEqual(['width', 'height', 'depth']);
    expect(FORMULA_SECTIONS[0].ids).toEqual(['widthIn', 'heightIn', 'carveZ']);
  });
  it('every declared field is a sidebar number input on the bind()->applyParam path (a P key)', () => {
    expect(FORMULA_FIELDS.length).toBeGreaterThan(20);
    for (const { id, section } of FORMULA_FIELDS) {
      const el = doc.getElementById(id);
      expect(el, id).not.toBeNull();
      expect(el.getAttribute('type'), id).toBe('number');
      expect(pKeyFor(id), `${id} has no P key`).toBeTruthy();
      const hdr = el.closest('.panel')?.querySelector('.panel-header')?.textContent || '';
      expect(hdr, id).toContain(section);
    }
  });
  it('never declares the excluded fields (seed id, FRAME, stamp transform, lattice/editor)', () => {
    const ids = FORMULA_FIELDS.map((f) => f.id);
    for (const bad of ['seed', 'frameBottomZ', 'stampTx', 'stampTy', 'stampRotation', 'stampScale',
      'sculptTopHardness', 'sculptBotHardness']) expect(ids).not.toContain(bad);
    expect(ids.filter((id) => /^(lattice|shapeLattice|editor|skel)/.test(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('each section scope = stock names + its own, unique names, every name reads a finite P value', () => {
    for (const s of FORMULA_SECTIONS) {
      const names = s.scope.map((d) => d.name);
      expect(names.slice(0, 3)).toEqual(['width', 'height', 'depth']);
      expect(new Set(names).size, s.section).toBe(names.length);
      for (const d of s.scope) expect(Number.isFinite(d.get()), `${s.section}.${d.name}`).toBe(true);
    }
  });
  it('a section scope evaluates against live P', () => {
    const stamp = FORMULA_SECTIONS.find((s) => s.section === 'VECTOR STAMPING').scope;
    expect(evaluate('plunge * 2', stamp)).toEqual({ ok: true, value: P.stampDepth * 2 });
    expect(evaluate('angle / 2', stamp).value).toBe(P.stampVBitAngle / 2);
  });
});
