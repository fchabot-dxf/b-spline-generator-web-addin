// Brick matrix group 'clear': the editor's Clear menu.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- Clear menu (F35 item 28; seat 37 fb-app 678c746). The editor header's Clear opens a menu: All / Frame /
// Artwork / Photo / Bricks. Answers declared by the advisor (2026-10-04): Clear Frame removes the frame SHAPE only
// (template -> Rectangle) and the frame/wall bricks re-lay on the rectangle at once; Clear Bricks removes every
// brick element and nulls the laid key; Clear All resets everything incl. the template and the photo; ONE undo
// restores everything a Clear removed. Each row seeds a board holding all four kinds, uses the option from the
// tab that owns its kind, then checks: every `clears` kind is empty, every `changes` kind is still present (it
// may differ), every other kind is byte-identical; then one Ctrl+Z must bring every kind back.
//   kinds:   how each kind is fingerprinted in the page -- see run.mjs CLEAR_PROBE (frame: P.frame; artwork: the
//            sketch children on non-Bricks layers; photo: P.photoImageDataUrl / photoEdits / photoPatternId;
//            bricks: [data-brick-gen="1"] + the wall/frame records <g data-brick-record> (item 22, seat 37
//            fb-app 8fe50e2: the old shared layer key brickLaidKey is retired; records are hidden <g>s, never art)
export const CLEAR_MENU = {
  button: 'editorClear',
  confirmOk: '.pm-prompt-ok',
  seed: { photoFile: 'b-spline-gen/html/assets/logo-64.png', stroke: [[0.35, 0.4], [0.5, 0.55], [0.65, 0.4]] },
  options: [
    { name: 'Clear All', item: 'editorClear_all', tab: 'editorTabArtwork', confirm: 'ok', clears: ['frame', 'artwork', 'photo', 'bricks'], changes: [] },
    { name: 'Clear All, then Keep', item: 'editorClear_all', tab: 'editorTabArtwork', confirm: 'keep', clears: [], changes: [], undo: false },
    { name: 'Clear Frame', item: 'editorClear_frame', tab: 'editorTabFrame', clears: ['frame'], changes: ['bricks'] },
    { name: 'Clear Artwork', item: 'editorClear_artwork', tab: 'editorTabArtwork', clears: ['artwork'], changes: [] },
    { name: 'Clear Photo', item: 'editorClear_photo', tab: 'editorTabPhoto', clears: ['photo'], changes: [] },
    { name: 'Clear Bricks', item: 'editorClear_bricks', tab: 'editorTabBrick', clears: ['bricks'], changes: [] },
  ],
  introducedBy: '678c746',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, js, shot, click, exists, rows, verdict, clearFingerprint, seedClearBoard, key;
export function bind(ctx) { ({ sleep, js, shot, click, exists, rows, verdict, clearFingerprint, seedClearBoard, key } = ctx); }
export async function run() { await runClear(); }

function clearKinds() { return ['frame', 'artwork', 'photo', 'bricks']; }
function clearRow(name, ok, detail) {
  rows.push({ name, kind: 'clear', result: 'ok', observed: { detail }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', clear: ok ? 'PASS' : 'FAIL' } });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}
async function runClear() {
  for (const o of CLEAR_MENU.options) {
    const f0 = await seedClearBoard();
    const unseeded = clearKinds().filter((k) => f0[k].empty);
    if (unseeded.length) { clearRow(`${o.name}: clears only its kind`, false, `setup: the seeded board lacks ${unseeded.join(', ')}`); continue; }
    await click(o.tab, 800);
    await click(CLEAR_MENU.button, 600);
    if (!(await exists(o.item))) {
      rows.push({ name: `${o.name}: clears only its kind`, kind: 'clear', result: `skipped: not in this build (introduced by ${CLEAR_MENU.introducedBy})`, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a' } });
      console.log(`skip  ${o.name.padEnd(48)} not in this build (introduced by ${CLEAR_MENU.introducedBy})`);
      continue;
    }
    await click(o.item, 800);
    if (o.confirm === 'ok') await js(`(()=>{ document.querySelector(${JSON.stringify(CLEAR_MENU.confirmOk)})?.click(); return 1; })()`);
    if (o.confirm === 'keep') await js(`(()=>{ const ok=document.querySelector(${JSON.stringify(CLEAR_MENU.confirmOk)}); const keep=[...(ok?.parentElement?.querySelectorAll('button')||[])].find((b)=>b!==ok); keep?.click(); return 1; })()`);
    await sleep(2500); // the frame clear re-lays after its 350 ms settle; bricks re-lay at once
    const f1 = await clearFingerprint();
    const problems = [];
    for (const k of clearKinds()) {
      if (o.clears.includes(k)) { if (!f1[k].empty) problems.push(`${k} not cleared`); }
      else if (o.changes.includes(k)) { if (f1[k].empty) problems.push(`${k} gone`); }
      else if (f1[k].hash !== f0[k].hash) problems.push(`${k} changed`);
    }
    clearRow(`${o.name}: clears only its kind`, !problems.length,
      problems.length ? problems.join('; ') : `cleared [${o.clears.join(', ')}]${o.changes.length ? `, re-laid [${o.changes.join(', ')}]` : ''}, the rest identical`);
    await shot(`clear_${o.item}_${o.confirm || 'run'}`);
    if (o.undo === false || !o.clears.length) continue;
    await key('z'); await sleep(2500);
    const f2 = await clearFingerprint();
    const notBack = clearKinds().filter((k) => f2[k].hash !== f0[k].hash);
    clearRow(`${o.name}: one undo restores all`, !notBack.length, notBack.length ? `not restored: ${notBack.join(', ')}` : 'every kind back as seeded');
  }
}
