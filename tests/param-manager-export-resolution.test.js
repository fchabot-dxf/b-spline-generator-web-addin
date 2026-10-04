/**
 * F35 item 16 follow-up: exportSpacing/sameAsDisplayResolution never affect the live Display
 * preview (core/engine/rebuild.js always rebuilds at P.spacing) -- applyParam must not schedule a
 * pointless Display-resolution rebuild just because one of these two Export-only fields changed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({
  rebuild: vi.fn(async () => {}),
  scheduleRebuild: vi.fn((fn) => fn()),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', () => ({
  updateStampMasks: vi.fn(async () => {}),
  refreshAllStampMasks: vi.fn(async () => {}),
}));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { scheduleRebuild } from '../bspline-frame-builder/b-spline-gen/html/core/engine.js';
import { refreshAllStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { AppState } from '../bspline-frame-builder/b-spline-gen/html/main/app-state.js';

beforeEach(() => {
  AppState.isInitializing = false;
  P.widthIn = 7; P.heightIn = 9; P.spacing = 0.05;
  vi.clearAllMocks();
});

describe('applyParam: exportSpacing / sameAsDisplayResolution never trigger a Display rebuild', () => {
  it('exportSpacing: no scheduleRebuild, no refreshAllStampMasks', () => {
    applyParam('exportSpacing', 0.015);
    expect(scheduleRebuild).not.toHaveBeenCalled();
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    expect(P.exportSpacing).toBe('0.015'); // the field itself still updates (stringParams)
  });

  it('sameAsDisplayResolution: no scheduleRebuild, no refreshAllStampMasks', () => {
    applyParam('sameAsDisplayResolution', false);
    expect(scheduleRebuild).not.toHaveBeenCalled();
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    expect(P.sameAsDisplayResolution).toBe(false);
  });

  it('control: an ordinary Display-affecting key (spacing itself) still goes through the real rebuild path (grid changed -> refreshAllStampMasks)', () => {
    applyParam('spacing', 0.03);
    expect(refreshAllStampMasks).toHaveBeenCalledTimes(1);
  });
});
