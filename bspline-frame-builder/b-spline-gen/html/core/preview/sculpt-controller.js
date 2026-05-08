/**
 * Sculpt mode — owns everything that happens when a stamp layer is being
 * sculpted in the preview:
 *
 *   • crosshair sight cursor that follows the mouse
 *   • plane-intersect raycast to find the nearest CP under the cursor
 *   • falloff ring + crosshair + dot overlay groups (with mirroring)
 *   • height-inspector DOM updates
 *   • drag-to-stroke: vertical drag emits onStroke deltas
 *   • value-input box anchored to the selected CP
 *
 * Public dispatchers (`tryHandle*`) return true if they consumed the
 * event so the orbit controller can skip its handling.
 */

export class SculptController {
  /**
   * @param {object} deps
   * @param {THREE.Scene}   deps.scene
   * @param {THREE.Camera}  deps.camera
   * @param {HTMLCanvasElement} deps.canvas
   * @param {() => {nx:number, offsetPts:Float32Array|null}} deps.getMeshState
   * @param {() => boolean} deps.hasOrbitDrag  — orbit controller still dragging?
   */
  constructor({ scene, camera, canvas, getMeshState, hasOrbitDrag }) {
    this._THREE = window.THREE;
    this._scene  = scene;
    this._camera = camera;
    this._canvas = canvas;
    this._getMeshState = getMeshState;
    this._hasOrbitDrag = hasOrbitDrag;

    this._sculpt = null;
    this._sculptSelected = null;
    this._sculptDrag     = null;
    this._sculptPrevLayer = null;

    this._falloffRing = null;
    this._sculptCrossGroup = null;
    this._sculptDotGroup = null;
    this._sculptValBox = null;

    this._lastHitZ = null;
    this._lastMouseEvt = null;
    this._pendingMouseEvt = null;
    this._overlayRafId = 0;
    this._lastHoverCi = null;
    this._lastHoverCj = null;
    this._lastHoverSelected = null;
    this._inspectorRefs = null;

    // Crosshair sight cursor.
    this._sight = document.createElement('div');
    Object.assign(this._sight.style, {
      position: 'absolute', pointerEvents: 'none',
      border: '1px dashed rgba(255,255,255,0.6)',
      width: '20px', height: '20px',
      display: 'none', zIndex: '30',
      willChange: 'transform', top: '0', left: '0',
    });
    const parent = canvas.parentElement || document.body;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(this._sight);
  }

  // ── Public API ──────────────────────────────────────────────────────

  hasDrag()    { return !!this._sculptDrag; }
  hasMode()    { return !!this._sculpt; }
  getConfig()  { return this._sculpt; }

  /**
   * Enable, disable, or refresh sculpt mode. config: null to disable, or:
   * { layer, widthIn, heightIn, nx, nz, radiusIn, symmetry,
   *   getDelta(ci,cj), onDelta(layer,ci,cj,dZ), heights }
   */
  setMode(config) {
    this._sculpt = config;
    // Clear visuals but do NOT wipe _sculptDrag — an active stroke must
    // survive the mesh rebuild that fires after every onStroke tick.
    this._clearOverlays();
    this._hideValBox();

    if (!config) {
      this._sculptSelected  = null;
      this._sculptDrag      = null;
      this._sculptPrevLayer = null;
      this._sight.style.display = 'none';
      this._canvas.style.cursor = '';
      return;
    }

    this._canvas.style.cursor = 'crosshair';
    this._sculptPrevLayer = config.layer ?? null;

    if (this._sculptDrag) return;

    if (this._lastMouseEvt) {
      const rect = this._canvas.getBoundingClientRect();
      const sx = this._lastMouseEvt.clientX - rect.left;
      const sy = this._lastMouseEvt.clientY - rect.top;
      this._sight.style.display = 'block';
      this._sight.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 50%))`;
      this._handleHover(this._lastMouseEvt);
    }

    // Fallback: if no hover ever drew the overlay, drop it at the grid
    // centre so something is always visible.
    if (!this._falloffRing) {
      const nx = config.nx ?? 1;
      const nz = config.nz ?? 1;
      const ci = Math.floor((nx - 1) / 2);
      const cj = Math.floor((nz - 1) / 2);
      const wz = (config.heights && config.heights.length > cj * nx + ci)
        ? config.heights[cj * nx + ci] : 0;
      this._buildOverlay(ci, cj, wz, false);
      this._lastHoverCi = ci;
      this._lastHoverCj = cj;
      this._lastHoverSelected = false;
      this._lastHitZ = wz;
    }
  }

  /**
   * After a mesh rebuild, re-show the selected-CP overlay anchored to the
   * fresh height field.
   */
  reapplySelection(heights, nx, nz, W, H) {
    if (!this._sculptSelected || !this._sculpt) return;
    const { ci, cj } = this._sculptSelected;
    const ddx = W / (nx - 1);
    const ddy = H / (nz - 1);
    const wx  = -W / 2 + ci * ddx;
    const wy  = -H / 2 + cj * ddy;
    const wz  = heights[cj * nx + ci];
    this._sculptSelected = { ci, cj, wx, wy, wz };
    this._buildOverlay(ci, cj, wz, true);
    const val = this._sculpt.getDelta?.(ci, cj) ?? 0;
    this._showValBox(val);
  }

  /** Clear selection and hide all sculpt visuals. */
  clearSelection() {
    this._sculptSelected = null;
    this._sculptDrag     = null;
    this._clearOverlays();
    this._hideValBox();
  }

  /** Reposition the value box near the selected CP. Called every frame. */
  updateValueBoxPos() {
    if (!this._sculptValBox || this._sculptValBox.style.display === 'none') return;
    if (!this._sculptSelected) return;
    const THREE = this._THREE;
    const { wx, wy, wz } = this._sculptSelected;
    const v = new THREE.Vector3(wx, wy, wz).project(this._camera);
    const rect = this._canvas.getBoundingClientRect();
    const cw = rect.width  || 600;
    const ch = rect.height || 400;
    const sx = (v.x *  0.5 + 0.5) * cw + 18;
    const sy = (v.y * -0.5 + 0.5) * ch - 16;
    Object.assign(this._sculptValBox.style, {
      left: `${Math.max(4, Math.min(cw - 160, sx))}px`,
      top:  `${Math.max(4, Math.min(ch -  50, sy))}px`,
    });
  }

  /** Returns true if sculpt consumed the mousedown (left-click in sculpt mode). */
  tryHandleCanvasMousedown(e) {
    if (!this._sculpt || e.button !== 0) return false;
    const ndc = this._mouseNDC(e);
    const rc  = this._raycast(ndc.x, ndc.y);
    if (rc.hit) {
      this._sculpt?.onStart?.(this._sculpt.layer);
      this._sculptDrag = { ci: rc.ci, cj: rc.cj, lastY: e.clientY };
      this._buildOverlay(rc.ci, rc.cj, rc.wz, true);
    }
    e.preventDefault();
    return true;
  }

  /** Sight cursor (sync) + hover work (rAF-throttled). */
  handleCanvasMousemove(e) {
    this._lastMouseEvt = e;

    if (this._sculpt) {
      const rect = this._canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      this._sight.style.display = 'block';
      this._sight.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
    }

    this._pendingMouseEvt = e;
    if (!this._overlayRafId) {
      this._overlayRafId = requestAnimationFrame(() => {
        this._overlayRafId = 0;
        const ev = this._pendingMouseEvt;
        this._pendingMouseEvt = null;
        if (ev) this._handleHover(ev);
      });
    }
  }

  handleCanvasMouseleave() {
    if (!this._sculptDrag) this._clearOverlays();
    if (this._overlayRafId) {
      cancelAnimationFrame(this._overlayRafId);
      this._overlayRafId = 0;
    }
    this._pendingMouseEvt = null;
  }

  /** Returns true if sculpt drag consumed the window mousemove. */
  tryHandleWindowMousemove(e) {
    if (!this._sculptDrag) return false;
    const dy = e.clientY - this._sculptDrag.lastY;
    if (Math.abs(dy) >= 1) {
      this._sculpt?.onStroke?.(this._sculpt.layer, this._sculptDrag.ci, this._sculptDrag.cj, dy);
      this._sculptDrag.lastY = e.clientY;
    }
    return true;
  }

  handleWindowMouseup() {
    if (!this._sculptDrag) return;
    this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
    this._sculptDrag = null;
    this._clearOverlays();
  }

  /** Returns true if sculpt consumed the touchstart. */
  tryHandleTouchstart(touch) {
    if (!this._sculpt) return false;
    const rect = this._canvas.getBoundingClientRect();
    const nx = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
    const rc = this._raycast(nx, ny);
    if (!rc.hit) return false;
    this._sculpt?.onStart?.(this._sculpt.layer);
    this._sculptDrag = { ci: rc.ci, cj: rc.cj, lastY: touch.clientY };
    this._buildOverlay(rc.ci, rc.cj, rc.wz, true);
    return true;
  }

  /** Returns true if sculpt drag consumed the touchmove. */
  tryHandleTouchmove(touch) {
    if (!this._sculptDrag) return false;
    const dy = touch.clientY - this._sculptDrag.lastY;
    if (Math.abs(dy) >= 1) {
      this._sculpt?.onStroke?.(this._sculpt.layer, this._sculptDrag.ci, this._sculptDrag.cj, dy);
      this._sculptDrag.lastY = touch.clientY;
    }
    return true;
  }

  handleTouchend() {
    if (!this._sculptDrag) return false;
    this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
    this._sculptDrag = null;
    this._clearOverlays();
    return true;
  }

  dispose() {
    this._clearOverlays();
    this._hideValBox();
    if (this._sculptValBox) this._sculptValBox.remove();
    if (this._sight) this._sight.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────

  _mouseNDC(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x:  ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      y: -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    };
  }

  /**
   * Map NDC mouse coords → nearest grid control point via plane intersection
   * at the last known terrain Z. O(1) vs raycasting against geometry.
   */
  _raycast(nx, ny) {
    const s = this._sculpt;
    if (!s) return { hit: false };

    const THREE = this._THREE;
    const planeZ = this._lastHitZ ?? 0;
    const plane  = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZ);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), this._camera);
    const target = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, target)) return { hit: false };

    const dx = s.widthIn  / (s.nx - 1);
    const dy = s.heightIn / (s.nz - 1);
    const ci = Math.round((target.x + s.widthIn  / 2) / dx);
    const cj = Math.round((target.y + s.heightIn / 2) / dy);
    if (ci < 0 || ci >= s.nx || cj < 0 || cj >= s.nz) return { hit: false };

    const wz = s.heights ? s.heights[cj * s.nx + ci] : planeZ;
    this._lastHitZ = wz;
    return { hit: true, ci, cj, wx: target.x, wy: target.y, wz };
  }

  /** All CP positions that participate (primary + symmetry mirrors). */
  _positions(ci, cj) {
    const s = this._sculpt;
    const sym = s?.symmetry ?? 'none';
    const nx  = s?.nx ?? 1, nz = s?.nz ?? 1;
    const sox = s?.symOffsetX ?? 0;
    const soy = s?.symOffsetY ?? 0;
    const centerI = (nx - 1) * (0.5 + sox);
    const centerJ = (nz - 1) * (0.5 + soy);
    const mi = Math.round(2 * centerI - ci);
    const mj = Math.round(2 * centerJ - cj);
    const inI = mi >= 0 && mi < nx;
    const inJ = mj >= 0 && mj < nz;
    const out = [{ ci, cj, mirror: false }];
    if ((sym === 'x' || sym === 'radial') && inI && mi !== ci) out.push({ ci: mi, cj, mirror: true });
    if ((sym === 'y' || sym === 'radial') && inJ && mj !== cj) out.push({ ci, cj: mj, mirror: true });
    if (sym === 'radial' && inI && inJ && mi !== ci && mj !== cj) out.push({ ci: mi, cj: mj, mirror: true });
    return out;
  }

  /** Build/refresh ring + crosshair + dot overlays for a hovered/selected CP. */
  _buildOverlay(ci, cj, wz, selected) {
    const s = this._sculpt;
    if (!s) return;
    const THREE = this._THREE;
    const dx = s.widthIn  / (s.nx - 1);
    const dy = s.heightIn / (s.nz - 1);
    const r  = s.radiusIn;

    this._clearOverlays();

    const positions = this._positions(ci, cj);
    // Pre-compute per-position view coords so the three groups share work.
    const computed = positions.map(p => ({
      ...p,
      cx: -s.widthIn  / 2 + p.ci * dx,
      cy: -s.heightIn / 2 + p.cj * dy,
      hz: s.heights ? s.heights[p.cj * s.nx + p.ci] : wz,
    }));

    // Falloff rings.
    const ringGroup = new THREE.Group();
    for (const p of computed) {
      const col = p.mirror ? 0xff8844 : (selected ? 0xffffff : 0xffee44);
      const op  = selected ? 1.0 : 0.65;
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        pts.push(new THREE.Vector3(p.cx + r * Math.cos(a), p.cy + r * Math.sin(a), p.hz + 0.012));
      }
      ringGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }),
      ));
    }
    this._falloffRing = ringGroup;
    this._scene.add(ringGroup);

    // Crosshair lines.
    const crossGroup = new THREE.Group();
    const armLen = r * 1.4;
    for (const p of computed) {
      const col = p.mirror ? 0xff6622 : 0xff2222;
      const op  = selected ? 0.9 : 0.4;
      const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op });
      const hPts = [
        new THREE.Vector3(p.cx - armLen, p.cy, p.hz + 0.012),
        new THREE.Vector3(p.cx + armLen, p.cy, p.hz + 0.012),
      ];
      const vPts = [
        new THREE.Vector3(p.cx, p.cy - armLen, p.hz + 0.012),
        new THREE.Vector3(p.cx, p.cy + armLen, p.hz + 0.012),
      ];
      crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), mat.clone()));
      crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), mat.clone()));
    }
    this._sculptCrossGroup = crossGroup;
    this._scene.add(crossGroup);

    // Dot at each active CP.
    const dotGroup  = new THREE.Group();
    const dotRadius = Math.min(dx, dy) * 0.28;
    const sphereGeo = new THREE.SphereGeometry(dotRadius, 7, 7);
    for (const p of computed) {
      const col = p.mirror ? 0xff7733 : (selected ? 0xffffff : 0xffee44);
      const mat = new THREE.MeshBasicMaterial({
        color: col, transparent: true, opacity: selected ? 0.95 : 0.65,
      });
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.set(p.cx, p.cy, p.hz + 0.015);
      dotGroup.add(sphere);
    }
    this._sculptDotGroup = dotGroup;
    this._scene.add(dotGroup);
  }

  _clearOverlays() {
    const dispose = (g) => {
      if (!g) return;
      this._scene.remove(g);
      g.children?.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
    };
    dispose(this._falloffRing);      this._falloffRing      = null;
    dispose(this._sculptCrossGroup); this._sculptCrossGroup = null;
    dispose(this._sculptDotGroup);   this._sculptDotGroup   = null;
    this._lastHoverCi = null;
    this._lastHoverCj = null;
    this._lastHoverSelected = null;
  }

  /**
   * rAF-throttled hover work: raycast, inspector update, overlay rebuild.
   * Skip dispose+rebuild when raycast resolves to the same grid cell.
   */
  _handleHover(e) {
    const ndc = this._mouseNDC(e);
    const rc  = this._raycast(ndc.x, ndc.y);
    const refs = this._getInspectorRefs();
    const meshState = this._getMeshState();

    if (!rc.hit) {
      if (refs.inspector) refs.inspector.style.display = 'none';
      return;
    }

    if (refs.inspector) refs.inspector.style.display = 'block';
    if (refs.topVal)    refs.topVal.textContent = rc.wz.toFixed(3);

    const offsetPts  = this._sculpt?.offsetPts || meshState.offsetPts;
    const haveOffset = offsetPts && offsetPts.length > 0;
    if (haveOffset) {
      const idx = (rc.cj * meshState.nx + rc.ci) * 3;
      const zBot = offsetPts[idx + 2];
      if (refs.botRow)   refs.botRow.style.display = 'block';
      if (refs.thickRow) refs.thickRow.style.display = 'block';
      if (refs.botVal)   refs.botVal.textContent = zBot.toFixed(3);
      if (refs.thickVal) refs.thickVal.textContent = Math.abs(rc.wz - zBot).toFixed(3);
    } else {
      if (refs.botRow)   refs.botRow.style.display = 'none';
      if (refs.thickRow) refs.thickRow.style.display = 'none';
    }

    if (this._sculpt && !this._sculptDrag && !this._hasOrbitDrag()) {
      const selected = false;
      if (this._lastHoverCi !== rc.ci ||
          this._lastHoverCj !== rc.cj ||
          this._lastHoverSelected !== selected) {
        const dZ = (this._sculpt.layer === 'bot' && haveOffset)
          ? offsetPts[(rc.cj * meshState.nx + rc.ci) * 3 + 2]
          : rc.wz;
        this._buildOverlay(rc.ci, rc.cj, dZ, selected);
        this._lastHoverCi = rc.ci;
        this._lastHoverCj = rc.cj;
        this._lastHoverSelected = selected;
      }
    }
  }

  _getInspectorRefs() {
    if (this._inspectorRefs) return this._inspectorRefs;
    this._inspectorRefs = {
      inspector: document.getElementById('heightInspector'),
      topVal:    document.getElementById('heightTop'),
      botVal:    document.getElementById('heightBot'),
      thickVal:  document.getElementById('heightThick'),
      botRow:    document.getElementById('inspectorBotRow'),
      thickRow:  document.getElementById('inspectorThickRow'),
    };
    return this._inspectorRefs;
  }

  // ── Floating value box ──────────────────────────────────────────────

  _ensureValBox() {
    if (this._sculptValBox) return;
    const parent = this._canvas.parentElement || document.body;
    const box = document.createElement('div');
    box.id = 'sculptValBox';
    Object.assign(box.style, {
      position: 'absolute', display: 'none', zIndex: '20',
      background: 'rgba(255,255,255,0.95)', border: '1px solid #ccc',
      borderRadius: '6px', padding: '5px 8px',
      alignItems: 'center', gap: '4px',
      pointerEvents: 'all', userSelect: 'none',
      fontSize: '13px', color: '#222', fontFamily: 'monospace, Consolas',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    });
    box.innerHTML = `
      <button id="svbDown" style="background:none;border:1px solid #ccc;color:#666;
        width:22px;height:22px;border-radius:3px;cursor:pointer;font-size:14px;padding:0;
        display:flex;align-items:center;justify-content:center;">▼</button>
      <input id="svbInput" type="number" step="0.01"
        style="width:68px;background:#f9f9f9;border:1px solid #ccc;
        color:#222;border-radius:3px;padding:2px 4px;text-align:center;
        font-family:monospace;font-size:13px;" />
      <button id="svbUp" style="background:none;border:1px solid #ccc;color:#666;
        width:22px;height:22px;border-radius:3px;cursor:pointer;font-size:14px;padding:0;
        display:flex;align-items:center;justify-content:center;">▲</button>
      <span style="color:#888;font-size:11px;">"</span>
    `;
    parent.appendChild(box);
    this._sculptValBox = box;

    const inp = box.querySelector('#svbInput');
    const STEP = 0.01;

    box.querySelector('#svbDown').addEventListener('mousedown', e => {
      e.stopPropagation();
      this._emitDelta(-STEP);
    });
    box.querySelector('#svbUp').addEventListener('mousedown', e => {
      e.stopPropagation();
      this._emitDelta(+STEP);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter')  { this._emitAbsolute(parseFloat(inp.value) || 0); e.preventDefault(); }
      if (e.key === 'Escape') { inp.blur(); }
      e.stopPropagation();
    });
    inp.addEventListener('mousedown', e => e.stopPropagation());
    inp.addEventListener('wheel',     e => e.stopPropagation());
  }

  _showValBox(val) {
    this._ensureValBox();
    const box = this._sculptValBox;
    box.style.display = 'flex';
    const inp = box.querySelector('#svbInput');
    if (inp && document.activeElement !== inp) inp.value = val.toFixed(3);
  }

  _hideValBox() {
    if (this._sculptValBox) this._sculptValBox.style.display = 'none';
  }

  _emitDelta(dZ) {
    const sel = this._sculptSelected;
    if (!sel || !this._sculpt?.onDelta) return;
    this._sculpt?.onStart?.(this._sculpt.layer);
    this._sculpt.onDelta(this._sculpt.layer, sel.ci, sel.cj, dZ);
    this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
  }

  _emitAbsolute(targetVal) {
    const sel = this._sculptSelected;
    if (!sel || !this._sculpt?.onDelta) return;
    const current = this._sculpt.getDelta?.(sel.ci, sel.cj) ?? 0;
    const dZ = targetVal - current;
    if (Math.abs(dZ) > 1e-6) {
      this._sculpt?.onStart?.(this._sculpt.layer);
      this._sculpt.onDelta(this._sculpt.layer, sel.ci, sel.cj, dZ);
      this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
    }
  }
}
