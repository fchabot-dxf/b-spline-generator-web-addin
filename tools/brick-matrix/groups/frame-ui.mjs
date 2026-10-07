// Brick matrix group 'frame-ui': frame corners + per-element accents.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { set } from './_shared.mjs';
import { MIGRATION } from './migration.mjs';

// ---- group setup pins (advisor, 2026-10-05): what a group's rows depend on is declared, never the new-board default.
// The frame group's rows were measured at 1 in; the default moving to 1.25 in (37, 124b799) made T1 7x9 three soldier
// bands fill the board (B1's empty wall) and failed "Frame Set: Red Brick, the rock wall stays" -- a default leaking
// into a fixture, the same class as MIGRATION's neutral set. Applied when the group runs on its own (--parallel = the
// gate); an all-groups run shares one baseline with the wall group's own size rows, so it is left as is.
export const setup =
  // T86 item 28: frame-ui accents band 1 of three_band after its rock-frame row, so three ROCK rings (0.75 + 0.6 +
  // 0.75 in, declared widths that no brick size changes). On a 7x9 the fit rule keeps one ring at a 1/3 share; on a
  // 9x12 two fit under 1/3 and 1/2 alike (T1's narrowest gap 4.96 in). runFrameUi's own reload keeps the board.
  [
    { set: 'widthIn', value: 9, event: 'change', why: 'band 1 of three rock rings exists on a 9x12 board' },
    { set: 'heightIn', value: 12, event: 'change', why: 'band 1 of three rock rings exists on a 9x12 board' },
  ];

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let HERE, sleep, send, js, jsJSON, click, setValue, exists, CANVAS, heightsSettled, canvasSettled, editorOpen, apply, waitApp, checkRow, openEditorTab, reloadWithSession, drag;
export function bind(ctx) { ({ HERE, sleep, send, js, jsJSON, click, setValue, exists, CANVAS, heightsSettled, canvasSettled, editorOpen, apply, waitApp, checkRow, openEditorTab, reloadWithSession, drag } = ctx); }
export async function run() { await runFrameUi(); }

// Seat 37: item 33 (fb-app f0e3728, the Frame's Corners row) and per-element accents (ed618f3). Expected values are
// read from the app's OWN declarations in the page (editor-brick-tool.js FRAME_CORNERS / FOLDED_FRAME_PRESETS /
// frameCornerOf, core FRAME_PRESETS) -- never copied numbers.
function frameUiState() {
  return `(async()=>{ const T=await import('./editor/editor-brick-tool.js'); const { P } = await import('./core/state.js'); const L=await import('./core/bricks/library.js');
    const list=document.getElementById('brickFrameCornerList'); const s=P.brickSettings||{};
    const frames=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')];
    return JSON.stringify({ corners: T.FRAME_CORNERS.map((c)=>c.id), folded: T.FOLDED_FRAME_PRESETS,
      ownCorner: T.frameCornerOf(s), preset: s.frameBandPreset, pick: s.frameCorner ?? null,
      presetCorners: Object.fromEntries(Object.entries(L.FRAME_PRESETS).map(([k,b])=>[k,(b[0]&&b[0].cornerStyle)||'mitre'])),
      listShown: !!list && list.offsetParent !== null && getComputedStyle(list).display !== 'none',
      buttons: list ? list.querySelectorAll('[id^="brickFrameCorner_"]').length : 0,
      active: list ? [...list.querySelectorAll('[id^="brickFrameCorner_"].active')].map((b)=>b.id.replace('brickFrameCorner_','')) : [],
      frames: frames.length, flat: frames.filter((n)=>!String(n.getAttribute('fill')||'').startsWith('url(')).length }); })()`;
}
async function frameUiRead() { return jsJSON(frameUiState()); }
async function relaid(before) { return (await canvasSettled(before)) !== before; }

async function runFrameUi() {
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900);
  if (!(await exists('brickFrameCornerList'))) { checkRow('frame-ui', 'Corners row', false, '', 'f0e3728'); return; }
  await click('brickFramePreset_single_soldier', 2000);
  // 1. Soldier: the row shows every declared corner, the preset's own (Mitre) active
  let st = await frameUiRead();
  checkRow('frame-ui', 'Corners: Soldier shows every corner, its own active', st.listShown && st.buttons === st.corners.length && st.active.length === 1 && st.active[0] === st.presetCorners.single_soldier,
    `shown ${st.listShown}, ${st.buttons}/${st.corners.length} buttons, active ${st.active.join(',')} (preset's own: ${st.presetCorners.single_soldier})`);
  // 2. each other corner re-lays the frame at once and becomes the active one
  for (const id of st.corners.filter((c) => c !== st.presetCorners.single_soldier)) {
    const before = await js(CANVAS);
    await click(`brickFrameCorner_${id}`, 400);
    const moved = await relaid(before);
    const s2 = await frameUiRead();
    checkRow('frame-ui', `Corners: ${id} re-lays the frame at once`, moved && s2.active[0] === id && s2.frames > 0,
      `re-laid ${moved}, active ${s2.active.join(',')}, ${s2.frames} frame bricks${id === 'block' ? `, ${s2.flat} without a texture` : ''}`);
    if (id === 'block') checkRow('frame-ui', 'Corners: quoin blocks wear the frame texture', s2.flat === 0, `${s2.flat} of ${s2.frames} frame bricks drawn flat (quoin-element-set)`);
  }
  // 3. a preset with its own corner: picking it shows that corner; a pick is dropped on a preset change
  const twoBand = Object.entries(st.presetCorners).find(([k, c]) => c !== 'mitre' && !(k in st.folded) && k !== 'none');
  if (twoBand) {
    await click(`brickFramePreset_${twoBand[0]}`, 2000);
    const s3 = await frameUiRead();
    checkRow('frame-ui', `Corners: ${twoBand[0]} shows its own corner`, s3.active[0] === twoBand[1], `active ${s3.active.join(',')}, preset's own ${twoBand[1]}`);
  }
  await click('brickFrameCorner_butt', 1500);
  await click('brickFramePreset_single_soldier', 2000);
  const s4 = await frameUiRead();
  checkRow('frame-ui', 'Corners: a preset change returns to the preset\'s own corner', s4.active[0] === s4.presetCorners.single_soldier && s4.pick === null,
    `after Butt then Soldier: active ${s4.active.join(',')}, pick ${s4.pick}`);
  // 4. no bands, or a rock frame: no corners row
  await click('brickFramePreset_none', 2000);
  const s5 = await frameUiRead();
  checkRow('frame-ui', 'Corners: hidden with no bands', !s5.listShown, `row ${s5.listShown ? 'SHOWN' : 'hidden'}`);
  await click('brickFramePreset_single_soldier', 2000);
  await click('brickFrameBandPattern_0_fieldstone', 2000);
  const s6 = await frameUiRead();
  checkRow('frame-ui', 'Corners: hidden on a rock frame', !s6.listShown, `row ${s6.listShown ? 'SHOWN' : 'hidden'}`);
  // 5. per-element accents (ed618f3): a band's own accent marks only that band; its level moves the relief
  if (await editorOpen()) await apply();
  let Z = await heightsSettled(null);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await click('brickFramePreset_three_band', 2000);
  if (!(await exists('brickAccent_band1_checker'))) { checkRow('frame-ui', 'Accents: band 1', false, '', 'ed618f3'); return; }
  await apply(); Z = await heightsSettled(Z);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await click('brickAccent_band1_checker', 2000);
  const acc = await jsJSON(`JSON.stringify((()=>{ const f=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const by=(b)=>f.filter((n)=>n.getAttribute('data-brick-band')===String(b)); return { b1: by(1).filter((n)=>n.getAttribute('data-brick-accent')==='1').length, b1n: by(1).length, b0: by(0).filter((n)=>n.getAttribute('data-brick-accent')==='1').length }; })())`);
  await apply(); const Z1 = await heightsSettled(Z);
  checkRow('frame-ui', 'Accents: band 1 checker marks band 1 only, 3D moves', acc.b1 > 0 && acc.b0 === 0 && Z1 !== Z, `band 1 outlined ${acc.b1}/${acc.b1n}, band 0 outlined ${acc.b0}, 3D ${Z1 !== Z ? 'changed' : 'UNCHANGED'}`);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await setValue('brickAccentLevel_band1', -0.0625, 'change'); await sleep(1500);
  await apply(); const Z2 = await heightsSettled(Z1);
  checkRow('frame-ui', 'Accents: band 1 level -1/16 moves the relief', Z2 !== Z1, `3D ${Z2 !== Z1 ? 'changed' : 'UNCHANGED'}`);
  // F35 item 58 follow-up: a new preset drops the band accents (stored by band number; item 33's corner precedent)
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await click('brickFramePreset_soldier_stretcher', 2000);
  const dropped = await jsJSON(`(async()=>{ const { P } = await import('./core/state.js'); const n=window.svgEditor._sketchLayer.node;
    return JSON.stringify({ list: P.brickSettings.frameBandAccents, outlined: n.querySelectorAll('[data-brick="frame"][data-brick-accent="1"]').length, frames: n.querySelectorAll('[data-brick="frame"]').length }); })()`);
  checkRow('frame-ui', 'Accents: a new frame preset drops the band accents', Array.isArray(dropped.list) && dropped.list.length === 0 && dropped.outlined === 0 && dropped.frames > 0,
    `band accents ${JSON.stringify(dropped.list)}, ${dropped.outlined}/${dropped.frames} frame bricks outlined`);
  // F35 item 57 (Fred: "always puts them at the bottom, never higher"): a Wall preset reaches the wall's top third
  await click('brickTool_wall', 900); await click('brickAccent_courseBand', 1500);
  const reach = await jsJSON(`JSON.stringify((()=>{ const w=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')];
    const cy=(n)=>{ const q=n.getAttribute('points').trim().split(/\\s+/).map((s)=>Number(s.split(',')[1])); return q.reduce((a,b)=>a+b,0)/q.length; };
    const ys=w.map(cy), top=Math.min(...ys), btm=Math.max(...ys); const hi=w.filter((n)=>n.getAttribute('data-brick-accent')==='1' && (btm-cy(n))/(btm-top) > 2/3);
    return { wall: w.length, high: hi.length }; })())`);
  checkRow('frame-ui', 'Accents: Wall Course bands reach the top third of the wall', reach.wall > 0 && reach.high > 0, `${reach.high} outlined wall bricks in the top third (of ${reach.wall})`);
  await click('brickAccent_none', 1000);
  // 6. the brush's own accent outlines its bricks
  await openEditorTab('editorTabBrick'); await click('brickTool_brush', 900);
  if (await exists('brickAccent_brush_checker')) {
    await click('brickAccent_brush_checker', 800);
    await click('brickTool_brush', 300); await drag([[0.3, 0.5], [0.5, 0.55], [0.7, 0.5]]);
    const br = await jsJSON(`JSON.stringify((()=>{ const b=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="brush"]')]; return { n: b.length, marked: b.filter((n)=>n.getAttribute('data-brick-accent')==='1').length }; })())`);
    checkRow('frame-ui', 'Accents: brush checker outlines brush bricks', br.n > 0 && br.marked > 0, `${br.marked}/${br.n} brush bricks outlined`);
  }
  if (await editorOpen()) await apply();
  // 7. a board saved on a retired corner preset (butt_frame / quoin_corners) restores as its folded preset + corner:
  //    the migration fixture's own session with its preset rewritten, one per FOLDED_FRAME_PRESETS entry
  const folded = await jsJSON(`(async()=>{ const T=await import('./editor/editor-brick-tool.js'); return JSON.stringify(T.FOLDED_FRAME_PRESETS); })()`);
  const session = JSON.parse(readFileSync(path.join(HERE, MIGRATION.fixture), 'utf8'));
  for (const [old, want] of Object.entries(folded)) {
    session.P.brickSettings.frameBandPreset = old;
    await reloadWithSession(MIGRATION.sessionKey, JSON.stringify(session));
    await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
    const st = await frameUiRead();
    checkRow('frame-ui', `Corners: a board saved on ${old} restores as ${want.preset} + ${want.corner}`, st.preset === want.preset && st.ownCorner === want.corner && st.active[0] === want.corner,
      `preset ${st.preset}, corner ${st.ownCorner}, active ${st.active.join(',')}`);
    if (await editorOpen()) await apply();
  }
  await runCornerEffect();
  await runFanCentre();
}

// ---- item 74b (Fred: grey + explain): a corner choice is greyed exactly where it would re-lay the identical frame. On the
// declared board some are greyed (measured: T18 7x9 at 1.25 in, square corners only on 1.11 in stubs); each corner is laid
// through the app's own generateBricks with P.brickSettings.frameCorner set directly (a greyed button can't be clicked),
// and its frame compared with the mitre's: greyed <=> identical. The mitre is never greyed.
export const CORNER_EFFECT_BOARD = { templateId: 'template_18', widthIn: 7, heightIn: 9, brickLengthIn: 1.25 };
async function runCornerEffect() {
  const B = CORNER_EFFECT_BOARD;
  await setValue('widthIn', B.widthIn, 'change'); await setValue('heightIn', B.heightIn, 'change'); await sleep(1500);
  await openEditorTab('editorTabBrick');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); s.value=${JSON.stringify(B.templateId)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); return 1; })()`);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await setValue('brickSize', B.brickLengthIn, 'change'); await sleep(2000);
  await click('brickFramePreset_single_soldier', 2000);
  const r = await jsJSON(`(async()=>{ const { P }=await import('./core/state.js'); const BP=await import('./main/brick-panel.js'); const W=(ms)=>new Promise((r)=>setTimeout(r,ms));
    const hash=()=>{ const s=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')].map((n)=>n.getAttribute('points')).sort().join('|'); let x=2166136261; for (let i=0;i<s.length;i++){ x^=s.charCodeAt(i); x=Math.imul(x,16777619);} return (x>>>0).toString(36)+'/'+s.split('|').length; };
    const grey=Object.fromEntries(['mitre','butt','block','lapped'].map((c)=>[c, !!document.getElementById('brickFrameCorner_'+c)?.disabled]));
    const lay=async(c)=>{ P.brickSettings.frameCorner=c; BP.generateBricks(); await W(2500); return hash(); };
    const laid={}; for (const c of ['mitre','butt','block','lapped']) laid[c]=await lay(c);
    P.brickSettings.frameCorner=null; BP.generateBricks(); await W(2000);
    return JSON.stringify({ grey, laid, title: document.getElementById('brickFrameCorner_butt')?.title || '' }); })()`);
  const cut = ['butt', 'block', 'lapped'];
  const agree = cut.every((c) => r.grey[c] === (r.laid[c] === r.laid.mitre));
  checkRow('frame-ui', 'Corners: greyed exactly where the corner re-lays the identical frame (T18 7x9, 1.25 in)',
    agree && !r.grey.mitre && cut.some((c) => r.grey[c]),
    cut.map((c) => `${c} ${r.grey[c] ? 'greyed' : 'live'}, lay ${r.laid[c] === r.laid.mitre ? 'identical' : 'differs'}`).join('; ') + ` (mitre ${r.grey.mitre ? 'GREYED' : 'live'}; tooltip "${r.title}")`);
}

// ---- T86 item 16e (Fred on the fan mock: "I like them all, add a choice"): the Fan centre row in the Corners section, on
// CORNER_EFFECT_BOARD (T18 7x9 at 1.25 in: 4 corner fans). Each choice re-lays the frame at once (Stone adds one stone per
// fan), a pick is ONE undo step (Undo puts the canvas and the active choice back, Redo forward), and on a frame with no
// fan corner (noFanTemplate) Eye / Stone are greyed with the declared reason, the Needle never.
export const FAN_CENTRE_ROWS = { fans: 4, noFanTemplate: 'template_9' };
const FRAME_HASH = `(()=>{ const n=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const s=n.map((x)=>x.getAttribute('points')).sort().join('|'); let h=2166136261; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return JSON.stringify({ hash: (h>>>0).toString(36), count: n.length }); })()`;
async function fanState() {
  const f = await jsJSON(FRAME_HASH);
  return { ...f, ...(await jsJSON(`(async()=>{ const { P }=await import('./core/state.js'); const R=await import('./main/brick-control-requires.js');
    const list=document.getElementById('brickFrameFanCentreList'), row=document.getElementById('brickFrameFanCentreRow'), corners=document.getElementById('brickFrameCornerRow');
    const btn=(id)=>document.getElementById('brickFrameFanCentre_'+id);
    return JSON.stringify({ pick: P.brickSettings.frameFanCentre ?? null, buttons: list ? list.querySelectorAll('button').length : 0,
      shown: !!list && list.offsetParent !== null, sameSection: !!row && !!corners && row.parentElement === corners.parentElement,
      active: ['needle','eye','stone'].filter((id)=>btn(id)?.classList.contains('active')),
      grey: Object.fromEntries(['needle','eye','stone'].map((id)=>[id, !!btn(id)?.disabled])), why: R.FAN_CENTRE_NO_FAN, eyeTitle: btn('eye')?.title || '' }); })()`)) };
}
async function runFanCentre() {
  const R = FAN_CENTRE_ROWS;
  if (!(await exists('brickFrameFanCentreList'))) { checkRow('frame-ui', 'Fan centre row', false, '', 'T86 16e'); return; }
  const s0 = await fanState();
  checkRow('frame-ui', 'Fan centre: in the Corners section, Needle | Eye | Stone, Needle active', s0.shown && s0.sameSection && s0.buttons === 3 && s0.active.join() === 'needle' && s0.pick === null,
    `shown ${s0.shown}, same section as Corners ${s0.sameSection}, ${s0.buttons} buttons, active ${s0.active.join(',')}, pick ${s0.pick}`);
  await click('brickFrameFanCentre_eye', 400); await sleep(2500);
  const s1 = await fanState();
  checkRow('frame-ui', 'Fan centre: Eye re-lays the frame at once', s1.hash !== s0.hash && s1.active.join() === 'eye' && s1.count === s0.count,
    `frame ${s1.hash === s0.hash ? 'UNCHANGED' : 'changed'}, active ${s1.active.join(',')}, ${s0.count} -> ${s1.count} pieces`);
  await click('brickFrameFanCentre_stone', 400); await sleep(2500);
  const s2 = await fanState();
  checkRow('frame-ui', `Fan centre: Stone re-lays at once, one stone per fan (${R.fans})`, s2.hash !== s1.hash && s2.active.join() === 'stone' && s2.count === s1.count + R.fans,
    `frame ${s2.hash === s1.hash ? 'UNCHANGED' : 'changed'}, active ${s2.active.join(',')}, ${s1.count} -> ${s2.count} pieces`);
  await click('editorUndo', 2500);
  const u = await fanState();
  await click('editorRedo', 2500);
  const r = await fanState();
  checkRow('frame-ui', 'Fan centre: a pick is one undo step (Undo back to Eye, Redo to Stone)', u.hash === s1.hash && u.active.join() === 'eye' && r.hash === s2.hash && r.active.join() === 'stone',
    `undo: ${u.hash === s1.hash ? 'Eye frame' : 'OTHER frame'}, active ${u.active.join(',')}; redo: ${r.hash === s2.hash ? 'Stone frame' : 'OTHER frame'}, active ${r.active.join(',')}`);
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); s.value=${JSON.stringify(R.noFanTemplate)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); return 1; })()`);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900); await sleep(1500);
  const g = await fanState();
  checkRow('frame-ui', `Fan centre: greyed with no fan corner (${R.noFanTemplate}), the Needle live`, g.grey.eye && g.grey.stone && !g.grey.needle && g.eyeTitle === g.why,
    `eye ${g.grey.eye ? 'greyed' : 'LIVE'}, stone ${g.grey.stone ? 'greyed' : 'LIVE'}, needle ${g.grey.needle ? 'GREYED' : 'live'}; tooltip "${g.eyeTitle}"`);
  await js(`(async()=>{ const { P }=await import('./core/state.js'); const BP=await import('./main/brick-panel.js'); P.brickSettings.frameFanCentre=null; BP.generateBricks(); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
}
