// Minimal CDP driver (no deps): live-site smoke test of the SVG editor lattice/pattern flow.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop';          // desktop | mobile
const URL = process.argv[4] || 'https://bspline-generator.pages.dev/';
const PORT = MODE === 'mobile' ? 9334 : 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}



const report = {};
await send('Page.navigate', { url: URL }); await sleep(9000);
const ids = await evalJS(`(async () => { const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800); document.getElementById('shapePresetHourglass')?.click(); await W(300);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500);
  const btns=[...document.querySelectorAll('button,[role=button]')].filter(b=>b.offsetParent && /select/i.test((b.title||'')+(b.getAttribute('aria-label')||'')+b.id));
  const sel=btns.find(b=>/tap a piece/i.test(b.title||'')); if(sel) sel.click(); await W(400); let i=0; for (const el of document.querySelectorAll('[data-lattice="rail"],[data-lattice="tie"]')) { if(!el.id) el.id='lt_'+el.getAttribute('data-lattice')+'_'+(i++); }
  return JSON.stringify(btns.map(b=>b.id||b.title).slice(0,8)); })()`);
console.log('select buttons', ids);
const snap = `(()=>{ const out={}; for (const el of document.querySelectorAll('[data-lattice="rail"],[data-lattice="tie"]')) { if(!el.getAttribute('x1')) continue; out[el.id]={k:el.getAttribute('data-lattice'),x1:+el.getAttribute('x1'),y1:+el.getAttribute('y1'),x2:+el.getAttribute('x2'),y2:+el.getAttribute('y2')}; } return JSON.stringify(out); })()`;
const toScreen = (id, t) => `(()=>{ const el=document.getElementById('${id}'); const svg=el.ownerSVGElement; const p=svg.createSVGPoint(); const x1=+el.getAttribute('x1'),y1=+el.getAttribute('y1'),x2=+el.getAttribute('x2'),y2=+el.getAttribute('y2'); p.x=x1+(x2-x1)*${t}; p.y=y1+(y2-y1)*${t}; const q=p.matrixTransform(el.getScreenCTM()); return JSON.stringify([q.x,q.y]); })()`;
async function drag(x,y,dx,dy){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y}); await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  for(let i=1;i<=8;i++){ await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x+dx*i/8,y:y+dy*i/8,button:'left',buttons:1}); await sleep(30);} await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x+dx,y:y+dy,button:'left',clickCount:1}); await sleep(500); }
function connected(tie, rail){ // tie endpoint lies on rail line (horizontal rails)
  const onR=(x,y)=>Math.abs(y-rail.y1)<0.02 && x>=Math.min(rail.x1,rail.x2)-0.02 && x<=Math.max(rail.x1,rail.x2)+0.02; return onR(tie.x1,tie.y1)||onR(tie.x2,tie.y2); }
const before = JSON.parse(await evalJS(snap));
const rails = Object.entries(before).filter(([k,v])=>v.k==='rail'); const ties=Object.entries(before).filter(([k,v])=>v.k==='tie');
// pick a rail with attached ties
let pick=null; for (const [rid,r] of rails){ const att=ties.filter(([tid,t])=>connected(t,r)).map(([tid])=>tid); if(att.length){ pick={rid,att}; break; } }
console.log('rails',rails.length,'ties',ties.length,'pick',JSON.stringify(pick));
await shot('sel_before.png');
// 1) drag rail body (30% along) downward 40px
let [sx,sy]=JSON.parse(await evalJS(toScreen(pick.rid,0.3))); await drag(sx,sy,0,40);
let a1=JSON.parse(await evalJS(snap));
const r0=before[pick.rid], r1=a1[pick.rid];
console.log('RAIL moved dy(model)=',(r1.y1-r0.y1).toFixed(3),'still horizontal', Math.abs(r1.y1-r1.y2)<1e-6);
for (const tid of pick.att) console.log('  tie',tid,'still on rail:',connected(a1[tid],r1), 'tie before',JSON.stringify(before[tid]),'after',JSON.stringify(a1[tid]));
await shot('sel_after_rail.png');
// 2) drag a tie body sideways 40px
const tid=pick.att[0]; [sx,sy]=JSON.parse(await evalJS(toScreen(tid,0.5))); await drag(sx,sy,40,0);
let a2=JSON.parse(await evalJS(snap)); console.log('TIE moved dx=',(a2[tid].x1-a1[tid].x1).toFixed(3),'still on rail',connected(a2[tid],a2[pick.rid]),'vertical',Math.abs(a2[tid].x1-a2[tid].x2)<1e-6);
// 3) drag tie END (t=0 end) 30px along its axis
[sx,sy]=JSON.parse(await evalJS(toScreen(tid,0.0))); await drag(sx,sy,0,-30);
let a3=JSON.parse(await evalJS(snap)); console.log('TIE END: before',JSON.stringify(a2[tid]),'after',JSON.stringify(a3[tid]));
await shot('sel_after_tie.png');
console.log(logs.slice(0,6)); chrome.kill(); process.exit(0);
