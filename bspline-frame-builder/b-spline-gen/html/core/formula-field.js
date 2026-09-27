/**
 * formula-field.js — FORMULA-FIELDS (R1): the ONE binder that turns a number <input> into a formula field.
 *
 *   attachFormula(input, scope)   scope = a declaration [{ name, label?, get, unit? }] (see core/formula.js),
 *                                 or a function returning one (read fresh on every use).
 *
 * Contract (the field's existing handlers run UNCHANGED):
 * - Plain numbers behave exactly as before: their input/change events pass straight through.
 * - While the text is a FORMULA (anything that isn't a plain number), the raw input/change events are held back
 *   from the field's own listeners (a document-level CAPTURE listener stops them before they reach the input), so
 *   bind()'s parseFloat never applies a half-typed "7+1" as 7. A live "= result" preview shows beside the field.
 * - Enter or blur COMMITS: the formula is evaluated, the NUMBER is written back into the field, and ordinary
 *   'input' + 'change' events are fired — so the existing handlers see a plain number, as if typed.
 * - A bad formula shows an inline error and keeps the old value (Enter: the text stays for fixing; blur: the text
 *   reverts to the last good value). No events reach the field's handlers.
 * - Typing letters opens a dropdown of the declared names matching the word at the caret, each with its CURRENT
 *   value; ArrowUp/Down move, Enter/Tab insert, Esc closes, tap/click inserts (mousedown is swallowed so the
 *   field keeps focus on mobile).
 * - RANGE (R2): a formula RESULT is CLAMPED to the field's declared min/max attributes (the same attributes the
 *   ± steppers clamp to), and the clamp is shown ("= 200 → 96 (max)" while typing, a short note after commit).
 *   Clamp, not reject: it is what the field already does for a plain typed 200 in Stock Width (applyParam clamps)
 *   and for the steppers, so one rule covers every way of entering a value. Plain typed numbers are untouched.
 * - Idempotent: attaching twice keeps one binding (the second call just replaces the scope).
 *
 * type="number" inputs cannot hold "width/2", so they are switched to type="text" (min/max/step attributes stay,
 * the steppers keep reading them). No inputmode is set: a decimal keypad has no letters, so names could not be
 * typed on mobile.
 */
import { evaluate, isPlainNumber, namesMatching } from './formula.js';

const _fields = new WeakMap();      // input -> field state
const _hookedDocs = new WeakSet();  // documents with the capture listener installed

const STYLE_ID = 'formula-field-style';
const CSS = `
.formula-preview{position:fixed;z-index:10050;font:11px/1.4 var(--cad-font-family,sans-serif);padding:1px 6px;
  border-radius:var(--cad-radius-md,4px);background:var(--cad-bg-secondary,#f3f3f3);color:var(--cad-text-muted,#666);
  border:1px solid var(--cad-border-standard,#ddd);pointer-events:none;white-space:nowrap}
.formula-preview.is-error{color:#c62828;border-color:#e57373;background:#fdecea}
.formula-dropdown{position:fixed;z-index:10051;margin:0;padding:2px 0;list-style:none;min-width:140px;max-height:220px;
  overflow:auto;background:var(--cad-bg-standard,#fff);border:1px solid var(--cad-border-standard,#ddd);
  border-radius:var(--cad-radius-md,4px);box-shadow:0 4px 14px rgba(0,0,0,.18);font:12px/1.2 var(--cad-font-family,sans-serif)}
.formula-dropdown li{display:flex;justify-content:space-between;gap:14px;padding:7px 10px;cursor:pointer;color:var(--cad-text-main,#333)}
.formula-dropdown li.is-active,.formula-dropdown li:hover{background:var(--cad-accent-blue,#0696D7);color:#fff}
.formula-dropdown .formula-val{font-variant-numeric:tabular-nums;opacity:.8}
`;

function injectStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

/** Format a value for the preview/dropdown (3 decimals, trailing zeros kept like the rest of the UI's inches). */
export function formatValue(v, unit = '') {
  return Number.isFinite(v) ? `${v.toFixed(3)}${unit}` : '—';
}

/** The identifier fragment ending at `caret` ({ start, prefix }) or null — what the dropdown filters by. */
export function wordAtCaret(text, caret) {
  const m = String(text).slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_]*$/);
  return m ? { start: caret - m[0].length, prefix: m[0] } : null;
}

/** F15: the popup's left edge — under the field, but kept inside the viewport (MEASURED: on a 390 px phone the
 *  stamp transform's dropdown ran off the right edge, hiding the values). */
export function popupLeft(fieldLeft, popupWidth, viewportWidth, margin = 4) {
  return Math.max(margin, Math.min(fieldLeft, viewportWidth - popupWidth - margin));
}

/** The input's declared [min, max] (missing/blank attribute = unbounded). */
export function declaredRange(input) {
  const read = (attr, dflt) => {
    const raw = input.getAttribute(attr);
    const n = raw == null || raw.trim() === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : dflt;
  };
  return [read('min', -Infinity), read('max', Infinity)];
}

/** Clamp `v` into the input's declared range: { value, bound: null | 'min' | 'max' }. */
export function clampToField(input, v) {
  const [lo, hi] = declaredRange(input);
  if (v < lo) return { value: lo, bound: 'min' };
  if (v > hi) return { value: hi, bound: 'max' };
  return { value: v, bound: null };
}

function onCaptured(e) {
  const st = _fields.get(e.target);
  if (!st) return;
  const text = e.target.value;
  if (isPlainNumber(text) || !text.trim()) {
    // Plain number (or empty, which bind() already ignores): behave exactly as today.
    if (e.type === 'input') { st.hidePreview(); st.closeDropdown(); }
    else if (isPlainNumber(text)) st.lastGood = text;
    return;
  }
  e.stopPropagation();
  if (e.type === 'input') st.onFormulaInput();
  else st.commit({ revertOnError: true });   // native change = blur with a formula in the field
}

function hookDocument(doc) {
  if (_hookedDocs.has(doc)) return;
  _hookedDocs.add(doc);
  doc.addEventListener('input', onCaptured, true);
  doc.addEventListener('change', onCaptured, true);
}

export function attachFormula(input, scope) {
  if (!input) return null;
  const existing = _fields.get(input);
  if (existing) { existing.scope = scope; return existing.api; }

  const doc = input.ownerDocument;
  injectStyle(doc);
  hookDocument(doc);
  if (input.type === 'number') { input.dataset.formulaOrigType = 'number'; input.type = 'text'; }
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.dataset.formula = 'on';

  const st = {
    scope,
    lastGood: input.value,
    preview: null,
    dropdown: null,
    items: [],
    active: 0,
  };
  const decl = () => (typeof st.scope === 'function' ? st.scope() : st.scope) || [];

  const place = (el, below) => {
    const r = input.getBoundingClientRect();
    const vw = doc.defaultView?.innerWidth || doc.documentElement.clientWidth || Infinity;
    el.style.left = `${Math.round(popupLeft(r.left, el.offsetWidth || 0, vw))}px`;
    el.style.top = `${Math.round(r.bottom + (below || 0) + 2)}px`;
  };

  st.showPreview = (text, isError) => {
    if (!st.preview) {
      st.preview = doc.createElement('div');
      st.preview.className = 'formula-preview';
      st.preview.setAttribute('aria-live', 'polite');
      doc.body.appendChild(st.preview);
    }
    st.preview.textContent = text;
    st.preview.classList.toggle('is-error', !!isError);
    place(st.preview, 0);
    if (st.dropdown) place(st.dropdown, st.preview.offsetHeight || 18);
  };
  st.hidePreview = () => { if (st.preview) { st.preview.remove(); st.preview = null; } };

  st.closeDropdown = () => {
    if (st.dropdown) { st.dropdown.remove(); st.dropdown = null; }
    st.items = [];
    st.active = 0;
  };

  st.insert = (d) => {
    const caret = input.selectionStart ?? input.value.length;
    const w = wordAtCaret(input.value, caret);
    const start = w ? w.start : caret;
    input.value = input.value.slice(0, start) + d.name + input.value.slice(caret);
    const pos = start + d.name.length;
    try { input.setSelectionRange(pos, pos); } catch { /* not focusable in tests */ }
    st.closeDropdown();
    input.dispatchEvent(new Event('input', { bubbles: true }));   // formula text -> preview refresh via capture
  };

  const renderDropdown = () => {
    if (!st.items.length) { st.closeDropdown(); return; }
    if (!st.dropdown) {
      st.dropdown = doc.createElement('ul');
      st.dropdown.className = 'formula-dropdown';
      st.dropdown.setAttribute('role', 'listbox');
      doc.body.appendChild(st.dropdown);
    }
    st.dropdown.textContent = '';
    st.items.forEach((d, i) => {
      const li = doc.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.name = d.name;
      if (i === st.active) li.classList.add('is-active');
      const name = doc.createElement('span');
      name.textContent = d.name;
      name.title = d.label || d.name;
      const val = doc.createElement('span');
      val.className = 'formula-val';
      let v; try { v = Number(d.get()); } catch { v = NaN; }
      val.textContent = formatValue(v, d.unit || '');
      li.append(name, val);
      li.addEventListener('mousedown', (ev) => ev.preventDefault());   // keep focus in the field (mobile tap too)
      li.addEventListener('click', () => st.insert(d));
      st.dropdown.appendChild(li);
    });
    place(st.dropdown, st.preview ? (st.preview.offsetHeight || 18) : 0);
  };

  st.updateDropdown = () => {
    const w = wordAtCaret(input.value, input.selectionStart ?? input.value.length);
    let items = w ? namesMatching(decl(), w.prefix) : [];
    // A name typed out in full is done — don't make Enter insert it again instead of committing.
    if (items.length === 1 && items[0].name.toLowerCase() === w.prefix.toLowerCase()) items = [];
    st.items = items;
    st.active = Math.min(st.active, Math.max(0, items.length - 1));
    renderDropdown();
  };

  st.onFormulaInput = () => {
    const r = evaluate(input.value, decl());
    st.updateDropdown();
    // Mid-name ("heig" while the dropdown offers "height") is not an error yet — keep the preview neutral.
    if (!r.ok && st.items.length) st.showPreview('= …', false);
    else if (!r.ok) st.showPreview(`✕ ${r.error}`, true);
    else {
      const c = clampToField(input, r.value);
      const shown = `= ${+r.value.toFixed(6)}`;
      st.showPreview(c.bound ? `${shown} → ${+c.value.toFixed(6)} (${c.bound})` : shown, false);
    }
  };

  /** Evaluate the field's formula; true when the field now holds a committed number. */
  st.commit = ({ revertOnError = false } = {}) => {
    st.closeDropdown();
    const text = input.value;
    if (isPlainNumber(text) || !text.trim()) { st.hidePreview(); return isPlainNumber(text); }
    const r = evaluate(text, decl());
    if (!r.ok) {
      st.showPreview(`✕ ${r.error} — kept ${st.lastGood}`, true);
      if (revertOnError) input.value = st.lastGood;
      return false;
    }
    const c = clampToField(input, r.value);
    const value = Number(c.value.toFixed(10));
    input.value = String(value);
    st.lastGood = input.value;
    st.hidePreview();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (c.bound) {
      st.showPreview(`${+r.value.toFixed(6)} clamped to ${value} (${c.bound})`, false);
      setTimeout(() => { if (st.preview && !st.preview.classList.contains('is-error')) st.hidePreview(); }, 2500);
    }
    return true;
  };

  // Preview + dropdown are position:fixed on <body> (the stepper wrapper is a flex row) — follow the field when any
  // scroller (the sidebar) moves.
  doc.addEventListener('scroll', () => {
    if (st.preview) place(st.preview, 0);
    if (st.dropdown) place(st.dropdown, st.preview ? (st.preview.offsetHeight || 18) : 0);
  }, true);

  input.addEventListener('focus', () => { if (isPlainNumber(input.value)) st.lastGood = input.value; });
  input.addEventListener('blur', () => {
    st.closeDropdown();
    // A formula still in the field at blur is committed by the native change (capture listener); an error
    // message outlives it briefly so the user sees why the value didn't take.
    if (st.preview && !st.preview.classList.contains('is-error')) st.hidePreview();
    else if (st.preview) setTimeout(() => { if (doc.activeElement !== input) st.hidePreview(); }, 2500);
  });
  input.addEventListener('keydown', (e) => {
    const open = !!st.dropdown && st.items.length > 0;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = st.items.length;
      st.active = (st.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      renderDropdown();
      return;
    }
    if (open && (e.key === 'Enter' || e.key === 'Tab')) {
      e.preventDefault();
      st.insert(st.items[st.active]);
      return;
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      st.closeDropdown();
      return;
    }
    if (e.key === 'Enter' && !isPlainNumber(input.value) && input.value.trim()) {
      e.preventDefault();
      st.commit();
    }
  });

  st.api = {
    input,
    commit: () => st.commit(),
    get dropdownItems() { return st.items.map((d) => d.name); },
    get previewText() { return st.preview ? st.preview.textContent : ''; },
  };
  _fields.set(input, st);
  return st.api;
}

/** True once attachFormula has bound this input. */
export function isFormulaField(input) {
  return _fields.has(input);
}
