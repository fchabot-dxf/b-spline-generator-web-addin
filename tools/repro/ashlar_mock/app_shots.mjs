// Rough ashlar in the real app: a 7x10 board, the Wall tool, the Rough ashlar pattern at 1 in -> a 2D editor shot and a
// 3D shot after Apply. Serves bspline-frame-builder/ with tools/brick-matrix/serve.py and drives headless Chrome over
// CDP (raw websocket, no deps; the brick_resolution_grid_shots.mjs pattern). Kills only the two PIDs it starts.
//
// Usage: node tools/repro/ashlar_mock/app_shots.mjs <outDir> [httpPort] [cdpPort]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const [OUT = path.join(HERE, 'out'), HTTP = '8797', CDP = '9497'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZE_IN = Number(process.env.ASHLAR_SIZE || 1);

const server = spawn('python', [path.join(ROOT, 'tools/brick-matrix/serve.py'), HTTP], { cwd: path.join(ROOT, 'bspline-frame-builder'), stdio: 'ignore' });
const profile = mkdtempSync(path.join(os.tmpdir(), 'ashlar-app-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
console.error('pids: server', server.pid, 'chrome', chrome.pid);
const stop = () => { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };

try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up */ }
  }
  if (!wsUrl) throw new Error('no CDP');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.error('EVAL', (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n').slice(0, 3).join(' | '));
    return r.result?.result?.value;
  };
  const click = async (elId, ms = 800) => { const ok = await js(`(()=>{const e=document.getElementById('${elId}'); if(!e) return false; e.click(); return true;})()`); if (!ok) console.error('no element', elId); await sleep(ms); };

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1500, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html` });
  for (let t = 0; t < 90; t++) { await sleep(1000); if (await js('!!(window.bootRestore && window.bootRestore.complete) || !!window.__preview')) break; }
  await sleep(3000);
  // the board: 7 x 10 (the Height field, as a user types it)
  await js(`(()=>{const e=document.getElementById('heightIn'); e.value='10'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(4000);
  await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click('editorTabBrick', 1000);
  await click('brickTool_wall', 1000);
  await click('brickPattern_coursed_ashlar', 4000);
  await js(`(()=>{const e=document.getElementById('brickSize'); e.value='${SIZE_IN}'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(5000);
  const state = await js(`(async()=>{ const { P } = await import('./core/state.js');
    const wall=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')];
    return JSON.stringify({ widthIn: P.widthIn, heightIn: P.heightIn, pattern: P.brickSettings.pattern, brickLengthIn: P.brickSettings.brickLengthIn,
      wall: wall.length, wallSets: [...new Set(wall.map(n=>n.getAttribute('data-brick-set')))], frame: window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]').length,
      active: document.getElementById('brickPattern_coursed_ashlar')?.classList.contains('active'), label: document.getElementById('brickPattern_coursed_ashlar')?.getAttribute('title') || document.getElementById('brickPattern_coursed_ashlar')?.textContent });})()`);
  console.log('STATE', state);
  const shot2d = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, 'app_rough_2d.png'), Buffer.from(shot2d.result.data, 'base64'));
  await click('editorApply', 3000);
  // wait for the 3D rebuild to finish
  for (let t = 0; t < 120; t++) { await sleep(1000); const busy = await js(`(async()=>{ const { rebuild } = await import('./core/engine.js'); return !!rebuild.isRebuilding; })()`); if (!busy && t > 4) break; }
  await sleep(2000);
  const snap = await js(`window.__preview.getSnapshot(1000, 1300)`);
  if (typeof snap === 'string') writeFileSync(path.join(OUT, 'app_rough_3d.png'), Buffer.from(snap.replace(/^data:image\/png;base64,/, ''), 'base64'));
  else console.error('no 3D snapshot');
  const full = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUT, 'app_rough_page_after_apply.png'), Buffer.from(full.result.data, 'base64'));
  console.log('ERRORS', JSON.stringify(errors.slice(0, 10)));
  ws.close();
} finally {
  stop();
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked: left in tmp */ }
}
process.exit(0);
