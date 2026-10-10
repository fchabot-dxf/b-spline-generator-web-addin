/**
 * 2026-10-09 (seat A; Fred's showcase Sends were 5-44 MB of JSON): the Send's transport (core/fusion-bridge.js
 * SEND_TRANSPORT / encodeSendPayload / sendFusionPayloadChunked; the add-in's send_transport.py). The palette gzips +
 * base64s the payload only when the add-in announced 'gzip-b64' and CompressionStream works, declares the encoding in
 * 'generate_start', and the chunks join back to exactly what was encoded. Plain otherwise -- pinned too.
 * fixtures/send-gzip-b64.json is a real STEP payload encoded HERE, decoded by the add-in's own test
 * (b-spline-gen/test_send_transport.py): the two languages agree on the format. PIN=1 rewrites it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { SEND_TRANSPORT, encodeSendPayload, setAddinSendTransport, sendFusionPayloadChunked } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { generateHeightmap, resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { buildThickenData } from '../bspline-frame-builder/b-spline-gen/html/core/engine/build-thicken-data.js';
import { generateThickenedStep } from '../bspline-frame-builder/b-spline-gen/html/core/stepWriter.js';

const FIXTURE = 'tests/fixtures/send-gzip-b64.json';
const gunzipB64 = (s) => zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8');
const sha1 = (s) => createHash('sha1').update(s, 'utf8').digest('hex');

/** A real Send payload: a small board's Clean + Stamped STEP texts (the header carries a non-ASCII dash). */
function realPayload(W = 3, H = 4) {
  const { nx, nz } = resolveGrid(W, H, 0.05);
  const p = { ...P, widthIn: W, heightIn: H, thickenEnabled: true };
  const { heights } = generateHeightmap({ ...p, nx, nz }, { mask: null });
  const off = buildThickenData(heights, nx, nz, p, {}).data.offsetPts;
  const shared = { widthIn: W, heightIn: H, carveZ: p.carveZ, nx, nz, orientation: 'z-up', options: { clean: true, cleanSurf: true, stamped: true, stampedSurf: true } };
  const stepVariants = ['Clean', 'Stamped'].map((name) => ({ name, stepText: generateThickenedStep(heights, off, { ...shared, baseFilter: name }, heights) }));
  return JSON.stringify({ params: { ...p }, stepVariants, filename: 'transport — test.step', isPreview: false });
}

afterEach(() => { setAddinSendTransport({}); vi.unstubAllGlobals(); delete globalThis.adsk; });

describe('the Send transport', () => {
  it('declares its encodings, gzip first, plain always there', () => {
    expect(SEND_TRANSPORT).toEqual({ version: 1, encodings: ['gzip-b64', 'plain'] });
    expect(Object.isFrozen(SEND_TRANSPORT)).toBe(true);
  });

  it('gzip-b64 when the add-in reads it: decodes to the exact text (a real STEP payload, UTF-8, > one base64 piece)', async () => {
    const payload = realPayload();
    expect(payload.length).toBeGreaterThan(3 * 16384 * 4);
    const { encoding, data } = await encodeSendPayload(payload, ['plain', 'gzip-b64']);
    expect(encoding).toBe('gzip-b64');
    expect(gunzipB64(data)).toBe(payload);
    expect(data.length).toBeLessThan(payload.length / 3);
  });

  it('plain when the add-in did not announce gzip (an older add-in), or announced only unknown encodings', async () => {
    for (const enc of [['plain'], [], ['zstd']]) {
      expect(await encodeSendPayload('{"a":1}', enc)).toEqual({ encoding: 'plain', data: '{"a":1}' });
    }
  });

  it('plain when CompressionStream is missing or fails -- never a failed Send', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(await encodeSendPayload('{"a":1}', ['gzip-b64', 'plain'])).toEqual({ encoding: 'plain', data: '{"a":1}' });
    vi.stubGlobal('CompressionStream', class { constructor() { throw new Error('no gzip here'); } });
    expect(await encodeSendPayload('{"a":1}', ['gzip-b64', 'plain'])).toEqual({ encoding: 'plain', data: '{"a":1}' });
  });

  const capture = () => { const calls = []; globalThis.adsk = { fusionSendData: (action, data) => { if (action !== 'log') calls.push([action, data]); return 'OK'; } }; return calls; };
  const joined = (calls) => calls.filter(([a]) => a === 'generate_chunk').map(([, d]) => JSON.parse(d)).sort((x, y) => x.index - y.index).map((c) => c.data).join('');

  it('the chunked Send: the envelope declares the encoding + version, the chunks join to the encoded text', async () => {
    const payload = realPayload(5, 6);
    setAddinSendTransport({ version: 1, encodings: ['plain', 'gzip-b64'] });
    const calls = capture();
    await sendFusionPayloadChunked(payload);
    const start = JSON.parse(calls[0][1]);
    expect(calls[0][0]).toBe('generate_start');
    expect(start).toEqual({ totalChunks: calls.filter(([a]) => a === 'generate_chunk').length, encoding: 'gzip-b64', version: 1 });
    expect(gunzipB64(joined(calls))).toBe(payload);
    expect(calls.at(-1)[0]).toBe('generate_finish');
  });

  it('the plain Send is unchanged: the chunks join to the payload itself, encoding declared plain', async () => {
    const payload = realPayload();
    const calls = capture(); // no handshake: the add-in announced nothing
    await sendFusionPayloadChunked(payload);
    expect(JSON.parse(calls[0][1])).toEqual({ totalChunks: Math.ceil(payload.length / (256 * 1024)), encoding: 'plain', version: 1 });
    expect(joined(calls)).toBe(payload);
  });

  it('the cross-language fixture: encoded by the palette, decoded by the add-in (test_send_transport.py)', async () => {
    if (process.env.PIN === '1') {
      const payload = realPayload(1, 1.5);
      const { encoding, data } = await encodeSendPayload(payload, ['gzip-b64']);
      writeFileSync(FIXTURE, JSON.stringify({ encoding, sha1: sha1(payload), chars: payload.length, data }) + '\n');
    }
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(fx.encoding).toBe('gzip-b64');
    const text = gunzipB64(fx.data);
    expect(text.length).toBe(fx.chars);
    expect(sha1(text)).toBe(fx.sha1);
  });
});
