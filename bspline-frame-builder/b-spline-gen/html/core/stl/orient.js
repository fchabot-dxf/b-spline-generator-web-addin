/**
 * stl/orient.js -- STL-RELIEF (STL-RELIEF-DESIGN.md section 13, Fred 2026-11-22): 'Lay flat' and the quick turns. Pure math on a
 * record's rotation {x, y, z} (degrees), in EXACTLY core/stl/raster.js rotationMatrix's convention: R = Rz * Ry * Rx (row-major,
 * world = R * local, the mesh centred on its own box), every angle wrapped to [-180, 180) (Fred: angles wrap). These act only
 * when the user presses them; nothing here runs at insert (the Smithsonian pose stays the default).
 */
import { rotationMatrix } from './raster.js';

const DEG = 180 / Math.PI;

/** An angle in degrees wrapped to [-180, 180). */
export function wrapDeg(a) { return ((((a + 180) % 360) + 360) % 360) - 180; }

/**
 * Euler angles {x, y, z} (degrees, wrapped) of a rotation matrix in rotationMatrix's convention (R = Rz * Ry * Rx).
 * y = atan2(-R20, hypot(R00, R10)) is in [-90, 90]; then x = atan2(R21, R22), z = atan2(R10, R00).
 * Gimbal lock (cos y < 1e-9: Y = +-90, X and Z turn about the same axis) is resolved deterministically: X = 0 and the whole
 * turn goes into Z = atan2(-R01, R11) (with X = 0, R01 = -sin z and R11 = cos z for either sign of Y).
 */
export function eulerFromMatrix(R) {
  const cy = Math.hypot(R[0], R[3]);
  const y = Math.atan2(-R[6], cy);
  let x, z;
  if (cy > 1e-9) { x = Math.atan2(R[7], R[8]); z = Math.atan2(R[3], R[0]); }
  else { x = 0; z = Math.atan2(-R[1], R[4]); }
  return { x: x === 0 ? 0 : wrapDeg(x * DEG), y: wrapDeg(y * DEG), z: wrapDeg(z * DEG) + 0 };
}

const mul3 = (A, B) => Array.from({ length: 9 }, (_, k) => {
  const r = Math.floor(k / 3), c = k % 3;
  return A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
});

/** The turn of `deg` degrees about the BOARD's `axis` ('x' | 'y' | 'z'); a multiple of 90 is exact (0 / +-1, no 6e-17). */
export function axisTurnMatrix(axis, deg) {
  let c, s;
  if (deg % 90 === 0) { const q = ((deg / 90) % 4 + 4) % 4; c = [1, 0, -1, 0][q]; s = [0, 1, 0, -1][q]; }
  else { c = Math.cos(deg / DEG); s = Math.sin(deg / DEG); }
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** A quick turn: `deg` about the BOARD's `axis` (world frame): new = R(axis, deg) * rotationMatrix(rotation), as Euler angles. */
export function quickTurnRotation(rotation, axis, deg) {
  const r = rotation || {};
  return eulerFromMatrix(mul3(axisTurnMatrix(axis, deg), rotationMatrix(r.x || 0, r.y || 0, r.z || 0)));
}

/** Eigen-decomposition of a symmetric 3 x 3 (cyclic Jacobi): { values: [3], vectors: [3][3] (vectors[i] = the i-th unit vector) }. */
function symEigen3(M) {
  const a = [[M[0], M[1], M[2]], [M[3], M[4], M[5]], [M[6], M[7], M[8]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const scale = Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) || 1;
  for (let sweep = 0; sweep < 50; sweep++) {
    if (Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]) < 1e-15 * scale) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const kp = a[k][p], kq = a[k][q]; a[k][p] = c * kp - s * kq; a[k][q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = a[p][k], qk = a[q][k]; a[p][k] = c * pk - s * qk; a[q][k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = v[k][p], kq = v[k][q]; v[k][p] = c * kp - s * kq; v[k][q] = s * kp + c * kq; }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: [0, 1, 2].map((i) => [v[0][i], v[1][i], v[2][i]]) };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => [-a[0], -a[1], -a[2]];
/** The tie-break of a sign: the vector's largest-magnitude component positive. */
const byLargest = (e) => { let i = 0; for (let k = 1; k < 3; k++) if (Math.abs(e[k]) > Math.abs(e[i]) + 1e-12) i = k; return e[i] >= 0 ? e : neg(e); };

/**
 * 'Lay flat': the turn that puts the mesh's THINNEST dimension up (board +Z) and its LONGEST along +X -- the usual best relief view,
 * the shallowest stamp. `mesh` = { positions, indices } (core/stl/mesh.js decodeMesh of the stored copy).
 * The axes are the principal axes of the mesh's SURFACE: its covariance from the exact second moment of every triangle
 * (integral of x x^T over the triangle = A/12 (a a^T + b b^T + c c^T + s s^T), s = a + b + c), area-weighted -- independent of how
 * finely a region is triangulated. Smallest variance -> e3 (up), largest -> e1 (+X), e2 = e3 x e1 (so det = +1).
 * Signs, deterministic:
 *   e3: the side the surface reaches further out to points up -- the area-weighted third moment of the triangle centroids along e3
 *       is made >= 0 (a plaque's bump sticks up, its flat back down); a symmetric mesh (|moment| < 1e-7 of its magnitude) keeps
 *       the mesh's own +Z side up (e3 . Z >= 0); still tied: its largest component positive.
 *   e1: towards the mesh's own +X (e1 . X >= 0); tied: its largest component positive.
 * @returns {{ R: number[9], rotation: {x, y, z} }} R's rows are e1, e2, e3 (world = R * local); rotation = its Euler angles
 */
export function layFlatFrame(mesh) {
  const P = mesh.positions, I = mesh.indices;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[i + a]); hi[a] = Math.max(hi[a], P[i + a]); }
  const o = [0, 1, 2].map((a) => (lo[a] + hi[a]) / 2); // centred on the box (numerics: no cancellation far from the origin)
  const at = (v) => [P[v * 3] - o[0], P[v * 3 + 1] - o[1], P[v * 3 + 2] - o[2]];
  let area = 0; const m1 = [0, 0, 0], m2 = new Array(9).fill(0);
  const tris = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = at(I[t]), b = at(I[t + 1]), c = at(I[t + 2]);
    const n = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const A = Math.hypot(n[0], n[1], n[2]) / 2;
    if (!(A > 0)) continue;
    const s = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    area += A;
    for (let i = 0; i < 3; i++) {
      m1[i] += A * s[i] / 3;
      for (let j = 0; j < 3; j++) m2[i * 3 + j] += (A / 12) * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + s[i] * s[j]);
    }
    tris.push([A, s[0] / 3, s[1] / 3, s[2] / 3]);
  }
  if (!(area > 0)) return { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], rotation: { x: 0, y: 0, z: 0 } };
  const m = m1.map((x) => x / area);
  const C = m2.map((x, k) => x / area - m[Math.floor(k / 3)] * m[k % 3]);
  const { values, vectors } = symEigen3(C);
  const order = [0, 1, 2].sort((p, q) => values[p] - values[q]); // ascending
  let e3 = vectors[order[0]], e1 = vectors[order[2]];
  let m3 = 0, mag = 0;
  for (const [A, cx, cy, cz] of tris) { const d = (cx - m[0]) * e3[0] + (cy - m[1]) * e3[1] + (cz - m[2]) * e3[2]; m3 += A * d * d * d; mag += A * Math.abs(d * d * d); }
  if (Math.abs(m3) > 1e-7 * mag) { if (m3 < 0) e3 = neg(e3); }
  else if (Math.abs(e3[2]) > 1e-9) { if (e3[2] < 0) e3 = neg(e3); }
  else e3 = byLargest(e3);
  e1 = Math.abs(e1[0]) > 1e-9 ? (e1[0] < 0 ? neg(e1) : e1) : byLargest(e1);
  const e2 = cross(e3, e1);
  const R = [...e1, ...e2, ...e3];
  return { R, rotation: eulerFromMatrix(R) };
}
