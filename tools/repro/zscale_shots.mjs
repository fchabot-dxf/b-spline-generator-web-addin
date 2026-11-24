// Z scale (exact side views) shots. Usage: node tools/repro/zscale_shots.mjs <outdir> <port> [framed]
// Needs tools/brick-matrix/serve.py (or serve_app.py) serving bspline-frame-builder/ on <port>.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const OUT = path.resolve(process.argv[2]), HP = process.argv[3] || '8790', FRAMED = process.argv[4] === 'framed';
const CDP = 9360 + (FRAMED ? 1 : 0);
const URL = `http://127.0.0.1:${HP}/b-spline-gen/html/bspline_gen_palette.html`;
mkdirSync(`${OUT}/chrome-${CDP}`, { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${OUT}/chrome-${CDP}`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore', windowsHide: true });
console.log('chrome pid', chrome.pid);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 40 && !wsUrl; i++) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch {} if (!wsUrl) await sleep(250); }
const ws = new WebSocket(wsUrl); await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') console.log('EXC', m.params.exceptionDetails.exception?.description?.split('\n')[0]); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{let s=12345;Math.random=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};})()` });
async function load(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80 && !(await ev('!!window.__preview && !!window.__preview._mesh')); i++) await sleep(500);
  await ev(`localStorage.clear()`);
  await ev(`(()=>{const s=document.getElementById('carveZ'); s.value='0.9'; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await ev(`(()=>{const s=document.getElementById('frameTemplate'); s.value='${FRAMED ? 'template_1' : ''}'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await sleep(3000);
}
const view = async (name, t, p) => { await ev(`window.__preview._orbit.animateTo(${t},${p})`); await sleep(2500);
  console.log(name, await ev(`(()=>{const g=window.__preview._groundGrid._zScale; const d=window.__preview._camera.getWorldDirection(new window.THREE.Vector3()); return JSON.stringify({vis:g.group.visible,dir:[d.x,d.y,d.z].map(v=>+v.toFixed(3)),pos:[g.group.position.x,g.group.position.y]});})()`));
  await shot(name); };
const tag = FRAMED ? 'framed-' : 'rect-';
await load(1400, 900, false);
console.log('options', await ev(`JSON.stringify([...document.getElementById('frameTemplate').options].map(o=>o.value+'='+o.textContent.trim()))`));
console.log('carve', await ev(`document.getElementById('carveZ').value`), 'frame', await ev(`document.getElementById('frameTemplate').value`));
await view(tag + 'front', 0, Math.PI / 2); await view(tag + 'right', Math.PI / 2, Math.PI / 2);
await view(tag + 'back', Math.PI, Math.PI / 2); await view(tag + 'left', -Math.PI / 2, Math.PI / 2);
await view(tag + 'iso', Math.PI / 4, 0.955); await view(tag + 'front-orbited', 0.05, Math.PI / 2 - 0.05);
await view(tag + 'front-desktop', 0, Math.PI / 2);
await load(390, 844, true);
await view(tag + 'front-390', 0, Math.PI / 2);
ws.close(); process.kill(chrome.pid);
