// Frame motifs phase 1: each motif preset laid in the real app (headless Chrome + swiftshader, raw CDP, no deps) on a
// 7x10 board at its recommended brick size, Wall + Frame, then a 2D shot (the editor canvas, bricks grey by height:
// lighter = higher) and a 3D shot (window.__preview.getSnapshot). Plus one hourglass (template_1) board.
//
// Usage: node tools/repro/frame_motif_shots.mjs <outDir> <paletteUrl> [cdpPort]
//   SHOTS='[["tag","preset","template_1",1.25],...]' replaces the list below; PREFIX (default app_) starts each file name;
//   BOARD (default 7x10) is the board size.
//   serve bspline-frame-builder/ with tools/brick-matrix/serve.py so ../../styles resolve.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [OUT, URL, PORTARG] = process.argv.slice(2);
if (!OUT || !URL) { console.log('usage: node tools/repro/frame_motif_shots.mjs <outDir> <paletteUrl> [cdpPort]'); process.exit(1); }
const PORT = Number(PORTARG || 9493);
// a FRESH profile each run, outside the shots folder (MEASURED: a reused profile's saved session kept the app from booting)
const PROFILE = mkdtempSync(path.join(os.tmpdir(), 'chrome-motifs-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BOARDS = (process.env.ONLY ? process.env.ONLY.split(',') : null);
// [file tag, preset, template ('' = the plain rectangle), brick size in]
const SHOTS = [
  ['dentil_corbel', 'dentil_corbel', '', 1],
  ['recessed_panel', 'recessed_panel', '', 1.25],
  ['zigzag_band', 'zigzag_band', '', 1.25],
  ['diaper_lattice', 'diaper_lattice', '', 1.25],
  ['soldier_string', 'soldier_string', '', 1.25],
  ['dentil_cornice', 'dentil_cornice', '', 1],
  ['hourglass_dentil_corbel', 'dentil_corbel', 'template_1', 1],
];
const SHOT_LIST = (process.env.SHOTS ? JSON.parse(process.env.SHOTS) : SHOTS).filter((s) => !BOARDS || BOARDS.includes(s[0]));
const PREFIX = process.env.PREFIX || 'app_';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
console.error('chrome pid', chrome.pid);
let wsUrl = null;
for (let i = 0; i < 100 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.error('EVAL', (r.result.exceptionDetails.exception?.description || '').split('\n')[0]); return r.result?.result?.value; };
const click = (elId, wait = 1200) => js(`(async()=>{ try { const m = await import('./main/brick-panel.js'); if (m.revealBrickControl) m.revealBrickControl(${JSON.stringify(elId)}); } catch {} const b=document.getElementById(${JSON.stringify(elId)}); if(!b) return 'MISSING'; if(b.disabled) return 'DISABLED'; b.click(); await new Promise(r=>setTimeout(r,${wait})); return 'ok'; })()`);
const setValue = (elId, v) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); if(!e) return 'MISSING'; e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event('change')); return 'ok'; })()`);
const editorOpen = () => js(`getComputedStyle(document.getElementById('svgEditorModal')).display !== 'none'`);
const BUILT = `import('./core/engine/rebuild.js').then((m) => (typeof m.whenRebuildIdle !== 'function' ? true
  : Promise.race([m.whenRebuildIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 0))]))
  .then((idle) => idle && (document.getElementById('loading-stage')?.hidden ?? true)))`;
async function settle(ms = 60000) { const t0 = Date.now(); await sleep(1500); while (Date.now() - t0 < ms && !(await js(BUILT))) await sleep(700); await sleep(1500); }

const splashGone = () => js(`(() => { const s = document.getElementById('app-splash'); return !!document.getElementById('btnStampEdit') && (!s || s.classList.contains('app-splash-hidden')); })()`);
const T0 = Date.now();
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Page.navigate', { url: URL });
// booted: core/state.js bootRestore.complete and the splash hidden (main/main.js) -- measured ~40 s under swiftshader
// MEASURED: polling core/state.js from the first second of the load kept the app from booting (splash up at 240 s); left
// alone it boots in ~40 s -- so wait first, then poll
await sleep(40000);
for (let i = 0; i < 120; i++) { await sleep(1000); if (await js(`import('./core/state.js').then((m) => !!(m.bootRestore && m.bootRestore.complete), () => false)`) && await splashGone()) break; }
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(2000);
if (process.env.DEBUG) console.error('booted', Date.now() - T0, await js(`JSON.stringify({ boot: 0, splash: document.getElementById('app-splash')?.className ?? 'gone', modal: getComputedStyle(document.getElementById('svgEditorModal')).display, ed: !!window.svgEditor, w: document.getElementById('widthIn')?.value })`));
await splashGone();
const [BW, BH] = (process.env.BOARD || '7x10').split('x').map(Number);
await setValue('widthIn', BW); await setValue('heightIn', BH); await settle();
if (process.env.DEBUG) console.error('board', Date.now() - T0, await js(`JSON.stringify({ boot: 0, splash: document.getElementById('app-splash')?.className ?? 'gone', modal: getComputedStyle(document.getElementById('svgEditorModal')).display, ed: !!window.svgEditor, w: document.getElementById('widthIn')?.value })`));
const report = [];
try {
for (const [tag, preset, template, size] of SHOT_LIST) {
  await splashGone();
  if (!(await editorOpen())) await click('btnStampEdit', 3000);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  if (process.env.DEBUG) console.error('open', await js(`JSON.stringify({ modal: getComputedStyle(document.getElementById('svgEditorModal')).display, ed: !!window.svgEditor, sk: !!window.svgEditor?._sketchLayer, btn: !!document.getElementById('btnStampEdit'), splash: !!document.getElementById('app-splash-name')?.offsetParent })`));
  await click('editorTabFrame', 800);
  const tpl = await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 'none';
    const want=${JSON.stringify(template)}; const opt=[...s.options].find((o)=> want ? o.value===want : !/^template_/.test(o.value));
    s.value=opt ? opt.value : want; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2500)); return s.value + ' [' + [...s.options].slice(0,3).map(o=>o.value).join(',') + ']'; })()`);
  await click('editorTabBrick', 800);
  await click('brickTool_frame', 900);
  await setValue('brickSize', size); await sleep(1500);
  const p = await click(`brickFramePreset_${preset}`, 2500);
  await click('brickTool_wall', 900);
  await click('brickGenerate', 3000);
  const info = JSON.parse((await js(`(async()=>{ const { P } = await import('./core/state.js'); const n=(k)=>window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="'+k+'"]').length;
    const offs=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')].map((e)=>+e.getAttribute('data-brick-height-offset'));
    return JSON.stringify({ board: P.widthIn+'x'+P.heightIn, size: P.brickSettings.brickLengthIn, preset: P.brickSettings.frameBandPreset, frame: n('frame'), wall: n('wall'), raised: offs.filter((o)=>o>0.04).length }); })()`)) || '{}');
  await click('editorApply', 2500);
  await settle();
  // 3D: the default camera's whole-board view, then a raking close-up on one corner (the relief reads there)
  const snap = async (file) => { const d = await js(`window.__preview.getSnapshot(1000, 1000)`); if (d) writeFileSync(file, Buffer.from(d.replace(/^data:image\/png;base64,/, ''), 'base64')); };
  const view = (ex, ez, r, tx, ty) => js(`(async()=>{ const { AppState } = await import('./main/app-state.js'); const p = AppState.preview, o = p._orbit, T = p._THREE;
    o._targetOrb.q.setFromEuler(new T.Euler(${ex}, 0, ${ez}, 'ZXY')); o._targetOrb.r = ${r}; o._targetOrb.target.set(${tx}, ${ty}, 0);
    o._orb.q.copy(o._targetOrb.q); o._orb.r = o._targetOrb.r; o._orb.target.copy(o._targetOrb.target);
    p._camera.position.addVectors(o._orb.target, new T.Vector3(0, 0, o._orb.r).applyQuaternion(o._orb.q)); p._camera.quaternion.copy(o._orb.q);
    if (typeof p.updateFrustum === 'function') p.updateFrustum(); else if (typeof o.updateFrustum === 'function') o.updateFrustum();
    p._needsRender = true; await new Promise((r) => setTimeout(r, 2500)); return 1; })()`);
  await view(0.55, 0.35, 17, 0, 0); // the whole board, from above at a slight rake
  await snap(`${OUT}/${PREFIX}${tag}_3d.png`);
  await view(0.95, 0.6, 6, -2.2, -3.6); // one corner, raking light across the relief
  await snap(`${OUT}/${PREFIX}${tag}_3d_corner.png`);
  // 2D: the editor's canvas, the whole board fitted, each laid piece tinted by its relief (data-brick-height-offset:
  // lighter = raised, darker = recessed -- the mockups' convention; display only, this throwaway session is never saved)
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1700, deviceScaleFactor: 1, mobile: false }); await sleep(1500);
  await splashGone(); await click('btnStampEdit', 3000); await click('editorTabBrick', 1500); await sleep(2500);
  await js(`(()=>{ window.svgEditor.fitView(); const ns = window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick-set]');
    ns.forEach((n) => { const h = +n.getAttribute('data-brick-height-offset') || 0; n.setAttribute('fill', h > 0.04 ? '#e2a07c' : h < -0.04 ? '#5e2a1c' : n.getAttribute('data-brick') === 'wall' ? '#94503a' : '#a9583e'); }); return ns.length; })()`);
  await sleep(800);
  const box = JSON.parse(await js(`(()=>{ const svg=window.svgEditor._sketchLayer.node.ownerSVGElement || window.svgEditor._sketchLayer.node.closest('svg'); const c=svg.parentElement.getBoundingClientRect(), r=svg.getBoundingClientRect();
    const x=Math.max(c.x,r.x), y=Math.max(c.y,r.y); return JSON.stringify({x, y, w: Math.min(c.right,r.right)-x, h: Math.min(c.bottom,r.bottom)-y}); })()`));
  const s2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 } });
  writeFileSync(`${OUT}/${PREFIX}${tag}_2d.png`, Buffer.from(s2.result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(1000);
  await click('editorApply', 2500); await settle();
  report.push({ tag, tpl, presetClick: p, ...info });
  console.error(tag, JSON.stringify(info));
}
} finally {
console.log(JSON.stringify({ report, errors: errors.slice(0, 5) }, null, 1));
ws.close(); chrome.kill();
}
