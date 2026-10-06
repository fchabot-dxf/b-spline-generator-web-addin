// Brick matrix group 'undo': the Brick settings undo.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- editor Undo / Redo restore the brick SETTINGS (F35 item 38, seat C 02): measured before, Undo put the canvas back
// while the panel kept the new setting (stretcher -> stack -> Undo: canvas back, pattern still 'stack'). A pattern pick,
// Undo -> the canvas hash back to the baseline AND the baseline's chip active; Redo -> forward again; a 3D-only change
// (the accent level) is its own step and comes back too. `marker` = this build's own module (absent = skipped).
export const UNDO_SETTINGS = {
  from: 'brickPattern_stretcher', to: 'brickPattern_stack', undo: 'editorUndo', redo: 'editorRedo',
  accent: 'brickAccent_checker', level: { id: 'brickAccentLevel', value: -0.0625 },
  marker: './editor/undo-parts.js',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, js, jsJSON, click, setValue, canvasSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage;
export function bind(ctx) { ({ sleep, js, jsJSON, click, setValue, canvasSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage } = ctx); }
export async function run() { await runUndoSettings(); }

// F35 item 38 (UNDO_SETTINGS above): editor Undo / Redo bring back the brick settings with the canvas
async function runUndoSettings() {
  const U = UNDO_SETTINGS;
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick');
  if (!(await js(`import(${JSON.stringify(U.marker)}).then(() => true, () => false)`))) { checkRow('undo', 'Undo restores the pattern AND its chip', false, '', U.marker); return; }
  await click('brickTool_wall', 800); await click(U.from, 1500); await click('brickGenerate', 2000);
  const chips = () => jsJSON(`JSON.stringify({ from: !!document.getElementById(${JSON.stringify(U.from)})?.classList.contains('active'), to: !!document.getElementById(${JSON.stringify(U.to)})?.classList.contains('active') })`);
  const c0 = await canvasSettled(null);
  await click(U.to, 1500);
  const c1 = await canvasSettled(c0);
  await click(U.undo, 1500);
  const c2 = await canvasSettled(c1), k2 = await chips();
  checkRow('undo', 'Undo restores the pattern AND its chip', c1 !== c0 && c2 === c0 && k2.from && !k2.to,
    `pick ${c0} -> ${c1}; undo -> ${c2 === c0 ? 'the baseline' : c2}; chips from ${k2.from} to ${k2.to}`);
  await click(U.redo, 1500);
  const c3 = await canvasSettled(c2), k3 = await chips();
  checkRow('undo', 'Redo brings the pick back, chip too', c3 === c1 && k3.to && !k3.from, `redo -> ${c3 === c1 ? 'the pick' : c3}; chips from ${k3.from} to ${k3.to}`);
  // a 3D-only change is its own step: Undo puts the level back (the canvas is not re-laid)
  await click(U.accent, 1200);
  const lv0 = Number(await js(`document.getElementById(${JSON.stringify(U.level.id)})?.value`));
  await setValue(U.level.id, U.level.value, 'change'); await sleep(1200);
  await click(U.undo, 1500);
  const lv1 = Number(await js(`document.getElementById(${JSON.stringify(U.level.id)})?.value`));
  checkRow('undo', 'Undo puts a 3D-only setting back (accent level)', lv1 === lv0 && lv0 !== U.level.value, `level ${lv0} -> ${U.level.value} -> undo -> ${lv1}`);
  if (await editorOpen()) await apply();
}
