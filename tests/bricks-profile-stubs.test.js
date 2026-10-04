/**
 * H23 item 72 BRICK ENGINE -- the declared-but-unimplemented vocabulary (advisor, after the
 * worker/advisor gate on the MathieuConnery ribbon/spine/intersection-graph engine: ship P1a on
 * today's local-perpendicular-mitre engine, but DECLARE the richer opts shape now so P2's ribbon
 * engine slots in later behind the SAME contract). `profile:'ridge'` and `caps:'notch'` are real,
 * named values -- not silently ignored or aliased to 'bricks'/'square' -- so a caller asking for
 * either gets a clear "not yet" error instead of a wrong, silently-different result.
 */
import { describe, it, expect } from 'vitest';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0];
const straight = [{ x: 0, y: 0 }, { x: 10, y: 0 }];

describe('bricksAlongPath — declared-but-unimplemented profile/caps', () => {
  it('profile:"ridge" throws a clear not-yet error (no silent fallback)', () => {
    expect(() => bricksAlongPath(straight, { set: SET, profile: 'ridge', seed: 1 })).toThrow(/ridge/i);
  });

  it('caps:"notch" throws a clear not-yet error (no silent fallback)', () => {
    expect(() => bricksAlongPath(straight, { set: SET, caps: 'notch', seed: 1 })).toThrow(/notch/i);
  });

  it('the default profile/caps ("bricks"/"square") still work normally', () => {
    const { bricks } = bricksAlongPath(straight, { set: SET, seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);
  });
});
