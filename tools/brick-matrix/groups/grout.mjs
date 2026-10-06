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

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab;
export function bind(ctx) { ({ js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab } = ctx); }
export async function run() { await runGroutJoints(); }

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
