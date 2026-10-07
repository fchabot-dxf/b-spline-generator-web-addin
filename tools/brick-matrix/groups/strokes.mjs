// Brick matrix group 'strokes': Brush / Raised strokes against the other elements.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- F35 item 60 (seat D): a Raised brush stroke keeps clear of the frame (the 18c drop rule). Seat A's brick-e2e board:
// the Grey stone frame ring (Set 5) and its raised stroke across the waist -- measured before the fix: 3-5 stroke bricks
// over frame stones, up to 0.37 in2 (sampled overlap, `grid` in).
export const STROKE_CLEAR = {
  template: 'template_1', frameSet: 5, raisedTool: 'brickTool_raisedBrush',
  stroke: [[1.4, 4.5], [2.5, 4.2], [3.5, 4.5], [4.5, 4.8], [5.6, 4.5]], grid: 0.004, maxOverlapSqIn: 2e-4,
  introducedBy: 'item 60',
};

// ---- the runner. Its page / CDP helpers are run.mjs's own, bound once by groups/index.mjs bindGroups(ctx).
let js, jsJSON, exists, editorOpen, apply, checkRow, openEditorTab, sleep;
export function bind(ctx) { ({ js, jsJSON, exists, editorOpen, apply, checkRow, openEditorTab, sleep } = ctx); }
export async function run() { await runStrokesClear(); }

// Load-proofing (seat D, 2026-10-07: the gate's parallel run got "DevTools Runtime.evaluate got no reply in 60s" here,
// 0 rows; alone the old ONE evaluate took 8.9 s -- 6.5 s of fixed in-page sleeps around a Generate and a stroke, 1.9 s
// of their synchronous work -- all inside one CDP reply). Now each step is its own short evaluate, and the waits are
// declared conditions polled from here: a kind's pieces present and their count steady for SETTLE_POLLS polls.
const SETTLE_POLLS = 3, POLL_MS = 700, SETTLE_MAX_MS = 120000;
const countOf = (kind) => js(`document.querySelectorAll('[data-brick-gen="1"][data-brick="${kind}"]').length`);
async function piecesSettled(kind) {
  let last = -1, same = 0;
  for (const t0 = Date.now(); Date.now() - t0 < SETTLE_MAX_MS;) {
    await sleep(POLL_MS);
    const n = await countOf(kind);
    if (n > 0 && n === last) { if (++same >= SETTLE_POLLS) return n; } else { same = 0; last = n; }
  }
  return last;
}

// F35 item 60: a Raised brush stroke across the frame lays no brick over a frame piece (STROKE_CLEAR)
async function runStrokesClear() {
  const K = STROKE_CLEAR;
  await openEditorTab('editorTabBrick');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(K.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  if (!(await exists(K.raisedTool))) { checkRow('strokes', 'Raised stroke keeps clear of the frame', false, '', K.introducedBy); return; }
  // the Grey stone frame, laid
  await js(`import('./core/state.js').then((S)=>{ S.P.brickSettings.setIds={ ...S.P.brickSettings.setIds, frame: ${K.frameSet} }; S.P.brickSettings.frameBandPatterns=[]; document.getElementById('brickTool_frame').click(); return 1; })`);
  await sleep(500);
  await js(`(document.getElementById('brickGenerate').click(), 1)`);
  await piecesSettled('frame');
  // the raised stroke across it
  await js(`(document.getElementById(${JSON.stringify(K.raisedTool)}).click(), 1)`);
  await sleep(500);
  await js(`import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor, K=${JSON.stringify(K)};
    T.brickBrushHandler.start(ed, { x: K.stroke[0][0], y: K.stroke[0][1] });
    for (const [x, y] of K.stroke.slice(1)) T.brickBrushHandler.update(ed, { x, y });
    T.brickBrushHandler.finish(ed); return 1; })`);
  await piecesSettled('brush');
  const r = await jsJSON(`(async()=>{ const K=${JSON.stringify(K)}; const { pointInPolygon }=await import('./core/bricks/index.js'); const ed=window.svgEditor;
    const box=(n)=>{ const p=n.getAttribute('points').trim().split(/\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
      return { p, x0:Math.min(...p.map((q)=>q.x)), x1:Math.max(...p.map((q)=>q.x)), y0:Math.min(...p.map((q)=>q.y)), y1:Math.max(...p.map((q)=>q.y)) }; };
    const of=(k)=>[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="'+k+'"]')].map(box);
    const brush=of('brush'), frame=of('frame'); let pairs=0, area=0;
    for (const a of brush) for (const b of frame) { const x0=Math.max(a.x0,b.x0), x1=Math.min(a.x1,b.x1), y0=Math.max(a.y0,b.y0), y1=Math.min(a.y1,b.y1); if (x1<=x0||y1<=y0) continue;
      let n=0; for (let x=x0+K.grid/2;x<x1;x+=K.grid) for (let y=y0+K.grid/2;y<y1;y+=K.grid) if (pointInPolygon(x,y,a.p)&&pointInPolygon(x,y,b.p)) n++;
      const s=n*K.grid*K.grid; if (s>K.maxOverlapSqIn) { pairs++; area+=s; } }
    return JSON.stringify({ brush: brush.length, frame: frame.length, pairs, area: +area.toFixed(4) }); })()`);
  checkRow('strokes', 'Raised stroke keeps clear of the frame', r.brush > 0 && r.frame > 0 && r.pairs === 0, `${r.pairs} stroke x frame overlaps (${r.area} in2); ${r.brush} stroke bricks, ${r.frame} frame pieces`);
  if (await editorOpen()) await apply();
}
