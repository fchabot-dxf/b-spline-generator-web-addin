/**
 * main/stl-preview-3d.js -- SMITHSONIAN-BROWSER (design section 7, answer 4): the library sheet's "Turn in 3D" view. A small
 * THREE r128 view of a triangle soup (core/stl/gltf.js soupFromGltfScene: in the board's frame, the model face up) on its own
 * canvas, with a plain material and a light. It opens as the model's PICTURE shows it: a FRONT view, the camera on +Z looking
 * down -Z with up = +Y (glTF's front and up), framed on the soup's bounds. Drag to turn: sideways turns the model about Z, up /
 * down tilts it. No OrbitControls (it is not loaded in this app) and no animation loop: it draws once, then on each drag move.
 * `dispose()` frees everything it made (renderer + its WebGL context, geometry, material, the canvas, its listeners).
 */

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
  return { c, r };
}

/** Draw `soup` into `container` (a canvas is appended). Returns { canvas, dispose }. */
export function createSoupView(container, soup, { sizePx = 300 } = {}) {
  const T = globalThis.THREE;
  const { c, r } = bounds(soup);
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
  const draw = () => renderer.render(scene, camera);

  // drag to turn: about Z (sideways) and tilt (up / down)
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture?.(e.pointerId); } catch (_) { /* not capturable */ } };
  const onMove = (e) => {
    if (!drag) return;
    model.rotation.z += (e.clientX - drag.x) * 0.01;
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
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [t, f] of LISTENERS) canvas.removeEventListener(t, f);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.(); // the WebGL context goes now, not at garbage collection
      canvas.remove();
    },
  };
}
