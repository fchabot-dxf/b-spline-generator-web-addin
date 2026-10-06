// Brick matrix group 'lay': lay warnings, the bands-reduced note, a wall with no Frame element, the sidebar Frame-bands pick, carving under a flat wall.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- lay warnings (seat 37, audit B1, fb-app dd5a59c): bands that cover the whole board leave no room for the
// wall -- the app says so, and the wall comes back when the bands fit again (before the fix it never did).
export const LAY_WARNING = {
  template: 'template_9',
  // item 28: a stack too deep for the board is reduced first, so "no room for the wall" is now a board too narrow
  // for even ONE band: T9 7x9 at 1-1/2 in (measured: no wall; at 3/4 in a 146-brick wall)
  tooManySize: 'brickSizePreset_half1',
  fitsSize: 'brickSizePreset_quarter3',
  tooMany: 'brickQuick_frameBands_three_band',
  fits: 'brickQuick_frameBands_single_soldier',
  notes: { sidebar: 'brickLayWarnings', editor: 'brickEditorLayWarnings' },
  text: 'no room for the wall', // a stable part of "The frame bands cover the whole board -- no room for the wall: ..."
  introducedBy: 'dd5a59c',
};

// ---- F35 item 63 (seat D): the MAIN sidebar's Frame bands pick lays the frame when none is on the board (measured on
// T18 before the fix: wall laid, quick Soldier -> 0 frame bricks, 3D unchanged); under template None (item 66: the board
// rectangle) the row stays live and the pick lays the bands along the board edge.
export const QUICK_FRAME_LAYS = {
  template: 'template_18', pick: 'brickQuick_frameBands_single_soldier', row: 'brickQuickRow_frameBands',
  noTemplatePick: 'brickQuick_frameBands_double_course', introducedBy: 'item 63',
  // A1 (3D-panel audit): a stack that only partly fits says so in the SIDEBAR too (T18 7x9: 1 of 3 laid, measured)
  reducedPick: 'brickQuick_frameBands_three_band', sidebarNote: 'brickLayWarnings', reducedText: 'Bands reduced to fit the board:',
};

// ---- bands reduced to fit (T86 item 28 engine `bandsReduced`; F35 item 35 note, seat 37 fb-app 21a1ffd): on T1 7x9
// at the 1.25 in default, 3-band keeps 1 band -- the wall stays, the note says so, the dropped bands' rows are disabled.
export const BANDS_NOTE = {
  template: 'template_1', tooDeep: 'brickFramePreset_three_band', fits: 'brickFramePreset_single_soldier',
  note: 'brickFrameBandsNote', text: 'Bands reduced to fit the board: 1 of 3 laid.', dropped: '[data-band-dropped="1"]',
  emptyWarning: 'brickEditorLayWarnings', introducedBy: '21a1ffd',
};

// ---- a wall with NO Frame element (F35 item 42, Fred: "I don't always use frames"): it fills the frame contour (the
// template's outer edge; the board rectangle for template None), no band reserve. Measured before: T18 7x10, 0.75 in,
// Wall only: x 1.00-6.00 (the Soldier band depth kept clear). `tol` = within a joint.
export const WALL_NO_FRAME = {
  cases: [{ template: 'template_18', heightIn: 10 }, { template: '', heightIn: 9 }],
  wallTool: 'brickTool_wall', generate: 'brickGenerate', tol: 0.1,
  marker: "import('./editor/editor-brick-tool.js').then((m) => !!m.frameGeomForLay)",
};

// ---- a carving ART stroke under FLAT bricks (F35 item 44, seat E; Fred: "if there's a carving in art, the bricks don't work").
// Measured before (7x9 T1): every Flat brick the carve crosses moved off the stroke (1,752 points, max 0.10 in). The row lays a
// Wall (Flat tops, the new-board default), draws this stroke on the art layer (carving), and checks in 3D: the crossed bricks'
// points away from the stroke are unchanged, and the stroke itself cuts. It FAILS (not skips) on a build without the fix.
export const CARVE_UNDER_FLAT = {
  stroke: { a: { x: 1.6, y: 2.2 }, b: { x: 5.4, y: 6.8 }, widthIn: 0.35 }, farMarginIn: 0.15,
  wallTool: 'brickTool_wall', generate: 'brickGenerate', minNearChangedShare: 0.9,
  introducedBy: 'F35 item 44',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, waitApp, checkRow, wallCount, openEditorTab, reloadWithStorage;
export function bind(ctx) { ({ sleep, send, js, jsJSON, click, exists, heightsSettled, editorOpen, apply, rows, waitApp, checkRow, wallCount, openEditorTab, reloadWithStorage } = ctx); }
export async function run() { await runLayWarnings(); await runBandsNote(); await runWallNoFrame(); await runQuickFrameLays(); await runCarveUnderFlat(); }

async function noteState(id) {
  return (await jsJSON(`JSON.stringify((()=>{ const n=document.getElementById(${JSON.stringify(id)}); if(!n) return { missing: true }; return { shown: n.offsetParent !== null && getComputedStyle(n).display !== 'none', text: (n.textContent||'').trim() }; })())`));
}
// F35 item 42 (WALL_NO_FRAME above): Wall only, no Frame element -> the wall's box = the frame contour's box
async function runWallNoFrame() {
  const N = WALL_NO_FRAME;
  for (const c of N.cases) {
    const name = `No Frame element (${c.template || 'template None'}): the wall fills the frame contour`;
    await reloadWithStorage({});
    if (!(await js(N.marker))) { checkRow('lay', name, false, '', 'F35 item 42'); continue; }
    await js(`(()=>{ const h=document.getElementById('heightIn'); h.value=${JSON.stringify(String(c.heightIn))}; h.dispatchEvent(new Event('change')); return 1; })()`); await sleep(2000);
    await openEditorTab('editorTabFrame');
    await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); s.value=${JSON.stringify(c.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); return 1; })()`);
    await openEditorTab('editorTabBrick'); await click(N.wallTool, 900); await click(N.generate, 2500);
    const m = await jsJSON(`(async()=>{ const ed=window.svgEditor; const fp=await import('./editor/editor-frame-profile.js'); const cf=await import('./editor/contour-from-frame.js');
      const ctx=fp.frameContext(ed); const sil=ctx?cf.frameContourSilhouette(ctx,0,0):null;
      const cpts = sil && sil.primitives ? sil.primitives.flatMap((p)=>Object.values(p).filter((v)=>v&&typeof v==='object'&&'x' in v).map((v)=>[v.x,v.y])) : [[0,0],[ed._mW,ed._mH]];
      const wpts=[...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]')].flatMap((n)=>n.getAttribute('points').trim().split(/[ ]+/).map((q)=>q.split(',').map(Number)));
      const bb=(p)=>[Math.min(...p.map((q)=>q[0])),Math.max(...p.map((q)=>q[0])),Math.max(...p.map((q)=>q[1]))];
      return JSON.stringify({ wall: wpts.length ? bb(wpts) : null, contour: bb(cpts), frame: ed._sketchLayer.node.querySelectorAll('[data-brick="frame"]').length }); })()`);
    // x left / x right / the bottom (a template's top is often an arch: its apex is not in the primitives' points)
    const ok = !!m.wall && m.frame === 0 && m.wall.every((v, i) => Math.abs(v - m.contour[i]) <= N.tol);
    checkRow('lay', name, ok, `wall x ${m.wall ? m.wall[0].toFixed(2) + '-' + m.wall[1].toFixed(2) + ' bottom ' + m.wall[2].toFixed(2) : 'none'} vs contour x ${m.contour[0].toFixed(2)}-${m.contour[1].toFixed(2)} bottom ${m.contour[2].toFixed(2)}; frame bricks ${m.frame}`);
  }
  if (await editorOpen()) await apply();
}

// F35 item 44 (CARVE_UNDER_FLAT above): a carving art stroke under Flat bricks moves no brick point off the stroke
async function runCarveUnderFlat() {
  const C = CARVE_UNDER_FLAT, name = 'Carving art under Flat bricks: crossed bricks keep their tops, the stroke cuts';
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick'); await click(C.wallTool, 900); await click(C.generate, 2500);
  await apply(); await heightsSettled(null);
  await js(`import('./core/state.js').then((m)=>{ window.__carveH0=Float32Array.from(m.lastResult.heights); return 1; })`);
  await openEditorTab('editorTabArtwork');
  await js(`(()=>{ const ed=window.svgEditor; const lid=ed._layers.find((l)=>!l.brickKind && !l.holdsBricks).id; const s=${JSON.stringify(C.stroke)};
    ed._sketchLayer.path('M'+s.a.x+','+s.a.y+' L'+s.b.x+','+s.b.y).fill('none').stroke({ color:'#000000', width:s.widthIn }).attr('data-layer', String(lid)); return 1; })()`);
  await apply(); await heightsSettled(null);
  const m = await jsJSON(`(async()=>{ const st=await import('./core/state.js'); const A=window.__carveH0, B=st.lastResult.heights; const W=st.P.widthIn, H=st.P.heightIn;
    const nx=Math.round(Math.sqrt(A.length*W/H)), nz=A.length/nx; const s=${JSON.stringify(C.stroke)}, far=s.widthIn/2+${C.farMarginIn};
    const segD=(x,y)=>{ const dx=s.b.x-s.a.x, dy=s.b.y-s.a.y; let t=((x-s.a.x)*dx+(y-s.a.y)*dy)/(dx*dx+dy*dy); t=Math.max(0,Math.min(1,t)); return Math.hypot(x-(s.a.x+t*dx), y-(s.a.y+t*dy)); };
    const polys=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n)=>{ const v=n.getAttribute('points').trim().split(/[ ,]+/).map(Number); const o=[]; for(let i=0;i+1<v.length;i+=2) o.push({x:v[i],y:v[i+1]}); return o; });
    const pip=(x,y,p)=>{ let c=false; for(let i=0,j=p.length-1;i<p.length;j=i++){ if(((p[i].y>y)!==(p[j].y>y)) && x<(p[j].x-p[i].x)*(y-p[i].y)/(p[j].y-p[i].y)+p[i].x) c=!c; } return c; };
    const crossed=polys.filter((p)=>{ for(let t=0;t<=1;t+=0.01){ if (pip(s.a.x+t*(s.b.x-s.a.x), s.a.y+t*(s.b.y-s.a.y), p)) return true; } return false; });
    let near=0, nearChanged=0, farOnCrossed=0, farOnCrossedChanged=0, maxFar=0;
    for (let j=0;j<nz;j++) for (let i=0;i<nx;i++) { const k=j*nx+i; const x=i/(nx-1)*W, y=(1-j/(nz-1))*H; const d=Math.abs(B[k]-A[k]); const sd=segD(x,y); // heights row 0 = the board's bottom edge (measured)
      if (sd < s.widthIn/2) { near++; if (d>1e-4) nearChanged++; continue; }
      if (sd > far && crossed.some((p)=>pip(x,y,p))) { farOnCrossed++; if (d>1e-4) { farOnCrossedChanged++; maxFar=Math.max(maxFar,d); } } }
    return JSON.stringify({ crossed: crossed.length, near, nearChanged, farOnCrossed, farOnCrossedChanged, maxFar:+maxFar.toFixed(4) }); })()`);
  const ok = m.crossed > 0 && m.farOnCrossed > 0 && m.farOnCrossedChanged === 0 && m.nearChanged >= C.minNearChangedShare * m.near;
  checkRow('lay', name, ok, `${m.crossed} bricks crossed; off-stroke points on them changed ${m.farOnCrossedChanged}/${m.farOnCrossed} (max ${m.maxFar} in); under the stroke ${m.nearChanged}/${m.near} cut`);
  if (await editorOpen()) await apply();
}

async function runLayWarnings() {
  const W = LAY_WARNING;
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(W.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await apply(); await heightsSettled(null);
  await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
  if (!(await exists(W.tooMany))) { checkRow('lay', `${W.template}: too many bands -> no wall + notes`, false, '', W.introducedBy); return; }
  const size = async (id) => { // the Wall tool's brick size, then back to the sidebar
    await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900); await click(id, 2500);
    await apply(); await heightsSettled(null);
    await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
  };
  // 1. bands that cover the board: no wall, both notes say so
  await size(W.tooManySize);
  await click(W.tooMany, 2500);
  const side1 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900); // the Brick panel (and its note) shows once a tool is picked
  const walls1 = await wallCount(), ed1 = await noteState(W.notes.editor);
  const ok1 = walls1 === 0 && side1.shown && ed1.shown && side1.text.includes(W.text) && ed1.text.includes(W.text);
  checkRow('lay', `${W.template}: too many bands -> no wall + notes`, ok1, `wall ${walls1}, sidebar note ${side1.shown ? 'shown' : 'hidden'}, editor note ${ed1.shown ? 'shown' : 'hidden'}${side1.text.includes(W.text) ? '' : ' (text differs: ' + side1.text.slice(0, 60) + ')'}`);
  await apply(); await heightsSettled(null);
  // 2. bands that fit again: the wall comes back, both notes go
  await size(W.fitsSize);
  await click(W.fits, 2500);
  const side2 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900);
  const walls2 = await wallCount(), ed2 = await noteState(W.notes.editor);
  checkRow('lay', `${W.template}: bands fit again -> wall back, notes hidden`, walls2 > 0 && !side2.shown && !ed2.shown,
    `wall ${walls2}, sidebar note ${side2.shown ? 'shown' : 'hidden'}, editor note ${ed2.shown ? 'shown' : 'hidden'}`);
  if (await editorOpen()) { await apply(); await heightsSettled(null); }
}

// F35 item 63: the sidebar Frame bands pick lays a frame that is not on the board yet (QUICK_FRAME_LAYS)
async function runQuickFrameLays() {
  const Q = QUICK_FRAME_LAYS;
  const setTemplate = (t) => js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(t)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  const frames = () => js(`window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]').length`);
  await reloadWithStorage({}); // the defaults: a Soldier preset that is not laid until the Frame tool lays it
  await openEditorTab('editorTabBrick'); await setTemplate(Q.template);
  await click('brickTool_wall', 800); await click('brickGenerate', 2500);
  await apply(); const z0 = await heightsSettled(null);
  const f0 = await frames();
  // a bug fix: an older build has the pick (it did nothing), so it runs and FAILS there -- only a build without it skips
  if (!(await exists(Q.pick))) { checkRow('lay', 'Sidebar Frame bands lays the frame (no Frame on the board)', false, '', Q.introducedBy); return; }
  await click(Q.pick, 2500); const z1 = await heightsSettled(z0);
  const f1 = await frames();
  checkRow('lay', 'Sidebar Frame bands lays the frame (no Frame on the board)', f0 === 0 && f1 > 0 && z1 !== z0, `frame bricks ${f0} -> ${f1}, 3D ${z1 !== z0 ? 'changed' : 'UNCHANGED'}`);
  await click(Q.reducedPick, 2500);
  const note = await jsJSON(`JSON.stringify((()=>{ const e=document.getElementById(${JSON.stringify(Q.sidebarNote)}); return { shown: !!e && getComputedStyle(e).display !== 'none', text: e ? e.textContent.trim() : '' }; })())`);
  checkRow('lay', 'Sidebar shows the band-fit note (a stack that only partly fits)', note.shown && note.text.startsWith(Q.reducedText), `sidebar note ${note.shown ? `"${note.text}"` : 'HIDDEN'}`);
  // template None = the board rectangle (item 66): the row stays live, a pick lays the bands along the board edge
  await openEditorTab('editorTabBrick'); await setTemplate(''); await apply(); const z2 = await heightsSettled(z1);
  const g = await jsJSON(`JSON.stringify((()=>{ const b=[...document.querySelectorAll('#${Q.row} button')]; return { n: b.length, off: b.filter((x)=>x.disabled).length }; })())`);
  await click(Q.noTemplatePick, 2500); const z3 = await heightsSettled(z2);
  const f3 = await frames();
  checkRow('lay', 'Sidebar Frame bands under template None lays along the board edge', g.n > 0 && g.off === 0 && f3 > 0 && z3 !== z2, `${g.off}/${g.n} greyed, frame bricks ${f3}, 3D ${z3 !== z2 ? 'changed' : 'UNCHANGED'}`);
}

async function runBandsNote() {
  const W = BANDS_NOTE;
  await reloadWithStorage({}); // the defaults (1.25 in)
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(W.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900); await click('brickGenerate', 2000);
  if (!(await exists(W.note))) { checkRow('lay', `${W.template}: 3-band reduced to fit -> note, wall kept`, false, '', W.introducedBy); return; }
  const read = () => jsJSON(`JSON.stringify({ note: (()=>{ const e=document.getElementById(${JSON.stringify(W.note)}); return e && e.offsetParent!==null ? e.textContent.trim() : null; })(),
    dropped: document.querySelectorAll(${JSON.stringify(W.dropped)}).length,
    disabled: [...document.querySelectorAll('[id^="brickFrameBandPattern_1_"], [id^="brickFrameBandPattern_2_"]')].filter((b)=>!b.disabled).length,
    empty: (()=>{ const e=document.getElementById(${JSON.stringify(W.emptyWarning)}); return !!e && e.offsetParent!==null && getComputedStyle(e).display!=='none'; })() })`);
  await click(W.tooDeep, 2500);
  const a = await read(), wa = await wallCount();
  checkRow('lay', `${W.template}: 3-band reduced to fit -> note, wall kept`, wa > 0 && a.note === W.text && a.dropped === 2 && a.disabled === 0 && !a.empty,
    `wall ${wa}, note ${a.note === null ? 'HIDDEN' : `"${a.note}"`}, ${a.dropped} dropped band rows (${a.disabled} of their buttons still enabled), empty-wall warning ${a.empty ? 'SHOWN' : 'hidden'}`);
  await click(W.fits, 2500);
  const b = await read();
  checkRow('lay', `${W.template}: a stack that fits -> no note, no dropped rows`, b.note === null && b.dropped === 0, `note ${b.note === null ? 'hidden' : `"${b.note}"`}, ${b.dropped} dropped rows`);
  if (await editorOpen()) await apply();
}
