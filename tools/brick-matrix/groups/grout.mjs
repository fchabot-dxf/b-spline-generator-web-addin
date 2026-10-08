// Brick matrix group 'grout': the joint height under each grout profile.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- F35 item 62 (seat D): the JOINT HEIGHT under each grout profile, from the 3D heights the page exposes (final heights
// minus the base terrain), wall interior only. Flush fills a joint to the bricks' face; Recessed sinks it below the ground.
// Measured on T1 7x9 at the fix (a972287): Flush joint median 0.101 vs brick median 0.113 in; before it, 0.000.
export const GROUT_JOINTS = {
  template: 'template_1', wallTool: 'brickTool_wall',
  profiles: [
    { button: 'brickBtnGroutFlush', name: 'Flush fills the joints to the brick face', jointOverBrickAtLeast: 0.75 },
    { button: 'brickBtnGroutRecessed', name: 'Recessed sinks the joints below the ground', jointBelow: 0 },
  ],
  introducedBy: 'a972287',
};

// ---- item 74n (seat D): the panel's CUT EDGE -- the grid points within `bandIn` inside the panel outline stand at brick
// height as often as the interior does (no low band = no teeth along the edge). Measured on main bc49c4a, T1 basketweave:
// band 0.07 / 0.08 / 0.13 vs interior 0.71 / 0.75 / 0.79 at 0.75 / 1 / 1.25 in; with the edge ring 0.81 / 0.85 / 0.87.
// The bar is a SHARE of the interior (seat D 2026-10-08, the advisor's gate failed it alone at 1.25 in): the scene is the
// page's fresh start (random terrain / seed) and a basketweave lays different bricks along the 0.025 in band each run --
// MEASURED band / interior over 6 healthy runs x 3 sizes (main x2, generate-first-tap x2, the gate, 74n's own): 0.74-1.12; the
// defect (the edge copy off, 74n's mutation): 0.05-0.16 vs 0.72-0.81 = at most 0.21. The old "within 0.15" bar sat in the
// scene's own noise; half the interior's share fails the teeth (<= 0.21) and passes the worst healthy run (0.74) with room.
export const EDGE_BAND = {
  template: 'template_1', wallTool: 'brickTool_wall', pattern: 'brickPattern_basketweave', sizes: [0.75, 1, 1.25],
  bandIn: 0.025, interiorFromIn: 0.1, minShareOfInterior: 0.5, marker: 'panelTrimOutline', introducedBy: 'item74n',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab, setValue;
export function bind(ctx) { ({ js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab, setValue } = ctx); }
export async function run() { await runGroutJoints(); await runEdgeBand(); }

// item 74n: the raised share of the grid points in the edge band (inside the panel's trim outline) vs the interior
function edgeBandProbe(E) { return `(async()=>{ const st=await import('./core/state.js'); const sm=await import('./main/stamp-mask-manager.js');
  const fp=await import('./editor/editor-frame-profile.js'); const { pointInPolygon }=await import('./core/bricks/index.js');
  const P=st.P, r=st.lastResult, W=P.widthIn, H=P.heightIn, nx=r.nx, nz=r.nz, h=r.heights, base=r.baseHeights;
  const loop=sm.${E.marker}(fp.frameContext(window.svgEditor), nx, nz, W, H); if(!loop) return JSON.stringify({ loop: null });
  const segD=(x,y,a,b)=>{ const dx=b.x-a.x, dy=b.y-a.y; let t=((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1); t=Math.max(0,Math.min(1,t)); return Math.hypot(x-a.x-t*dx, y-a.y-t*dy); };
  const half=P.brickSettings.reliefIn/2; let bn=0, bu=0, inn=0, inu=0;
  for (let j=0;j<nz;j++) for (let i=0;i<nx;i++) { const x=i/(nx-1)*W, y=H*(1-j/(nz-1)); if(!pointInPolygon(x,y,loop)) continue;
    let d=Infinity; for (let q=0;q<loop.length;q++) { d=Math.min(d, segD(x,y,loop[q],loop[(q+1)%loop.length])); if (d<${E.bandIn}) break; }
    const up=h[j*nx+i]-(base?base[j*nx+i]:0) > half;
    if (d<${E.bandIn}) { bn++; if(up) bu++; } else if (d>=${E.interiorFromIn} && d<${E.interiorFromIn}+0.4) { inn++; if(up) inu++; } }
  return JSON.stringify({ band: bn? bu/bn : null, interior: inn? inu/inn : null, bandPoints: bn }); })()`; }
async function runEdgeBand() {
  const E = EDGE_BAND;
  const has = await js(`import('./main/stamp-mask-manager.js').then((m) => typeof m.${E.marker} === 'function', () => false)`);
  for (const size of E.sizes) {
    const name = `Cut edge: no low band at ${size} in (teeth)`;
    if (!has) { checkRow('grout', name, false, '', E.introducedBy); continue; }
    if (!(await editorOpen())) await openEditorTab('editorTabBrick');
    await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s || s.value===${JSON.stringify(E.template)}) return 1; s.value=${JSON.stringify(E.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
    await click('brickTab_general', 600); await setValue('brickSize', size, 'change');
    await click(E.wallTool, 800); await click(E.pattern, 1500); await click('brickGenerate', 3000);
    const g0 = await js(`import('./core/state.js').then((m) => m.lastResultGeneration)`);
    await apply(); await heightsSettled(null, 60000, 1500, g0); // settled AND rebuilt since this lay's Apply
    const m = await jsJSON(edgeBandProbe(E));
    const ok = m.band != null && m.interior > 0 && m.band >= E.minShareOfInterior * m.interior;
    checkRow('grout', name, ok, `edge band (${E.bandIn} in) raised ${m.band?.toFixed(2)} vs interior ${m.interior?.toFixed(2)} (share ${m.interior > 0 ? (m.band / m.interior).toFixed(2) : '-'}, bar ${E.minShareOfInterior}) over ${m.bandPoints} band points`);
  }
}

// F35 item 62: joint height vs brick height per grout profile (GROUT_JOINTS), median over the wall's interior
function jointProbe() { return `(async()=>{ const m=await import('./core/state.js'); const { pointInPolygon } = await import('./core/bricks/index.js');
  const r=m.lastResult, h=r.heights, base=r.baseHeights, nx=r.nx, nz=r.nz, W=m.P.widthIn, H=m.P.heightIn;
  const bb=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]')].map((n)=>{
    const p=n.getAttribute('points').trim().split(/\\s+/).map((s)=>{ const [x,y]=s.split(',').map(Number); return {x,y}; });
    return { p, x0:Math.min(...p.map((q)=>q.x)), x1:Math.max(...p.map((q)=>q.x)), y0:Math.min(...p.map((q)=>q.y)), y1:Math.max(...p.map((q)=>q.y)) }; });
  const inB=(x,y)=>bb.some((b)=>x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1&&pointInPolygon(x,y,b.p)); const R=0.04;
  const brick=[], joint=[];
  for (let j=0;j<nz;j++) for (let i=0;i<nx;i++){ const k=j*nx+i, x=i/(nx-1)*W, y=H*(1-j/(nz-1)), d=h[k]-(base?base[k]:0);
    if (inB(x,y)) brick.push(d); else if ((inB(x+R,y)&&inB(x-R,y))||(inB(x,y+R)&&inB(x,y-R))) joint.push(d); }
  const med=(a)=>{ const s=[...a].sort((u,v)=>u-v); return s.length ? s[Math.floor((s.length-1)/2)] : null; };
  return JSON.stringify({ brick: med(brick), joint: med(joint), joints: joint.length }); })()`; }
async function runGroutJoints() {
  const G = GROUT_JOINTS;
  await openEditorTab('editorTabBrick');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(G.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await click(G.wallTool, 800); await click('brickGenerate', 3000);
  let Z = null;
  for (const pr of G.profiles) {
    if (!(await exists(pr.button))) { checkRow('grout', `Grout: ${pr.name}`, false, 'control missing', G.introducedBy); continue; }
    if (!(await editorOpen())) await openEditorTab('editorTabBrick');
    await click(pr.button, 1200); await apply(); Z = await heightsSettled(Z);
    const m = await jsJSON(jointProbe());
    const ok = m.joints > 0 && ('jointOverBrickAtLeast' in pr ? m.joint >= pr.jointOverBrickAtLeast * m.brick : m.joint < pr.jointBelow);
    checkRow('grout', `Grout: ${pr.name}`, ok, `joint median ${m.joint?.toFixed(4)} in vs brick median ${m.brick?.toFixed(4)} in over ${m.joints} joint cells`);
  }
}
