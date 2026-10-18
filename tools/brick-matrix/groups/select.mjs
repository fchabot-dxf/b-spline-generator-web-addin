// Brick matrix group 'select': picking a Wall / Frame element.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { FRAME_LABELS } from '../../../bspline-frame-builder/b-spline-gen/html/core/frame-labels.js';

// ---- Select (item 22 slice 1, seat 37 fb-app 2482482): picking a Wall/Frame element in the Brick tab.
export const SELECT_ELEMENT = {
  wallTool: 'brickTool_wall',
  selectMode: 'brickElementSelect',
  wallSelect: 'brickSubTool_wall_select', wallArea: 'brickSubTool_wall_area', // area is hidden until 'wallRegion'
  frameTool: 'brickTool_frame',
  frameLabel: { id: 'brickElementLabel_frame', text: `Editing: this ${FRAME_LABELS.brick}` }, // the one label table (Fred's rename)
  introducedBy: '2482482',
};

// ---- Heights (Fred 2026-10-11, Select raises / lowers bricks): Wall > Heights picks bricks, Raise writes a height record.
export const SELECT_HEIGHTS = {
  wallHeights: 'brickSubTool_wall_heights', pickMode: 'brickHeightPick', picked: 'brickHeightPicked', raise: 'brickHeightRaise', clearAll: 'brickHeightClearAll',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, click, exists, CANVAS, heightsSettled, editorOpen, apply, waitApp, checkRow, openEditorTab, key;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, exists, CANVAS, heightsSettled, editorOpen, apply, waitApp, checkRow, openEditorTab, key } = ctx); }
export async function run() { await runSelect(); }

async function plainKey(keyName) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
  await sleep(700);
}
async function runSelect() {
  const S = SELECT_ELEMENT;
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 800); await click('brickGenerate', 2000);
  if (!(await exists(S.wallSelect))) { checkRow('select', 'Wall tool -> element Select', false, '', S.introducedBy); return; }
  // 1. the Wall tool arms element Select; the Area sub-tool stays hidden until the engine offers 'wallRegion'
  await click(S.wallTool, 900);
  const st = (await jsJSON(`JSON.stringify({ mode: window.svgEditor._currentMode, sel: !!document.getElementById(${JSON.stringify(S.wallSelect)})?.classList.contains('active'), area: (()=>{ const n=document.getElementById(${JSON.stringify(S.wallArea)}); return !!n && n.offsetParent !== null; })() })`));
  const listed = await js(`import('./core/bricks/engine.js').then((m) => m.ENGINE_OPTIONS.includes('wallRegion'))`); // Area is shown iff the engine lists wallRegion (brick-control-requires)
  checkRow('select', 'Wall tool -> element Select', st.mode === S.selectMode && st.sel && st.area === listed, `mode ${st.mode}, Select ${st.sel ? 'active' : 'not active'}, Area ${st.area ? 'SHOWN' : 'hidden'} (wallRegion ${listed ? 'listed' : 'not listed'})`);
  // 2. a real click on a frame brick selects the Frame element: its tool, its label, its outline -- drawing untouched
  const before = await js(CANVAS);
  const at = (await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const n=ns[Math.floor(ns.length/2)]; if(!n) return null; const r=n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, frames: ns.length }; })())`));
  if (!at) { checkRow('select', 'Click a frame brick -> the Frame element', false, 'no frame brick on the canvas'); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1000);
  const sel = (await jsJSON(`JSON.stringify({ frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active'), label: (document.getElementById(${JSON.stringify(S.frameLabel.id)})?.textContent||'').trim(), outline: (window.svgEditor._brickElementOutline||[]).length })`));
  const after = await js(CANVAS);
  checkRow('select', 'Click a frame brick -> the Frame element', sel.frameTool && sel.label.includes(S.frameLabel.text) && sel.outline === at.frames,
    `frame tool ${sel.frameTool ? 'active' : 'NOT active'}, label "${sel.label}", outline ${sel.outline} of ${at.frames} frame bricks`);
  checkRow('select', 'Selecting adds nothing to the drawing', before === after, before === after ? 'canvas hash unchanged' : `canvas changed ${before} -> ${after}`);
  // 3. Esc once clears the selection (tool stays), Esc twice clears the tool
  await plainKey('Escape');
  const e1 = (await jsJSON(`JSON.stringify({ outline: (window.svgEditor._brickElementOutline||[]).length, frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active') })`));
  checkRow('select', 'Esc once -> selection cleared, tool stays', e1.outline === 0 && e1.frameTool, `outline ${e1.outline}, frame tool ${e1.frameTool ? 'active' : 'cleared'}`);
  await plainKey('Escape');
  const e2 = await js(`[...document.querySelectorAll('[id^="brickTool_"].active')].map((b)=>b.id).join(',')`);
  checkRow('select', 'Esc twice -> no Brick tool active', !e2, e2 ? `still active: ${e2}` : 'no tool active');
  // 4. Heights: a real tap on a Wall brick picks it (an outline in the highlight layer, the drawing untouched); Raise writes ONE
  //    record; Esc clears the pick; clear all removes the record
  const H = SELECT_HEIGHTS;
  await click(S.wallTool, 900);
  if (!(await exists(H.wallHeights))) { checkRow('select', 'Wall > Heights sub-tool', false, 'no Heights sub-tool'); return; }
  await click(H.wallHeights, 700);
  const wb = (await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]')]; const n=ns[Math.floor(ns.length/2)]; if(!n) return null; const r=n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })())`));
  if (!wb) { checkRow('select', 'Heights: tap a Wall brick', false, 'no wall brick on the canvas'); return; }
  const hBefore = await js(CANVAS);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: wb.x, y: wb.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: wb.x, y: wb.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: wb.x, y: wb.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(800);
  const hp = (await jsJSON(`JSON.stringify({ mode: window.svgEditor._currentMode, chip: (document.getElementById(${JSON.stringify(H.picked)})?.textContent||''), outline: (window.svgEditor._brickHeightOutline||[]).length })`));
  checkRow('select', 'Heights: a tap picks the Wall brick under it', hp.mode === H.pickMode && /^1 brick picked/.test(hp.chip) && hp.outline === 1 && (await js(CANVAS)) === hBefore,
    `mode ${hp.mode}, "${hp.chip}", outline ${hp.outline}, drawing ${(await js(CANVAS)) === hBefore ? 'untouched' : 'CHANGED'}`);
  await click(H.raise, 900);
  const nRec = await js(`import('./core/state.js').then((m) => (m.P.brickSettings.heights || []).length)`);
  checkRow('select', 'Heights: Raise writes one height record', nRec === 1, `${nRec} record(s)`);
  await plainKey('Escape');
  const cleared = await js(`(window.svgEditor._brickHeightOutline||[]).length`);
  checkRow('select', 'Heights: Esc clears the pick (the record stays)', cleared === 0, `outline ${cleared}`);
  await click(H.clearAll, 700);
  const nAfter = await js(`import('./core/state.js').then((m) => (m.P.brickSettings.heights || []).length)`);
  checkRow('select', 'Heights: clear all removes the records', nAfter === 0, `${nAfter} record(s)`);
  if (await editorOpen()) { await apply(); await heightsSettled(null); }
}
