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
export async function run() { await runStrokesClear(); await runBrushCrossings(); }

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
    const box=(n)=>{ const p=n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
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

// ---- T86 item 5 (Fred's crossing rule, core/bricks/crossings.js): brick strokes that cross are cut STRAIGHT along the
// through one's edge, one joint off (+-10 %): an X at 90 / 45 deg and a curved X (the earlier runs through), a T (the
// later ends on the earlier), an end-touch (the EARLIER ends on the later: it stops, Fred's 5b), a stroke into the frame
// band (the frame runs through). The band case first, on the frame STROKE_CLEAR laid; then the frame goes (None) and
// the stroke cases sit round the board's centre, clear of any band. Each case starts with no stroke.
export const CROSSINGS = {
  tool: 'brickTool_brush', introducedBy: 'T86 item 5',
  cases: [
    { name: 'into the frame band', strokes: [[[0, 0], [0, 'top']]], cut: 0, frame: true },
    { name: 'X at 90 deg', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 2.2]]], cut: 1 },
    { name: 'X at 45 deg', strokes: [[[-2.5, 0], [2.5, 0]], [[-1.8, -1.8], [1.8, 1.8]]], cut: 1 },
    { name: 'curved X', strokes: [[[-2.5, 0], [2.5, 0]], [[-2.4, 1.2], [-1.2, -0.6], [0, -1], [1.2, -0.6], [2.4, 1.2]]], cut: 1 },
    { name: 'T', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 0]]], cut: 1 },
    { name: 'end-touch (the earlier ends on the later)', strokes: [[[0, -2.2], [0, 0]], [[-2.5, 0], [2.5, 0]]], cut: 0 },
    // pick 2: a Continuous stroke (one unbroken piece per run) runs through and stops by the same rule
    { name: 'brick X over an earlier Continuous', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 2.2]]], profiles: ['continuous', 'stripped'], cut: 1 },
    { name: 'Continuous X over an earlier brick stroke', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 2.2]]], profiles: ['stripped', 'continuous'], cut: 1 },
    { name: 'Continuous T ending on an earlier brick stroke', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 0]]], profiles: ['stripped', 'continuous'], cut: 1 },
  ],
  gapTolerance: 0.1,
  // the Brush profile buttons (a case's `profiles[k]` picks one before stroke k; absent = as it is)
  profileButton: { stripped: 'brickBtnProfileStripped', continuous: 'brickBtnProfileContinuous' },
};
const CLEAR_STROKES = `import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor;
  ed._sketchLayer.node.querySelectorAll('[data-brick="brush-spine"]').forEach((n)=>n.remove());
  T.forceRegenerateOwnedBrickElements(ed); return 1; })`;
async function runBrushCrossings() {
  const C = CROSSINGS;
  await openEditorTab('editorTabBrick');
  if (!(await exists(C.tool))) { checkRow('strokes', 'Crossings', false, '', C.introducedBy); return; }
  for (const k of C.cases) {
    await js(CLEAR_STROKES);
    if (!k.frame && (await js(`document.querySelectorAll('[data-brick-gen="1"][data-brick="frame"]').length`)) > 0) {
      await js(`(document.getElementById('brickTool_frame').click(), 1)`); await sleep(400);
      await js(`(document.getElementById('brickFramePreset_none').click(), 1)`); await sleep(2500);
    }
    await js(`(document.getElementById(${JSON.stringify(C.tool)}).click(), 1)`);
    await sleep(400);
    for (const [si, pts] of k.strokes.entries()) {
      const prof = k.profiles && k.profiles[si];
      if (prof) { await js(`(document.getElementById(${JSON.stringify(C.profileButton[prof])})?.click(), 1)`); await sleep(300); }
      await js(`import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor, pts=${JSON.stringify(pts)}, cx=ed._mW/2, cy=ed._mH/2;
        const at=([x,y])=>({ x: cx + x, y: y === 'top' ? 0.15 : cy + y });
        T.brickBrushHandler.start(ed, at(pts[0])); for (const p of pts.slice(1)) T.brickBrushHandler.update(ed, at(p)); T.brickBrushHandler.finish(ed); return 1; })`);
      await piecesSettled('brush');
    }
    const r = await jsJSON(`(async()=>{ const T=await import('./editor/editor-brick-tool.js'); const { P }=await import('./core/state.js'); const { polygonIntersection, signedArea, pointInPolygon }=await import('./core/bricks/geometry.js');
      const ed=window.svgEditor, cut=${k.cut}, J=T.elementGroutWidth(P.brickSettings, 'brush');
      const poly=(n)=>n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
      const owners=[...new Set([...ed._sketchLayer.node.querySelectorAll('[data-brick="brush-spine"]')].map((n)=>n.getAttribute('data-brick-element')))];
      const brush=[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="brush"]')].map((n)=>({ el: (n.getAttribute('data-brick-owner')||'').split(':')[0], p: poly(n) }));
      const frame=[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="frame"]')].map(poly);
      const area=(p)=>p.length>=3?Math.abs(signedArea(p)):0;
      const sd=(p,a,b)=>{ const ex=b.x-a.x, ey=b.y-a.y, l=ex*ex+ey*ey||1e-12, t=Math.max(0,Math.min(1,((p.x-a.x)*ex+(p.y-a.y)*ey)/l)); return Math.hypot(a.x+t*ex-p.x,a.y+t*ey-p.y); };
      const dp=(p,Q)=>pointInPolygon(p.x,p.y,Q)?0:Math.min(...Q.map((a,i)=>sd(p,a,Q[(i+1)%Q.length])));
      const gap=(A,B)=>Math.min(...A.map((p)=>dp(p,B)),...B.map((p)=>dp(p,A)));
      let overlaps=0; for (let i=0;i<brush.length;i++) for (let j=i+1;j<brush.length;j++) if (brush[i].el!==brush[j].el && area(polygonIntersection(brush[i].p,brush[j].p))>1e-4) overlaps++;
      for (const b of brush) for (const f of frame) if (area(polygonIntersection(b.p,f))>1e-4) overlaps++;
      const mine=brush.filter((b)=>b.el===owners[cut]).map((b)=>b.p);
      const others=${k.frame ? 'frame' : 'brush.filter((b)=>b.el!==owners[cut]).map((b)=>b.p)'};
      let g=Infinity; for (const a of mine) for (const b of others) { const x=gap(a,b); if (x<g) g=x; }
      return JSON.stringify({ strokes: owners.length, pieces: brush.length, mine: mine.length, overlaps, gap: +g.toFixed(4), J }); })()`);
    const ok = r.strokes === k.strokes.length && r.mine > 0 && r.overlaps === 0 && Math.abs(r.gap - r.J) <= C.gapTolerance * r.J;
    checkRow('strokes', `Crossing: ${k.name} -- the cut stroke a joint off, no overlap`, ok,
      `${r.strokes} strokes, ${r.pieces} pieces (${r.mine} on the cut one), overlaps ${r.overlaps}, gap at the cut ${r.gap} in (joint ${r.J})`);
  }
  await js(CLEAR_STROKES);
  await js(`(document.getElementById(${JSON.stringify(C.profileButton.stripped)})?.click(), 1)`); // back to the default profile
  if (await editorOpen()) await apply();
}
