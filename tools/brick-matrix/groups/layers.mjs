// Brick matrix group 'layers': bricks on layers.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { CLEAR_MENU } from './clear.mjs';

// ---- bricks on layers (F35 item 22 slice 3, seat 37 fb-app bb9e664): Wall / Frame / Brush land on the ACTIVE layer
// beside art (a fresh board gets no Bricks layer); a brick element moves with "Move to layer"; a layer's carve covers
// its bricks; Clear Bricks / Clear Artwork split by node, not by layer. 37's seven rows (run.mjs runBrickLayers).
export const BRICK_LAYERS = {
  addLayer: 'editorAddLayer', wallTool: 'brickTool_wall', selectTool: 'toolSelect',
  menuMove: 'Move to layer', menuNewLayer: 'New layer…', // the context menu's own labels (editor-context-menu.js)
  carveButton: '.layer-carve', framePreset: 'brickFramePreset_none', // a frame change that always leaves a wall
  artworkTab: 'editorTabArtwork',
  clears: CLEAR_MENU.options.filter((o) => o.item === 'editorClear_bricks' || o.item === 'editorClear_artwork'),
  stroke: [[0.3, 0.5], [0.5, 0.56], [0.7, 0.5]],
  introducedBy: 'bb9e664',
  // F35 item 40 (Fred: "We don't see layers still"): the Brick tab hosts the ONE Layers list in its own panel
  // (slot), with a tool picked too; a row picked there is where the next lay goes; Artwork gets the list back
  brickTab: { slot: 'brickLayersSlot', list: 'editorLayersList', wallTool: 'brickTool_wall', generate: 'brickGenerate', artworkTab: 'editorTabArtwork' },
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, record, waitApp, seedClearBoard, checkRow, openEditorTab, reloadWithStorage, key, drag;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, record, waitApp, seedClearBoard, checkRow, openEditorTab, reloadWithStorage, key, drag } = ctx); }
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
// The context menu acts on the SELECTION (editor-context-menu.js bindContextMenu): pick the brick with the Artwork
// Select tool, then right-click it.
async function rightClickBrick(kind) {
  await click(BRICK_LAYERS.artworkTab, 800); await click(BRICK_LAYERS.selectTool, 500);
  // F35 item 64: bricks sit on their kind's own layer, usually NOT the active one, and an inactive layer takes no art-tool
  // pointer events (.inactive-layer) -- so, like a user, activate the brick's layer first (its row in the Layers list)
  await js(`(()=>{ const n=window.svgEditor._sketchLayer.node.querySelector('[data-brick="${kind}"]'); const id=n&&n.getAttribute('data-layer'); const row=id&&document.querySelector('#editorLayersList [data-layer-id="'+id+'"]'); if(row) row.click(); return !!row; })()`);
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
async function layerButton(layerId, cls) {
  await click(BRICK_LAYERS.artworkTab, 600); // the layer list
  return js(`(()=>{ const rs=[...document.querySelectorAll('.layer-row[data-layer-id="${layerId}"]')]; const r=rs.find((e)=>e.offsetParent!==null)||rs[0]; if(!r) return 'no row'; const b=${cls ? `r.querySelector(${JSON.stringify(cls)})` : 'r'}; if(!b) return 'no button'; b.click(); return 'ok'; })()`);
}

async function runBrickLayers() {
  const B = BRICK_LAYERS;
  await reloadWithStorage({}); // a FRESH board (no saved session): slice 3's contract is about new boards
  await openEditorTab('editorTabBrick');
  // slice 3's own marker: layers.js isBrickToolNode (a build before it has the layer UI but a Bricks layer)
  if (!(await js(`import('./editor/layers.js').then((L) => !!L.isBrickToolNode)`))) { checkRow('layers', 'Fresh board: bricks on the active layer', false, '', B.introducedBy); return; }
  const s0 = await layersRead();
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
  await openEditorTab('editorTabBrick');
  // 3. a frame change re-lays the wall ON its new layer
  const s3a = await layersRead();
  await click('brickTool_frame', 800); await click(B.framePreset, 2500);
  const s3 = await layersRead();
  checkRow('layers', 'A frame change re-lays the wall on its own layer', s3.wallPolys !== s3a.wallPolys && s3.wall.join() === s3a.wall.join() && s3.wallN > 0,
    `wall re-laid ${s3.wallPolys !== s3a.wallPolys}, on ${s3a.wall} -> ${s3.wall}`);
  // 4. that layer's carve off moves the 3D; on again -> the 3D exactly as before
  const wallLayer = s3.wall[0];
  await apply(); const Z0 = await heightsSettled(null);
  await openEditorTab('editorTabBrick');
  const c1 = await layerButton(wallLayer, B.carveButton); await apply(); const Z1 = await heightsSettled(Z0);
  await openEditorTab('editorTabBrick');
  const c2 = await layerButton(wallLayer, B.carveButton); await apply(); const Z2 = await heightsSettled(Z1);
  checkRow('layers', 'The wall layer carve off -> 3D changes; on -> 3D identical', c1 === 'ok' && c2 === 'ok' && Z1 !== Z0 && Z2 === Z0,
    `carve toggles ${c1}/${c2}; 3D ${Z0} -> off ${Z1} -> on ${Z2}`);
  // 5. save + reload: the same layer per kind, carve kept, nothing re-laid
  await openEditorTab('editorTabBrick');
  await layerButton(wallLayer, B.carveButton); // carve OFF for the round trip
  await apply(); await heightsSettled(null);
  const s5a = await layersRead();
  await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const s5 = await layersRead();
  const carveOf = (s, id) => (s.layers.find((l) => l.id === id) || {}).carve;
  checkRow('layers', 'Save + reload: layers per kind, carve, nothing re-laid',
    s5.wall.join() === s5a.wall.join() && s5.frame.join() === s5a.frame.join() && carveOf(s5, wallLayer) === false && s5.wallPolys === s5a.wallPolys,
    `wall ${s5a.wall} -> ${s5.wall}, frame ${s5a.frame} -> ${s5.frame}, wall-layer carve ${carveOf(s5, wallLayer)}, wall ${s5.wallPolys === s5a.wallPolys ? 'identical' : 'RE-LAID'}`);
  await layerButton(wallLayer, B.carveButton); await apply(); await heightsSettled(null); // carve back on
  // 6. Clear -> Bricks takes every brick and leaves the art on the same layer; Clear -> Artwork leaves a brick layer
  for (const o of B.clears) {
    await reloadWithStorage({}); // the defaults, not the rows above's frame preset
    const f0 = await seedClearBoard();
    const sa = await layersRead();
    await click(o.tab, 800); await click(CLEAR_MENU.button, 600); await click(o.item, 1500); await sleep(2500);
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
  await openEditorTab('editorTabBrick');
  await click(B.addLayer, 900);
  const s7a = await layersRead();
  const layer2 = s7a.active;
  await click('brickTool_brush', 900);
  await drag(B.stroke); await sleep(1500);
  const s7 = await layersRead();
  const brushId = (s7.layers.find((l) => l.brickKind === 'brush') || {}).id;
  checkRow('layers', 'A Brush stroke goes on the Brush kind layer (item 64), spine and bricks',
    s7.brushN > 0 && !!brushId && brushId !== layer2 && s7.brush.length === 1 && s7.brush[0] === brushId && s7.spine.length === 1 && s7.spine[0] === brushId && s7a.layers.length >= 2,
    `active ${layer2} of ${s7a.layers.length} layers; Brush layer ${brushId}; bricks (${s7.brushN}) on ${s7.brush}, spine on ${s7.spine}`);
  const layer1 = s7a.layers.find((l) => l.id !== layer2);
  let m7 = 'no brush piece under the pointer';
  if (layer1 && await rightClickBrick('brush')) { const a = await menuRow(B.menuMove); await sleep(400); const b = await menuRow(layer1.name); await sleep(1500); m7 = `menu ${a}/${b}`; }
  const s7b = await layersRead();
  checkRow('layers', 'Move one brush piece to Layer 1: its spine and every piece follow',
    !!layer1 && s7b.brushN === s7.brushN && s7b.brush.join() === layer1.id && s7b.spine.join() === layer1.id,
    `${m7}; bricks (${s7b.brushN}) on ${s7b.brush}, spine on ${s7b.spine} (Layer 1 = ${layer1 ? layer1.id : 'none'})`);
  if (await editorOpen()) await apply();
  // 8. F35 item 40: the Brick tab shows the layers (hosted in its panel) with the Wall tool picked; a row picked there
  // is where the lay goes; Artwork gets the ONE list back
  const T = B.brickTab;
  if (!(await exists(T.slot)) && !(await js(`fetch('./bspline_gen_palette.html').then(r=>r.text()).then(t=>t.includes('id="${T.slot}"'))`))) {
    checkRow('layers', 'Brick tab: the layers show with a tool, a picked row takes the lay', false, '', 'F35 item 40'); return;
  }
  await reloadWithStorage({});
  await openEditorTab(B.artworkTab); await click(B.addLayer, 900);
  await openEditorTab('editorTabBrick'); await click(T.wallTool, 900);
  const vis = await jsJSON(`JSON.stringify((()=>{ const l=document.getElementById(${JSON.stringify(T.list)}); const slot=document.getElementById(${JSON.stringify(T.slot)});
    const rows=[...l.querySelectorAll('[data-layer-id]')]; const r=l.getBoundingClientRect();
    return { hosted: !!slot && slot.contains(l), shown: l.offsetParent !== null && r.height > 0, rows: rows.map((e)=>e.getAttribute('data-layer-id')), active: String(window.svgEditor._activeLayer) }; })())`);
  const pick = vis.rows.find((id) => id !== vis.active);
  if (pick) { await js(`document.querySelector('#${T.list} [data-layer-id="${pick}"]').click()`); await sleep(600); }
  await click(T.generate, 2000);
  const on = await jsJSON(`JSON.stringify([...new Set([...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n)=>n.getAttribute('data-layer')))])`);
  await openEditorTab(B.artworkTab);
  const home = await js(`!document.getElementById(${JSON.stringify(T.slot)}).contains(document.getElementById(${JSON.stringify(T.list)})) && !!document.getElementById(${JSON.stringify(T.list)}).offsetParent`);
  // item 64: a picked row is the ACTIVE layer, but a NEW wall goes on its own "Wall" kind layer, not the picked one
  const wallKind = (await layersRead()).layers.find((l) => l.brickKind === 'wall');
  checkRow('layers', 'Brick tab: the layers show with a tool; a new wall goes on the Wall layer, not the picked row',
    vis.hosted && vis.shown && vis.rows.length >= 2 && !!pick && !!wallKind && on.length === 1 && on[0] === wallKind.id && wallKind.id !== pick && home,
    `hosted ${vis.hosted}, shown ${vis.shown}, rows ${vis.rows.length}; picked ${pick}: wall on ${on} (Wall = ${wallKind ? wallKind.id : 'none'}); Artwork has the list back ${home}`);
  if (await editorOpen()) await apply();
}
