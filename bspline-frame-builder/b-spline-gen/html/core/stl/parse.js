/**
 * stl/parse.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): an STL file as a triangle SOUP, Float32Array [x,y,z, x,y,z, x,y,z, ...].
 * Binary AND ASCII. Pure: no DOM, no canvas, so it is unit-tested on real byte layouts. The mesh need not be closed
 * (the stamp only needs the surface seen from above), so nothing here checks watertightness (core/stl/mesh.js meshHealth reports).
 */

const asciiAt = (u8, from, n) => { let s = ''; for (let i = from; i < Math.min(u8.length, from + n); i++) s += String.fromCharCode(u8[i]); return s; };

function parseBinary(dv, n) {
  const soup = new Float32Array(n * 9);
  for (let t = 0; t < n; t++) {
    const at = 84 + t * 50 + 12; // skip the 12-byte normal
    for (let k = 0; k < 9; k++) soup[t * 9 + k] = dv.getFloat32(at + k * 4, true);
  }
  return soup;
}

function parseAscii(u8) {
  let text = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) text += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(+m[1], +m[2], +m[3]);
  if (out.length === 0 || out.length % 9 !== 0) throw new Error('The ASCII STL has no complete triangles.');
  return Float32Array.from(out);
}

/** @param {ArrayBuffer|Uint8Array} buf  @returns {{ soup: Float32Array, triCount: number, format: 'binary'|'ascii' }} */
export function parseStl(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 15) throw new Error('This is not an STL file (too short).');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  // 1. a binary STL whose size is EXACTLY 84 + 50 * triangles: binary, whatever its header says (some binary exporters
  //    start their 80-byte header with the word "solid")
  // 2. a "solid" header with "facet" in the first 2000 bytes: ASCII
  // 3. a triangle count whose triangles fit in the file: binary with trailing bytes (padding), which are ignored
  // 4. otherwise: a "solid" header is read as ASCII (its own error if it has no triangles), anything else is refused
  const n = u8.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  if (n > 0 && 84 + n * 50 === u8.byteLength) return { soup: parseBinary(dv, n), triCount: n, format: 'binary' };
  const solid = asciiAt(u8, 0, 5).toLowerCase() === 'solid';
  if (!(solid && asciiAt(u8, 0, 2000).toLowerCase().includes('facet')) && n > 0 && 84 + n * 50 <= u8.byteLength) {
    return { soup: parseBinary(dv, n), triCount: n, format: 'binary' };
  }
  if (solid) {
    const soup = parseAscii(u8);
    return { soup, triCount: soup.length / 9, format: 'ascii' };
  }
  throw new Error('This is not an STL file (not binary STL, and no "solid" header).');
}
