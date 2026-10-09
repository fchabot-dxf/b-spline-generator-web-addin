/**
 * 2026-10-09 (seat A; the phone map, photo board: Adaptive display / Colour edges / thicken toggles re-ran the whole
 * heightmap): core/engine/rebuild.js reuses the last heights when only HEIGHTS_INERT_KEYS changed. Pinned two ways:
 *   1. completeness, from the code itself: no listed key is named anywhere in the heights stage -- buildHeights and
 *      _collectStampPasses in rebuild.js, plus the import closure of terrain.js and apply-stamp-layers.js (followed
 *      here, not listed) -- and that code never reads its params by a computed name the scan could not see;
 *   2. identity: for every listed key, the build after changing ONLY that key (heights reused) hands the preview the
 *      same arrays, to the byte, as a full build of the same state -- and the REAL TerrainPreview.update (called on a
 *      mock `this`, three.js mocked: no WebGL here) builds the same mesh from them: positions, index, colours, uvs,
 *      the solid's bottom, the iso curves. Normals are three's computeVertexNormals of those positions + index.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rebuild, HEIGHTS_INERT_KEYS, REBUILD_INERT_KEYS, heightsInputDigest, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';

const HTML = 'bspline-frame-builder/b-spline-gen/html';
const read = (rel) => readFileSync(path.join(HTML, rel), 'utf8');
/**
 * The code only: comments, string text and regex literals blanked -- EXCEPT a string literal used as a property name in
 * code (obj['x'], 'x' in obj): it stays as "x", so a key read by literal still counts as a read. Template literals keep
 * their ${...} code. (A tweak's description text naming a key is not a read; obj['key'] is.)
 */
function codeOnly(src) {
  let out = '', prev = '';
  const n = src.length;
  const emit = (s) => { out += s; const t = s.trim(); if (t) prev = t[t.length - 1]; };
  const regexMayStart = () => !prev || '(,=:[!&|?{};+-*%<>~^'.includes(prev);
  function template(i) { // i: just after the opening backtick
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') return i + 1;
      if (src[i] === '$' && src[i + 1] === '{') { emit(' ${ '); i = code(i + 2, true); emit(' } '); continue; }
      i++;
    }
    return n;
  }
  function code(i, untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
      if (c === '/' && regexMayStart()) {
        let j = i + 1, inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; else if (src[j] === '/' && !inClass) break;
          j++;
        }
        i = j + 1; while (i < n && /[a-z]/.test(src[i])) i++;
        emit(' /re/ '); continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
        const text = src.slice(i + 1, j), next = src.slice(j + 1, j + 40).match(/^\s*(\]|in\b)/);
        const asKey = next && (next[1] === 'in' || prev === '[');
        emit(asKey ? ` "${text}" ` : ' "" ');
        i = j + 1; continue;
      }
      if (c === '`') { emit(' `` '); i = template(i + 1); continue; }
      if (c === '{') depth++;
      if (c === '}') { if (untilBrace && depth === 0) return i + 1; depth--; }
      emit(c); i++;
    }
    return n;
  }
  code(0, false);
  return out;
}

/** The heights stage's source: rebuild.js's own two functions + every module terrain.js / apply-stamp-layers.js import. */
function heightsStageSource() {
  const rb = read('core/engine/rebuild.js');
  const a = rb.indexOf('function buildHeights('), b = rb.indexOf('\n}\n', rb.indexOf('export function _collectStampPasses('));
  expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a);
  const files = new Set(), queue = ['core/terrain.js', 'core/engine/apply-stamp-layers.js'];
  while (queue.length) {
    const f = queue.pop(); if (files.has(f)) continue; files.add(f);
    for (const m of read(f).matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g))
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
  }
  return { files, code: [rb.slice(a, b), ...[...files].map(read)].map(codeOnly).join('\n') };
}

describe('HEIGHTS_INERT_KEYS: completeness, from the heights stage code', () => {
  const { files, code } = heightsStageSource();

  it('the scan reads the real closure (terrain, the noise + seed modules, the photo filter, the stamp layers)', () => {
    for (const f of ['core/terrain.js', 'core/noise/index.js', 'core/noise/photo.js', 'core/seed/index.js', 'core/photo/state.js', 'core/engine/apply-stamp-layers.js'])
      expect(files.has(f), f).toBe(true);
    for (const k of ['seed', 'smoothRadius', 'noiseType', 'edgeMarginIn', 'stampDepth', 'photoEdits']) expect(code).toMatch(new RegExp(`\\b${k}\\b`)); // keys it does read
  });

  it('every listed key is a real P key and is never named in the heights stage', () => {
    for (const k of HEIGHTS_INERT_KEYS) {
      expect(k in DEFAULT, `${k} is not a P key`).toBe(true);
      expect(new RegExp(`\\b${k}\\b`).test(code), `the heights stage names ${k}: it is a heights input`).toBe(false);
    }
  });

  it('the heights stage never reads its params / P by a computed name (the scan could not see that key)', () => {
    expect(code.match(/\b(params|modeParams|P|opts|options|tweaks)\s*\[(?!\s*['"`])/g)).toBe(null);
  });

  it('the code-only scan keeps literal key reads and drops only text (its own cases + a tripwire on the real code)', () => {
    const c = codeOnly("const a = params['kA']; const b = P[ \"kB\" ]; if ('kC' in p) {} const r = /['\"]kR/g;\n" +
      "const s = { desc: 'kD text' }; // kE\n const t = `kF ${params.kG + `kH`} kI`; /* kJ */ const u = x / 2; const w = 'kK';");
    for (const k of ['kA', 'kB', 'kC', 'kG', 'w', 'u']) expect(c, k).toMatch(new RegExp(`\\b${k}\\b`));
    for (const k of ['kR', 'kD', 'kE', 'kF', 'kH', 'kI', 'kJ', 'kK']) expect(c, k).not.toMatch(new RegExp(`\\b${k}\\b`));
    // Tripwire: dropping string text frees exactly these P keys beyond a comments-only strip. A scanner bug that blanked
    // real code would free more.
    const commentsOnly = [...files].map((f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')).join('\n');
    const freed = Object.keys(DEFAULT).filter((k) => new RegExp(`\\b${k}\\b`).test(commentsOnly) && !new RegExp(`\\b${k}\\b`).test(code));
    expect(freed).toEqual(['thickness']); // core/noise/chest.js: a tweak's description text ('flesh thickness')
  });
});

// ── identity: reused heights == a full build, for every listed key ──────────────────────────────────────────────

/** Another valid value per listed key (booleans flip, numbers move); a new key must declare one here. */
const ALT = {
  thickenDir: 'up', thickenMode: 'uniform', exportOrientation: 'y-up', decalResolution: '300', decalLayerIds: { layer0: true },
  frame: { templateId: 'template1' }, photoPatternId: 'brick', editorSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  stampLayers: [], activeLayerIdx: 1, spacing: 0.06, exportSpacing: 0.02,
  brickSettings: { ...DEFAULT.brickSettings, brickLengthIn: 2 },
};
const altOf = (k) => (k in ALT ? ALT[k] : typeof DEFAULT[k] === 'boolean' ? !P[k] : typeof P[k] === 'number' ? P[k] * 1.5 + 0.05 : undefined);

/** three.js stand-in: every class records its constructor args; geometries keep attributes + index. */
const THREE = new Proxy({}, {
  get(t, name) {
    if (!(name in t)) t[name] = class {
      constructor(...args) { this.type = name; this.args = args; this.attributes = {}; this.index = null; this.children = []; this.userData = {}; this.position = { set() {}, copy() {} };
        if (name === 'BufferAttribute') [this.array, this.itemSize] = args;
        else if (args.length && args[0] && args[0].attributes) [this.geometry, this.material] = args; } // Mesh / Line
      setAttribute(k, a) { this.attributes[k] = a; return this; } setIndex(i) { this.index = i; return this; }
      setFromPoints(p) { this.points = p; return this; } add(o) { this.children.push(o); return this; }
      computeVertexNormals() { this.normalsFrom = 'position+index'; } computeBoundingBox() {} computeBoundingSphere() {} dispose() {}
      clone() { const c = new t[name](...this.args); Object.assign(c, this); return c; }
    };
    return t[name];
  },
});
function mockPreview() {
  const scene = [];
  return {
    _THREE: THREE, _dispose() {}, _groundGrid: { update() {} }, _sculpt: { getConfig: () => null, reapplySelection() {} },
    _scene: { add: (o) => scene.push(o) }, _orbit: { setTargetZ() {}, fitToStock() {} }, _resize() {}, _leaders: { setData() {} },
    _applyFrame() { this.frameGrid = this._lastGrid; }, _visibleWorstPts() { return this._worstPts; }, _rebuildDrapeMesh() {},
    _curvesVisible: false, _lastW: 0, _lastH: 0, _solidMeshes: [], scene,
    update(...args) { this.args = args; return TerrainPreview.prototype.update.apply(this, args); },
  };
}
/** One digest of everything the preview was handed and built (typed arrays by their bytes). */
function digestOf(preview) {
  const h = createHash('sha1'), seen = new Set();
  const walk = (v) => {
    if (ArrayBuffer.isView(v)) { h.update(`${v.constructor.name}:`); h.update(Buffer.from(v.buffer, v.byteOffset, v.byteLength)); return; }
    if (typeof v === 'function') return;
    if (v && typeof v === 'object') {
      if (seen.has(v)) { h.update('@'); return; } seen.add(v);
      for (const k of Object.keys(v).sort()) { if (k === '_THREE' || k === 'scene' && v !== preview) continue; h.update(k); walk(v[k]); }
      return;
    }
    h.update(JSON.stringify(v ?? null));
  };
  walk({ args: preview.args, scene: preview.scene, frameGrid: preview.frameGrid, mesh: preview._mesh, curves: preview._curves });
  return h.digest('hex');
}
const noop = () => {};
const saved = {};
const setP = (k, v) => { if (!(k in saved)) saved[k] = P[k]; P[k] = v; };
afterEach(() => { for (const [k, v] of Object.entries(saved)) P[k] = v; for (const k of Object.keys(saved)) delete saved[k]; _forgetHeights(); });

describe('HEIGHTS_INERT_KEYS: a build that reuses the heights equals a full build', () => {
  it('every listed key declares another value to test with', () => {
    for (const k of HEIGHTS_INERT_KEYS) expect(altOf(k), k).not.toBe(undefined);
    for (const k of HEIGHTS_INERT_KEYS) expect(REBUILD_INERT_KEYS.has(k), `${k} is already in REBUILD_INERT_KEYS`).toBe(false);
  });

  // A real board: smoothing on (the boxFilter), a non-default terrain, the thicken step on (a solid with a bottom).
  const BOARD = { widthIn: 5, heightIn: 6, spacing: 0.1, smoothIntensity: 0.6, smoothRadius: 0.8, noiseType: 'eroded', thickenEnabled: true };
  for (const key of [...HEIGHTS_INERT_KEYS]) {
    it(`${key}: reused heights -> the same preview arrays + mesh as a full build`, async () => {
      for (const [k, v] of Object.entries(BOARD)) setP(k, v);
      _forgetHeights();
      await rebuild(mockPreview(), noop, noop); // warm: the heights of BOARD are cached
      const d0 = heightsInputDigest(lastResult.nx, lastResult.nz);
      setP(key, altOf(key));
      expect(heightsInputDigest(lastResult.nx, lastResult.nz), 'the change keeps the heights inputs: the reuse path runs').toBe(d0);
      const reused = mockPreview();
      await rebuild(reused, noop, noop);
      const reusedHeights = lastResult.heights.slice();
      _forgetHeights();
      const full = mockPreview(); // a new preview object: item 69's digest differs, so this build runs whole
      await rebuild(full, noop, noop);
      expect(reused.args, 'the reused build reached the preview').toBeTruthy();
      expect(reused._mesh.geometry.attributes.position.array.length).toBeGreaterThan(100);
      expect(Buffer.from(lastResult.heights.buffer).equals(Buffer.from(reusedHeights.buffer))).toBe(true);
      expect(digestOf(reused)).toBe(digestOf(full));
    }, 60000);
  }

  it('a heights input still rebuilds the heights (the cache is not a stale shortcut)', async () => {
    for (const [k, v] of Object.entries(BOARD)) setP(k, v);
    _forgetHeights();
    await rebuild(mockPreview(), noop, noop);
    const d0 = heightsInputDigest(51, 61), h0 = lastResult.heights.slice();
    setP('seed', (P.seed || 0) + 7);
    expect(heightsInputDigest(51, 61)).not.toBe(d0);
    await rebuild(mockPreview(), noop, noop);
    expect(Buffer.from(lastResult.heights.buffer).equals(Buffer.from(h0.buffer))).toBe(false);
  });
});
