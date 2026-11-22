/**
 * stl/raster.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): the placed STL seen from ABOVE, as a height grid on the board's own (nx, nz) grid.
 * A CPU z-buffer: pure array math (no canvas, no GPU), so it is deterministic on every device and unit-tested on real meshes.
 * Both sides of every triangle count (an inside-out or open mesh renders the same); undercuts are lost -- the top-most surface wins.
 *
 * Frame (the SCENE's own, core/preview/terrain-mesh.js: x right, y UP the screen in the top view, origin at the board centre): the
 * mesh is centred on its own bounding box, scaled (uniform unitIn * scale, height * zScale), rotated (X, then Y, then Z, degrees),
 * then moved by position.x / position.y. Its LOWEST point is height 0 (the base rests on the surface); position.z (the Z offset)
 * is applied by the stamp pass, not here. So an STL seen from above lands on the board the way it looks in the 3D view.
 *
 * Grid: heights[j*nx+i], column i at x = -W/2 + i*dx, row j at y = +H/2 - j*dy (row 0 is the TOP of the screen).
 */
import { meshBounds } from './mesh.js';

const RAD = Math.PI / 180;

/** Row-major 3x3 rotation, X then Y then Z (degrees). */
export function rotationMatrix(rx = 0, ry = 0, rz = 0) {
  const [cx, sx] = [Math.cos(rx * RAD), Math.sin(rx * RAD)];
  const [cy, sy] = [Math.cos(ry * RAD), Math.sin(ry * RAD)];
  const [cz, sz] = [Math.cos(rz * RAD), Math.sin(rz * RAD)];
  // R = Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** The mesh's vertices placed in scene inches (Float64Array xyz, origin at the board centre), base at z = 0. */
export function placeMesh(mesh, layer) {
  const { positions } = mesh;
  const { min, max } = meshBounds(positions);
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const s = (layer.unitIn ?? 1) * (layer.scale ?? 1);
  const sz = s * (layer.zScale ?? 1);
  const R = rotationMatrix(layer.rotation?.x, layer.rotation?.y, layer.rotation?.z);
  const ox = layer.position?.x || 0;
  const oy = layer.position?.y || 0;
  const out = new Float64Array(positions.length);
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = (positions[i] - c[0]) * s, y = (positions[i + 1] - c[1]) * s, z = (positions[i + 2] - c[2]) * sz;
    const X = R[0] * x + R[1] * y + R[2] * z + ox;
    const Y = R[3] * x + R[4] * y + R[5] * z + oy;
    const Z = R[6] * x + R[7] * y + R[8] * z;
    out[i] = X; out[i + 1] = Y; out[i + 2] = Z;
    if (Z < minZ) minZ = Z;
    if (Z > maxZ) maxZ = Z;
  }
  for (let i = 2; i < out.length; i += 3) out[i] -= minZ;
  return { xyz: out, hMax: Number.isFinite(maxZ - minZ) ? maxZ - minZ : 0 };
}

/**
 * @returns {{ height: Float32Array, covered: Uint8Array, hMax: number }} height in inches above the mesh's lowest point
 *  (0 where the mesh does not cover the grid point; `covered` says which points it does).
 */
export function renderDepth(mesh, layer, grid) {
  const { nx, nz, widthIn, heightIn } = grid;
  const { xyz, hMax } = placeMesh(mesh, layer);
  const height = new Float32Array(nx * nz);
  const covered = new Uint8Array(nx * nz);
  const dx = widthIn / (nx - 1), dy = heightIn / (nz - 1);
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = (xyz[a] + widthIn / 2) / dx, ay = (heightIn / 2 - xyz[a + 1]) / dy, az = xyz[a + 2];
    const bx = (xyz[b] + widthIn / 2) / dx, by = (heightIn / 2 - xyz[b + 1]) / dy, bz = xyz[b + 2];
    const cx = (xyz[c] + widthIn / 2) / dx, cy = (heightIn / 2 - xyz[c + 1]) / dy, cz = xyz[c + 2];
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue; // edge-on from above: it covers no area
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-9)), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) + 1e-9));
    const j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 1e-9)), j1 = Math.min(nz - 1, Math.floor(Math.max(ay, by, cy) + 1e-9));
    const inv = 1 / area;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w0 = ((bx - i) * (cy - j) - (by - j) * (cx - i)) * inv;
        const w1 = ((cx - i) * (ay - j) - (cy - j) * (ax - i)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        const z = w0 * az + w1 * bz + w2 * cz;
        const k = j * nx + i;
        if (!covered[k] || z > height[k]) { height[k] = z; covered[k] = 1; }
      }
    }
  }
  return { height, covered, hMax };
}
