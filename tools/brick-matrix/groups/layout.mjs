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
  ],
};

// ---- the runner, moved verbatim from run.mjs. Its page / CDP helpers are run.mjs's own, bound once by
// groups/index.mjs bindGroups(ctx) before the first runner runs.
let sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key;
export function bind(ctx) { ({ sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key } = ctx); }
export async function run() { await runLayout(); await runPanelFit(); }

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
