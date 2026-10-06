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
  // item 68 (seat D's editor audit, measured: a stepper click = 'input' + 'change' re-laid twice and pushed TWO entries,
  // so one Undo kept the new value): one stepper click = ONE undo step, and Undo puts the value back
  stepperBox: 'brickGroutWidth',
  // item 68 (advisor): a setting for the NEXT stroke is its own undo step (before: no step -- Undo took back the
  // previous canvas edit and left the setting)
  nextStroke: { tool: 'brickTool_brush', from: 'brickBtnProfileStripped', to: 'brickBtnProfileContinuous' },
  // item 73: the Stripe tool's settings (the same panel in both tabs) -- a count stepper click = one step, Undo puts it back
  stripe: { box: 'stripeCount', tabs: [['editorTabBrick', 'brickTool_stripe'], ['editorTabArtwork', 'toolStripe']] },
  // item 74d (seat D's Artwork audit): an Artwork next-element setting is ONE step and Undo puts it back. `act` = a button
  // to click, `stepper` = a box whose stepper '+' to click; `watch` = what shows the value (a group button: its active one)
  artworkNext: [
    { tab: 'artTab_general', act: 'editorStrokeWidthPlus', watch: 'editorStrokeWidth' },
    { tab: 'artTab_general', act: 'editorFillModeFill', watch: 'editorFillModeFill' },
    { tab: 'artTab_draw', tool: 'toolExpand', act: 'editorExpandDetailPlus', watch: 'editorExpandDetail' },
    { tab: 'artTab_text', tool: 'toolText', act: 'editorFontSizePlus', watch: 'editorFontSize' },
    { tab: 'artTab_lattice', tool: 'toolLattice', stepper: 'latticeRailsSpacing', watch: 'latticeRailsSpacing' },
    { tab: 'artTab_lattice', tool: 'toolLattice', act: 'latticeTiesModeDensity', watch: 'latticeTiesModeDensity' },
    { tab: 'artTab_shape', tool: 'toolShapeLattice', stepper: 'shapeLatticeTiesCountMin', watch: 'shapeLatticeTiesCountMin' },
  ],
  artworkMarker: './editor/next-settings-undo.js',
};

// ---- F35 item 71 (seat E): the MAIN screen's Undo / Redo after a sidebar Brick quick pick on an applied board.
// Measured before (main 3a6c2a7): the pick took no global step -- Undo undid the older Apply step (pre-lay settings
// back, the laid bricks + 3D left as picked). Now each pick is one global step (core/history.js recordBoardStep):
// Undo -> the canvas, the 3D and the quick button back; Redo -> the pick again.
export const SIDEBAR_UNDO = {
  pick: 'brickQuick_pattern_herringbone', row: 'brickQuickRow_pattern', undo: 'btnGlobalUndo', redo: 'btnGlobalRedo',
  marker: 'recordBoardStep', // core/history.js export (absent = skipped)
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, js, jsJSON, click, setValue, canvasSettled, heightsSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage;
export function bind(ctx) { ({ sleep, js, jsJSON, click, setValue, canvasSettled, heightsSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage } = ctx); }
export async function run() { await runUndoSettings(); await runSidebarUndo(); }

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
  // item 68: a real stepper click on a number box is one undo step (the typing settle no longer commits a second time)
  const step = await jsJSON(`(async()=>{ const W=(ms)=>new Promise((r)=>setTimeout(r,ms)); const ed=window.svgEditor; const box=document.getElementById(${JSON.stringify(U.stepperBox)});
    const v0=box.value, n0=ed._undoStack.length; [...box.closest('.cad-stepper').querySelectorAll('button')][1].click(); await W(1500);
    const v1=box.value, n1=ed._undoStack.length; document.getElementById(${JSON.stringify(U.undo)}).click(); await W(1500);
    return JSON.stringify({ v0, v1, v2: box.value, steps: n1 - n0 }); })()`);
  checkRow('undo', 'A stepper click is ONE undo step, Undo puts the value back', step.steps === 1 && step.v1 !== step.v0 && step.v2 === step.v0,
    `${U.stepperBox} ${step.v0} -> ${step.v1} (${step.steps} undo steps) -> undo -> ${step.v2}`);
  const N = U.nextStroke;
  await click(N.tool, 800);
  const ns = await jsJSON(`(async()=>{ const W=(ms)=>new Promise((r)=>setTimeout(r,ms)); const ed=window.svgEditor; const act=(id)=>document.getElementById(id)?.classList.contains('active');
    const n0=ed._undoStack.length; document.getElementById(${JSON.stringify(N.to)}).click(); await W(1200); const n1=ed._undoStack.length, picked=act(${JSON.stringify(N.to)});
    document.getElementById(${JSON.stringify(U.undo)}).click(); await W(1200);
    return JSON.stringify({ steps: n1 - n0, picked, back: act(${JSON.stringify(N.from)}) && !act(${JSON.stringify(N.to)}) }); })()`);
  checkRow('undo', 'A next-stroke setting is ONE undo step, Undo puts it back', ns.steps === 1 && ns.picked && ns.back,
    `${N.to}: ${ns.steps} undo steps; undo -> ${ns.back ? N.from + ' active again' : 'NOT back'}`);
  for (const [tab, tool] of U.stripe.tabs) {
    await click(tab, 900); await click(tool, 800);
    const sr = await jsJSON(`(async()=>{ const W=(ms)=>new Promise((r)=>setTimeout(r,ms)); const ed=window.svgEditor; const box=document.getElementById(${JSON.stringify(U.stripe.box)});
      const v0=box.value, n0=ed._undoStack.length; [...box.closest('.cad-stepper').querySelectorAll('button')][1].click(); await W(1200);
      const v1=box.value, n1=ed._undoStack.length; document.getElementById(${JSON.stringify(U.undo)}).click(); await W(1200);
      return JSON.stringify({ v0, v1, v2: box.value, steps: n1 - n0 }); })()`);
    checkRow('undo', `Stripe count (${tab.replace('editorTab', '')} tab) is ONE undo step, Undo puts it back`, sr.steps === 1 && sr.v1 !== sr.v0 && sr.v2 === sr.v0,
      `${sr.v0} -> ${sr.v1} (${sr.steps} undo steps) -> undo -> ${sr.v2}`);
  }
  const hasArtwork = await js(`import(${JSON.stringify(U.artworkMarker)}).then(() => true, () => false)`);
  for (const c of U.artworkNext) {
    const name = `Artwork ${c.watch}: a next-element setting is ONE undo step, Undo puts it back`;
    if (!hasArtwork) { checkRow('undo', name, false, '', 'item 74d'); continue; }
    await click('editorTabArtwork', 900); await click(c.tab, 600); if (c.tool) await click(c.tool, 700);
    const ar = await jsJSON(`(async()=>{ const W=(ms)=>new Promise((r)=>setTimeout(r,ms)); const ed=window.svgEditor; const c=${JSON.stringify(c)};
      const val=()=>{ const e=document.getElementById(c.watch); return e.tagName==='BUTTON' ? [...e.parentElement.querySelectorAll(':scope > button.active')].map((b)=>b.id).join() : e.value; };
      const v0=val(), n0=ed._undoStack.length;
      if (c.act) document.getElementById(c.act).click(); else [...document.getElementById(c.stepper).closest('.cad-stepper').querySelectorAll('button')][1].click();
      await W(1000); const v1=val(), n1=ed._undoStack.length; document.getElementById(${JSON.stringify(U.undo)}).click(); await W(1000);
      return JSON.stringify({ v0, v1, v2: val(), steps: n1 - n0 }); })()`);
    checkRow('undo', name, ar.steps === 1 && ar.v1 !== ar.v0 && ar.v2 === ar.v0, `${ar.v0} -> ${ar.v1} (${ar.steps} undo steps) -> undo -> ${ar.v2}`);
  }
  if (await editorOpen()) await apply();
}

// F35 item 71 (SIDEBAR_UNDO above): the main screen's Undo / Redo of a sidebar quick pick
async function runSidebarUndo() {
  const U = SIDEBAR_UNDO;
  if (!(await js(`import('./core/history.js').then((m) => typeof m[${JSON.stringify(U.marker)}] === 'function', () => false)`))) { checkRow('undo', 'Sidebar quick pick: main Undo restores the board', false, '', U.marker); return; }
  if (await editorOpen()) { await apply(); }
  const GEO = `import('./core/state.js').then((m) => { const d = new DOMParser().parseFromString(m.P.editorSvg || '', 'image/svg+xml'); const r = (v) => Math.round(Number(v) * 1e4) / 1e4;
    const s = [...d.querySelectorAll('[data-brick-gen="1"]')].filter((n) => n.getAttribute('points')).map((n) => n.getAttribute('data-brick') + '|' + n.getAttribute('points').trim().split(/\s+/).map((q) => q.split(',').map(r).join(',')).join(' ')).sort().join(';');
    let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return (x >>> 0).toString(36) + ':' + m.P.brickSettings.pattern; })`;
  const active = (id) => js(`!!document.getElementById(${JSON.stringify(id)})?.classList.contains('active')`);
  const was = await js(`document.querySelector('#${U.row} button.active')?.id || ''`); // the row's choice before the pick
  const z0 = await heightsSettled(null); const g0 = await js(GEO);
  await click(U.pick, 2500); const z1 = await heightsSettled(z0); await sleep(1500); const g1 = await js(GEO);
  await click(U.undo, 2500); const z2 = await heightsSettled(z1); await sleep(1500); const g2 = await js(GEO);
  checkRow('undo', 'Sidebar quick pick: main Undo restores the board', g1 !== g0 && g2 === g0 && z2 === z0 && !!was && (await active(was)) && !(await active(U.pick)),
    `pick ${g0} -> ${g1}; undo -> ${g2 === g0 ? 'the board before' : g2}, 3D ${z2 === z0 ? 'back' : z2}, chip ${was} back ${await active(was)}`);
  await click(U.redo, 2500); const z3 = await heightsSettled(z2); await sleep(1500); const g3 = await js(GEO);
  checkRow('undo', 'Sidebar quick pick: main Redo brings the pick back', g3 === g1 && z3 === z1 && (await active(U.pick)), `redo -> ${g3 === g1 ? 'the pick' : g3}, 3D ${z3 === z1 ? 'the pick' : z3}`);
}
