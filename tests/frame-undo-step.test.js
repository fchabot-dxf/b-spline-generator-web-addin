/**
 * Fred: "changing wood frame doesn't make an undo step". Seat D measured on main (a real project, the sidebar): template,
 * thickness, trim offset, wood, bottom Z, panel lip and the inset window each changed the frame, and the main Undo /
 * Ctrl+Z put back 0 of them -- a frame edit pushed only the editor Frame tab's private history, and a global undo keeps
 * the frame (snapshot-manager.js UNDO_KEEPS). Now each sidebar frame edit is ONE global step carrying its frame
 * transition (core/history.js recordStep + UNDO_STEP_RESTORES.frame); inside the editor the Frame tab's own undo keeps it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { initFramePanel, frameHistoryDepth, undoFrame } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { globalHistoryLog, globalRedoLog, unifiedUndo, unifiedRedo, takeSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

const field = (id, tag = 'input', extra = '') => `<${tag} id="${id}" ${extra}></${tag}>`;
beforeEach(() => {
  document.body.innerHTML = '<div id="svgEditorModal" style="display:none"></div>'
    + field('frameTemplate', 'select') + field('frameAppearance', 'select')
    + field('frameThickness', 'input', 'type="number"') + field('frameBottomZ', 'input', 'type="number"')
    + field('framePanelLip', 'input', 'type="number"') + field('frameInsetWindowToggle', 'input', 'type="checkbox"');
  setFrameRecord({ templateId: 'template_1', params: {} });
  initFramePanel();
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  takeSnapshot('Initial');
});
const settle = () => new Promise((r) => setTimeout(r, 60)); // editFrame paints the 'frame' stage first
const frameJson = () => JSON.stringify(getFrameRecord());
const otherOption = (sel) => [...sel.options].find((o) => o.value && o.value !== sel.value).value;

// each sidebar frame control: how a user changes it (a commit = one 'change')
const EDITS = [
  ['template', (e) => { e.value = otherOption(e); }, 'frameTemplate'],
  ['wood', (e) => { e.value = otherOption(e); }, 'frameAppearance'],
  ['thickness', (e) => { e.value = String((getFrameRecord().params.frame_thickness ?? 1) + 0.25); }, 'frameThickness'],
  ['bottom Z', (e) => { e.value = '0.3'; }, 'frameBottomZ'],
  ['panel lip', (e) => { e.value = '0.1'; }, 'framePanelLip'],
  ['inset window on', (e) => { e.checked = true; }, 'frameInsetWindowToggle'],
];

describe('a sidebar frame edit is ONE global undo step', () => {
  for (const [what, set, id] of EDITS) {
    it(`${what}: the main Undo puts the frame back, Redo re-applies it`, async () => {
      const before = frameJson();
      const el = document.getElementById(id);
      set(el); el.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      const after = frameJson();
      expect(after).not.toBe(before);
      expect(globalHistoryLog.filter((s) => s.label !== 'Initial' && !s.label.startsWith('Before ')).length).toBe(1);
      const step = globalHistoryLog[globalHistoryLog.length - 1];
      expect(JSON.stringify(step.restore.frame.before)).toBe(before);
      expect(JSON.stringify(step.restore.frame.after)).toBe(after);
      // the global undo / redo hand the step's own frame to applySnapshot (snapshot-manager.js puts it back)
      const applied = [];
      unifiedUndo((snap, restore) => applied.push(JSON.stringify(restore.frame)));
      unifiedRedo((snap, restore) => applied.push(JSON.stringify(restore.frame)));
      expect(applied).toEqual([before, after]);
    });
  }

  it('a slider / stepper drag is one step on release: input ticks record nothing, the change records one', async () => {
    const el = document.getElementById('frameThickness');
    for (let i = 1; i <= 5; i++) { el.value = String(1 + i * 0.1); el.dispatchEvent(new Event('input', { bubbles: true })); }
    expect(globalHistoryLog.length).toBe(1);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(globalHistoryLog.filter((s) => s.restore?.frame).length).toBe(1);
  });

  it('inside the editor only the Frame tab\'s own undo records it (the stacks stay separate)', async () => {
    document.getElementById('svgEditorModal').style.display = 'block';
    const depth = frameHistoryDepth(), before = frameJson();
    const el = document.getElementById('frameAppearance');
    el.value = otherOption(el); el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(globalHistoryLog.length).toBe(1);
    expect(frameHistoryDepth()).toBe(depth + 1);
    undoFrame();
    expect(frameJson()).toBe(before);
  });
});

