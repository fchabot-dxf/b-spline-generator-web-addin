/**
 * text-glyphs.js — load TTF fonts via opentype.js and extract 2D
 * glyph outlines for the Text tool.
 *
 * SELF-CONTAINED: only depends on `window.opentype`, which the palette
 * HTML loads from the unpkg CDN. No imports from sibling modules.
 *
 * Why opentype.js: it parses every TTF/OTF table we need (cmap, glyf,
 * loca, hmtx, kern) and exposes glyph outlines as a Path object with
 * moveTo / lineTo / quadraticCurveTo / curveTo / close commands —
 * exactly the format we need to flatten into polylines for extrusion.
 *
 * Public API:
 *   listFonts()              → array of {file, label, family, style}
 *   loadFont(file)           → Promise<opentype.Font>
 *   layoutText(text, font, opts) → { glyphs: [{contours, advanceX}], bbox }
 *
 * Contours are arrays of points in font units (then scaled to caller's
 * units). Each contour is a closed polyline. A glyph (e.g. "O") may
 * have multiple contours — the outer outline plus an inner hole; the
 * caller treats outers vs. inners by winding order (CW vs. CCW).
 */

/** Static font catalogue. Mirrors the .ttf files in step-editor/html/fonts/.
 *  Adding a font on disk: also add a row here. Faster than parsing a
 *  directory listing (which we can't do from JS in a file:// context). */
const FONT_CATALOGUE = [
  { file: 'CascadiaCode-Regular.ttf', label: 'Cascadia Code',         family: 'Cascadia Code',    style: 'regular' },
  { file: 'CascadiaCode-Bold.ttf',    label: 'Cascadia Code Bold',    family: 'Cascadia Code',    style: 'bold'    },
  { file: 'CascadiaMono-Regular.ttf', label: 'Cascadia Mono',         family: 'Cascadia Mono',    style: 'regular' },
  { file: 'CascadiaMono-Bold.ttf',    label: 'Cascadia Mono Bold',    family: 'Cascadia Mono',    style: 'bold'    },
  { file: 'arial.ttf',                label: 'Arial',                 family: 'Arial',            style: 'regular' },
  { file: 'arial-bold.ttf',           label: 'Arial Bold',            family: 'Arial',            style: 'bold'    },
  { file: 'times.ttf',                label: 'Times New Roman',       family: 'Times',            style: 'regular' },
  { file: 'times-bold.ttf',           label: 'Times New Roman Bold',  family: 'Times',            style: 'bold'    },
  { file: 'courier.ttf',              label: 'Courier New',           family: 'Courier',          style: 'regular' },
  { file: 'courier-bold.ttf',         label: 'Courier New Bold',      family: 'Courier',          style: 'bold'    },
  { file: 'georgia.ttf',              label: 'Georgia',               family: 'Georgia',          style: 'regular' },
  { file: 'georgia-bold.ttf',         label: 'Georgia Bold',          family: 'Georgia',          style: 'bold'    },
  { file: 'verdana.ttf',              label: 'Verdana',               family: 'Verdana',          style: 'regular' },
  { file: 'verdana-bold.ttf',         label: 'Verdana Bold',          family: 'Verdana',          style: 'bold'    },
  { file: 'tahoma.ttf',               label: 'Tahoma',                family: 'Tahoma',           style: 'regular' },
  { file: 'tahoma-bold.ttf',          label: 'Tahoma Bold',           family: 'Tahoma',           style: 'bold'    },
  { file: 'bahnschrift.ttf',          label: 'Bahnschrift',           family: 'Bahnschrift',      style: 'regular' },
  { file: 'impact.ttf',               label: 'Impact',                family: 'Impact',           style: 'regular' },
  { file: 'webdings.ttf',             label: 'Webdings',              family: 'Webdings',         style: 'symbol'  },
  { file: 'wingdings.ttf',            label: 'Wingdings',             family: 'Wingdings',        style: 'symbol'  },
  { file: 'symbol.ttf',               label: 'Symbol',                family: 'Symbol',           style: 'symbol'  },
];

/** Font path is computed relative to this module so the same code works
 *  whether the palette is served from the canonical addin path or a
 *  cache-busted copy. (`import.meta.url` resolves to the module URL.) */
function fontUrl(file) {
  return new URL(`../fonts/${file}`, import.meta.url).href;
}

const _fontCache = new Map(); // file → opentype.Font

/** Return the catalogue of fonts the tool can offer in its dropdown. */
export function listFonts() {
  return FONT_CATALOGUE.slice();
}

/**
 * Fetch + parse a font. Cached per palette session — subsequent calls
 * for the same file resolve immediately.
 *
 * @param {string} file  filename from `listFonts()`
 * @returns {Promise<object>} an opentype.js Font instance
 */
export async function loadFont(file) {
  if (_fontCache.has(file)) return _fontCache.get(file);
  if (typeof window === 'undefined' || !window.opentype) {
    throw new Error('opentype.js not loaded — check the <script> tag in step_editor_palette.html');
  }
  const url = fontUrl(file);
  const buf = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`failed to fetch ${file}: ${r.status}`);
    return r.arrayBuffer();
  });
  const font = window.opentype.parse(buf);
  _fontCache.set(file, font);
  return font;
}

/**
 * Lay out a string in the given font and flatten every glyph to closed
 * polyline contours.
 *
 * @param {string} text
 * @param {object} font  opentype.js Font instance
 * @param {object} [opts]
 * @param {number} [opts.size=10]        font size in caller's units (mm by default)
 * @param {number} [opts.flatness=0.25]  curve flattening tolerance, in caller's units
 * @returns {{
 *   glyphs: Array<{ contours: Array<Array<{x:number,y:number}>>, advanceX:number }>,
 *   bbox:   { min:[number,number], max:[number,number] }
 * }}
 */
export function layoutText(text, font, opts = {}) {
  const size = Number(opts.size) > 0 ? Number(opts.size) : 10;
  const flatness = Number(opts.flatness) > 0 ? Number(opts.flatness) : 0.25;

  // opentype.js gives positions in font units; scale = size / unitsPerEm.
  const scale = size / font.unitsPerEm;
  const glyphs = [];
  let penX = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Pull glyphs for each character. font.stringToGlyphs handles surrogate
  // pairs and basic shaping; advance widths use hmtx.
  const stringGlyphs = font.stringToGlyphs(text);
  for (let i = 0; i < stringGlyphs.length; i++) {
    const g = stringGlyphs[i];
    const path = g.getPath(0, 0, font.unitsPerEm);  // path in font units, baseline at y=0
    const contours = flattenPath(path, font.unitsPerEm, scale, flatness, penX, 0);

    const advanceUnits = g.advanceWidth;
    const advanceX = advanceUnits * scale;
    glyphs.push({ contours, advanceX });

    for (const c of contours) {
      for (const p of c) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
    penX += advanceX;
  }

  if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minY = 0; maxY = 0; }
  return { glyphs, bbox: { min: [minX, minY], max: [maxX, maxY] } };
}

/* ────────────────────────────────────────────────────────────────────
 * Private — opentype Path → closed polyline contours
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Walk opentype's Path command list and emit closed polyline contours.
 * Quadratic (TTF) and cubic (OTF/CFF) Bezier curves are flattened by
 * recursive midpoint subdivision until each segment's deviation from
 * straight is below `flatness` (in output units).
 *
 * @param {object} path        opentype.Path
 * @param {number} unitsPerEm  font's units-per-em (for scale-aware flatness)
 * @param {number} scale       output-unit scale (size / unitsPerEm)
 * @param {number} flatness    curve-deviation tolerance in OUTPUT units
 * @param {number} originX     x-offset applied to every output point (the pen X for this glyph)
 * @param {number} originY     y-offset applied to every output point
 * @returns {Array<Array<{x,y}>>}  one entry per contour
 */
function flattenPath(path, unitsPerEm, scale, flatness, originX, originY) {
  const contours = [];
  let current = null;
  let cursorX = 0, cursorY = 0;
  let startX = 0, startY = 0;

  const emit = (x, y) => {
    if (!current) current = [];
    current.push({ x: originX + x * scale, y: originY + y * scale });
  };

  // Flatness in font units (Bezier subdivision works in font units).
  const fontFlatness = flatness / scale;

  for (const cmd of path.commands) {
    if (cmd.type === 'M') {
      if (current && current.length > 1) contours.push(current);
      current = [];
      cursorX = cmd.x; cursorY = cmd.y;
      startX = cmd.x; startY = cmd.y;
      emit(cursorX, cursorY);
    } else if (cmd.type === 'L') {
      cursorX = cmd.x; cursorY = cmd.y;
      emit(cursorX, cursorY);
    } else if (cmd.type === 'Q') {
      flattenQuad(cursorX, cursorY, cmd.x1, cmd.y1, cmd.x, cmd.y, fontFlatness, emit);
      cursorX = cmd.x; cursorY = cmd.y;
    } else if (cmd.type === 'C') {
      flattenCubic(cursorX, cursorY, cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y, fontFlatness, emit);
      cursorX = cmd.x; cursorY = cmd.y;
    } else if (cmd.type === 'Z') {
      // Close the contour by moving back to the start.
      if (cursorX !== startX || cursorY !== startY) {
        emit(startX, startY);
      }
      if (current && current.length > 1) contours.push(current);
      current = null;
    }
  }
  if (current && current.length > 1) contours.push(current);
  return contours;
}

/** Recursive midpoint subdivision of a quadratic Bezier. Stops when
 *  the control point's perpendicular distance to the chord falls
 *  below `flatness`. Emits each visited end point. */
function flattenQuad(x0, y0, x1, y1, x2, y2, flatness, emit, depth = 0) {
  // Distance from control point to chord.
  const d = pointToLine(x1, y1, x0, y0, x2, y2);
  if (d <= flatness || depth > 16) {
    emit(x2, y2);
    return;
  }
  const m01x = (x0 + x1) * 0.5, m01y = (y0 + y1) * 0.5;
  const m12x = (x1 + x2) * 0.5, m12y = (y1 + y2) * 0.5;
  const mx   = (m01x + m12x) * 0.5, my = (m01y + m12y) * 0.5;
  flattenQuad(x0, y0, m01x, m01y, mx, my, flatness, emit, depth + 1);
  flattenQuad(mx, my, m12x, m12y, x2, y2, flatness, emit, depth + 1);
}

/** Same idea, cubic Bezier. Two control points, two perp distances. */
function flattenCubic(x0, y0, x1, y1, x2, y2, x3, y3, flatness, emit, depth = 0) {
  const d1 = pointToLine(x1, y1, x0, y0, x3, y3);
  const d2 = pointToLine(x2, y2, x0, y0, x3, y3);
  if (Math.max(d1, d2) <= flatness || depth > 16) {
    emit(x3, y3);
    return;
  }
  // De Casteljau split at t=0.5.
  const m01x = (x0 + x1) * 0.5, m01y = (y0 + y1) * 0.5;
  const m12x = (x1 + x2) * 0.5, m12y = (y1 + y2) * 0.5;
  const m23x = (x2 + x3) * 0.5, m23y = (y2 + y3) * 0.5;
  const m012x = (m01x + m12x) * 0.5, m012y = (m01y + m12y) * 0.5;
  const m123x = (m12x + m23x) * 0.5, m123y = (m12y + m23y) * 0.5;
  const mx = (m012x + m123x) * 0.5,  my = (m012y + m123y) * 0.5;
  flattenCubic(x0, y0, m01x, m01y, m012x, m012y, mx, my, flatness, emit, depth + 1);
  flattenCubic(mx, my, m123x, m123y, m23x, m23y, x3, y3, flatness, emit, depth + 1);
}

/** Perpendicular distance from (px, py) to the line through (ax, ay)-(bx, by). */
function pointToLine(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
  // 2 * triangle area / base length
  const cross = Math.abs((px - ax) * dy - (py - ay) * dx);
  return cross / Math.sqrt(len2);
}
