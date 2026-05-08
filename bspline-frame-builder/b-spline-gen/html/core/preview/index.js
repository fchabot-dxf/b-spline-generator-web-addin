/**
 * preview/index.js — TerrainPreview composition root.
 *
 * The actual work lives in sibling modules; this file wires them together
 * and owns the public API consumed by the rest of the app:
 *
 *   update(...)              — rebuild the whole scene from a fresh height grid
 *   setThickenOverlay(...)   — re-colour without a full rebuild
 *   setSculptMode(config)    — enter/leave sculpt mode
 *   setCurvesVisible(v)      — toggle iso-curve view
 *   getMeshData(orientation) — pull verts+indices for Fusion CustomGraphics
 *   getSnapshot(w,h)         — PNG data URL of the current scene
 *   goHome()                 — reset orbit to home isometric view
 *   animateTo(theta,phi)     — orbit to a specific heading (ViewCube)
 *   setGroundGridVisible(v)  — toggle the reference grid
 *   updateTopView(...)       — render 2D heightmap to a canvas
 *   dispose()
 *
 * The B-spline surface evaluation, mesh build, sculpt overlay, leader
 * lines, ground grid, and orbit controller are all in their own files.
 */

import { dbg } from '../debug.js';
import { ViewCube } from './view-cube.js';
import { GroundGrid } from './ground-grid.js';
import { LeaderLineOverlay } from './leader-lines.js';
import { OrbitController } from './orbit-controller.js';
import { SculptController } from './sculpt-controller.js';
import { renderTopView } from './top-view.js';
import {
  buildHeightField,
  buildLiveBrushColours,
  buildTopOnlyMesh,
  buildSolidMesh,
  buildSolidWireframe,
  buildIsoCurves,
  extractSolidExportArrays,
} from './terrain-mesh.js';

export class TerrainPreview {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    const THREE = window.THREE;
    if (!THREE) throw new Error('THREE not loaded');

    this._THREE  = THREE;
    this._canvas = canvas;
    this._mesh   = null;
    this._curves = null;
    this._animId = null;
    this._needsRender = true;
    this._curvesVisible = false;
    this._lastW = 0;
    this._lastH = 0;

    // Last-rebuild cached state — used by getMeshData and reapply paths.
    this._lastNx = 0;
    this._lastNz = 0;
    this._lastWidth = 0;
    this._lastHeight = 0;
    this._lastHeights   = null;
    this._lastOffsetPts = null;

    // Thicken overlay state.
    this._heatColours = null;
    this._worstPts    = [];
    this._showLeaders = true;
    this._solidMeshes = []; // wireframe lines added when thickenWireframe is on

    // Renderer + scene + camera + lights.
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setClearColor(0xffffff, 1);
    canvas.style.touchAction = 'none';

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);

    this._scene.add(new THREE.AmbientLight(0xffffff, 0.30));
    const sun  = new THREE.DirectionalLight(0xfff4d0, 1.4);
    sun.position.set(4, 8, 3);
    this._scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb8d0ff, 0.60);
    fill.position.set(-5, 3, -4);
    this._scene.add(fill);

    // Sub-controllers.
    this._groundGrid = new GroundGrid(this._scene);
    this._leaders    = new LeaderLineOverlay(canvas.parentElement || document.body);

    this._orbit = new OrbitController({
      camera: this._camera,
      canvas,
      isInSculptMode: () => this._sculpt.hasMode(),
    });

    this._sculpt = new SculptController({
      scene:  this._scene,
      camera: this._camera,
      canvas,
      getMeshState: () => ({ nx: this._lastNx, offsetPts: this._lastOffsetPts }),
      hasOrbitDrag: () => this._orbit.hasDrag(),
    });

    this._initUI();
    this._bindEvents();

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._startLoop();
  }

  // ── Public API ──────────────────────────────────────────────────────

  setGroundGridVisible(v) { this._groundGrid.setVisible(v); }

  /**
   * Rebuild the terrain mesh and curves based on new height data.
   * @returns {{ minZ, maxZ }}
   */
  update(heights, nx, nz, width, height, carveZ,
         meshColours = null, worstPts = [], showLeaders = true,
         offsetPts = null, shadingIntensity = 0.25,
         thinPts = [], intersectPts = [],
         thickenWireframe = false, botColours = null, flatShading = false) {
    const THREE = this._THREE;
    this._dispose();
    this._groundGrid.update(width, height);

    this._heatColours = null;
    this._worstPts    = worstPts;
    this._showLeaders = showLeaders;
    this._lastHeights = heights;
    this._lastOffsetPts = offsetPts;
    this._lastNx = nx; this._lastNz = nz;
    this._lastWidth = width; this._lastHeight = height;

    if (nx < 2 || nz < 2 || isNaN(nx) || isNaN(nz)) {
      console.error(`[TerrainPreview] Invalid Grid received: ${nx}x${nz}. Forcing 2x2 placeholder.`);
      nx = Math.max(2, nx || 2);
      nz = Math.max(2, nz || 2);
    }

    const W = width, H = height;
    const count = nx * nz;
    const field = buildHeightField(heights, nx, nz, W, H);
    const { pos, minZ, maxZ } = field;

    const useMeshColours = meshColours && meshColours.length === count * 3;
    const hasSolid = offsetPts && offsetPts.length >= count * 3;
    const showSolid = hasSolid && !thickenWireframe;
    const liveBrushColours = buildLiveBrushColours(meshColours, this._sculpt.getConfig(), nx, nz);

    if (showSolid) {
      const topColours = liveBrushColours || (useMeshColours ? meshColours : null);
      if (liveBrushColours) dbg('VertexColor', 'liveBrushColours sample:', Array.from(liveBrushColours.slice(0, 12)));
      this._mesh = buildSolidMesh(THREE, pos, offsetPts, nx, nz, {
        topColours, botColours, flatShading,
      });
      this._mesh.visible = !this._curvesVisible;
      this._scene.add(this._mesh);
    } else {
      const colours = liveBrushColours || (useMeshColours ? meshColours.slice() : null);
      this._mesh = buildTopOnlyMesh(THREE, field, colours, {
        isWireframeMode: !!thickenWireframe,
        flatShading,
      });
      this._mesh.visible = !this._curvesVisible;
      this._scene.add(this._mesh);
    }

    if (hasSolid && thickenWireframe) {
      if (this._mesh) {
        this._mesh.material.transparent = false;
        this._mesh.material.opacity = 1.0;
        this._mesh.material.depthWrite = true;
        this._mesh.material.needsUpdate = true;
      }
      const lines = buildSolidWireframe(THREE, pos, offsetPts, nx, nz);
      for (const line of lines) {
        this._scene.add(line);
        this._solidMeshes.push(line);
      }
    }

    this._curves = buildIsoCurves(THREE, heights, nx, nz, W, H, this._curvesVisible);
    this._curves.visible = this._curvesVisible;
    this._scene.add(this._curves);

    // Track terrain centre Z so the orbit target follows height changes.
    const midZ = (minZ + maxZ) / 2;
    this._orbit.setTargetZ(midZ);

    if (W !== this._lastW || H !== this._lastH || this._lastW === 0) {
      const isFirstRun = (this._lastW === 0);
      this._orbit.fitToStock(W, H, midZ, isFirstRun);
      if (isFirstRun) this._resize();
      this._lastW = W;
      this._lastH = H;
    }

    this._sculpt.reapplySelection(heights, nx, nz, W, H);
    this._leaders.setData(this._worstPts, this._showLeaders);

    this._needsRender = true;
    return { minZ, maxZ };
  }

  /**
   * Export the current mesh geometry in the requested orientation for Fusion
   * CustomGraphics. Returns null if no mesh is currently loaded.
   */
  getMeshData(orientation = 'z-up') {
    return extractSolidExportArrays(this._mesh, this._lastOffsetPts, this._lastNx, this._lastNz, orientation);
  }

  /** Update heat-map overlay without a full mesh rebuild. */
  setThickenOverlay(heatColours, worstPts, showLeaders) {
    this._heatColours = heatColours;
    this._worstPts    = worstPts ?? [];
    this._showLeaders = showLeaders;

    if (this._mesh) {
      const THREE = this._THREE;
      const geom  = this._mesh.geometry;
      const count = this._lastNx * this._lastNz;
      const useHeat = heatColours && heatColours.length === count * 3;
      if (useHeat) {
        geom.setAttribute('color', new THREE.BufferAttribute(heatColours.slice(), 3));
        this._mesh.material.vertexColors = true;
        this._mesh.material.color.setHex(0xffffff);
      } else {
        geom.deleteAttribute('color');
        this._mesh.material.vertexColors = false;
        this._mesh.material.color.setHex(0xd4b896);
      }
      this._mesh.material.needsUpdate = true;
      geom.attributes.color && (geom.attributes.color.needsUpdate = true);
    }
    this._leaders.setData(this._worstPts, this._showLeaders);
    this._needsRender = true;
  }

  goHome()                    { this._orbit.goHome(this._lastWidth, this._lastHeight); }
  animateTo(theta, phi)       { this._orbit.animateTo(theta, phi); }
  setSculptMode(config)       { this._sculpt.setMode(config); }
  setCurvesVisible(visible) {
    this._curvesVisible = visible;
    if (this._mesh)   this._mesh.visible   = !visible;
    if (this._curves) this._curves.visible =  visible;
    this._needsRender = true;
  }

  updateTopView(heights, nx, nz, canvasId = 'svgEditorTopView', shadingIntensity = 0.25) {
    renderTopView(canvasId, heights, nx, nz, shadingIntensity);
  }

  /** PNG data URL of the current scene at a custom resolution. */
  getSnapshot(width = 400, height = 300) {
    const renderer = this._renderer;
    const oldW = this._canvas.width;
    const oldH = this._canvas.height;
    const oldAspect = this._camera.aspect;

    renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();

    renderer.render(this._scene, this._camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    renderer.setSize(oldW, oldH, false);
    this._camera.aspect = oldAspect;
    this._camera.updateProjectionMatrix();
    return dataUrl;
  }

  dispose() {
    cancelAnimationFrame(this._animId);
    this._ro.disconnect();
    this._groundGrid.dispose();
    this._sculpt.dispose();
    this._renderer.dispose();
    if (this._viewCube) this._viewCube.dispose();
    if (this._homeBtn)  this._homeBtn.remove();
  }

  // ── Internal ────────────────────────────────────────────────────────

  _dispose() {
    if (this._mesh)   { this._scene.remove(this._mesh);   this._mesh.geometry.dispose();  this._mesh.material.dispose(); }
    if (this._curves) {
      this._scene.remove(this._curves);
      this._curves.children.forEach(l => l.geometry.dispose());
    }
    // Sculpt overlays are intentionally NOT cleared here — a selection
    // survives mesh rebuilds triggered by onDelta.
    for (const obj of this._solidMeshes) {
      this._scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._solidMeshes = [];
    this._mesh = null; this._curves = null;
  }

  _resize() {
    cancelAnimationFrame(this._reszId);
    this._reszId = requestAnimationFrame(() => {
      const rect = this._canvas.getBoundingClientRect();
      const w = rect.width  || this._canvas.clientWidth;
      const h = rect.height || this._canvas.clientHeight;
      if (w <= 0 || h <= 0) return;
      this._renderer.setPixelRatio(window.devicePixelRatio);
      this._renderer.setSize(w, h, false);
      this._orbit.updateFrustum();
      if (this._viewCube) this._viewCube.resize();
      this._needsRender = true;
    });
  }

  _initUI() {
    const parent = this._canvas.parentElement || document.body;

    this._viewCube = new ViewCube(parent, (t, p) => this._orbit.animateTo(t, p));

    const btn = document.createElement('button');
    this._homeBtn = btn;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
    `;
    Object.assign(btn.style, {
      position: 'absolute', top: '135px', right: '20px',
      width: '32px', height: '32px', padding: '0',
      background: 'rgba(255, 255, 255, 0.82)', border: '1px solid #ccc',
      borderRadius: '4px', color: '#111', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s', zIndex: '10',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    });
    btn.onmouseenter = () => {
      btn.style.background  = '#fff';
      btn.style.borderColor = '#aaa';
      btn.style.color       = '#0066cc';
    };
    btn.onmouseleave = () => {
      btn.style.background  = 'rgba(255, 255, 255, 0.82)';
      btn.style.borderColor = '#ccc';
      btn.style.color       = '#111';
    };
    btn.onclick = () => this.goHome();
    parent.appendChild(btn);
  }

  _bindEvents() {
    const el = this._canvas;
    el.oncontextmenu = e => e.preventDefault();

    el.addEventListener('mousedown', e => {
      if (this._sculpt.tryHandleCanvasMousedown(e)) return;
      this._orbit.handleCanvasMousedown(e);
    });

    el.addEventListener('mousemove', e => {
      this._sculpt.handleCanvasMousemove(e);
    });

    el.addEventListener('mouseleave', () => {
      this._sculpt.handleCanvasMouseleave();
    });

    window.addEventListener('mousemove', e => {
      if (this._sculpt.tryHandleWindowMousemove(e)) return;
      this._orbit.tryHandleWindowMousemove(e);
    });

    window.addEventListener('mouseup', () => {
      this._sculpt.handleWindowMouseup();
      this._orbit.handleWindowMouseup();
    });

    el.addEventListener('wheel', e => this._orbit.handleWheel(e), { passive: false });

    // Touch.
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (this._sculpt.tryHandleTouchstart(touch)) {
          e.preventDefault();
          return;
        }
        this._orbit.beginTouchOrbit(touch);
      } else if (e.touches.length === 2) {
        this._orbit.beginTouchPinch(e.touches[0], e.touches[1]);
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      if (e.touches.length === 1 && this._sculpt.tryHandleTouchmove(e.touches[0])) {
        e.preventDefault();
        return;
      }
      if (e.touches.length === 1) {
        e.preventDefault();
        this._orbit.handleTouchOrbitMove(e.touches[0]);
      } else if (e.touches.length === 2) {
        e.preventDefault();
        this._orbit.handleTouchPinchMove(e.touches[0], e.touches[1]);
      }
    }, { passive: false });

    el.addEventListener('touchend', e => {
      if (e.touches.length === 0) {
        this._sculpt.handleTouchend();
        this._orbit.endTouch();
      }
    });
  }

  _startLoop() {
    let firstFrame = true;
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      if (this._orbit.step()) this._needsRender = true;

      if (this._needsRender) {
        if (this._viewCube) {
          this._viewCube.sync(this._camera);
          this._viewCube.render();
        }
        this._renderer.render(this._scene, this._camera);

        if (firstFrame && this._mesh) {
          firstFrame = false;
          this._canvas.classList.add('ready');
        }

        if (this._worstPts?.length && this._showLeaders) {
          this._leaders.update(this._camera, this._canvas);
        }
        this._needsRender = false;
      }

      this._sculpt.updateValueBoxPos();
    };
    loop();
  }
}
