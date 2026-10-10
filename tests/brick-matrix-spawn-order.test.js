/**
 * tools/brick-matrix/groups/index.mjs SPAWN_ORDER (seat E, 2026-10-10): --parallel spawns its groups longest first, from
 * the declared GROUP_MEASURED_S -- MEASURED that gate: strokes (484 s) started last at 180 s and finished third. The order
 * may change WHEN a group starts, never WHICH groups run.
 */
import { describe, it, expect } from 'vitest';
import { GROUPS, SEQUENTIAL_GROUPS, SPAWN_ORDER, GROUP_MEASURED_S } from '../tools/brick-matrix/groups/index.mjs';

describe('the matrix spawn order: longest first, every parallel group exactly once', () => {
  it('is a permutation of the parallel groups (no group lost, none doubled, the sequential ones not in it)', () => {
    expect([...SPAWN_ORDER].sort()).toEqual(GROUPS.filter((g) => !SEQUENTIAL_GROUPS.includes(g)).sort());
    expect(SPAWN_ORDER.some((g) => SEQUENTIAL_GROUPS.includes(g))).toBe(false);
  });
  it('runs the measured groups longest first, an unmeasured one after them', () => {
    const s = SPAWN_ORDER.map((g) => GROUP_MEASURED_S[g] ?? -1);
    expect(s).toEqual([...s].sort((a, b) => b - a));
    expect(SPAWN_ORDER[0]).toBe('wall');
  });
});
