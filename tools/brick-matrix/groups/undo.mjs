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
  // item 74f: a Photo edit is ONE editor undo step and the editor's Undo takes it back (P.photoEdits). `act` = a button;
  // `drag` = a slider dragged (input ticks, then the release's 'change')
  photo: [
    { tab: 'photoTab_source', act: 'photoBtnRotate' },
    { tab: 'photoTab_relief', act: 'photoBtnReliefCarved' },
    { tab: 'photoTab_adjust', drag: 'photoBrightnessSlider', values: [0.1, 0.2, 0.3] },
  ],
};

// ---- item 74j (Fred: Auto | Straight | Curve, Auto the default): on a Shape Lattice drawn from its own shape (Offset
// from frame OFF -- with it on the Segments block is inert), Curve pins a segment and changes the outline; Auto un-pins
// it and the outline is the ORIGINAL again; each pick is ONE undo step and Undo after Auto is Curve again. Real pointer.
export const SEGMENT_AUTO = {
  open: ['editorTabArtwork', 'artTab_shape', 'toolShapeLattice'], offset: 'shapeLatticeContourFromFrame', generate: 'shapeLatticeGenerate',
  segment: '0', curve: 'shapeSegStyleCurve', auto: 'shapeSegStyleAuto', marker: 'SEGMENT_STYLE_CHOICES',
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
let sleep, js, jsJSON, click, setValue, canvasSettled, heightsSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage, send;
export function bind(ctx) { ({ sleep, js, jsJSON, click, setValue, canvasSettled, heightsSettled, editorOpen, apply, checkRow, openEditorTab, reloadWithStorage, send } = ctx); }
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
  for (const c of U.photo) {
    const name = `Photo ${c.act || c.drag}: one editor undo step, the editor's Undo takes it back`;
    await click('editorTabPhoto', 900); await click(c.tab, 600);
    const pr = await jsJSON(`(async()=>{ const W=(ms)=>new Promise((r)=>setTimeout(r,ms)); const { P }=await import('./core/state.js'); const ed=window.svgEditor; const c=${JSON.stringify(c)};
      const val=()=>JSON.stringify(P.photoEdits||[]); const v0=val(), n0=ed._undoStack.length;
      if (c.act) document.getElementById(c.act).click();
      else { const e=document.getElementById(c.drag); for (const v of c.values) { e.value=String(v); e.dispatchEvent(new Event('input')); await W(60); } e.dispatchEvent(new Event('change')); }
      await W(900); const v1=val(), n1=ed._undoStack.length; document.getElementById(${JSON.stringify(U.undo)}).click(); await W(1200);
      return JSON.stringify({ v0, v1, v2: val(), steps: n1 - n0 }); })()`);
    checkRow('undo', name, pr.steps === 1 && pr.v1 !== pr.v0 && pr.v2 === pr.v0, `${pr.v0} -> ${pr.v1} (${pr.steps} undo steps) -> undo -> ${pr.v2}`);
  }
  await runSegmentAuto();
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

async function runSegmentAuto() {
  const S = SEGMENT_AUTO;
  const name = 'Shape segment: Curve pins it, Auto gives back the original outline -- one undo step each';
  const has = await js(`import('./editor/editor-shape-lattice-generator.js').then((m) => !!m[${JSON.stringify(S.marker)}], () => false)`);
  if (!has) { checkRow('undo', name, false, '', 'item 74j'); return; }
  for (const id of S.open) await click(id, 700);
  const realClick = async (id) => {
    const r = await jsJSON(`JSON.stringify((()=>{ const e=document.getElementById(${JSON.stringify(id)}); e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 }; })())`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(1200);
  };
  // the contour's own outline (its segment paths) + the undo depth + which choice shows
  const read = () => jsJSON(`JSON.stringify((()=>{ const d=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-shape-segment],[data-contour-seg],path[data-lattice="contour"]')].map((e)=>e.getAttribute('d')).join('|');
    let h=2166136261; for (let i=0;i<d.length;i++){ h^=d.charCodeAt(i); h=Math.imul(h,16777619);} const act=[...document.getElementById(${JSON.stringify(S.auto)}).parentElement.querySelectorAll('button.active')].map((b)=>b.id).join();
    return { outline: (h>>>0).toString(36) + '/' + d.length, steps: window.svgEditor._undoStack.length, active: act }; })())`);
  if (await js(`document.getElementById(${JSON.stringify(S.offset)}).checked`)) await realClick(S.offset);
  await click(S.generate, 3500);
  await js(`(()=>{ const s=document.getElementById('shapeSegmentIndex'); s.value=${JSON.stringify(S.segment)}; s.dispatchEvent(new Event('change')); return 1; })()`); await sleep(500);
  const r0 = await read(); await realClick(S.curve); const r1 = await read(); await realClick(S.auto); const r2 = await read();
  await click('editorUndo', 1500); const r3 = await read();
  checkRow('undo', name, r0.outline.split('/')[1] !== '0' && r1.outline !== r0.outline && r2.outline === r0.outline && r1.steps === r0.steps + 1 && r2.steps === r1.steps + 1
    && r0.active === S.auto && r1.active === S.curve && r2.active === S.auto && r3.outline === r1.outline,
    `outline ${r0.outline} (${r0.active}) -> Curve ${r1.outline} (+${r1.steps - r0.steps}, ${r1.active}) -> Auto ${r2.outline} (+${r2.steps - r1.steps}, ${r2.active}) -> undo ${r3.outline === r1.outline ? '= Curve' : r3.outline}`);
}
