// H9 amendment shots: the splash screen (desktop + 390px) and the header
// with the title removed (relocated to Settings > Version).
//   node tools/repro/h9_splash_shots.mjs <outPrefix> <paletteUrl> [port]
// Serve with tools/serve_app.py so the CSS/assets load.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9582);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-h9splash-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) {}
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r, rej) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); } }, 15000);
});
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');

// 1) Splash screen at desktop (1400x900).
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(150); // catch the splash before initApp's async work finishes
const splashDesktop = JSON.parse(await evalJS(`(()=>{
  const s = document.getElementById('app-splash');
  if (!s) return JSON.stringify({present:false});
  const logo = document.getElementById('app-splash-logo');
  const name = document.getElementById('app-splash-name');
  const version = document.getElementById('app-splash-version');
  return JSON.stringify({ present: true, hidden: s.classList.contains('app-splash-hidden'),
    logoNaturalWidth: logo.naturalWidth, nameText: name.textContent, versionText: version.textContent });
})()`));
console.log('splash (desktop, early):', JSON.stringify(splashDesktop));
check(splashDesktop.present && !splashDesktop.hidden, 'H9: splash is present and not yet hidden right after navigate');
check(splashDesktop.logoNaturalWidth > 0, `H9: the neon logo PNG actually loaded (naturalWidth=${splashDesktop.logoNaturalWidth})`);
await shot('splash-desktop');

// 2) Splash screen at 390px.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(150);
const splashMobile = JSON.parse(await evalJS(`(()=>{
  const s = document.getElementById('app-splash');
  return JSON.stringify({ present: !!s, hidden: s ? s.classList.contains('app-splash-hidden') : null });
})()`));
console.log('splash (390px, early):', JSON.stringify(splashMobile));
check(splashMobile.present && !splashMobile.hidden, 'H9: splash is present and not yet hidden right after navigate (390px)');
await shot('splash-390');

// 3) Let the app finish loading -- splash must hide itself (init-complete
// hook, no fixed timer) and be REMOVED from the DOM, never just hidden.
await sleep(6000);
const afterLoad = JSON.parse(await evalJS(`JSON.stringify({ splashGone: !document.getElementById('app-splash'),
  titleGone: !document.querySelector('.cad-nav-title'),
  dirtyDotPresent: !!document.getElementById('dirty-dot') })`));
console.log('after load (390px):', JSON.stringify(afterLoad));
check(afterLoad.splashGone, 'H9: splash removes itself from the DOM once the app is ready');
check(afterLoad.titleGone, 'H9: the header no longer has a .cad-nav-title element');
check(afterLoad.dirtyDotPresent, 'H9: dirty-dot (a functional indicator, not "the title") stays in the header');
await shot('header-no-title-390');

// 4) Header without title at desktop too.
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(200);
await shot('header-no-title-desktop');

// 5) Settings panel shows the relocated version badge.
await evalJS(`document.getElementById('settings-btn')?.click()`);
await sleep(300);
const settingsInfo = JSON.parse(await evalJS(`(()=>{
  const badge = document.getElementById('build-badge');
  if (!badge) return JSON.stringify({present:false});
  const panel = document.getElementById('settings-panel');
  const inPanel = panel ? panel.contains(badge) : false;
  const r = badge.getBoundingClientRect();
  return JSON.stringify({ present: true, inSettingsPanel: inPanel, visible: r.width > 0, text: badge.textContent });
})()`));
console.log('settings version badge:', JSON.stringify(settingsInfo));
check(settingsInfo.present && settingsInfo.inSettingsPanel && settingsInfo.visible, `H9: #build-badge now lives in the Settings panel and is visible (${JSON.stringify(settingsInfo)})`);
await shot('settings-version');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);
