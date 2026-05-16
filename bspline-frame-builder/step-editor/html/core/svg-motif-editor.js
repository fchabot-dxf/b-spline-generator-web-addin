/**
 * svg-motif-editor.js — Lightweight self-contained SVG motif editor.
 * No external dependencies — uses native SVG DOM API only.
 *
 * Usage:
 *   const ed = new MotifEditor();
 *   ed.mount(containerEl, { width: 400, height: 400 });
 *   ed.setOnChange(svgString => console.log(svgString));
 *   ed.setTool('pen');
 *
 * API:
 *   mount(el, {width, height})  — attach to DOM element, create SVG canvas
 *   destroy()                   — detach and remove listeners
 *   setTool(name)               — 'select'|'pen'|'line'|'rect'|'ellipse'
 *   setStrokeColor(hex)
 *   setStrokeWidth(px)
 *   setFillColor(hex|'none')
 *   setOnChange(fn)             — fn(svgString) called after each commit
 *   save()                      — returns SVG string (current content only)
 *   load(svgString)             — replace content from SVG string
 *   clear()                     — delete all shapes
 *   undo() / redo()
 */

'use strict';

// ─── Ramer-Douglas-Peucker polyline simplification ───────────────────────────
function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  let maxDist = 0, maxIdx = 0;
  const first = points[0], last = points[points.length - 1];
  const dx = last.x - first.x, dy = last.y - first.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  for (let i = 1; i < points.length - 1; i++) {
    let d;
    if (len === 0) {
      const ex = points[i].x - first.x, ey = points[i].y - first.y;
      d = Math.sqrt(ex * ex + ey * ey);
    } else {
      d = Math.abs(dy * points[i].x - dx * points[i].y + last.x * first.y - last.y * first.x) / len;
    }
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left  = rdp(points.slice(0, maxIdx + 1), epsilon);
    const right = rdp(points.slice(maxIdx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// ─── MotifEditor class ────────────────────────────────────────────────────────
class MotifEditor {
  constructor() {
    this._container  = null;
    this._svg        = null;      // <svg> element
    this._defs       = null;      // <defs> element
    this._layer      = null;      // <g> for shapes
    this._selBox     = null;      // selection highlight rect
    this._tool       = 'pen';
    this._stroke     = '#ffffff';
    this._fill       = 'none';
    this._strokeW    = 2;
    this._onChange   = null;
    this._shapes     = [];        // [{el, type}]
    this._undoStack  = [];        // [serialised string]
    this._redoStack  = [];
    this._selected   = null;      // selected shape el
    this._drawing    = false;
    this._penPts     = [];        // raw points during pen stroke
    this._dragStart  = null;
    this._origPos    = null;      // for move drag
    this._w = 400; this._h = 400;
    this._bound = {};             // event listeners kept for removeEventListener
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  mount(containerEl, { width = 400, height = 400 } = {}) {
    this._w = width; this._h = height;
    this._container = containerEl;
    containerEl.style.position = 'relative';
    containerEl.style.cursor = 'crosshair';

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.style.display = 'block';
    svg.style.background = '#1e1e1e';
    svg.style.touchAction = 'none';

    this._defs = document.createElementNS(ns, 'defs');
    svg.appendChild(this._defs);

    // Checkerboard pattern for visual reference
    const pat = document.createElementNS(ns, 'pattern');
    pat.id = '_me_checker';
    pat.setAttribute('x', '0'); pat.setAttribute('y', '0');
    pat.setAttribute('width', '20'); pat.setAttribute('height', '20');
    pat.setAttribute('patternUnits', 'userSpaceOnUse');
    const r1 = document.createElementNS(ns, 'rect');
    r1.setAttribute('width', '20'); r1.setAttribute('height', '20');
    r1.setAttribute('fill', '#2a2a2a');
    const r2 = document.createElementNS(ns, 'rect');
    r2.setAttribute('width', '10'); r2.setAttribute('height', '10');
    r2.setAttribute('fill', '#333');
    const r3 = document.createElementNS(ns, 'rect');
    r3.setAttribute('x', '10'); r3.setAttribute('y', '10');
    r3.setAttribute('width', '10'); r3.setAttribute('height', '10');
    r3.setAttribute('fill', '#333');
    pat.appendChild(r1); pat.appendChild(r2); pat.appendChild(r3);
    this._defs.appendChild(pat);

    const bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', width); bg.setAttribute('height', height);
    bg.setAttribute('fill', 'url(#_me_checker)');
    svg.appendChild(bg);

    this._layer = document.createElementNS(ns, 'g');
    svg.appendChild(this._layer);

    // Selection highlight (drawn on top)
    this._selBox = document.createElementNS(ns, 'rect');
    this._selBox.setAttribute('fill', 'none');
    this._selBox.setAttribute('stroke', '#4af');
    this._selBox.setAttribute('stroke-width', '1');
    this._selBox.setAttribute('stroke-dasharray', '4 2');
    this._selBox.setAttribute('pointer-events', 'none');
    this._selBox.style.display = 'none';
    svg.appendChild(this._selBox);

    containerEl.appendChild(svg);
    this._svg = svg;

    // Bind events
    const onDown  = e => this._onDown(e);
    const onMove  = e => this._onMove(e);
    const onUp    = e => this._onUp(e);
    const onLeave = e => { if (this._drawing) this._onUp(e); };
    svg.addEventListener('pointerdown',  onDown);
    svg.addEventListener('pointermove',  onMove);
    svg.addEventListener('pointerup',    onUp);
    svg.addEventListener('pointerleave', onLeave);
    this._bound = { onDown, onMove, onUp, onLeave };
  }

  destroy() {
    if (!this._svg) return;
    const { onDown, onMove, onUp, onLeave } = this._bound;
    this._svg.removeEventListener('pointerdown',  onDown);
    this._svg.removeEventListener('pointermove',  onMove);
    this._svg.removeEventListener('pointerup',    onUp);
    this._svg.removeEventListener('pointerleave', onLeave);
    this._container.removeChild(this._svg);
    this._svg = null;
  }

  setTool(name)          { this._tool = name; this._deselect(); }
  setStrokeColor(hex)    { this._stroke = hex; }
  setFillColor(hex)      { this._fill = hex; }
  setStrokeWidth(px)     { this._strokeW = Math.max(0.5, Number(px) || 2); }
  setOnChange(fn)        { this._onChange = fn; }

  undo() {
    if (this._undoStack.length === 0) return;
    this._redoStack.push(this._serialiseLayer());
    this._deserialiseLayer(this._undoStack.pop());
    this._deselect();
    this._emit();
  }

  redo() {
    if (this._redoStack.length === 0) return;
    this._undoStack.push(this._serialiseLayer());
    this._deserialiseLayer(this._redoStack.pop());
    this._deselect();
    this._emit();
  }

  clear() {
    this._pushUndo();
    while (this._layer.firstChild) this._layer.removeChild(this._layer.firstChild);
    this._shapes = [];
    this._deselect();
    this._emit();
  }

  /** Returns a self-contained SVG string ready for tiling. */
  save() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('width',   this._w);
    svg.setAttribute('height',  this._h);
    svg.setAttribute('viewBox', `0 0 ${this._w} ${this._h}`);
    // Clone only the shapes layer (no background, no selection box)
    svg.appendChild(this._layer.cloneNode(true));
    const s = new XMLSerializer();
    return s.serializeToString(svg);
  }

  /** Replace editor content from an SVG string. */
  load(svgString) {
    this._pushUndo();
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');
      const srcSvg = doc.documentElement;
      // Try to extract the first <g> as the layer, or all direct shape children
      const g = srcSvg.querySelector('g');
      if (g) {
        while (this._layer.firstChild) this._layer.removeChild(this._layer.firstChild);
        Array.from(g.childNodes).forEach(n => this._layer.appendChild(document.importNode(n, true)));
      } else {
        while (this._layer.firstChild) this._layer.removeChild(this._layer.firstChild);
        Array.from(srcSvg.childNodes).forEach(n => {
          const tag = n.nodeName && n.nodeName.toLowerCase();
          if (['path','line','rect','ellipse','polyline','polygon','circle','text'].includes(tag)) {
            this._layer.appendChild(document.importNode(n, true));
          }
        });
      }
      this._rebuildShapesFromLayer();
      this._deselect();
      this._emit();
    } catch (e) {
      console.warn('MotifEditor.load() parse error:', e);
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _getPos(e) {
    const rect = this._svg.getBoundingClientRect();
    const scaleX = this._w / rect.width;
    const scaleY = this._h / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  _makeSvgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  _shapeAttrs() {
    return {
      stroke: this._stroke,
      'stroke-width': this._strokeW,
      fill: this._fill,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    };
  }

  _pushUndo() {
    this._undoStack.push(this._serialiseLayer());
    if (this._undoStack.length > 60) this._undoStack.shift();
    this._redoStack = [];
  }

  _serialiseLayer() {
    return this._layer.innerHTML;
  }

  _deserialiseLayer(html) {
    this._layer.innerHTML = html;
    this._rebuildShapesFromLayer();
  }

  _rebuildShapesFromLayer() {
    this._shapes = Array.from(this._layer.children).map(el => ({ el, type: el.nodeName }));
  }

  _emit() {
    if (this._onChange) this._onChange(this.save());
  }

  _deselect() {
    this._selected = null;
    if (this._selBox) this._selBox.style.display = 'none';
  }

  _showSelBox(el) {
    try {
      const bb = el.getBBox();
      const pad = 4;
      this._selBox.setAttribute('x',      bb.x - pad);
      this._selBox.setAttribute('y',      bb.y - pad);
      this._selBox.setAttribute('width',  bb.width  + pad * 2);
      this._selBox.setAttribute('height', bb.height + pad * 2);
      this._selBox.style.display = '';
    } catch (_) { /* getBBox may fail for invisible elements */ }
  }

  // ── Pointer event handlers ──────────────────────────────────────────────────

  _onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._svg.setPointerCapture(e.pointerId);
    const p = this._getPos(e);
    this._drawing = true;

    if (this._tool === 'select') {
      // Hit-test shapes in reverse order
      const hit = this._hitTest(p);
      if (hit) {
        this._selected = hit;
        this._dragStart = p;
        // Store current transform origin
        const tx = hit.getAttribute('data-tx') || '0';
        const ty = hit.getAttribute('data-ty') || '0';
        this._origPos = { x: parseFloat(tx), y: parseFloat(ty) };
        this._showSelBox(hit);
      } else {
        this._deselect();
      }
      return;
    }

    this._pushUndo();

    if (this._tool === 'pen') {
      this._penPts = [p];
      this._currentEl = this._makeSvgEl('polyline', {
        points: `${p.x},${p.y}`,
        ...this._shapeAttrs(),
      });
      this._layer.appendChild(this._currentEl);
      this._shapes.push({ el: this._currentEl, type: 'polyline' });
    } else if (this._tool === 'line') {
      this._currentEl = this._makeSvgEl('line', {
        x1: p.x, y1: p.y, x2: p.x, y2: p.y,
        ...this._shapeAttrs(),
      });
      this._layer.appendChild(this._currentEl);
      this._shapes.push({ el: this._currentEl, type: 'line' });
      this._dragStart = p;
    } else if (this._tool === 'rect') {
      this._currentEl = this._makeSvgEl('rect', {
        x: p.x, y: p.y, width: 0, height: 0,
        ...this._shapeAttrs(),
      });
      this._layer.appendChild(this._currentEl);
      this._shapes.push({ el: this._currentEl, type: 'rect' });
      this._dragStart = p;
    } else if (this._tool === 'ellipse') {
      this._currentEl = this._makeSvgEl('ellipse', {
        cx: p.x, cy: p.y, rx: 0, ry: 0,
        ...this._shapeAttrs(),
      });
      this._layer.appendChild(this._currentEl);
      this._shapes.push({ el: this._currentEl, type: 'ellipse' });
      this._dragStart = p;
    }
  }

  _onMove(e) {
    if (!this._drawing) return;
    const p = this._getPos(e);

    if (this._tool === 'select' && this._selected && this._dragStart) {
      const dx = p.x - this._dragStart.x;
      const dy = p.y - this._dragStart.y;
      const newTx = this._origPos.x + dx;
      const newTy = this._origPos.y + dy;
      this._selected.setAttribute('transform', `translate(${newTx},${newTy})`);
      this._selected.setAttribute('data-tx', newTx);
      this._selected.setAttribute('data-ty', newTy);
      this._showSelBox(this._selected);
      return;
    }

    if (!this._currentEl) return;

    if (this._tool === 'pen') {
      this._penPts.push(p);
      const pts = this._penPts.map(q => `${q.x},${q.y}`).join(' ');
      this._currentEl.setAttribute('points', pts);
    } else if (this._tool === 'line') {
      this._currentEl.setAttribute('x2', p.x);
      this._currentEl.setAttribute('y2', p.y);
    } else if (this._tool === 'rect') {
      const x = Math.min(p.x, this._dragStart.x);
      const y = Math.min(p.y, this._dragStart.y);
      const w = Math.abs(p.x - this._dragStart.x);
      const h = Math.abs(p.y - this._dragStart.y);
      this._currentEl.setAttribute('x', x);
      this._currentEl.setAttribute('y', y);
      this._currentEl.setAttribute('width',  w);
      this._currentEl.setAttribute('height', h);
    } else if (this._tool === 'ellipse') {
      const rx = Math.abs(p.x - this._dragStart.x) / 2;
      const ry = Math.abs(p.y - this._dragStart.y) / 2;
      const cx = (p.x + this._dragStart.x) / 2;
      const cy = (p.y + this._dragStart.y) / 2;
      this._currentEl.setAttribute('cx', cx);
      this._currentEl.setAttribute('cy', cy);
      this._currentEl.setAttribute('rx', rx);
      this._currentEl.setAttribute('ry', ry);
    }
  }

  _onUp(e) {
    if (!this._drawing) return;
    this._drawing = false;
    if (this._svg.hasPointerCapture && this._svg.hasPointerCapture(e.pointerId)) {
      this._svg.releasePointerCapture(e.pointerId);
    }

    if (this._tool === 'select') {
      this._dragStart = null;
      if (this._selected) this._emit();
      return;
    }

    // Simplify pen stroke
    if (this._tool === 'pen' && this._penPts.length > 3) {
      const simplified = rdp(this._penPts, 1.5);
      const pts = simplified.map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' ');
      this._currentEl.setAttribute('points', pts);
    }

    // Remove degenerate shapes
    if (this._currentEl) {
      const tagName = this._currentEl.nodeName;
      let degenerate = false;
      if (tagName === 'line') {
        const dx = parseFloat(this._currentEl.getAttribute('x2')) - parseFloat(this._currentEl.getAttribute('x1'));
        const dy = parseFloat(this._currentEl.getAttribute('y2')) - parseFloat(this._currentEl.getAttribute('y1'));
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) degenerate = true;
      } else if (tagName === 'rect') {
        if (parseFloat(this._currentEl.getAttribute('width'))  < 1 ||
            parseFloat(this._currentEl.getAttribute('height')) < 1) degenerate = true;
      } else if (tagName === 'ellipse') {
        if (parseFloat(this._currentEl.getAttribute('rx')) < 1 ||
            parseFloat(this._currentEl.getAttribute('ry')) < 1) degenerate = true;
      } else if (tagName === 'polyline') {
        if (this._penPts.length < 2) degenerate = true;
      }
      if (degenerate) {
        this._layer.removeChild(this._currentEl);
        this._shapes.pop();
        this._undoStack.pop(); // cancel the undo entry for this nothing-stroke
      }
    }

    this._currentEl = null;
    this._penPts = [];
    this._emit();
  }

  _hitTest(p) {
    // Walk shapes in reverse (top-most first)
    for (let i = this._shapes.length - 1; i >= 0; i--) {
      const el = this._shapes[i].el;
      try {
        const bb = el.getBBox();
        const pad = 8;
        if (p.x >= bb.x - pad && p.x <= bb.x + bb.width  + pad &&
            p.y >= bb.y - pad && p.y <= bb.y + bb.height + pad) {
          return el;
        }
      } catch (_) {}
    }
    return null;
  }

  /** Delete the currently selected shape. */
  deleteSelected() {
    if (!this._selected) return;
    this._pushUndo();
    this._layer.removeChild(this._selected);
    this._shapes = this._shapes.filter(s => s.el !== this._selected);
    this._deselect();
    this._emit();
  }
}

// Export for use as plain script (no module bundler)
window.MotifEditor = MotifEditor;
