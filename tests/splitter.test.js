/**
 * MOB3 AMEND — splitter.js's pure snap math (nearestSnap/nextSnap), shared
 * by editor-drawer.js's bottom-drawer handle and main/mobile-resizer.js's
 * preview/sidebar splitter. makeSplitter itself is DOM orchestration
 * (pointer capture, live drag, resize re-anchoring) — live-proved via CDP
 * instead, same split as editor-drawer.test.js's own drawerHeightPx.
 */
import { describe, it, expect } from 'vitest';
import { nearestSnap, nextSnap } from '../bspline-frame-builder/b-spline-gen/html/editor/splitter.js';

const SNAPS = [
  { name: 'peek', px: 96 },
  { name: 'half', px: 422 },
  { name: 'full', px: 743 },
];

describe('nearestSnap', () => {
  it('picks the closest declared snap', () => {
    expect(nearestSnap(110, SNAPS)).toEqual(SNAPS[0]);
    expect(nearestSnap(400, SNAPS)).toEqual(SNAPS[1]);
    expect(nearestSnap(800, SNAPS)).toEqual(SNAPS[2]);
  });

  it('a value exactly halfway between two snaps resolves to whichever is checked first — deterministic, not incidental', () => {
    expect(nearestSnap((96 + 422) / 2, SNAPS)).toEqual(SNAPS[0]);
    expect(nearestSnap((422 + 743) / 2, SNAPS)).toEqual(SNAPS[1]);
  });

  it('an absurdly large or small value still resolves to the nearest real snap, never throws', () => {
    expect(nearestSnap(100000, SNAPS)).toEqual(SNAPS[2]);
    expect(nearestSnap(-500, SNAPS)).toEqual(SNAPS[0]);
  });

  it('an empty snap list resolves to null rather than throwing', () => {
    expect(nearestSnap(400, [])).toBeNull();
  });
});

describe('nextSnap', () => {
  it('cycles peek -> half -> full -> peek — tap-to-cycle\'s own math', () => {
    expect(nextSnap(96, SNAPS)).toEqual(SNAPS[1]);
    expect(nextSnap(422, SNAPS)).toEqual(SNAPS[2]);
    expect(nextSnap(743, SNAPS)).toEqual(SNAPS[0]);
  });

  it('a free (non-snapped) current size cycles from whichever snap it is nearest to', () => {
    expect(nextSnap(200, SNAPS)).toEqual(SNAPS[1]); // nearest peek -> advances to half
    expect(nextSnap(500, SNAPS)).toEqual(SNAPS[2]); // nearest half -> advances to full
  });

  it('an empty snap list resolves to null rather than throwing', () => {
    expect(nextSnap(400, [])).toBeNull();
  });
});
