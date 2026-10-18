/**
 * Pull from Fusion part 2 (seat B 2026-10-18), end to end on the app's real shapes: a sketch whose waist handle was
 * dragged in Fusion -> fit -> change list ("Wood frame: shape changed (N handles moved)") -> Apply writes the SEEDED
 * handle values (record.seeds), one undo step, Undo puts them back. Unchecked rows (outside the Frame tab's range)
 * are never written; an inexpressible edit writes nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/main/param-manager.js', async (orig) => ({ ...(await orig()), applyParam: vi.fn() }));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { getFrameRecord, setFrameRecord, frameSeedIds } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameSeedGeometry } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { fitPulledFrameShape } from '../bspline-frame-builder/b-spline-gen/html/core/pull-frame-shape.js';
import { buildChangeList } from '../bspline-frame-builder/b-spline-gen/html/core/pull-changelist.js';
import { globalHistoryLog, globalRedoLog, takeSnapshot, unifiedUndo } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { applyChangeList, showChangeListDialog } from '../bspline-frame-builder/b-spline-gen/html/main/pull-changelist.js';

const W = 7, H = 9, board = { widthIn: W, heightIn: H };
const tpl = FRAME_DEFS.templates.find((t) => t.id === 'template_1');
const pulledWith = (seeds) => frameSeedGeometry(tpl, frameCutProfile(FRAME_DEFS, { ...getFrameRecord(), seeds: { ...getFrameRecord().seeds, ...seeds } }, board), W, H);
const listFor = (pulled) => buildChangeList({ boardParams: {} }, { P, frame: getFrameRecord(), frameShape: fitPulledFrameShape(FRAME_DEFS, getFrameRecord(), board, pulled) });

beforeEach(() => {
  P.widthIn = W; P.heightIn = H;
  setFrameRecord({ templateId: 'template_1', seeds: {} });
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  takeSnapshot('Initial');
});

describe('Pull sends the ids it wants back', () => {
  it('frameSeedIds = the template’s line/arc seedMap ids; no frame = none', () => {
    const ids = frameSeedIds();
    expect(ids).toEqual(expect.arrayContaining(['top_edge', 'arc_waist_R', 'horn_TR']));
    expect(ids.some((i) => i.startsWith('skel_') || i.startsWith('seed_rad_'))).toBe(false); // pins/radius dims are not curves
    expect(frameSeedIds({ templateId: null })).toEqual([]);
  });
});

describe('the change list', () => {
  it('an untouched sketch shows nothing for the frame shape', () => {
    const cl = listFor(pulledWith({}));
    expect(cl.frameShapeRows).toEqual([]);
    expect(cl.frameShapeBeyond).toEqual([]);
  });

  it('a dragged waist is one checked row, old -> new in inches', () => {
    const cl = listFor(pulledWith({ waistReach: 0.45 }));
    const row = cl.frameShapeRows.find((r) => r.key === 'waistReach');
    expect(row).toBeTruthy();
    expect(row.apply).toBe(true);
    expect(row.to).not.toBeCloseTo(row.from, 2);
    expect(row.unit).toBe('in');
  });

  it('a fit outside the handle’s range starts UNCHECKED (detection only, no clamp)', () => {
    const cl = listFor(pulledWith({ waistReach: 0.45 }));
    const flagged = buildChangeList({ boardParams: {} }, { P, frame: getFrameRecord(), frameShape: { status: 'changed', rows: [{ ...cl.frameShapeRows[0], outOfRange: true }] } });
    expect(flagged.frameShapeRows[0].apply).toBe(false);
    expect(flagged.frameShapeRows[0].toFrac).toBe(cl.frameShapeRows[0].toFrac); // value untouched
  });

  it('an inexpressible edit is a note, not rows', () => {
    const bad = JSON.parse(JSON.stringify(pulledWith({})));
    bad.top_edge.points[0][0] += 0.7; bad.top_edge.points[0][1] += 0.5;
    const cl = listFor(bad);
    expect(cl.frameShapeRows).toEqual([]);
    expect(cl.frameShapeBeyond).toContain('top_edge');
  });

  it('the dialog says "Wood frame: shape changed (N handles moved)" and checkbox state rides on the row', () => {
    const cl = listFor(pulledWith({ waistReach: 0.45 }));
    const n = cl.frameShapeRows.length;
    const overlay = showChangeListDialog(cl, {});
    expect(overlay.textContent).toContain(`Wood frame: shape changed (${n} handle${n === 1 ? '' : 's'} moved)`);
    const box = overlay.querySelector('input[type=checkbox]');
    box.checked = false; box.dispatchEvent(new Event('change'));
    expect(cl.frameShapeRows[0].apply).toBe(false);
    overlay.remove();
  });
});

describe('Apply', () => {
  it('writes the seeded handle values, and is ONE undo step that restores the old seeds', async () => {
    const cl = listFor(pulledWith({ waistReach: 0.45 }));
    const want = Object.fromEntries(cl.frameShapeRows.map((r) => [r.key, r.toFrac]));
    P.seed = (P.seed || 0) + 1; // drift so the baseline step is recorded (same precedent as pull-changelist-apply)
    await applyChangeList(cl, {});
    for (const [k, v] of Object.entries(want)) expect(getFrameRecord().seeds[k]).toBeCloseTo(v, 9);
    expect(globalHistoryLog.map((s) => s.label).filter((l) => l === 'Pull from Fusion')).toHaveLength(1);
    const applied = [];
    unifiedUndo((snap, restore) => applied.push(restore && restore.frame));
    expect(applied[0].seeds.waistReach).toBeUndefined();
  });

  it('an unchecked row is not written', async () => {
    const cl = listFor(pulledWith({ waistReach: 0.45 }));
    cl.frameShapeRows.forEach((r) => { r.apply = false; });
    await applyChangeList(cl, {});
    expect(getFrameRecord().seeds).toEqual({});
  });
});
