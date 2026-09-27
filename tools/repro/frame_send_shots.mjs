// FB-APP S5 (F10) item 1 shots: the sidebar FRAME section's [Send frame] button.
//   node tools/repro/frame_send_shots.mjs <outPrefix> <paletteUrl> [port]
// Pass 1 (web mode, no adsk): the button is disabled with its hint.
// Pass 2 (Fusion mode: a fake `adsk` injected before the page loads): pick a template,
// press the button, read back the exact payload it sent, then play the add-in's replies
// ('frame_result': built / no B-spline body) through the real fusionJavaScriptHandler.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9501);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session(profileTag, fakeAdsk) {
  const profile = `${dirname(PREFIX)}/chrome-framesend-${profileTag}-${PORT}`;
  mkdirSync(profile, { recursive: true });
  const port = PORT + (fakeAdsk ? 1 : 0);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  if (fakeAdsk) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return ''; } };` });
  }
  await send('Page.navigate', { url: URL }); await sleep(9000);
  const openFrame = `(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const h = document.getElementById('framePanelHeader'); if (h.classList.contains('collapsed')) h.click();
    document.querySelector('.panel-frame .panel-body')?.classList.remove('hidden'); await W(500); })()`;
  const state = `JSON.stringify({ disabled: document.getElementById('btnSendFrame').disabled, hint: document.getElementById('frameSendHint').textContent,
    status: document.getElementById('fusion-status')?.textContent || '' })`;
  return { ws, chrome, evalJS, shot, openFrame, state, errors };
}

const out = {};
{ // pass 1: web mode
  const s = await session('web', false);
  await s.evalJS(`(async()=>{ const sel = document.getElementById('frameTemplate'); sel.value = 'template_1'; sel.dispatchEvent(new Event('change')); })()`);
  await s.evalJS(s.openFrame);
  out.web = JSON.parse(await s.evalJS(s.state));
  await s.shot('web-disabled');
  out.webErrors = s.errors.slice(0, 3);
  s.ws.close(); s.chrome.kill();
}
{ // pass 2: Fusion mode (fake adsk)
  const s = await session('fusion', true);
  await s.evalJS(s.openFrame);
  out.fusionNoFrame = JSON.parse(await s.evalJS(s.state));
  await s.evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const sel = document.getElementById('frameTemplate'); sel.value = 'template_1'; sel.dispatchEvent(new Event('change')); await W(300);
    const f = document.getElementById('frameTrimOffset'); f.value = '0.5'; f.dispatchEvent(new Event('change', { bubbles: true })); await W(600); })()`);
  out.fusionReady = JSON.parse(await s.evalJS(s.state));
  await s.shot('fusion-ready');
  await s.evalJS(`(async()=>{ document.getElementById('btnSendFrame').click(); await new Promise(r=>setTimeout(r,300)); })()`);
  out.sent = JSON.parse(await s.evalJS(`JSON.stringify(window.__sent.filter(([a]) => a === 'send_frame').map(([a, d]) => [a, JSON.parse(d)]))`));
  out.afterPress = JSON.parse(await s.evalJS(s.state));
  await s.shot('fusion-sending');
  await s.evalJS(`(async()=>{ window.fusionJavaScriptHandler.handle('frame_result', JSON.stringify({ ok: true, frame: 'Frame_1', deleted: [], seeds: { count: 0, applied: false } })); await new Promise(r=>setTimeout(r,200)); })()`);
  out.replyOk = JSON.parse(await s.evalJS(s.state));
  await s.shot('fusion-built');
  await s.evalJS(`(async()=>{ window.fusionJavaScriptHandler.handle('frame_result', JSON.stringify({ ok: false, error: 'No B-spline body in this document: press Send B-spline first (the frame\\u2019s bars extrude up to its underside).' })); await new Promise(r=>setTimeout(r,200)); })()`);
  out.replyNoBody = JSON.parse(await s.evalJS(s.state));
  await s.shot('fusion-no-body');
  out.fusionErrors = s.errors.slice(0, 3);
  s.ws.close(); s.chrome.kill();
}
console.log(JSON.stringify(out));
