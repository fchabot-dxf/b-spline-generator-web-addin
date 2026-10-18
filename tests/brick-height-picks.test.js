/**
 * Fred 2026-10-11, "Select raises / lowers the selected bricks": the Select UI's pick -> record rules
 * (core/bricks/height-records.js): a tap toggles the brick under it, a box is one region pick; Raise / Lower step the level the
 * picked bricks share (mixed start from 0), Set writes a value, Reset takes the picked bricks back to no height and drops the
 * zero records nothing needs; the latest record wins, so each action only APPENDS (or prunes zeros).
 */
import { describe, it, expect } from 'vitest';
import { bricksPickedBy, heightLevelsFor, togglePick, sharedLevel, stepPickedLevel, setPickedLevel, resetPicked, heightedCount, pickedIndices, HEIGHT_STEP_IN }
  from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-records.js';

const sq = (x0, y0, s) => [{ x: x0, y: y0 }, { x: x0 + s, y: y0 }, { x: x0 + s, y: y0 + s }, { x: x0, y: y0 + s }];
const bricks = [0, 1, 2, 3].map((i) => ({ polygon: sq(i * 1.1, 0, 1) }));
const at = (i) => ({ x: i * 1.1 + 0.5, y: 0.5 });
let n = 0; const newId = () => `h${++n}`;

describe('a tap toggles the brick under it', () => {
  it('picks, picks another, unpicks the first; a tap on no brick changes nothing', () => {
    let picks = togglePick([], at(0), bricks);
    picks = togglePick(picks, at(2), bricks);
    expect([...pickedIndices(picks, bricks)]).toEqual([0, 2]);
    picks = togglePick(picks, at(0), bricks);
    expect([...pickedIndices(picks, bricks)]).toEqual([2]);
    expect(togglePick(picks, { x: 50, y: 50 }, bricks)).toEqual(picks);
  });
  it('a tap on a brick a BOX picked unpicks just it (the box becomes the points of its other bricks)', () => {
    const box = [{ pick: 'region', region: sq(-0.2, -0.5, 3.5) }]; // bricks 0, 1, 2 by centroid
    expect([...pickedIndices(box, bricks)]).toEqual([0, 1, 2]);
    const after = togglePick(box, at(1), bricks);
    expect([...pickedIndices(after, bricks)]).toEqual([0, 2]);
  });
});

describe('Raise / Lower step the shared level', () => {
  it('Raise twice then Lower once = one step; the records only append, the latest wins', () => {
    const picks = togglePick([], at(1), bricks);
    let recs = stepPickedLevel([], picks, HEIGHT_STEP_IN, bricks, newId);
    recs = stepPickedLevel(recs, picks, HEIGHT_STEP_IN, bricks, newId);
    expect(heightLevelsFor(recs, bricks).get(1)).toBeCloseTo(0.125, 6);
    recs = stepPickedLevel(recs, picks, -HEIGHT_STEP_IN, bricks, newId);
    expect(heightLevelsFor(recs, bricks).get(1)).toBeCloseTo(0.0625, 6);
    expect(recs.length).toBe(3);
  });
  it('bricks of MIXED levels start from 0, and report no shared level', () => {
    let recs = setPickedLevel([], togglePick([], at(0), bricks), 0.2, newId);
    const both = togglePick(togglePick([], at(0), bricks), at(1), bricks);
    expect(sharedLevel(recs, both, bricks)).toBeNull();
    recs = stepPickedLevel(recs, both, HEIGHT_STEP_IN, bricks, newId);
    expect([...heightLevelsFor(recs, bricks).entries()]).toEqual([[0, 0.0625], [1, 0.0625]]);
  });
  it('Set writes the value as typed (negative = recessed)', () => {
    const recs = setPickedLevel([], togglePick([], at(3), bricks), -0.1, newId);
    expect(heightLevelsFor(recs, bricks).get(3)).toBe(-0.1);
  });
});

describe('Reset', () => {
  it('takes the picked bricks to no height and leaves the others', () => {
    const a = togglePick([], at(0), bricks), b = togglePick(a, at(1), bricks);
    let recs = setPickedLevel([], b, 0.1, newId);
    recs = resetPicked(recs, a, bricks, newId);
    expect(heightLevelsFor(recs, bricks).get(0)).toBe(0);
    expect(heightLevelsFor(recs, bricks).get(1)).toBe(0.1);
    expect(heightedCount(recs, bricks)).toBe(1);
  });
  it('drops a zero record no earlier record needs (resetting never-raised bricks adds no record)', () => {
    expect(resetPicked([], togglePick([], at(2), bricks), bricks, newId)).toEqual([]);
  });
});

describe('a box record re-matches by centroid like any record (the data side)', () => {
  it('the region pick a Set writes is exactly the picked region', () => {
    const region = sq(-0.2, -0.5, 2.5);
    const recs = setPickedLevel([], [{ pick: 'region', region }], 0.05, newId);
    expect(bricksPickedBy(recs[0], bricks)).toEqual([0, 1]);
    expect(recs[0].pick).toBe('region');
  });
});

describe('one Raise writes one record for the bricks tapped', () => {
  it('taps join one points pick; a Raise over three taps writes a single record holding all three points', () => {
    let picks = [];
    for (const i of [0, 1, 3]) picks = togglePick(picks, at(i), bricks);
    expect(picks).toHaveLength(1);
    const recs = stepPickedLevel([], picks, HEIGHT_STEP_IN, bricks, newId);
    expect(recs).toHaveLength(1);
    expect(recs[0].points).toHaveLength(3);
    expect([...heightLevelsFor(recs, bricks).keys()]).toEqual([0, 1, 3]);
  });
});
