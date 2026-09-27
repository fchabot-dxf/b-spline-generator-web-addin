// BOUNDARY-GUIDE (L1) real-browser check + screenshots. Minimal CDP driver (no deps), same shape as
// select_drag_shape.mjs. For BOTH lattice tools:
//   - the Size box is in the editor DOM as #guide-layer > rect[data-role=guide], dashed, at the declared Size;
//   - it follows a Size edit;
//   - it is NOT in any serializer: save() (persist + 3D drape input), saveForRasterization() (stamp input),
//     saveWithTextCopies() (SVG download) are byte-identical with and without #guide-layer present;
//   - Apply Stencils -> the 3D preview (screenshot) shows no box.
// Usage: node tools/repro/boundary_guide_shots.mjs <outdir> [desktop|mobile] [url]
// Own CDP ports (9343/9344) so it never collides with another lane's select_drag_shape run (9333/9334).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop';
const URL = process.argv[4] || 'http://127.0.0.1:8781/b-spline-gen/html/bspline_gen_palette.html';
const PORT = MODE === 'mobile' ? 9344 : 9343;
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

let failures = 0;
function check(cond, label) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

const guideInfo = `(()=>{ const rs=[...document.querySelectorAll('#guide-layer rect[data-role="guide"]')];
  const inSketch=document.querySelectorAll('#sketch-layer [data-role="guide"]').length;
  const layer=document.getElementById('guide-layer'); const sk=document.getElementById('sketch-layer');
  return JSON.stringify({ n: rs.length, inSketch, sibling: !!(layer && sk && layer.parentNode===sk.parentNode),
    rects: rs.map(r=>({x:+r.getAttribute('x'),y:+r.getAttribute('y'),w:+r.getAttribute('width'),h:+r.getAttribute('height'),
      dash:r.getAttribute('stroke-dasharray'),fill:r.getAttribute('fill'),stroke:r.getAttribute('stroke')})) }); })()`;

// Every serializer, with and without the guide layer present -> must be identical (export unchanged).
const serializersSame = `(()=>{ const e=window.svgEditor; const run=()=>JSON.stringify([e.save(), e.saveForRasterization(), e.saveWithTextCopies()]);
  const withG=run(); const g=document.getElementById('guide-layer'); const parent=g.parentNode, next=g.nextSibling;
  g.remove(); const withoutG=run(); parent.insertBefore(g, next);
  return JSON.stringify({ same: withG===withoutG, mentions: /data-role="guide"|guide-layer/.test(withG) }); })()`;

async function run(tool) {
  const t = tool === 'box'
    ? { btn: 'toolLattice', gen: 'latticeGenerate', w: 'latticeSizeWidth', h: 'latticeSizeHeight' }
    : { btn: 'toolShapeLattice', gen: 'shapeLatticeGenerate', w: 'shapeLatticeSizeWidth', h: 'shapeLatticeSizeHeight' };
  // Independent runs: the app restores the last document on load, so wipe its stored state first.
  await send('Page.navigate', { url: URL }); await sleep(3000);
  await evalJS(`(async()=>{ try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try { for (const d of (await indexedDB.databases())) indexedDB.deleteDatabase(d.name); } catch {} })()`);
  await send('Page.navigate', { url: URL }); await sleep(9000);
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    document.getElementById('btnStampEdit').click(); await W(2500);
    document.getElementById('${t.btn}').click(); await W(800);
  })()`);
  const before = JSON.parse(await evalJS(guideInfo));
  check(before.n === 0, `${tool}: no guide before the first Generate (nothing generated yet)`);

  // Shape Lattice: picking a preset already generates the whole lattice (existing behaviour); Generate again is harmless.
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    ${tool === 'shape' ? "document.getElementById('shapePresetHourglass')?.click(); await W(800);" : ''}
    document.getElementById('${t.gen}').click(); await W(2500); })()`);
  const g = JSON.parse(await evalJS(guideInfo));
  const board = JSON.parse(await evalJS(`JSON.stringify([window.svgEditor._mW, window.svgEditor._mH])`));
  check(g.n === 1, `${tool}: exactly one guide rect after Generate (got ${g.n})`);
  check(g.inSketch === 0 && g.sibling, `${tool}: guide lives in #guide-layer, a sibling of #sketch-layer, never inside it`);
  const r = g.rects[0] || {};
  check(!!r.dash && r.fill === 'none' && r.stroke === '#000000', `${tool}: dashed black (${r.stroke} ${r.dash}), unfilled`);
  // auto Size = board minus 1in, centred
  check(Math.abs(r.w - (board[0] - 1)) < 1e-6 && Math.abs(r.h - (board[1] - 1)) < 1e-6 && Math.abs(r.x - 0.5) < 1e-6,
    `${tool}: auto Size = board ${board[0]}x${board[1]} minus 1in -> ${r.w}x${r.h} at (${r.x},${r.y})`);

  const ser = JSON.parse(await evalJS(serializersSame));
  check(ser.same && !ser.mentions, `${tool}: save / saveForRasterization (stamp+3D input) / saveWithTextCopies (download) identical with and without the guide`);
  await shot(`${tool}-${MODE}-1-editor-guide.png`);

  // Size edit -> the guide follows (the field's own change handler regenerates -> commit -> refresh)
  const newW = Math.max(2, board[0] - 3);
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); const f=document.getElementById('${t.w}');
    f.value='${newW}'; f.dispatchEvent(new Event('input',{bubbles:true})); f.dispatchEvent(new Event('change',{bubbles:true})); await W(2500); })()`);
  const g2 = JSON.parse(await evalJS(guideInfo));
  const r2 = g2.rects[0] || {};
  check(g2.n === 1 && Math.abs(r2.w - newW) < 1e-6 && Math.abs(r2.x - (board[0] - newW) / 2) < 1e-6,
    `${tool}: Size width ${newW} -> guide ${r2.w} wide, centred at x=${r2.x}`);
  await shot(`${tool}-${MODE}-2-editor-size-edit.png`);

  // 3D: Apply Stencils closes the editor and stamps -> screenshot of the 3D preview
  await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('editorApply').click(); await W(6000); })()`);
  await shot(`${tool}-${MODE}-3-3d-preview.png`);
}

try {
  await run('box');
  await run('shape');
} finally {
  if (logs.length) console.log('PAGE LOGS:\n  ' + logs.slice(0, 15).join('\n  '));
  console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
  ws.close(); chrome.kill();
  process.exit(failures ? 1 : 0);
}
