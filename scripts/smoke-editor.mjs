// Usage: node scripts/smoke-editor.mjs <outDir> [desktop|mobile|perf|color|drape|drape-align] [url]
// Headless-Chrome (CDP, no deps) smoke test of the SVG editor lattice/pattern flow on the live site (or a local URL).
// Prints a JSON report (counts, layers, probes, console errors) and writes screenshots to <outDir>.
// Minimal CDP driver (no deps): live-site smoke test of the SVG editor lattice/pattern flow.
//
// SE8b-3: `perf` mode measures editor._onChange's CHANGE_PIPELINE (main/app-init.js) during a real
// drag — generates a lattice, turns on window.__editorDebug='PERF', drags the whole selection for
// ~2s (~120 mousemoves), then reads the structured window.__perfLog array _perfLog pushed to (one
// {kind,step,ms} record per pipeline step) and reports count/median/p95 per "<kind> <step>" plus
// the per-frame totals. No parsing of formatted [PERF] console/fusLog text — window.__perfLog is
// the one purpose-built channel a headless CDP script can read back directly.
// T25: testing against a LOCAL build needs the server rooted at the REPO ROOT, not the
// html folder — bspline_gen_palette.html links its CSS/JS with paths like
// `../../styles/editor.css`, relative to the page's real depth in the repo. Serving just
// the html folder makes those 404 SILENTLY (no console error — the browser just renders
// unstyled/un-scripted), which looks exactly like a real layout bug (a collapsed,
// off-screen canvas; `position:fixed` computing as `static`) but isn't one. Correct setup:
//   python -m http.server 8765 --directory .            (from the REPO ROOT)
//   node scripts/smoke-editor.mjs <outDir> mobile http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// Confirmed working this way — if a local run ever again shows a collapsed/off-screen
// canvas, check the CSS actually 200s (curl the editor.css URL) before assuming a real bug.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop';          // desktop | mobile | perf | color | drape | drape-align
const URL = process.argv[4] || 'https://bspline-generator.pages.dev/';
const PORT = MODE === 'mobile' ? 9334 : MODE === 'perf' ? 9335 : MODE === 'color' ? 9336
           : MODE === 'drape' ? 9337 : MODE === 'drape-align' ? 9338 : 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL });
await sleep(9000);

// T25: a two-finger spread centered on #editorSVGContainer's current
// midpoint via Input.dispatchTouchEvent — confirmed (once the CSS above
// actually loads) to produce real pointerType:'touch' PointerEvents the
// SE7m pointer path handles correctly. Shared so the "does the mechanism
// work at all" check (early, plain canvas) and the "does it survive the
// full real-world flow" check (late, Pattern panel open) run byte-
// identical gesture code — only the container's on-screen size differs
// between the two calls.
async function doPinch() {
  const box = await evalJS(`(() => { const r = document.getElementById('editorSVGContainer').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
  const zoomBefore = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  const pts = (d) => [{ x: box.x - d, y: box.y, id: 1 }, { x: box.x + d, y: box.y, id: 2 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
  for (let d = 35; d <= 120; d += 5) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(16); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  const zoomAfter = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  return { box, zoomBefore, zoomAfter };
}

const report = {};
report.buildStamp = await evalJS(`(document.body.innerText.match(/[0-9a-f]{7} · 20\\d\\d-\\d\\d-\\d\\d/)||[''])[0]`);
report.editorPresent = await evalJS(`!!window.svgEditor`);

if (MODE === 'drape-align') {
  // SE11c re-dispatch: Fusion is Session-Suspended (an Autodesk account
  // license conflict, external to this repo) — verify the drape/carve
  // orientation with DATA in the browser instead of a live Fusion
  // screenshot. The 3D preview code (core/preview/*) is identical
  // between the site and the palette, so this is the same code path.
  // No need to even open the visual modal — window.svgEditor exists
  // from page load (confirmed by report.editorPresent above already
  // being true before any click), so this drives the sketch layer
  // directly, the same way earlier 'color' mode adopts DOM nodes rather
  // than simulating a drawing gesture.
  await sleep(1500); // let initApp's own startup rebuild() finish

  const before = await evalJS(`(() => {
    const p = window.__preview;
    if (!p) return { error: 'no window.__preview' };
    window.__heightsBeforeL = p._lastHeights ? Array.from(p._lastHeights) : null;
    return { nx: p._lastNx, nz: p._lastNz, hasHeights: !!window.__heightsBeforeL };
  })()`);
  report.before = before;

  await evalJS(`(async () => {
    const editor = window.svgEditor;
    if (!editor._layers || editor._layers.length === 0) {
      editor._layers = [{ id: '0', name: 'Layer 1', visible: true, carve: true, showColor: true }];
      editor._activeLayer = '0';
    }
    const layer = String(editor._activeLayer != null ? editor._activeLayer : editor._layers[0].id);
    const w = editor._mW, h = editor._mH;
    const m = Math.min(w, h) * 0.03; // a small margin off the true edge
    // The advisor's own L: a horizontal stroke along the TOP + a
    // vertical stroke down the LEFT — asymmetric in both axes, so a
    // pure Y-flip (this bug) and a pure X-flip would each show up as a
    // DIFFERENT mismatch, not the same one.
    editor._sketchLayer.line(m, m, w - m, m).stroke({ color: '#c62828', width: 0.15, linecap: 'round' }).attr('data-layer', layer);
    editor._sketchLayer.line(m, m, m, h - m).stroke({ color: '#c62828', width: 0.15, linecap: 'round' }).attr('data-layer', layer);
    if (typeof editor.pushState === 'function') editor.pushState();
    await editor._notifyChange('commit');
    return true;
  })()`);
  await sleep(1000); // safety margin beyond _notifyChange's own await chain

  const analysis = await evalJS(`(() => {
    const p = window.__preview;
    const before = window.__heightsBeforeL;
    const after = p._lastHeights;
    const nx = p._lastNx, nz = p._lastNz;
    if (!before || !after || !p._drapeTexture) {
      return { error: 'missing before/after heights or drape texture', hasBefore: !!before, hasAfter: !!after, hasTexture: !!(p && p._drapeTexture) };
    }
    const canvas = p._drapeTexture.image;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const texW = canvas.width, texH = canvas.height;
    const isRed = (row, col) => {
      row = Math.max(0, Math.min(texH - 1, row));
      col = Math.max(0, Math.min(texW - 1, col));
      const idx = (row * texW + col) * 4;
      const r = img.data[idx], g = img.data[idx + 1], b = img.data[idx + 2];
      return r > 130 && (r - g) > 40 && (r - b) > 40;
    };
    // A carved vertex's height genuinely moved from the stamp — a plain
    // diff against the pre-draw snapshot, not a guess at which cells the
    // L "should" cover, so this is grounded in what the carve pipeline
    // actually did, matching the dispatch's own framing. Multiple
    // thresholds: the stamp's fillet/SDF edge falloff (sdf.js's
    // powerStep) tapers depth gradually near a stroke's boundary, so a
    // low threshold also catches a shallow halo outside the drape's own
    // hard-edged stroke — a HIGHER threshold (nearer the true carve
    // depth) isolates the confident core, which should align far more
    // tightly if the orientation is right.
    const results = { texW, texH, nx, nz, byThreshold: {} };
    for (const CARVE_THRESHOLD of [0.01, 0.05, 0.1]) {
      const carved = [];
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          if (Math.abs(after[k] - before[k]) > CARVE_THRESHOLD) carved.push([i, j]);
        }
      }
      const atThreshold = { carvedCount: carved.length };
      for (const flipY of [false, true]) {
        let hitCarved = 0, hitMirror = 0;
        for (const [i, j] of carved) {
          const u = i / (nx - 1);
          const v = j / (nz - 1);
          const col = Math.round(u * (texW - 1));
          const row = Math.round((flipY ? (1 - v) : v) * (texH - 1));
          if (isRed(row, col)) hitCarved++;
          // Y-mirrored position (flip j across the row axis) — a
          // coincidental match at the real position wouldn't also match
          // here, since the L is NOT vertically symmetric (top stroke,
          // not bottom).
          const jm = nz - 1 - j;
          const vm = jm / (nz - 1);
          const rowm = Math.round((flipY ? (1 - vm) : vm) * (texH - 1));
          if (isRed(rowm, col)) hitMirror++;
        }
        atThreshold['flipY_' + flipY] = {
          carvedRedPct: carved.length ? +(100 * hitCarved / carved.length).toFixed(1) : null,
          mirrorRedPct: carved.length ? +(100 * hitMirror / carved.length).toFixed(1) : null,
        };
      }
      results.byThreshold[CARVE_THRESHOLD] = atThreshold;
    }
    return results;
  })()`);
  report.drapeAlignAnalysis = analysis;

  // Optional picture: getSnapshot() renders + captures synchronously in
  // one call (proven working since SE11's own renderedFrameColors check)
  // — no preserveDrawingBuffer juggling needed, unlike a raw CDP
  // screenshot of the WebGL canvas (the advisor's own note: those came
  // out black).
  const dataUrl = await evalJS(`window.__preview ? window.__preview.getSnapshot(800, 600) : null`);
  if (dataUrl) {
    writeFileSync(`${OUT}/${MODE}-snapshot.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  }

  report.logs = logs.slice(0, 15);
  console.log(JSON.stringify(report, null, 1));
  ws.close(); chrome.kill();
  process.exit(0);
}

await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
report.modalOpen = await evalJS(`getComputedStyle(document.getElementById('svgEditorModal')).display`);
// SE7c: the modal renders in normal document flow below the palette
// page, not as a fixed-position overlay — every screenshot below this
// point would otherwise capture whatever's at the CURRENT scroll
// position (the palette page's own top), not the modal, even though
// modalOpen correctly reports display:flex. Scroll it into view once,
// here, so every subsequent shot() in this run actually shows it.
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);
await shot(`${MODE}-1-editor.png`);

if (MODE === 'mobile') {
  // T25: pinch BEFORE opening the Lattice tool — isolates "does pinch-
  // zoom work at all" from the Pattern panel's own SE7p layout bug
  // (still open, tracked separately). With the panel closed the canvas
  // has its full flex space; this is the SE7m pointer path's own proof,
  // uncontaminated by SE7p's state.
  const early = await doPinch();
  report.earlyPinch = early; // { box, zoomBefore, zoomAfter } — zoomAfter should be > zoomBefore
  report.touchActionsVisible = await evalJS(`(() => { const g = document.querySelector('[id*="TouchActions"],[class*="touch-actions"]'); return g ? getComputedStyle(g).display : 'none-found'; })()`);
  await shot(`${MODE}-2-early-pinch.png`);
  // The early pinch's zoom is left applied (not reset) — later
  // screenshots may show the canvas zoomed in; that's cosmetic, not a
  // correctness concern for any other report field below.
}

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);
report.mode = await evalJS(`window.svgEditor._currentMode`);
report.patternPanelHidden = await evalJS(`document.getElementById('editorLatticePanel').classList.contains('hidden')`);
report.gridVisible = await evalJS(`!!(window.svgEditor._grid && window.svgEditor._grid.visible)`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(3500);
report.lattice = await evalJS(`(() => { const c = {}; document.querySelectorAll('#editorSVGContainer [data-lattice]').forEach(e => { const k = e.getAttribute('data-lattice'); c[k] = (c[k]||0)+1; }); return c; })()`);
report.owned = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice-gen]').length`);
report.layers = await evalJS(`window.svgEditor._layers.map(l => l.name + (l.visible===false?'(hidden)':'')).join(', ')`);
report.activeLayer = await evalJS(`String(window.svgEditor._activeLayer)`);
report.generateLabel = await evalJS(`document.getElementById('latticeGenerate').textContent.trim()`);
await shot(`${MODE}-3-generated.png`);

if (MODE === 'color' || MODE === 'drape') {
  // SE9: color the generated Rails/Ties/Nodes layers via the SAME
  // editor.setColor(...) a user's swatch click calls — select each
  // data-lattice kind (re-wrapping its raw DOM nodes through
  // window.SVG.adopt, the same adopt call editor-interaction.js /
  // editor-expand-commit.js already use to turn a DOM node back into an
  // svg.js element), then call setColor. No new test-only API needed.
  await evalJS(`(() => {
    const wrap = (sel) => [...document.querySelectorAll(sel)].map(n => window.SVG.adopt(n)).filter(Boolean);
    window.svgEditor._selectMany(wrap('[data-lattice=rail]'));
    window.svgEditor.setColor('#c62828');
    window.svgEditor._selectMany(wrap('[data-lattice=tie]'));
    window.svgEditor.setColor('#f9c80e');
    window.svgEditor._selectMany(wrap('[data-lattice=node]'));
    window.svgEditor.setColor('#1a237e');
    window.svgEditor._selectMany([]); // clear selection so halos don't obscure the screenshot
    true;
  })()`);
  await sleep(300);
  report.railColor = await evalJS(`document.querySelector("[data-lattice=rail]")?.getAttribute('stroke')`);
  report.tieColor = await evalJS(`document.querySelector("[data-lattice=tie]")?.getAttribute('stroke')`);
  report.nodeColor = await evalJS(`document.querySelector("[data-lattice=node]")?.getAttribute('fill')`);
  await shot(`${MODE}-4-colored.png`);
}

if (MODE === 'drape') {
  // SE11: click Apply (the real user path to close the editor) so
  // onCommit's Apply branch runs — which now also calls refreshDrape
  // (main/app-init.js) — rather than reaching into internals to trigger
  // it directly. Then screenshot the MAIN page's #previewCanvas (the 3D
  // view lives there, not inside the editor modal that just closed).
  await evalJS(`document.getElementById('editorApply').click(); true`);
  await sleep(1200); // saveForRasterization + refreshAllStampMasks + refreshDrape are all async
  report.modalClosedAfterApply = await evalJS(`getComputedStyle(document.getElementById('svgEditorModal')).display`);
  report.drapeTexturePresent = await evalJS(`!!(window.__preview && window.__preview._drapeTexture)`);
  // Sample the drape texture's OWN source canvas directly (not the 3D
  // render) for a red/yellow/navy pixel — separates "did buildDrapeSvg /
  // buildDrapeTexture paint the right colors" from "is the multiply-blend
  // visible against this material's shading", which the screenshot alone
  // can't distinguish.
  report.drapeTextureColors = await evalJS(`(() => {
    const tex = window.__preview && window.__preview._drapeTexture;
    const canvas = tex && tex.image;
    if (!canvas || !canvas.getContext) return 'no texture canvas';
    const ctx = canvas.getContext('2d');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const near = (r,g,b,tr,tg,tb) => Math.abs(r-tr)<40 && Math.abs(g-tg)<40 && Math.abs(b-tb)<40;
    let red = 0, yellow = 0, navy = 0, white = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r,g,b] = [data[i], data[i+1], data[i+2]];
      if (near(r,g,b,198,40,40)) red++;
      else if (near(r,g,b,249,200,14)) yellow++;
      else if (near(r,g,b,26,35,94)) navy++;
      else if (r>250 && g>250 && b>250) white++;
    }
    return { width, height, red, yellow, navy, white };
  })()`);
  // Also sample the ACTUAL rendered 3D frame (not just the source
  // texture) via TerrainPreview's own getSnapshot() — separates "is the
  // texture painted correctly" (above) from "does the multiply-blend
  // against this material's shading actually show up on screen".
  report.renderedFrameColors = await evalJS(`(async () => {
    if (!window.__preview) return 'no window.__preview handle';
    const dataUrl = window.__preview.getSnapshot(800, 600);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    const near = (r,g,b,tr,tg,tb,tol) => Math.abs(r-tr)<tol && Math.abs(g-tg)<tol && Math.abs(b-tb)<tol;
    let redTint = 0, yellowTint = 0, navyTint = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      // Loose tolerance: looking for a RELATIVE tint (r noticeably >
      // g/b for "reddish"), not the exact swatch hex, since lighting
      // darkens/brightens whatever the base terrain shade was there.
      if (r > g + 30 && r > b + 30) redTint++;
      else if (r > 120 && g > 100 && b < 80 && Math.abs(r-g) < 60) yellowTint++;
      else if (b > r + 20 && b > g + 10) navyTint++;
    }
    return { redTint, yellowTint, navyTint, totalPx: data.length / 4 };
  })()`);
  await evalJS(`document.getElementById('previewCanvas')?.scrollIntoView({ block: 'center' }); true`);
  await sleep(300);
  await shot(`${MODE}-5-preview-3d.png`);
}

if (MODE === 'mobile') {
  // T25: the ORIGINAL "ground truth" scenario (ROADMAP's Live browser
  // test) — pinching while the Pattern panel is open. Kept as its own
  // check (not replaced by the early one above) because it still tracks
  // SE7p's own bug: expect zoomAfter to stay ~1 here until that panel's
  // fixed-position/bottom-sheet redesign (T24, on hold) lands, since the
  // panel currently collapses #editorSVGContainer to ~1.5x2px in this
  // state — a DIFFERENT failure than "pinch doesn't work."
  const late = await doPinch();
  report.pinchWithPatternPanelOpen = late;
  report.latticeAfterPinch = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice]').length`);
  await shot(`${MODE}-4-pinched-with-panel-open.png`);
}

function percentile(vals, p) {
  const sorted = [...vals].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
function summarizePerfLog(entries) {
  const groups = {};
  for (const { kind, step, ms } of entries) {
    const key = `${kind} ${step}`;
    (groups[key] = groups[key] || []).push(ms);
  }
  const out = {};
  for (const [key, vals] of Object.entries(groups)) {
    out[key] = {
      count: vals.length,
      medianMs: Number(percentile(vals, 0.5).toFixed(2)),
      p95Ms: Number(percentile(vals, 0.95).toFixed(2)),
    };
  }
  return out;
}

if (MODE === 'perf') {
  // Drive editor._notifyChange('live') directly, once per Node-side tick
  // (~16ms, matching a 60fps drag), instead of simulating a real mouse
  // drag through hit-testing/selection. Two things ruled that out:
  //   1. editor._selectMany / editor._selectAdd are IMPORTED into
  //      editor.js (from editor-ui.js) but never actually delegated as
  //      instance methods (only _select is) — Ctrl+A/paste/marquee-
  //      finalize/shift-click all call editor._selectMany(...)/
  //      _selectAdd(...) and either silently no-op (guarded call sites)
  //      or THROW (unguarded ones). A pre-existing bug, unrelated to
  //      CHANGE_PIPELINE — flagged in WORK-LOG, not fixed here (out of
  //      this turn's file scope). Working around it by writing
  //      editor._selectedElements directly is possible, but pointless
  //      for what this mode actually measures (below).
  //   2. A whole "press, N moves, release" gesture, when driven as ONE
  //      async page-side expression via CDP Runtime.evaluate, silently
  //      never fires the pipeline at all in this headless setup (proven
  //      by direct comparison: the SAME editor._notifyChange('live')
  //      call, issued as its OWN separate CDP round-trip with a REAL
  //      Node-side wait after it, works every time — bare
  //      requestAnimationFrame itself fires fine either way, so this is
  //      specific to many rAF ticks + timers nested inside one evaluated
  //      async function, not a headless-rAF suspension).
  // What's actually being measured — CHANGE_PIPELINE's own per-step cost
  // — doesn't care which caller triggered it; a real drag's translateSelection
  // calls this exact same editor._notifyChange('live') on every mousemove.
  await evalJS(`window.__editorDebug = 'PERF'; window.__perfLog = []; true`);
  const FRAMES = 120; // ~2s at 60fps, matching the dispatch's own drag duration
  for (let k = 0; k < FRAMES; k++) {
    await evalJS(`window.svgEditor._notifyChange('live'); true`);
    await sleep(16);
  }
  await evalJS(`window.svgEditor._notifyChange('commit'); true`);
  await sleep(400); // let the async serialize/remask steps finish logging

  const perfLog = (await evalJS(`window.__perfLog || []`)) || [];
  report.perfFrames = FRAMES;
  report.perfLogRawCount = perfLog.length;
  report.perfSummary = summarizePerfLog(perfLog);
  await shot(`${MODE}-3-perf.png`);
}

report.railAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=rail]"); return e ? ["x1","y1","x2","y2","stroke","stroke-width","opacity","data-layer"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.nodeAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=node]"); return e ? ["cx","cy","r","fill","stroke","stroke-width"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.board = await evalJS(`["mW="+window.svgEditor._mW, "mH="+window.svgEditor._mH, "strokeWidth="+window.svgEditor._strokeWidth].join(" ")`);
report.svgOrder = await evalJS(`[...document.querySelector("#editorSVGContainer svg").children].map(c => (c.id||c.tagName)+"("+c.children.length+")").join(" > ")`);
report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
