// Brick matrix group 'handedit': hand edits to laid bricks.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- F35 item 65 (seat D): a brick moved BY HAND (Select tool, a real drag) follows in the 3D and survives Apply +
// reopen. Measured before the fix: the move was stored as a transform the height mask never read -- 3D unchanged.
export const HAND_EDIT = {
  template: 'template_1', size: 'brickSizePreset_half1', selectTool: 'toolSelect',
  dragBrickWidths: 0.6, // drag the middle wall brick right by this share of its own width
  introducedBy: 'item 65',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab, drag;
export function bind(ctx) { ({ js, jsJSON, click, exists, heightsSettled, editorOpen, apply, checkRow, openEditorTab, drag } = ctx); }
export async function run() { await runHandEdit(); }

// F35 item 65: a wall brick dragged by hand with the Select tool -> the 3D follows; the move survives Apply + reopen
async function runHandEdit() {
  const H = HAND_EDIT;
  await openEditorTab('editorTabBrick');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(H.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await click('brickTool_wall', 800); await click(H.size, 2000); await click('brickGenerate', 2500);
  await apply(); const z0 = await heightsSettled(null);
  await openEditorTab('editorTabBrick');
  if (!(await exists(H.selectTool))) { checkRow('handedit', 'Hand-moved brick: 3D follows, survives reopen', false, '', H.introducedBy); return; }
  await click(H.selectTool, 800);
  const b = await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')]; const n=ns[Math.floor(ns.length/2)];
    const svg=window.svgEditor._sketchLayer.node.ownerSVGElement.getBoundingClientRect(), r=n.getBoundingClientRect();
    return { id: n.getAttribute('data-brick-id'), points: n.getAttribute('points'), fx: (r.x+r.width/2-svg.left)/svg.width, fy: (r.y+r.height/2-svg.top)/svg.height, fw: r.width/svg.width }; })())`);
  await drag([[b.fx, b.fy], [b.fx + b.fw * H.dragBrickWidths, b.fy]]);
  const piece = () => jsJSON(`JSON.stringify((()=>{ const n=window.svgEditor._sketchLayer.node.querySelector('[data-brick-id="${b.id}"]'); return n ? { points: n.getAttribute('points'), transform: n.getAttribute('transform') } : null; })())`);
  const after = await piece();
  await apply(); const z1 = await heightsSettled(z0);
  await openEditorTab('editorTabBrick');
  const reopened = await piece();
  const moved = !!after && after.points !== b.points && !after.transform;
  checkRow('handedit', 'Hand-moved brick: 3D follows, survives reopen', moved && z1 !== z0 && !!reopened && reopened.points === after.points,
    `points ${moved ? 'moved' : 'UNMOVED'}${after && after.transform ? ' (transform ' + after.transform + ')' : ''}, 3D ${z1 !== z0 ? 'changed' : 'UNCHANGED'}, reopened ${reopened && after && reopened.points === after.points ? 'kept' : 'LOST'}`);
  if (await editorOpen()) await apply();
}
