/**
 * Test helper (not a test): a real 16-bit greyscale PNG, built and read with node:zlib (filter 0 only), standing in for the
 * on-first-use PNG library (fast-png 6.2.0) with ITS shapes: decode(bytes) -> { width, height, depth, channels, data };
 * encode({ width, height, data, depth, channels }) -> Uint8Array.
 */
import { deflateSync, inflateSync, crc32 } from 'node:zlib';

export function png16Bytes(width, height, values) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 16; ihdr[9] = 0;
  const stride = 1 + width * 2, raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw.writeUInt16BE(values[y * width + x], y * stride + 1 + x * 2);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

export function decodePng16(bytes) {
  const b = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
  let o = 8, width = 0, height = 0, depth = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = 1 + width * 2, out = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error('the test decoder reads filter 0 only');
    for (let x = 0; x < width; x++) out[y * width + x] = raw.readUInt16BE(y * stride + 1 + x * 2);
  }
  return { width, height, depth, channels: 1, data: out, text: {} };
}

/** The library stand-in: the two calls the app makes. */
export const PNG_LIB = Object.freeze({
  decode: (bytes) => decodePng16(bytes),
  encode: ({ width, height, data, depth, channels }) => {
    if (depth !== 16 || channels !== 1) throw new Error('the stand-in encodes 16-bit grey only');
    return png16Bytes(width, height, data);
  },
});
