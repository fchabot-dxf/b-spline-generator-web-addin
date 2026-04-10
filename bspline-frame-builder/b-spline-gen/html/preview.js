/**
 * preview.js — Three.js terrain preview evaluated on the actual B-spline surface.
 *
 * Rather than a triangulated PlaneGeometry, the preview:
 *   1. Builds the same clamped cubic knot vectors as stepWriter.js
 *   2. Evaluates the B-spline surface with the de Boor algorithm
 *   3. Renders a shaded mesh from the evaluated surface
 *   4. Overlays U and V isoparameter curves — the real B-spline curve grid
 *
 * Uses Three.js r128 UMD (global window.THREE). No extra OrbitControls needed.
 */

import { clampedKnots, evalBSplineSurface } from './bspline-math.js';
import { P } from './state.js';
import { COORD_SYSTEM } from './coords.js';

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
    this._needsRender = true; // Initial render
    this._curvesVisible = false;
    this._lastW = 0;
    this._lastH = 0;

    // Thicken heat-map state
    this._heatColours  = null;   // Float32Array[nx*nz*3] or null
    this._worstPts     = [];     // [{x,y,z,actual,requested}, ...]
    this._showLeaders  = true;
    this._svgOverlay   = null;   // SVG element
    this._solidMeshes  = [];     // wireframe bottom + side wall lines

    // Sculpt state
    this._sculpt          = null;  // config set by setSculptMode()
    this._sculptSelected  = null;  // { ci, cj, wx, wy, wz } — selected CP
    this._sculptDrag      = null;  // { startY, startVal } while dragging
    this._sculptDotGroup  = null;  // THREE.Group — per-CP weight dots
    this._sculptCrossGroup= null;  // THREE.Group — crosshair lines
    this._falloffRing     = null;  // THREE.Group — radius ring(s)
    this._sculptValBox    = null;  // HTML overlay — value input
    this._lastHitZ        = null;  // last known terrain Z for plane intersection

    // Renderer
    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setClearColor(0xffffff, 1);
    canvas.style.touchAction = 'none'; // Prevent scrolling while interacting

    // Scene
    this._scene = new THREE.Scene();
    // this._scene.fog = new THREE.FogExp2(0xffffff, 0.038);

    // Sculpt cursor sight overlay
    this._sculptSight = document.createElement('div');
    Object.assign(this._sculptSight.style, {
      position:      'absolute',
      pointerEvents: 'none',
      border:        '1px dashed rgba(255,255,255,0.6)',
      width:         '20px',
      height:        '20px',
      display:       'none',
      zIndex:        '30',
      willChange:    'transform',
      top:           '0',
      left:          '0',
    });
    const parent = canvas.parentElement || document.body;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(this._sculptSight);

    // Camera
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);

    // Lights
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.30));
    const sun = new THREE.DirectionalLight(0xfff4d0, 1.4); // Increased for "punchy" highlights
    sun.position.set(4, 8, 3);
    this._scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb8d0ff, 0.60); // Increased for better fill
    fill.position.set(-5, 3, -4);
    this._scene.add(fill);


    // Orbit state (Quaternion-based for unlimited rotation)
    this._orb = {
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.85, 0, -0.6, 'ZXY')),
      r: 14,
      target: new THREE.Vector3()
    };
    this._targetOrb = {
      q:      this._orb.q.clone(),
      r:      this._orb.r,
      target: this._orb.target.clone()
    };
    this._home = { ...this._targetOrb, q: this._targetOrb.q.clone(), target: this._targetOrb.target.clone() };
    this._drag = null;
    this._bindOrbit();

    // Navigation UI
    this._initUI();

    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement || canvas);
    this._startLoop();
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  /**
   * Rebuild the terrain mesh and curves based on new height data.
   * @param {Float32Array} heights
   * @param {number} nx
   * @param {number} nz
   * @param {number} width
   * @param {number} height
   * @param {number} carveZ
   * @param {Float32Array|null} heatColours  optional [nx*nz*3] RGB vertex colours
   * @param {Array}             worstPts     optional worst-clamped point list
   * @param {boolean}           showLeaders  whether to show SVG labels
   * @param {Float32Array|null} offsetPts    optional [nx*nz*3] bottom surface positions
   * @returns {{ minZ, maxZ }}
   */
  update(heights, nx, nz, width, height, carveZ,
    meshColours = null, worstPts = [], showLeaders = true, offsetPts = null, shadingIntensity = 0.25,
    thinPts = [], intersectPts = [], thickenWireframe = false, botColours = null, flatShading = false) {
    const THREE = this._THREE;
    this._dispose();

    // (Overlay spheres for thin/intersecting points removed for clean mesh-only heatmap)

    // Store thicken overlay state for re-use in setThickenOverlay()
    this._heatColours = null;
    this._worstPts    = worstPts;
    this._showLeaders = showLeaders;
    this._lastHeights = heights;
    this._lastOffsetPts = offsetPts;
    this._lastNx = nx; this._lastNz = nz;
    this._lastWidth = width; this._lastHeight = height;

    // ── Grid Sanitization & Trace ──────────────────────────────────────────
    if (nx < 2 || nz < 2 || isNaN(nx) || isNaN(nz)) {
        console.error(`[TerrainPreview] Invalid Grid received: ${nx}x${nz}. Forcing 2x2 placeholder to prevent crash.`);
        nx = Math.max(2, nx || 2);
        nz = Math.max(2, nz || 2);
    }

    const W = width, H = height;
    const count = nx * nz;
    const geometry = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const indices = [];
    let minZ = Infinity, maxZ = -Infinity;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        
        // Use 1e-6 as epsilon for division safety
        const u = i / Math.max(1, nx - 1);
        const v = j / Math.max(1, nz - 1);
        
        const x = -W / 2 + u * W;
        const y = -H / 2 + v * H;
        let z = heights[idx];

        // NaN Protection
        if (isNaN(z)) z = 0;
        if (isNaN(x)) pos[idx * 3 + 0] = 0; else pos[idx * 3 + 0] = x;
        if (isNaN(y)) pos[idx * 3 + 1] = 0; else pos[idx * 3 + 1] = y;
        pos[idx * 3 + 2] = z;

        uvs[idx * 2 + 0] = isNaN(u) ? 0 : u;
        uvs[idx * 2 + 1] = isNaN(v) ? 0 : v;

        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }

    // Build index buffer (two triangles per quad cell)
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = (j + 1) * nx + i, d = c + 1;
        indices.push(a, b, c, c, b, d);
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const useMeshColours = meshColours && meshColours.length === count * 3;
    const hasSolid = offsetPts && offsetPts.length >= count * 3;

    // --- Live Brush Highlight ---
    let liveBrushColours = null;
    if (this._sculpt && this._sculpt.ci !== undefined && this._sculpt.cj !== undefined && this._sculpt.radiusIn) {
      // Overlay highlight on top of meshColours
      liveBrushColours = meshColours ? meshColours.slice() : new Float32Array(count * 3);
      const dx = this._sculpt.widthIn / (this._sculpt.nx - 1);
      const dy = this._sculpt.heightIn / (this._sculpt.nz - 1);
      const r = this._sculpt.radiusIn;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i;
          const x = -this._sculpt.widthIn / 2 + i * dx;
          const y = this._sculpt.heightIn / 2 - j * dy;
          const cx = -this._sculpt.widthIn / 2 + this._sculpt.ci * dx;
          const cy = this._sculpt.heightIn / 2 - this._sculpt.cj * dy;
          const dist = Math.hypot(x - cx, y - cy);
          if (dist <= r) {
            // Falloff: 1 at center, 0 at edge
            const t = dist / r;
            const falloff = 1 - (t * t * (3 - 2 * t));
            // Light green: (0.6, 1.0, 0.6), blend with base
            liveBrushColours[idx * 3 + 0] = meshColours ? meshColours[idx * 3 + 0] * (1 - falloff) + 0.6 * falloff : 0.6 * falloff;
            liveBrushColours[idx * 3 + 1] = meshColours ? meshColours[idx * 3 + 1] * (1 - falloff) + 1.0 * falloff : 1.0 * falloff;
            liveBrushColours[idx * 3 + 2] = meshColours ? meshColours[idx * 3 + 2] * (1 - falloff) + 0.6 * falloff : 0.6 * falloff;
          }
        }
      }
    }

    const showSolid = hasSolid && !thickenWireframe;

    if (showSolid) {
        // Always use the liveBrushColours (with highlight) for the top surface if present
        const topColours = liveBrushColours || meshColours;
        if (liveBrushColours) {
          console.log('[VertexColor] liveBrushColours sample:', Array.from(liveBrushColours.slice(0, 12)));
        }
        if (meshColours) {
          console.log('[VertexColor] meshColours sample:', Array.from(meshColours.slice(0, 12)));
        }
        if (botColours) {
          console.log('[VertexColor] botColours sample:', Array.from(botColours.slice(0, 12)));
        }
        if (liveBrushColours) {
          console.log('[VertexColor] Blending liveBrushColours highlight into top surface.');
        }
        console.log('[VertexColor] showSolid=true, calling _buildSolidMesh with topColours:', topColours && topColours.length, 'botColours:', botColours && botColours.length);
        this._buildSolidMesh(offsetPts, pos, nx, nz, topColours, THREE, botColours, flatShading);
    } else {
        // Non-solid mode: render only the top spline surface.
        geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        if (liveBrushColours) {
          geometry.setAttribute('color', new THREE.BufferAttribute(liveBrushColours, 3));
        } else if (useMeshColours) {
          geometry.setAttribute('color', new THREE.BufferAttribute(meshColours.slice(), 3));
        }

        const isWireframeMode = !!thickenWireframe;
        const mat = new THREE.MeshPhongMaterial({
          color:        (liveBrushColours || useMeshColours) ? 0xffffff : 0xd4b896,
          vertexColors: !!(liveBrushColours || useMeshColours),
          specular:     0x222222,
          shininess:    60,
          side:         THREE.DoubleSide,
          flatShading:  flatShading,
          transparent:  isWireframeMode,
          opacity:      isWireframeMode ? 0.35 : 1.0
        });
        this._mesh = new THREE.Mesh(geometry, mat);
        // Always show top surface mesh; wireframe overlay is in addition.
        this._mesh.visible = !this._curvesVisible;
        this._scene.add(this._mesh);
    }

    // If wireframe mode requested, overlay bottom-surface B-spline curves and outline.
    if (hasSolid && thickenWireframe) {
        if (this._mesh) {
            this._mesh.material.transparent = false;
            this._mesh.material.opacity = 1.0;
            this._mesh.material.depthWrite = true;
            this._mesh.material.needsUpdate = true;
        }
        this._buildSolidWireframe(offsetPts, pos, nx, nz, THREE);
    }

    // ── B-spline isoparameter curve lines ───────────────────────────
    const curveGroup = new THREE.Group();
    const curveMat   = new THREE.LineBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.6 });

    // OPTIMIZATION: Only evaluate curves if they are visible OR if the grid is small.
    // For large grids, evaluating every isoparameter line is O(N^2) and stalls the UI.
    const shouldDrawCurves = this._curvesVisible || count < 1000;
    
    if (shouldDrawCurves) {
        const ukn = clampedKnots(nx, 3);
        const vkn = clampedKnots(nz, 3);
        const ctrl = [];
        for (let i = 0; i < nx; i++) {
            ctrl.push([]);
            for (let j = 0; j < nz; j++) {
                ctrl[i].push({
                    x: -W / 2 + i * W / (nx - 1),
                    y: -H / 2 + j * H / (nz - 1),
                    z: heights[j * nx + i],
                });
            }
        }

        // DYNAMIC DENSITY: Reduce the number of lines on dense grids
        const skipU = nx > 100 ? 4 : (nx > 60 ? 2 : 1);
        const skipV = nz > 100 ? 4 : (nz > 60 ? 2 : 1);
        const steps = count > 5000 ? 20 : 40; 

        // DRAW U-DIRECTION LINES (Columns)
        for (let i = 0; i < nx; i += skipU) {
            const u = i / (nx - 1);
            const pts = [];
            for (let j = 0; j <= steps; j++) {
                const v = j / steps;
                const p = evalBSplineSurface(ctrl, nx, nz, ukn.full, vkn.full, u, v);
                pts.push(new THREE.Vector3(p.x, p.y, p.z));
            }
            curveGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), curveMat));
        }

        // DRAW V-DIRECTION LINES (Rows)
        for (let i = 0; i < nz; i += skipV) {
            const v = i / (nz - 1);
            const pts = [];
            for (let j = 0; j <= steps; j++) {
                const u = j / steps;
                const p = evalBSplineSurface(ctrl, nx, nz, ukn.full, vkn.full, u, v);
                pts.push(new THREE.Vector3(p.x, p.y, p.z));
            }
            curveGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), curveMat));
        }
    }

    this._curves = curveGroup;
    this._curves.visible = this._curvesVisible;
    this._scene.add(curveGroup);

    // ── Thicken elements ──────────────────────────────────────
    if (hasSolid && P.thickenWireframe) {
        // Wireframe-only, with B-spline bottom surface approximation via _buildSolidWireframe.
        this._buildSolidWireframe(offsetPts, pos, nx, nz, THREE);
    }


    // Always update target Z to current terrain center to prevent drifting when height range changes
    const midZ = (minZ + maxZ) / 2;
    this._targetOrb.target.z = midZ;

    // Optional top-down 2D overlay using same heightmap
    // (Wait: this was drawing to svgEditorTopView redundantly on every rebuild.
    // main.js explicitly refreshes it before opening the SVG Editor, so we can skip it here.)
    // this.updateTopView(heights, nx, nz, 'svgEditorTopView', shadingIntensity);

    // Only snap camera target/distance if stock size changed OR if it was never properly initialized
    if (W !== this._lastW || H !== this._lastH || this._lastW === 0) {
      // SAFEFGUARD 1: Prevent viewport from ever being 0x0
      const rect = this._canvas.getBoundingClientRect();
      const canvasW = Math.max(1, rect.width || this._canvas.clientWidth || 800);
      const canvasH = Math.max(1, rect.height || this._canvas.clientHeight || 600);
      const aspect  = canvasW / canvasH;
      
      // SAFEGUARD 2: Prevent model dimensions from ever being 0
      const safeW = Math.max(0.1, W || 10);
      const safeH = Math.max(0.1, H || 10);

      // Fitting logic: Ensure r is large enough to fit both width and height
      const rV = safeH / 0.9;
      const rH = safeW / (0.9 * aspect);
      const rIdeal = Math.max(rV, rH, Math.sqrt(safeW*safeW + safeH*safeH) * 1.25);
      
      this._targetOrb.r = rIdeal * 1.05; // much tighter fit
      this._targetOrb.target.set(0, 0, midZ);
      
      // If first run, snap immediately (no lerp)
      if (this._lastW === 0) {
        this._orb.r = this._targetOrb.r;
        this._orb.target.copy(this._targetOrb.target);
        this._orb.q.copy(this._targetOrb.q); 

        // Force the real Three.js camera to this position right now!
        const pos = new THREE.Vector3(0, 0, this._orb.r).applyQuaternion(this._orb.q);
        this._camera.position.addVectors(this._orb.target, pos);
        this._camera.quaternion.copy(this._orb.q);
        this._updateCameraFrustum();

        this._resize(); // force renderer sync
      }
      this._lastW = W;
      this._lastH = H;

      // Save this fresh state as our 'Home' view
      this._home.q      = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.85, 0, -0.6, 'ZXY'));
      this._home.r      = this._targetOrb.r;
      this._home.target = this._targetOrb.target.clone();
    }

    // Initial leader render (will re-run each frame too)
    this._updateLeaders();

    // ── Re-apply sculpt overlay if a CP is selected ──────────────────
    if (this._sculptSelected && this._sculpt) {
      const { ci, cj } = this._sculptSelected;
      const ddx = W / (nx - 1);
      const ddy = H / (nz - 1);
      const wx  = -W / 2 + ci * ddx;
      const wy  = -H / 2 + cj * ddy;
      const wz  = heights[cj * nx + ci];
      this._sculptSelected = { ci, cj, wx, wy, wz };
      this._buildSculptOverlay(ci, cj, wz, true);
      const val = this._sculpt.getDelta?.(ci, cj) ?? 0;
      this._showSculptValBox(val);
    }

    // Force a render frame so the new mesh actually appears!
    this._needsRender = true; 

    return { minZ, maxZ };
  }

  /**
   * Export the current mesh geometry in the requested orientation for Fusion CustomGraphics.
   * @param {'z-up'|'y-up'} orientation
   * @returns {{ verts: number[], indices: number[] } | null}
   */
  getMeshData(orientation = 'z-up') {
    if (!this._mesh || !this._mesh.geometry) return null;
    const geom = this._mesh.geometry;
    const posAttribute = geom.getAttribute('position');
    const idxAttribute = geom.getIndex();
    if (!posAttribute || !idxAttribute) return null;

    const nx = this._lastNx;
    const nz = this._lastNz;
    const rawPos = posAttribute.array;
    const count = rawPos.length; // nx * nz * 3
    const N     = count / 3;     // Total number of vertices in top layer

    // 1. Prepare Top Vertices (scaled to cm for Fusion)
    const transform = (p3, out, offset = 0) => {
      for (let i = 0; i < p3.length; i += 3) {
        const x = p3[i];
        const y = p3[i + 1];
        const z = p3[i + 2];
        if (orientation === 'y-up') {
          out[offset + i]     = x * 2.54;
          out[offset + i + 1] = z * 2.54;
          out[offset + i + 2] = -y * 2.54;
        } else {
          out[offset + i]     = x * 2.54;
          out[offset + i + 1] = y * 2.54;
          out[offset + i + 2] = z * 2.54;
        }
      }
    };

    const hasSolid = !!(this._lastOffsetPts && this._lastOffsetPts.length === count);
    const totalVerts = hasSolid ? count * 2 : count;
    const verts = new Float32Array(totalVerts);
    transform(rawPos, verts, 0);

    const topIdxArray = idxAttribute.array;
    // Top indices are CCW in the buffer anyway after my previous fix, 
    // but idxAttribute.array might be the original. 
    // Wait! idxAttribute comes from geom.getIndex().
    // If I just call computeVertexNormals(), Three.js uses the index.
    
    // I need to ensure CCW Top and CW Bottom.
    let finalIndices = [];
    for (let i = 0; i < topIdxArray.length; i += 3) {
      // Top: a, b, c (CCW)
      finalIndices.push(topIdxArray[i], topIdxArray[i + 1], topIdxArray[i + 2]);
    }

    if (hasSolid) {
      // 2. Prepare Bottom Vertices
      transform(this._lastOffsetPts, verts, count);

      // 3. Bottom Indices (CW: a, c, b)
      const botIndices = [];
      for (let i = 0; i < topIdxArray.length; i += 3) {
        botIndices.push(topIdxArray[i] + N, topIdxArray[i + 2] + N, topIdxArray[i + 1] + N);
      }
      finalIndices = finalIndices.concat(botIndices);

      // 4. Side Walls
      const sideIndices = [];
      const addQuad = (i1, i2, i3, i4) => {
        // CCW from outside: t1, b1, t2 -> t2, b1, b2
        sideIndices.push(i1, i3, i2, i2, i3, i4); 
      };

      // Boundary indices logic...
      // wait! I should use the SAME boundary logic as _buildSolidMesh.
      // But getMeshData uses a simpler loop.
      
      // Let's just fix the winding in the existing addQuad calls.
      
      // Front edge (j=0)
      for (let i = 0; i < nx - 1; i++) {
        const t1 = i, t2 = i + 1;
        const b1 = N + i, b2 = N + i + 1;
        sideIndices.push(t1, b1, t2, t2, b1, b2);
      }
      // Back edge (j=nz-1)
      for (let i = 0; i < nx - 1; i++) {
        const t1 = (nz - 1) * nx + i, t2 = t1 + 1;
        const b1 = N + t1, b2 = N + t2;
        sideIndices.push(t1, t2, b1, t2, b2, b1);
      }
      // Left edge (i=0)
      for (let j = 0; j < nz - 1; j++) {
        const t1 = j * nx, t2 = (j + 1) * nx;
        const b1 = N + t1, b2 = N + t2;
        sideIndices.push(t1, b1, t2, t2, b1, b2);
      }
      // Right edge (i=nx-1)
      for (let j = 0; j < nz - 1; j++) {
        const t1 = j * nx + (nx - 1), t2 = (j + 1) * nx + (nx - 1);
        const b1 = N + t1, b2 = N + t2;
        sideIndices.push(t1, t2, b1, t2, b2, b1);
      }
      finalIndices = finalIndices.concat(sideIndices);
    }

    // 5. Build final plain arrays (JSON.stringify works poorly on TypedArrays)
    // OPTIMIZATION: Use Array.from() or spread for faster conversion.
    const finalVerts = Array.from(verts);

    return {
      verts: finalVerts,
      indices: finalIndices
    };
  }

  /**
   * Update heat-map overlay without a full mesh rebuild (e.g. toggle leaders).
   */
  setThickenOverlay(heatColours, worstPts, showLeaders) {
    this._heatColours = heatColours;
    this._worstPts    = worstPts ?? [];
    this._showLeaders = showLeaders;

    // Re-colour existing mesh vertices
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
    this._updateLeaders();
  }

  goHome() {
    const W = this._lastWidth;
    const H = this._lastHeight;
    if (!W || !H) return;

    const rect = this._canvas.getBoundingClientRect();
    const canvasW = rect.width || this._canvas.clientWidth || 800;
    const canvasH = rect.height || this._canvas.clientHeight || 600;
    const aspect  = canvasW / canvasH;

    // Correctly fit both dimensions:
    const rV = H / 0.8;
    const rH = W / (0.8 * aspect);
    const rFit = Math.max(rV, rH, Math.sqrt(W*W + H*H) * 1.5) * 1.25;

    // Reset to default home orientation and best-fit zoom
    this._targetOrb.q.setFromEuler(new window.THREE.Euler(0.85, 0, -0.6, 'ZXY'));
    this._targetOrb.r = rFit;
    
    // Center of terrain in Z (midZ already stored in this._targetOrb.target.z)
    this._targetOrb.target.set(0, 0, this._targetOrb.target.z || 0);
  }

  animateTo(theta, phi) {
    // Convert target theta/phi to quaternion
    this._targetOrb.q.setFromEuler(new THREE.Euler(phi, 0, theta, 'ZXY'));
  }

  setCurvesVisible(visible) {
    this._curvesVisible = visible;
    // Either-Or Visibility (High-Fidelity Inspection Mode)
    if (this._mesh) this._mesh.visible = !visible;
    if (this._curves) this._curves.visible = visible;
    this._needsRender = true;
  }

  updateTopView(heights, nx, nz, canvasId = 'svgEditorTopView', shadingIntensity = 0.25) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    if (!heights || nx <= 0 || nz <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // draw 2D orthographic heightmap (top-down)
    const w = canvas.width;
    const h = canvas.height;

    const img = ctx.createImageData(w, h);
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0, len = heights.length; i < len; i += 1) {
      const z = heights[i];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const range = Math.max(maxZ - minZ, 1e-3);

    // Light direction (Top-left lighting)
    const lx = -1, ly = 1, lz = 1;
    const mag = Math.sqrt(lx*lx + ly*ly + lz*lz);
    const nlx = lx/mag, nly = ly/mag, nlz = lz/mag;

    for (let py = 0; py < h; py++) {
      // Unified Top-is-Top: canvas py=0 is at the Back (j=nz-1),
      // Canvas Bottom (py=h) is at the Front (j=0).
      const iy = COORD_SYSTEM.rasterYToGridRow(py, nz, h);
      
      for (let px = 0; px < w; px++) {
        const fx = px / w * nx;
        const ix = Math.floor(fx);
        const idx = iy * nx + ix;
        const z = heights[idx];
        
        // 1. FIX: Use a neutral 'Mid-Gray' instead of a height gradient
        // This prevents the "map" look where higher areas are simply whiter.
        let baseCol = 160; 

        // --- 2. Relief Shading (Slope-based) ---
        // Simple Central Difference Gradient
        let shading = 0;
        if (shadingIntensity > 0 && ix > 0 && ix < nx - 1 && iy > 0 && iy < nz - 1) {
            // 2. STEEPEN GRADIENT: Multiply dZ by 40.0 to catch subtle surface changes
            const dzdx = (heights[idx + 1] - heights[idx - 1]) * 40.0;
            const dzdy = (heights[idx + nx] - heights[idx - nx]) * 40.0;
            
            // Vector Normal = (-dzdx, -dzdy, 1)
            const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
            const nmag = Math.sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_);
            const nnx = nx_/nmag, nny = ny_/nmag, nnz = nz_/nmag;
            
            // Dot Product with Light
            const dot = nnx*nlx + nny*nly + nnz*nlz;
            
            // 3. PUNCH SHADOWS: Increase the shading scale to 150.0
            shading = (dot - 0.5) * 150.0 * shadingIntensity;
        }

        const finalCol = Math.round(Math.max(0, Math.min(255, baseCol + shading)));
        const off = (py * w + px) * 4;
        img.data[off + 0] = finalCol;
        img.data[off + 1] = finalCol;
        img.data[off + 2] = finalCol;
        img.data[off + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    // Draw origin cross-hair at center of SVG top view, showing model origin.
    ctx.fillStyle = 'rgba(220, 30, 30, 0.9)';
    ctx.strokeStyle = 'rgba(220, 30, 30, 1)';
    ctx.lineWidth = 2;
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }

  /**
   * Capture a high-fidelity 3D snapshot of the current scene state.
   * @param {number} width 
   * @param {number} height 
   * @returns {string} Data URL (PNG)
   */
  getSnapshot(width = 400, height = 300) {
    const THREE = this._THREE;
    const renderer = this._renderer;
    
    // 1. Save current state
    const oldW = this._canvas.width;
    const oldH = this._canvas.height;
    const oldAspect = this._camera.aspect;

    // 2. Temporarily resize for snapshot
    renderer.setSize(width, height, false);
    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();

    // 3. Render and capture
    renderer.render(this._scene, this._camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    // 4. Restore original state
    renderer.setSize(oldW, oldH, false);
    this._camera.aspect = oldAspect;
    this._camera.updateProjectionMatrix();

    return dataUrl;
  }

  dispose() {
    cancelAnimationFrame(this._animId);
    this._ro.disconnect();
    this._renderer.dispose();
    if (this._viewCube) this._viewCube.dispose();
    if (this._homeBtn) this._homeBtn.remove();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** 
   * Construct a single watertight BufferGeometry for the thickened solid.
   * Includes Top, Bottom, and Side Wall faces.
   */
  _buildSolidMesh(offsetPts, topPos, nx, nz, meshColours, THREE, botColours = null, flatShading = false) {
    const count = nx * nz;
    const geometry = new THREE.BufferGeometry();
    
    // 1. Boundary identification for side walls
    const boundaryIndices = COORD_SYSTEM.gridBoundaryIndices(nx, nz);
    const B = boundaryIndices.length;

    // 2. Vertices: [Top (N), Bottom (N), SideTop (B), SideBot (B)]
    const totalVerts = count * 2 + B * 2;
    const pos = new Float32Array(totalVerts * 3);
    const col = new Float32Array(totalVerts * 3);
    const useColours = !!(meshColours && meshColours.length === count * 3);

    const safeNum = v => Number.isFinite(v) ? v : 0;

    // Top & Bottom (migrate NaN-safety to prevent BufferGeometry bad bounding spheres)
    for (let i = 0; i < count * 3; i++) {
        pos[i] = safeNum(topPos[i]);
        pos[count * 3 + i] = safeNum(offsetPts[i]);
    }
    if (useColours) {
      col.set(meshColours, 0);
      
      // NEW: Use botColours if provided, otherwise fallback to top colors
      if (botColours && botColours.length === count * 3) {
          col.set(botColours, count * 3);
      } else {
          col.set(meshColours, count * 3);
      }
    } else {
      col.fill(1.0); // fallback white
    }

    // Side Walls (Duplicated boundary vertices)
    const SIDE_START = count * 2;
    for (let i = 0; i < B; i++) {
        const idx = boundaryIndices[i];
        // Side Top (NaN-safe copy)
        pos[(SIDE_START + i) * 3 + 0] = safeNum(topPos[idx * 3 + 0]);
        pos[(SIDE_START + i) * 3 + 1] = safeNum(topPos[idx * 3 + 1]);
        pos[(SIDE_START + i) * 3 + 2] = safeNum(topPos[idx * 3 + 2]);
        
        if (useColours) {
            col[(SIDE_START + i) * 3 + 0] = col[idx * 3 + 0];
            col[(SIDE_START + i) * 3 + 1] = col[idx * 3 + 1];
            col[(SIDE_START + i) * 3 + 2] = col[idx * 3 + 2];
        } else {
            const grey = 0.55; 
            col[(SIDE_START + i) * 3 + 0] = grey;
            col[(SIDE_START + i) * 3 + 1] = grey;
            col[(SIDE_START + i) * 3 + 2] = grey;
        }

        // Side Bot (NaN-safe copy)
        pos[(SIDE_START + B + i) * 3 + 0] = safeNum(offsetPts[idx * 3 + 0]);
        pos[(SIDE_START + B + i) * 3 + 1] = safeNum(offsetPts[idx * 3 + 1]);
        pos[(SIDE_START + B + i) * 3 + 2] = safeNum(offsetPts[idx * 3 + 2]);
        
        if (useColours) {
            // Use bottom color if provided, otherwise top color
            const baseBot = count * 3;
            col[(SIDE_START + B + i) * 3 + 0] = col[baseBot + idx * 3 + 0];
            col[(SIDE_START + B + i) * 3 + 1] = col[baseBot + idx * 3 + 1];
            col[(SIDE_START + B + i) * 3 + 2] = col[baseBot + idx * 3 + 2];
        } else {
            const grey = 0.55;
            col[(SIDE_START + B + i) * 3 + 0] = grey;
            col[(SIDE_START + B + i) * 3 + 1] = grey;
            col[(SIDE_START + B + i) * 3 + 2] = grey;
        }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (useColours) {
      // Log a sample of meshColours and botColours
      console.log('[VertexColor] meshColours sample:', meshColours.slice(0, 12));
      if (botColours) console.log('[VertexColor] botColours sample:', botColours.slice(0, 12));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    } else {
      console.log('[VertexColor] _buildSolidMesh: Not using vertex colors. useColours:', useColours);
    }

    // Sanity check: avoid NaN/Inf geometry from propagating into Raycaster/Three.js computeBoundingSphere
    const posArr = geometry.getAttribute('position').array;
    let badCount = 0;
    for (let i = 0, L = posArr.length; i < L; i++) {
      if (!Number.isFinite(posArr[i])) {
        posArr[i] = 0;
        badCount += 1;
      }
    }
    if (badCount > 0) {
      console.warn(`[WARN] _buildSolidMesh corrected ${badCount} invalid position values (NaN/Inf)`);
      geometry.getAttribute('position').needsUpdate = true;
    }

    // 3. Indices
    let indices = COORD_SYSTEM.gridQuadFaceIndices(nx, nz, 0, false);
    const N = count;
    
    // Bottom faces (CW) - Corrected to point DOWN (-Z)
    indices = indices.concat(COORD_SYSTEM.gridQuadFaceIndices(nx, nz, N, true));
    // Side Walls constructed from the duplicated side-vertex pools
    for (let i = 0; i < B; i++) {
      const next = (i + 1) % B;
      const t1 = SIDE_START + i;
      const t2 = SIDE_START + next;
      const b1 = SIDE_START + B + i;
      const b2 = SIDE_START + B + next;
      // CCW from outside - Ensure these point outwards
      indices.push(t1, b1, t2, t2, b1, b2);
    }

    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mat = new THREE.MeshPhongMaterial({
      color:        useColours ? 0xffffff : 0xd4b896,
      vertexColors: useColours,
      specular:     0x111111,
      shininess:    30,
      side:         THREE.FrontSide, // Corrected: only render outside faces
      flatShading:  flatShading,
      // FIX: Add polygon offset to prevent Z-fighting with isoparameter curves and other overlays
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    console.log('[VertexColor] _buildSolidMesh: Created MeshPhongMaterial with vertexColors:', useColours);

    this._mesh = new THREE.Mesh(geometry, mat);
    this._mesh.visible = !this._curvesVisible;
    this._scene.add(this._mesh);
  }

  /**
   * Build wireframe for the solid using actual B-spline isoparameter curves.
   *
   * The bottom (offset) surface is drawn as evaluated B-spline curves — exactly
   * the same representation used for the top surface — so what you see is the
   * true B-spline geometry, not the raw control-point polygon.
   *
   * The 4 side walls are shown as evaluated edge seams with connecting pillars.
   */
  _buildSolidWireframe(offsetPts, topPos, nx, nz, THREE) {
    if (!offsetPts || !topPos || offsetPts.length < nx*nz*3 || topPos.length < nx*nz*3) {
      return;
    }
    const botColour  = 0x00ff00;
    const wallColour = 0xff00ff;

    const wireMat   = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 1.0, depthTest: false, depthWrite: false, linewidth: 2 });
    const pillarMat = new THREE.LineBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 1.0, depthTest: false, depthWrite: false, linewidth: 2 });

    const ukn = clampedKnots(nx, 3);
    const vkn = clampedKnots(nz, 3);

    // Build ctrl arrays from flat position arrays [nx*nz*3]
    const buildCtrl = (flatPts) => {
      const c = [];
      for (let i = 0; i < nx; i++) {
        c.push([]);
        for (let j = 0; j < nz; j++) {
          const idx = j * nx + i;
          c[i].push({ x: flatPts[idx * 3], y: flatPts[idx * 3 + 1], z: flatPts[idx * 3 + 2] });
        }
      }
      return c;
    };

    const topCtrl = buildCtrl(topPos);
    const botCtrl = buildCtrl(offsetPts);

    const addLine = (pts, mat) => {
      const sanitized = pts.map(p => new THREE.Vector3(
        Number.isFinite(p.x) ? p.x : 0,
        Number.isFinite(p.y) ? p.y : 0,
        Number.isFinite(p.z) ? p.z : 0
      ));
      const geo = new THREE.BufferGeometry().setFromPoints(sanitized);
      const line = new THREE.Line(geo, mat.clone());
      this._scene.add(line);
      this._solidMeshes.push(line);
    };

    const NLINES_U = Math.min(nx, 22);
    const NLINES_V = Math.min(nz, 18);
    const STEPS    = 60;

    // ── Bottom surface: B-spline isoparameter curves ─────────────────
    for (let li = 0; li <= NLINES_U; li++) {
      const u = li / NLINES_U;
      const pts = [];
      for (let s = 0; s <= STEPS; s++) pts.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, u, s / STEPS));
      addLine(pts, wireMat);
    }
    for (let li = 0; li <= NLINES_V; li++) {
      const v = li / NLINES_V;
      const pts = [];
      for (let s = 0; s <= STEPS; s++) pts.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, s / STEPS, v));
      addLine(pts, wireMat);
    }

    // ── 4 wall seams: evaluated top edge ↔ evaluated bottom edge ─────
    // Each wall is defined by holding one parameter fixed at 0 or 1 and
    // stepping along the other.  WALL_PILLARS controls how many top→bottom
    // connecting lines are drawn per wall.
    const WALL_PILLARS = 12;
    const wallEdges = [
      { fixed: 'v', t: 0 },   // front  (v=0)
      { fixed: 'v', t: 1 },   // back   (v=1)
      { fixed: 'u', t: 0 },   // left   (u=0)
      { fixed: 'u', t: 1 },   // right  (u=1)
    ];

    for (const e of wallEdges) {
      // Evaluate both edges
      const topEdge = [], botEdge = [];
      for (let s = 0; s <= WALL_PILLARS; s++) {
        const param = s / WALL_PILLARS;
        const uu = e.fixed === 'u' ? e.t : param;
        const vv = e.fixed === 'v' ? e.t : param;
        topEdge.push(evalBSplineSurface(topCtrl, nx, nz, ukn, vkn, uu, vv));
        botEdge.push(evalBSplineSurface(botCtrl, nx, nz, ukn, vkn, uu, vv));
      }

      // Top edge curve
      addLine(topEdge, pillarMat);
      // Bottom edge curve
      addLine(botEdge, pillarMat);
      // Vertical pillars connecting top → bottom
      for (let s = 0; s <= WALL_PILLARS; s++) {
        addLine([topEdge[s], botEdge[s]], pillarMat);
      }
    }
  }

  /**
   * Project 3D worst points to screen and update SVG leader lines + labels.
   * Called once per animation frame when thicken is active.
   */
  _updateLeaders() {
    const svg = this._svgOverlay;
    if (!svg) return;

    if (!this._showLeaders || !this._worstPts?.length) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      return;
    }

    const THREE    = this._THREE;
    const canvas   = this._canvas;
    const cw       = canvas.clientWidth  || 600;
    const ch       = canvas.clientHeight || 400;
    const camera   = this._camera;

    const toScreen = (wx, wy, wz) => {
      const v = new THREE.Vector3(wx, wy, wz);
      v.project(camera);
      return {
        x: (v.x *  0.5 + 0.5) * cw,
        y: (v.y * -0.5 + 0.5) * ch,
        behind: v.z > 1,
      };
    };

    // Management of SVG elements to avoid clearing every frame (slow)
    // We expect a small number of worst points (max 10-20), so we reuse nodes.
    const nodes = Array.from(svg.children);
    const nodesPerPoint = 4; // circle, line, rect, text
    const totalPoints = this._worstPts.length;

    // Remove excess nodes
    while (svg.children.length > totalPoints * nodesPerPoint) {
        svg.removeChild(svg.lastChild);
    }

    for (let i = 0; i < totalPoints; i++) {
      const pt = this._worstPts[i];
      const sc = toScreen(pt.x, pt.y, pt.z);
      
      const startIdx = i * nodesPerPoint;
      
      // Ensure we have enough elements for this point
      if (svg.children.length <= startIdx) {
          // Dot at point
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('r', '4');
          circle.setAttribute('fill', '#ff3300');
          circle.setAttribute('stroke', '#fff');
          circle.setAttribute('stroke-width', '1');
          svg.appendChild(circle);

          // Leader line
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('stroke', '#ff9900');
          line.setAttribute('stroke-width', '1.2');
          svg.appendChild(line);

          // Label background
          const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bg.setAttribute('width', '52');
          bg.setAttribute('height', '14');
          bg.setAttribute('rx', '3');
          bg.setAttribute('fill', 'rgba(20,20,40,0.85)');
          bg.setAttribute('stroke', '#ff9900');
          bg.setAttribute('stroke-width', '0.8');
          svg.appendChild(bg);

          // Label text
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('fill', '#ffcc44');
          text.setAttribute('font-size', '10');
          text.setAttribute('font-family', 'monospace, Consolas');
          svg.appendChild(text);
      }

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
      } else {
        circle.style.display = '';
        line.style.display   = '';
        rect.style.display   = '';
        text.style.display   = '';
      }

      // Positions
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

  // ── Sculpt public API ──────────────────────────────────────────────────────

  /**
   * Enable or disable sculpt mode.
   * config: null to disable, or:
   * { layer, widthIn, heightIn, nx, nz, radiusIn, symmetry,
   *   getDelta(ci,cj), onDelta(layer,ci,cj,dZ), heights }
   */
  setSculptMode(config) {
    this._sculpt = config;
    // Clear visuals but do NOT wipe _sculptDrag — an active stroke must
    // survive the mesh rebuild that fires after every onStroke tick.
    this._clearSculptOverlays();
    this._hideSculptValBox();
    if (!config) {
      // Fully disable: also clear drag/selection state and hide sight
      this._sculptSelected = null;
      this._sculptDrag     = null;
      if (this._sculptSight) this._sculptSight.style.display = 'none';
    }
    this._canvas.style.cursor = config ? 'crosshair' : '';
  }

  // ── Sculpt internals ────────────────────────────────────────────────────────

  /** NDC from mouse event */
  _mouseNDC(e) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x:  ((e.clientX - rect.left) / rect.width)  * 2 - 1,
      y: -((e.clientY - rect.top)  / rect.height) * 2 + 1,
    };
  }

  /**
   * Map NDC mouse coords → nearest grid control point.
   *
   * Uses plane intersection instead of mesh raycasting: the camera ray is
   * intersected against a horizontal plane at the last known hit height
   * (updated on every successful hit so it tracks the terrain surface).
   * This is O(1) vs O(triangles) and removes all per-frame geometry traversal.
   *
   * wz is read directly from s.heights so 3-D overlays stay correctly
   * positioned regardless of the plane's approximate Z.
   */
  _sculptRaycast(nx, ny) {
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

    // True surface height from stored heights array; also keeps the plane current.
    const wz = s.heights ? s.heights[cj * s.nx + ci] : planeZ;
    this._lastHitZ = wz;

    return { hit: true, ci, cj, wx: target.x, wy: target.y, wz };
  }

  /** Compute all CP positions that participate (primary + mirrors). */
  _sculptPositions(ci, cj) {
    const s   = this._sculpt;
    const sym = s?.symmetry ?? 'none';
    const nx  = s?.nx ?? 1, nz = s?.nz ?? 1;
    const mi  = nx - 1 - ci, mj = nz - 1 - cj;
    const pos = [{ ci, cj, mirror: false }];
    if ((sym === 'x'      || sym === 'radial') && mi !== ci             ) pos.push({ ci: mi, cj,    mirror: true });
    if ((sym === 'y'      || sym === 'radial') && mj !== cj             ) pos.push({ ci,     cj: mj, mirror: true });
    if ( sym === 'radial'                      && mi !== ci && mj !== cj) pos.push({ ci: mi, cj: mj, mirror: true });
    return pos;
  }

  /** Build/refresh the ring + dot + crosshair overlays for a hovered/selected CP. */
  _buildSculptOverlay(ci, cj, wz, selected) {
    const s = this._sculpt;
    if (!s) return;
    const THREE = this._THREE;
    const dx = s.widthIn  / (s.nx - 1);
    const dy = s.heightIn / (s.nz - 1);
    const r  = s.radiusIn;

    this._clearSculptOverlays();

    const positions = this._sculptPositions(ci, cj);

    // ── Falloff rings ────────────────────────────────────────────────────
    const ringGroup = new THREE.Group();
    for (const p of positions) {
      const cx  = -s.widthIn  / 2 + p.ci * dx;
      const cy  = -s.heightIn / 2 + p.cj * dy;
      const col = p.mirror ? 0xff8844 : (selected ? 0xffffff : 0xffee44);
      const op  = selected ? 1.0 : 0.65;
      
      const idx = p.cj * s.nx + p.ci;
      const hz  = s.heights ? s.heights[idx] : wz; // Use actual height at this point
      
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        pts.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), hz + 0.012));
      }
      ringGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op })
      ));
    }
    this._falloffRing = ringGroup;
    this._scene.add(ringGroup);

    // ── Crosshair lines at each position ────────────────────────────────
    const crossGroup = new THREE.Group();
    const armLen = r * 1.4;
    for (const p of positions) {
      const cx  = -s.widthIn  / 2 + p.ci * dx;
      const cy  = -s.heightIn / 2 + p.cj * dy;
      const col = p.mirror ? 0xff6622 : 0xff2222;
      const op  = selected ? 0.9 : 0.4;
      const mat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op });
      
      const idx = p.cj * s.nx + p.ci;
      const hz  = s.heights ? s.heights[idx] : wz;

      // Horizontal arm
      const hPts = [
        new THREE.Vector3(cx - armLen, cy, hz + 0.012),
        new THREE.Vector3(cx + armLen, cy, hz + 0.012),
      ];
      // Vertical arm
      const vPts = [
        new THREE.Vector3(cx, cy - armLen, hz + 0.012),
        new THREE.Vector3(cx, cy + armLen, hz + 0.012),
      ];
      crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hPts), mat.clone()));
      crossGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vPts), mat.clone()));
    }
    this._sculptCrossGroup = crossGroup;
    this._scene.add(crossGroup);

    // ── Single dot at each active control point ──────────────────────────
    const dotGroup  = new THREE.Group();
    const dotRadius = Math.min(dx, dy) * 0.28;
    const sphereGeo = new THREE.SphereGeometry(dotRadius, 7, 7);

    for (const p of positions) {
      const idx = p.cj * s.nx + p.ci;
      const hz  = s.heights ? s.heights[idx] : wz;
      const ptx = -s.widthIn  / 2 + p.ci * dx;
      const pty = -s.heightIn / 2 + p.cj * dy;
      const col = p.mirror ? 0xff7733 : (selected ? 0xffffff : 0xffee44);
      const mat = new THREE.MeshBasicMaterial({
        color: col, transparent: true,
        opacity: selected ? 0.95 : 0.65,
      });
      const sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.set(ptx, pty, hz + 0.015);
      dotGroup.add(sphere);
    }
    this._sculptDotGroup = dotGroup;
    this._scene.add(dotGroup);
  }

  /** Remove all sculpt overlay objects from the scene. */
  _clearSculptOverlays() {
    const disposeGroup = (g) => {
      if (!g) return;
      this._scene.remove(g);
      g.children?.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
    };
    disposeGroup(this._falloffRing);     this._falloffRing     = null;
    disposeGroup(this._sculptCrossGroup); this._sculptCrossGroup = null;
    disposeGroup(this._sculptDotGroup);  this._sculptDotGroup  = null;
  }

  /** Clear selection state and hide all sculpt visuals. */
  _clearSculptSelection() {
    this._sculptSelected = null;
    this._sculptDrag     = null;
    this._clearSculptOverlays();
    this._hideSculptValBox();
  }

  // ── Value overlay ────────────────────────────────────────────────────────────

  /** Create the floating value-input div (once) and attach to previewArea. */
  _ensureSculptValBox() {
    if (this._sculptValBox) return;
    const parent = this._canvas.parentElement || document.body;
    const box = document.createElement('div');
    box.id = 'sculptValBox';
    Object.assign(box.style, {
      position: 'absolute', display: 'none', zIndex: '20',
      background: 'rgba(255,255,255,0.95)', border: '1px solid #ccc',
      borderRadius: '6px', padding: '5px 8px',
      display: 'none', alignItems: 'center', gap: '4px',
      pointerEvents: 'all', userSelect: 'none',
      fontSize: '13px', color: '#222', fontFamily: 'monospace, Consolas',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    });

    // Step buttons + input
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

    // Up/down buttons
    box.querySelector('#svbDown').addEventListener('mousedown', e => {
      e.stopPropagation();
      this._emitSculptDelta(-STEP);
    });
    box.querySelector('#svbUp').addEventListener('mousedown', e => {
      e.stopPropagation();
      this._emitSculptDelta(+STEP);
    });

    // Direct input: commit on Enter or blur
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { this._emitSculptAbsolute(parseFloat(inp.value) || 0); e.preventDefault(); }
      if (e.key === 'Escape') { inp.blur(); }
      e.stopPropagation();
    });
    inp.addEventListener('mousedown', e => e.stopPropagation());
    inp.addEventListener('wheel',     e => e.stopPropagation());
  }

  _showSculptValBox(val) {
    this._ensureSculptValBox();
    const box = this._sculptValBox;
    box.style.display = 'flex';
    const inp = box.querySelector('#svbInput');
    if (inp && document.activeElement !== inp) inp.value = val.toFixed(3);
  }

  _hideSculptValBox() {
    if (this._sculptValBox) this._sculptValBox.style.display = 'none';
  }

  /** Reposition the value box near the selected CP each frame. */
  _updateSculptValBoxPos() {
    if (!this._sculptValBox || this._sculptValBox.style.display === 'none') return;
    if (!this._sculptSelected) return;
    const { wx, wy, wz } = this._sculptSelected;
    const THREE = this._THREE;
    const v = new THREE.Vector3(wx, wy, wz).project(this._camera);
    const rect  = this._canvas.getBoundingClientRect();
    const cw    = rect.width  || 600;
    const ch    = rect.height || 400;
    const sx    = (v.x *  0.5 + 0.5) * cw + 18;
    const sy    = (v.y * -0.5 + 0.5) * ch - 16;
    Object.assign(this._sculptValBox.style, {
      left: `${Math.max(4, Math.min(cw - 160, sx))}px`,
      top:  `${Math.max(4, Math.min(ch -  50, sy))}px`,
    });
  }

  /** Emit a delta to main.js via the onDelta callback. */
  _emitSculptDelta(dZ) {
    const sel = this._sculptSelected;
    if (!sel || !this._sculpt?.onDelta) return;
    this._sculpt?.onStart?.(this._sculpt.layer);
    this._sculpt.onDelta(this._sculpt.layer, sel.ci, sel.cj, dZ);
    this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
  }

  /** Emit an absolute-set to main.js (sets center to targetVal). */
  _emitSculptAbsolute(targetVal) {
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

  _hideFalloffRing() { /* kept for compat — use _clearSculptOverlays */ this._clearSculptOverlays(); }

  _dispose() {
    if (this._mesh)   { this._scene.remove(this._mesh);   this._mesh.geometry.dispose();  this._mesh.material.dispose(); }
    if (this._curves) { this._scene.remove(this._curves);
      this._curves.children.forEach(l => l.geometry.dispose()); }
    // NOTE: sculpt overlays are intentionally NOT cleared here so that a
    // selection survives a mesh rebuild triggered by onDelta.  They are
    // cleared in setSculptMode(null) and _clearSculptSelection().
    for (const obj of this._solidMeshes) {
      this._scene.remove(obj);
      obj.geometry?.dispose();
      obj.material?.dispose();
    }
    this._solidMeshes = [];
    this._mesh = null; this._curves = null;
  }

  _resize() {
    // In complex environments like Fusion, layout might need a tick to settle
    cancelAnimationFrame(this._reszId);
    this._reszId = requestAnimationFrame(() => {
      const rect = this._canvas.getBoundingClientRect();
      const w = rect.width || this._canvas.clientWidth;
      const h = rect.height || this._canvas.clientHeight;
      if (w <= 0 || h <= 0) return;

      this._renderer.setPixelRatio(window.devicePixelRatio);
      this._renderer.setSize(w, h, false);
      this._updateCameraFrustum();
      if (this._viewCube) this._viewCube.resize();
      // FIX: Force a new frame after resize so the reconstructed WebGL buffer is rendered.
      this._needsRender = true;
    });
  }

  _updateCameraFrustum() {
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

  _initUI() {
    const parent = this._canvas.parentElement || document.body;

    // ViewCube
    this._viewCube = new ViewCube(parent, (t, p) => this.animateTo(t, p));

    // Home Button
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
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    });
    btn.onmouseenter = () => {
      btn.style.background = '#fff';
      btn.style.borderColor = '#aaa';
      btn.style.color = '#0066cc';
    };
    btn.onmouseleave = () => {
      btn.style.background = 'rgba(255, 255, 255, 0.82)';
      btn.style.borderColor = '#ccc';
      btn.style.color = '#111';
    };
    btn.onclick = () => this.goHome();
    parent.appendChild(btn);

    // SVG overlay for leader lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    Object.assign(svg.style, {
      position: 'absolute', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', overflow: 'visible', zIndex: '5',
    });
    parent.appendChild(svg);
    this._svgOverlay = svg;
  }

  _updateCamera() {
    // Smooth transition (Damping)
    const lerp = (a, b, t) => a + (b - a) * t;
    const alpha = 0.10; // Slightly slower for smoother touch
    const qDelta = this._orb.q.angleTo(this._targetOrb.q);
    const rDelta = Math.abs(this._orb.r - this._targetOrb.r);
    const tDelta = this._orb.target.distanceTo(this._targetOrb.target);

    if (qDelta > 0.0001 || rDelta > 0.0001 || tDelta > 0.0001) {
        this._orb.q.slerp(this._targetOrb.q, alpha);
        this._orb.r = lerp(this._orb.r, this._targetOrb.r, alpha);
        this._orb.target.lerp(this._targetOrb.target, alpha);

        const pos = new THREE.Vector3(0, 0, this._orb.r).applyQuaternion(this._orb.q);
        this._camera.position.addVectors(this._orb.target, pos);
        this._camera.quaternion.copy(this._orb.q);
        
        this._updateCameraFrustum();
        this._needsRender = true;
    }
  }

  _startLoop() {
    let _firstFrame = true;
    const loop = () => {
      this._animId = requestAnimationFrame(loop);
      this._updateCamera();

      if (this._needsRender) {
          if (this._viewCube) {
            this._viewCube.sync(this._camera);
            this._viewCube.render();
          }
          this._renderer.render(this._scene, this._camera);

          // Fade in the canvas only after the terrain mesh is first rendered
          if (_firstFrame && this._mesh) {
            _firstFrame = false;
            this._canvas.classList.add('ready');
          }

          // Re-project leader lines only when necessary
          if (this._worstPts?.length && this._showLeaders) {
            this._updateLeaders();
          }
          this._needsRender = false;
      }

      // Keep sculpt value box anchored to selected CP (always sync DOM position)
      if (this._sculptSelected) {
        this._updateSculptValBoxPos();
      }

    };
    loop();
  }

  _bindOrbit() {
    const el = this._canvas;
    el.oncontextmenu = e => e.preventDefault();

    el.addEventListener('mousedown', e => {
      // In sculpt mode: left-click starts sculpt stroke; right-click orbits
      if (this._sculpt && e.button === 0) {
        const ndc = this._mouseNDC(e);
        const rc = this._sculptRaycast(ndc.x, ndc.y);
        if (rc.hit) {
          this._sculpt?.onStart?.(this._sculpt.layer);
          this._sculptDrag = { ci: rc.ci, cj: rc.cj, lastY: e.clientY };
          this._buildSculptOverlay(rc.ci, rc.cj, rc.wz, true);
        }
        e.preventDefault();
        return;
      }
      this._drag = {
        x: e.clientX, y: e.clientY,
        q: this._targetOrb.q.clone(),
        target: this._targetOrb.target.clone(),
        btn: this._sculpt ? 0 : e.button,  // in sculpt mode right-click = orbit
        shift: e.shiftKey,
      };
      e.preventDefault();
    });


    // Hover — show falloff ring preview while not dragging, and update height inspector
    el.addEventListener('mousemove', e => {
      // Sight: update transform first — GPU composited, no layout, runs before any raycast work
      if (this._sculptSight && this._sculpt) {
        const rect = this._canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        this._sculptSight.style.display = 'block';
        this._sculptSight.style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`;
      }
      const ndc = this._mouseNDC(e);
      const rc = this._sculptRaycast(ndc.x, ndc.y);

      const inspector = document.getElementById('heightInspector');
      const topVal   = document.getElementById('heightTop');
      const botVal   = document.getElementById('heightBot');
      const thickVal = document.getElementById('heightThick');
      const botRow   = document.getElementById('inspectorBotRow');
      const thickRow = document.getElementById('inspectorThickRow');

      if (rc.hit) {
        if (inspector) inspector.style.display = 'block';
        if (topVal) topVal.textContent = rc.wz.toFixed(3);

        // 2. Report Bottom Surface & Thickness if Thicken is active
        const offsetPts = this._sculpt?.offsetPts || this._lastOffsetPts;
        if (offsetPts && offsetPts.length > 0) {
          const idx = (rc.cj * this._lastNx + rc.ci) * 3;
          const zBot = offsetPts[idx + 2];
          if (botRow) botRow.style.display = 'block';
          if (thickRow) thickRow.style.display = 'block';
          if (botVal) botVal.textContent = zBot.toFixed(3);
          if (thickVal) thickVal.textContent = Math.abs(rc.wz - zBot).toFixed(3);
        } else {
          if (botRow) botRow.style.display = 'none';
          if (thickRow) thickRow.style.display = 'none';
        }

        // Existing sculpt overlay logic...
        if (this._sculpt && !this._sculptDrag && !this._drag) {
          const dZ = (this._sculpt.layer === 'bot' && offsetPts)
                     ? offsetPts[(rc.cj * this._lastNx + rc.ci) * 3 + 2]
                     : rc.wz;
          this._buildSculptOverlay(rc.ci, rc.cj, dZ, false);
        }
      } else {
        if (inspector) inspector.style.display = 'none';
      }
    });

    el.addEventListener('mouseleave', () => {
      if (!this._sculptDrag) this._clearSculptOverlays();
    });

    window.addEventListener('mousemove', e => {
      // Sculpt drag — emit stroke each pixel tick
      if (this._sculptDrag) {
        const dy = e.clientY - this._sculptDrag.lastY;
        if (Math.abs(dy) >= 1) {
          this._sculpt?.onStroke?.(
            this._sculpt.layer,
            this._sculptDrag.ci, this._sculptDrag.cj,
            dy
          );
          this._sculptDrag.lastY = e.clientY;
        }
        return;
      }

      if (!this._drag) return;

      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      const THREE = this._THREE;

      const isOrbit = (this._drag.btn === 0) || (this._drag.btn === 1 && e.shiftKey);
      const isPan   = (this._drag.btn === 2) || (this._drag.btn === 1 && !e.shiftKey);

      if (isOrbit) {
        // Trackball orbit — rotate around camera local axes
        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * 0.006);
        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * 0.006);
        this._targetOrb.q.copy(this._drag.q).multiply(qX).multiply(qY);
      } else if (isPan) {
        const vRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion);
        const vUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion);
        const panspeed = this._orb.r * 0.0015;
        this._targetOrb.target.copy(this._drag.target)
          .addScaledVector(vRight, -dx * panspeed)
          .addScaledVector(vUp, dy * panspeed);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this._sculptDrag) {
        this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
        this._clearSculptOverlays();
      }
      this._sculptDrag = null;
      this._drag = null;
    });

    el.addEventListener('wheel', e => {
      e.preventDefault();
      this._targetOrb.r = Math.max(0.1, this._targetOrb.r * (1 + e.deltaY * 0.001));
    }, { passive: false });

    let lt = null, lp = null;
    el.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = this._canvas.getBoundingClientRect();
        const nx = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

        // If sculpting is active, try to hit the surface first
        if (this._sculpt) {
          const rc = this._sculptRaycast(nx, ny);
          if (rc.hit) {
            this._sculpt?.onStart?.(this._sculpt.layer);
            this._sculptDrag = { ci: rc.ci, cj: rc.cj, lastY: touch.clientY };
            this._buildSculptOverlay(rc.ci, rc.cj, rc.wz, true);
            e.preventDefault();
            return;
          }
        }
        // Store initial touch for orbit
        lt = {
            x: touch.clientX,
            y: touch.clientY,
            q: this._targetOrb.q.clone()
        };
      } else if (e.touches.length === 2) {
        const ddx = e.touches[0].clientX - e.touches[1].clientX;
        const ddy = e.touches[0].clientY - e.touches[1].clientY;
        lp = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
          dist: Math.sqrt(ddx*ddx + ddy*ddy),
          r: this._targetOrb.r,
          target: this._targetOrb.target.clone()
        };
      }
    }, { passive: false });

    el.addEventListener('touchmove', e => {
      if (this._sculptDrag && e.touches.length === 1) {
        const touch = e.touches[0];
        const dy = touch.clientY - this._sculptDrag.lastY;
        if (Math.abs(dy) >= 1) {
          this._sculpt?.onStroke?.(this._sculpt.layer, this._sculptDrag.ci, this._sculptDrag.cj, dy);
          this._sculptDrag.lastY = touch.clientY;
        }
        e.preventDefault();
        return;
      }

      if (e.touches.length === 1 && lt) {
        e.preventDefault();
        const touch = e.touches[0];
        const ddx = touch.clientX - lt.x;
        const ddy = touch.clientY - lt.y;
        const THREE = this._THREE;
        const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ddy * 0.008);
        const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ddx * 0.008);
        this._targetOrb.q.copy(lt.q).multiply(qX).multiply(qY);
      } else if (e.touches.length === 2 && lp) {
        e.preventDefault();
        const mx  = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const my  = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const ddx = e.touches[0].clientX - e.touches[1].clientX;
        const ddy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(ddx*ddx + ddy*ddy);
        const dx = mx - lp.x;
        const dy = my - lp.y;
        const THREE = this._THREE;
        const vRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._camera.quaternion);
        const vUp    = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera.quaternion);
        const panspeed = this._orb.r * 0.0015;
        this._targetOrb.target.copy(lp.target)
          .addScaledVector(vRight, -dx * panspeed)
          .addScaledVector(vUp,    dy * panspeed);
        if (lp.dist > 0) {
          this._targetOrb.r = Math.max(0.1, lp.r * (lp.dist / dist));
        }
      }
      if (this._sculptDrag && e.touches.length === 0) {
        this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
        this._sculptDrag = null;
        this._clearSculptOverlays();
      }
    }, { passive: false });

    el.addEventListener('touchend', e => {
      if (this._sculptDrag && e.touches.length === 0) {
        this._sculpt?.onStrokeEnd?.(this._sculpt.layer);
        this._sculptDrag = null;
        this._clearSculptOverlays();
      }
      lt = null; lp = null;
    });
  }
}

// ─── B-spline math logic removed (now imported from bspline-math.js) ───────────

/**
 * ViewCube — A small 3D orientation widget with clickable faces, edges, and corners.
 */
class ViewCube {
  constructor(parent, onNavigate) {
    const THREE = window.THREE;
    this._THREE = THREE;
    this._onNavigate = onNavigate;

    // Renderer
    this._canvas = document.createElement('canvas');
    Object.assign(this._canvas.style, {
      position: 'absolute', top: '10px', right: '10px',
      width: '100px', height: '100px', pointerEvents: 'auto',
      zIndex: '10' 
    });
    parent.appendChild(this._canvas);

    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas,
      antialias: true,
      alpha: true
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(100, 100);

    // Scene
    this._scene = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this._camera.position.set(0, 0, 5);
    this._camera.lookAt(0, 0, 0);

    // Lights
    const amb = new THREE.AmbientLight(0xffffff, 0.4);
    this._scene.add(amb);
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, -10, 15);
    this._scene.add(sun);

    // Group that rotates
    this._group = new THREE.Group();
    this._scene.add(this._group);

    this._faces   = [];
    this._edges   = [];
    this._corners = [];
    this._hovered = null;

    this._init();
    this._bindEvents();
  }

  resize() {
    // Keep 100x100
    this._renderer.setSize(100, 100);
  }

  dispose() {
    this._renderer.dispose();
    this._canvas.remove();
    this._faces.forEach(f => {
      f.geometry.dispose();
      f.material.dispose();
      f.userData.normalMap.dispose();
      f.userData.hoverMap.dispose();
    });
    this._edges.forEach(e => {
      e.geometry.dispose();
      e.material.dispose();
    });
    this._corners.forEach(c => {
      c.geometry.dispose();
      c.material.dispose();
    });
  }

  sync(mainCamera) {
    // Mirror the main camera rotation by copying its inverse quaternion.
    // This ensures the cube's orientation relative to its fixed camera
    // matches the model's orientation relative to the main scene camera.
    this._group.quaternion.copy(mainCamera.quaternion).invert();
  }

  render() {
    this._renderer.render(this._scene, this._camera);
  }

  _init() {
    const THREE = this._THREE;

    // 1. Body (visual only)
    const bodyGeo = new THREE.BoxGeometry(0.82, 0.82, 0.82);
    const bodyMat = new THREE.MeshPhongMaterial({
      color: 0xf5f5f5,
      transparent: true,
      opacity: 0.95,
      shininess: 30
    });
    this._group.add(new THREE.Mesh(bodyGeo, bodyMat));

    // Wireframe
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeo),
      new THREE.LineBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 })
    );
    this._group.add(wire);

    // 2. Faces
    const faceData = [
      { name: 'FRONT',  pos: [0, -0.42, 0], rot: [Math.PI/2, 0, 0],  view: { t: 0,           p: Math.PI/2 } },
      { name: 'BACK',   pos: [0, 0.42, 0], rot: [-Math.PI/2, 0, 0], view: { t: Math.PI,     p: Math.PI/2 } },
      { name: 'TOP',    pos: [0, 0, 0.42], rot: [0, 0, 0],         view: { t: 0,           p: 0.001 } },
      { name: 'BOTTOM', pos: [0, 0, -0.42], rot: [0, Math.PI, 0],    view: { t: 0,           p: Math.PI - 0.001 } },
      { name: 'RIGHT',  pos: [0.42, 0, 0], rot: [0, Math.PI/2, 0],   view: { t: Math.PI/2,   p: Math.PI/2 } },
      { name: 'LEFT',   pos: [-0.42, 0, 0], rot: [0, -Math.PI/2, 0],  view: { t: -Math.PI/2,  p: Math.PI/2 } },
    ];

    faceData.forEach(d => {
      const geo = new THREE.PlaneGeometry(0.68, 0.68);
      const mat = new THREE.MeshBasicMaterial({
        map: this._getTexture(d.name, false),
        transparent: true,
        side: THREE.FrontSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.pos);
      mesh.rotation.set(...d.rot);
      mesh.userData = { type: 'face', view: d.view, normalMap: mat.map, hoverMap: this._getTexture(d.name, true) };
      this._faces.push(mesh);
      this._group.add(mesh);
    });

    // 3. Edges (12)
    const edgeSize = 0.15;
    const edgeLen = 0.65;
    const edges = [
      // Top ring (Z = +0.41)
      { pos: [0, -0.41, 0.41], size: [edgeLen, edgeSize, edgeSize], view: { t: 0, p: Math.PI/4 } },
      { pos: [0, 0.41, 0.41],  size: [edgeLen, edgeSize, edgeSize], view: { t: Math.PI, p: Math.PI/4 } },
      { pos: [0.41, 0, 0.41],  size: [edgeSize, edgeLen, edgeSize], view: { t: Math.PI/2, p: Math.PI/4 } },
      { pos: [-0.41, 0, 0.41], size: [edgeSize, edgeLen, edgeSize], view: { t: -Math.PI/2, p: Math.PI/4 } },
      // Bottom ring (Z = -0.41)
      { pos: [0, -0.41, -0.41], size: [edgeLen, edgeSize, edgeSize], view: { t: 0, p: 3*Math.PI/4 } },
      { pos: [0, 0.41, -0.41],  size: [edgeLen, edgeSize, edgeSize], view: { t: Math.PI, p: 3*Math.PI/4 } },
      { pos: [0.41, 0, -0.41],  size: [edgeSize, edgeLen, edgeSize], view: { t: Math.PI/2, p: 3*Math.PI/4 } },
      { pos: [-0.41, 0, -0.41], size: [edgeSize, edgeLen, edgeSize], view: { t: -Math.PI/2, p: 3*Math.PI/4 } },
      // Vertical ring (mid X-Y plane)
      { pos: [0.41, -0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: Math.PI/4, p: Math.PI/2 } },
      { pos: [-0.41, -0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: -Math.PI/4, p: Math.PI/2 } },
      { pos: [0.41, 0.41, 0],  size: [edgeSize, edgeSize, edgeLen], view: { t: 3*Math.PI/4, p: Math.PI/2 } },
      { pos: [-0.41, 0.41, 0], size: [edgeSize, edgeSize, edgeLen], view: { t: -3*Math.PI/4, p: Math.PI/2 } },
    ];

    edges.forEach(e => {
      const geo = new THREE.BoxGeometry(...e.size);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...e.pos);
      mesh.userData = { type: 'edge', view: e.view };
      this._edges.push(mesh);
      this._group.add(mesh);
    });

    // 4. Corners (8)
    const cSize = 0.18;
    for (let i = 0; i < 8; i++) {
      const x = (i & 1) ? 0.41 : -0.41;
      const y = (i & 2) ? 0.41 : -0.41;
      const z = (i & 4) ? 0.41 : -0.41;
      const geo = new THREE.BoxGeometry(cSize, cSize, cSize);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4f8ef7, transparent: true, opacity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);

      const theta = Math.atan2(x, -y);
      const phi = (z > 0) ? Math.PI / 4 : 3 * Math.PI / 4;
      mesh.userData = { type: 'corner', view: { t: theta, p: phi } };
      this._corners.push(mesh);
      this._group.add(mesh);
    }
  }

  _getTexture(text, hover) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = hover ? '#0066cc' : '#ffffff';
    ctx.fillRect(0, 0, 128, 128);

    // Border
    ctx.strokeStyle = hover ? '#0066cc' : '#dddddd';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, 128, 128);

    // Text
    ctx.fillStyle = hover ? '#ffffff' : '#333333';
    ctx.font = 'bold 32px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 64);

    const tex = new this._THREE.CanvasTexture(canvas);
    tex.anisotropy = 4;
    return tex;
  }

  _bindEvents() {
    this._canvas.addEventListener('mousemove', e => {
      this._onMouseMove(e);
    });
    this._canvas.addEventListener('click', e => this._onMouseClick(e));
    this._canvas.addEventListener('mouseleave', () => {
      this._onMouseLeave();
      if (this._sculptSight) this._sculptSight.style.display = 'none';
    });
  }

  _onMouseMove(e) {
    const rect = this._canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._ndcPoint = { x, y };

    const raycaster = new this._THREE.Raycaster();
    raycaster.setFromCamera({ x, y }, this._camera);

    const hits = raycaster.intersectObjects(this._group.children, true);
    let best = null;
    if (hits.length > 0) {
      const find = (type) => hits.find(h => h.object.userData?.type === type);
      best = find('corner') || find('edge') || find('face');
    }

    if (this._hovered !== best?.object) {
      this._onMouseLeave();
      if (best) {
        this._hovered = best.object;
        this._canvas.style.cursor = 'pointer';
        const type = this._hovered.userData.type;
        if (type === 'face') {
          this._hovered.material.map = this._hovered.userData.hoverMap;
        } else {
          this._hovered.material.opacity = 0.5;
        }
      }
    }
  }

  _onMouseClick(e) {
    if (this._hovered) {
      const { t, p } = this._hovered.userData.view;
      this._onNavigate(t, p);
    }
  }

  _onMouseLeave() {
    if (this._hovered) {
      const type = this._hovered.userData.type;
      if (type === 'face') {
        this._hovered.material.map = this._hovered.userData.normalMap;
      } else {
        this._hovered.material.opacity = 0;
      }
    }
    this._hovered = null;
    this._canvas.style.cursor = this._sculpt ? 'crosshair' : 'default';
  }
}
