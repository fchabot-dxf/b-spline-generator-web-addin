// Brick matrix group 'persistence': a board survives reload and save/load.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import * as decl from './_shared.mjs'; // row helpers: decl.click / decl.set (run.mjs's CDP click is bound below)
import { EDIT_PASSWORD_TEST } from './password.mjs';

// ---- persistence (audit v2 N1/N2, advisor 2026-10-04): the matrix missed the bug Fred hit. A non-default
// board is laid through the UI and applied; then after a RELOAD, and again after a project SAVE AS -> LOAD
// (the real Project Manager modal, its cloud API answered by an in-page stand-in so nothing leaves the
// machine), every control must SHOW the board's value and the canvas must show its bricks PAINTED (each
// brick's fill resolves to a <pattern> that exists).
//   setup:  UI actions, in order ({ tool } picks a Brick tool; { apply: true } presses Apply)
//   panel:  { name, active: id } -- that button is the highlighted choice; { name, value: [id, n] } -- that
//           field reads n
//   bricks: { name, kind } -- the canvas holds bricks of that kind and every one of them is painted
// T86 item 14 (37, fb-app 59550fe): a pattern's parameter chip is saved with the board (P.brickSettings.patternParams)
export const PATTERN_PARAM_PERSIST = { pattern: 'brickPattern_octagon_square', chip: 'brickPatternParam_ratio_2', introducedBy: '59550fe' };

export const PERSIST_BOARD = {
  setup: [
    { tool: 'wall' }, decl.click('brickPattern_fieldstone'), decl.click('brickSizePreset_quarter3'),
    decl.set('brickLevel_wall', 0.0625), decl.click('brickGenerate'),
    { tool: 'frame' }, decl.click('brickFramePreset_three_band'), decl.click('brickGenerate'),
    { tool: 'brush' }, { stroke: [[0.3, 0.45], [0.7, 0.45]] },
    { apply: true },
    { sidebar: true }, decl.click('brickSurfaceStyle_weathered'), decl.set('brickReliefHeight', 0.2),
  ],
  panel: [
    { name: 'Wall pattern: Fieldstone', active: 'brickPattern_fieldstone' },
    { name: 'Brick size 0.75', value: ['brickSize', 0.75] },
    { name: 'Wall Level 1/16', value: ['brickLevel_wall', 0.0625] },
    { name: 'Frame preset: 3-band', active: 'brickFramePreset_three_band' },
    { name: 'Surface: Weathered', active: 'brickSurfaceStyle_weathered' },
    { name: 'Max Height 0.2', value: ['brickReliefHeight', 0.2] },
    { name: 'Quick pattern: Fieldstone', active: 'brickQuick_pattern_fieldstone' },
  ],
  bricks: [
    { name: 'Wall bricks painted', kind: 'wall' },
    { name: 'Frame bricks painted', kind: 'frame' },
    { name: 'Brush bricks painted', kind: 'brush' },
  ],
};

// ---- Generate on a RESTORED board (F35 item 39, seat C 02; Fred on his phone: "the opened geometry isn't refreshable by
// a simple Generate"): measured before, a restored board whose settings matched its pieces re-laid byte-identical bricks.
// After the persistence group's own project load, and again after a reload: pick the Wall tool, Generate -> the wall's
// pieces carry a NEW seed (data-brick-seed); Apply + reopen keeps that new lay (pieces + seed). Not the count: the
// persistence board's wall is Fieldstone, whose stone count follows the seed.
export const GENERATE_AFTER_RESTORE = {
  tool: 'brickTool_wall', generate: 'brickGenerate', kind: 'wall', seedAttr: 'data-brick-seed',
  marker: "import('./main/brick-panel.js').then((m) => !!m.generateNow)",
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, shot, click, act, exists, CANVAS, heightsSettled, canvasSettled, editorOpen, openBrickTool, apply, rows, verdict, waitApp, openBrickTab, checkRow, openEditorTab, reloadWithStorage, drag;
// ---- F35 item 37 (seat E): a FRESH page's first lay (Wall + Frame, Apply) and a reload restoring that board give the
// IDENTICAL 3D heights hash. Reopened and found (seat E, measured): the brick samples' detail grids came from the
// browser's own image downscaler, which differs by canvas backend and page load (editor-brick-surface.js areaAverageGrey
// now), and a reload built an unmasked surface first (app-init.js bootBuildOwner now). The reload read waits on the
// app's declared restore end (waitApp: core/state.js bootRestore), the live read on the app's own built state.
export const FRESH_VS_RESTORED = {
  name: 'Item 37: a fresh first lay and its reload give the same 3D heights',
  wallTool: 'brickTool_wall', frameTool: 'brickTool_frame', generate: 'brickGenerate',
};

export function bind(ctx) { ({ sleep, send, js, jsJSON, shot, click, act, exists, CANVAS, heightsSettled, canvasSettled, editorOpen, openBrickTool, apply, rows, verdict, waitApp, openBrickTab, checkRow, openEditorTab, reloadWithStorage, drag } = ctx); }
export async function run() { await runPersistence(); await runPatternParamPersist(); await runFreshVsRestored(); }

// a page reload: run after every other group in an all-groups run (it always ran last)
export const runsLast = true;

// A pattern's parameter chip survives save + reload, still active (PATTERN_PARAM_PERSIST above).
async function runPatternParamPersist() {
  const W = PATTERN_PARAM_PERSIST, name = 'Persist (reload): pattern chip Octagon L';
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 800);
  if (!(await exists(W.pattern))) { checkRow('persistence', name, false, '', W.introducedBy); return; }
  await click(W.pattern, 2000); await click(W.chip, 2000);
  const before = await js(`!!document.getElementById(${JSON.stringify(W.chip)})?.classList.contains('active')`);
  await apply(); await heightsSettled(null); await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 800);
  const st = await jsJSON(`JSON.stringify({ chip: !!document.getElementById(${JSON.stringify(W.chip)})?.classList.contains('active'), pattern: !!document.getElementById(${JSON.stringify(W.pattern)})?.classList.contains('active') })`);
  checkRow('persistence', name, before && st.chip && st.pattern, `chip active before ${before}; after reload: pattern ${st.pattern ? 'active' : 'NOT active'}, chip ${st.chip ? 'active' : 'NOT active'}`);
  if (await editorOpen()) await apply();
}

async function runPersistence() {
  // 1. lay the declared board through the UI, applied
  for (const step of PERSIST_BOARD.setup) {
    if (step.tool) { await openBrickTool(step.tool); continue; }
    if (step.stroke) { await click('brickTool_brush', 300); await drag(step.stroke); continue; }
    if (step.apply) {
      // the declared board must really lay every kind it checks, BEFORE anything is persisted: an empty kind
      // would make its "painted" row pass vacuously or fail as 0/0 far from the cause (MEASURED: 1.5 in bricks +
      // three White Rocks rings filled T1 completely once item 16(c) stopped the wall filling a bogus region)
      const counts = (await jsJSON(`JSON.stringify(Object.fromEntries(${JSON.stringify(PERSIST_BOARD.bricks.map((b) => b.kind))}.map((k) => [k, window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="' + k + '"]').length || 0])))`));
      const empty = Object.entries(counts).filter(([, n]) => !n).map(([k]) => k);
      if (empty.length) throw new Error(`setup: the persistence board lays no ${empty.join(', ')} bricks (${JSON.stringify(counts)})`);
      console.log(`persistence board laid ${JSON.stringify(counts)}`);
      await apply(); await heightsSettled(null); continue;
    }
    if (step.sidebar) {
      if (await editorOpen()) await apply();
      await js(`import('./main/sidebar-tabs.js').then((m) => (m.revealSidebarSection('panel-brick'), 1))`);
      continue;
    }
    if (step.click === 'brickGenerate') { await click('brickGenerate', 1800); continue; }
    await act(step);
  }
  await sleep(2000);
  // 2. a reload
  await send('Page.reload', {}); await waitApp();
  await checkPersisted('reload');
  // 3. project Save As -> (fresh app) -> Load, through the real Project Manager modal (cloud stand-in)
  if (await editorOpen()) await apply();
  await js(`(()=>{ localStorage.setItem(${JSON.stringify(EDIT_PASSWORD_TEST.storageKey)}, ${JSON.stringify(EDIT_PASSWORD_TEST.password)}); return 1; })()`); // item 34: saves need it
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input'); if(!i) return 'no prompt'; i.value='brick-matrix-persist'; document.querySelector('.pm-prompt-ok').click(); await new Promise(r=>setTimeout(r,4000)); return 'ok'; })()`);
  const saved = await js(`Object.keys(JSON.parse(localStorage.getItem('brickMatrixCloudStandIn')||'{}'))`);
  console.log('project saved to the stand-in:', JSON.stringify(saved));
  // a fresh app: drop the app's own saved session (keep only the stand-in's store), reload -> defaults. At the next
  // document's start (reloadWithStorage): cleared here, the old page's pagehide saved the session straight back and
  // the load below proved nothing
  const keep = await js(`localStorage.getItem('brickMatrixCloudStandIn')`);
  await reloadWithStorage(keep ? { brickMatrixCloudStandIn: keep } : {});
  console.log('fresh app state:', await js(`(async()=>{ const { P } = await import('./core/state.js'); return JSON.stringify({ setId: P.brickSettings?.setId, frameBandPreset: P.brickSettings?.frameBandPreset }); })()`));
  await click('btnOpenProjectManager', 2500);
  const picked = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')==='brick-matrix-persist'); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  console.log('project load:', picked);
  await checkPersisted('project load');
  // F35 item 39: Generate refreshes the LOADED project, then a RELOADED session; Apply + reopen keeps the new lay
  await checkGenerateAfterRestore('project load');
  await send('Page.reload', {}); await waitApp();
  await checkGenerateAfterRestore('reload');
}

async function checkGenerateAfterRestore(when) {
  const G = GENERATE_AFTER_RESTORE;
  const name = `Generate refreshes the board after ${when}`;
  if (!(await js(G.marker))) { checkRow('persistence', name, false, '', 'F35 item 39'); return; }
  const wallState = () => jsJSON(`JSON.stringify((()=>{ const ns=[...(window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick=${JSON.stringify(G.kind)}]')||[])];
    return { n: ns.length, seeds: [...new Set(ns.map((e)=>e.getAttribute(${JSON.stringify(G.seedAttr)})))] }; })())`);
  await openEditorTab('editorTabBrick'); await click(G.tool, 900);
  const before = await wallState();
  const c0 = await js(CANVAS);
  await click(G.generate, 1800);
  await canvasSettled(c0);
  const after = await wallState();
  await apply(); await heightsSettled(null);
  await openEditorTab('editorTabBrick');
  const kept = await wallState();
  const fresh = after.seeds.length === 1 && before.seeds.length === 1 && after.seeds[0] !== before.seeds[0];
  // not the piece count: this board's wall is Fieldstone, whose stone count follows the seed (measured 152 -> 142)
  checkRow('persistence', name, before.n > 0 && after.n > 0 && fresh && kept.n === after.n && kept.seeds.join() === after.seeds.join(),
    `wall ${before.n} pieces seed ${before.seeds} -> Generate ${after.n} seed ${after.seeds} -> Apply + reopen ${kept.n} seed ${kept.seeds}`);
  await apply(); await heightsSettled(null);
}
async function checkPersisted(phase) {
  await openBrickTab();
  // evidence: what the app's STATE holds -- a FAIL with the right state here means the panel/canvas lost it
  const st = await js(`(async()=>{ const { P } = await import('./core/state.js'); const s=P.brickSettings||{};
    return JSON.stringify({ setId: s.setId, pattern: s.pattern, brickLengthIn: s.brickLengthIn, frameBandPreset: s.frameBandPreset,
      surfaceStyle: s.surfaceStyle, reliefIn: s.reliefIn, elementLevelIn: s.elementLevelIn }); })()`);
  console.log(`state after ${phase}: ${st}`);
  for (const p of PERSIST_BOARD.panel) {
    const shown = p.active
      ? await js(`!!document.getElementById(${JSON.stringify(p.active)})?.classList.contains('active')`)
      : await js(`(()=>{ const e=document.getElementById(${JSON.stringify(p.value[0])}); return !!e && Math.abs(Number(e.value) - ${p.value[1]}) < 1e-6; })()`);
    persistRow(`Persist (${phase}): ${p.name}`, shown, p.active ? `active ${p.active}` : `${p.value[0]} = ${p.value[1]}`);
  }
  for (const b of PERSIST_BOARD.bricks) {
    const r = (await jsJSON(`JSON.stringify((()=>{ const ns=[...(window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="${b.kind}"]') || [])];
      const painted=ns.filter((n)=>{ const f=n.getAttribute('fill')||''; const m=f.match(/url[(]#([^)]+)[)]/); return !m || !!document.getElementById(m[1]); }).length;
      return { n: ns.length, painted }; })())`));
    persistRow(`Persist (${phase}): ${b.name}`, r.n > 0 && r.painted === r.n, `${r.painted}/${r.n} painted`);
  }
  await shot(`persist_${phase.replace(/[^a-z]+/gi, '_')}`);
}
function persistRow(name, ok, detail) {
  rows.push({ name, kind: 'persist', result: 'ok', observed: { detail }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', persists: ok ? 'PASS' : 'FAIL' } });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}

// F35 item 37 (FRESH_VS_RESTORED above)
async function runFreshVsRestored() {
  const F = FRESH_VS_RESTORED;
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick'); await click(F.wallTool, 800); await click(F.generate, 2500);
  await click(F.frameTool, 800); await click(F.generate, 2500);
  await apply();
  const live = await heightsSettled(null, 40000);
  await send('Page.reload', {}); await waitApp();
  const back = await heightsSettled(null, 40000);
  checkRow('persistence', F.name, !!live && live !== 'none' && live === back, `live ${live} vs restored ${back}`);
}
