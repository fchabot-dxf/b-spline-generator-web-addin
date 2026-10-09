// The headless "Send to Fusion" capture machinery, shared by tools/repro/capture_send_payload.mjs and
// tools/repro/creations/capture_creations.mjs: launch a headless Chrome on a CDP port, talk to its page, plant the
// Fusion stub (window.adsk.fusionSendData records every send) + an optional seeded Math.random before any page
// script, and reassemble the generate_start/chunk/finish stream into the payload JSON exactly like b-spline-gen.py.
import { spawn } from 'node:child_process';

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start headless Chrome (caller owns the returned process: kill only this one). */
export function launchChrome(port, profileDir, extraArgs = []) {
  return spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', ...extraArgs, 'about:blank'], { stdio: 'ignore' });
}

/** Connect to the first page target on `port`; null when CDP never comes up. */
export async function connectPage(port, { onPageError = (m) => console.log('PAGE ERROR:', m) } = {}) {
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i++) {
    await sleep(200);
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
  }
  if (!wsUrl) return null;
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') onPageError(msg.params.exceptionDetails?.exception?.description?.split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expr) => {
    const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
    if (r?.exceptionDetails) console.log('PAGE EVAL ERROR:', String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
    return r?.result?.value;
  };
  return { ws, send, evalJS, close: () => ws.close() };
}

/** The script planted before the page loads: optional seeded Math.random (LCG), optional storage wipe, the Fusion stub. */
export function fusionStubSource(seed, { clearStorage = false } = {}) {
  return `${clearStorage ? 'try { localStorage.clear(); } catch (e) {}' : ''}
  ${seed !== '' && seed != null ? `{ let s = ${Number(seed)} >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }` : ''}
  window.__sends = [];
  window.adsk = { fusionSendData(action, data) { window.__sends.push([action, data, performance.now()]); return ''; } };`;
}

/** The payload string from the recorded sends (chunked stream, or a single 'generate'), or null. */
export function payloadFromSends(sends) {
  const chunks = (sends || []).filter((s) => s[0] === 'generate_chunk').map((s) => JSON.parse(s[1]))
    .sort((a, b) => a.index - b.index).map((c) => c.data);
  const single = (sends || []).find((s) => s[0] === 'generate');
  return chunks.length ? chunks.join('') : (single?.[1] || null);
}
