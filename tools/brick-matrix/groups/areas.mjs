// Brick matrix group 'areas': wall areas (the Area brush).
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLEAR_MENU } from './clear.mjs';

// ---- wall areas (F35 item 22 slice 2, seat 37 fb-app 58be3ed, on T86 18b/18c): the Area brush paints walls of whole
// bricks, newest first. 37's measured scenario on T1 7x9 (wall + Soldier frame); points in board inches.
export const WALL_AREAS = {
  template: 'template_1', areaTool: 'brickSubTool_wall_area', selectTool: 'brickSubTool_wall_select', clearAreas: 'brickWallAreasClear',
  wallLabel: { id: 'brickElementLabel_wall', text: 'Editing: this Wall' },
  strokes: [
    { pattern: 'brickPattern_stretcher', width: 'brickWallAreaWidth_2', points: [[2.2, 2.4], [4.6, 5.0]] },
    { pattern: 'brickPattern_herringbone', width: 'brickWallAreaWidth_2', points: [[4.8, 2.4], [2.2, 5.2]] },
    { pattern: 'brickPattern_stack', width: 'brickWallAreaWidth_1', points: [[3.5, 6.4], [3.5, 8.9]] },
  ],
  introducedBy: '58be3ed',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let ROOT, sleep, send, js, jsJSON, click, CANVAS, heightsSettled, canvasSettled, editorOpen, apply, record, checkRow, wallCount, openEditorTab, reloadWithStorage, key;
export function bind(ctx) { ({ ROOT, sleep, send, js, jsJSON, click, CANVAS, heightsSettled, canvasSettled, editorOpen, apply, record, checkRow, wallCount, openEditorTab, reloadWithStorage, key } = ctx); }
export async function run() { await runWallAreas(); }

// F35 item 22 slice 2 (37, fb-app 58be3ed) on T86 18b/18c: the Area brush paints wall areas of COMPLETE bricks,
// newest first (an older area drops the bricks that would touch a newer one). The sketch layer's units are board
// inches (the brush's own stroke width is widthIn), so a board point maps to the screen by the layer's own CTM.
async function dragIn(ptsIn) {
  const ps = await jsJSON(`JSON.stringify((()=>{ const m=window.svgEditor._sketchLayer.node.getScreenCTM(); return ${JSON.stringify(ptsIn)}.map(([x,y])=>({ x: m.a*x + m.c*y + m.e, y: m.b*x + m.d*y + m.f })); })())`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[0].x, y: ps[0].y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ps[0].x, y: ps[0].y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i < ps.length; i++) for (let k = 1; k <= 12; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[i - 1].x + (ps[i].x - ps[i - 1].x) * k / 12, y: ps[i - 1].y + (ps[i].y - ps[i - 1].y) * k / 12, button: 'left', buttons: 1 });
    await sleep(15);
  }
  const z = ps[ps.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
}
/** the areas (records in order) and their bricks, in board inches */
function areasState() {
  return `JSON.stringify((()=>{ const n=window.svgEditor._sketchLayer.node;
    const poly=(e)=>(e.getAttribute('points')||'').trim().split(/\\s+/).map((p)=>p.split(',').map(Number)).map(([x,y])=>({x,y}));
    const recs=[...n.querySelectorAll('[data-brick-record="wall-area"]')].map((r)=>r.getAttribute('data-brick-element'));
    const owned=(id)=>[...n.querySelectorAll('[data-brick="wall"]')].filter((e)=>e.getAttribute('data-brick-owner')===id).map(poly);
    return { areas: recs, full: n.querySelectorAll('[data-brick-record="wall-full"]').length, wall: n.querySelectorAll('[data-brick="wall"]').length,
      bricks: Object.fromEntries(recs.map((id)=>[id, owned(id)])), frame: [...n.querySelectorAll('[data-brick="frame"]')].map(poly) }; })())`;
}
async function overlapPairs(a, b, tol) {
  const G = await import(pathToFileURL(path.join(ROOT, 'b-spline-gen/html/core/bricks/geometry.js')).href);
  let pairs = 0;
  for (const p of a) for (const q of b) if (Math.abs(G.signedArea(G.polygonIntersection(p, q))) > tol) pairs++;
  return pairs;
}

async function runWallAreas() {
  const A = WALL_AREAS;
  await reloadWithStorage({});
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(A.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900); await click('brickGenerate', 2000);
  await click('brickTool_wall', 900);
  // slice 2's own marker (the Area brush handler): main already carries the hidden Area button, so its presence is no guard
  if (!(await js(`import('./editor/editor-brick-tool.js').then((m) => !!m.brickWallAreaHandler)`))) { checkRow('areas', 'Area paints a wall of whole bricks', false, '', A.introducedBy); return; }
  const wall0 = await wallCount(), canvas0 = await js(CANVAS);
  const paint = async (pattern, width, stroke) => {
    await click('brickTool_wall', 700); // a tool pick clears the element selection: the next stroke starts a NEW area
    await click(pattern, 1500); await click(A.areaTool, 700); await click(width, 500);
    await dragIn(stroke);
    return jsJSON(areasState());
  };
  // 1. a stroke paints a wall area: one area record, the full wall's record gone, the area's own bricks
  const s1 = await paint(A.strokes[0].pattern, A.strokes[0].width, A.strokes[0].points);
  const a = s1.areas[0];
  checkRow('areas', 'Area paints a wall (one area, no full wall)', s1.areas.length === 1 && s1.full === 0 && (s1.bricks[a] || []).length > 0,
    `${s1.areas.length} area(s), full-wall records ${s1.full}, area bricks ${(s1.bricks[a] || []).length}`);
  // 2. a newer area with another pattern: the older one keeps whole bricks around it, no pair overlaps
  const s2 = await paint(A.strokes[1].pattern, A.strokes[1].width, A.strokes[1].points);
  const b = s2.areas.find((id) => id !== a);
  const ov = b ? await overlapPairs(s2.bricks[a] || [], s2.bricks[b] || [], 1e-4) : -1;
  checkRow('areas', 'Newest wins: the older area flows round, no overlap', s2.areas.length === 2 && !!b && ov === 0 && (s2.bricks[a] || []).length > 0 && (s2.bricks[b] || []).length > 0,
    `${s2.areas.length} areas; older ${(s2.bricks[a] || []).length} bricks, newer ${b ? (s2.bricks[b] || []).length : 0}; overlapping pairs ${ov}`);
  // 3. one undo step per stroke
  await key('z'); await sleep(1500);
  const u = await jsJSON(areasState());
  await key('y'); await sleep(1500);
  const r = await jsJSON(areasState());
  checkRow('areas', 'Undo / Redo: one step per stroke', u.areas.length === 1 && r.areas.length === 2, `after undo ${u.areas.length} area(s), after redo ${r.areas.length}`);
  // 4. an area across the frame band: its bricks stop at the band
  const s4 = await paint(A.strokes[2].pattern, A.strokes[2].width, A.strokes[2].points);
  const c = s4.areas.find((id) => !s2.areas.includes(id));
  const onBand = c ? await overlapPairs(s4.bricks[c] || [], s4.frame, 1e-3) : -1;
  checkRow('areas', 'An area across the band stops at the band', !!c && (s4.bricks[c] || []).length > 0 && onBand === 0,
    `area ${c ? 'painted' : 'MISSING'}, ${(c && s4.bricks[c] || []).length} bricks, ${onBand} on a frame brick`);
  // 5. Select on an area brings its own settings back
  await click('brickTool_wall', 700); await click(A.selectTool, 700);
  const at = await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].filter((e)=>e.getAttribute('data-brick-owner')===${JSON.stringify(a)});
    // item 64: the area's bricks sit on the Wall layer, usually not the active one, so they take no pointer events
    // (.inactive-layer): the Brick tab's Select hit-tests the board point by geometry, so the brick need not be the target
    for (const n of ns) { const q=n.getBoundingClientRect(); const x=q.left+q.width/2, y=q.top+q.height/2; const top=document.elementFromPoint(x,y); if (top && (top===n || top.closest('svg'))) return {x,y}; } return null; })())`);
  if (at) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(1200);
  }
  const sel = await jsJSON(`JSON.stringify({ pattern: !!document.getElementById(${JSON.stringify(A.strokes[0].pattern)})?.classList.contains('active'), label: (document.getElementById(${JSON.stringify(A.wallLabel.id)})?.textContent||'').trim() })`);
  checkRow('areas', 'Select an area: its own pattern, "Editing: this Wall"', !!at && sel.pattern && sel.label.includes(A.wallLabel.text), `${at ? '' : 'no brick of the first area under the pointer; '}pattern active ${sel.pattern}, label "${sel.label}"`);
  // 6. Apply + reopen: the areas persist
  await apply(); await heightsSettled(null);
  const saved = await js(`import('./core/state.js').then(({ P }) => (String(P.editorSvg || '').match(/data-brick-record="wall-area"/g) || []).length)`);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const re = await jsJSON(areasState());
  checkRow('areas', 'Apply + reopen: the areas persist', saved === 3 && re.areas.length === 3, `saved ${saved} area records, reopened ${re.areas.length}`);
  // 7. Clear areas: the full wall back, exactly the baseline
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 700);
  await click(A.strokes[0].pattern, 1500); await click(A.areaTool, 700); await click(A.clearAreas, 2500);
  const cl = await jsJSON(areasState()), canvas1 = await canvasSettled(null);
  checkRow('areas', 'Clear areas: the full wall back (the baseline)', cl.areas.length === 0 && cl.full === 1 && cl.wall === wall0 && canvas1 === canvas0,
    `${cl.areas.length} areas, full-wall records ${cl.full}, wall ${cl.wall}/${wall0}, canvas ${canvas1 === canvas0 ? 'identical' : canvas1 + ' vs ' + canvas0}`);
  // 8. Clear > Bricks removes the areas
  await paint(A.strokes[0].pattern, A.strokes[0].width, A.strokes[0].points);
  const before = await jsJSON(areasState());
  await click('editorTabBrick', 600); await click(CLEAR_MENU.button, 600); await click('editorClear_bricks', 2000);
  const after = await jsJSON(areasState());
  checkRow('areas', 'Clear > Bricks removes the areas', before.areas.length === 1 && after.areas.length === 0, `areas ${before.areas.length} -> ${after.areas.length}`);
  if (await editorOpen()) await apply();
}
