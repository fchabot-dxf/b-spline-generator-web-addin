// F25 acceptance shots: Tool Profile + V-Bit Angle share ONE line (same
// .cad-paired-steppers shape as Stock Dimensions' Width/Height, H10/H11-item-0),
// checked at every width Fred asked for (390/768/834/1024/1366, pointer:coarse)
// AND for every option in the Tool Profile select (the amendment: "Check every
// profile option in the select at the 5 widths"). Today only V-Bit declares a
// V-Bit Angle uiParam -- adaptive/ballnose/flat show none, so Tool Profile alone
// fills the row for them ("the select takes the full row").
//   node tools/repro/f25_tool_profile_shots.mjs <outPrefix> <paletteUrl> [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9602);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-f25-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
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

const WIDTHS = [
  { w: 390, h: 844, name: '390' },
  { w: 768, h: 1024, name: '768' },
  { w: 834, h: 1194, name: '834' },
  { w: 1024, h: 768, name: '1024' },
  { w: 1366, h: 1024, name: '1366' },
];

for (const { w, h, name } of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL });
  await sleep(name === WIDTHS[0].name ? 6000 : 3000);
  await evalJS(`[...document.querySelectorAll('.panel-header.collapsed')].forEach(h=>h.click())`);
  await sleep(200);

  const profiles = await evalJS(`JSON.stringify([...document.getElementById('stampProfile').options].map(o=>o.value))`);
  for (const profileId of JSON.parse(profiles)) {
    await evalJS(`(()=>{ const sel = document.getElementById('stampProfile'); sel.value = ${JSON.stringify(profileId)};
      sel.dispatchEvent(new Event('change')); })()`);
    await sleep(150);
    const info = JSON.parse(await evalJS(`(()=>{
      const sidebar = document.querySelector('.cad-sidebar');
      const sidebarRight = sidebar.getBoundingClientRect().right;
      const profCol = document.getElementById('stampProfile').closest('.cad-paired-steppers > div');
      const angleContainer = document.getElementById('vBitAngleContainer');
      const angleVisible = angleContainer.getBoundingClientRect().width > 0;
      const pr = profCol.getBoundingClientRect();
      const selR = document.getElementById('stampProfile').getBoundingClientRect();
      const out = { angleVisible, profileClipped: selR.right > sidebarRight + 0.5, profileWidth: Math.round(pr.width) };
      if (angleVisible) {
        const ar = angleContainer.getBoundingClientRect();
        const angleInputR = document.getElementById('stampVBitAngle').getBoundingClientRect();
        out.oneRow = Math.abs(pr.top - ar.top) < 5;
        out.angleClipped = angleInputR.right > sidebarRight + 0.5;
        out.angleWidth = Math.round(ar.width);
      }
      return JSON.stringify(out);
    })()`));
    console.log(`profile=${profileId}@${name}:`, JSON.stringify(info));
    check(!info.profileClipped, `F25@${name} profile=${profileId}: Tool Profile select not clipped`);
    if (info.angleVisible) {
      check(info.oneRow, `F25@${name} profile=${profileId}: Tool Profile + V-Bit Angle share one row`);
      check(!info.angleClipped, `F25@${name} profile=${profileId}: V-Bit Angle input not clipped`);
    } else {
      // no second field for this profile: Tool Profile's own column should fill the row (F25's own "full row" rule)
      const rowWidth = JSON.parse(await evalJS(`JSON.stringify(document.querySelector('.cad-paired-steppers').getBoundingClientRect().width)`));
      check(info.profileWidth > rowWidth * 0.9, `F25@${name} profile=${profileId}: no angle field -> Tool Profile fills the row (${info.profileWidth}/${Math.round(rowWidth)})`);
    }
  }
  // leave V-Bit selected (the default) for the shot
  await evalJS(`(()=>{ const sel = document.getElementById('stampProfile'); sel.value = 'vbit'; sel.dispatchEvent(new Event('change')); })()`);
  await sleep(150);
  await evalJS(`document.getElementById('stampProfile').scrollIntoView({block:'center'})`);
  await sleep(150);
  await shot(name);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);
