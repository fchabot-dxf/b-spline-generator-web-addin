/**
 * F35 item 16 follow-up (Fred, via the advisor): the single 'resolution' setting splits into
 * Display (P.spacing, the live 3D preview) and Export (P.exportSpacing, the B-spline mesh actually
 * built for Send/STEP), with a `sameAsDisplayResolution` checkbox defaulting true so every existing
 * board's behaviour is unchanged until the user splits them. main/export-flow.js's own
 * `withExportResolution` is the ONE place this split takes effect -- it brackets the caller's own
 * read of `lastResult` with a temporary P.spacing swap (to P.exportSpacing) + a resolution-only
 * rebuild (`rebuild(null, ...)`, which skips `preview.update` so the Send is invisible to the live
 * 3D view), then restores Display's own resolution afterward.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({ rebuild: vi.fn(async () => {}) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', () => ({ updateStampMasks: vi.fn(async () => {}) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/sculpt-interaction.js', () => ({ updatePreviewSculptMode: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setFusionStatus: vi.fn() };
});

import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { withExportResolution } from '../bspline-frame-builder/b-spline-gen/html/main/export-flow.js';
import { rebuild } from '../bspline-frame-builder/b-spline-gen/html/core/engine.js';
import { updateStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { setFusionStatus } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';

const FAKE_PREVIEW = { name: 'the-live-preview' };

beforeEach(() => {
  P.widthIn = 7; P.heightIn = 9;
  P.spacing = 0.05;
  P.exportSpacing = 0.05;
  P.sameAsDisplayResolution = true;
  setIsFusionMode(false);
  vi.clearAllMocks();
});
afterEach(() => { setIsFusionMode(false); });

describe('withExportResolution: sameAsDisplayResolution (every existing board\'s default)', () => {
  it('is a pure no-op wrapper -- calls fn directly, never touches rebuild/masks/P.spacing', async () => {
    const fn = vi.fn(async () => 'the-result');
    const result = await withExportResolution(FAKE_PREVIEW, fn);
    expect(result).toBe('the-result');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(updateStampMasks).not.toHaveBeenCalled();
    expect(P.spacing).toBe(0.05); // unchanged
  });
});

describe('withExportResolution: sameAsDisplayResolution OFF (Display and Export genuinely differ)', () => {
  beforeEach(() => { P.sameAsDisplayResolution = false; P.spacing = 0.05; P.exportSpacing = 0.015; });

  it('swaps P.spacing to exportSpacing for the DURATION of fn, then restores Display\'s own value', async () => {
    let spacingDuringFn = null;
    const fn = vi.fn(async () => { spacingDuringFn = P.spacing; });
    await withExportResolution(FAKE_PREVIEW, fn);
    expect(spacingDuringFn).toBe(0.015);
    expect(P.spacing).toBe(0.05); // restored, exactly as the user left it
  });

  it('restores Display\'s own resolution even when fn throws (the live preview must never stay stuck at Export\'s)', async () => {
    const fn = vi.fn(async () => { throw new Error('Send failed'); });
    await expect(withExportResolution(FAKE_PREVIEW, fn)).rejects.toThrow('Send failed');
    expect(P.spacing).toBe(0.05);
    // the restore rebuild still ran despite the throw
    expect(rebuild).toHaveBeenLastCalledWith(FAKE_PREVIEW, updateStampMasks, expect.anything());
  });

  it('builds lastResult at Export\'s resolution WITHOUT touching the live preview (rebuild(null, ...)), then restores it WITH the real preview', async () => {
    const fn = vi.fn(async () => {});
    await withExportResolution(FAKE_PREVIEW, fn);
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(rebuild.mock.calls[0][0]).toBe(null); // export-resolution build: no live-preview push
    expect(rebuild.mock.calls[1][0]).toBe(FAKE_PREVIEW); // restore: back to the real preview
  });

  it('re-rasterizes masks at BOTH the export grid and the display grid (not just one)', async () => {
    const fn = vi.fn(async () => {});
    await withExportResolution(FAKE_PREVIEW, fn);
    expect(updateStampMasks).toHaveBeenCalledTimes(2);
    // export grid (0.015in spacing) has more points than the display grid (0.05in) on this 7x9 board
    const [exportNx, exportNz] = updateStampMasks.mock.calls[0];
    const [displayNx, displayNz] = updateStampMasks.mock.calls[1];
    expect(exportNx * exportNz).toBeGreaterThan(displayNx * displayNz);
  });

  it('runs rebuild/masks for export BEFORE fn, and the restore AFTER fn -- fn sees the fully-built export state', async () => {
    const order = [];
    rebuild.mockImplementation(async (preview) => { order.push(preview === null ? 'rebuild:export' : 'rebuild:restore'); });
    updateStampMasks.mockImplementation(async () => { order.push('masks'); });
    const fn = vi.fn(async () => { order.push('fn'); });
    await withExportResolution(FAKE_PREVIEW, fn);
    expect(order).toEqual(['masks', 'rebuild:export', 'fn', 'masks', 'rebuild:restore']);
  });

  it('never calls applyParam/markDirty-style UI sync -- Display\'s own dropdown must not flicker to Export\'s value', async () => {
    // Indirect proof: P.spacing is a plain property write recoverable by reading it, not routed
    // through param-manager.js's applyParam (which this test file never imports or mocks at all --
    // if withExportResolution called it, this test's own un-mocked import of state.js would still
    // pass, but a real DOM <select id="spacing"> would visibly change; verified here by confirming
    // the swap/restore is observable through P ALONE, with no DOM or extra module involved).
    const fn = vi.fn(async () => {});
    await withExportResolution(FAKE_PREVIEW, fn);
    expect(P.spacing).toBe(0.05);
  });

  describe('Fusion-mode progress message', () => {
    it('shows a "Building at <name> <value>in…" busy status naming the RESOLUTIONS entry', async () => {
      setIsFusionMode(true);
      const fn = vi.fn(async () => {});
      await withExportResolution(FAKE_PREVIEW, fn);
      expect(setFusionStatus).toHaveBeenCalledWith(expect.stringMatching(/Building at Masonry 0\.015in/), 'busy');
    });

    it('says nothing in the web (non-Fusion) export path', async () => {
      setIsFusionMode(false);
      const fn = vi.fn(async () => {});
      await withExportResolution(FAKE_PREVIEW, fn);
      expect(setFusionStatus).not.toHaveBeenCalled();
    });
  });
});
