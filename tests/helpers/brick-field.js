/**
 * Synthetic brick-like height field for the adaptive display mesh tests/bench (F35 item 17):
 * running-bond bricks (2.0 × 0.667 in) separated by 0.034 in grout grooves cut 0.125 in deep,
 * optionally on a gentle dome (`domeIn` amplitude) so the "flat" tops are curved like a real board.
 * Returns a flat xyz `pos` laid out exactly like buildHeightField's (vertex (i, j) at j*nx + i).
 */
export const BRICK = Object.freeze({ w: 2.0, h: 0.667, grout: 0.034, relief: 0.125 });

export function brickPos(W, H, nx, nz, { domeIn = 0 } = {}) {
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * W, y = (j / (nz - 1)) * H;
      const row = Math.floor(y / BRICK.h);
      const xo = x + (row % 2 ? BRICK.w / 2 : 0);
      const gx = xo - Math.round(xo / BRICK.w) * BRICK.w;
      const gy = y - Math.round(y / BRICK.h) * BRICK.h;
      const inGroove = Math.abs(gx) < BRICK.grout / 2 || Math.abs(gy) < BRICK.grout / 2;
      const dome = domeIn * Math.sin(Math.PI * x / W) * Math.sin(Math.PI * y / H);
      const k = (j * nx + i) * 3;
      pos[k] = x - W / 2; pos[k + 1] = y - H / 2; pos[k + 2] = dome - (inGroove ? BRICK.relief : 0);
    }
  }
  return pos;
}
