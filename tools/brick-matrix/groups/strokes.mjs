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
export async function run() { await runStrokesClear(); await runWallAroundCrossings(); await runBrushCrossings(); await runStoneCuts(); }

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
// a case's frame: a frame: true case gets the DECLARED frame laid fresh (FRAME_CASE: a single soldier band of set 1, the
// red brick -- MEASURED 2026-10-08: the band row kept STROKE_CLEAR's Grey stone ring, its stones laid differently on every
// fresh load, and failed alone in one gate run); every other case gets none
export const FRAME_CASE = { setId: 1, preset: 'brickFramePreset_single_soldier' };
async function frameFor(k) {
  const n = await js(`document.querySelectorAll('[data-brick-gen="1"][data-brick="frame"]').length`);
  if (!k.frame && n === 0) return;
  if (k.frame) await js(`import('./core/state.js').then((S)=>{ S.P.brickSettings.setIds={ ...S.P.brickSettings.setIds, frame: ${FRAME_CASE.setId} }; S.P.brickSettings.frameBandPatterns=[]; return 1; })`);
  await js(`(document.getElementById('brickTool_frame').click(), 1)`); await sleep(400);
  await js(`(document.getElementById(${JSON.stringify(k.frame ? FRAME_CASE.preset : 'brickFramePreset_none')}).click(), 1)`); await sleep(1500);
  if (k.frame) { await js(`(document.getElementById('brickGenerate').click(), 1)`); await piecesSettled('frame'); }
}
const CLEAR_STROKES = `import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor;
  ed._sketchLayer.node.querySelectorAll('[data-brick="brush-spine"]').forEach((n)=>n.remove());
  T.forceRegenerateOwnedBrickElements(ed); return 1; })`;
async function runBrushCrossings() {
  const C = CROSSINGS;
  await openEditorTab('editorTabBrick');
  if (!(await exists(C.tool))) { checkRow('strokes', 'Crossings', false, '', C.introducedBy); return; }
  for (const k of C.cases) {
    await js(CLEAR_STROKES);
    await frameFor(k);
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

// ---- T86 item 5 follow-up (advisor: "a hole in the wall where a cut stroke stops would be Fred-visible"): the Wall flows
// round the strokes (item 13: every laid brush brick is a wall exclusion, read off the canvas), so after a crossing it must
// follow the cut strokes' actual PARTS -- no wall piece over a stroke, and no more bare board at the junction than along a
// plain stretch of the same strokes. Bare = board farther than bareJoints joints from every piece, sampled every grid in,
// in a win-in square round the junction vs round a plain point; the band case first (on STROKE_CLEAR's frame).
export const WALL_AROUND = {
  tool: 'brickTool_brush', wallTool: 'brickTool_wall', introducedBy: 'T86 item 5 (pick 3)', grid: 0.02, win: 1.4, bareJoints: 1.5, slackSqIn: 0.01,
  cases: [
    { name: 'band', strokes: [[[0, 1.5], [0, 'top']]], junction: [0, 'band'], plain: [0, 1.5], frame: true },
    { name: 'T', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 0]]], junction: [0, 0], plain: [0, -1.4] },
    { name: 'X', strokes: [[[-2.5, 0], [2.5, 0]], [[0, -2.2], [0, 2.2]]], junction: [0, 0], plain: [0, -1.4] },
    { name: 'end-touch', strokes: [[[0, -2.2], [0, 0]], [[-2.5, 0], [2.5, 0]]], junction: [0, 0], plain: [0, -1.4] },
  ],
};
async function runWallAroundCrossings() {
  const C = WALL_AROUND;
  await openEditorTab('editorTabBrick');
  if (!(await exists(C.tool)) || !(await exists(C.wallTool))) { checkRow('strokes', 'Wall round cut strokes', false, '', C.introducedBy); return; }
  for (const k of C.cases) {
    await js(CLEAR_STROKES);
    await frameFor(k);
    await js(`(document.getElementById(${JSON.stringify(C.tool)}).click(), 1)`); await sleep(400);
    for (const pts of k.strokes) {
      await js(`import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor, pts=${JSON.stringify(pts)}, cx=ed._mW/2, cy=ed._mH/2;
        const at=([x,y])=>({ x: cx + x, y: y === 'top' ? 0.15 : cy + y });
        T.brickBrushHandler.start(ed, at(pts[0])); for (const p of pts.slice(1)) T.brickBrushHandler.update(ed, at(p)); T.brickBrushHandler.finish(ed); return 1; })`);
      await piecesSettled('brush');
    }
    // the wall laid again, round the strokes as they now are
    await js(`(document.getElementById(${JSON.stringify(C.wallTool)}).click(), 1)`); await sleep(400);
    await js(`(document.getElementById('brickGenerate').click(), 1)`);
    await piecesSettled('wall');
    const r = await jsJSON(`(async()=>{ const C=${JSON.stringify(C)}, k=${JSON.stringify(k)}; const T=await import('./editor/editor-brick-tool.js'); const { P }=await import('./core/state.js');
      const { polygonIntersection, signedArea, pointInPolygon }=await import('./core/bricks/geometry.js');
      const ed=window.svgEditor, J=T.elementGroutWidth(P.brickSettings, 'brush'), cx=ed._mW/2, cy=ed._mH/2;
      const poly=(n)=>n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
      const of=(kind)=>[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="'+kind+'"]')].map(poly);
      const wall=of('wall'), brush=of('brush'), frame=of('frame'), all=[...wall, ...brush, ...frame];
      const area=(p)=>p.length>=3?Math.abs(signedArea(p)):0;
      let overlaps=0; for (const w of wall) for (const b of brush) if (area(polygonIntersection(w,b))>1e-4) overlaps++;
      const sd=(p,a,b)=>{ const ex=b.x-a.x, ey=b.y-a.y, l=ex*ex+ey*ey||1e-12, t=Math.max(0,Math.min(1,((p.x-a.x)*ex+(p.y-a.y)*ey)/l)); return Math.hypot(a.x+t*ex-p.x,a.y+t*ey-p.y); };
      const far=(p,Q)=>{ if (pointInPolygon(p.x,p.y,Q)) return false; for (let i=0;i<Q.length;i++) if (sd(p,Q[i],Q[(i+1)%Q.length])<=C.bareJoints*J) return false; return true; };
      // the band's inner edge: the deepest frame point below the stroke's top, along the stroke's column
      const bandY = frame.length ? Math.max(...frame.flatMap((q)=>q.filter((p)=>Math.abs(p.x-cx)<0.6 && p.y<cy).map((p)=>p.y))) : 0;
      const centre=([x,y])=>({ x: cx + x, y: y === 'band' ? bandY : cy + y });
      const bare=(c)=>{ const h=C.grid, near=all.filter((q)=>q.some((p)=>Math.abs(p.x-c.x)<C.win && Math.abs(p.y-c.y)<C.win)); let n=0;
        for (let x=c.x-C.win/2; x<c.x+C.win/2; x+=h) for (let y=c.y-C.win/2; y<c.y+C.win/2; y+=h) { const p={x,y}; if (near.every((q)=>far(p,q))) n++; }
        return +(n*h*h).toFixed(4); };
      return JSON.stringify({ wall: wall.length, brush: brush.length, overlaps, junctionBare: bare(centre(k.junction)), plainBare: bare(centre(k.plain)), J }); })()`);
    const ok = r.wall > 0 && r.brush > 0 && r.overlaps === 0 && r.junctionBare <= r.plainBare + C.slackSqIn;
    checkRow('strokes', `Wall round cut strokes: ${k.name} -- no wall over a stroke, no hole at the junction`, ok,
      `${r.wall} wall / ${r.brush} stroke pieces, wall x stroke overlaps ${r.overlaps}, bare at the junction ${r.junctionBare} sq in vs a plain stretch ${r.plainBare}`);
  }
  await js(CLEAR_STROKES);
}

// ---- Stones (advisor, 2026-10-08: "stones are the weak spot"): a fieldstone wall inside a Grey stone ring (its bands lay
// fieldstone, library.js bandLayout), brush crossings and grout cuts through both, laid in the real app. At each junction:
// no two pieces overlap, and no more bare board than a plain stretch of the same lay plus slackSqIn. Bare = board farther
// than 3/4 of the widest joint from every piece, sampled every grid in, in a win-in square. MEASURED before the fix
// (piece-floor.js + fill-shape.js splitRound): 0.21 - 0.75 sq in at the junctions (holes several stones wide); after
// 0.0004 - 0.036 -- what is left is a corner sliver under the stone floor (0.052 sq in at 1.25 in), so the slack is two.
export const STONE_CUTS = {
  introducedBy: 'seat E stones (piece-floor.js)', template: 'template_1', ringSet: 5, wallPattern: 'brickPattern_fieldstone', grid: 0.02, win: 1.2, slackSqIn: 0.1,
  cases: [
    { name: 'brush X on the fieldstone wall', tool: 'brickTool_brush', strokes: [[[2.0, 2.7], [5.0, 2.7]], [[3.5, 1.7], [3.5, 3.7]]], junction: [3.5, 2.7], plain: [4.6, 6.6] },
    { name: 'brush T on the fieldstone wall', tool: 'brickTool_brush', strokes: [[[2.0, 2.7], [5.0, 2.7]], [[3.5, 1.7], [3.5, 2.7]]], junction: [3.5, 2.7], plain: [4.6, 6.6] },
    { name: 'grout cut across the fieldstone wall', tool: 'brickTool_raisedBrush', mode: 'grout', strokes: [[[1.6, 6.6], [5.4, 6.6]]], junction: [3.5, 6.6], plain: [3.5, 2.4] },
    { name: 'brush stroke into the stone ring', tool: 'brickTool_brush', strokes: [[[3.5, 2.7], [3.5, 0.15]]], junction: [3.5, 1.3], plain: [4.6, 6.6] },
    { name: 'grout cut across the stone ring', tool: 'brickTool_raisedBrush', mode: 'grout', strokes: [[[3.5, 6.4], [3.5, 8.95]]], junction: [3.5, 8.2], plain: [4.6, 2.6] },
  ],
};
async function runStoneCuts() {
  const C = STONE_CUTS;
  await openEditorTab('editorTabBrick');
  if (!(await exists(C.wallPattern)) || !(await exists('brickRaisedMode_grout'))) { checkRow('strokes', 'Stones', false, '', C.introducedBy); return; }
  // the template + the set ids as they were, put back after (the rows lay their own)
  const was = await jsJSON(`import('./core/state.js').then((S)=>JSON.stringify({ template: document.getElementById('editorFrameTemplate')?.value ?? null, setIds: S.P.brickSettings.setIds, bands: S.P.brickSettings.frameBandPatterns }))`);
  const pickTemplate = (t) => (t == null ? 0 : js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(t)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`));
  await pickTemplate(C.template);
  for (const k of C.cases) {
    await js(CLEAR_STROKES);
    // the stone ring + the fieldstone wall, laid fresh
    await js(`import('./core/state.js').then((S)=>{ S.P.brickSettings.setIds={ ...S.P.brickSettings.setIds, frame: ${C.ringSet} }; S.P.brickSettings.frameBandPatterns=[]; return 1; })`);
    await js(`(document.getElementById('brickTool_frame').click(), 1)`); await sleep(400);
    await js(`(document.getElementById('brickFramePreset_single_soldier').click(), 1)`); await sleep(1500);
    await js(`(document.getElementById('brickGenerate').click(), 1)`); await piecesSettled('frame');
    await js(`(document.getElementById('brickTool_wall').click(), 1)`); await sleep(400);
    await js(`(document.getElementById(${JSON.stringify(C.wallPattern)}).click(), 1)`); await sleep(1500);
    await js(`(document.getElementById(${JSON.stringify(k.tool)}).click(), 1)`); await sleep(400);
    if (k.mode) { await js(`(document.getElementById('brickRaisedMode_${k.mode}').click(), 1)`); await sleep(400); }
    for (const pts of k.strokes) {
      await js(`import('./editor/editor-brick-tool.js').then((T)=>{ const ed=window.svgEditor, pts=${JSON.stringify(pts)};
        T.brickBrushHandler.start(ed, { x: pts[0][0], y: pts[0][1] }); for (const p of pts.slice(1)) T.brickBrushHandler.update(ed, { x: p[0], y: p[1] }); T.brickBrushHandler.finish(ed); return 1; })`);
      await sleep(2500);
    }
    if (k.mode) { await js(`(document.getElementById('brickRaisedMode_bricks').click(), 1)`); await sleep(300); }
    // the wall (and the frame) laid again with the strokes / cuts in place
    await js(`(document.getElementById('brickTool_wall').click(), 1)`); await sleep(400);
    await js(`(document.getElementById('brickGenerate').click(), 1)`); await piecesSettled('wall');
    await js(`(document.getElementById('brickTool_frame').click(), 1)`); await sleep(400);
    await js(`(document.getElementById('brickGenerate').click(), 1)`); await piecesSettled('frame');
    const r = await jsJSON(`(async()=>{ const C=${JSON.stringify(C)}, k=${JSON.stringify(k)}; const T=await import('./editor/editor-brick-tool.js'); const { P }=await import('./core/state.js');
      const { polygonIntersection, signedArea, pointInPolygon }=await import('./core/bricks/geometry.js');
      const ed=window.svgEditor;
      const J={ wall: T.elementGroutWidth(P.brickSettings,'wall'), frame: T.elementGroutWidth(P.brickSettings,'frame'), brush: T.elementGroutWidth(P.brickSettings,'brush') };
      const poly=(n)=>n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
      const of=(kind)=>[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="'+kind+'"]')].map((n)=>({ kind, p: poly(n) }));
      const all=[...of('wall'), ...of('frame'), ...of('brush')];
      const area=(p)=>p.length>=3?Math.abs(signedArea(p)):0;
      const box=(p)=>p.reduce((b,q)=>[Math.min(b[0],q.x),Math.min(b[1],q.y),Math.max(b[2],q.x),Math.max(b[3],q.y)],[1e9,1e9,-1e9,-1e9]);
      const near=(c)=>all.filter((a)=>{ const b=box(a.p); return b[2]>c.x-C.win && b[0]<c.x+C.win && b[3]>c.y-C.win && b[1]<c.y+C.win; });
      const sd=(p,a,b)=>{ const ex=b.x-a.x, ey=b.y-a.y, l=ex*ex+ey*ey||1e-12, t=Math.max(0,Math.min(1,((p.x-a.x)*ex+(p.y-a.y)*ey)/l)); return Math.hypot(a.x+t*ex-p.x,a.y+t*ey-p.y); };
      const dist=(p,Q)=>pointInPolygon(p.x,p.y,Q)?0:Math.min(...Q.map((a,i)=>sd(p,a,Q[(i+1)%Q.length])));
      const measureAt=(c)=>{ const N=near(c); let ov=0, ovArea=0; for (let i=0;i<N.length;i++) for (let j=i+1;j<N.length;j++){ const o=area(polygonIntersection(N[i].p,N[j].p)); if (o>1e-4){ ov++; ovArea+=o; } }
        const Jw=Math.max(J.wall,J.frame,J.brush); let gap=0, n=0, widest=0;
        for (let x=c.x-C.win/2;x<c.x+C.win/2;x+=C.grid) for (let y=c.y-C.win/2;y<c.y+C.win/2;y+=C.grid) { n++; const d=Math.min(...N.map((a)=>dist({x,y},a.p))); if (d>0.75*Jw) { gap++; widest=Math.max(widest,d); } }
        return { pieces: N.length, overlaps: ov, overlapSqIn: +ovArea.toFixed(4), gapSqIn: +(gap*C.grid*C.grid).toFixed(4), widestGapJ: +(2*widest/Jw).toFixed(2) }; };
      return JSON.stringify({ J, junction: measureAt({x:k.junction[0],y:k.junction[1]}), plain: measureAt({x:k.plain[0],y:k.plain[1]}) }); })()`);
    const ok = r.junction.pieces > 0 && r.junction.overlaps === 0 && r.junction.gapSqIn <= r.plain.gapSqIn + C.slackSqIn;
    checkRow('strokes', `Stones: ${k.name} -- no overlap, no hole`, ok,
      `${r.junction.pieces} pieces, overlaps ${r.junction.overlaps}; bare at the junction ${r.junction.gapSqIn} sq in (widest ${r.junction.widestGapJ} joints) vs a plain stretch ${r.plain.gapSqIn}`);
  }
  await js(CLEAR_STROKES);
  await js(`import('./core/state.js').then((S)=>{ const w=${JSON.stringify(was)}; S.P.brickSettings.setIds=w.setIds; S.P.brickSettings.frameBandPatterns=w.bands; return 1; })`);
  await pickTemplate(was.template);
}
