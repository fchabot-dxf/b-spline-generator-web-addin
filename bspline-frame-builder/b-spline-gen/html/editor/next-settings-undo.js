/**
 * editor/next-settings-undo.js -- item 74d (advisor, the item 68 / 73 precedent; seat D's Artwork audit, measured: a
 * setting for the NEXT element took no undo step, so Undo took back the previous canvas edit -- e.g. the last Generate --
 * and left the setting): the Artwork tools' next-element settings ride in every undo entry (item 38's parts) and each
 * change through their controls is ONE step.
 *
 * Two kinds, declared below:
 *  - EDITOR fields: the editor holds them (stroke width, fill mode, Expand detail, font family / size). Restored
 *    directly -- never through the control's handler, which would restyle the current selection.
 *  - PANEL fields: the Lattice / Shape Lattice next-Generate settings (rails, ties, nodes) live only in their panel until
 *    Generate reads them. Values and checkboxes are restored as values; a button group by clicking its stored button
 *    (those handlers only reflect the choice in the panel).
 * A step is committed after a control's own handlers ran, and only when the settings differ from the current undo entry:
 * a setter that already committed (a selected shape restyled) is not stepped twice, and typing a number is one step.
 */
import { el } from './dom.js';
import { registerUndoPart } from './undo-parts.js';
import { commitEdit } from './editor-commit.js';

export const NEXT_SETTINGS_PART = 'artworkNextSettings';

export const EDITOR_NEXT_SETTINGS = Object.freeze([
  { prop: '_strokeWidth', box: 'editorStrokeWidth', triggers: ['editorStrokeWidth', 'editorStrokeWidthMinus', 'editorStrokeWidthPlus'] },
  { prop: '_fillMode', buttons: { stroke: 'editorFillModeStroke', fill: 'editorFillModeFill', both: 'editorFillModeBoth' } },
  { prop: '_expandDetail', box: 'editorExpandDetail', triggers: ['editorExpandDetail'] }, // its -/+ fire 'change' on the box
  { prop: '_fontFamily', box: 'editorFontFamily', triggers: ['editorFontFamily'] },
  { prop: '_fontSize', box: 'editorFontSize', triggers: ['editorFontSize', 'editorFontSizeMinus', 'editorFontSizePlus'] },
]);

const latticeNext = (pre) => ({
  values: ['RailsSpacing', 'RailsSpacingCount', 'TiesCountMin', 'TiesCountMax', 'TiesOneEnded', 'TiesDensity', 'TiesSpanMin',
    'TiesSpanMax', 'TiesAnchor', 'TiesRailSnapRows', 'TiesMinSpacing'].map((k) => pre + k),
  checks: ['NodesEnds', 'NodesCrossings', 'NodesRailEnds'].map((k) => pre + k),
  groups: [['RailsAnchorStart', 'RailsAnchorCenter', 'RailsAnchorEnd'], ['TiesModeCount', 'TiesModeDensity'],
    ['TiesSpanModeCells', 'TiesSpanModeRails']].map((g) => g.map((k) => pre + k)),
});
export const PANEL_NEXT_SETTINGS = Object.freeze([latticeNext('lattice'), latticeNext('shapeLattice')]);

const isButton = (node) => node && node.tagName === 'BUTTON';

export function initNextSettingsUndo(editor) {
  let suppress = false; // a restore's own clicks are not a user's change
  const take = () => {
    const editorPart = Object.fromEntries(EDITOR_NEXT_SETTINGS.map((f) => [f.prop, editor[f.prop] ?? null]));
    const panel = {};
    for (const p of PANEL_NEXT_SETTINGS) {
      for (const id of p.values) { const n = el(id); if (n) panel[id] = n.value; }
      for (const id of p.checks) { const n = el(id); if (n) panel[id] = !!n.checked; }
      for (const g of p.groups) panel[g[0]] = g.find((id) => el(id)?.classList.contains('active')) || null;
    }
    return { editor: editorPart, panel };
  };
  const restore = (snap) => {
    if (!snap) return;
    suppress = true;
    try {
      for (const f of EDITOR_NEXT_SETTINGS) {
        if (!(f.prop in (snap.editor || {}))) continue;
        const v = snap.editor[f.prop];
        editor[f.prop] = v;
        const box = f.box && el(f.box);
        // loose != on purpose: the box's "1.0" IS the value 1 -- rewritten only when it differs, so it keeps its format
        if (box && v != null && box.value != v) box.value = v; // eslint-disable-line eqeqeq
        if (f.buttons) for (const [mode, id] of Object.entries(f.buttons)) el(id)?.classList.toggle('active', mode === v);
      }
      const panel = snap.panel || {};
      for (const p of PANEL_NEXT_SETTINGS) {
        for (const id of p.values) { const n = el(id); if (n && id in panel) n.value = panel[id]; }
        for (const id of p.checks) { const n = el(id); if (n && id in panel) n.checked = panel[id]; }
        for (const g of p.groups) { const want = panel[g[0]]; const b = want && el(want); if (b && !b.classList.contains('active')) b.click(); }
      }
    } finally { suppress = false; }
  };
  registerUndoPart(NEXT_SETTINGS_PART, { take, restore });

  // after the control's own handlers (a microtask): one step, unless the current entry already holds these settings
  const step = () => {
    if (suppress) return;
    queueMicrotask(() => {
      const top = Array.isArray(editor._undoStack) ? editor._undoStack[editor._undoStack.length - 1] : null;
      const held = top && top.parts ? top.parts[NEXT_SETTINGS_PART] : undefined;
      if (JSON.stringify(held) !== JSON.stringify(take())) commitEdit(editor);
    });
  };
  const watch = (id) => { const n = el(id); if (n) n.addEventListener(isButton(n) ? 'click' : 'change', step); };
  for (const f of EDITOR_NEXT_SETTINGS) [...(f.triggers || []), ...Object.values(f.buttons || {})].forEach(watch);
  for (const p of PANEL_NEXT_SETTINGS) [...p.values, ...p.checks, ...p.groups.flat()].forEach(watch);
}
