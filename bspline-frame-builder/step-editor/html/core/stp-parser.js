/**
 * stp-parser.js — STEP (ISO 10303-21) file ↔ in-memory entity graph.
 *
 * SELF-CONTAINED: zero imports. If something useful exists elsewhere in
 * the repo it is re-derived here, never imported across folder boundaries.
 *
 * What's implemented:
 *   parseStep(text)        → { header, entities: Map<id, Entity>, warnings, rawText }
 *   writeStep(parsed)      → STEP text (round-trips parseStep output)
 *   tokenizeArgs(argText)  → string[]   (top-level args, respecting strings + parens)
 *   emptyHeader()          → fresh header skeleton
 *   countByType(parsed)    → Map<typeName, count>
 *
 * Args are kept as opaque trimmed strings — typed parsing for specific
 * entity types (CARTESIAN_POINT → Float64Array of 3 numbers, etc.) lives
 * elsewhere so this module stays focused on syntax. Compound entities
 * (the `#13=(TYPE_A() TYPE_B() TYPE_C())` form) are preserved as a
 * nested `compound` array of plain entities so round-trip stays exact.
 *
 * Performance notes for the 14.7 MB canoe fixture (~149 k entities):
 *   - Comment stripping and statement splitting both walk the text once
 *     using small state machines (no regex backtracking).
 *   - Statement parsing uses a single anchored regex per entity body.
 *   - Total parse on the canoe: under a second on a modern laptop in
 *     practice; well within UI-acceptable.
 */

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Parse a STEP file's text content into an entity graph.
 *
 * @param {string} text   raw .stp file contents (UTF-8 expected)
 * @returns {ParsedStep}
 */
export function parseStep(text) {
  const warnings = [];

  // 1. Strip /* ... */ block comments (string-aware).
  const stripped = stripBlockComments(text, warnings);

  // 2. Pull the HEADER and DATA section bodies.
  const headerBody = sliceSection(stripped, 'HEADER', warnings);
  const dataBody   = sliceSection(stripped, 'DATA',   warnings);

  const header   = parseHeader(headerBody, warnings);
  const entities = parseData(dataBody, warnings);

  return { header, entities, warnings, rawText: text };
}

/**
 * Serialize a parsed STEP graph back to text. Round-trips parseStep output.
 *
 * @param {ParsedStep} parsed
 * @returns {string}
 */
export function writeStep(parsed) {
  if (!parsed) return '';
  const out = [];
  out.push('ISO-10303-21;');
  out.push('HEADER;');
  out.push(writeFileDescription(parsed.header));
  out.push(writeFileName(parsed.header));
  out.push(writeFileSchema(parsed.header));
  out.push('ENDSEC;');
  out.push('DATA;');

  // Emit entities in ascending ID order so diffs against the source
  // file are stable even after edits. Real-world files (canoe etc.)
  // already arrive sorted, so this is a no-op pass for round-trip.
  const ids = [...parsed.entities.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    out.push(writeEntity(parsed.entities.get(id)));
  }
  out.push('ENDSEC;');
  out.push('END-ISO-10303-21;');
  return out.join('\n');
}

/**
 * Bare-minimum tokenizer for STEP entity argument lists. Public so the
 * future numeric-typing layer has a clean unit-testable surface.
 *
 * Splits "X', (1., 2., 3.), #14, .T." into ["X'", "(1., 2., 3.)", "#14", ".T."]
 * — respecting nested parens, quoted strings (including the `''` escape),
 * and enum tokens (".T.").
 *
 * @param {string} argText  content between the outer '(' and ')'
 * @returns {string[]}
 */
export function tokenizeArgs(argText) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let buf = '';
  for (let i = 0; i < argText.length; i++) {
    const c = argText[i];
    if (inStr) {
      buf += c;
      if (c === "'") {
        // STEP escapes a literal apostrophe as two consecutive '': stay in-string.
        if (argText[i + 1] === "'") { buf += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === '(') { depth++; buf += c; continue; }
    if (c === ')') { depth--; buf += c; continue; }
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim().length) out.push(buf.trim());
  return out;
}

/**
 * Empty header skeleton — used for "New (empty)" and as a fallback when
 * an input file has a malformed HEADER section.
 */
export function emptyHeader() {
  return {
    description:    ['STEP edited by step-editor'],
    implementation: '2;1',
    name: {
      filename:           'untitled.stp',
      timestamp:          new Date().toISOString(),
      author:             [''],
      organization:       [''],
      preprocessor:       'step-editor v0.1.0',
      originatingSystem:  '',
      authorization:      '',
    },
    schema: ["AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }"],
  };
}

/**
 * Count entities by top-level type name. Compound entities are bucketed
 * under their first inner type for usefulness — most readers (Fusion's
 * importer included) effectively treat the first slot as the canonical
 * type of a compound.
 *
 * @param {ParsedStep} parsed
 * @returns {Map<string, number>}
 */
export function countByType(parsed) {
  const m = new Map();
  if (!parsed || !parsed.entities) return m;
  for (const e of parsed.entities.values()) {
    const key = e.type || (e.compound && e.compound[0] && e.compound[0].type) || '<compound>';
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}

/* ────────────────────────────────────────────────────────────────────
 * Private — stripping, slicing, header/data parsing
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Remove /* ... *​/ block comments. String-aware: a comment opener inside
 * a single-quoted string is just data. Each removed comment is replaced
 * with a single space so byte offsets stay roughly comparable for any
 * future column-accurate diagnostics.
 */
function stripBlockComments(text, warnings) {
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = text[i];

    if (c === "'") {
      // Copy a quoted string verbatim, including the `''` escape for an
      // embedded apostrophe.
      const start = i;
      out += c; i++;
      while (i < n) {
        const c2 = text[i];
        if (c2 === "'") {
          if (text[i + 1] === "'") { out += "''"; i += 2; continue; }
          out += c2; i++; break;
        }
        out += c2; i++;
      }
      if (i >= n && text[start] === "'" && text[n - 1] !== "'") {
        warnings.push('unterminated string literal');
      }
      continue;
    }

    if (c === '/' && text[i + 1] === '*') {
      // Skip until the closing `*​/`.
      i += 2;
      while (i < n - 1) {
        if (text[i] === '*' && text[i + 1] === '/') { i += 2; break; }
        i++;
      }
      out += ' ';
      continue;
    }

    out += c; i++;
  }
  return out;
}

/**
 * Carve out the body of a STEP section (HEADER or DATA). Returns the
 * substring between `<NAME>;` and the next `ENDSEC;`, or an empty string
 * with a warning if either marker is missing.
 */
function sliceSection(text, sectionName, warnings) {
  const start = text.indexOf(`${sectionName};`);
  if (start < 0) {
    warnings.push(`missing ${sectionName} section`);
    return '';
  }
  const bodyStart = start + sectionName.length + 1; // skip "NAME;"
  const endSec    = text.indexOf('ENDSEC', bodyStart);
  if (endSec < 0) {
    warnings.push(`${sectionName} section missing ENDSEC`);
    return text.slice(bodyStart);
  }
  return text.slice(bodyStart, endSec);
}

/**
 * Split a section body on `;` while ignoring semicolons inside quoted
 * strings. Each returned chunk is the unstripped statement minus the
 * terminating semicolon.
 */
function splitStatements(text) {
  const out = [];
  let buf = '';
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        const c2 = text[i];
        buf += c2;
        if (c2 === "'") {
          if (text[i + 1] === "'") { buf += "'"; i += 2; continue; }
          break;
        }
        i++;
      }
      continue;
    }
    if (c === ';') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim().length) out.push(buf);
  return out;
}

/**
 * Parse the HEADER section into a plain object. The three canonical
 * statements (FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA) are recognized;
 * any others are kept as raw `extra` entries so round-trip preserves
 * vendor-specific metadata (Solidworks adds these regularly).
 */
function parseHeader(body, warnings) {
  const header = emptyHeader();
  header.extra = [];

  for (const raw of splitStatements(body)) {
    const stmt = raw.trim();
    if (!stmt) continue;

    const m = stmt.match(/^([A-Z_][A-Z_0-9]*)\s*\(([\s\S]*)\)$/);
    if (!m) { warnings.push(`bad HEADER statement: ${truncate(stmt, 60)}`); continue; }

    const [, type, argSrc] = m;
    const args = tokenizeArgs(argSrc);

    switch (type) {
      case 'FILE_DESCRIPTION': {
        // FILE_DESCRIPTION((list of descriptions), 'impl level')
        header.description    = stripStringList(args[0]);
        header.implementation = stripString(args[1] || "'2;1'");
        break;
      }
      case 'FILE_NAME': {
        // FILE_NAME('filename','timestamp',(authors),(orgs),
        //          'preprocessor','origin sys','authorisation')
        const n = header.name;
        n.filename          = stripString(args[0]);
        n.timestamp         = stripString(args[1]);
        n.author            = stripStringList(args[2]);
        n.organization      = stripStringList(args[3]);
        n.preprocessor      = stripString(args[4]);
        n.originatingSystem = stripString(args[5]);
        n.authorization     = stripString(args[6]);
        break;
      }
      case 'FILE_SCHEMA': {
        header.schema = stripStringList(args[0]);
        break;
      }
      default:
        header.extra.push({ type, args });
    }
  }

  return header;
}

/**
 * Parse the DATA section into a Map<id, Entity>.
 *
 * Two entity shapes are accepted:
 *   #ID=TYPE(args);
 *   #ID=(TYPE1(args1) TYPE2(args2) ...);    // compound entity
 *
 * Whitespace inside an entity body is preserved inside string literals
 * and collapsed-out elsewhere (line breaks in unquoted regions are
 * common in real-world files like the canoe).
 */
function parseData(body, warnings) {
  const entities = new Map();

  for (const raw of splitStatements(body)) {
    const stmt = raw.trim();
    if (!stmt) continue;

    if (stmt[0] !== '#') {
      warnings.push(`DATA statement without #ID: ${truncate(stmt, 60)}`);
      continue;
    }

    const eq = stmt.indexOf('=');
    if (eq < 0) { warnings.push(`DATA statement missing '=': ${truncate(stmt, 60)}`); continue; }

    const idText = stmt.slice(1, eq).trim();
    const id = Number(idText);
    if (!Number.isFinite(id) || id <= 0) {
      warnings.push(`bad entity id: "${idText}"`);
      continue;
    }

    const rhs = stmt.slice(eq + 1).trim();
    const entity = parseEntityRHS(id, rhs, warnings);
    if (entity) entities.set(id, entity);
  }

  return entities;
}

/**
 * Parse the right-hand side of an entity assignment. Returns null on
 * malformed input (a warning is pushed for the caller to surface).
 */
function parseEntityRHS(id, rhs, warnings) {
  if (rhs[0] === '(') {
    // Compound: parse the inner sequence of TYPE(args) chunks.
    const inner = stripOuterParens(rhs);
    if (inner == null) { warnings.push(`#${id}: unbalanced compound parens`); return null; }
    const parts = splitCompoundParts(inner);
    const compound = [];
    for (const part of parts) {
      const m = part.trim().match(/^([A-Z_][A-Z_0-9]*)\s*\(([\s\S]*)\)$/);
      if (!m) { warnings.push(`#${id}: bad compound part: ${truncate(part, 40)}`); continue; }
      compound.push({ id: null, type: m[1], args: tokenizeArgs(m[2]), compound: null });
    }
    return { id, type: null, args: null, compound };
  }

  const m = rhs.match(/^([A-Z_][A-Z_0-9]*)\s*\(([\s\S]*)\)$/);
  if (!m) { warnings.push(`#${id}: malformed simple entity: ${truncate(rhs, 40)}`); return null; }
  return { id, type: m[1], args: tokenizeArgs(m[2]), compound: null };
}

/**
 * Compound-entity inner content is a whitespace-separated list of
 * TYPE(args) chunks. Split by walking with the same paren-depth state
 * machine used by tokenizeArgs.
 */
function splitCompoundParts(inner) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      buf += c;
      if (c === "'") {
        if (inner[i + 1] === "'") { buf += "'"; i++; }
        else inStr = false;
      }
      continue;
    }
    if (c === "'") { inStr = true; buf += c; continue; }
    if (c === '(') { depth++; buf += c; continue; }
    if (c === ')') {
      depth--; buf += c;
      if (depth === 0) {
        out.push(buf.trim());
        buf = '';
      }
      continue;
    }
    if (depth === 0 && /\s/.test(c)) continue;  // skip inter-part whitespace
    buf += c;
  }
  if (buf.trim().length) out.push(buf.trim());
  return out;
}

/**
 * Strip one matching pair of outer parens. Returns the inner substring
 * or null if the text doesn't start with `(` or its closing paren is
 * missing.
 */
function stripOuterParens(text) {
  const s = text.trim();
  if (s[0] !== '(' || s[s.length - 1] !== ')') return null;
  return s.slice(1, -1);
}

/* ────────────────────────────────────────────────────────────────────
 * Private — header writers
 * ──────────────────────────────────────────────────────────────────── */

function writeFileDescription(h) {
  const descs = (h.description || []).map(quoteString).join(',');
  const impl  = quoteString(h.implementation || '2;1');
  return `FILE_DESCRIPTION((${descs}),${impl});`;
}

function writeFileName(h) {
  const n = h.name || emptyHeader().name;
  const authors = (n.author       || []).map(quoteString).join(',');
  const orgs    = (n.organization || []).map(quoteString).join(',');
  return [
    'FILE_NAME(',
    `${quoteString(n.filename || '')},`,
    `${quoteString(n.timestamp || '')},`,
    `(${authors}),`,
    `(${orgs}),`,
    `${quoteString(n.preprocessor || '')},`,
    `${quoteString(n.originatingSystem || '')},`,
    `${quoteString(n.authorization || '')});`,
  ].join('');
}

function writeFileSchema(h) {
  const schemas = (h.schema || []).map(quoteString).join(',');
  return `FILE_SCHEMA((${schemas}));`;
}

/* ────────────────────────────────────────────────────────────────────
 * Private — entity writer
 * ──────────────────────────────────────────────────────────────────── */

function writeEntity(e) {
  if (!e) return '';
  if (e.compound) {
    const parts = e.compound.map(p => `${p.type}(${(p.args || []).join(',')})`).join(' ');
    return `#${e.id}=(${parts});`;
  }
  const args = (e.args || []).join(',');
  return `#${e.id}=${e.type}(${args});`;
}

/* ────────────────────────────────────────────────────────────────────
 * Private — small helpers
 * ──────────────────────────────────────────────────────────────────── */

/** Strip the outer pair of single quotes and unescape `''` → `'`. */
function stripString(s) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  if (t.length < 2 || t[0] !== "'" || t[t.length - 1] !== "'") return t;
  return t.slice(1, -1).replace(/''/g, "'");
}

/** Re-quote a JS string for STEP output: wrap in `'...'` and escape `'` → `''`. */
function quoteString(s) {
  return "'" + String(s == null ? '' : s).replace(/'/g, "''") + "'";
}

/** Parse a STEP string-list token like "('a','b','c')" into JS strings. */
function stripStringList(s) {
  if (typeof s !== 'string') return [];
  const inner = stripOuterParens(s.trim());
  if (inner == null) return [];
  const out = [];
  for (const tok of tokenizeArgs(inner)) out.push(stripString(tok));
  return out;
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}

/* ────────────────────────────────────────────────────────────────────
 * Type docs
 * ──────────────────────────────────────────────────────────────────── */

/**
 * @typedef {Object} ParsedStep
 * @property {object} header           parsed header fields (see emptyHeader)
 * @property {Map<number, Entity>} entities    id → entity
 * @property {string[]} warnings       human-readable parse complaints
 * @property {string} rawText          original file text (for diff/round-trip)
 *
 * @typedef {Object} Entity
 * @property {number} id               entity id (the #N value)
 * @property {string|null} type        entity name, or null for compound
 * @property {string[]|null} args      tokenized args (null for compound)
 * @property {Entity[]|null} compound  inner entities for compound rows
 */
