/**
 * main/stl-preview-3d.js -- SMITHSONIAN-BROWSER (design section 7, answer 4): the library sheet's "Turn in 3D" view. A small
 * THREE r128 view of a triangle soup (core/stl/gltf.js soupFromGltfScene: in the board's frame, the model face up) on its own
 * canvas, with a plain material and a light. It opens as the model's PICTURE shows it: a FRONT view, the camera on +Z looking
 * down -Z with up = +Y (glTF's front and up), framed on the soup's bounds. Drag to turn: sideways turns the model about Z, up /
 * down tilts it. No OrbitControls (it is not loaded in this app) and no animation loop: it draws once, then on each drag move.
 * `dispose()` frees everything it made (renderer + its WebGL context, geometry, material, the canvas, its listeners).
 */
import { CROP_PREVIEW_LOOK as CROP_VIEW_LOOK } from '../core/stl/crop.js';

const VIEW_FOV_DEG = 35;

/** The soup's centre and radius (for the camera), in plain JS. */
function bounds(soup) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const r = Math.max(1e-9, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2);
  return { c, r, min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** The 12 edges of box { min, max } (already in the view's centred frame) as 24 points. */
function boxEdges(b) {
  const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return Float32Array.from(E.flatMap(([a, b2]) => [...P[a], ...P[b2]]));
}

/** Draw `soup` into `container` (a canvas is appended). Returns { canvas, dispose }. */
export function createSoupView(container, soup, { sizePx = 300 } = {}) {
  const T = globalThis.THREE;
  const { c, r, min: soupMin, max: soupMax } = bounds(soup);
  const pos = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) { pos[i] = soup[i] - c[0]; pos[i + 1] = soup[i + 1] - c[1]; pos[i + 2] = soup[i + 2] - c[2]; }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(pos, 3));
  geometry.computeVertexNormals();
  const material = new T.MeshStandardMaterial({ color: 0xc8b8a0, roughness: 0.8, metalness: 0, side: T.DoubleSide });
  const mesh = new T.Mesh(geometry, material);
  const model = new T.Group();
  model.add(mesh);
  const scene = new T.Scene();
  scene.add(model);
  scene.add(new T.AmbientLight(0xffffff, 0.45));
  const sun = new T.DirectionalLight(0xffffff, 0.8);
  sun.position.set(-1, 2, 3); // from the upper left, in front
  scene.add(sun);
  const camera = new T.PerspectiveCamera(VIEW_FOV_DEG, 1, r / 100, r * 100);
  // the front view (as the model's picture): on +Z looking down -Z, +Y up; the bounding sphere just fills the view's height
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0, r / Math.sin((VIEW_FOV_DEG / 2) * (Math.PI / 180)));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  let renderer;
  try {
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  } catch (e) {
    geometry.dispose(); material.dispose();
    throw new Error('This browser cannot show 3D here (no WebGL).');
  }
  const w = Math.max(120, Math.round(container.clientWidth || sizePx));
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.setSize(w, w);
  renderer.setClearColor(0xffffff, 0);
  const canvas = renderer.domElement;
  canvas.className = 'stl-lib-view';
  canvas.style.touchAction = 'none';
  container.appendChild(canvas);

  // ── the crop overlay (STL-CROP): built on first use only. The kept part = the model clipped to the box (6 planes, any one
  // outside clips); the cut-away part = the same geometry, faint, clipped to OUTSIDE the box (all six inside clip); the box's
  // edges. The planes are kept in the model's frame and placed in the world (the drag turns the model) before each draw.
  let crop = null;
  const placeCropPlanes = () => {
    model.updateMatrixWorld(true);
    for (let k = 0; k < 6; k++) {
      crop.inW[k].copy(crop.inL[k]).applyMatrix4(model.matrixWorld);
      crop.outW[k].copy(crop.outL[k]).applyMatrix4(model.matrixWorld);
    }
  };
  /** `b` = { min: [x, y, z], max } in the SOUP's own frame (null = no crop shown). */
  function setCropBox(b) {
    if (!b) {
      if (crop) { material.clippingPlanes = []; material.needsUpdate = true; crop.faint.visible = false; crop.edges.visible = false; crop.box = null; }
      draw();
      return;
    }
    if (!crop) {
      renderer.localClippingEnabled = true;
      const planes = () => Array.from({ length: 6 }, () => new T.Plane());
      crop = { inL: planes(), outL: planes(), inW: planes(), outW: planes(), box: null };
      const fm = new T.MeshBasicMaterial({ color: CROP_VIEW_LOOK.faintColour, transparent: true, opacity: CROP_VIEW_LOOK.faintOpacity,
        depthWrite: false, side: T.DoubleSide, clippingPlanes: crop.outW, clipIntersection: true });
      crop.faint = new T.Mesh(geometry, fm);
      crop.eg = new T.BufferGeometry();
      crop.eg.setAttribute('position', new T.BufferAttribute(new Float32Array(72), 3));
      crop.edges = new T.LineSegments(crop.eg, new T.LineBasicMaterial({ color: CROP_VIEW_LOOK.edgeColour }));
      model.add(crop.faint, crop.edges);
    }
    const lo = [b.min[0] - c[0], b.min[1] - c[1], b.min[2] - c[2]], hi = [b.max[0] - c[0], b.max[1] - c[1], b.max[2] - c[2]];
    crop.box = { min: lo, max: hi };
    for (let a = 0; a < 3; a++) {
      const n = [0, 0, 0];
      n[a] = 1;
      crop.inL[2 * a].set(new T.Vector3(n[0], n[1], n[2]), -lo[a]);        // keep x >= lo
      crop.inL[2 * a + 1].set(new T.Vector3(-n[0], -n[1], -n[2]), hi[a]);  // keep x <= hi
      crop.outL[2 * a].set(new T.Vector3(-n[0], -n[1], -n[2]), lo[a]);
      crop.outL[2 * a + 1].set(new T.Vector3(n[0], n[1], n[2]), -hi[a]);
    }
    crop.eg.attributes.position.array.set(boxEdges(crop.box));
    crop.eg.attributes.position.needsUpdate = true;
    material.clippingPlanes = crop.inW;
    material.clipIntersection = false;
    material.needsUpdate = true;
    crop.faint.visible = true;
    crop.edges.visible = true;
    draw();
  }

  const draw = () => { if (crop && crop.box) placeCropPlanes(); renderer.render(scene, camera); };

  // drag to turn: about Z (sideways) and tilt (up / down)
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture?.(e.pointerId); } catch (_) { /* not capturable */ } };
  const onMove = (e) => {
    if (!drag) return;
    model.rotation.y += (e.clientX - drag.x) * 0.01; // a turntable about the model's up (+Y in this front view)
    model.rotation.x += (e.clientY - drag.y) * 0.01;
    drag = { x: e.clientX, y: e.clientY };
    draw();
  };
  const onUp = () => { drag = null; };
  const LISTENERS = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]];
  for (const [t, f] of LISTENERS) canvas.addEventListener(t, f);
  draw();

  let disposed = false;
  return {
    canvas,
    /** The soup's own bounding box ({ min, max }, its frame, before the view centres it). */
    bounds: { min: soupMin, max: soupMax },
    setCropBox,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [t, f] of LISTENERS) canvas.removeEventListener(t, f);
      if (crop) { crop.faint.material.dispose(); crop.eg.dispose(); crop.edges.material.dispose(); }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.(); // the WebGL context goes now, not at garbage collection
      canvas.remove();
    },
  };
}
