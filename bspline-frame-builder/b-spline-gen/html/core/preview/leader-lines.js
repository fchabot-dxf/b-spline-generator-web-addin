/**
 * SVG leader-line overlay for thicken-mode worst-clamped points.
 *
 * Owns its own absolutely-positioned SVG element layered over the preview
 * canvas. Pools child nodes (4 per drawn point — circle, line, label rect,
 * label text) so a per-frame update mutates attributes instead of rebuilding
 * the DOM.
 *
 * UX refine (Fred, 2026-10-10: 10-15 overlapping "thin 0.09"" tags cluttered the view): the spots are no longer
 * all tagged at once. ONE compact badge in a corner says how many there are ("12 thin spots"); a tap opens a
 * stepper that shows one spot at a time (its dot + label), prev/next step through them, Esc or a tap outside
 * closes. The detector (core/engine/build-thicken-data.js) is unchanged -- this is display only. The badge text,
 * corner and step rules are declared in THIN_SPOT_BADGE below.
 */

const NODES_PER_POINT = 4;
const LABEL_W = 76; // the tag's background width (px)

/** The thin-spot badge, declared. `text`: '{n}' / '{i}' / '{value}' are filled in. `position`: the corner of the
 *  3D view (the view pill is top-left, the view cube top-right, the height inspector bottom-left). `step`: the
 *  order is the detector's own (thinnest first); `wrap` cycles past the ends. `drawAllTags`: the old one-tag-per-spot
 *  view, off. */
export const THIN_SPOT_BADGE = Object.freeze({
  text: Object.freeze({
    one: '1 thin spot',
    many: '{n} thin spots',
    stepping: '{i} / {n} thin',
    spot: 'thin {value}"', // the tag at the spot: the solid's thinnest there
    prev: 'Previous thin spot',
    next: 'Next thin spot',
    open: 'Show the thin spots one at a time',
    close: 'Close',
  }),
  valueDecimals: 3,
  position: Object.freeze({ corner: 'bottom-right', insetPx: 10 }),
  step: Object.freeze({ startAt: 0, wrap: true, closeKeys: Object.freeze(['Escape']), closeOnOutsideTap: true }),
  drawAllTags: false,
});

const CORNER_CSS = Object.freeze({
  'top-left': ['top', 'left'], 'top-right': ['top', 'right'],
  'bottom-left': ['bottom', 'left'], 'bottom-right': ['bottom', 'right'],
});

const fill = (tpl, vals) => tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vals ? String(vals[k]) : ''));

/** The closed badge's text for `n` spots ('' for none: no badge). */
export function thinBadgeText(n, spec = THIN_SPOT_BADGE) {
  if (!n) return '';
  return n === 1 ? spec.text.one : fill(spec.text.many, { n });
}

/** The tag drawn at one spot. */
export function thinSpotLabel(pt, spec = THIN_SPOT_BADGE) {
  return fill(spec.text.spot, { value: pt.actual.toFixed(spec.valueDecimals) });
}

/** The index after stepping `delta` from `i` through `n` spots (wraps when declared, else stops at the ends). */
export function stepThinIndex(i, delta, n, spec = THIN_SPOT_BADGE) {
  if (!n) return -1;
  const j = i + delta;
  if (spec.step.wrap) return ((j % n) + n) % n;
  return Math.min(n - 1, Math.max(0, j));
}

export class LeaderLineOverlay {
  /** @param {HTMLElement} parent the absolutely-positioned canvas wrapper */
  constructor(parent, spec = THIN_SPOT_BADGE) {
    this._spec = spec;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    Object.assign(svg.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '5',
    });
    parent.appendChild(svg);
    this._svg = svg;
    this._worstPts = [];
    this._show = true;
    this._index = -1; // the spot shown while stepping; -1 = closed
    this._camera = null; this._canvas = null; // the last update's, so a step can redraw at once
    this._buildBadge(parent);
  }

  setData(worstPts, show) {
    this._worstPts = worstPts ?? [];
    this._show = !!show;
    const n = this._show ? this._worstPts.length : 0;
    if (!n) this._close(false);
    else if (this._index >= n) this._index = n - 1;
    this._syncBadge();
    if (!n) this._clearSvg();
  }

  /** How many spots the badge counts (the list handed to setData; 0 while hidden). */
  get count() { return this._show ? this._worstPts.length : 0; }
  /** The spot being shown, or -1 when the stepper is closed. */
  get index() { return this._index; }
  get isOpen() { return this._index >= 0; }

  open() {
    if (!this.count) return;
    if (this._index < 0) {
      this._index = Math.min(this._spec.step.startAt, this.count - 1);
      this._listen(true);
    }
    this._syncBadge();
    this._redraw();
  }

  step(delta) {
    if (!this.isOpen) return;
    this._index = stepThinIndex(this._index, delta, this.count, this._spec);
    this._syncBadge();
    this._redraw();
  }

  close() { this._close(true); }

  /** Project the spot(s) to screen and update DOM: the current one while stepping (every one only when
   *  THIN_SPOT_BADGE.drawAllTags), none otherwise. */
  update(camera, canvas) {
    this._camera = camera; this._canvas = canvas;
    const drawn = !this._show || !this._worstPts.length ? []
      : this._spec.drawAllTags ? this._worstPts
        : this.isOpen ? [this._worstPts[this._index]] : [];
    if (!drawn.length) { this._clearSvg(); return; }
    const svg = this._svg;

    const THREE = window.THREE;
    const cw = canvas.clientWidth  || 600;
    const ch = canvas.clientHeight || 400;

    const toScreen = (wx, wy, wz) => {
      const v = new THREE.Vector3(wx, wy, wz);
      v.project(camera);
      return {
        x: (v.x *  0.5 + 0.5) * cw,
        y: (v.y * -0.5 + 0.5) * ch,
        behind: v.z > 1,
      };
    };

    const totalPoints = drawn.length;
    while (svg.children.length > totalPoints * NODES_PER_POINT) {
      svg.removeChild(svg.lastChild);
    }

    for (let i = 0; i < totalPoints; i++) {
      const pt = drawn[i];
      const sc = toScreen(pt.x, pt.y, pt.z);
      const startIdx = i * NODES_PER_POINT;

      if (svg.children.length <= startIdx) this._appendPointNodes();

      const circle = svg.children[startIdx];
      const line   = svg.children[startIdx + 1];
      const rect   = svg.children[startIdx + 2];
      const text   = svg.children[startIdx + 3];

      if (sc.behind) {
        circle.style.display = 'none';
        line.style.display   = 'none';
        rect.style.display   = 'none';
        text.style.display   = 'none';
        continue;
      }
      circle.style.display = '';
      line.style.display   = '';
      rect.style.display   = '';
      text.style.display   = '';

      // up-right of the spot; flipped left / down when the tag would leave the view (a phone's narrow 3D view
      // cut the tag off at the right edge)
      const flipX = sc.x + 28 + LABEL_W + 4 > cw;
      const lx = flipX ? sc.x - 28 - LABEL_W - 4 : sc.x + 28;
      const ly = sc.y - 28 - 12 < 0 ? sc.y + 28 + 12 : sc.y - 28;

      circle.setAttribute('cx', sc.x.toFixed(1));
      circle.setAttribute('cy', sc.y.toFixed(1));

      line.setAttribute('x1', sc.x.toFixed(1));
      line.setAttribute('y1', sc.y.toFixed(1));
      line.setAttribute('x2', (flipX ? lx + LABEL_W + 2 : lx).toFixed(1));
      line.setAttribute('y2', ly.toFixed(1));

      rect.setAttribute('x', (lx + 2).toFixed(1));
      rect.setAttribute('y', (ly - 11).toFixed(1));

      text.setAttribute('x', (lx + 5).toFixed(1));
      text.setAttribute('y', (ly - 1).toFixed(1));
      text.textContent = thinSpotLabel(pt, this._spec);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  _clearSvg() {
    const svg = this._svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  _redraw() {
    if (this._camera && this._canvas) this.update(this._camera, this._canvas);
  }

  _close(redraw) {
    if (this._index < 0) return;
    this._index = -1;
    this._listen(false);
    this._syncBadge();
    if (redraw) this._redraw();
  }

  _buildBadge(parent) {
    const { position } = this._spec;
    const bar = document.createElement('div');
    bar.className = 'thin-spot-badge';
    const [v, h] = CORNER_CSS[position.corner] || CORNER_CSS['bottom-right'];
    bar.style.cssText = `position:absolute; ${v}:${position.insetPx}px; ${h}:${position.insetPx}px; z-index:120; display:none;`
      + ' align-items:stretch; border-radius:16px; overflow:hidden; border:1px solid #ff9900;'
      + ' background:rgba(20,20,40,0.88); box-shadow:0 1px 4px rgba(0,0,0,0.25); font:600 12px sans-serif; touch-action:manipulation;';
    const mk = (cls, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.style.cssText = 'border:none; background:transparent; color:#ffcc44; min-height:32px; min-width:32px; padding:0 10px;'
        + ' font:inherit; cursor:pointer; white-space:nowrap;';
      if (label) { b.title = label; b.setAttribute('aria-label', label); }
      return b;
    };
    this._prevBtn = mk('thin-spot-prev', this._spec.text.prev);
    this._prevBtn.textContent = '‹';
    this._prevBtn.style.fontSize = '18px';
    this._nextBtn = mk('thin-spot-next', this._spec.text.next);
    this._nextBtn.textContent = '›';
    this._nextBtn.style.fontSize = '18px';
    this._mainBtn = mk('thin-spot-count', null);
    this._prevBtn.addEventListener('click', () => this.step(-1));
    this._nextBtn.addEventListener('click', () => this.step(1));
    this._mainBtn.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    bar.append(this._prevBtn, this._mainBtn, this._nextBtn);
    parent.appendChild(bar);
    this._badge = bar;
    this._onKey = (e) => { if (this._spec.step.closeKeys.includes(e.key)) this.close(); };
    this._onOutside = (e) => { if (!bar.contains(e.target)) this.close(); };
  }

  _listen(on) {
    if (typeof document === 'undefined') return;
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('keydown', this._onKey);
    if (this._spec.step.closeOnOutsideTap) document[m]('pointerdown', this._onOutside, true);
  }

  _syncBadge() {
    const n = this.count;
    this._badge.style.display = n ? 'flex' : 'none';
    const open = this.isOpen;
    this._prevBtn.style.display = open ? '' : 'none';
    this._nextBtn.style.display = open ? '' : 'none';
    this._mainBtn.textContent = open ? fill(this._spec.text.stepping, { i: this._index + 1, n }) : thinBadgeText(n, this._spec);
    const label = open ? this._spec.text.close : this._spec.text.open;
    this._mainBtn.title = label;
    this._mainBtn.setAttribute('aria-label', `${this._mainBtn.textContent}. ${label}`);
    this._mainBtn.setAttribute('aria-expanded', String(open));
  }

  _appendPointNodes() {
    const svg = this._svg;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', '#ff3300');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '1');
    svg.appendChild(circle);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#ff9900');
    line.setAttribute('stroke-width', '1.2');
    svg.appendChild(line);

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', String(LABEL_W));
    bg.setAttribute('height', '14');
    bg.setAttribute('rx', '3');
    bg.setAttribute('fill', 'rgba(20,20,40,0.85)');
    bg.setAttribute('stroke', '#ff9900');
    bg.setAttribute('stroke-width', '0.8');
    svg.appendChild(bg);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('fill', '#ffcc44');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-family', 'monospace, Consolas');
    svg.appendChild(text);
  }
}
