/**
 * Seat D 2026-10-08 (phone, Photo blur drag at CPU x4: each tick repaints the editor's backdrop -- a 384-wide
 * generateHeightmap, ~72 ms of a ~165 ms tick; the photo sampler about half of it): the per-sample work that is the
 * same for every sample of one heightmap moved out of the loops (terrain.js's filter pick + its noiseRefs object, the
 * photo sampler's tweaks / rotation / cover scale). The OUTPUT must not move by one bit: GOLDEN holds the sha256 of
 * every filter's heightmap and of the photo filter under its tweaks, measured on the code BEFORE that change.
 * Fred 2026-11-23 ("Remove photo"): the photo sampler and its cases left with the photo; every filter's hash is
 * unchanged by that removal (the same GOLDEN values).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { NoiseModes } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
};
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const CASES = () => [
  ...Object.keys(NoiseModes).sort().map((id) => [`filter ${id}`, { ...BASE, noiseType: id }]),
  ['filter simplex, isolateSkeleton', { ...BASE, noiseType: 'simplex', isolateSkeleton: true }],
  ['filter simplex, symmetry radial', { ...BASE, noiseType: 'simplex', symmetry: 'radial', symOffsetX: 0.05 }],
];
// measured on the code before the change (see the header); a missing entry fails, never passes
const GOLDEN = {
  "filter artifact": "70fe1f456535c168",
  "filter basalt": "7b29663f6b988d33",
  "filter carved": "53ad29cdf6082183",
  "filter chest": "1b8c0c73774f8db2",
  "filter cracked": "2976cc167366879d",
  "filter dunes": "92b681846b89ca0d",
  "filter eroded": "72afcb4ab86a16ff",
  "filter faceted": "8f878f5a69bca032",
  "filter glacier": "b5267d81486f3436",
  "filter hetero": "263374b4f062c8a8",
  "filter magma": "06b6c36bbc687bf7",
  "filter mars": "0ae0ac7692aa2c99",
  "filter moon": "ded42d395b6b8c24",
  "filter mycelium": "5ffdf06ea3d022c9",
  "filter reef": "e02f8c696f1d2b70",
  "filter ripples": "430a0a4fd995652e",
  "filter sandstone": "5d5e1b20fd38e4e2",
  "filter sculptural": "54aaa9b9448a2b61",
  "filter silk": "4def270af44c12e3",
  "filter simplex": "7d7fe10f715212ce",
  "filter stone": "a934b30b512c4fa4",
  "filter venus": "cf0d5b8d4153cc3d",
  "filter simplex, isolateSkeleton": "68623755e3aefc51",
  "filter simplex, symmetry radial": "41a662ce2f26c056",
};

describe('generateHeightmap: every filter, byte-identical to the measured golden output', () => {
  it('hashes', () => {
    const got = Object.fromEntries(CASES().map(([name, p]) => [name, sha(generateHeightmap(p).heights)]));
    if (process.env.PRINT_GOLDEN) console.log('GOLDEN=' + JSON.stringify(got));
    expect(got).toEqual(GOLDEN);
  });
});
