/**
 * formula.js — FORMULA-FIELDS (R1): the ONE safe arithmetic parser behind every formula-capable number field.
 *
 * Grammar (recursive descent, no eval / dynamic code — a pure tokenizer + parser):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := ('-' | '+') unary | primary
 *   primary := NUMBER | NAME | '(' expr ')'
 *
 * NAMES come from a SCOPE DECLARATION the caller (a panel) passes in — this module never knows what a lattice
 * or a stock dimension is. The same declaration feeds the autocomplete dropdown (namesMatching), so the names
 * the parser accepts and the names the dropdown offers are one source:
 *   scope = [{ name: 'width', label?: 'Stock width', get: () => number, unit?: '"' }, ...]
 * Names are case-insensitive.
 *
 * evaluate(src, scope) -> { ok: true, value } | { ok: false, error, code, pos }
 *   code ∈ FORMULA_ERRORS; pos = character index in src where the problem starts.
 */

export const FORMULA_ERRORS = Object.freeze({
  EMPTY: 'empty',
  BAD_CHAR: 'bad-char',
  UNEXPECTED: 'unexpected',
  MISSING_PAREN: 'missing-paren',
  UNKNOWN_NAME: 'unknown-name',
  BAD_NAME_VALUE: 'bad-name-value',
  DIV_ZERO: 'div-zero',
  TRAILING: 'trailing',
  NOT_FINITE: 'not-finite',
});

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

class FormulaError extends Error {
  constructor(code, message, pos) { super(message); this.code = code; this.pos = pos; }
}

/** Tokens: { t: 'num' | 'name' | 'op' | 'end', v, pos }. Throws FormulaError on a character outside the grammar. */
export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1] || ''))) {
      const start = i;
      while (i < src.length && DIGIT.test(src[i])) i++;
      if (src[i] === '.') { i++; while (i < src.length && DIGIT.test(src[i])) i++; }
      out.push({ t: 'num', v: Number(src.slice(start, i)), pos: start });
      continue;
    }
    if (NAME_START.test(c)) {
      const start = i;
      while (i < src.length && NAME_CHAR.test(src[i])) i++;
      out.push({ t: 'name', v: src.slice(start, i), pos: start });
      continue;
    }
    if ('+-*/()'.includes(c)) { out.push({ t: 'op', v: c, pos: i }); i++; continue; }
    throw new FormulaError(FORMULA_ERRORS.BAD_CHAR, `unexpected "${c}"`, i);
  }
  out.push({ t: 'end', v: null, pos: src.length });
  return out;
}

/** Case-insensitive lookup of a declared name; null when not declared. */
export function findName(scope, name) {
  const key = String(name).toLowerCase();
  return (scope || []).find((d) => String(d.name).toLowerCase() === key) || null;
}

/** Declared names whose name starts with `prefix` (case-insensitive), in declaration order — the dropdown's list. */
export function namesMatching(scope, prefix) {
  const p = String(prefix || '').toLowerCase();
  return (scope || []).filter((d) => String(d.name).toLowerCase().startsWith(p));
}

/** True when `src` is just a plain decimal number (optionally signed) — such text behaves exactly like today. */
export function isPlainNumber(src) {
  return /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(String(src));
}

function parse(tokens, scope) {
  let k = 0;
  const peek = () => tokens[k];
  const next = () => tokens[k++];

  const describe = (tok) => (tok.t === 'end' ? 'end of formula' : `"${tok.v}"`);

  function primary() {
    const tok = next();
    if (tok.t === 'num') return tok.v;
    if (tok.t === 'name') {
      const decl = findName(scope, tok.v);
      if (!decl) throw new FormulaError(FORMULA_ERRORS.UNKNOWN_NAME, `unknown name "${tok.v}"`, tok.pos);
      const v = Number(decl.get());
      if (!Number.isFinite(v)) throw new FormulaError(FORMULA_ERRORS.BAD_NAME_VALUE, `"${tok.v}" has no value`, tok.pos);
      return v;
    }
    if (tok.t === 'op' && tok.v === '(') {
      const v = expr();
      const close = next();
      if (!(close.t === 'op' && close.v === ')')) {
        throw new FormulaError(FORMULA_ERRORS.MISSING_PAREN, `expected ")" but found ${describe(close)}`, close.pos);
      }
      return v;
    }
    throw new FormulaError(FORMULA_ERRORS.UNEXPECTED, `unexpected ${describe(tok)}`, tok.pos);
  }

  function unary() {
    const tok = peek();
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+')) { next(); const v = unary(); return tok.v === '-' ? -v : v; }
    return primary();
  }

  function term() {
    let v = unary();
    for (;;) {
      const tok = peek();
      if (tok.t !== 'op' || (tok.v !== '*' && tok.v !== '/')) return v;
      next();
      const rhs = unary();
      if (tok.v === '*') v *= rhs;
      else {
        if (rhs === 0) throw new FormulaError(FORMULA_ERRORS.DIV_ZERO, 'division by zero', tok.pos);
        v /= rhs;
      }
    }
  }

  function expr() {
    let v = term();
    for (;;) {
      const tok = peek();
      if (tok.t !== 'op' || (tok.v !== '+' && tok.v !== '-')) return v;
      next();
      const rhs = term();
      v = tok.v === '+' ? v + rhs : v - rhs;
    }
  }

  const value = expr();
  const rest = peek();
  if (rest.t !== 'end') throw new FormulaError(FORMULA_ERRORS.TRAILING, `unexpected ${describe(rest)}`, rest.pos);
  return value;
}

/** Evaluate `src` against the declared `scope`. Never throws. */
export function evaluate(src, scope = []) {
  const text = String(src ?? '');
  if (!text.trim()) return { ok: false, error: 'empty formula', code: FORMULA_ERRORS.EMPTY, pos: 0 };
  try {
    const value = parse(tokenize(text), scope);
    if (!Number.isFinite(value)) return { ok: false, error: 'result is not a number', code: FORMULA_ERRORS.NOT_FINITE, pos: 0 };
    return { ok: true, value };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message, code: e.code, pos: e.pos };
    throw e;
  }
}
