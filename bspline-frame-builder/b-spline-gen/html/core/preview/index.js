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
 *   buildDrapeTexture(svg,w,h) — SE11: rasterize a drape SVG string (see
 *                              drape-svg.js's buildDrapeSvg) to a
 *                              transparent-background THREE.CanvasTexture,
 *                              or null if it fails
 *   setDrapeTexture(texture) — SE11e: set/clear the drape and rebuild the
 *                              LIT overlay mesh that shows it
 *                              (_rebuildDrapeMesh) — a second mesh sharing
 *                              the terrain's own geometry (and its
 *                              specular/shininess/flatShading, for
 *                              matching shading), rebuilt after every
 *                              update() rebuild
 *   dispose()
 *
 * The B-spline surface evaluation, mesh build, sculpt overlay, leader
 * lines, ground grid, and orbit controller are all in their own files.
 */

import { dbg } from '../debug.js';
import { fusLog } from '../fusion-bridge.js';
import { sanitizeSvgForRaster, prepareSvgForRaster, renderSvgNative } from '../stamp/render-svg.js';
import { DRAPE_TEXTURE_FLIPY } from './drape-svg.js';
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

    // SE11: the drape texture, if any — survives mesh rebuilds (re-applied
    // in update(), same pattern as _heatColours) since it's independent of
    // the height data itself.
    this._drapeTexture = null;
    // SE11e: a SECOND mesh sharing the terrain's own geometry (no copy),
    // rendered LIT (matching the terrain's own shading) with the drape
    // texture as its map — see _rebuildDrapeMesh's own comment for why a
    // separate mesh, not a
    // material property on the terrain mesh itself.
    this._drapeMesh = null;

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
        topColours, botColours, flatShading, topUvs: field.uvs,
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

    // SE11e: a fresh terrain mesh (new geometry) was just built above —
    // rebuild the drape overlay mesh against it (if a drape texture is
    // set), the same way the thicken heat-map's own colours are carried
    // across a rebuild via meshColours, above.
    this._rebuildDrapeMesh();

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

  /**
   * SE11b/SE11e: rasterize a drape SVG string (drape-svg.js's
   * buildDrapeSvg output — board-sized viewBox, only the qualifying
   * coloured elements) into a THREE.CanvasTexture. Same native SVG
   * render path the stamp rasterizer uses (renderSvgNative: Blob → <img>
   * → drawImage — real fonts/strokes, no canvg quirks), left TRANSPARENT
   * (a freshly created canvas's own default) wherever nothing is drawn.
   *
   * SE11 used `material.map` (multiply), then SE11b used `emissiveMap`
   * (additive) to survive dark carve-groove vertex colours — but additive
   * light can never show black (adding zero light IS black), so Fred's
   * own ask ("black lines on the mesh", SE11d) was structurally
   * impossible under either scheme. SE11e drops both: the drape is
   * rendered by a SEPARATE mesh (see setDrapeTexture / _rebuildDrapeMesh
   * below) with THIS texture as an alpha-blended `map` — transparent
   * where nothing was drawn reveals the terrain underneath unchanged,
   * opaque where painted REPLACES the terrain's own colour with the
   * drape's before lighting is applied. That overlay mesh is LIT
   * (amend 2 — a first pass made it unlit, which fixed "black invisible"
   * but overcorrected into flat, shading-free colour; see
   * _rebuildDrapeMesh's own comment), so a colour still reads back
   * exactly as picked AND shades like part of the surface, not a sticker
   * on top of it. Returns null on an empty/failed render — the caller
   * passes that straight to setDrapeTexture(null) to clear it.
   */
  async buildDrapeTexture(svgString, w, h) {
    if (!svgString) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    // willReadFrequently: true — matches core/stamp/index.js's own
    // stampCtx creation exactly (the SAME renderSvgNative call already
    // proven working in Fusion's embedded browser for the stamp path);
    // not proven necessary here, but this is the one concrete difference
    // from a known-working call site, so matching it removes it as a
    // variable rather than leaving an unmatched, unexplained gap.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    // No fill: a freshly created canvas is already fully transparent
    // (rgba(0,0,0,0)) everywhere — exactly the background this needs.
    // renderSvgNative draws straight onto it (no separate scratch canvas
    // needed any more — that existed only to protect an opaque
    // background fill from renderSvgNative's own internal clearRect,
    // which is moot now that "cleared" and "the background this wants"
    // are the same transparent state).
    try {
      const safe = prepareSvgForRaster(sanitizeSvgForRaster(svgString), w, h);
      await renderSvgNative(ctx, safe, w, h);
    } catch (e) {
      const msg = 'renderSvgNative failed: ' + (e && e.message ? e.message : e);
      console.warn('[TerrainPreview] drape render failed:', e);
      dbg('DRAPE', msg);
      try { fusLog('[DRAPE] ' + msg); } catch (_) {}
      return null;
    }
    // SE11b diagnostic, kept but re-aimed at alpha: prove the canvas
    // actually has real (non-transparent) content, so a blank/failed
    // render is distinguishable from "rendered fine, something else is
    // wrong downstream" instead of guessed at.
    try {
      const probe = ctx.getImageData(0, 0, w, h).data;
      let painted = 0;
      for (let i = 3; i < probe.length; i += 4) {
        if (probe[i] > 10) painted++;
      }
      const msg = `drape canvas after render: ${painted}/${probe.length / 4} painted (non-transparent) px`;
      dbg('DRAPE', msg);
      try { fusLog('[DRAPE] ' + msg); } catch (_) {}
    } catch (e) {
      const msg = 'drape canvas probe failed: ' + (e && e.message ? e.message : e);
      dbg('DRAPE', msg);
      try { fusLog('[DRAPE] ' + msg); } catch (_) {}
    }

    const THREE = this._THREE;
    const texture = new THREE.CanvasTexture(canvas);
    // SE11c: DRAPE_TEXTURE_FLIPY (drape-svg.js) — settled empirically via
    // scripts/smoke-editor.mjs's `drape-align` mode (real carve-vs-drape
    // data, not reasoning) after two reasoned guesses at this exact value
    // were each wrong at least once; see that constant's own comment.
    // Unaffected by SE11e's map/emissive change — flipY is about WHICH
    // texture row a uv v-value samples, orthogonal to how the material
    // uses the sampled colour.
    texture.flipY = DRAPE_TEXTURE_FLIPY;
    // SE11e amend (Fred): explicit, not relying on CanvasTexture's own
    // defaults — a non-power-of-two canvas silently disables mipmap
    // generation, which is what produced the reported banding on steep
    // groove walls (many texels per screen pixel, no mip level to
    // average them, so a single aliased sample shows through). The
    // caller now rounds w/h to a power of two (nextPow2, drape-svg.js)
    // specifically so `generateMipmaps: true` here actually takes
    // effect instead of being silently downgraded.
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * SE11e (amend 2, Fred: "color still needs shading" — NOT unlit): (re)build
   * the drape OVERLAY mesh against the CURRENT terrain geometry. A
   * separate `THREE.Mesh` sharing `this._mesh.geometry` directly (no
   * copy — the SAME position/normal/uv buffers, so the overlay is always
   * pixel- and shading-exact with whatever terrain shape is current)
   * with a LIT `MeshPhongMaterial` — the FIRST amend's `MeshBasicMaterial`
   * (unlit) fixed "black is invisible" (SE11b's additive-emissive bug)
   * but overcorrected: flat, unshaded color reading as a paint sticker
   * rather than the surface's own material.
   *
   * Chose "a separate lit mesh, alpha-blended over the terrain" over the
   * amend's other offered option ("inject into the terrain material via
   * onBeforeCompile, mixing diffuseColor before lighting") because it
   * reaches the SAME visual result — at a painted pixel, `transparent`
   * alpha-blending REPLACES the terrain's colour with the drape's before
   * either one's lighting is computed, exactly like `mix(base, drape,
   * alpha)` — without hand-patching GLSL chunks: no shader-chunk version
   * coupling, no risk of a chunk name changing under a future Three.js
   * bump, testable by reading the material's own declared properties
   * (see tests/drape-mesh.test.js) instead of parsing injected shader
   * source. Reuses the terrain's OWN `specular`/`shininess`/`flatShading`
   * so the drape shades identically to the surface around it (cloning
   * `specular` — a `THREE.Color` — so mutating one material's color
   * object can never leak into the other's).
   *
   * `color: 0xffffff` (white) and no `vertexColors` on this material —
   * the drape's colour comes ONLY from its own texture, deliberately
   * independent of any active thicken/sculpt vertex-colour overlay on
   * the terrain beneath it (SE11b's own root cause was exactly this kind
   * of unwanted mixing, just via a different mechanism).
   *
   * `polygonOffset` (negative factor/units push a polygon TOWARD the
   * camera) keeps this exactly-coincident overlay from z-fighting with
   * the terrain surface it's drawn on top of — checked at a steep,
   * close-up angle in Fusion (WORK-LOG SE11e amend 2), no flicker.
   * `depthWrite: false` is the standard practice for a transparent
   * overlay — it still depth-TESTS against (renders behind) anything
   * genuinely in front of it, it just doesn't block something
   * transparent rendered after it from also showing through.
   *
   * Always removes any EXISTING drape mesh first — called after every
   * update() rebuild, when the terrain geometry it must match is brand
   * new, so a stale overlay would be pointing at now-disposed geometry.
   * No-ops (leaves it removed) when there's no drape texture or no
   * terrain mesh yet.
   */
  _rebuildDrapeMesh() {
    if (this._drapeMesh) {
      this._scene.remove(this._drapeMesh);
      this._drapeMesh.material.dispose();
      this._drapeMesh = null;
    }
    if (!this._drapeTexture || !this._mesh) return;
    const THREE = this._THREE;
    const terrainMat = this._mesh.material;
    const mat = new THREE.MeshPhongMaterial({
      map: this._drapeTexture,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      side: terrainMat.side,
      specular: terrainMat.specular ? terrainMat.specular.clone() : undefined,
      shininess: terrainMat.shininess,
      flatShading: terrainMat.flatShading,
    });
    this._drapeMesh = new THREE.Mesh(this._mesh.geometry, mat);
    this._drapeMesh.visible = this._mesh.visible;
    this._scene.add(this._drapeMesh);
  }

  /** Set (or clear, with null) the drape texture and rebuild the overlay
   *  mesh that shows it (_rebuildDrapeMesh above). Disposes the previous
   *  texture — buildDrapeTexture makes a fresh CanvasTexture on every
   *  refresh, so without this every edit would leak one GPU texture. */
  setDrapeTexture(texture) {
    if (this._drapeTexture && this._drapeTexture !== texture) {
      this._drapeTexture.dispose();
    }
    this._drapeTexture = texture || null;
    this._rebuildDrapeMesh();
    this._needsRender = true;
  }

  goHome()                    { this._orbit.goHome(this._lastWidth, this._lastHeight); }
  animateTo(theta, phi)       { this._orbit.animateTo(theta, phi); }
  setSculptMode(config)       { this._sculpt.setMode(config); }
  setCurvesVisible(visible) {
    this._curvesVisible = visible;
    if (this._mesh)      this._mesh.visible      = !visible;
    // SE11e: the drape overlay sits directly on the terrain surface —
    // hide it in lockstep, or it'd render as colour floating in space
    // once the surface it's drawn on top of disappears.
    if (this._drapeMesh) this._drapeMesh.visible = !visible;
    if (this._curves)    this._curves.visible    =  visible;
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
    if (this._drapeMesh) { this._scene.remove(this._drapeMesh); this._drapeMesh.material.dispose(); }
    if (this._drapeTexture) this._drapeTexture.dispose();
    this._renderer.dispose();
    if (this._viewCube) this._viewCube.dispose();
    if (this._homeBtn)  this._homeBtn.remove();
  }

  // ── Internal ────────────────────────────────────────────────────────

  _dispose() {
    if (this._mesh)   { this._scene.remove(this._mesh);   this._mesh.geometry.dispose();  this._mesh.material.dispose(); }
    // SE11e: the drape mesh SHARES this geometry (just disposed above) —
    // remove it and dispose only its own material, never the geometry a
    // second time. update() rebuilds it fresh against the new terrain
    // mesh via _rebuildDrapeMesh() right after this runs.
    if (this._drapeMesh) {
      this._scene.remove(this._drapeMesh);
      this._drapeMesh.material.dispose();
      this._drapeMesh = null;
    }
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

    // Wheel is registered passive so modern browsers can keep
    // compositing while high-frequency wheel/trackpad events fire (BUG-08).
    // The page wouldn't scroll over the canvas anyway — the canvas has
    // no scrollable content — but if the surrounding layout ever does,
    // CSS `overscroll-behavior: contain` on the canvas keeps the chain
    // from bubbling up to the document.
    try { el.style.overscrollBehavior = 'contain'; } catch (_) {}
    el.addEventListener('wheel', e => this._orbit.handleWheel(e), { passive: true });

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
