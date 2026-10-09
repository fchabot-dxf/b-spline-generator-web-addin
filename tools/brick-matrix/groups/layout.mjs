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
  from: [7, 9], to: [9, 12],
};

// ---- touch targets (Fred, 2026-10-08, "yes, all controls"; seat D): on a phone (coarse pointer) every shown control -- the
// main sidebar's tabs (their collapsed panels opened), the editor's Brick / Art / Frame / Photo tabs -- has its smaller side
// >= minPx (styles/editor.css --touch-target-min) and lies on screen (the bigger targets push nothing past the right
// edge; advisor: the narrow phone too). A checkbox counts by its label (the label row is the target); `skip` = not a tap
// target of its own (a range slider's thumb is; the colour input sits under its own toggle). One row per viewport x tab.
export const TOUCH_TARGETS = {
  viewports: [{ name: 'phone 390x844', width: 390, height: 844 }, { name: 'narrow phone 360x780', width: 360, height: 780 }],
  minPx: 28,
  sidebarTabs: ['board', 'surface', 'decor', 'output'],
  brickTabs: ['brickTab_general', 'brickTool_wall', 'brickTool_frame', 'brickTool_brush', 'brickTool_raisedBrush', 'brickTool_scissors'],
  artTabs: ['general', 'draw', 'lattice', 'shape', 'text', 'edit'],
  photoTools: [['source', 'crop'], ['source', 'straighten'], ['source', 'rotateFlip'], ['adjust', 'levels'], ['adjust', 'blur']],
  skip: 'input[type="range"], #editorColor, input[type="hidden"], input[type="color"]',
};

// ---- the page never pinch-zooms; only the drawing does (Fred 2026-10-08, "stop page zoom"; seat D). MEASURED on
// 102eb01: a pinch that started off the drawing (on the old Expand tip) was the browser's -- the whole app page zoomed
// x2.94. One row per piece of app chrome (page scale stays 1) plus the drawing itself (its view zooms, the page not).
// Real CDP touch on a coarse-pointer phone. `editor`: the chrome lives in the open editor (else the editor is closed).
export const PAGE_ZOOM = {
  viewport: { name: 'phone 390x844', width: 390, height: 844 },
  chrome: [{ name: 'sidebar', sel: '.cad-sidebar', editor: false }, { name: 'editor toolbar', sel: '#editorToolbarTop', editor: true },
    { name: 'drawer', sel: '#editorMobileDrawer', editor: true }],
  minZoom: 1.2, // the drawing's pinch spreads the fingers ~1:3: its view must zoom in at least this much
};
// ---- the 3D preview under real fingers (seat D 2026-10-08, page zoom off): a pinch zooms the model, a two-finger drag
// pans it, one finger orbits -- read from the preview's own orbit target (window.__preview). MEASURED on 9b10ecc: no
// pinch or pan worked near the middle -- the view cube's 160 px canvas over the top-right corner took the second
// finger's touchstart, so the preview never began the pinch. The pinch row puts its second finger ON the cube.
// maxJumpDeg: lifting one finger of a pinch -- the other one then moved a few px orbits only a little (the stale start of
// the first finger used to jump the view, the 2D editor's old release jump).
export const PREVIEW_3D = { sel: '#previewCanvas', maxZoomRatio: 0.8, minPan: 0.05, minOrbitDeg: 10, maxJumpDeg: 5 };

// ---- the Expand tip is gone (Fred 2026-10-08, "remove it completely"): it covered a third of the phone's drawing and ate
// the gestures that started on it. After a first stroke no tip shows; a pinch where it sat (formerArea, px in
// #editorCanvasContainer) zooms the drawing. legacyKey: its old "seen" flag, cleared so a pre-removal build would show it.
export const NO_EXPAND_TIP = { text: 'Try EXPAND', ids: ['editorExpandCallout', 'editorExpandCalloutDismiss'],
  legacyKey: 'bspline.editor.expandCalloutDismissed', formerArea: { left: 54, top: 60, width: 230, height: 98 } };

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key, checkRow;
export function bind(ctx) { ({ sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key, checkRow } = ctx); }
export async function run() { await runLayout(); await runPanelFit(); await runAnchorGrey(); await runFollowsFrame(); await runBrickSections(); await runBoardFollows(); await runTouchTargets(); await runPageZoom(); }

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
      w: (head.match(/ width="([^"]+)"/) || [])[1], h: (head.match(/ height="([^"]+)"/) || [])[1], dlvb: (head.match(/viewBox="([^"]+)"/) || [])[1] }); })()`);
  const [W, H] = B.to;
  const ok = r.open && r.mW === W && r.mH === H && r.w === `${W}in` && r.h === `${H}in` && r.dlvb === `0 0 ${W} ${H}` && r.wholeBoard && r.fitted;
  checkRow('layout', `Board change with the editor open (${B.viewport.name}): the editor, its view (whole board, fitted) and the SVG download follow ${B.from.join('x')} -> ${W}x${H}`, ok,
    `editor open ${r.open}, editor board ${r.mW}x${r.mH}, view ${r.vb.join(' ')} (whole board ${r.wholeBoard}, fitted ${r.fitted}), download ${r.w}x${r.h} viewBox ${r.dlvb}`);
  if (!ok) await shot('FAIL_board_follows_phone');
  await setBoard(B.from);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}


// ---------------------------------------------------------------- touch targets (phone, coarse pointer)
function TOUCH_PROBE(rootExpr, minPx, skip) { return `JSON.stringify((() => { const root = ${rootExpr}; if (!root) return { missing: true }; const small = [], off = [];
  for (const e of root.querySelectorAll('button, input, select, [role="tab"]')) {
    if (e.matches(${JSON.stringify(skip)}) || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
    const t = (e.type === 'checkbox' && e.closest('label')) || e; t.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = t.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const name = e.id || e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 16) || e.className;
    const px = Math.round(Math.min(r.width, r.height) * 10) / 10;
    if (px < ${minPx}) small.push(name + ' ' + px + 'px');
    if (r.right > innerWidth + 0.5 || r.left < -0.5) off.push(name + ' right ' + Math.round(r.right));
  }
  return { coarse: matchMedia('(pointer: coarse)').matches, small: [...new Set(small)], off: [...new Set(off)], pageW: document.documentElement.scrollWidth, innerW: innerWidth }; })())`; }
const SIDEBAR_ROOT = `document.getElementById('sidebarTabs')?.closest('.cad-sidebar')`;
const EDITOR_ROOT = `document.getElementById('svgEditorModal')`;
async function touchRow(vp, name, opened, rootExpr) {
  const T = TOUCH_TARGETS, r = await jsJSON(TOUCH_PROBE(rootExpr, T.minPx, T.skip));
  const ok = opened && !r.missing && r.coarse && r.small.length === 0 && r.off.length === 0 && r.pageW <= r.innerW;
  checkRow('layout', `Touch targets ${vp.name} (coarse pointer): ${name} -- every control >= ${T.minPx} px, on screen`, ok,
    r.missing ? 'no root' : `${opened ? '' : 'tab did not open; '}${r.coarse ? '' : 'coarse pointer NOT emulated; '}${r.small.length ? `under ${T.minPx} px: ${r.small.join(', ')}; ` : ''}${r.off.length ? `off screen: ${r.off.join(', ')}; ` : ''}page ${r.pageW} / ${r.innerW} px`);
  if (!ok) await shot(`FAIL_touch_${vp.width}_${name.replace(/[^A-Za-z0-9]+/g, '_')}`); // a file name: no '/' ("Photo source / crop")
}
async function runTouchTargets() {
  const T = TOUCH_TARGETS;
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  for (const vp of T.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
    await send('Page.reload', {}); await waitApp();
    // the main sidebar, the editor closed: each tab with its collapsed panels opened (as a finger does)
    for (const t of T.sidebarTabs) {
      const opened = (await click(`sidebarTab_${t}`, 600)) === 'ok';
      await js(`(async () => { const root = ${SIDEBAR_ROOT}; if (!root) return 0; for (const h of root.querySelectorAll('.panel-header.collapsed')) { if (h.getClientRects().length) { h.click(); await new Promise((r) => setTimeout(r, 120)); } } await new Promise((r) => setTimeout(r, 500)); return 1; })()`);
      await touchRow(vp, `sidebar ${t}`, opened, SIDEBAR_ROOT);
    }
    await openBrickTab();
    for (const id of T.brickTabs) await touchRow(vp, id.replace(/^brick(Tab|Tool)_/, 'Brick '), (await click(id, 900)) === 'ok', EDITOR_ROOT);
    for (const t of T.artTabs) {
      const opened = (await click('editorTabArtwork', 600)) === 'ok' && (await click(`artTab_${t}`, 900)) === 'ok';
      await touchRow(vp, `Art ${t}`, opened, EDITOR_ROOT);
    }
    await touchRow(vp, 'Frame', (await click('editorTabFrame', 1200)) === 'ok', EDITOR_ROOT);
    for (const [tab, tool] of T.photoTools) {
      const opened = (await click('editorTabPhoto', 900)) === 'ok' && (await click(`photoTab_${tab}`, 600)) === 'ok' && (await click(`photoTool_${tool}`, 900)) === 'ok';
      await touchRow(vp, `Photo ${tab} / ${tool}`, opened, EDITOR_ROOT);
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}

// ---------------------------------------------------------------- page zoom + the Expand tip (phone, touch)
const touchPts = (pts) => pts.map(([x, y], id) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 }));
async function touchGesture(frames) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPts(frames[0]) });
  for (const f of frames.slice(1)) { await sleep(25); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPts(f) }); }
  await sleep(25); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
}
const pinchAt = (x, y, half) => Array.from({ length: 11 }, (_, k) => { const d = half * (0.33 + 0.067 * k); return [[x - d, y], [x + d, y]]; });
const VIEW_STATE = `JSON.stringify({ page: visualViewport.scale, vbW: window.svgEditor?._draw?.viewbox().width ?? 0, sketch: window.svgEditor?._sketchLayer?.node.querySelectorAll('path,line,polyline,polygon').length ?? 0 })`;
// a rect's on-screen part (the drawing: also above the drawer; `area`: also inside that box of the canvas container),
// its centre, and whether that centre hits the element
function AIM(sel, overDrawing, area) { return `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return JSON.stringify({ missing: true });
  const r = el.getBoundingClientRect(), box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
  ${area ? `const c = document.getElementById('editorCanvasContainer').getBoundingClientRect(), A = ${JSON.stringify(area)};
  Object.assign(box, { l: Math.max(box.l, c.left + A.left), t: Math.max(box.t, c.top + A.top), r: Math.min(box.r, c.left + A.left + A.width), b: Math.min(box.b, c.top + A.top + A.height) });` : ''}
  const d = document.getElementById('editorMobileDrawer'); const dTop = ${overDrawing} && d && d.getClientRects().length ? d.getBoundingClientRect().top : innerHeight;
  box.l = Math.max(box.l, 0); box.t = Math.max(box.t, 0); box.r = Math.min(box.r, innerWidth); box.b = Math.min(box.b, innerHeight, dTop);
  const x = (box.l + box.r) / 2, y = (box.t + box.b) / 2, hit = document.elementFromPoint(x, y);
  return JSON.stringify({ x, y, w: box.r - box.l, h: box.b - box.t, hits: !!hit && el.contains(hit), hit: hit ? hit.tagName + '#' + hit.id : 'none' }); })()`; }
async function pinchRow(name, sel, { drawing = false, area = null } = {}) {
  const P = PAGE_ZOOM, a0 = await jsJSON(AIM(sel, drawing, area));
  if (a0.missing || a0.w < 60 || a0.h < 8) {
    checkRow('layout', `Page zoom (${P.viewport.name}, touch): ${name}`, false, `${sel} ${a0.missing ? 'missing' : `not on screen (${Math.round(a0.w)} x ${Math.round(a0.h)} px)`}`);
    return;
  }
  const a = await jsJSON(VIEW_STATE);
  await touchGesture(pinchAt(a0.x, a0.y, Math.min(90, a0.w / 2 - 4)));
  const b = await jsJSON(VIEW_STATE), zoom = b.vbW ? a.vbW / b.vbW : 1;
  const ok = a0.hits && b.page === 1 && b.sketch === a.sketch && (!drawing || zoom >= P.minZoom);
  checkRow('layout', `Page zoom (${P.viewport.name}, touch): ${name}`, ok,
    `${a0.hits ? '' : `the pinch lands on ${a0.hit}, not ${sel}; `}page zoom x${(+b.page).toFixed(2)} (1 expected)${drawing ? `, drawing zoom x${zoom.toFixed(2)} (>= ${P.minZoom})` : ''}, strokes ${b.sketch - a.sketch}`);
  if (!ok) await shot(`FAIL_pagezoom_${name.replace(/[^A-Za-z0-9]+/g, '_')}`);
  await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); // the next row starts from an unzoomed page either way
}
const ORBIT = `JSON.stringify((() => { const o = window.__preview?._orbit?._targetOrb; if (!o) return null;
  return { r: o.r, q: [o.q.x, o.q.y, o.q.z, o.q.w], t: [o.target.x, o.target.y, o.target.z], page: visualViewport.scale }; })())`;
async function previewRows(vp) {
  const D = PREVIEW_3D;
  await js('window.scrollTo(0, 0), 1'); await sleep(400);
  const box = await jsJSON(`JSON.stringify((() => { const c = document.querySelector(${JSON.stringify(D.sel)}).getBoundingClientRect(); const v = window.__preview?._viewCube?._canvas?.getBoundingClientRect();
    const y0 = Math.max(c.top, 0), y1 = Math.min(c.bottom, innerHeight);
    return { x0: c.left, x1: c.right, y0, y1, cube: v ? { x0: v.left, y0: v.top, x1: v.right, y1: v.bottom } : null }; })())`);
  const before = async (frames) => { const a = await jsJSON(ORBIT); await touchGesture(frames); const b = await jsJSON(ORBIT); return { a, b }; };
  const row = (name, ok, detail) => { checkRow('layout', `3D preview (${vp.name}, touch): ${name}`, ok, detail); };
  if (!box.cube || !(await jsJSON(ORBIT))) { row('the preview and its view cube are there', false, JSON.stringify(box)); return; }
  // a pinch whose SECOND finger starts on the view cube (the measured failure), the first on the preview left of it
  const y = (box.cube.y0 + box.cube.y1) / 2, xa = box.cube.x0 - 70, xb = box.cube.x0 + 20;
  let { a, b } = await before(Array.from({ length: 11 }, (_, k) => [[xa - 5 * k, y], [xb + 5 * k, y]]));
  const zoom = b.r / a.r;
  row('a pinch (second finger on the view cube) zooms the model, not the page', zoom <= D.maxZoomRatio && b.page === 1,
    `distance x${zoom.toFixed(3)} (<= ${D.maxZoomRatio}), page x${b.page}`);
  await send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  // a two-finger drag, both on the preview below the cube
  const yp = Math.min(box.y1 - 20, box.cube.y1 + 20), xm = (box.x0 + box.cube.x0) / 2;
  ({ a, b } = await before(Array.from({ length: 11 }, (_, k) => [[xm - 40 + 4 * k, yp - 4 * k], [xm + 40 + 4 * k, yp - 4 * k]])));
  const pan = Math.hypot(...a.t.map((v, i) => b.t[i] - v));
  row('a two-finger drag pans the model', pan >= D.minPan && b.page === 1, `target moved ${pan.toFixed(3)} (>= ${D.minPan}), page x${b.page}`);
  // one finger orbits
  ({ a, b } = await before(Array.from({ length: 11 }, (_, k) => [[xm - 50 + 10 * k, yp - 3 * k]])));
  const deg = 2 * Math.acos(Math.min(1, Math.abs(a.q.reduce((s, v, i) => s + v * b.q[i], 0)))) * 180 / Math.PI;
  row('one finger orbits the model', deg >= D.minOrbitDeg, `${deg.toFixed(1)} deg (>= ${D.minOrbitDeg})`);
  // a pinch that spreads 120 px, then the left finger lifts and the right one moves 6 px: no jump. (MEASURED, CDP: a
  // touchMove that omits a point keeps it DOWN; a touchEnd releases exactly the points it lists.)
  const send2 = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: touchPts(pts) });
  await send2('touchStart', [[xm - 30, yp], [xm + 30, yp]]);
  for (let k = 1; k <= 10; k++) { await sleep(25); await send2('touchMove', [[xm - 30 - 6 * k, yp], [xm + 30 + 6 * k, yp]]); }
  const right = (x) => [{ x, y: yp, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await sleep(150); const j0 = await jsJSON(ORBIT); // the view as the pinch left it
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: xm - 90, y: yp, id: 0, radiusX: 4, radiusY: 4, force: 1 }] }); // the left finger lifts
  for (let k = 1; k <= 3; k++) { await sleep(25); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: right(xm + 90 + 2 * k) }); }
  await sleep(150); const j1 = await jsJSON(ORBIT);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
  const jump = 2 * Math.acos(Math.min(1, Math.abs(j0.q.reduce((s, v, i) => s + v * j1.q[i], 0)))) * 180 / Math.PI;
  row('lifting one finger of a pinch: the other does not jump the view', jump <= D.maxJumpDeg, `${jump.toFixed(1)} deg across the lift + a 6 px move (<= ${D.maxJumpDeg})`);
}
async function runPageZoom() {
  const P = PAGE_ZOOM, T = NO_EXPAND_TIP, vp = P.viewport;
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: true });
  await send('Page.reload', {}); await waitApp();
  for (const c of P.chrome.filter((c) => !c.editor)) await pinchRow(`a pinch on the ${c.name} leaves the page unzoomed`, c.sel);
  await previewRows(vp);
  await openBrickTab(); // opens the editor
  const armed = (await click('editorTabArtwork', 900)) === 'ok' && (await click('artTab_draw', 600)) === 'ok' && (await click('toolDraw', 600)) === 'ok';
  for (const c of P.chrome.filter((c) => c.editor)) await pinchRow(`a pinch on the ${c.name} leaves the page unzoomed`, c.sel);
  await js(`(async () => { try { localStorage.removeItem(${JSON.stringify(T.legacyKey)}); } catch (_) {} document.getElementById('toolFit')?.click(); await new Promise((r) => setTimeout(r, 300)); return 1; })()`);
  await pinchRow('a pinch on the drawing zooms the drawing, not the page', '#editorSVGContainer', { drawing: true });
  // the first stroke: no Expand tip shows
  const c0 = await jsJSON(AIM('#editorSVGContainer', true, null)), s0 = await jsJSON(VIEW_STATE);
  await touchGesture(Array.from({ length: 11 }, (_, k) => [[c0.x - 60 + 12 * k, c0.y]]));
  const tip = await jsJSON(`JSON.stringify({ text: document.body.innerText.includes(${JSON.stringify(T.text)}), ids: ${JSON.stringify(T.ids)}.filter((id) => document.getElementById(id)) })`);
  const s1 = await jsJSON(VIEW_STATE), drew = s1.sketch - s0.sketch;
  const ok = armed && drew === 1 && !tip.text && tip.ids.length === 0;
  checkRow('layout', `Expand tip removed (${vp.name}, touch): no tip after the first stroke`, ok,
    `${armed ? '' : 'Draw tool not armed; '}strokes ${drew} (1 expected), "${T.text}" shown ${tip.text}, its elements ${tip.ids.join(', ') || 'none'}`);
  if (!ok) await shot('FAIL_expand_tip_after_stroke');
  await pinchRow('a pinch where the Expand tip sat zooms the drawing, not the page', '#editorSVGContainer', { drawing: true, area: T.formerArea });
  await send('Emulation.setEmulatedMedia', { features: [] });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 1 });
}
