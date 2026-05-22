/**
 * Orbit camera controller — quaternion-based turntable orbit, pan, zoom,
 * and touch gestures. Owns the camera's position and frustum.
 *
 *   • Mouse: left-drag orbits (Inventor-style turntable around world Z),
 *     shift+drag does a free trackball orbit, middle/right drag pans,
 *     wheel zooms (anchored on the cursor when zooming in, drifting back
 *     toward the model origin when zooming out).
 *   • Touch: 1-finger orbit, 2-finger pinch + pan.
 *
 * Damped lerp animates between target and current state every frame.
 * goHome() / animateTo() are external triggers (Home button, ViewCube).
 */

export class OrbitController {
  /**
   * @param {object} deps
   * @param {THREE.OrthographicCamera} deps.camera
   * @param {HTMLCanvasElement}        deps.canvas
   * @param {() => boolean}            deps.isInSculptMode
   */
  constructor({ camera, canvas, isInSculptMode }) {
    const THREE = window.THREE;
    this._THREE  = THREE;
    this._camera = camera;
    this._canvas = canvas;
    this._isInSculptMode = isInSculptMode;

    // Quaternion-based orbit (unlimited rotation). Home view: Fusion Z-up
    // isometric showing TOP/FRONT/RIGHT. theta = +π/4, phi ≈ 0.955 rad.
    const homeQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.955, 0, Math.PI / 4, 'ZXY'));
    this._orb = {
      q: homeQ.clone(),
      r: 14,
      target: new THREE.Vector3(),
    };
    this._targetOrb = {
      q:      this._orb.q.clone(),
      r:      this._orb.r,
      target: this._orb.target.clone(),
    };
    this._home = {
      q:      homeQ.clone(),
      r:      this._orb.r,
      target: this._orb.target.clone(),
    };
    this._drag = null;
    this._touchOrbit = null; // single-finger
    this._touchPan   = null; // two-finger
  }

  // ── Public API ──────────────────────────────────────────────────────

  hasDrag() { return !!this._drag; }

  /**
   * Damped lerp to target. Updates the camera matrix. Returns true if any
   * value moved (so the loop knows to re-render).
   */
  step() {
    const THREE = this._THREE;
    const lerp = (a, b, t) => a + (b - a) * t;
    const alpha = 0.10;
    const qDelta = this._orb.q.angleTo(this._targetOrb.q);
    const rDelta = Math.abs(this._orb.r - this._targetOrb.r);
    const tDelta = this._orb.target.distanceTo(this._targetOrb.target);
    if (qDelta <= 0.0001 && rDelta <= 0.0001 && tDelta <= 0.0001) return false;

    this._orb.q.slerp(this._targetOrb.q, alpha);
    this._orb.r = lerp(this._orb.r, this._targetOrb.r, alpha);
    this._orb.target.lerp(this._targetOrb.target, alpha);

    const pos = new THREE.Vector3(0, 0, this._orb.r).applyQuaternion(this._orb.q);
    this._camera.position.addVectors(this._orb.target, pos);
    this._camera.quaternion.copy(this._orb.q);
    this.updateFrustum();
    return true;
  }

  /** Recompute orthographic frustum from current canvas size + r. */
  updateFrustum() {
    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    const aspect = w / h;
    const size   = Math.max(0.1, this._orb.r * 0.35);
    this._camera.left   = -size * aspect;
    this._camera.right  =  size * aspect;
    this._camera.top    =  size;
    this._camera.bottom = -size;
    this._camera.updateProjectionMatrix();
  }

  /** Reset to the home isometric view, fitted to the current stock size. */
  goHome(W, H) {
    if (!W || !H) return;
    const rect = this._canvas.getBoundingClientRect();
    const canvasW = rect.width  || this._canvas.clientWidth  || 800;
    const canvasH = rect.height || this._canvas.clientHeight || 600;
    const aspect  = canvasW / canvasH;

    const rV = H / 0.8;
    const rH = W / (0.8 * aspect);
    const rFit = Math.max(rV, rH, Math.sqrt(W * W + H * H) * 1.5) * 1.25;

    this._targetOrb.q.setFromEuler(new this._THREE.Euler(0.955, 0, Math.PI / 4, 'ZXY'));
    this._targetOrb.r = rFit;
    this._targetOrb.target.set(0, 0, this._targetOrb.target.z || 0);
  }

  /** Animate to a specific theta/phi (used by ViewCube clicks). */
  animateTo(theta, phi) {
    this._targetOrb.q.setFromEuler(new this._THREE.Euler(phi, 0, theta, 'ZXY'));
  }

  /** Set the focus point's Z coordinate (terrain centre after rebuild). */
  setTargetZ(z) {
    this._targetOrb.target.z = z;
  }

  /**
   * Re-fit the frustum and target distance for new stock dimensions, also
   * snapping immediately on first run so the initial frame isn't a long
   * lerp from the default.
   */
  fitToStock(W, H, midZ, isFirstRun) {
    const THREE = this._THREE;
    const rect = this._canvas.getBoundingClientRect();
    const canvasW = Math.max(1, rect.width  || this._canvas.clientWidth  || 800);
    const canvasH = Math.max(1, rect.height || this._canvas.clientHeight || 600);
    const aspect  = canvasW / canvasH;
    const safeW = Math.max(0.1, W || 10);
    const safeH = Math.max(0.1, H || 10);

    const rV = safeH / 0.9;
    const rH = safeW / (0.9 * aspect);
    const rIdeal = Math.max(rV, rH, Math.sqrt(safeW * safeW + safeH * safeH) * 1.25);

    this._targetOrb.r = rIdeal * 1.05;
    this._targetOrb.target.set(0, 0, midZ);

    if (isFirstRun) {
      this._orb.r = this._targetOrb.r;
      this._orb.target.copy(this._targetOrb.target);
      this._orb.q.copy(this._targetOrb.q);
      const pos = new THREE.Vector3(0, 0, this._orb.r).applyQuaternion(this._orb.q);
      this._camera.position.addVectors(this._orb.target, pos);
      this._camera.quaternion.copy(this._orb.q);
      this.updateFrustum();
    }

    // Save current orientation as the new home view.
    this._home.q      = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.955, 0, Math.PI / 4, 'ZXY'));
    this._home.r      = this._targetOrb.r;
    this._home.target = this._targetOrb.target.clone();
  }

  // ── Mouse ───────────────────────────────────────────────────────────

  handleCanvasMousedown(e) {
    const startEuler = new this._THREE.Euler().setFromQuaternion(this._targetOrb.q, 'ZXY');
    this._drag = {
      x: e.clientX, y: e.clientY,
      q: this._targetOrb.q.clone(),
      target: this._targetOrb.target.clone(),
      btn: this._isInSculptMode() ? 0 : e.button, // sculpt mode → right-click=orbit
      shift: e.shiftKey,
      theta: startEuler.z,
      phi:   startEuler.x,
    };
    e.preventDefault();
  }

  /** Returns true if orbit consumed the window mousemove. */
  tryHandleWindowMousemove(e) {
    if (!this._drag) return false;
    const THREE = this._THREE;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    const isOrbit = (this._drag.btn === 0) || (this._drag.btn === 1 && e.shiftKey);
    const isPan   = (this._drag.btn === 2) || (this._drag.btn === 1 && !e.shiftKey);

    if (isOrbit) {
      const speed = 0.006;
      if (e.shiftKey) {
        // Free trackball orbit (legacy, useful for unconstrained inspection).
        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * speed);
        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * speed);
        this._targetOrb.q.copy(this._drag.q).multiply(qX).multiply(qY);
      } else {
        // Inventor-style turntable: horizontal=spin around world Z, vertical=elevation.
        const newTheta = this._drag.theta + dx * speed;
        const eps = 0.01;
        const newPhi = Math.max(eps, Math.min(Math.PI - eps, this._drag.phi + dy * speed));
        this._targetOrb.q.setFromEuler(new THREE.Euler(newPhi, 0, newTheta, 'ZXY'));
      }
    } else if (isPan) {
      const vRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion);
      const vUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion);
      const panspeed = this._orb.r * 0.0015;
      this._targetOrb.target.copy(this._drag.target)
        .addScaledVector(vRight, -dx * panspeed)
        .addScaledVector(vUp,     dy * panspeed);
    }
    return true;
  }

  handleWindowMouseup() {
    this._drag = null;
  }

  /**
   * Wheel zoom. e.deltaY < 0 zooms in (anchor world point under cursor);
   * e.deltaY > 0 zooms out (gently re-center on scene XY origin).
   */
  handleWheel(e) {
    // Listener is registered with { passive: true } in preview/index.js to
    // unblock the compositor under high-frequency trackpad scroll (BUG-08).
    // preventDefault() can no longer be called here — that's fine because
    // the canvas has no native scroll, and `overscroll-behavior: contain`
    // on the canvas prevents the chain from leaking to the document.
    const THREE = this._THREE;
    // Ground every wheel event in the currently *rendered* state so rapid
    // events don't compound drift while the lerp is still catching up.
    const oldR       = this._orb.r;
    const zoomFactor = 1 + e.deltaY * 0.0025;
    const newR       = Math.max(0.1, oldR * zoomFactor);
    this._targetOrb.r = newR;

    if (e.deltaY < 0) {
      const rect = this._canvas.getBoundingClientRect();
      const ndcX =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion);
      const camUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion);
      const aspect   = this._canvas.clientWidth / this._canvas.clientHeight;
      const oldSize  = Math.max(0.1, oldR * 0.35);
      const newSize  = Math.max(0.1, newR * 0.35);
      const dSize    = oldSize - newSize;
      this._targetOrb.target.copy(this._orb.target)
        .addScaledVector(camRight, ndcX * aspect * dSize)
        .addScaledVector(camUp,    ndcY * dSize);
    } else {
      const pull = Math.min(0.6, (zoomFactor - 1) * 1.0);
      this._targetOrb.target.copy(this._orb.target);
      this._targetOrb.target.x *= (1 - pull);
      this._targetOrb.target.y *= (1 - pull);
    }
  }

  // ── Touch ───────────────────────────────────────────────────────────

  /** Begin single-touch orbit. Caller already let sculpt try first. */
  beginTouchOrbit(touch) {
    this._touchOrbit = {
      x: touch.clientX,
      y: touch.clientY,
      q: this._targetOrb.q.clone(),
    };
  }

  beginTouchPinch(t0, t1) {
    const ddx = t0.clientX - t1.clientX;
    const ddy = t0.clientY - t1.clientY;
    this._touchPan = {
      x: (t0.clientX + t1.clientX) / 2,
      y: (t0.clientY + t1.clientY) / 2,
      dist: Math.sqrt(ddx * ddx + ddy * ddy),
      r: this._targetOrb.r,
      target: this._targetOrb.target.clone(),
    };
  }

  /** Single-finger orbit. */
  handleTouchOrbitMove(touch) {
    if (!this._touchOrbit) return;
    const THREE = this._THREE;
    const ddx = touch.clientX - this._touchOrbit.x;
    const ddy = touch.clientY - this._touchOrbit.y;
    const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ddy * 0.008);
    const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ddx * 0.008);
    this._targetOrb.q.copy(this._touchOrbit.q).multiply(qX).multiply(qY);
  }

  /** Two-finger pinch + pan. */
  handleTouchPinchMove(t0, t1) {
    if (!this._touchPan) return;
    const THREE = this._THREE;
    const mx = (t0.clientX + t1.clientX) / 2;
    const my = (t0.clientY + t1.clientY) / 2;
    const ddx = t0.clientX - t1.clientX;
    const ddy = t0.clientY - t1.clientY;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    const dx = mx - this._touchPan.x;
    const dy = my - this._touchPan.y;
    const vRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion);
    const vUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion);
    const panspeed = this._orb.r * 0.0015;
    this._targetOrb.target.copy(this._touchPan.target)
      .addScaledVector(vRight, -dx * panspeed)
      .addScaledVector(vUp,     dy * panspeed);
    if (this._touchPan.dist > 0) {
      this._targetOrb.r = Math.max(0.1, this._touchPan.r * (this._touchPan.dist / dist));
    }
  }

  endTouch() {
    this._touchOrbit = null;
    this._touchPan   = null;
  }
}
