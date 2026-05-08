/**
 * SVG leader-line overlay for thicken-mode worst-clamped points.
 *
 * Owns its own absolutely-positioned SVG element layered over the preview
 * canvas. Pools child nodes (4 per worst point — circle, line, label rect,
 * label text) so a per-frame update mutates attributes instead of rebuilding
 * the DOM.
 */

const NODES_PER_POINT = 4;

export class LeaderLineOverlay {
  /** @param {HTMLElement} parent the absolutely-positioned canvas wrapper */
  constructor(parent) {
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
  }

  setData(worstPts, show) {
    this._worstPts = worstPts ?? [];
    this._show = !!show;
  }

  /** Project worst points to screen and update DOM. */
  update(camera, canvas) {
    const svg = this._svg;
    if (!this._show || !this._worstPts.length) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }

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

    const totalPoints = this._worstPts.length;
    while (svg.children.length > totalPoints * NODES_PER_POINT) {
      svg.removeChild(svg.lastChild);
    }

    for (let i = 0; i < totalPoints; i++) {
      const pt = this._worstPts[i];
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

      const lx = sc.x + 28;
      const ly = sc.y - 28;

      circle.setAttribute('cx', sc.x.toFixed(1));
      circle.setAttribute('cy', sc.y.toFixed(1));

      line.setAttribute('x1', sc.x.toFixed(1));
      line.setAttribute('y1', sc.y.toFixed(1));
      line.setAttribute('x2', lx.toFixed(1));
      line.setAttribute('y2', ly.toFixed(1));

      rect.setAttribute('x', (lx + 2).toFixed(1));
      rect.setAttribute('y', (ly - 11).toFixed(1));

      text.setAttribute('x', (lx + 5).toFixed(1));
      text.setAttribute('y', (ly - 1).toFixed(1));
      text.textContent = pt.actual.toFixed(3) + '"';
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

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
    bg.setAttribute('width', '52');
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
