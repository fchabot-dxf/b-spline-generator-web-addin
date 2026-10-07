/**
 * Item 74j legacy check (advisor: the read of a style-less segment changed from a pinned 'straight' to 'auto' -- must not
 * re-shape a board already saved). Measured, seat D: every Shape Lattice shape saved on disk (7 records in the scratch
 * sends and the test fixtures), all 30 frame templates and both presets at 7x9 / 9x12 -- outline identical under main
 * (cd788f4) and 74j; no saved record has a segment without a style (the app always writes one). This pins the REAL saved
 * T7 record: its outline is main's, byte for byte (FNV of the primitives, recorded from main in the fixture).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const FIX = JSON.parse(readFileSync('tests/fixtures/t7-saved-shape-lattice-record.json', 'utf8'));
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

describe('item 74j: a saved Shape Lattice keeps its outline', () => {
  it('the real saved T7 record (12 styled segments) draws exactly what main drew', () => {
    expect(FIX.shape.segments.length).toBe(12);
    expect(FIX.shape.segments.every((s) => s && s.style)).toBe(true); // what the app saves: always a style
    expect(fnv(JSON.stringify(generateSilhouette(FIX.region, JSON.parse(JSON.stringify(FIX.shape))).primitives))).toBe(FIX.mainOutlineFnv);
  });
});
