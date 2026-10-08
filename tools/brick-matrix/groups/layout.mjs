// Brick matrix group 'layout': Generate fully visible at drawer PEEK height.
// Declared rows / constants for this group live HERE; run.mjs only drives them (tools/brick-matrix/groups/index.mjs).

// ---- layout (Fred, live: "Wall is missing the generate button"): in the drawer layout (phone, or a Fusion
// palette docked narrower than editor/breakpoints.js MOBILE_MAX_PX) the drawer opens at PEEK height; the
// tool's Generate must still show IN FULL there. One row per viewport x tool.
export const PEEK_LAYOUT = {
  viewports: [
    { name: 'phone 390x844', width: 390, height: 844, mobile: true },
    { name: 'palette 700x850', width: 700, height: 850, mobile: false },
    { name: 'palette 880x850', width: 880, height: 850, mobile: false },
  ],
  tools: ['wall', 'frame'],
  element: 'brickGenerate',
};

// ---- panel fit (item 74, seat D, measured: at 1366 the Photo crop row's W/H sat off its 220 px panel, x 1368-1508): each
// declared control (its JS-wrapped stepper when it has one) lies fully inside its nearest scrolling ancestor. One row per
// viewport x section; `open` = the clicks that show the section.
export const PANEL_FIT = {
  viewports: [{ name: 'desktop 1366x900', width: 1366, height: 900 }, { name: 'narrow 900x900', width: 900, height: 900 }],
  sections: [
    { name: 'Photo crop', open: ['editorTabPhoto', 'photoTab_source'], ids: ['photoCropX', 'photoCropY', 'photoCropW', 'photoCropH', 'photoBtnApplyCrop'] },
    // item 74e: the "Applies on the next Generate" line over each lattice panel's next-Generate group
    { name: 'Lattice next-Generate hint', open: ['editorTabArtwork', 'artTab_lattice', 'toolLattice'], ids: ['latticeNextGenerateHint'] },
    { name: 'Shape Lattice next-Generate hint', open: ['editorTabArtwork', 'artTab_shape', 'toolShapeLattice'], ids: ['shapeLatticeNextGenerateHint'] },
    // item 74j: the four segment-style choices fit their row (measured: "Kink" was clipped at 1366)
    { name: 'Shape segment styles', open: ['editorTabArtwork', 'artTab_shape', 'toolShapeLattice'], ids: ['shapeSegStyleAuto', 'shapeSegStyleStraight', 'shapeSegStyleCurve', 'shapeSegStyleKink'],
      unfold: ['shapeLatticeSegmentsBlock'] }, // folded by default when narrow: opened by its label, as a user does
  ],
};

// ---- item 74h (Fred: grey + explain): a lattice rails anchor is greyed while it would lay the same rails as the current
// one. T1, after a Generate: the Box Lattice at 1 in greys Start / End (Center current), at `liveSpacing` none; the Shape
// Lattice's span differs, so none greys there (measured, seat D). `why` = the tooltip shown on a greyed anchor.
export const ANCHOR_GREY = {
  why: 'Same rails as the current anchor at this spacing', liveSpacing: 0.75,
  panels: [
    { name: 'Lattice', open: ['editorTabArtwork', 'artTab_lattice', 'toolLattice'], generate: 'latticeGenerate', prefix: 'lattice', greyAt1: ['Start', 'End'] },
    { name: 'Shape Lattice', open: ['editorTabArtwork', 'artTab_shape', 'toolShapeLattice'], generate: 'shapeLatticeGenerate', prefix: 'shapeLattice', greyAt1: [] },
  ],
};

// ---- item 74i: with the Shape Lattice's "Offset from frame" on, the Size / Shape / Segments blocks are inert (F21) and a
// declared line says why. Driven with REAL pointer input (advisor: a scripted click bypasses inert -- 74g's false finding).
export const FOLLOWS_FRAME = {
  open: ['editorTabArtwork', 'artTab_shape', 'toolShapeLattice'], toggle: 'shapeLatticeContourFromFrame', note: 'shapeLatticeFollowsFrameNote',
  text: 'The shape follows the frame while Offset from frame is on', blocks: ['shapeLatticeShapeBlock', 'shapeLatticeSegmentsBlock'], probe: 'shapeSegStyleCurve',
};

// ---- Brick-tab v2 (Fred, 2026-10-07: "sections are unique"; "organise the params into actual sections"): per viewport x
// Brick tab, the shown section titles are unique, every shown control of the tab sits in a shown section (the tab's
// chrome excepted: `outside`), and no section runs past the panel's right edge. The sections themselves are the app's
// declaration (main/brick-tab-sections.js BRICK_TAB_SECTIONS); this only checks what the page shows.
export const BRICK_SECTIONS_LAYOUT = {
  viewports: [
    { name: 'desktop 1366x900', width: 1366, height: 900, mobile: false },
    { name: 'narrow 900x900', width: 900, height: 900, mobile: false },
    { name: 'phone 390x844', width: 390, height: 844, mobile: true },
  ],
  tabs: ['brickTab_general', 'brickTool_wall', 'brickTool_frame', 'brickTool_brush', 'brickTool_raisedBrush'],
  outside: '#editorToolbarBrick, #brickLayersSlot, .sticky-actions, [id^="brickSubTools_"], #brickWallAreaRow, #brickEditorLayWarnings',
};

// ---- 2026-10-07 (seat A): at phone width the sidebar's board size stays reachable WHILE the editor is open; the open
// editor follows the new board in place (app-init _resyncEditorToStock): its own board, and the SVG download's size.
export const BOARD_FOLLOWS = {
  viewport: { name: 'phone 390x844', width: 390, height: 844, mobile: true },
  from: [7, 9], to: [9, 12], dpi: 96,
};

// ---- touch targets (Fred, 2026-10-08, "yes, all controls"; seat D): on a phone (coarse pointer) every shown control in the
// editor -- the Art tabs and the Brick tabs -- has its smaller side >= minPx (styles/editor.css --touch-target-min). A
// checkbox counts by its label (the label row is the target); `skip` = not a tap target of its own (a range slider's
// thumb is; the colour input sits under its own toggle). One row per tab.
export const TOUCH_TARGETS = {
  viewport: { name: 'phone 390x844', width: 390, height: 844, mobile: true },
  minPx: 28,
  artTabs: ['general', 'draw', 'lattice', 'shape', 'text', 'edit'],
  brickTabs: ['brickTab_general', 'brickTool_wall', 'brickTool_frame', 'brickTool_brush', 'brickTool_raisedBrush', 'brickTool_scissors'],
  skip: 'input[type="range"], #editorColor, input[type="hidden"]',
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key, checkRow;
export function bind(ctx) { ({ sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key, checkRow } = ctx); }
export async function run() { await runLayout(); await runPanelFit(); await runAnchorGrey(); await runFollowsFrame(); await runBrickSections(); await runBoardFollows(); await runTouchTargets(); }

// ---------------------------------------------------------------- layout (hoisted)
// Layout rows judge only a SETTLED page (the advisor's loaded --parallel gate measured mid-boot and mid-re-snap):
// the Brick tab really active, the drawer really in its fixed (drawer) layout and not dragging, the tool
// really active, and Generate's rect unchanged over SETTLE_SAMPLES polls (> the drawer's 0.18s snap transition).
// (the Brick panel itself stays hidden until a tool is picked, so readiness is the editor + the active tab;
// the per-tool settle below then requires Generate to have a real box)
function brickTabReady() { return js(`!!window.svgEditor?._sketchLayer && !!document.getElementById('editorTabBrick')?.classList.contains('active')`); }
function LAYOUT_PROBE(tool) { return `JSON.stringify((()=>{ const g=document.getElementById(${JSON.stringify(PEEK_LAYOUT.element)}); const d=document.getElementById('editorMobileDrawer');
  const b=g ? g.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), innerW: innerWidth, innerH: innerHeight,
    drawerLayout: !!d && getComputedStyle(d).position === 'fixed', dragging: !!d && d.classList.contains('is-dragging'), peek: !!d && d.classList.contains('is-peek'),
    toolActive: !!document.getElementById(${JSON.stringify('brickTool_' + tool)})?.classList.contains('active'),
    shownPx: Math.round(Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0))) }; })())`; }
async function settledLayout(tool) {
  const SETTLE_SAMPLES = 4, SETTLE_POLL_MS = 300, SETTLE_MAX_MS = 20000;
  let last = null, same = 0, r = null;
  for (let t = 0; t < SETTLE_MAX_MS; t += SETTLE_POLL_MS) {
    r = (await jsJSON(LAYOUT_PROBE(tool)));
    const ready = r.drawerLayout && !r.dragging && r.toolActive && r.h > 0;
    const key = `${r.top}/${r.h}/${r.innerW}`;
    same = ready && key === last ? same + 1 : 0; last = key;
    if (same >= SETTLE_SAMPLES - 1) return { r, settled: true };
    await sleep(SETTLE_POLL_MS);
  }
  return { r, settled: false };
}
async function runLayout() {
  for (const vp of PEEK_LAYOUT.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    let ready = false;
    for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
      if (attempt > 1) console.log(`layout ${vp.name}: Brick tab not up, attempt ${attempt}`);
      await send('Page.reload', {}); await waitApp();
      await openBrickTab(); ready = await brickTabReady();
    }
    for (const tool of PEEK_LAYOUT.tools) {
      for (let i = 0; i < 3 && !(await js(`!!document.getElementById(${JSON.stringify('brickTool_' + tool)})?.classList.contains('active')`)); i++) await click(`brickTool_${tool}`, 1000);
      const { r, settled } = await settledLayout(tool);
      const ok = settled && r.top >= 0 && r.bottom <= r.innerH + 0.5;
      const name = `Peek ${vp.name}: ${tool} Generate fully shown`;
      rows.push({ name, kind: 'layout', result: settled ? 'ok' : 'setup: page never settled (see observed)', observed: r,
        verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', layout: ok ? 'PASS' : 'FAIL' } });
      console.log(`${ok ? 'pass' : 'FAIL'}  Peek ${vp.name}: ${tool} Generate`.padEnd(54) + (settled ? ` ${r.shownPx}/${r.h} px shown, bottom ${r.bottom} of ${r.innerH}${r.peek ? ' (drawer at peek)' : ''}`
        : ` NOT SETTLED ${JSON.stringify(r)}`));
      if (!ok) await shot(`FAIL_peek_${vp.width}_${tool}`);
    }
  }
}

function PANEL_FIT_PROBE(ids) { return `JSON.stringify(${JSON.stringify(ids)}.map((id)=>{ const e=document.getElementById(id); if(!e) return { id, missing: true };
  const box=e.closest('.cad-stepper') || e; let a=box.parentElement; while (a && a!==document.body && getComputedStyle(a).overflowX==='visible') a=a.parentElement;
  const b=box.getBoundingClientRect(), r=(a||document.body).getBoundingClientRect();
  return { id, shown: b.width>0 && b.height>0, left: Math.round(b.left), right: Math.round(b.right), panel: (a&&a.id)||'body', pLeft: Math.round(r.left), pRight: Math.round(r.right),
    inside: b.left >= r.left - 0.5 && b.right <= r.right + 0.5 }; }))`; }
async function runPanelFit() {
  for (const vp of PANEL_FIT.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
    await send('Page.reload', {}); await waitApp(); await openBrickTab();
    for (const sec of PANEL_FIT.sections) {
      for (const id of sec.open) await click(id, 900);
      for (const id of sec.unfold || []) await js(`(()=>{ const b=document.getElementById(${JSON.stringify(id)}); const body=b && b.firstElementChild && b.firstElementChild.nextElementSibling; if (body && body.offsetParent === null) b.firstElementChild.click(); return 1; })()`);
      if (sec.unfold) await sleep(600);
      const r = await jsJSON(PANEL_FIT_PROBE(sec.ids));
      const ok = r.every((c) => !c.missing && c.shown && c.inside);
      const name = `Panel fit ${vp.name}: ${sec.name} fields inside the panel`;
      rows.push({ name, kind: 'layout', result: 'ok', observed: r, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', layout: ok ? 'PASS' : 'FAIL' } });
      const bad = r.filter((c) => c.missing || !c.shown || !c.inside);
      console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`.padEnd(70) + (ok ? '' : ` ${JSON.stringify(bad)}`));
      if (!ok) await shot(`FAIL_panelfit_${vp.width}_${sec.name.replace(/\W+/g, '_')}`);
    }
  }
}

async function runAnchorGrey() {
  const A = ANCHOR_GREY;
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload', {}); await waitApp(); await openBrickTab();
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); s.value='template_1'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  const row = (prefix) => jsJSON(`JSON.stringify(Object.fromEntries(['Start','Center','End'].map((a)=>{ const b=document.getElementById(${JSON.stringify(prefix)}+'RailsAnchor'+a); return [a, { grey: !!b?.disabled, title: b?.title || '' }]; })))`);
  const spacing = (prefix, v) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(prefix)}+'RailsSpacing'); e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); return 1; })()`);
  for (const pn of A.panels) {
    for (const id of pn.open) await click(id, 700);
    await click(pn.generate, 3500);
    const r1 = await row(pn.prefix);
    const greyed = Object.keys(r1).filter((a) => r1[a].grey);
    const ok1 = JSON.stringify(greyed) === JSON.stringify(pn.greyAt1) && greyed.every((a) => r1[a].title === A.why);
    checkRow('layout', `Anchor grey: ${pn.name} on T1 at 1 in greys ${pn.greyAt1.join(' + ') || 'none'}`, ok1, `greyed: ${greyed.join(', ') || 'none'}${greyed.length ? ` ("${r1[greyed[0]].title}")` : ''}`);
    await spacing(pn.prefix, A.liveSpacing); await sleep(600);
    const r2 = await row(pn.prefix); const g2 = Object.keys(r2).filter((a) => r2[a].grey);
    checkRow('layout', `Anchor grey: ${pn.name} at ${A.liveSpacing} in -- every anchor live`, g2.length === 0, `greyed: ${g2.join(', ') || 'none'}`);
    await spacing(pn.prefix, 1); await sleep(400);
  }
}

async function runFollowsFrame() {
  const F = FOLLOWS_FRAME;
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.reload', {}); await waitApp(); await openBrickTab();
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); s.value='template_1'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  for (const id of F.open) await click(id, 700);
  const realClick = async (id) => {
    const r = await jsJSON(`JSON.stringify((()=>{ const e=document.getElementById(${JSON.stringify(id)}); e.scrollIntoView({block:'center'}); const b=e.getBoundingClientRect(); return { x: b.left + b.width/2, y: b.top + b.height/2 }; })())`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', buttons: 0, clickCount: 1 }); await sleep(900);
  };
  const state = () => jsJSON(`JSON.stringify((()=>{ const n=document.getElementById(${JSON.stringify(F.note)}); return { on: document.getElementById(${JSON.stringify(F.toggle)}).checked,
    shown: !!n && n.offsetParent !== null, text: n ? n.textContent : '', inert: ${JSON.stringify(F.blocks)}.map((id)=>!!document.getElementById(id)?.inert),
    probeActive: document.getElementById(${JSON.stringify(F.probe)}).classList.contains('active'), steps: window.svgEditor._undoStack.length }; })())`);
  const s0 = await state();
  await realClick(F.probe); const s1 = await state();
  checkRow('layout', 'Follows frame: while Offset from frame is on, the line says why and the blocks ignore a real click',
    s0.on && s0.shown && s0.text === F.text && s0.inert.every(Boolean) && !s1.probeActive && s1.steps === s0.steps,
    `on ${s0.on}, line ${s0.shown ? 'shown' : 'HIDDEN'} "${s0.text}", inert ${s0.inert}, real click on ${F.probe}: ${s1.probeActive ? 'TOOK' : 'ignored'}, steps +${s1.steps - s0.steps}`);
  await realClick(F.toggle); const s2 = await state();
  checkRow('layout', 'Follows frame: Offset from frame off -- the line hides, the blocks are live',
    !s2.on && !s2.shown && s2.inert.every((x) => !x), `on ${s2.on}, line ${s2.shown ? 'SHOWN' : 'hidden'}, inert ${s2.inert}`);
}

// ---------------------------------------------------------------- Brick-tab v2 sections
const BRICK_SECTIONS_PROBE = (outside) => `JSON.stringify((()=>{
  const panel = document.getElementById('editorBrickPanel'); const pr = panel.getBoundingClientRect();
  const shown = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const secs = [...panel.querySelectorAll('.brick-sec')].filter(shown);
  const titles = secs.map((s) => s.querySelector('.panel-header').textContent.trim());
  const stray = [...panel.querySelectorAll('input, select, button, textarea')].filter(shown)
    .filter((c) => !c.closest(${JSON.stringify(outside)}) && !c.closest('.brick-sec')).map((c) => c.id || c.textContent.trim().slice(0, 20));
  const spill = secs.filter((s) => s.getBoundingClientRect().right > pr.right + 1).map((s) => s.id);
  return { titles, stray, spill };
})())`;
async function runBrickSections() {
  const L = BRICK_SECTIONS_LAYOUT;
  for (const vp of L.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: !!vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: !!vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    await send('Page.reload', {}); await waitApp(); await openBrickTab();
    for (const tab of L.tabs) {
      await click(tab, 900);
      const r = await jsJSON(BRICK_SECTIONS_PROBE(L.outside));
      const unique = new Set(r.titles).size === r.titles.length;
      const ok = r.titles.length > 0 && unique && r.stray.length === 0 && r.spill.length === 0;
      checkRow('layout', `Brick sections ${vp.name}: ${tab.replace(/^brick(Tab|Tool)_/, '')} -- unique titles, every control in a section, none past the edge`, ok,
        `titles: ${r.titles.join(' / ')}${r.stray.length ? `; outside a section: ${r.stray.join(', ')}` : ''}${r.spill.length ? `; past the edge: ${r.spill.join(', ')}` : ''}`);
      if (!ok) await shot(`FAIL_bricksections_${vp.width}_${tab}`);
    }
  }
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

// ---------------------------------------------------------------- the open editor follows a board change (phone)
async function runBoardFollows() {
  const B = BOARD_FOLLOWS;
  await send('Emulation.setDeviceMetricsOverride', { width: B.viewport.width, height: B.viewport.height, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.reload', {}); await waitApp(); await openBrickTab();
  const setBoard = ([w, h]) => js(`(async () => { for (const [id, v] of [['widthIn', ${w}], ['heightIn', ${h}]]) { const e = document.getElementById(id);
    e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }
    await new Promise((r) => setTimeout(r, 1500)); return 1; })()`);
  await setBoard(B.from);
  await js(`(async () => { const m = document.getElementById('svgEditorModal'); if (!m || m.style.display === 'none') document.getElementById('btnStampEdit').click();
    for (let i = 0; i < 60 && !window.svgEditor?._draw; i++) await new Promise((r) => setTimeout(r, 250));
    await new Promise((r) => setTimeout(r, 1500)); return 1; })()`);
  await setBoard(B.to);
  const r = await jsJSON(`(async () => { const ed = window.svgEditor; const io = await import('./editor/editor-io.js');
    const head = ((await io.saveSvgDownload(ed)).match(/<svg[^>]*>/) || [''])[0];
    const m = document.getElementById('svgEditorModal');
    const view = await import('./editor/editor-view.js'); const fp = await import('./editor/editor-frame-profile.js');
    // "whole board" = what a fresh open shows: the frame's cut region (FB-APP F7) or, with no frame, the board
    const vb = ed._draw.viewbox(); const t = 1e-6; const g = fp.frameFitRegion(ed) || { x: 0, y: 0, w: ed._mW, h: ed._mH };
    const wholeBoard = vb.x <= g.x + t && vb.y <= g.y + t && vb.x + vb.width >= g.x + g.w - t && vb.y + vb.height >= g.y + g.h - t;
    return JSON.stringify({ open: !!(m && m.style.display !== 'none'), mW: ed._mW, mH: ed._mH, wholeBoard, fitted: view.isFittedView(ed),
      vb: [vb.x, vb.y, vb.width, vb.height].map((n) => +n.toFixed(3)),
      w: +(head.match(/ width="([^"]+)"/) || [])[1], h: +(head.match(/ height="([^"]+)"/) || [])[1], dlvb: (head.match(/viewBox="([^"]+)"/) || [])[1] }); })()`);
  const [W, H] = B.to;
  const ok = r.open && r.mW === W && r.mH === H && r.w === W * B.dpi && r.h === H * B.dpi && r.dlvb === `0 0 ${W} ${H}` && r.wholeBoard && r.fitted;
  checkRow('layout', `Board change with the editor open (${B.viewport.name}): the editor, its view (whole board, fitted) and the SVG download follow ${B.from.join('x')} -> ${W}x${H}`, ok,
    `editor open ${r.open}, editor board ${r.mW}x${r.mH}, view ${r.vb.join(' ')} (whole board ${r.wholeBoard}, fitted ${r.fitted}), download ${r.w}x${r.h} viewBox ${r.dlvb}`);
  if (!ok) await shot('FAIL_board_follows_phone');
  await setBoard(B.from);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}


// ---------------------------------------------------------------- touch targets (phone, coarse pointer)
function TOUCH_PROBE(minPx, skip) { return `JSON.stringify((() => { const m = document.getElementById('svgEditorModal'); const small = [];
  for (const e of m.querySelectorAll('button, input, select, [role="tab"]')) {
    if (e.matches(${JSON.stringify(skip)}) || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
    const t = (e.type === 'checkbox' && e.closest('label')) || e, r = t.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const px = Math.round(Math.min(r.width, r.height) * 10) / 10;
    if (px < ${minPx}) small.push((e.id || e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 16) || e.className) + ' ' + px + 'px');
  }
  return { coarse: matchMedia('(pointer: coarse)').matches, small: [...new Set(small)] }; })())`; }
async function runTouchTargets() {
  const T = TOUCH_TARGETS, vp = T.viewport;
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await send('Page.reload', {}); await waitApp(); await openBrickTab();
  const tabs = [...T.brickTabs.map((id) => ({ name: id.replace(/^brick(Tab|Tool)_/, 'Brick '), open: [id] })),
    ...T.artTabs.map((t) => ({ name: `Art ${t}`, open: ['editorTabArtwork', `artTab_${t}`] }))];
  for (const tab of tabs) {
    let opened = true;
    for (const id of tab.open) opened = (await click(id, 900)) === 'ok' && opened;
    const r = await jsJSON(TOUCH_PROBE(T.minPx, T.skip));
    const ok = opened && r.coarse && r.small.length === 0;
    checkRow('layout', `Touch targets ${vp.name} (coarse pointer): ${tab.name} -- every control >= ${T.minPx} px`, ok,
      `${opened ? '' : 'tab did not open; '}${r.coarse ? '' : 'coarse pointer NOT emulated; '}${r.small.length ? `under ${T.minPx} px: ${r.small.join(', ')}` : 'none under'}`);
    if (!ok) await shot(`FAIL_touch_${tab.name.replace(/\s+/g, '_')}`);
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}
