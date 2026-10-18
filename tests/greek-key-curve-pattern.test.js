import { describe, it, expect } from 'vitest';
import { tagMotifRow, CURVE_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/band-motif.js';
import { BAND_MOTIFS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

// an arc run of 6 pieces then a line run of 6; the straight run must lay the key exactly as before
const prims = [{ type: 'arc' }, { type: 'line' }];
const sources = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
const pieces = sources.map(() => ({ polygon: [] }));
const plan = { startColumn: 0 };
const arcSrc = Array(6).fill(0), arcPcs = arcSrc.map(() => ({ polygon: [] }));
const reliefs = (motif, row, curves) => tagMotifRow(arcPcs, arcSrc, prims, motif, plan, row, 12, curves).map((p) => p.relief);

describe('greek key on a curve lays a declared plain pattern, the straight run keeps the key', () => {
  const gk = BAND_MOTIFS.greek_key;
  it('declares a curvePattern that exists', () => { expect(CURVE_PATTERNS[gk.curvePattern]).toBeTruthy(); });
  it('curves off (a saved board): the arc is flush on every row', () => {
    for (let r = 0; r < 12; r++) expect(reliefs(gk, r, false)).toEqual(Array(6).fill('flush'));
  });
  it('curves on, rings: whole rows 1 and 10 raised on the arc, others flush', () => {
    const m = { ...gk, curvePattern: 'rings' };
    for (let r = 0; r < 12; r++) expect(reliefs(m, r, true)).toEqual(Array(6).fill(r === 1 || r === 10 ? 'raised' : 'flush'));
  });
  it('curves on, along: the same 2-field-1-motif sequence in every row', () => {
    const m = { ...gk, curvePattern: 'along' };
    for (let r = 0; r < 12; r++) expect(reliefs(m, r, true)).toEqual(['flush', 'flush', 'raised', 'flush', 'flush', 'raised']);
  });
  it('straight run, curves off: unchanged key (saved boards)', () => {
    const long = Array(40).fill(1), pcs = long.map(() => ({ polygon: [] })), pr = [{ type: 'arc' }, { type: 'line' }];
    const key = (r) => tagMotifRow(pcs, long, pr, gk, plan, r, 12, false).map((p) => p.relief);
    // today: the tile's own column, one per piece from the corner, whatever the run's length (here a cut-off last period)
    const tileRow = BAND_MOTIFS.greek_key.grid.tile[5];
    expect(key(5).slice(12, 28)).toEqual(Array.from({ length: 16 }, (_, i) => (tileRow[(12 + i) % 6] === 'R' ? 'raised' : 'flush')));
  });
  it('meander: the key row, column by arc-length fraction -- same turn places in every row; border rows are rings', () => {
    const arc = [{ type: 'arc', r: 6, theta1: 0, theta2: Math.PI / 2 }];
    const src = Array(24).fill(0), pcs = src.map(() => ({ polygon: [] }));
    const m = { ...gk, curvePattern: 'meander' };
    const row = (r) => tagMotifRow(pcs, src, arc, m, { startColumn: 0, pitch: 0.75 }, r, 12, true).map((p) => p.relief);
    // arc length 9.42 / (6 cols x 0.75) -> 2 periods over 24 pieces: the row repeats every 12 pieces
    for (let r = 0; r < 12; r++) expect(row(r).slice(0, 12)).toEqual(row(r).slice(12));
    expect(row(1)).toEqual(Array(24).fill('raised')); // tile row 1 is a full ring
    expect(row(0)).toEqual(Array(24).fill('flush'));
    expect(row(5)).not.toEqual(row(4)); // a key row, not a ring
  });
});
