/**
 * three-viewer.js — Three.js renderer for tessellated STEP meshes.
 *
 * SELF-CONTAINED: no imports from sibling modules. Three.js is loaded
 * as a global (window.THREE) by the palette HTML. The actual mesh data
 * comes from outside this module — typically core/occt-bridge.js, but
 * core/stp-tessellate.js (our hand-rolled B-spline tessellator) emits
 * the same shape and works as a drop-in for files that don't need full
 * occt coverage.
 *
 * Input shape (per mesh):
 *   { name?, color?, position: Float32Array,
 *                    normal:   Float32Array,
 *                    index:    Uint32Array }
 *
 * Camera model: spherical-coordinate orbit around an auto-computed
 * target. Drag to rotate, wheel to zoom. No pan in v1.
 */

const T = (typeof window !== 'undefined') ? window.THREE : null;

// Default body colour — a soft, slightly cool light grey reads as
// "neutral CAD body" across both light and dark themes and keeps the
// accent-orange selection highlight visually unambiguous. The old
// rotating palette (orange / blue / green / …) competed with the
// selection highlight on busy scenes.
const BODY_COLOUR_DEFAULT = 0xd8dde3;
// Kept around for callers that explicitly want the old multi-body
// palette (Verify mode, etc.); see meshObjects[].baseColor.
const FALLBACK_COLOURS = [
  0xd8dde3, 0xcad2dc, 0xe3d8c8, 0xd0d4d9,
  0xdce0d8, 0xd4dde0, 0xe0d8dc, 0xd8d6d6,
];

let scene    = null;
let camera   = null;
let renderer = null;
let canvas   = null;
let resizeObs = null;
let frame    = 0;

const meshObjects = [];   // [{ mesh, name, baseColor, originalSize }]

// Orbit camera state — Fusion-style Z-up world.
//
// Convention:
//   - World Z axis points UP (matches Fusion's main canvas).
//   - X is "right" (red), Y is "depth into screen" (green), Z is up (blue).
//   - azimuth measures rotation around the Z axis. 0 = camera on +X side
//     (looking back toward -X). Increasing azimuth rotates the camera
//     counter-clockwise when viewed from above.
//   - polar measures the camera's angle from the +Z axis. 0 = camera
//     directly above the target looking down; π/2 = camera on the
//     equator (level with the target); π = directly below.
//
// Initial values approximate Fusion's "Home" iso view: looking from
// roughly (+X, -Y, +Z), i.e. front-right-top. azimuth = -π/4 puts the
// camera in the +X / -Y quadrant; polar = atan(√2) ≈ 54.7° matches the
// classical isometric viewing angle so the body's three visible faces
// foreshorten equally.
const orbit = {
  target: null,            // THREE.Vector3 — orbit centre (also the lookAt target)
  azimuth:  -Math.PI / 4,  // around Z
  polar:    Math.acos(1 / Math.sqrt(3)),  // ~54.7° from +Z
  distance: 1000,
};

const drag = { active: false, lastX: 0, lastY: 0 };

// ── Face / body selection mode ────────────────────────────────────────────────
let faceSelectCallback = null;  // fn({point, normal, meshName, boxMin, boxMax}) | null

/* ────────────────────────────────────────────────────────────────────
 * Public API
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Bootstrap the scene on the supplied <canvas>. Idempotent — calling
 * twice disposes the old scene and rebuilds.
 *
 * Adds: ambient + directional lights, an AxesHelper at the origin, the
 * orbit-camera mouse handlers, and a ResizeObserver so the renderer
 * follows the canvas size when the palette is resized or docked.
 */
export function init(canvasEl) {
  if (!T) {
    console.warn('[three-viewer] window.THREE not loaded; viewer disabled.');
    return false;
  }
  if (renderer) dispose();

  canvas = canvasEl;
  scene = new T.Scene();
  // Light theme — mirrors --canvas-bg in step-editor.css so the canvas
  // blends with the rest of the palette. Three.js needs the colour as
  // a number (0xRRGGBB), not the CSS variable.
  scene.background = new T.Color(0xe8eaed);

  const w = canvas.clientWidth  || 800;
  const h = canvas.clientHeight || 600;

  camera = new T.PerspectiveCamera(50, w / h, 0.1, 1e7);
  orbit.target = new T.Vector3(0, 0, 0);
  applyOrbit();

  renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);

  // Lighting — three-point setup that wraps the whole body without
  // dark sides. Hemisphere covers ambient fill (warm sky → cool ground
  // helps surfaces read as 3D even on flat shading); a key directional
  // tracks the camera so the bright highlight always sits where the
  // user expects; a fill directional lifts the shadow side so the
  // body doesn't go black when oriented away from key.
  const hemi = new T.HemisphereLight(0xffffff, 0xb0bcc8, 0.55);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);
  const key = new T.DirectionalLight(0xffffff, 0.85);
  key.position.set(1, 1, 1);
  scene.add(key);
  scene.add(key.target);
  const fill = new T.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-1, 0.5, -1);
  scene.add(fill);
  scene.userData._dirLight = key;        // existing tick() updates only key

  const axes = new T.AxesHelper(50);
  scene.add(axes);

  attachMouseControls();
  resizeObs = new ResizeObserver(() => onResize());
  resizeObs.observe(canvas);

  const tick = () => {
    if (!renderer) return;
    // Light follows camera direction.
    if (camera && scene.userData._dirLight) {
      const d = scene.userData._dirLight;
      d.position.copy(camera.position);
      d.target.position.copy(orbit.target);
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return true;
}

/** Expose the THREE.Scene so add-on modules (text preview, future
 *  overlays) can mount their own helpers without re-implementing the
 *  camera/light/render pipeline. */
export function getScene() {
  return scene;
}

/** Tear down the scene and unbind event listeners. */
export function dispose() {
  cancelAnimationFrame(frame); frame = 0;
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  detachMouseControls();
  for (const m of meshObjects) {
    scene && scene.remove(m.mesh);
    if (m.mesh.geometry) m.mesh.geometry.dispose();
    if (m.mesh.material) m.mesh.material.dispose();
  }
  meshObjects.length = 0;
  if (renderer) { renderer.dispose(); renderer = null; }
  scene = null;
  camera = null;
  canvas = null;
}

/**
 * Replace the current mesh set with `meshes`. Each entry is the shape
 * documented at the top of this file. Camera re-frames on the union
 * bounding box so the new content fits in view.
 *
 * @param {Array} meshes
 */
export function setMeshes(meshes) {
  if (!scene || !T) return;

  for (const m of meshObjects) {
    // Dispose the selection-outline (if any) BEFORE the parent mesh is
    // removed — otherwise the outline material leaks.
    _detachOutline(m);
    scene.remove(m.mesh);
    if (m.mesh.geometry) m.mesh.geometry.dispose();
    if (m.mesh.material) m.mesh.material.dispose();
  }
  meshObjects.length = 0;

  if (!meshes || !meshes.length) { refitCamera(null); return; }

  const totalBox = new T.Box3();

  for (let i = 0; i < meshes.length; i++) {
    const src = meshes[i];
    if (!src.position || !src.index) continue;

    const geom = new T.BufferGeometry();
    geom.setAttribute('position', new T.BufferAttribute(src.position, 3));
    if (src.normal && src.normal.length === src.position.length) {
      geom.setAttribute('normal', new T.BufferAttribute(src.normal, 3));
    }
    geom.setIndex(new T.BufferAttribute(src.index, 1));
    if (!src.normal) geom.computeVertexNormals();
    geom.computeBoundingBox();

    // Default to a neutral light grey unless the mesh carries an explicit
    // colour from the loader. The accent-orange now reads as "selected"
    // exclusively (see highlightByName) so the scene isn't a rainbow.
    const baseColor = src.color
      ? new T.Color(src.color[0], src.color[1], src.color[2])
      : new T.Color(BODY_COLOUR_DEFAULT);

    const mat = new T.MeshPhongMaterial({
      color: baseColor,
      specular: 0x202225,     // subtle dark spec so highlights read on light grey
      shininess: 40,
      flatShading: false,
      side: T.DoubleSide,     // BREP faces aren't always wound consistently
    });

    const mesh = new T.Mesh(geom, mat);
    mesh.userData.name = src.name || `mesh_${i}`;
    scene.add(mesh);
    meshObjects.push({ mesh, name: mesh.userData.name, baseColor: baseColor.clone() });

    if (geom.boundingBox) totalBox.union(geom.boundingBox);
  }

  refitCamera(totalBox.isEmpty() ? null : totalBox);
}

/**
 * Enter surface-selection mode. While active, clicking the viewport calls
 * `cb` with { point, normal, meshName, boxMin, boxMax } (all in Three.js
 * world coordinates, mm) instead of starting an orbit drag.
 * @param {function} cb
 */
export function enableFaceSelectMode(cb) {
  faceSelectCallback = cb;
  if (canvas) canvas.style.cursor = 'crosshair';
}

/** Leave surface-selection mode and restore normal orbit controls. */
export function disableFaceSelectMode() {
  faceSelectCallback = null;
  if (canvas) canvas.style.cursor = '';
}

/**
 * Visually emphasise a mesh by name. Pass `null` to clear emphasis.
 *
 * Selected: full opacity + a back-face outline mesh (scaled 1.04× with
 * BackSide material so the silhouette shows through neighbours).
 * Non-selected: dimmed and translucent so the selected one pops.
 *
 * The outline approach is intentionally low-tech (no post-process pass,
 * no EffectComposer) so it works in the Fusion palette webview without
 * fancy WebGL extensions. Costs one extra draw call per selected mesh.
 *
 * @param {string|null} name
 */
export function highlightByName(name) {
  // Tolerant name resolution: the upstream "name" can come from the STEP
  // parser (MANIFOLD_SOLID_BREP labels) while mesh names come from Fusion
  // body names or OCCT PRODUCT labels — they overlap often but not always.
  // If the supplied name matches no mesh, fall back to:
  //   - the single mesh (when there's only one), OR
  //   - the first mesh (assumed selected) when state has a non-null pick.
  // Otherwise unselect everything (true "no selection" case = name===null).
  let resolved = name;
  if (name) {
    const hit = meshObjects.find(m => m.name === name);
    if (!hit) {
      if (meshObjects.length === 1) {
        resolved = meshObjects[0].name;
      } else if (meshObjects.length > 1) {
        // Multi-body but name unresolvable — prefer the first mesh over
        // dimming everything (avoids the "whole scene goes gray after a
        // live-preview retessellate" UX bug).
        resolved = meshObjects[0].name;
      }
    }
  }
  for (const m of meshObjects) {
    const sel = resolved && m.name === resolved;
    if (sel) {
      m.mesh.material.color.copy(m.baseColor);
      m.mesh.material.opacity = 1.0;
      m.mesh.material.transparent = false;
      _attachOutline(m);
    } else {
      m.mesh.material.color.copy(m.baseColor).multiplyScalar(0.35);
      m.mesh.material.opacity = resolved ? 0.45 : 1.0;
      m.mesh.material.transparent = !!resolved;
      _detachOutline(m);
    }
    m.mesh.material.needsUpdate = true;
  }
}

/**
 * Visually preview a hover-target by name — used for pre-selection
 * feedback when the user is mousing over the body list. Lighter touch
 * than highlightByName: no outline, just a small emissive boost on
 * the hovered mesh, with a one-frame fade-out when name flips to null.
 *
 * @param {string|null} name
 */
export function previewByName(name) {
  for (const m of meshObjects) {
    if (!m.mesh.material) continue;
    const isHover = name && m.name === name;
    // emissive is not always set on MeshPhongMaterial — guard so we
    // don't break on Basic materials.
    if (!m.mesh.material.emissive) continue;
    if (isHover) {
      m.mesh.material.emissive.copy(m.baseColor).multiplyScalar(0.35);
    } else {
      m.mesh.material.emissive.setRGB(0, 0, 0);
    }
    m.mesh.material.needsUpdate = true;
  }
}

/* Selection-outline implementation — a duplicate of the selected mesh's
 * geometry, scaled slightly larger and rendered with BackSide culling so
 * it forms a thin silhouette around the original. Painted in the accent
 * colour at full opacity so it reads clearly against the dimmed siblings. */
const OUTLINE_COLOR = 0xf59e0b;   // matches --accent in step-editor.css
const OUTLINE_SCALE = 1.04;

function _attachOutline(record) {
  if (record._outline || !record.mesh.geometry) return;
  const outlineMat = new T.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: T.BackSide,
  });
  const outline = new T.Mesh(record.mesh.geometry, outlineMat);
  outline.scale.setScalar(OUTLINE_SCALE);
  outline.renderOrder = -1;                  // drawn first so the body covers it from the front
  record.mesh.add(outline);
  record._outline = outline;
}

function _detachOutline(record) {
  if (!record._outline) return;
  record.mesh.remove(record._outline);
  if (record._outline.material) record._outline.material.dispose();
  record._outline = null;
}

/* ────────────────────────────────────────────────────────────────────
 * Private — camera & input
 * ──────────────────────────────────────────────────────────────────── */

function applyOrbit() {
  if (!camera || !orbit.target) return;
  // Z-up spherical: x = r·sinφ·cosθ, y = r·sinφ·sinθ, z = r·cosφ
  //   φ = polar (from +Z), θ = azimuth (around Z).
  // This matches Fusion's main-canvas world orientation so a STEP
  // file's geometry sits the same way in both viewports without an
  // extra coord swap on the mesh data.
  const r = orbit.distance;
  const sp = Math.sin(orbit.polar), cp = Math.cos(orbit.polar);
  const sa = Math.sin(orbit.azimuth), ca = Math.cos(orbit.azimuth);
  camera.position.set(
    orbit.target.x + r * sp * ca,
    orbit.target.y + r * sp * sa,
    orbit.target.z + r * cp,
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(orbit.target);
}

function refitCamera(bbox) {
  if (!camera) return;
  if (!bbox) {
    orbit.target.set(0, 0, 0);
    orbit.distance = 100;
    applyOrbit();
    return;
  }
  const centre = bbox.getCenter(new T.Vector3());
  const size   = Math.max(bbox.getSize(new T.Vector3()).length(), 1);
  orbit.target.copy(centre);
  // 2.0× the bbox diagonal keeps the camera comfortably outside the body
  // even after a Scale-uniform=5×+ scrub. 1.5× occasionally landed the
  // camera inside large meshes — the orbit angles + new distance pair
  // can cross the body surface when the user has manually tilted close.
  orbit.distance = size * 2.0;
  camera.near = Math.max(orbit.distance / 1000, 0.1);
  camera.far  = orbit.distance * 100;
  camera.updateProjectionMatrix();
  applyOrbit();
}

function onResize() {
  if (!renderer || !camera || !canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

const onDown = (e) => {
  if (e.button !== 0) return;
  // In face-select mode, raycast instead of orbiting.
  if (faceSelectCallback) {
    doFaceRaycast(e);
    return;
  }
  drag.active = true;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
};
const onMove = (e) => {
  if (!drag.active) return;
  const dx = e.clientX - drag.lastX;
  const dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;
  // Z-up convention: polar=0 puts the camera above the target. Mouse-
  // down therefore needs to DECREASE polar (rotate toward +Z, tilt the
  // view to look down more). The Y-up version of this code added dy;
  // we flip the sign here so the orbit feels natural in the new frame.
  orbit.azimuth -= dx * 0.005;
  orbit.polar    = Math.max(0.01, Math.min(Math.PI - 0.01, orbit.polar - dy * 0.005));
  applyOrbit();
};
const onUp = () => { drag.active = false; };
const onWheel = (e) => {
  e.preventDefault();
  const k = Math.exp(e.deltaY * 0.001);
  orbit.distance = Math.max(0.1, orbit.distance * k);
  if (camera) {
    camera.near = Math.max(orbit.distance / 1000, 0.1);
    camera.far  = orbit.distance * 100;
    camera.updateProjectionMatrix();
  }
  applyOrbit();
};

/**
 * Raycast a mouse event into the scene. If a mesh is hit, calls
 * faceSelectCallback with the hit info and highlights the mesh.
 * Returns the hit result object or null.
 */
function doFaceRaycast(e) {
  if (!T || !camera || !canvas || meshObjects.length === 0) return null;

  const rect = canvas.getBoundingClientRect();
  const ndcX =  ((e.clientX - rect.left)  / rect.width)  * 2 - 1;
  const ndcY = -((e.clientY - rect.top)   / rect.height) * 2 + 1;

  const raycaster = new T.Raycaster();
  raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);

  const allMeshes = meshObjects.map(m => m.mesh);
  const hits = raycaster.intersectObjects(allMeshes, false);

  if (!hits.length) return null;

  const hit  = hits[0];
  const mesh = hit.object;
  const mo   = meshObjects.find(m => m.mesh === mesh);

  // World-space hit point
  const point = { x: hit.point.x, y: hit.point.y, z: hit.point.z };

  // Face normal → world space
  let normal = { x: 0, y: 1, z: 0 };
  if (hit.face) {
    const n = hit.face.normal.clone()
      .transformDirection(mesh.matrixWorld)
      .normalize();
    normal = { x: n.x, y: n.y, z: n.z };
  }

  // Bounding box of the mesh in world space
  const bbox = new T.Box3().setFromObject(mesh);
  const boxMin = { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z };
  const boxMax = { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z };

  const meshName = mo ? mo.name : (mesh.userData.name || '');

  // Highlight selected body
  highlightByName(meshName);

  const result = { point, normal, meshName, boxMin, boxMax };
  if (faceSelectCallback) faceSelectCallback(result);
  return result;
}

function attachMouseControls() {
  if (!canvas) return;
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup',   onUp);
  canvas.addEventListener('wheel',     onWheel, { passive: false });
}

function detachMouseControls() {
  if (canvas) {
    canvas.removeEventListener('mousedown', onDown);
    canvas.removeEventListener('wheel',     onWheel);
  }
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup',   onUp);
}
