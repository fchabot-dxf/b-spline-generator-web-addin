// FB-APP F8 BLOCKER: measure the frame bar tops against the DRAWN panel faces.
//   node tools/repro/frame_bartop_measure.mjs <scratchDir> <paletteUrl> <template_1|template_2> <wood> [port] [setupJS]
// Reads back, from the scene the preview actually built: every bar-top vertex z,
// the drawn BOTTOM face z and TOP face z at the same x,y (the face triangles
// themselves, not the grid arrays), and how far the underside vertices sit off
// the regular x,y grid. Prints one JSON line.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [DIR, URL, TEMPLATE, WOOD = '3D Ash - Unfinished', PORTARG, SETUP = ''] = process.argv.slice(2);
const PORT = Number(PORTARG || 9371);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${DIR}/chrome-bartop-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
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

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(800);
  const w = document.getElementById('frameAppearance'); w.value = '${WOOD}'; w.dispatchEvent(new Event('change')); await W(800);
  ${SETUP}
  await W(2500); })()`);

const MEASURE = `(async()=>{ const { AppState } = await import('./main/app-state.js'); const p = AppState.preview;
  const g = p._lastGrid, count = g.nx * g.nz, pos = p._mesh.geometry.attributes.position.array;
  const full = p._mesh.geometry.userData.fullIndex || p._mesh.geometry.index.array;
  // face triangles, bucketed by x,y cell
  const cell = Math.max(g.W / (g.nx - 1), g.H / (g.nz - 1)) * 2;
  const buckets = (lo, hi, P = pos, I = full) => { const m = new Map(); m.P = P; m.I = I;
    for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2];
      if (!(a >= lo && a < hi && b >= lo && b < hi && c >= lo && c < hi)) continue;
      const xs = [a, b, c].map(v => P[v * 3]), ys = [a, b, c].map(v => P[v * 3 + 1]);
      for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++)
        for (let j = Math.floor(Math.min(...ys) / cell); j <= Math.floor(Math.max(...ys) / cell); j++) {
          const k = i + ',' + j; if (!m.has(k)) m.set(k, []); m.get(k).push(t); } }
    return m; };
  const zAt = (m, x, y) => { const out = [];
    for (const t of m.get(Math.floor(x / cell) + ',' + Math.floor(y / cell)) || []) {
      const [a, b, c] = [m.I[t], m.I[t + 1], m.I[t + 2]].map(v => [m.P[v * 3], m.P[v * 3 + 1], m.P[v * 3 + 2]]);
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]); if (Math.abs(d) < 1e-14) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d, v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d, w = 1 - u - v;
      if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) out.push(u * a[2] + v * b[2] + w * c[2]); }
    return out; };
  // the full drawn solid (top, underside, side walls): its lowest face at x,y is the underside
  const topB = buckets(0, count), botB = buckets(0, Infinity);
  // underside vertices vs the regular grid
  let maxOff = 0; for (let k = 0; k < count; k++) maxOff = Math.max(maxOff, Math.hypot(pos[(count + k) * 3] - pos[k * 3], pos[(count + k) * 3 + 1] - pos[k * 3 + 1]));
  let thick = []; for (let k = 0; k < count; k += 97) thick.push(pos[k * 3 + 2] - pos[(count + k) * 3 + 2]);
  const bars = p._frameMeshes.find(m => m.name === 'frame-bars'); const bp = bars.geometry.attributes.position.array;
  let zmin = Infinity; for (let i = 2; i < bp.length; i += 3) zmin = Math.min(zmin, bp[i]);
  const s = { n: 0, noBot: 0, botDiffMax: 0, botDiffs: [], aboveTop: 0, aboveTopMax: -Infinity, zs: new Set() };
  for (let i = 0; i < bp.length; i += 3) { const x = bp[i], y = bp[i + 1], z = bp[i + 2]; if (z <= zmin + 1e-6) continue;
    s.n++; s.zs.add(z.toFixed(3));
    const bz = zAt(botB, x, y), tz = zAt(topB, x, y);
    if (!bz.length) s.noBot++; else { const dd = Math.min(...bz.map(q => Math.abs(z - q))); s.botDiffMax = Math.max(s.botDiffMax, dd); s.botDiffs.push(dd); }
    if (tz.length) { const a = z - Math.min(...tz); s.aboveTopMax = Math.max(s.aboveTopMax, a); if (a > 1e-4) s.aboveTop++; } }
  s.botDiffs.sort((a, b) => a - b);
  // SYMPTOM, seen from above: points in the bar ring where the topmost drawn surface is a BAR
  const FM = await import('./core/preview/frame-mesh.js');
  const spec = p._frameProvider(g.W, g.H), loops = FM.frameLoopsWorld(spec, g);
  const kept = buckets(0, count, pos, p._mesh.geometry.index.array);
  const rims = p._frameMeshes.filter(m => m.name === 'frame-panel-rim').map(m => buckets(0, Infinity, m.geometry.attributes.position.array, m.geometry.index.array));
  const barB = buckets(0, Infinity, bp, bars.geometry.index.array);
  const wall = p._frameMeshes.find(m => m.name === 'frame-panel-wall') || p._frameMeshes.find(m => m !== bars && !m.name);
  const seg = (q, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)); return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy); };
  let ring = 0, visible = 0, gapMax = 0;
  for (let x = -g.W / 2 + 0.005; x < g.W / 2; x += 0.01) for (let y = -g.H / 2 + 0.005; y < g.H / 2; y += 0.01) {
    if (!FM.pointInPolygon(x, y, loops.outer) || FM.pointInPolygon(x, y, loops.inner)) continue;
    ring++;
    const bz = zAt(barB, x, y).filter(z => z > zmin + 1e-6); if (!bz.length) continue;
    const tz = [kept, ...rims].flatMap(b => zAt(b, x, y));
    if (!tz.length || Math.max(...tz) < Math.max(...bz)) { visible++;
      let d = Infinity; for (let k = 0; k < loops.outer.length; k++) d = Math.min(d, seg({ x, y }, loops.outer[k], loops.outer[(k + 1) % loops.outer.length]));
      gapMax = Math.max(gapMax, d); } }
  s.fromAbove = { ringSamples: ring, barVisible: visible, pct: +(100 * visible / ring).toFixed(2), deepestFromOutline: +gapMax.toFixed(4) };
  s.wall = wall ? { vertexColors: wall.material.vertexColors, color: '#' + wall.material.color.getHexString() } : null;
  return JSON.stringify({ grid: [g.nx, g.nz, g.W, g.H], botIsGrid: g.botPos === p._lastOffsetPts, undersideOffGridMax: +maxOff.toFixed(4),
    panelThick: [Math.min(...thick).toFixed(3), Math.max(...thick).toFixed(3)], barBottomZ: zmin,
    barTops: s.n, distinctTopZ: s.zs.size, noBottomBelow: s.noBot,
    topVsDrawnBottom: { max: +s.botDiffMax.toFixed(4), p50: +(s.botDiffs[s.botDiffs.length >> 1] || 0).toFixed(4), p95: +(s.botDiffs[Math.floor(s.botDiffs.length * 0.95)] || 0).toFixed(4) },
    topsAboveDrawnTop: s.aboveTop, aboveTopMax: +s.aboveTopMax.toFixed(4), fromAbove: s.fromAbove, wall: s.wall }); })()`;
const raw = await send("Runtime.evaluate", { expression: MEASURE, awaitPromise: true, returnByValue: true });
const val = raw.result?.result?.value;
const out = { template: TEMPLATE, wood: WOOD, setup: SETUP || "defaults", m: typeof val === "string" ? JSON.parse(val) : (raw.result?.exceptionDetails?.exception?.description || null), errors: errors.slice(0, 3) };
console.log(JSON.stringify(out));
ws.close(); chrome.kill();
