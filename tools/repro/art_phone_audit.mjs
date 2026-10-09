// Seat D (2026-10-08, advisor pick 2): the Art editor on Fred's phone -- every Artwork action timed under his acceptance
// rig (real Chrome, 390 x 844, touch, CPU throttled, default 4x) with REAL touch input (CDP Input.dispatchTouchEvent: a
// covered / inert control does not answer, unlike a scripted .click()), plus a reach pass over every visible control.
// Per action, from the touch until the page is quiet (no long task for QUIET_MS):
//   responseMs   touch -> the end of the last long task (what the finger waits for; ~0 = answered within a frame)
//   longestMs    the longest single main-thread task
//   blindMs      long-task time while the loading card / pill was NOT on screen (reads as frozen)
//   overlay      the card / pill texts seen
// Reach: every visible button / input / select in the Artwork panel and the editor's top bar, scrolled into view: is
// it inside the viewport, is it the element under its own centre (not covered), and its smaller side in px.
//
//   node tools/repro/art_phone_audit.mjs <outDir> [cdpPort] [httpPort]
// Env: CPU (default 4)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../bspline-frame-builder'); // the matrix's root: the palette's relative assets resolve
const [OUT_DIR, PORTARG, HTTPARG] = process.argv.slice(2);
if (!OUT_DIR) { console.log('usage: node tools/repro/art_phone_audit.mjs <outDir> [cdpPort] [httpPort]'); process.exit(1); }
const PORT = Number(PORTARG || 9591), HTTP = Number(HTTPARG || 9592), CPU = Number(process.env.CPU || 4);
const QUIET_MS = 800, VIEW = { width: Number(process.env.VW || 390), height: 844 };
// Env SURFACE: which editor tab is audited (seat D, 2026-10-08: Art first, then Frame + Photo) -- its tab button, the
// panel the reach pass scans, and its sub-tab strip (null = one panel)
const SURFACES = {
  art: { tab: 'editorTabArtwork', panel: 'editorLayersPanel', strip: 'artTabStrip' },
  frame: { tab: 'editorTabFrame', panel: 'editorFramePanel', strip: null },
  photo: { tab: 'editorTabPhoto', panel: 'editorPhotoPanel', strip: 'photoTabStrip' },
  brick: { tab: 'editorTabBrick', panel: 'editorBrickPanel', strip: null },
  sidebar: { tab: null, panelSel: '.cad-sidebar', strip: null }, // the editor stays CLOSED
  undo: { tab: 'editorTabArtwork', panel: 'editorLayersPanel', strip: null }, // the undo coverage map: every editor tab
};
const SURFACE = process.env.SURFACE || 'art';
const SURF = SURFACES[SURFACE];
if (!SURF) { console.log('SURFACE must be one of', Object.keys(SURFACES).join(' / ')); process.exit(1); }
const PROFILE = `${OUT_DIR}/.chrome-artphone-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('python', [path.resolve(HERE, '../brick-matrix/serve.py'), String(HTTP)], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); stop(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [], cssFails = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400 && /[.]css([?#]|$)/.test(msg.params.response.url)) cssFails.push(`${msg.params.response.status} ${msg.params.response.url}`);
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => {
  const resp = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) errors.push('EVAL: ' + (resp.result.exceptionDetails.exception?.description || resp.result.exceptionDetails.text).split('\n')[0]);
  return resp.result?.result?.value;
};

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true }); // a reused profile must not serve a stale stylesheet
  await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] });
  await send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // the phone's own CSS: (pointer: coarse) rules (SA-MOBILE-4's 44 px tool buttons, ...) apply only with it (a first reach
  // pass without it measured the desktop sizes)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  // Env BOARD (seat A's phone map, 2026-10-09: the board states its slow actions were ranked on): fresh (default) |
  // loaded (template_1, Wall + the three-band frame, the inset window, the 3D built, mesh shown) | photo (a photo
  // pattern applied). Any BOARD starts from a fresh page with Math.random seeded (the same fresh-start board every run).
  const BOARD = process.env.BOARD || 'fresh';
  if (BOARD !== 'fresh') await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch (e) {}
    (() => { let a = 0x2f6b9d1; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html` });
  for (let i = 0; i < 120 && !(await js('!!document.getElementById("btnStampEdit")')); i++) await sleep(500);
  await sleep(4000);
  if (BOARD !== 'fresh') { // seat A's recipe (shots/seatA/phone_map/README.md), unthrottled, before the audit
    console.log('BOARD', await js(`(async () => { try {
      const L = await import('./core/loading-signal.js'); const RB = await import('./core/engine/rebuild.js'); const SC = await import('./core/engine/scheduler.js');
      const busy = () => !!(RB.rebuild.isRebuilding || RB.rebuild.pendingRebuild || SC.isRebuildScheduled() || L.currentLoadingStage());
      const idle = async (min = 500) => { const t = performance.now(); for (let i = 0; i < 9000; i++) { await new Promise((r) => setTimeout(r, 10)); if (!busy() && performance.now() - t > min) return; } };
      const F = await import('./main/frame-panel.js'); const PM = await import('./main/param-manager.js'); const { P } = await import('./core/state.js');
      if (${JSON.stringify(BOARD)} === 'loaded') {
        F.openEditorOn('brick'); await idle(1000);
        const B = await import('./main/brick-panel.js'); B.setFrameBandPreset('three_band'); await idle(800);
        document.getElementById('brickTool_wall')?.click(); await idle(300); document.getElementById('brickGenerate').click(); await idle(1500);
        document.getElementById('editorApply').click(); await idle(2000);
        const t = document.getElementById('frameInsetWindowToggle'); if (t && !t.checked) t.click(); await idle(1000);
      } else if (${JSON.stringify(BOARD)} === 'photo') {
        F.openEditorOn('photo'); await idle(1000);
        document.querySelector('#photoPatternRow button')?.click(); await idle(2000);
        document.getElementById('editorApply').click(); await idle(2000);
      }
      PM.applyParam('showMesh', true); await idle(1000);
      return JSON.stringify({ board: ${JSON.stringify(BOARD)}, svgNodes: window.svgEditor?._draw?.node?.querySelectorAll('*').length || 0, frame: P.frame?.templateId || null, window: !!P.frame?.insetWindow?.enabled, showMesh: P.showMesh });
    } catch (e) { return 'SETUP ERR ' + e.message; } })()`));
  }
  // open the editor on the audited tab (setup, unthrottled)
  if (SURF.tab) await js(`(async () => { const m = document.getElementById('svgEditorModal'); if (!m || m.style.display === 'none') document.getElementById('btnStampEdit').click();
    for (let i = 0; i < 80 && !window.svgEditor?._draw; i++) await new Promise((r) => setTimeout(r, 250));
    document.getElementById(${JSON.stringify(SURF.tab)})?.click(); await new Promise((r) => setTimeout(r, 1500)); return 1; })()`);
  // the app's stylesheets really load (advisor 2026-10-08, seat A's finding: a probe serving only b-spline-gen/html 404s
  // ../../styles/*.css, #previewCanvas then grows every frame and inflates every phone timing). No timing without them.
  const styled = await js(`getComputedStyle(document.getElementById('previewCanvas')).position`);
  console.log('styles', JSON.stringify({ previewCanvasPosition: styled, cssFails }));
  if (styled !== 'absolute' || cssFails.length) { console.log('STYLES NOT SERVED: no audit'); stop(); process.exit(1); }
  // the page-side recorders
  await js(`(() => {
    const el = document.getElementById('loading-stage');
    window.__vis = () => !!el && !el.hidden && el.getClientRects().length > 0;
    window.__ov = []; window.__long = []; window.__shown = [];
    // the card ON SCREEN: a frame callback that sees it visible (a long task's own vis flag is read when its entry is
    // DELIVERED, after the task -- a card set at the end of a blind task read as shown; MEASURED 2026-10-08)
    { let was = false; const tick = () => { const v = window.__vis(); if (v && !was) window.__shown.push(performance.now()); was = v; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    if (el) new MutationObserver(() => { if (window.__vis()) window.__ov.push({ t: performance.now(), txt: (el.textContent || '').trim().slice(0, 60) }); })
      .observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration, vis: window.__vis() }); }).observe({ entryTypes: ['longtask'] });
    window.__settle = async (t0, quiet) => { const W = (ms) => new Promise((r) => setTimeout(r, ms)); const tEnd = performance.now() + 60000;
      for (;;) { await W(100); const last = window.__long.filter((e) => e.start >= t0 - 5).reduce((m, e) => Math.max(m, e.start + e.dur), t0);
        if (performance.now() - last >= quiet || performance.now() > tEnd) break; }
      const tasks = window.__long.filter((e) => e.start >= t0 - 5);
      const end = tasks.reduce((m, e) => Math.max(m, e.start + e.dur), t0);
      return JSON.stringify({ responseMs: Math.round(end - t0), longestMs: Math.round(tasks.reduce((m, e) => Math.max(m, e.dur), 0)),
        busyMs: Math.round(tasks.reduce((s, e) => s + e.dur, 0)),
        // long-task time before the card was first on screen after t0 (all of it when it never showed)
        blindMs: (() => { const shown = window.__shown.find((t) => t >= t0 - 5) ?? Infinity; return Math.round(tasks.reduce((s, e) => s + Math.max(0, Math.min(e.start + e.dur, shown) - e.start), 0)); })(),
        cardMs: (() => { const shown = window.__shown.find((t) => t >= t0 - 5); return shown == null ? null : Math.round(shown - t0); })(),
        overlay: [...new Set(window.__ov.filter((o) => o.t >= t0 - 5).map((o) => o.txt))],
        tasks: tasks.map((e) => [Math.round(e.start - t0), Math.round(e.dur)]) }); };
    window.__centre = (sel) => { const e = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!e) return null;
      e.scrollIntoView({ block: 'center', inline: 'center' }); const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null; };
    window.__canvas = () => { const n = window.svgEditor?._draw?.node; if (!n) return null; const r = n.getBoundingClientRect();
      const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
      return { x0, x1, y0, y1 }; };
    return 1; })()`);
  const shot0 = await send('Page.captureScreenshot', { format: 'png' });
  if (shot0.result?.data) writeFileSync(`${OUT_DIR}/${SURFACE}_phone_open.png`, Buffer.from(shot0.result.data, 'base64'));
  console.log('canvas', await js('JSON.stringify(window.__canvas())'));
  await send('Emulation.setCPUThrottlingRate', { rate: CPU });

  const touch = async (points, stepMs = 30, beforeUp = null) => { // points: [[x, y], ...]: start, moves, end
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
    for (const p of points.slice(1)) { await sleep(stepMs); await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
    if (beforeUp) await beforeUp(); // e.g. what the finger sees while still down
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const results = [];
  // what an action changed: the drawing's element count + markup length, the photo preview's pixels and the editor's mode
  // (a gesture that lands nowhere changes none of them)
  const state = () => js(`(() => { const ed = window.svgEditor; const n = ed?._draw?.node; const c = document.getElementById('photoPreviewCanvas');
    let px = 0; try { if (c && c.width) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 97) px = (px * 31 + d[i]) % 1000003; } } catch { px = -1; }
    return JSON.stringify({ els: n ? n.querySelectorAll('path,line,rect,circle,ellipse,polyline,polygon,text').length : -1, len: n ? n.innerHTML.length : -1, px, mode: ed?._currentMode || '' }); })()`).then(JSON.parse);
  const act = async (name, how) => {
    const before = await state();
    const t0 = await js('performance.now()');
    const ok = await how();
    const m = ok === false ? { skipped: true } : JSON.parse(await js(`window.__settle(${t0}, ${QUIET_MS})`));
    const after = await state();
    m.effect = `${before.els}->${after.els}${before.len !== after.len ? ' markup changed' : ''}${before.px !== after.px ? ' preview changed' : ''}${before.mode !== after.mode ? ` mode ${before.mode}->${after.mode}` : ''}`;
    results.push({ name, ...m }); console.log(name.padEnd(42), JSON.stringify(m));
  };
  const tapSel = async (sel) => { const c = await js(`JSON.stringify(window.__centre(${JSON.stringify(sel)}))`); const p = c && JSON.parse(c); if (!p) return false; await touch([[p.x, p.y]]); return true; };
  const tabIds = SURF.strip ? JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('#${SURF.strip} [role="tab"]')].map((b) => b.dataset.tab))`) || '[]') : [null];
  console.log('tabs', JSON.stringify(tabIds));
  const tapTab = async (tab) => (tab ? tapSel(`#${SURF.strip} [data-tab="${tab}"]`) : false);
  // a control set the way a finger leaves it: a slider dragged (input ticks, then change), a select picked, a field typed
  const setValue = (id, v) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; e.value = String(${JSON.stringify(v)});
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const drag = async (id, values) => {
    for (const v of values) {
      const ok = await js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e) return false; e.value = String(${v}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      if (!ok) return false; await sleep(120);
    }
    return js(`(() => { document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  };
  const nextOption = (id) => js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); if (!e || e.options.length < 2) return false; e.selectedIndex = (e.selectedIndex + 1) % e.options.length;
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const canvasDrag = async (fx0, fy0, fx1, fy1, steps = 8) => {
    const c = JSON.parse(await js('JSON.stringify(window.__canvas())')); if (!c) return false;
    const X = (f) => c.x0 + (c.x1 - c.x0) * f, Y = (f) => c.y0 + (c.y1 - c.y0) * f;
    await touch(Array.from({ length: steps + 1 }, (_, k) => [X(fx0 + ((fx1 - fx0) * k) / steps), Y(fy0 + ((fy1 - fy0) * k) / steps)]));
    return true;
  };

  // ---- the actions (each tab, then each tool's own gesture)
  if (SURFACE === 'art') {
    for (const t of tabIds) await act(`tab: ${t}`, () => tapTab(t));
    await act('Draw tab', () => tapTab(tabIds.find((t) => /draw/i.test(t))));
    await act('Draw: freehand stroke', async () => (await tapSel('#toolDraw')) && (await sleep(300), canvasDrag(0.2, 0.3, 0.7, 0.45, 12)));
    await act('Draw: line', async () => (await tapSel('#toolLine')) && (await sleep(300), canvasDrag(0.2, 0.55, 0.75, 0.6, 6)));
    await act('Draw: rect', async () => (await tapSel('#toolRect')) && (await sleep(300), canvasDrag(0.3, 0.65, 0.6, 0.78, 6)));
    await act('Draw: circle', async () => (await tapSel('#toolCircle')) && (await sleep(300), canvasDrag(0.5, 0.2, 0.6, 0.25, 6)));
    await act('Undo (editor)', () => tapSel('#editorUndo'));
    await act('Redo (editor)', () => tapSel('#editorRedo'));
    await act('Edit tab', () => tapTab(tabIds.find((t) => /edit/i.test(t))));
    await act('Edit: select tap on a stroke', async () => (await tapSel('#toolSelect')) && (await sleep(300), canvasDrag(0.45, 0.375, 0.45, 0.375, 1)));
    await act('Edit: Fit', () => tapSel('#toolFit'));
    await act('Edit: Delete', () => tapSel('#toolDelete'));
    await act('Lattice tab', () => tapTab(tabIds.find((t) => /^lattice/i.test(t))));
    await act('Lattice: Generate', () => tapSel('#latticeGenerate'));
    await act('Shape tab', () => tapTab(tabIds.find((t) => /shape/i.test(t))));
    await act('Shape: Generate', () => tapSel('#shapeLatticeGenerate'));
    await act('Undo after Shape Generate', () => tapSel('#editorUndo'));
    await act('Text tab', () => tapTab(tabIds.find((t) => /text/i.test(t))));
    await act('General tab', () => tapTab(tabIds.find((t) => /general/i.test(t))));
    console.log('general body', await js(`JSON.stringify((() => { const b = document.getElementById('artGeneralBody'); const g = ['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup'];
      const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), disp: getComputedStyle(e).display }; };
      return { body: box(b), groups: g.map((id) => { const e = document.getElementById(id); return { id, inBody: !!(b && e && b.contains(e)), parent: e?.parentElement?.id || e?.parentElement?.className || '', box: box(e) }; }),
        plus: box(document.getElementById('editorStrokeWidthPlus')) }; })())`));
    await act('General: stroke width +', () => tapSel('#editorStrokeWidthPlus'));
    await act('Layers: add layer', () => tapSel('#editorAddLayer'));
    await act('Layers: toggle first visibility', () => tapSel('#editorLayersList [data-action="visibility"], #editorLayersList .layer-visibility, #editorLayersList input[type="checkbox"]'));
  } else if (SURFACE === 'frame') {
    await act('Frame: template (next)', () => nextOption('editorFrameTemplate'));
    await act('Frame: Generate', () => tapSel('#editorFrameGenerate'));
    await act('Frame: Generate again', () => tapSel('#editorFrameGenerate'));
    await act('Frame: thickness', () => setValue('editorFrameThickness', 1.25));
    await act('Frame: inset window on', () => tapSel('#editorFrameInsetWindowToggle'));
    await act('Frame: window X', () => setValue('editorWindowPosX', 0.4));
    await act('Frame: window W', () => setValue('editorWindowSizeW', 2));
    await act('Frame: inset window off', () => tapSel('#editorFrameInsetWindowToggle'));
    await act('Frame: undo', () => tapSel('#editorFrameUndo'));
  } else if (SURFACE === 'photo') {
    await act('Photo: Source tab', () => tapTab('source'));
    await act('Photo: load a pattern', () => tapSel('#photoPatternRow button, #photoPatternRow [role="button"], #photoPatternRow > *'));
    await act('Photo: crop tool', () => tapSel('#photoTool_crop'));
    await act('Photo: crop W + Apply', async () => (await setValue('photoCropW', 0.8)) && tapSel('#photoBtnApplyCrop'));
    await act('Photo: straighten tool', () => tapSel('#photoTool_straighten'));
    await act('Photo: straighten drag', () => drag('photoStraightenSlider', [1, 2, 3, 4, 5]));
    await act('Photo: rotate/flip tool', () => tapSel('#photoTool_rotateFlip'));
    await act('Photo: rotate 90', () => tapSel('#photoBtnRotate'));
    await act('Photo: flip H', () => tapSel('#photoBtnFlipH'));
    await act('Photo: undo', () => tapSel('#photoBtnUndo'));
    await act('Photo: Adjust tab', () => tapTab('adjust'));
    await act('Photo: levels tool', () => tapSel('#photoTool_levels'));
    await act('Photo: brightness drag', () => drag('photoBrightnessSlider', [5, 10, 15, 20, 25]));
    await act('Photo: contrast drag', () => drag('photoContrastSlider', [5, 10, 15, 20, 25]));
    await act('Photo: blur tool', () => tapSel('#photoTool_blur'));
    await act('Photo: blur drag', () => drag('photoBlurSlider', [1, 2, 3, 4]));
    await act('Photo: Relief tab', () => tapTab('relief'));
    await act('Photo: relief carved', () => tapSel('#photoBtnReliefCarved'));
    await act('Photo: relief raised', () => tapSel('#photoBtnReliefRaised'));
  } else if (SURFACE === 'brick') {
    // The Brick tab's drag gestures (advisor pick 2): a real touch stroke in board fractions, per tool. Per stroke, on top
    // of the timing: firstBrickMs (touch -> the first change to a brick element: feedback), strokeMs (touch -> finger up),
    // and LANDING -- where the recorded result sits vs the finger and vs the aim ring the app draws markerOffsetPx above it
    // (the app's own applyTouchMarkerOffset): centroid offsets in screen px (+y = below).
    const brickState = () => js(`(async () => { const ed = window.svgEditor, L = ed._sketchLayer.node;
      const bt = await import('./editor/editor-brick-tool.js');
      const pieces = [...L.querySelectorAll('[data-brick-gen="1"]')].map((n) => n.getAttribute('data-brick') + '|' + (n.getAttribute('points') || n.getAttribute('d') || ''));
      const spines = [...L.querySelectorAll('[data-brick="brush-spine"]')].map((n) => n.outerHTML.length + ':' + (n.getAttribute('points') || [n.getAttribute('x1'), n.getAttribute('y1'), n.getAttribute('x2'), n.getAttribute('y2')].join(',')));
      const cuts = typeof bt.groutCutPolylines === 'function' ? bt.groutCutPolylines(ed).map((c) => c.polyline) : [];
      return JSON.stringify({ pieces, spines, cuts, undo: ed._undoStack.length }); })()`).then(JSON.parse);
    const toScreen = (ptsIn) => js(`JSON.stringify((() => { const m = window.svgEditor._sketchLayer.node.getScreenCTM(); return ${JSON.stringify(ptsIn)}.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]); })())`).then(JSON.parse);
    const boardFrac = (fx, fy) => js(`JSON.stringify([window.svgEditor._mW * ${fx}, window.svgEditor._mH * ${fy}])`).then(JSON.parse);
    const centroid = (ps) => ps.length ? [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length] : null;
    const parsePts = (s) => (s.split('|')[1] || '').trim().split(/[\s,]+/).map(Number).reduce((a, v, i, arr) => (i % 2 ? a : [...a, [v, arr[i + 1]]]), []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const tapId = (id) => tapSel('#' + id);
    // one stroke: finger path in board fractions, touch events timed in page time; records feedback + landing
    const brickStroke = async (name, path, steps = 12) => {
      const fingerIn = []; for (const [fx, fy] of path) fingerIn.push(await boardFrac(fx, fy));
      const pts = []; for (let i = 1; i < fingerIn.length; i++) for (let k = i === 1 ? 0 : 1; k <= steps; k++) pts.push([fingerIn[i - 1][0] + (fingerIn[i][0] - fingerIn[i - 1][0]) * k / steps, fingerIn[i - 1][1] + (fingerIn[i][1] - fingerIn[i - 1][1]) * k / steps]);
      const finger = await toScreen(pts);
      const before = await brickState();
      await js(`(() => { window.__fb = null; const t0 = performance.now(); window.__fbT0 = t0; const root = window.svgEditor._draw.node;
        window.__fbObs?.disconnect(); window.__fbObs = new MutationObserver((ms) => { if (window.__fb != null) return;
          for (const m of ms) { const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
            if (t?.closest?.('[data-brick]') || [...m.addedNodes, ...m.removedNodes].some((n) => n.nodeType === 1 && (n.hasAttribute('data-brick') || n.querySelector?.('[data-brick]')))) { window.__fb = performance.now(); return; } } });
        window.__fbObs.observe(root, { subtree: true, childList: true, attributes: true }); return 1; })()`);
      let tEnd = 0, tUp = 0, midFb = null;
      await act(name, async () => {
        await js('window.__fbT0 = performance.now(), 1');
        await touch(finger, 30, async () => {
          await sleep(300); midFb = await js('window.__fb'); // a brick change while the finger is still down = live feedback
          const sh = await send('Page.captureScreenshot', { format: 'png' });
          if (sh.result?.data) writeFileSync(`${OUT_DIR}/mid_${name.replace(/[^A-Za-z0-9]+/g, '_')}.png`, Buffer.from(sh.result.data, 'base64'));
          tUp = await js('performance.now()');
        });
        tEnd = await js('performance.now()');
        return true;
      });
      const fb = JSON.parse(await js(`JSON.stringify({ first: window.__fb, t0: window.__fbT0 })`));
      const after = await brickState();
      const newPieces = after.pieces.filter((p) => !before.pieces.includes(p));
      const newSpines = after.spines.filter((p) => !before.spines.includes(p));
      const newCuts = after.cuts.slice(before.cuts.length).flat().map((p) => [p.x, p.y]);
      const areaIn = JSON.parse(await js(`JSON.stringify((() => { const n = window.svgEditor._sketchLayer.node; const recs = [...n.querySelectorAll('[data-brick-record="wall-area"]')].map((r) => r.getAttribute('data-brick-element'));
        const id = recs[recs.length - 1]; if (!id || ${before.pieces.length} === 0) return [];
        return [...n.querySelectorAll('[data-brick="wall"]')].filter((e) => e.getAttribute('data-brick-owner') === id).map((e) => e.getAttribute('points') || ''); })())`));
      const isArea = /^Area/.test(name) && areaIn.length;
      const recIn = newCuts.length ? newCuts : isArea ? areaIn.map((p) => centroid(parsePts('x|' + p))).filter(Boolean) : newPieces.map((p) => centroid(parsePts(p))).filter(Boolean);
      const rec = recIn.length ? centroid(await toScreen(recIn)) : null;
      const aimIn = await js(`(async () => { const g = await import('./editor/editor-grid.js'); const ed = window.svgEditor; const was = ed._pointerType; ed._pointerType = 'touch';
        const out = ${JSON.stringify(pts)}.map(([x, y]) => { const q = g.applyTouchMarkerOffset(ed, { x, y }); return [q.x, q.y]; }); ed._pointerType = was; return JSON.stringify(out); })()`).then(JSON.parse);
      const aim = centroid(await toScreen(aimIn)), fing = centroid(finger);
      const r = results[results.length - 1];
      Object.assign(r, {
        firstBrickMs: fb.first == null ? null : Math.round(fb.first - fb.t0), strokeMs: Math.round(tEnd - fb.t0),
        liveWhileDown: midFb != null, afterUpMs: fb.first == null ? null : Math.round(Math.max(0, fb.first - tUp)), upHandlerMs: Math.round(tEnd - tUp),
        newPieces: newPieces.length, removedPieces: before.pieces.filter((p) => !after.pieces.includes(p)).length, newSpines: newSpines.length, newCutPts: newCuts.length, undoSteps: after.undo - before.undo,
        landing: rec ? { vsFingerPx: [Math.round(rec[0] - fing[0]), Math.round(rec[1] - fing[1])], vsAimPx: [Math.round(rec[0] - aim[0]), Math.round(rec[1] - aim[1])], aimAboveFingerPx: Math.round(fing[1] - aim[1]), from: newCuts.length ? 'recorded cut line' : isArea ? `the area's ${areaIn.length} bricks` : 'new pieces' } : null,
      });
      console.log('  ->', JSON.stringify({ liveWhileDown: r.liveWhileDown, afterUpMs: r.afterUpMs, upHandlerMs: r.upHandlerMs, firstBrickMs: r.firstBrickMs, strokeMs: r.strokeMs, newPieces: r.newPieces, removed: r.removedPieces, spines: r.newSpines, cutPts: r.newCutPts, undo: r.undoSteps, landing: r.landing }));
    };
    await act('Wall: tool', () => tapId('brickTool_wall'));
    await act('Wall: Generate', () => tapId('brickGenerate'));
    await act('Brush: tool', () => tapId('brickTool_brush'));
    await brickStroke('Brush: stroke', [[0.22, 0.45], [0.78, 0.5]]);
    await act('Raised brush: tool', () => tapId('brickTool_raisedBrush'));
    await act('Raised brush: Bricks mode', () => tapId('brickRaisedMode_bricks'));
    await brickStroke('Raised brush: stroke', [[0.22, 0.62], [0.78, 0.64]]);
    await act('Raised brush: Grout mode', () => tapId('brickRaisedMode_grout'));
    await brickStroke('Grout cut: stroke', [[0.3, 0.2], [0.7, 0.75]]);
    await act('Raised brush: back to Bricks', () => tapId('brickRaisedMode_bricks'));
    await act('Wall: tool (areas)', () => tapId('brickTool_wall'));
    await act('Wall: Area sub-tool', () => tapId('brickSubTool_wall_area'));
    await act('Area: width 2', () => tapId('brickWallAreaWidth_2'));
    await brickStroke('Area brush: stroke', [[0.3, 0.3], [0.62, 0.38]]);
    // scissors on the Brush stroke: press below it and drag so the AIM (above the finger) sits on the spine, release,
    // then tap the green check
    await act('Scissors: tool', () => tapId('brickTool_scissors'));
    const [sx, sy] = await boardFrac(0.5, 0.475);
    const aimUp = await js(`(async () => { const g = await import('./editor/editor-grid.js'); const ed = window.svgEditor; const was = ed._pointerType; ed._pointerType = 'touch';
      const q = g.applyTouchMarkerOffset(ed, { x: 0, y: 0 }); ed._pointerType = was; return -q.y; })()`);
    const sPath = []; for (let k = 0; k <= 8; k++) sPath.push([sx - 0.6 + 0.075 * k, sy + aimUp]);
    const sScreen = await toScreen(sPath);
    const sBefore = await brickState();
    await act('Scissors: aim drag', async () => { await touch(sScreen, 30); return true; });
    const okBtn = await js(`JSON.stringify((() => { const c = document.querySelector('#touch-confirm circle[fill="#2e7d32"]'); if (!c) return null; const r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })())`).then(JSON.parse);
    console.log('  -> confirm check', JSON.stringify(okBtn));
    await act('Scissors: tap the check', async () => { if (!okBtn) return false; await touch([okBtn]); return true; });
    const sAfter = await brickState();
    console.log('  -> scissors', JSON.stringify({ spines: `${sBefore.spines.length} -> ${sAfter.spines.length}`, undo: sAfter.undo - sBefore.undo }));
    const shotB = await send('Page.captureScreenshot', { format: 'png' });
    if (shotB.result?.data) writeFileSync(`${OUT_DIR}/brick_after_strokes.png`, Buffer.from(shotB.result.data, 'base64'));
  } else if (SURFACE === 'undo') {
      // The UNDO coverage map (seat D 2026-10-08, advisor pick 3): each action the way a finger does it, then ONE press of
      // that tab's own Undo control (the Frame tab has its own history); which parts of the board came back. Verdicts:
      // one step + fully undone | NO UNDO STEP | N STEPS | PARTIAL (what stayed) | UNDO ALSO MOVED (what it touched).
    await send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const UST = `(async () => { const S = await import('./core/state.js'); const R = await import('./core/frame-record.js'); const F = await import('./main/frame-panel.js');
      const ed = window.svgEditor; const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((q) => [q, v[q]])) : v)); const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
      const c = ed._sketchLayer.node.cloneNode(true);
      for (const n of c.querySelectorAll('[data-brick-gen="1"], [data-brick-set]')) n.removeAttribute('fill'); // display-only greys (async)
      const canvas = h(c.innerHTML.replace(/ ?(svg-selected|inactive-layer)/g, '').replace(/ class=""/g, ''));
      return JSON.stringify({ canvas, bricks: h(stable(S.P.brickSettings)), frame: h(stable(R.getFrameRecord())),
        photo: h(JSON.stringify({ u: String(S.P.photoImageDataUrl || '').slice(-80), e: S.P.photoEdits, p: S.P.photoPatternId, z: S.P.carveZ })),
        layers: h(JSON.stringify((ed._layers || []).map((l) => [l.id, l.name, l.visible !== false]))),
        parts: h(stable(await import('./editor/undo-parts.js').then((U) => U.takeUndoParts()))), depth: ed._undoStack.length, fdepth: F.frameHistoryDepth() }); })()`;
    const PARTS = ['canvas', 'bricks', 'frame', 'photo', 'layers', 'parts'];
    const tabOf = { art: 'editorTabArtwork', brick: 'editorTabBrick', frame: 'editorTabFrame', photo: 'editorTabPhoto' };
    const undoOf = { art: '#editorUndo', brick: '#editorUndo', frame: '#editorFrameUndo', photo: '#editorUndo' };
    const pick = (id) => tapSel('#' + id);
    const canvasStroke = (fx0, fy0, fx1, fy1) => canvasDrag(fx0, fy0, fx1, fy1, 10);
    const boardStroke = async (fracs) => { const pts = JSON.parse(await js(`JSON.stringify((() => { const ed = window.svgEditor, m = ed._sketchLayer.node.getScreenCTM(); const P = ${JSON.stringify(fracs)}.map(([fx, fy]) => [ed._mW * fx, ed._mH * fy]);
        const out = []; for (let i = 1; i < P.length; i++) for (let k = i === 1 ? 0 : 1; k <= 12; k++) { const x = P[i - 1][0] + (P[i][0] - P[i - 1][0]) * k / 12, y = P[i - 1][1] + (P[i][1] - P[i - 1][1]) * k / 12; out.push([m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]); } return out; })())`));
      await touch(pts); return true; };
    const ACTIONS = [
      // Art
      ['art', 'Draw: freehand stroke', ['artTab_draw', 'toolDraw'], () => canvasStroke(0.25, 0.3, 0.7, 0.42)],
      ['art', 'Draw: line', ['toolLine'], () => canvasStroke(0.25, 0.55, 0.7, 0.6)],
      ['art', 'Draw: rect', ['toolRect'], () => canvasStroke(0.3, 0.65, 0.6, 0.78)],
      ['art', 'Draw (kept: the next row deletes it)', ['artTab_draw', 'toolDraw'], () => canvasStroke(0.25, 0.3, 0.7, 0.42), true],
      ['art', 'Edit: select + Delete', ['artTab_edit', 'toolSelect'], async () => (await canvasDrag(0.47, 0.36, 0.47, 0.36, 1)) && (await sleep(400), pick('toolDelete'))],
      ['art', 'General: stroke width +', ['artTab_general'], () => pick('editorStrokeWidthPlus')],
      ['art', 'Lattice: Generate', ['artTab_lattice'], () => pick('latticeGenerate')],
      ['art', 'Shape: Generate', ['artTab_shape'], () => pick('shapeLatticeGenerate')],
      ['art', 'Layers: add a layer', [], () => pick('editorAddLayer')],
      // Brick
      ['brick', 'Wall: Generate', ['brickTool_wall'], () => pick('brickGenerate')],
      ['brick', 'Wall: pattern Herringbone', ['brickTool_wall'], () => pick('brickPattern_herringbone')],
      ['brick', 'Wall: Generate again (new seed)', ['brickTool_wall'], () => pick('brickGenerate')],
      ['brick', 'Brush: stroke', ['brickTool_brush'], () => boardStroke([[0.22, 0.45], [0.78, 0.5]])],
      ['brick', 'Raised brush: stroke', ['brickTool_raisedBrush', 'brickRaisedMode_bricks'], () => boardStroke([[0.22, 0.62], [0.78, 0.64]])],
      ['brick', 'Grout cut: stroke', ['brickTool_raisedBrush', 'brickRaisedMode_grout'], () => boardStroke([[0.3, 0.2], [0.7, 0.75]])],
      ['brick', 'Area brush: stroke', ['brickRaisedMode_bricks', 'brickTool_wall', 'brickSubTool_wall_area', 'brickWallAreaWidth_2'], () => boardStroke([[0.3, 0.3], [0.62, 0.38]])],
      ['brick', 'Frame tool: Generate', ['brickTool_frame'], () => pick('brickGenerate')],
      // Frame
      ['frame', 'Template: next', [], () => nextOption('editorFrameTemplate')],
      ['frame', 'Generate', [], () => pick('editorFrameGenerate')],
      ['frame', 'Thickness 1.25', [], () => setValue('editorFrameThickness', 1.25)],
      ['frame', 'Inset window on', [], () => pick('editorFrameInsetWindowToggle')],
      // Photo
      ['photo', 'Load a pattern', ['photoTab_source'], () => tapSel('#photoPatternRow button')],
      ['photo', 'Rotate 90', ['photoTool_rotateFlip'], () => pick('photoBtnRotate')],
      ['photo', 'Flip H', ['photoTool_rotateFlip'], () => pick('photoBtnFlipH')],
      ['photo', 'Crop W 0.8 + Apply', ['photoTool_crop'], async () => (await setValue('photoCropW', 0.8)) && pick('photoBtnApplyCrop')],
      ['photo', 'Brightness drag', ['photoTab_adjust', 'photoTool_levels'], () => drag('photoBrightnessSlider', [5, 10, 15, 20])],
      ['photo', 'Relief: carved', ['photoTab_relief'], () => pick('photoBtnReliefCarved')],
    ];
    const map = [];
    let curTab = null;
    for (const [tab, name, pre, act, keep] of ACTIONS) {
      if (tab !== curTab) { await pick(tabOf[tab]); await sleep(1800); curTab = tab; }
      for (const id of pre) { await pick(id); await sleep(600); }
      await sleep(1500);
      const a = JSON.parse(await js(UST));
      const did = await act();
      await sleep(3000);
      const b = JSON.parse(await js(UST));
      const changed = PARTS.filter((p) => a[p] !== b[p]);
      const steps = (b.depth - a.depth) + (b.fdepth - a.fdepth);
      if (keep) { console.log(JSON.stringify({ tab, name, setup: true, steps })); continue; } // a setup row: kept, not undone
      await tapSel(undoOf[tab]); await sleep(3500);
      const u = JSON.parse(await js(UST));
      const notBack = changed.filter((p) => u[p] !== a[p]);
      const alsoMoved = PARTS.filter((p) => !changed.includes(p) && u[p] !== a[p]); // undo touched something the action had not
      const verdict = did === false ? 'COULD NOT ACT' : !changed.length ? 'no change (setup?)' : steps === 0 ? 'NO UNDO STEP' : steps > 1 ? `${steps} STEPS` : notBack.length ? `PARTIAL: ${notBack.join('+')} not back` : alsoMoved.length ? `UNDO ALSO MOVED ${alsoMoved.join('+')}` : 'ok: one step, fully undone';
      const r = { tab, name, changed, steps, verdict };
      map.push(r); console.log(JSON.stringify(r));
      // redo nothing: the next action starts from the undone board (each row stands alone)
    }
    writeFileSync(`${OUT_DIR}/undo_map.json`, JSON.stringify(map, null, 1));
  } else if (SURFACE === 'sidebar') {
    // The main sidebar with the editor CLOSED (advisor pick, 2026-10-08: the last surface Fred uses on the phone that was
    // never timed): per sidebar tab, its collapsed panels opened, every visible control acted on the way a finger
    // leaves it -- a slider dragged (its number twin skipped), a select stepped, a checkbox / button tapped, a lone
    // number box nudged by one step. SIDEBAR_SKIP: what leaves the page or the sidebar (the editor, a file picker, a
    // download, the cloud, a delete).
    const SIDEBAR_SKIP = /StampEdit|EditBricks|EditFrameShape|Upload|Choose|DeleteFrame|Download|Cloud|Save|Login|SignIn|Password|Project|Share/i;
    const tabs = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('[id^="sidebarTab_"]')].map((b) => b.id))`) || '[]');
    console.log('sidebar tabs', JSON.stringify(tabs));
    const done = new Set(), skipped = [];
    for (const tab of tabs) {
      await act(`tab: ${tab.replace('sidebarTab_', '')}`, () => tapSel('#' + tab));
      await js(`(async () => { const root = document.querySelector(${JSON.stringify(SURF.panelSel)}); if (!root) return 0; for (const h of root.querySelectorAll('.panel-header.collapsed')) { if (h.getClientRects().length) { h.click(); await new Promise((r) => setTimeout(r, 150)); } } await new Promise((r) => setTimeout(r, 600)); return 1; })()`);
      const controls = JSON.parse(await js(`JSON.stringify((() => { const root = document.querySelector(${JSON.stringify(SURF.panelSel)}); if (!root) return [];
        return [...root.querySelectorAll('button[id], input[id], select[id]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && e.type !== 'hidden' && e.type !== 'file')
          .map((e) => ({ id: e.id, tag: e.tagName.toLowerCase(), type: e.type || '', twin: e.tagName === 'INPUT' && e.type !== 'range' && !!document.getElementById(e.id + 'Slider'),
            min: e.min, max: e.max, step: e.step, value: e.value })); })())`) || '[]');
      for (const c of controls) {
        if (done.has(c.id) || c.id.startsWith('sidebarTab_')) continue;
        done.add(c.id);
        if (SIDEBAR_SKIP.test(c.id)) { skipped.push(c.id); continue; }
        if (c.twin) continue; // its slider is the finger's control
        const name = `${tab.replace('sidebarTab_', '')}: ${c.id}`;
        if (c.type === 'range') {
          const lo = +c.min || 0, hi = c.max === '' ? 1 : +c.max, v = +c.value;
          const to = v + (hi - lo) * (v - lo < (hi - lo) / 2 ? 0.3 : -0.3);
          await act(`${name} (drag)`, () => drag(c.id, [1, 2, 3, 4].map((k) => v + (to - v) * k / 4)));
        } else if (c.tag === 'select') {
          await act(`${name} (next)`, () => nextOption(c.id));
        } else if (c.type === 'number' || c.type === 'text') {
          const v = parseFloat(c.value); if (!Number.isFinite(v)) { skipped.push(c.id + ' (no number)'); continue; }
          const st = parseFloat(c.step) || (Math.abs(v) >= 1 ? 1 : 0.01);
          await act(`${name} (nudge)`, () => setValue(c.id, +(v + st).toFixed(6)));
        } else {
          await act(`${name} (tap)`, () => tapSel(`[id="${c.id}"]`));
        }
      }
    }
    console.log('skipped', JSON.stringify(skipped));
    const worst = results.filter((r) => !r.skipped).sort((a, b) => (b.blindMs - a.blindMs) || (b.longestMs - a.longestMs)).slice(0, 12);
    console.log('WORST (blind, then longest):');
    for (const r of worst) console.log('  ', r.name.padEnd(44), JSON.stringify({ blindMs: r.blindMs, cardMs: r.cardMs, longestMs: r.longestMs, responseMs: r.responseMs, busyMs: r.busyMs }));
  }

  // ---- reach, per tab (each tab shows its own tools and its tool's settings): every visible control in the audited
  // panel + the editor's top bar, scrolled into view (Photo: per tool too -- a tool shows its own settings)
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const reach = [];
  const PHOTO_TOOLS = { source: ['crop', 'straighten', 'rotateFlip'], adjust: ['levels', 'blur'] };
  const views = SURFACE === 'photo' ? tabIds.flatMap((t) => (PHOTO_TOOLS[t] || [null]).map((tool) => [t, tool])) : tabIds.map((t) => [t, null]);
  for (const [tab, tool] of views) {
    await tapTab(tab); if (tool) await tapSel(`#photoTool_${tool}`); await sleep(800);
    const rows = JSON.parse(await js(`JSON.stringify((() => {
      const roots = [document.querySelector(${JSON.stringify(SURF.panelSel || '#' + SURF.panel)}), document.querySelector('#svgEditorModal .editor-topbar, #svgEditorModal header, #editorTopBar, #editorToolbarTop')].filter(Boolean);
      const out = [], seen = new Set();
      for (const root of roots) for (const e of root.querySelectorAll('button, input, select, [role="tab"]')) {
        if (seen.has(e)) continue; seen.add(e);
        if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.type === 'hidden') continue;
        e.scrollIntoView({ block: 'center', inline: 'center' });
        // a checkbox's target is its label row (the matrix's layout 'Touch targets' rows measure it the same way)
        const r = ((e.type === 'checkbox' && e.closest('label')) || e).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const inView = cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight;
        const hit = inView ? document.elementFromPoint(cx, cy) : null;
        out.push({ id: e.id || e.getAttribute('aria-label') || e.title || e.textContent.trim().slice(0, 20), inView,
          covered: inView && !(hit === e || e.contains(hit) || (e.labels && [...e.labels].some((l) => l.contains(hit)))),
          by: hit && hit !== e && !e.contains(hit) ? (hit.id || hit.className || hit.tagName).toString().slice(0, 40) : '', minPx: Math.round(Math.min(r.width, r.height)) });
      }
      return out; })())`) || '[]');
    for (const r of rows) reach.push({ tab: tool ? `${tab}/${tool}` : tab, ...r });
  }
  const bad = reach.filter((r) => !r.inView || r.covered);
  const small = reach.filter((r) => r.inView && !r.covered && r.minPx < 24);
  console.log(`reach (all tabs): ${reach.length} control views, ${bad.length} unreachable/covered, ${small.length} under 24 px`);
  for (const r of bad) console.log('  UNREACHABLE', JSON.stringify(r));
  const smallIds = [...new Set(small.map((r) => `${r.id} ${r.minPx}px`))];
  console.log('  under 24 px:', smallIds.join(' | '));
  writeFileSync(`${OUT_DIR}/${SURFACE}_${BOARD}_phone_audit.json`, JSON.stringify({ cpu: CPU, view: VIEW, board: BOARD, results, reach, errors }, null, 1));
  // Fred's rule (a card or pill before every long computation): each action with a long task >= LONG_MS -- NO FEEDBACK
  // when no card showed at all, BLIND when the card came only after >= BLIND_MS of long tasks
  const LONG_MS = Number(process.env.LONG_MS || 500), BLIND_MS = 50;
  for (const r of results.filter((x) => !x.skipped && x.longestMs >= LONG_MS)) {
    const verdict = r.cardMs == null ? 'NO FEEDBACK' : r.blindMs >= BLIND_MS ? 'BLIND ' + r.blindMs + ' ms' : 'ok';
    console.log('LONG', JSON.stringify({ surface: SURFACE, board: BOARD, name: r.name, longestMs: r.longestMs, cardMs: r.cardMs, blindMs: r.blindMs, verdict }));
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) writeFileSync(`${OUT_DIR}/${SURFACE}_phone_end.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('errors', errors.length, JSON.stringify(errors.slice(0, 5)));
} finally { stop(); }
