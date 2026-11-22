/**
 * SMITHSONIAN-BROWSER worker I, part 2 (SMITHSONIAN-BROWSER-DESIGN.md sections 2-3): geometry only, no textures (Fred: "I don't
 * want the texture"; measured: the images are 50% of each GLB). stripGlbTextures rebuilds a GLB without images / textures /
 * samplers / materials and with ONLY the referenced bufferViews in its BIN chunk; fetchGlbGeometry downloads just those bytes with
 * Range requests (header, JSON, the kept views), falling back to a full download + stripGlbTextures. A small REAL GLB is built
 * here (an image bufferView between two geometry bufferViews); no THREE, no Draco, no network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  stripGlbTextures, fetchGlbGeometry, loadGlbScene, _resetGltfLoaderForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/gltf.js';

const JSON_TYPE = 0x4e4f534a, BIN_TYPE = 0x004e4942;
const pad4 = (n) => (n + 3) & ~3;

/** Write a GLB from a glTF JSON and a BIN byte array (the GLB container format: header, JSON chunk, BIN chunk). */
function writeGlb(json, bin) {
  const j = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad4(j.length), bl = pad4(bin.length);
  const total = 12 + 8 + jl + 8 + bl;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, JSON_TYPE, true);
  out.fill(0x20, 20, 20 + jl); out.set(j, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, BIN_TYPE, true);
  out.set(bin, 28 + jl);
  return out.buffer;
}
/** Read a GLB back: { json, bin, header }. */
function readGlb(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jl)));
  let bin = null, binType = null;
  if (20 + jl + 8 <= buf.byteLength) { const bl = dv.getUint32(20 + jl, true); binType = dv.getUint32(24 + jl, true); bin = u8.slice(28 + jl, 28 + jl + bl); }
  return { json, bin, binType, magic: dv.getUint32(0, true), version: dv.getUint32(4, true), length: dv.getUint32(8, true), jsonLen: jl, jsonType: dv.getUint32(16, true) };
}

const IMAGE_BYTES = 200000; // an image bigger than the 64 KB range merge gap: the two geometry ranges stay separate
/**
 * A real GLB: bufferView 0 = positions (3 vertices), 1 = a PNG image, 2 = uint16 indices, 3 = a Draco-like payload (the
 * KHR_draco_mesh_compression bufferView). One textured material, its texture and sampler.
 */
function makeGlb() {
  const pos = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);           // 36 bytes
  const img = new Uint8Array(IMAGE_BYTES);
  img.set([0x89, 0x50, 0x4e, 0x47]); for (let i = 4; i < img.length; i++) img[i] = 0xab;      // 'PNG' then 0xAB filler
  const idx = new Uint8Array(new Uint16Array([0, 1, 2]).buffer);                              // 6 bytes
  const draco = new Uint8Array(50); for (let i = 0; i < 50; i++) draco[i] = (i * 7 + 3) & 0x7f; // never the image's 0xAB
  const views = [];
  const parts = [pos, img, idx, draco];
  let at = 0;
  for (const p of parts) { at = pad4(at); views.push({ buffer: 0, byteOffset: at, byteLength: p.length }); at += p.length; }
  const bin = new Uint8Array(pad4(at));
  parts.forEach((p, i) => bin.set(p, views[i].byteOffset));
  views[0].target = 34962; views[2].target = 34963;
  const json = {
    asset: { version: '2.0', generator: 'test' },
    extensionsUsed: ['KHR_draco_mesh_compression', 'KHR_texture_transform', 'KHR_materials_unlit'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'bust' }],
    meshes: [{ primitives: [
      { attributes: { POSITION: 0 }, indices: 1, material: 0 },
      { attributes: { POSITION: 2 }, material: 0, extensions: { KHR_draco_mesh_compression: { bufferView: 3, attributes: { POSITION: 0 } } } },
    ] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
      { componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }, // a Draco attribute: no bufferView
    ],
    materials: [{ name: 'skin', pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { scale: [1, 1] } } } } }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: 1, mimeType: 'image/png' }],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  return { buf: writeGlb(json, bin), bin, views, json };
}
const viewBytes = (bin, v) => Array.from(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength));

describe('I5. stripGlbTextures: geometry only', () => {
  it('no images / textures / samplers / materials; primitives lose their material; the texture extensions go, Draco stays', () => {
    const { buf } = makeGlb();
    const out = readGlb(stripGlbTextures(buf));
    expect(out.magic).toBe(0x46546c67);
    expect(out.version).toBe(2);
    for (const k of ['images', 'textures', 'samplers', 'materials']) expect(out.json).not.toHaveProperty(k);
    for (const p of out.json.meshes[0].primitives) expect(p).not.toHaveProperty('material');
    expect(out.json.extensionsUsed).toEqual(['KHR_draco_mesh_compression']);
    expect(out.json.extensionsRequired).toEqual(['KHR_draco_mesh_compression']);
    expect(out.json.nodes).toEqual([{ mesh: 0, name: 'bust' }]);
  });
  it('the BIN chunk holds ONLY the referenced bufferViews, their bytes exact, offsets rewritten, references remapped', () => {
    const { buf, bin, views } = makeGlb();
    const outBuf = stripGlbTextures(buf);
    const out = readGlb(outBuf);
    expect(out.json.bufferViews).toHaveLength(3); // positions, indices, Draco (the image's view is gone)
    // the accessors / the Draco extension point at the SAME bytes as before (the loader-independent check)
    const acc = out.json.accessors, prim = out.json.meshes[0].primitives;
    expect(viewBytes(out.bin, out.json.bufferViews[acc[0].bufferView])).toEqual(viewBytes(bin, views[0]));
    expect(viewBytes(out.bin, out.json.bufferViews[acc[1].bufferView])).toEqual(viewBytes(bin, views[2]));
    expect(viewBytes(out.bin, out.json.bufferViews[prim[1].extensions.KHR_draco_mesh_compression.bufferView])).toEqual(viewBytes(bin, views[3]));
    expect(acc[2]).not.toHaveProperty('bufferView');
    expect(out.json.bufferViews.map((v) => v.byteOffset % 4)).toEqual([0, 0, 0]);
    expect(out.json.bufferViews[0].target).toBe(34962);
    // the image bytes are gone: the BIN is the geometry only
    expect(out.bin.length).toBeLessThan(200);
    expect(out.bin.length).toBeGreaterThanOrEqual(36 + 6 + 50);
    expect(out.json.buffers[0].byteLength).toBeLessThanOrEqual(out.bin.length);
    expect(out.bin.length - out.json.buffers[0].byteLength).toBeLessThan(4);
    expect(out.bin.includes(0xab)).toBe(false);
    // a well-formed container: the declared length, 4-byte chunks
    expect(out.length).toBe(outBuf.byteLength);
    expect(out.jsonType).toBe(JSON_TYPE); expect(out.binType).toBe(BIN_TYPE);
    expect(out.jsonLen % 4).toBe(0);
    expect(outBuf.byteLength).toBeLessThan(buf.byteLength - IMAGE_BYTES + 100);
  });
  it('the source GLB is untouched; bytes that are not a GLB come back as they are (the loader reports them)', () => {
    const { buf } = makeGlb();
    const before = new Uint8Array(buf).slice();
    stripGlbTextures(buf);
    expect(new Uint8Array(buf)).toEqual(before);
    const junk = new Uint8Array(64); junk.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 1]);
    expect(stripGlbTextures(junk.buffer)).toBe(junk.buffer);
  });
});

/** A server holding `buf`: honours `Range: bytes=a-b` with 206 (or ignores it: `ranges: false`), logs every request. */
function serverOf(buf, { ranges = true, badLength = false } = {}) {
  const log = [];
  const f = vi.fn(async (url, init) => {
    const range = init && init.headers && init.headers.Range;
    const m = range && /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!m || !ranges) { log.push({ range: null, bytes: buf.byteLength }); return new Response(buf.slice(0), { status: 200 }); }
    const a = Number(m[1]), b = Math.min(Number(m[2]), buf.byteLength - 1);
    const body = buf.slice(a, badLength ? b : b + 1);
    log.push({ range: [a, b], bytes: body.byteLength });
    return new Response(body, { status: 206, headers: { 'content-range': `bytes ${a}-${b}/${buf.byteLength}` } });
  });
  return { f, log };
}

describe('I6. fetchGlbGeometry: a range download of the geometry only', () => {
  const URL_ = 'https://3d-api.si.edu/content/document/3d_package:x/bust-150k-1024-low.glb';
  it('the header, the JSON, then only the kept bufferViews: the SAME stripped GLB, far fewer bytes, never an image byte', async () => {
    const { buf, views } = makeGlb();
    const { f, log } = serverOf(buf);
    const got = await fetchGlbGeometry(URL_, f);
    expect(new Uint8Array(got)).toEqual(new Uint8Array(stripGlbTextures(buf)));
    expect(f.mock.calls.every(([u]) => u === URL_)).toBe(true);
    expect(log[0].range).toEqual([0, 19]);
    expect(log.every((l) => l.range)).toBe(true); // no full download
    const served = log.reduce((n, l) => n + l.bytes, 0);
    expect(served).toBeLessThan(buf.byteLength - IMAGE_BYTES + 2000);
    // no request reaches into the image's bytes (BIN data starts after the header, the JSON chunk and the BIN chunk header)
    const jl = new DataView(buf).getUint32(12, true);
    const imgA = 28 + jl + views[1].byteOffset, imgB = imgA + views[1].byteLength - 1;
    for (const { range: [a, b] } of log.slice(2)) expect(b < imgA + 4 || a > imgB - 4).toBe(true);
    // the two geometry ranges are 200 KB apart: two BIN requests (header + JSON + 2)
    expect(log).toHaveLength(4);
  });
  it('a server without range support (200): that full answer is stripped (one request)', async () => {
    const { buf } = makeGlb();
    const { f, log } = serverOf(buf, { ranges: false });
    const got = await fetchGlbGeometry(URL_, f);
    expect(new Uint8Array(got)).toEqual(new Uint8Array(stripGlbTextures(buf)));
    expect(log).toHaveLength(1);
  });
  it('an inconsistent range answer (a short body): a full download + stripGlbTextures', async () => {
    const { buf } = makeGlb();
    const { f, log } = serverOf(buf, { badLength: true });
    const got = await fetchGlbGeometry(URL_, f);
    expect(new Uint8Array(got)).toEqual(new Uint8Array(stripGlbTextures(buf)));
    expect(log.at(-1).range).toBeNull(); // the fallback asked for the whole file
  });
  it('a refused download throws with its status', async () => {
    const f = vi.fn(async () => new Response('gone', { status: 404, statusText: 'Not Found' }));
    await expect(fetchGlbGeometry(URL_, f)).rejects.toThrow(/404/);
  });
});

describe('I7. no texture is ever decoded: loadGlbScene hands the loader the stripped GLB (local .glb files too)', () => {
  const saved = {};
  beforeEach(() => { saved.three = globalThis.THREE; _resetGltfLoaderForTests(); });
  afterEach(() => { if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three; });
  it('the buffer the GLTFLoader parses has no images / textures / materials', async () => {
    let parsed = null;
    globalThis.THREE = {
      DRACOLoader: class { setDecoderPath() { return this; } },
      GLTFLoader: class { setDRACOLoader() { return this; } parse(b, p, ok) { parsed = b; ok({ scene: { id: 's' } }); } },
    };
    const { buf } = makeGlb();
    await loadGlbScene(buf);
    const out = readGlb(parsed);
    expect(out.json).not.toHaveProperty('images');
    expect(out.json).not.toHaveProperty('textures');
    expect(out.json).not.toHaveProperty('materials');
    expect(parsed.byteLength).toBeLessThan(buf.byteLength - IMAGE_BYTES + 100);
  });
});
