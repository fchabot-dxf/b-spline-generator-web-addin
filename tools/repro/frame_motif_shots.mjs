// Frame motifs phase 1: each motif preset laid in the real app (headless Chrome + swiftshader, raw CDP, no deps) on a
// 7x10 board at its recommended brick size, Wall + Frame, then a 2D shot (the editor canvas, bricks grey by height:
// lighter = higher) and a 3D shot (window.__preview.getSnapshot). Plus one hourglass (template_1) board.
//
// Usage: node tools/repro/frame_motif_shots.mjs <outDir> <paletteUrl> [cdpPort]
//   serve bspline-frame-builder/ with tools/brick-matrix/serve.py so ../../styles resolve.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT, URL, PORTARG] = process.argv.slice(2);
if (!OUT || !URL) { console.log('usage: node tools/repro/frame_motif_shots.mjs <outDir> <paletteUrl> [cdpPort]'); process.exit(1); }
const PORT = Number(PORTARG || 9493);
const PROFILE = `${OUT}/.chrome-motifs-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
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
].filter((s) => !BOARDS || BOARDS.includes(s[0]));

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
const click = (elId, wait = 1200) => js(`(async()=>{ const b=document.getElementById(${JSON.stringify(elId)}); if(!b) return 'MISSING'; if(b.disabled) return 'DISABLED'; b.click(); await new Promise(r=>setTimeout(r,${wait})); return 'ok'; })()`);
const setValue = (elId, v) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); if(!e) return 'MISSING'; e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event('change')); return 'ok'; })()`);
const editorOpen = () => js(`getComputedStyle(document.getElementById('svgEditorModal')).display !== 'none'`);
const BUILT = `import('./core/engine/rebuild.js').then((m) => (typeof m.whenRebuildIdle !== 'function' ? true
  : Promise.race([m.whenRebuildIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 0))]))
  .then((idle) => idle && (document.getElementById('loading-stage')?.hidden ?? true)))`;
async function settle(ms = 60000) { const t0 = Date.now(); await sleep(1500); while (Date.now() - t0 < ms && !(await js(BUILT))) await sleep(700); await sleep(1500); }

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
for (let i = 0; i < 180; i++) { await sleep(1000); if (await js(`import('./core/state.js').then((m) => m.bootRestore ? m.bootRestore.complete === true : true, () => false)`)) break; }
await sleep(2000);
await setValue('widthIn', 7); await setValue('heightIn', 10); await sleep(2500);
const report = [];
for (const [tag, preset, template, size] of SHOTS) {
  if (!(await editorOpen())) await click('btnStampEdit', 3000);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
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
  await click('editorApply', 2500);
  await settle();
  const info = JSON.parse(await js(`(async()=>{ const { P } = await import('./core/state.js'); const n=(k)=>window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick-gen="1"][data-brick="'+k+'"]').length;
    const offs=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')].map((e)=>+e.getAttribute('data-brick-height-offset'));
    return JSON.stringify({ board: P.widthIn+'x'+P.heightIn, size: P.brickSettings.brickLengthIn, preset: P.brickSettings.frameBandPreset, frame: n('frame'), wall: n('wall'), raised: offs.filter((o)=>o>0.04).length }); })()`) || '{}');
  // 3D: the default camera's whole-board view
  const d3 = await js(`window.__preview.getSnapshot(1000, 1000)`);
  if (d3) writeFileSync(`${OUT}/app_${tag}_3d.png`, Buffer.from(d3.replace(/^data:image\/png;base64,/, ''), 'base64'));
  // 2D: reopen the editor on the Brick tab (the bricks are grey by height once the mask has landed) and shoot its canvas
  await click('btnStampEdit', 3000); await click('editorTabBrick', 1500); await sleep(2500);
  const box = JSON.parse(await js(`(()=>{ const svg=window.svgEditor._sketchLayer.node.ownerSVGElement || window.svgEditor._sketchLayer.node.closest('svg'); const r=svg.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height}); })()`));
  const s2 = await send('Page.captureScreenshot', { format: 'png', clip: { x: box.x, y: box.y, width: box.w, height: box.h, scale: 1 } });
  writeFileSync(`${OUT}/app_${tag}_2d.png`, Buffer.from(s2.result.data, 'base64'));
  await click('editorApply', 2500); await settle();
  report.push({ tag, tpl, presetClick: p, ...info });
  console.error(tag, JSON.stringify(info));
}
console.log(JSON.stringify({ report, errors: errors.slice(0, 5) }, null, 1));
ws.close(); chrome.kill();
