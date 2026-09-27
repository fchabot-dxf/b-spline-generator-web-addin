// Capture the REAL "Send to Fusion" payload the app builds, without Fusion: a stub `adsk.fusionSendData`
// is planted before the page loads, records every call, and the generate_start/chunk/finish stream is
// reassembled exactly like b-spline-gen.py does. The payload can then be replayed into the add-in's own
// _handle_generate inside Fusion (live checks without clicking in the palette).
//   node tools/repro/capture_send_payload.mjs <out.json> <paletteUrl> [scenario] [port]
//   scenario: shape-lattice (default) | box-lattice
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [OUT, URL, SCENARIO = 'shape-lattice', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9395);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(OUT)}/chrome-capture-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', msg.params.exceptionDetails?.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
// The stub: the app detects Fusion mode through window.adsk; every send is recorded, nothing answers.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__sends = [];
  window.adsk = { fusionSendData(action, data) { window.__sends.push([action, data]); return ''; } };` });
await send('Page.navigate', { url: URL }); await sleep(9000);

const steps = {
  'shape-lattice': `document.getElementById('toolShapeLattice').click(); await W(900);
     document.getElementById('shapeLatticeGenerate').click(); await W(3000);`,
  'box-lattice': `document.getElementById('toolLattice').click(); await W(900);
     document.getElementById('latticeGenerate').click(); await W(2500);`,
}[SCENARIO];
if (!steps) { console.log('unknown scenario', SCENARIO); chrome.kill(); process.exit(1); }
const built = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  ${steps}
  const n = document.querySelectorAll('[data-lattice]').length;
  [...document.querySelectorAll('button')].find(b => /apply stencils/i.test(b.textContent))?.click(); await W(4000);
  return n;
})()`);
console.log('lattice pieces drawn:', built);
await evalJS(`(async()=>{ document.getElementById('btnDownload').click(); await new Promise(r=>setTimeout(r,30000)); })()`);
const sends = await evalJS('window.__sends');
const actions = (sends || []).map((s) => s[0]);
console.log('sends:', [...new Set(actions)].join(', '), '| total', actions.length);
const chunks = (sends || []).filter((s) => s[0] === 'generate_chunk').map((s) => JSON.parse(s[1]))
  .sort((a, b) => a.index - b.index).map((c) => c.data);
const single = (sends || []).find((s) => s[0] === 'generate');
const payload = chunks.length ? chunks.join('') : single?.[1];
if (!payload) { console.log('NO PAYLOAD captured'); chrome.kill(); process.exit(2); }
writeFileSync(OUT, payload);
const p = JSON.parse(payload);
console.log('payload keys:', Object.keys(p).join(', '));
console.log('bytes:', payload.length);
ws.close(); chrome.kill();
