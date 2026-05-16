/**
 * stp-bodies.js — body detection + per-body transforms on a parsed graph.
 *
 * SELF-CONTAINED: imports only from stp-parser.js, which is in the same
 * folder. No path outside step-editor/.
 *
 * What's a "body"?
 *   STEP wraps geometry in a few different root entity types depending on
 *   the source CAD package. We treat any of these as a body:
 *     SHELL_BASED_SURFACE_MODEL          (surface body — canoe uses these)
 *     MANIFOLD_SOLID_BREP                (closed solid)
 *     BREP_WITH_VOIDS                    (solid with internal cavities)
 *     FACETED_BREP                       (tessellated solid)
 *
 * Body name is the first quoted-string arg. When that's empty, we fall
 * back to "<type>#<id>" so the UI never has to render a blank row.
 *
 * SCOPE FOR THIS MILESTONE:
 *   - findBodies(parsed)              → list bodies
 *   - reachableEntities(parsed, id)   → all IDs in a body's sub-graph
 *   - scaleBody(parsed, id, factor)   → multiply every reachable
 *                                       CARTESIAN_POINT by `factor`
 *
 *   Translate / rotate / per-axis scale lands later. Shared
 *   CARTESIAN_POINTs (referenced by more than one body) are scaled
 *   along with the selected body — that's a known v1 limitation;
 *   the workaround is to deep-copy the body before transforming
 *   (`cloneBodySubgraph()` — TBD).
 */

import { tokenizeArgs } from './stp-parser.js';

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/** Entity types we recognize as body roots. */
export const BODY_ROOT_TYPES = new Set([
  'SHELL_BASED_SURFACE_MODEL',
  'MANIFOLD_SOLID_BREP',
  'BREP_WITH_VOIDS',
  'FACETED_BREP',
]);

/**
 * Find every body root in the parsed graph.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @returns {Array<{id:number, name:string, type:string}>}
 *   sorted by name (case-insensitive) for stable UI ordering.
 */
export function findBodies(parsed) {
  const out = [];
  if (!parsed || !parsed.entities) return out;

  for (const e of parsed.entities.values()) {
    // Compound entities sometimes carry a body-root type as their first
    // inner slot (rare; not seen in the canoe but possible). Treat the
    // first inner type as canonical for compound rows.
    const top = e.type || (e.compound && e.compound[0] && e.compound[0].type) || null;
    if (!top || !BODY_ROOT_TYPES.has(top)) continue;

    const args = e.args || (e.compound && e.compound[0] && e.compound[0].args) || [];
    const rawName = (args[0] || '').trim();
    const name    = stripQuotes(rawName) || `${top}#${e.id}`;

    out.push({ id: e.id, name, type: top });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return out;
}

/**
 * Walk the entity graph from `rootId` and return the set of every entity
 * id reachable through `#N` references in argument lists.
 *
 * Uses an explicit work-queue (BFS) so the canoe's deep BREP graphs don't
 * blow the JS stack. Linear in the number of edges visited.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} rootId
 * @returns {Set<number>}
 */
export function reachableEntities(parsed, rootId) {
  const seen = new Set();
  if (!parsed || !parsed.entities || !parsed.entities.has(rootId)) return seen;

  const queue = [rootId];
  seen.add(rootId);

  while (queue.length) {
    const id = queue.pop();
    const e  = parsed.entities.get(id);
    if (!e) continue;

    // Collect every #N reference from this entity's args (and from each
    // inner part if it's a compound entity).
    const argLists = [];
    if (e.args) argLists.push(e.args);
    if (e.compound) for (const p of e.compound) if (p.args) argLists.push(p.args);

    for (const args of argLists) {
      for (const a of args) collectRefs(a, seen, queue, parsed);
    }
  }
  return seen;
}

/**
 * Uniformly scale every CARTESIAN_POINT reachable from `bodyId` by
 * `factor`. Mutates the parsed graph in place.
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} bodyId
 * @param {number} factor   e.g. 2.0 to double the size, 0.5 to halve
 * @returns {{ scaled: number, skipped: number }}
 *   scaled  — count of CARTESIAN_POINT entities whose args were rewritten
 *   skipped — entities labelled CARTESIAN_POINT we couldn't parse (logged)
 */
export function scaleBody(parsed, bodyId, factor) {
  return transformPoints(parsed, bodyId, ([x, y, z]) => [x * factor, y * factor, z * factor]);
}

/**
 * Per-axis scale. Useful when scaling along a single direction (stretch
 * a paddle along its length without growing its grip diameter, etc.).
 *
 * @param {import('./stp-parser.js').ParsedStep} parsed
 * @param {number} bodyId
 * @param {{x:number,y:number,z:number}} factors
 */
export function scaleBodyAxes(parsed, bodyId, factors) {
  const fx = Number(factors.x);
  const fy = Number(factors.y);
  const fz = Number(factors.z);
  return transformPoints(parsed, bodyId, ([x, y, z]) => [x * fx, y * fy, z * fz]);
}

/**
 * Translate (move) every CARTESIAN_POINT reachable from `bodyId` by
 * the supplied delta vector.
 */
export function translateBody(parsed, bodyId, delta) {
  const dx = Number(delta.x) || 0;
  const dy = Number(delta.y) || 0;
  const dz = Number(delta.z) || 0;
  return transformPoints(parsed, bodyId, ([x, y, z]) => [x + dx, y + dy, z + dz]);
}

/**
 * Rotate every CARTESIAN_POINT reachable from `bodyId` around one of
 * the principal axes by `angleDeg` degrees.
 *
 * Right-handed convention: a positive angle rotates counter-clockwise
 * when looking down the axis from positive towards origin (same as
 * Fusion / OpenSCAD).  Rotation pivots around the world origin — if
 * you want rotation around the body's centre instead, translate to
 * origin → rotate → translate back.
 *
 * @param {'x'|'y'|'z'} axis
 * @param {number} angleDeg
 */
export function rotateBody(parsed, bodyId, axis, angleDeg) {
  const rad = (Number(angleDeg) || 0) * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  let fn;
  if (axis === 'x')      fn = ([x, y, z]) => [x,            c * y - s * z,  s * y + c * z];
  else if (axis === 'y') fn = ([x, y, z]) => [c * x + s * z,  y,           -s * x + c * z];
  else if (axis === 'z') fn = ([x, y, z]) => [c * x - s * y,  s * x + c * y, z           ];
  else                   fn = ([x, y, z]) => [x, y, z];
  return transformPoints(parsed, bodyId, fn);
}

/**
 * Mirror every CARTESIAN_POINT reachable from `bodyId` across one of
 * the principal planes through the world origin.
 *
 * Note: mirroring inverts BREP face orientation.  Most STEP importers
 * (Fusion's included) auto-correct via the face's `SAME_SENSE` flag,
 * but if you see inside-out surfaces after a mirror, that's why.
 *
 * @param {'xy'|'yz'|'xz'} plane
 */
export function mirrorBody(parsed, bodyId, plane) {
  let fn;
  if (plane === 'xy')      fn = ([x, y, z]) => [ x,  y, -z];
  else if (plane === 'yz') fn = ([x, y, z]) => [-x,  y,  z];
  else if (plane === 'xz') fn = ([x, y, z]) => [ x, -y,  z];
  else                     fn = ([x, y, z]) => [ x,  y,  z];
  return transformPoints(parsed, bodyId, fn);
}

/**
 * Resize a body to specific bounding-box dimensions while keeping its
 * current centre in place.  Pass 0 for any axis to preserve the
 * current size along that axis.
 *
 * Implementation: compute per-axis scale factors from current/target,
 * then apply the linear map  P' = P·f + C·(1 − f)  where C is the
 * current bbox centre.  The (1 − f) shift cancels the drift that a
 * naive scale-around-origin would cause when the body isn't centred
 * on the world origin.
 *
 * @param {{x:number,y:number,z:number}} target  desired dimensions
 */
export function resizeBody(parsed, bodyId, target) {
  const bbox = getBodyBounds(parsed, bodyId);
  if (!bbox) return { scaled: 0, skipped: 0, cloned: 0 };

  const fx = (Number(target.x) > 0 && bbox.size[0] > 0) ? Number(target.x) / bbox.size[0] : 1;
  const fy = (Number(target.y) > 0 && bbox.size[1] > 0) ? Number(target.y) / bbox.size[1] : 1;
  const fz = (Number(target.z) > 0 && bbox.size[2] > 0) ? Number(target.z) / bbox.size[2] : 1;

  if (fx === 1 && fy === 1 && fz === 1) return { scaled: 0, skipped: 0, cloned: 0 };

  const cx = (bbox.min[0] + bbox.max[0]) * 0.5;
  const cy = (bbox.min[1] + bbox.max[1]) * 0.5;
  const cz = (bbox.min[2] + bbox.max[2]) * 0.5;

  return transformPoints(parsed, bodyId, ([x, y, z]) => [
    x * fx + cx * (1 - fx),
    y * fy + cy * (1 - fy),
    z * fz + cz * (1 - fz),
  ]);
}

/**
 * Per-body bounding box.  Like getBounds() but walks only the points
 * reachable from `bodyId`, so each body in the file has its own box.
 * Useful for the Resize tool and for any future body-centric centre
 * calculation.
 *
 * @returns {{min:[number,number,number], max:[number,number,number], size:[number,number,number]} | null}
 */
export function getBodyBounds(parsed, bodyId) {
  if (!parsed || !parsed.entities || !parsed.entities.has(bodyId)) return null;
  const reachable = reachableEntities(parsed, bodyId);
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  let count = 0;
  for (const id of reachable) {
    const e = parsed.entities.get(id);
    if (!e || e.type !== 'CARTESIAN_POINT') continue;
    const tup = e.args && e.args[1];
    if (!tup) continue;
    const inner = tup.charCodeAt(0) === 40 ? tup.slice(1, -1) : tup;
    const parts = inner.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    count++;
  }
  if (!count) return null;
  return {
    min:  [mnx, mny, mnz],
    max:  [mxx, mxy, mxz],
    size: [mxx - mnx, mxy - mny, mxz - mnz],
  };
}

/**
 * Sweep every CARTESIAN_POINT in the file (not just one body) and
 * return the overall axis-aligned bounding box. Useful for showing
 * the model size in the info panel — a quick visual confirmation
 * that a scale operation took effect.
 *
 * Returns null if the file has no points.
 *
 * @returns {{min:[number,number,number], max:[number,number,number], size:[number,number,number]} | null}
 */
export function getBounds(parsed) {
  if (!parsed || !parsed.entities) return null;
  let mnx = Infinity, mny = Infinity, mnz = Infinity;
  let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  let count = 0;
  for (const e of parsed.entities.values()) {
    if (!e || e.type !== 'CARTESIAN_POINT') continue;
    const tup = e.args && e.args[1];
    if (!tup) continue;
    // Inline tuple parse — Number() on a comma-split is faster than
    // routing through tokenizeArgs for 100k+ iterations.
    const inner = tup.charCodeAt(0) === 40 /* '(' */ ? tup.slice(1, -1) : tup;
    const parts = inner.split(',');
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < mnx) mnx = x; if (x > mxx) mxx = x;
    if (y < mny) mny = y; if (y > mxy) mxy = y;
    if (z < mnz) mnz = z; if (z > mxz) mxz = z;
    count++;
  }
  if (!count) return null;
  return {
    min:  [mnx, mny, mnz],
    max:  [mxx, mxy, mxz],
    size: [mxx - mnx, mxy - mny, mxz - mnz],
  };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — engine
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Generic point-mutating walk. Visits every CARTESIAN_POINT reachable
 * from `bodyId` and rewrites its first arg (the `(x, y, z)` coordinate
 * triple) by passing the parsed numbers through `fn`.
 *
 * BODY-INDEPENDENT: before mutating, any entity in this body's
 * sub-graph that is ALSO reachable from another body's sub-graph
 * is cloned into a fresh entity with a new ID, and this body's
 * references are rewritten to point at the clone. The result is
 * that scaling one body never warps another — even when the source
 * file shares CARTESIAN_POINTs between bodies (which Fusion-exported
 * STEP files occasionally do at seams).
 *
 * Returns the count of scaled points, malformed-and-skipped points,
 * and how many entities were cloned during the forking step.
 */
function transformPoints(parsed, bodyId, fn) {
  const exclusive = forkSharedSubgraph(parsed, bodyId);

  let scaled = 0, skipped = 0;
  for (const id of exclusive.set) {
    const e = parsed.entities.get(id);
    if (!e || e.type !== 'CARTESIAN_POINT') continue;
    if (!e.args || e.args.length < 2) { skipped++; continue; }

    const nums = parseTuple(e.args[1]);
    if (!nums || nums.length < 2) { skipped++; continue; }

    let [x, y, z] = [nums[0] || 0, nums[1] || 0, nums[2] || 0];
    [x, y, z] = fn([x, y, z]);

    e.args[1] = nums.length === 2
      ? `(${formatNum(x)},${formatNum(y)})`
      : `(${formatNum(x)},${formatNum(y)},${formatNum(z)})`;
    scaled++;
  }
  return { scaled, skipped, cloned: exclusive.cloned };
}

/**
 * Make `bodyId`'s sub-graph independent from every other body's
 * sub-graph.
 *
 * Returns `{ set, cloned }` where:
 *   set    — every entity id that now belongs exclusively to this
 *            body (the original private ones plus the freshly-minted
 *            clones of formerly-shared ones)
 *   cloned — count of entities cloned (zero on subsequent calls,
 *            because the body is already fully private)
 *
 * Algorithm:
 *   1. Reachable-from-us  = BFS from bodyId
 *   2. Reachable-from-others = union of BFS from every other body root
 *   3. shared = (1) ∩ (2),  minus the body root itself
 *      (the body root shouldn't be in another body's sub-graph; if it
 *       somehow is, treating it as shared would break the body — so
 *       we exclude it defensively.)
 *   4. For each shared entity, create a clone with a fresh id, build
 *      old→new mapping.
 *   5. Walk every entity that's now exclusively ours (private + clones)
 *      and rewrite any `#oldid` ref in its args to `#newid`.
 */
function forkSharedSubgraph(parsed, bodyId) {
  const ourReachable = reachableEntities(parsed, bodyId);

  // Union the OTHER bodies' reachable sets. Even one body shared
  // with us is enough reason to fork — the user wants independence.
  const otherIds = [];
  for (const e of parsed.entities.values()) {
    const top = e.type || (e.compound && e.compound[0] && e.compound[0].type) || null;
    if (top && BODY_ROOT_TYPES.has(top) && e.id !== bodyId) otherIds.push(e.id);
  }
  const otherReachable = new Set();
  for (const id of otherIds) {
    for (const x of reachableEntities(parsed, id)) otherReachable.add(x);
  }

  const shared = new Set();
  for (const id of ourReachable) {
    if (id !== bodyId && otherReachable.has(id)) shared.add(id);
  }

  if (shared.size === 0) {
    // Already independent — common case after a body has been edited
    // at least once. No work needed.
    return { set: ourReachable, cloned: 0 };
  }

  // Compute the next free id. Cheaper than Math.max(...Array.from(keys))
  // on a 149k-entry Map.
  let nextId = 0;
  for (const id of parsed.entities.keys()) if (id > nextId) nextId = id;
  nextId += 1;

  // Clone each shared entity.
  const idMap = new Map();
  for (const oldId of shared) {
    idMap.set(oldId, nextId++);
  }
  for (const [oldId, newId] of idMap) {
    const orig = parsed.entities.get(oldId);
    parsed.entities.set(newId, cloneEntity(orig, newId));
  }

  // Build the exclusive set: private originals + every clone.
  const exclusive = new Set();
  for (const id of ourReachable) {
    if (!shared.has(id)) exclusive.add(id);
  }
  for (const newId of idMap.values()) exclusive.add(newId);

  // Rewrite refs in every entity now exclusive to us.
  for (const id of exclusive) {
    rewriteEntityRefs(parsed.entities.get(id), idMap);
  }

  return { set: exclusive, cloned: idMap.size };
}

/** Deep-copy an entity with a new id. args arrays are duplicated so
 *  later in-place edits to the clone don't leak back to the original. */
function cloneEntity(orig, newId) {
  return {
    id: newId,
    type: orig.type,
    args: orig.args ? orig.args.slice() : null,
    compound: orig.compound
      ? orig.compound.map(p => ({
          id: p.id, type: p.type,
          args: p.args ? p.args.slice() : null,
          compound: null,
        }))
      : null,
  };
}

/** Rewrite every #oldId → #newId reference in an entity's args, in
 *  place. Walks each arg string with a small state machine so a `#`
 *  inside a quoted label is left alone. */
function rewriteEntityRefs(entity, idMap) {
  if (!entity) return;
  if (entity.args) {
    for (let i = 0; i < entity.args.length; i++) {
      entity.args[i] = rewriteRefsInString(entity.args[i], idMap);
    }
  }
  if (entity.compound) {
    for (const p of entity.compound) {
      if (!p.args) continue;
      for (let i = 0; i < p.args.length; i++) {
        p.args[i] = rewriteRefsInString(p.args[i], idMap);
      }
    }
  }
}

function rewriteRefsInString(s, idMap) {
  if (typeof s !== 'string' || s.indexOf('#') < 0) return s;
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === "'") {
        if (s[i + 1] === "'") { out += "'"; i += 2; continue; }
        inStr = false;
      }
      i++;
      continue;
    }
    if (c === "'") { inStr = true; out += c; i++; continue; }
    if (c === '#') {
      let j = i + 1;
      while (j < s.length && s.charCodeAt(j) >= 48 && s.charCodeAt(j) <= 57) j++;
      if (j > i + 1) {
        const oldId = Number(s.slice(i + 1, j));
        out += idMap.has(oldId) ? '#' + idMap.get(oldId) : s.slice(i, j);
        i = j;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Walk a single arg token and append every `#N` reference it contains
 * to the BFS queue. Handles both bare references (`#14`) and lists
 * containing references (`(#10,#11,#12)`).
 */
function collectRefs(arg, seen, queue, parsed) {
  // Fast path: a single bare reference like "#1234".
  if (arg.length && arg[0] === '#') {
    const id = Number(arg.slice(1));
    if (Number.isFinite(id) && parsed.entities.has(id) && !seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
    return;
  }
  // List-like arg: walk it. We deliberately don't go fully recursive
  // here — a regex sweep is enough because #N tokens can't be nested
  // inside string literals (those use single quotes).
  if (arg.indexOf('#') < 0) return;
  // Strip quoted-string regions so a `#` inside a label doesn't
  // accidentally match.
  const cleaned = arg.replace(/'(?:''|[^'])*'/g, '');
  const re = /#(\d+)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    const id = Number(m[1]);
    if (Number.isFinite(id) && parsed.entities.has(id) && !seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  }
}

/**
 * Parse a STEP tuple like `(0., 1.5, -3.14)` into JS numbers.
 * Tolerates the `1.E-7` scientific form used by ST-DEVELOPER files.
 */
function parseTuple(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t[0] !== '(' || t[t.length - 1] !== ')') return null;
  const inner = t.slice(1, -1);
  const tokens = tokenizeArgs(inner);
  const out = [];
  for (const tok of tokens) {
    const n = Number(tok.trim());
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────
 * arrayBody — linear copy array (Pattern tool)
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Duplicate a body `count-1` extra times (so total = count) along an axis.
 *
 * @param {object} parsed  — ParsedStep result from stp-parser.js
 * @param {string} bodyName — body name as returned by findBodies()
 * @param {'x'|'y'|'z'} axis — array direction
 * @param {number} count    — total copies (≥ 2)
 * @param {number} spacing  — distance between copies in model units (mm)
 * @returns {object} mutated `parsed` with extra bodies added, or `parsed` unchanged if body not found
 */
export function arrayBody(parsed, bodyName, axis, count, spacing) {
  if (!parsed || count < 2 || spacing === 0) return parsed;

  const bodies = findBodies(parsed);
  const bodyInfo = bodies.find(b => b.name === bodyName);
  if (!bodyInfo) {
    console.warn('[arrayBody] body not found:', bodyName);
    return parsed;
  }

  // Axis offset vector
  const dx = axis === 'x' ? spacing : 0;
  const dy = axis === 'y' ? spacing : 0;
  const dz = axis === 'z' ? spacing : 0;

  // Find the highest existing entity ID so we can allocate fresh ones.
  let maxId = 0;
  for (const id of parsed.entities.keys()) if (id > maxId) maxId = id;

  for (let copy = 1; copy < count; copy++) {
    const offsetX = dx * copy;
    const offsetY = dy * copy;
    const offsetZ = dz * copy;

    // Deep-clone the body's entire subgraph with new IDs.
    const subgraph = reachableEntities(parsed, bodyInfo.id);
    const idMap = new Map();  // old id → new id

    // First pass: allocate new IDs for every entity in the subgraph.
    for (const oldId of subgraph) {
      idMap.set(oldId, ++maxId);
    }

    // Second pass: clone and add entities with remapped references.
    for (const oldId of subgraph) {
      const orig  = parsed.entities.get(oldId);
      const newId = idMap.get(oldId);
      const clone = cloneEntity(orig, newId);
      rewriteEntityRefs(clone, idMap);
      parsed.entities.set(newId, clone);
    }

    // Third pass: translate all CARTESIAN_POINTs in the cloned subgraph.
    for (const [, newId] of idMap) {
      const e = parsed.entities.get(newId);
      if (!e) continue;
      const type = e.type || (e.compound && e.compound[0] && e.compound[0].type);
      if (type !== 'CARTESIAN_POINT') continue;
      const args = e.args || (e.compound && e.compound[0] && e.compound[0].args) || [];
      if (args.length < 2) continue;
      const coords = parseTuple(args[1]);
      if (!coords || coords.length < 3) continue;
      coords[0] += offsetX;
      coords[1] += offsetY;
      coords[2] += offsetZ;
      const newTuple = `(${coords.map(formatNum).join(',')})`;
      if (e.args) {
        e.args[1] = newTuple;
      } else if (e.compound && e.compound[0]) {
        e.compound[0].args[1] = newTuple;
      }
    }
  }

  return parsed;
}

/**
 * Format a JS number for STEP output. STEP requires every float to have
 * an explicit decimal point (`0.` not `0`), and scientific notation
 * uses uppercase `E`. We keep precision generous (1e-9) so a round-trip
 * doesn't visibly drift after a single transform.
 */
function formatNum(n) {
  if (!Number.isFinite(n)) return '0.';
  if (n === 0) return '0.';
  // Mirror stepWriter.js's strategy: toPrecision(9) for body-of-zeros
  // suppression, then ensure a trailing decimal point.
  let s = n.toPrecision(9);
  // Drop scientific E0 results like "1.23e+0" → "1.23"
  if (/e[+-]?0+$/i.test(s)) s = s.replace(/e[+-]?0+$/i, '');
  if (/[eE]/.test(s)) {
    // Normalize to uppercase E for STEP. Strip leading zeros in the exp.
    s = s.replace(/[eE]([+-]?)0*(\d+)/, (_, sign, digits) => `E${sign}${digits}`);
    return s;
  }
  // Strip trailing zeros in the fractional part but keep at least one.
  if (s.includes('.')) {
    s = s.replace(/(\.\d*?)0+$/, '$1');
    if (s.endsWith('.')) return s;
    return s;
  }
  return s + '.';
}

function stripQuotes(s) {
  const t = s.trim();
  if (t.length < 2 || t[0] !== "'" || t[t.length - 1] !== "'") return t;
  return t.slice(1, -1).replace(/''/g, "'");
}
