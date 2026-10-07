// Brick matrix group 'brush': the Brush / Raised brush settings and the Stripe panel picks.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import { E, click, NEEDS_THREE_STYLES, STRIPE, set } from './_shared.mjs';

export const rows = [
  // ---- Brush settings (new strokes)
  { name: 'Brush profile: Continuous', kind: 'brush', do: click('brickBtnProfileContinuous'), expect: E(false, true, null) },
  { name: 'Brush orientation: Soldier', kind: 'brush', do: click('brickBtnOrientationSoldier'), expect: E(false, true, null) },
  { name: 'Brush profile: Stripped', kind: 'brush', do: click('brickBtnProfileStripped'), expect: E(false, true, null) },
  { name: 'Brush preset: 2-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_2_running'), expect: E(false, true, null) },
  { name: 'Brush preset: 1-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_1'), expect: E(false, true, null) },
  // F35 item 16 (seat 37): the Raised brush -- its Level lifts each new stroke's bricks (data-brick-height-offset);
  // its Grout mode waits for the engine's groutCut (main/brick-control-requires.js hides it until then)
  { name: 'Raised brush level 1/8', kind: 'brush', tool: 'raisedBrush', do: set('brickRaisedLevel', 0.125, 'input'), expect: E(false, true, null), introducedBy: '0f45668' },
  { name: 'Raised brush mode: Grout', kind: 'brush', tool: 'raisedBrush', do: click('brickRaisedMode_grout'), expect: E(false, true, null), introducedBy: '0f45668' },
  // ---- Stripe panel brick-style picks (seat 37, fb-app 702876d)
  { name: 'Stripe A: White continuous', kind: 'stripe', do: click('stripeBrickStyle_A_white_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe B: Red continuous', kind: 'stripe', do: click('stripeBrickStyle_B_red_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe C: White bricks', kind: 'stripe', do: click('stripeBrickStyle_C_white_bricks'), expect: STRIPE, introducedBy: '702876d', requires: NEEDS_THREE_STYLES },
];

// ---- T86 item 10 (seat D): the Raised brush's GROUT mode cuts a joint through the laid Wall -- a stroke drawn with real
// pointer input (board inches through the sketch layer's screen transform) across the wall's interior. The check samples
// the line the app RECORDED (groutCutPolylines: the drawn stroke is simplified, so the declared points can sit outside a
// 0.034 in joint -- measured): under no wall piece after the cut, under wall pieces again after one Undo (+1 undo step).
// The piece COUNT is no criterion: a cut splits bricks but drops the pieces under the quarter-brick floor (measured on
// this group's board: 50 -> 49; T1 at 0.75 in: 193 -> 197).
export const GROUT_CUT = {
  tool: 'raisedBrush', mode: 'brickRaisedMode_grout', stroke: [[1.8, 3.2], [3.5, 4.4], [5.2, 6.2]],
  marker: 'groutCutPolylines', introducedBy: 'T86 item 10',
};
let js, jsJSON, send, sleep, openBrickTool, clickEl, checkRow, key;
export function bind(ctx) { ({ js, jsJSON, send, sleep, openBrickTool, click: clickEl, checkRow, key } = ctx); }
export async function run() { await runGroutCut(); }

/** the wall's pieces vs a line (board inches): how many of its samples lie under a piece; null = the recorded cut */
const COUNTS = (line = null) => `(async()=>{ const bt=await import('./editor/editor-brick-tool.js'); const { pointInPolygon }=await import('./core/bricks/index.js'); const ed=window.svgEditor;
  const wall=[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]')].map((n)=>n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; }));
  const line=${line ? JSON.stringify(line) : 'bt.groutCutPolylines(ed).flatMap((c)=>c.polyline)'}; const samples=[];
  for (let i=1;i<line.length;i++){ const a=line[i-1], b=line[i]; for (let k=0;k<6;k++) samples.push({x:a.x+(b.x-a.x)*k/6, y:a.y+(b.y-a.y)*k/6}); }
  return JSON.stringify({ line, wall: wall.length, samples: samples.length, over: samples.filter((s)=>wall.some((pg)=>pointInPolygon(s.x,s.y,pg))).length, undo: ed._undoStack.length }); })()`;
async function boardDrag(pts) {
  const at = async ([x, y]) => jsJSON(`(()=>{ const n=window.svgEditor._sketchLayer.node, m=n.getScreenCTM(), pt=n.ownerSVGElement.createSVGPoint(); pt.x=${x}; pt.y=${y}; const s=pt.matrixTransform(m); return JSON.stringify({x:s.x, y:s.y}); })()`);
  const ps = []; for (const q of pts) ps.push(await at(q));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[0].x, y: ps[0].y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ps[0].x, y: ps[0].y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i < ps.length; i++) for (let k = 1; k <= 12; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[i - 1].x + (ps[i].x - ps[i - 1].x) * k / 12, y: ps[i - 1].y + (ps[i].y - ps[i - 1].y) * k / 12, button: 'left', buttons: 1 });
    await sleep(15);
  }
  const z = ps[ps.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function runGroutCut() {
  const G = GROUT_CUT, name = 'Raised brush Grout cut: a joint through the Wall, one undo step';
  if (!(await js(`import('./editor/editor-brick-tool.js').then((m) => typeof m.${G.marker} === 'function', () => false)`))) {
    checkRow('brush', name, false, '', G.introducedBy); return;
  }
  await openBrickTool(G.tool);
  await clickEl(G.mode, 600);
  const before = await jsJSON(COUNTS([]));
  await boardDrag(G.stroke); await sleep(3500);
  const after = await jsJSON(COUNTS()); // the recorded cut line
  await key('z'); await sleep(3500);
  const undone = await jsJSON(COUNTS(after.line)); // the same line, on the board as it was
  await clickEl('brickRaisedMode_bricks', 400); // leave the brush as the group found it
  const ok = after.samples > 0 && after.over === 0 && undone.over > 0 && after.undo === before.undo + 1 && undone.wall === before.wall;
  checkRow('brush', name, ok, `recorded stroke samples under a wall piece: ${after.over}/${after.samples} after the cut, ${undone.over} after Undo; wall pieces ${before.wall} -> ${after.wall} -> ${undone.wall}; undo steps +${after.undo - before.undo}`);
}
