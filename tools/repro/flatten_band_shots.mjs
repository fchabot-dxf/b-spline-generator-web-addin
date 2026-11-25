// FLATTEN BAND (Fred 2026-11-25) phase-1 shots. Usage: node tools/repro/flatten_band_shots.mjs <outdir> <port> [panels]
// Needs tools/brick-matrix/serve.py serving bspline-frame-builder/ on <port>. A fresh board (storage cleared, Math.random seeded):
// Hourglass (template_1) and Rectangle; band off / Shape / Texture / Both, Both at three Flat heights; 3D iso + top + the 2D
// editor; the panel at 1400 and 390 px; the Flat Border row on a new board vs a saved board that uses it.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const OUT = path.resolve(process.argv[2]), HP = process.argv[3] || '8790', PANELS_ONLY = process.argv[4] === 'panels';
const CDP = 9377;
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
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EVAL-EXC', r.result.exceptionDetails.exception?.description?.split('\n')[0]); return r.result?.result?.value; };
const shot = async (n, clip) => { const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, 'base64')); console.log('shot', n); };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{let s=12345;Math.random=()=>{s=(s*16807)%2147483647;return (s-1)/2147483646;};})()` });
const ST = `await import('/b-spline-gen/html/core/state.js')`;
// a rebuild that has landed after the last change: the generation moves, then stays for 1.2 s
const settle = async () => {
  for (let i = 0; i < 60; i++) {
    const a = await ev(`(async()=>(${ST}).lastResultGeneration)()`); await sleep(1200);
    const b = await ev(`(async()=>(${ST}).lastResultGeneration)()`);
    if (a === b && i > 0) return; }
};
const setNum = (idv, v) => ev(`(()=>{const s=document.getElementById('${idv}'); s.value='${v}'; s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const setCheck = (idv, on) => ev(`(()=>{const c=document.getElementById('${idv}'); if (c.checked!==${on}) c.click();})()`);
async function load(w, h, mobile, { session } = {}) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 80 && !(await ev('!!window.__preview && !!window.__preview._mesh')); i++) await sleep(500);
  if (session !== undefined) { await ev(`(()=>{localStorage.clear(); ${session}})()`); await send('Page.reload'); await sleep(1500);
    for (let i = 0; i < 80 && !(await ev('!!window.__preview && !!window.__preview._mesh')); i++) await sleep(500); }
  await settle();
}
const view = async (name, t, p) => { await ev(`window.__preview._orbit.animateTo(${t},${p})`); await sleep(2200); await shot(name); };
const editorShot = async (name) => {
  await ev(`document.getElementById('viewMode_2d').click()`); await sleep(3500); await shot(name);
  await ev(`document.getElementById('viewMode_3d').click()`); await sleep(1500);
};
const applies = (v) => ev(`document.querySelector('#bandAppliesToGroup > button[data-value="${v}"]').click()`);
const openPanel = (cls) => ev(`(()=>{const h=document.querySelector('.cad-sidebar .panel.${cls} > .panel-header'); if (h.classList.contains('collapsed')) window.togglePanel(h); h.scrollIntoView({block:'start'});})()`);
const panelClip = (cls) => ev(`(()=>{const r=document.querySelector('.cad-sidebar .panel.${cls}').getBoundingClientRect(); return {x:Math.max(0,r.left),y:Math.max(0,r.top),width:r.width,height:Math.min(r.height, innerHeight-Math.max(0,r.top))};})()`);

// ── boards ──
if (!PANELS_ONLY) {
await load(1400, 900, false, { session: '' });
await ev(`localStorage.clear()`); // a fresh board (Hourglass)
await setNum('carveZ', '0.9');
for (const [frame, tag] of [['template_1', 'hourglass'], ['', 'rect']]) {
  await ev(`(()=>{const s=document.getElementById('frameTemplate'); s.value='${frame}'; s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await setCheck('bandEnabled', false); await settle();
  await view(`${tag}-off-iso`, Math.PI / 4, 0.955); await view(`${tag}-off-top`, 0, 0.0001); await editorShot(`${tag}-off-2d`);
  await setCheck('bandEnabled', true);
  for (const a of ['shape', 'texture', 'both']) {
    await applies(a); await settle();
    await view(`${tag}-${a}-iso`, Math.PI / 4, 0.955); await view(`${tag}-${a}-top`, 0, 0.0001); await editorShot(`${tag}-${a}-2d`);
  }
  for (const hgt of ['0.3', '0.6']) { // Both at two more heights (the default = the fill floor above)
    await setNum('bandHeightIn', hgt); await settle();
    await view(`${tag}-both-h${hgt}-iso`, Math.PI / 4, 0.955);
  }
  console.log(tag, 'P band', await ev(`(async()=>{const {P}=${ST}; return JSON.stringify({e:P.bandEnabled,a:P.bandAppliesTo,h:P.bandHeightIn,w:P.bandWidthIn,i:P.bandInnerFeatherIn,o:P.bandOuterFeatherIn,floor:P.terrainFit, carve:P.carveZ, frame:P.frame&&P.frame.templateId})})()`));
  await ev(`(async()=>{const {P}=${ST}; P.bandHeightIn=null;})()`); await setNum('bandHeightIn', '0'); // reset for the next board
}
// ── the panel, desktop ──
await openPanel('panel-band'); await sleep(600);
await shot('panel-band-desktop', await panelClip('panel-band'));
await setCheck('bandEnabled', false); await sleep(400);
await shot('panel-band-desktop-off', await panelClip('panel-band'));
}
// a project load (main/snapshot-manager.js applySnapshot 'load': the path a saved board takes) of the current board + `patch`
const loadBoard = async (patch) => { await ev(`(async()=>{const {P}=${ST}; const {applySnapshot}=await import('/b-spline-gen/html/main/snapshot-manager.js');
  await applySnapshot({ P: { ...JSON.parse(JSON.stringify(P)), ...${JSON.stringify(patch)} } }, window.__preview, { source: 'load', historyLabel: 'shots' });})()`); await settle(); };
// ── the panel, phone 390: a fresh Hourglass board, the band just switched on (its Flat height = the fill floor) ──
await load(390, 844, true);
await loadBoard({ frame: { templateId: 'template_1' }, carveZ: 0.9, bandEnabled: false, bandHeightIn: null, edgeMarginIn: 0 });
await setCheck('bandEnabled', true); await settle();
await openPanel('panel-band'); await sleep(800);
await ev(`(()=>{const h=document.querySelector('.panel.panel-band > .panel-header'); let sc=h.parentElement; while (sc && !(sc.scrollHeight>sc.clientHeight && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc=sc.parentElement; sc=sc||document.scrollingElement; sc.scrollTop -= 120; return sc.className||sc.tagName;})()`); await sleep(300);
await shot('panel-band-390');
console.log('390 flat height shown (fill floor)', await ev(`document.getElementById('bandHeightIn').value`), 'P', await ev(`(async()=>JSON.stringify((${ST}).P.bandHeightIn))()`));
console.log('390 switch row', await ev(`(()=>{const l=document.getElementById('bandEnabled').closest('label'); const r=l.getBoundingClientRect(); return JSON.stringify({top:r.top,h:r.height,shown:getComputedStyle(l).display, vis:getComputedStyle(l).visibility});})()`));
console.log('390 touch', await ev(`JSON.stringify([...document.querySelectorAll('#bandAppliesToGroup > button')].map(b=>{const r=b.getBoundingClientRect(); return [b.textContent, Math.round(r.width), Math.round(r.height)];}))`));
console.log('390 overflow', await ev(`document.documentElement.scrollWidth`));
await view('hourglass-both-floor-390', Math.PI / 4, 0.955);
// ── the Flat Border: a saved board that uses it keeps its row; a board without it has none ──
await load(1400, 900, false);
await loadBoard({ frame: { templateId: 'template_1' }, carveZ: 0.9, bandEnabled: false, edgeMarginIn: 0.8 });
await openPanel('panel-skeleton'); await sleep(600);
console.log('legacy flat border shown', await ev(`!document.querySelector('[data-legacy-row="flatBorder"]').hidden`));
await ev(`document.querySelector('[data-legacy-row="flatBorder"]').scrollIntoView({block:'center'})`); await sleep(300);
await shot('panel-shape-legacy-flatborder-desktop', await panelClip('panel-skeleton'));
await view('legacy-flatborder-iso', Math.PI / 4, 0.955);
await loadBoard({ edgeMarginIn: 0 });
console.log('no-border board flat border shown', await ev(`!document.querySelector('[data-legacy-row="flatBorder"]').hidden`));
await ev(`document.getElementById('symOffsetX').scrollIntoView({block:'center'})`); await sleep(300);
await shot('panel-shape-newboard-desktop', await panelClip('panel-skeleton'));
ws.close(); process.kill(chrome.pid);
