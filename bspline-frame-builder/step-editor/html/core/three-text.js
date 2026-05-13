/**
 * three-text.js — render typed text as filled 2D polygons in the
 * Three.js viewer's scene.  Used by the Text tool's preview path.
 *
 * SELF-CONTAINED: uses window.THREE as a global (loaded by the HTML)
 * and accepts glyph data as plain JS objects.  No imports.
 *
 * Approach for the preview:
 *   - Each glyph's contour list is fed into THREE.ShapeUtils.triangulateShape
 *     which handles outer + inner holes via even-odd winding.
 *   - Triangles are accumulated into a single BufferGeometry per call.
 *   - Material is a plain MeshBasicMaterial in the accent colour;
 *     no lighting — text sits on the XY plane and reads like a flat
 *     sticker on the floor of the scene.
 *
 * Public API:
 *   setText(layout, depth)  — replace any prior preview with new geometry
 *   clear()                 — remove any text preview from the scene
 *   getGroup()              — for callers that want to attach helpers
 */

const T = (typeof window !== 'undefined') ? window.THREE : null;
const ACCENT = 0xf59e0b;

let scene = null;
let group = null;

/** One-time hookup: tell this module which Three.js scene to draw into.
 *  Called from three-viewer.js right after the renderer is built. */
export function attachToScene(s) {
  if (!T || !s) return;
  if (scene === s) return;
  // Tear down any previous group if we're being re-attached.
  if (group && scene) scene.remove(group);
  scene = s;
  group = new T.Group();
  group.name = 'TextPreview';
  scene.add(group);
}

/** Drop any text mesh currently in the scene. Idempotent. */
export function clear() {
  if (!group) return;
  while (group.children.length) {
    const c = group.children[0];
    group.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) c.material.dispose();
  }
}

/** The text-preview group, for callers that need to reposition the
 *  whole text block (e.g. centre on a selected body). */
export function getGroup() {
  return group;
}

/**
 * Replace any prior preview with a flat-extruded mesh built from the
 * given layout.  `depth` controls extrusion: positive embosses upward,
 * negative engraves downward (visualisation only in milestone A — the
 * actual STEP body emission happens in milestone B).
 *
 * @param {{glyphs:Array, bbox:{min:[number,number], max:[number,number]}}} layout
 *        output of `layoutText()` from core/text-glyphs.js
 * @param {number} [depth=0]   0 = flat preview; ±n = extruded prism (milestone B)
 */
export function setText(layout, depth = 0) {
  if (!T || !group || !layout) return;
  clear();

  // Centre the text block on the world origin so it sits where the
  // user can find it. Could later snap to a selected body's bbox.
  const cx = (layout.bbox.min[0] + layout.bbox.max[0]) * 0.5;
  const cy = (layout.bbox.min[1] + layout.bbox.max[1]) * 0.5;

  const positions = [];
  const indices = [];

  for (const g of layout.glyphs) {
    if (!g.contours || !g.contours.length) continue;

    // Build a THREE.Shape from the glyph's first contour and use the
    // rest as holes. opentype emits glyph contours so that outer
    // outlines are CCW and holes are CW (or vice versa for some fonts);
    // we don't rely on the winding — ShapeUtils handles it for us.
    const shapes = buildShapes(g.contours, cx, cy);
    for (const shape of shapes) {
      const baseIndex = positions.length / 3;
      const verts = shape.getPoints(8);  // refine arcs/curves; our contours are already polylines
      const triangles = T.ShapeUtils.triangulateShape(verts, shape.holes.map(h => h.getPoints(8)));

      // Push outer + hole vertices into one array.
      const flat = verts.slice();
      for (const h of shape.holes) flat.push(...h.getPoints(8));
      for (const p of flat) positions.push(p.x, p.y, 0);

      for (const tri of triangles) {
        indices.push(tri[0] + baseIndex, tri[1] + baseIndex, tri[2] + baseIndex);
      }
    }
  }

  if (!positions.length) return;

  const geom = new T.BufferGeometry();
  geom.setAttribute('position', new T.BufferAttribute(new Float32Array(positions), 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  geom.computeBoundingBox();

  const mat = new T.MeshBasicMaterial({
    color: ACCENT,
    side: T.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new T.Mesh(geom, mat);
  group.add(mesh);

  // TODO milestone B: actually extrude. For now, depth just notes
  // direction so the user can see they typed a value (and we'll honour
  // it when we emit STEP geometry).
  if (Math.abs(depth) > 0) {
    const outlineMat = new T.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.5 });
    // Draw a wireframe outline of where the prism's top face would land.
    const outline = new T.Group();
    for (const g of layout.glyphs) {
      for (const contour of g.contours) {
        const pts = contour.map(p => new T.Vector3(p.x - cx, p.y - cy, depth));
        if (pts.length > 1 && (pts[0].x !== pts[pts.length-1].x || pts[0].y !== pts[pts.length-1].y)) {
          pts.push(pts[0].clone());
        }
        const og = new T.BufferGeometry().setFromPoints(pts);
        outline.add(new T.Line(og, outlineMat));
      }
    }
    group.add(outline);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Private — contour list → THREE.Shape with holes
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Group contours into shapes by winding order.  In opentype.js / TTF
 * convention, the outermost contour is the outline and any enclosed
 * contours of opposite winding are holes (think of the letter 'O').
 * We use the signed area of each contour to detect winding and the
 * bounding-box containment test to pair holes with their outers.
 */
function buildShapes(contours, cx, cy) {
  const tagged = contours.map(c => ({
    points: c,
    area: signedArea(c),
    bbox: contourBbox(c),
  }));

  // Outers = positive area, holes = negative area (or vice versa).
  // We treat the *majority winding* as outer to be robust to fonts
  // that flip the convention.
  let posCount = 0, negCount = 0;
  for (const t of tagged) (t.area > 0 ? posCount++ : negCount++);
  const outerIsPositive = posCount >= negCount;

  const outers = tagged.filter(t => (t.area > 0) === outerIsPositive);
  const holes  = tagged.filter(t => (t.area > 0) !== outerIsPositive);

  const shapes = [];
  for (const o of outers) {
    const shape = new window.THREE.Shape(
      o.points.map(p => new window.THREE.Vector2(p.x - cx, p.y - cy))
    );
    // Match each hole to its enclosing outer by bbox containment.
    for (const h of holes) {
      if (bboxContains(o.bbox, h.bbox)) {
        const path = new window.THREE.Path(
          h.points.map(p => new window.THREE.Vector2(p.x - cx, p.y - cy))
        );
        shape.holes.push(path);
      }
    }
    shapes.push(shape);
  }
  return shapes;
}

function signedArea(points) {
  let s = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    s += (b.x - a.x) * (b.y + a.y);
  }
  return s * 0.5;
}

function contourBbox(points) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const p of points) {
    if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
    if (p.y < mny) mny = p.y; if (p.y > mxy) mxy = p.y;
  }
  return { mnx, mny, mxx, mxy };
}

function bboxContains(outer, inner) {
  return outer.mnx <= inner.mnx && outer.mxx >= inner.mxx
      && outer.mny <= inner.mny && outer.mxy >= inner.mxy;
}
