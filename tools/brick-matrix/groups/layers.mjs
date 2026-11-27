// Brick matrix group 'layers': bricks on layers.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { CLEAR_MENU } from './clear.mjs';

// ---- bricks on layers (F35 item 22 slice 3, seat 37 fb-app bb9e664): Wall / Frame / Brush land on the ACTIVE layer
// beside art (a fresh board gets no Bricks layer); a brick element moves with "Move to layer"; a layer's carve covers
// its bricks; Clear Bricks / Clear Artwork split by node, not by layer. 37's seven rows (run.mjs runBrickLayers).
export const BRICK_LAYERS = {
  // the editor layer stack (Fred 2026-11-24): '+ Add layer' > Draw adds a layer; a row's ⋯ menu holds the old row's carve
  addChip: 'editorLayerStackAddBtn', addDraw: 'editorLayerStackAdd_draw', wallTool: 'brickTool_wall', selectTool: 'toolSelect',
  menuMove: 'Move to layer', menuNewLayer: 'New layer…', // the context menu's own labels (editor-context-menu.js)
  carveItem: 'Stamp into the surface (3D)', framePreset: 'brickFramePreset_none', // a frame change that always leaves a wall
  artworkTab: 'row:draw',
  clears: CLEAR_MENU.options.filter((o) => o.item === 'editorClear_bricks' || o.item === 'editorClear_artwork'),
  stroke: [[0.3, 0.5], [0.5, 0.56], [0.7, 0.5]],
  introducedBy: 'bb9e664',
  // F35 item 40 (Fred: "We don't see layers still"), since the editor layer stack (2026-11-24): the stack lists every layer
  // ABOVE the Brick panel, with a tool picked too; a new wall still goes on its own Wall layer, whichever layer is active
  brickTab: { stack: 'editorLayerStackList', wallTool: 'brickTool_wall', generate: 'brickGenerate' },
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, record, waitApp, seedClearBoard, checkRow, openEditorTab, reloadWithStorage, key, drag, go, realTap, pickLayerRow;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, record, waitApp, seedClearBoard, checkRow, openEditorTab, reloadWithStorage, key, drag, go, realTap, pickLayerRow } = ctx); }
export async function run() { await runBrickLayers(); }

// ---------------------------------------------------------------- bricks on layers (BRICK_LAYERS above)
// F35 item 22 slice 3 (37, fb-app bb9e664): Wall / Frame / Brush land on the ACTIVE layer beside art; a fresh board
// gets no Bricks layer. Read the app's own contract: brick nodes = layers.js isBrickToolNode, never a layer's name.
function layersState() {
  return `(async()=>{ const L = await import('./editor/layers.js'); const ed = window.svgEditor; const n = ed._sketchLayer.node;
    const all = (sel) => [...n.querySelectorAll(sel)];
    const ids = (sel) => [...new Set(all(sel).map((e) => String(e.getAttribute('data-layer'))))];
    const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
    const polys = (sel) => h(all(sel).map((e) => e.getAttribute('points') || e.getAttribute('d') || '').sort().join('|'));
    const art = [...n.children].filter((e) => !L.isBrickToolNode(e) && !e.hasAttribute('data-brick-record'));
    return JSON.stringify({ active: String(ed._activeLayer), layers: (ed._layers || []).map((l) => ({ id: String(l.id), name: l.name, carve: l.carve !== false, holdsBricks: !!l.holdsBricks, brickKind: l.brickKind || null })),
      wall: ids('[data-brick="wall"]'), wallN: all('[data-brick="wall"]').length, wallPolys: polys('[data-brick="wall"]'),
      frame: ids('[data-brick="frame"]'), frameN: all('[data-brick="frame"]').length,
      record: ids('[data-brick-record="wall-full"]'),
      brush: ids('[data-brick="brush"]'), brushN: all('[data-brick="brush"]').length, spine: ids('[data-brick="brush-spine"]'),
      artN: art.length, artLayers: [...new Set(art.map((e) => String(e.getAttribute('data-layer'))))],
      undo: (ed._history || ed._undoStack || []).length }); })()`;
}
async function layersRead() {
  // the editor must exist before the probe reads it (under --parallel load a reload can leave it booting: measured on the
  // grey-sets gate, "Cannot read properties of undefined (reading '_sketchLayer')", 8 of 10 rows reported)
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  return jsJSON(layersState());
}
// The context menu acts on the SELECTION (editor-context-menu.js bindContextMenu): pick the brick with plain Select IN
// THE BRICK TAB, then right-click it. Fred 2026-10-10 (EDITOR_TAB_SELECTABLE): a brick is selected only in the Brick
// tab -- this used to pick it with the Artwork tab's Select tool, which the rule now refuses. Esc is the user's way back
// to plain Select in any tab (global-events.js returnToSelect).
async function rightClickBrick(kind) {
  await openEditorTab('row:brick');
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(500);
  // F35 item 64: bricks sit on their kind's own layer, usually NOT the active one, and an inactive layer takes no art-tool
  // pointer events (.inactive-layer) -- so, like a user, activate the brick's layer first (its row in the Layers list)
  const brickLayer = await js(`(()=>{ const n=window.svgEditor._sketchLayer.node.querySelector('[data-brick="${kind}"]'); return n ? n.getAttribute('data-layer') : ''; })()`);
  if (brickLayer) await pickLayerById(brickLayer); // its row in the editor layer stack (a Brick part: a sub-row of Bricks)
  await sleep(400);
  const at = await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="${kind}"]')];
    for (const n of ns) { const r=n.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2; if (document.elementFromPoint(x,y)===n) return {x,y}; } return null; })())`);
  if (!at) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'right', buttons: 2, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(700);
  return true;
}
async function menuRow(label) {
  return js(`(()=>{ const b=[...document.querySelectorAll('.context-menu-popover .context-menu-row')].find((r)=>(r.querySelector('.context-menu-row-label')?.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return 'missing'; b.click(); return 'ok'; })()`);
}
// ---- the editor layer stack (Fred 2026-11-24): a layer is reached by ITS row -- a Brick part is a sub-row of the Bricks row,
// folded open by its caret first -- and its old row buttons (carve, ...) are its ⋯ menu's items; all with REAL input
const layerRowId = (layerId) => js(`(()=>{ const k=${JSON.stringify(String(layerId))}.replace(/[^A-Za-z0-9_-]/g, '_');
  const own=document.getElementById('edStackRow_layer_' + k); if (own) return own.id; const sub=document.getElementById('edStackRow_bricks__' + k); return sub ? sub.id : ''; })()`);
async function openSubRows(rowId) {
  const caret = await js(`(()=>{ const r=document.getElementById(${JSON.stringify(rowId)}); const card=r && r.closest('.ed-stack-card');
    if (!card || !r.closest('.ed-stack-subs') || card.classList.contains('subs-open')) return ''; const c=card.querySelector('[data-ed-caret]'); if (!c) return ''; c.id=c.id || '__mxCaret'; return c.id; })()`);
  if (caret) { await realTap(caret); await sleep(300); }
}
async function pickLayerById(layerId) {
  if (!(await editorOpen())) await click('viewMode_2d', 2500);
  const id = await layerRowId(layerId);
  if (!id) return 'no row';
  await openSubRows(id);
  const r = await realTap(id); await sleep(500);
  return r;
}
async function layerMenu(layerId, label) {
  if (!(await editorOpen())) await click('viewMode_2d', 2500);
  const id = await layerRowId(layerId);
  if (!id) return 'no row';
  await openSubRows(id);
  const a = await realTap(`edStackMenu_${id.slice('edStackRow_'.length)}`); await sleep(600);
  if (a !== 'ok') return `menu ${a}`;
  const item = await js(`(()=>{ const b=[...document.querySelectorAll('.context-menu-popover .context-menu-row')].find((r)=>(r.querySelector('.context-menu-row-label')?.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return ''; b.id='__mxMenuRow'; return b.id; })()`);
  if (!item) return 'no item';
  const r = await realTap(item); await sleep(600);
  return r;
}
/** '+ Add layer' > Draw, with real input: a new drawing layer, the active one (its row selected: the Draw tools). */
async function addDrawLayer() {
  const a = await realTap(BRICK_LAYERS.addChip); await sleep(500);
  const b = await realTap(BRICK_LAYERS.addDraw); await sleep(1500);
  return a === 'ok' && b === 'ok' ? 'ok' : `add ${a}/${b}`;
}

// the layer stack: a fresh board has NO layer now (it had an empty, active "Layer 1"). Rows 7 + 8 need a drawing layer next
// to the one they add (a second one to pick / move to): set up through the app's own addLayer (a Brick part -- the Wall the
// Bricks row added -- is not one); the checks are unchanged.
const ensureLayer1 = () => js(`import('./editor/layers.js').then((L) => { const ed = window.svgEditor; if (!ed._layers.some((l) => !l.brickKind)) L.setActiveLayer(ed, L.addLayer(ed, { skipUndo: true }).id); return ed._layers.length; })`);

async function runBrickLayers() {
  const B = BRICK_LAYERS;
  await reloadWithStorage({}); // a FRESH board (no saved session): slice 3's contract is about new boards
  if (!(await editorOpen())) await click('viewMode_2d', 2500);
  // slice 3's own marker: layers.js isBrickToolNode (a build before it has the layer UI but a Bricks layer)
  if (!(await js(`import('./editor/layers.js').then((L) => !!L.isBrickToolNode)`))) { checkRow('layers', 'Fresh board: bricks on the active layer', false, '', B.introducedBy); return; }
  // read BEFORE the Bricks row is added: a fresh board reaches the Brick tools by '+ Add layer' > Brick (the Wall's layer)
  const s0 = await layersRead();
  await openEditorTab('row:brick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 800); await click('brickGenerate', 2000);
  // 1. F35 item 64 (supersedes slice 3's "on the active layer"): a fresh board: Wall + Frame each land on their KIND's
  // own layer, created on first use ("Wall", "Frame"); the active layer is untouched; no legacy holdsBricks layer
  const s1 = await layersRead();
  const kindId = (st, kind) => (st.layers.find((l) => l.brickKind === kind) || {}).id;
  checkRow('layers', 'Fresh board: Wall + Frame each on their own kind layer (item 64)',
    s1.wallN > 0 && s1.frameN > 0 && s1.wall.length === 1 && s1.wall[0] === kindId(s1, 'wall') && s1.frame.length === 1 && s1.frame[0] === kindId(s1, 'frame')
      && s1.layers.length === s0.layers.length + 2 && s1.active === s0.active && !s1.layers.some((l) => l.holdsBricks),
    `active ${s0.active} -> ${s1.active}; wall on ${s1.wall} (Wall = ${kindId(s1, 'wall')}), frame on ${s1.frame} (Frame = ${kindId(s1, 'frame')}); layers ${s0.layers.length} -> ${s1.layers.length}`);
  // 2. Move to layer -> New layer...: the whole wall + its record move, the frame stays; one undo step brings it back
  let moved = false, detail = '';
  if (await rightClickBrick('wall')) {
    const a = await menuRow(B.menuMove); await sleep(500);
    const b = await menuRow(B.menuNewLayer); await sleep(1500);
    detail = `menu: ${a}/${b}`;
    moved = a === 'ok' && b === 'ok';
  } else detail = 'no wall brick under the pointer';
  const s2 = await layersRead();
  const newLayer = s2.layers.find((l) => !s1.layers.some((o) => o.id === l.id));
  const movedOk = moved && !!newLayer && s2.wall.length === 1 && s2.wall[0] === newLayer.id && s2.record.length === 1 && s2.record[0] === newLayer.id && s2.frame.join() === s1.frame.join() && s2.wallN === s1.wallN;
  checkRow('layers', 'Move to layer -> New layer: the wall + its record move, the frame stays',
    movedOk, `${detail}; new layer ${newLayer ? newLayer.id : 'NONE'}; wall on ${s2.wall} (${s2.wallN}), record on ${s2.record}, frame on ${s2.frame}`);
  if (movedOk) {
    await key('z'); await sleep(1200);
    const su = await layersRead();
    checkRow('layers', 'Move to layer: one undo puts the wall back', su.wall.join() === s1.wall.join() && su.record.join() === s1.wall.join(),
      `after one undo: wall on ${su.wall}, record on ${su.record}`);
    await key('y'); await sleep(1200); // redo: the wall on its new layer again, for the rows below
    const sr = await layersRead();
    if (sr.wall.join() !== s2.wall.join()) { await rightClickBrick('wall'); await menuRow(B.menuMove); await sleep(400); await menuRow(newLayer.name); await sleep(1500); }
  }
  await openEditorTab('row:brick');
  // 3. a frame change re-lays the wall ON its new layer
  const s3a = await layersRead();
  await click('brickTool_frame', 800); await click(B.framePreset, 2500);
  const s3 = await layersRead();
  checkRow('layers', 'A frame change re-lays the wall on its own layer', s3.wallPolys !== s3a.wallPolys && s3.wall.join() === s3a.wall.join() && s3.wallN > 0,
    `wall re-laid ${s3.wallPolys !== s3a.wallPolys}, on ${s3a.wall} -> ${s3.wall}`);
  // 4. that layer's carve off moves the 3D; on again -> the 3D exactly as before
  const wallLayer = s3.wall[0];
  await apply(); const Z0 = await heightsSettled(null);
  await openEditorTab('row:brick');
  const c1 = await layerMenu(wallLayer, B.carveItem); await apply(); const Z1 = await heightsSettled(Z0);
  await openEditorTab('row:brick');
  const c2 = await layerMenu(wallLayer, B.carveItem); await apply(); const Z2 = await heightsSettled(Z1);
  checkRow('layers', 'The wall layer carve off -> 3D changes; on -> 3D identical', c1 === 'ok' && c2 === 'ok' && Z1 !== Z0 && Z2 === Z0,
    `carve toggles ${c1}/${c2}; 3D ${Z0} -> off ${Z1} -> on ${Z2}`);
  // 5. save + reload: the same layer per kind, carve kept, nothing re-laid
  await openEditorTab('row:brick');
  await layerMenu(wallLayer, B.carveItem); // carve OFF for the round trip
  await apply(); await heightsSettled(null);
  const s5a = await layersRead();
  await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  if (!(await editorOpen())) await click('viewMode_2d', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const s5 = await layersRead();
  const carveOf = (s, id) => (s.layers.find((l) => l.id === id) || {}).carve;
  checkRow('layers', 'Save + reload: layers per kind, carve, nothing re-laid',
    s5.wall.join() === s5a.wall.join() && s5.frame.join() === s5a.frame.join() && carveOf(s5, wallLayer) === false && s5.wallPolys === s5a.wallPolys,
    `wall ${s5a.wall} -> ${s5.wall}, frame ${s5a.frame} -> ${s5.frame}, wall-layer carve ${carveOf(s5, wallLayer)}, wall ${s5.wallPolys === s5a.wallPolys ? 'identical' : 'RE-LAID'}`);
  await layerMenu(wallLayer, B.carveItem); await apply(); await heightsSettled(null); // carve back on
  // 6. Clear -> Bricks takes every brick and leaves the art on the same layer; Clear -> Artwork leaves a brick layer
  for (const o of B.clears) {
    await reloadWithStorage({}); // the defaults, not the rows above's frame preset
    const f0 = await seedClearBoard();
    const sa = await layersRead();
    await go(o.tab, 800); await click(CLEAR_MENU.button, 600); await click(o.item, 1500); await sleep(2500);
    const sb = await layersRead();
    if (o.item === 'editorClear_bricks') {
      const shared = sa.artLayers.some((id) => sa.wall.includes(id));
      // item 64: the wall sits on its own kind layer, so art and bricks no longer share a layer by default (shared is reported)
      checkRow('layers', 'Clear Bricks: every brick goes, the art on its layer stays', sa.wallN > 0 && sb.wallN === 0 && sb.frameN === 0 && sb.brushN === 0 && sb.artN === sa.artN,
        `art on ${sa.artLayers}, wall on ${sa.wall} (shared ${shared}); bricks ${sa.wallN + sa.frameN} -> ${sb.wallN + sb.frameN + sb.brushN}; art ${sa.artN} -> ${sb.artN}`);
    } else {
      const kept = sa.wall.every((id) => sb.layers.some((l) => l.id === id));
      checkRow('layers', 'Clear Artwork: a layer holding bricks stays, with its bricks', kept && sa.wallN > 0 && sb.wallN === sa.wallN && sb.wall.join() === sa.wall.join() && sb.artN === 0,
        `wall layer kept ${kept}; wall ${sa.wallN} -> ${sb.wallN} on ${sb.wall}; art ${sa.artN} -> ${sb.artN}`);
    }
    void f0;
  }
  // 7. F35 item 64: a Brush stroke with Layer 2 active goes on the "Brush" kind layer (was: the active Layer 2), spine and
  // bricks; moving one brick moves the spine and every piece
  await reloadWithStorage({});
  await openEditorTab('row:brick');
  await ensureLayer1();
  await addDrawLayer(); // the second drawing layer, the active one
  const s7a = await layersRead();
  const layer2 = s7a.active;
  await openEditorTab('row:brick'); // the Bricks row: its tools (the active layer stays)
  await click('brickTool_brush', 900);
  await drag(B.stroke); await sleep(1500);
  const s7 = await layersRead();
  const brushId = (s7.layers.find((l) => l.brickKind === 'brush') || {}).id;
  checkRow('layers', 'A Brush stroke goes on the Brush kind layer (item 64), spine and bricks',
    s7.brushN > 0 && !!brushId && brushId !== layer2 && s7.brush.length === 1 && s7.brush[0] === brushId && s7.spine.length === 1 && s7.spine[0] === brushId && s7a.layers.length >= 2,
    `active ${layer2} of ${s7a.layers.length} layers; Brush layer ${brushId}; bricks (${s7.brushN}) on ${s7.brush}, spine on ${s7.spine}`);
  const layer1 = s7a.layers.find((l) => l.id !== layer2 && !l.brickKind);
  let m7 = 'no brush piece under the pointer';
  if (layer1 && await rightClickBrick('brush')) { const a = await menuRow(B.menuMove); await sleep(400); const b = await menuRow(layer1.name); await sleep(1500); m7 = `menu ${a}/${b}`; }
  const s7b = await layersRead();
  checkRow('layers', 'Move one brush piece to Layer 1: its spine and every piece follow',
    !!layer1 && s7b.brushN === s7.brushN && s7b.brush.join() === layer1.id && s7b.spine.join() === layer1.id,
    `${m7}; bricks (${s7b.brushN}) on ${s7b.brush}, spine on ${s7b.spine} (Layer 1 = ${layer1 ? layer1.id : 'none'})`);
  if (await editorOpen()) await apply();
  // 8. F35 item 40, since the editor layer stack: with a tool picked, the stack lists the layers ABOVE the Brick panel;
  // a drawing layer picked (the active one), then the Bricks row: a new wall still goes on its own Wall layer
  const T = B.brickTab;
  if (!(await js(`fetch('./bspline_gen_palette.html').then(r=>r.text()).then(t=>t.includes('id="${T.stack}"'))`))) {
    checkRow('layers', 'Brick tab: the layers show with a tool, a picked row takes the lay', false, '', 'F35 item 40'); return;
  }
  await reloadWithStorage({});
  await openEditorTab(B.artworkTab); await ensureLayer1(); await addDrawLayer();
  const pick = String(await js('String(window.svgEditor._activeLayer)'));
  await openEditorTab('row:brick'); await click(T.wallTool, 900);
  const vis = await jsJSON(`JSON.stringify((()=>{ const l=document.getElementById(${JSON.stringify(T.stack)}); const r=l.getBoundingClientRect(); const panel=document.getElementById('editorBrickPanel');
    const rows=[...l.querySelectorAll('[data-ed-select]')].map((e)=>e.id); const sel=document.querySelector('#${T.stack} > [data-stack-key="bricks"]');
    return { above: !!panel && panel.offsetParent !== null && r.bottom <= panel.getBoundingClientRect().top + 1, shown: l.offsetParent !== null && r.height > 0, rows: rows.length,
      bricksSelected: !!sel && sel.classList.contains('is-selected'), active: String(window.svgEditor._activeLayer) }; })())`);
  await click(T.generate, 2000);
  const on = await jsJSON(`JSON.stringify([...new Set([...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n)=>n.getAttribute('data-layer')))])`);
  const wallKind = (await layersRead()).layers.find((l) => l.brickKind === 'wall');
  checkRow('layers', 'Brick tab: the layers show with a tool; a new wall goes on the Wall layer, not the picked row',
    vis.above && vis.shown && vis.rows >= 3 && vis.bricksSelected && vis.active === pick && !!wallKind && on.length === 1 && on[0] === wallKind.id && wallKind.id !== pick,
    `stack above the Brick panel ${vis.above}, shown ${vis.shown}, rows ${vis.rows}, Bricks selected ${vis.bricksSelected}; active ${vis.active} (picked ${pick}): wall on ${on} (Wall = ${wallKind ? wallKind.id : 'none'})`);
  if (await editorOpen()) await apply();
  // 9. Fred 2026-11-27 (draw cant be deleted ... can we open with none?): a fresh board's stack has NO Draw row; a lone Draw layer
  // added by hand offers Delete in its menu, and deleting it leaves no layer (nothing re-creates one)
  await reloadWithStorage({});
  if (!(await editorOpen())) await click('viewMode_2d', 2500);
  const drawRows = () => js(`document.querySelectorAll('[id^="edStackRow_layer_"]').length`);
  const fresh = await drawRows();
  await addDrawLayer();
  const lone = (await layersRead()).layers.filter((l) => !l.brickKind);
  const loneId = lone.length === 1 ? lone[0].id : '';
  const del = loneId ? await layerMenu(loneId, 'Delete') : 'no lone layer';
  await sleep(600);
  const after = await layersRead();
  checkRow('layers', 'Draw layer: a fresh board has none; the only one can be deleted, leaving none',
    fresh === 0 && !!loneId && del === 'ok' && after.layers.length === 0 && (await drawRows()) === 0,
    `fresh Draw rows ${fresh}; lone layer ${loneId || 'none'}; Delete tap ${del}; layers after ${after.layers.length}`);
}
