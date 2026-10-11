// Project load audit (seat D 2026-10-09, advisor: Fred's 20 rich "claude N" projects are the best real-world corpus).
// On the phone rig (390x844, coarse pointer, CPU x4 for the measured steps, the app's styles served) each project is
// LOADED the way the Project Manager's Load does (main/cloud-project-manager.js _loadFrom: the 'projectLoad' sequence,
// the 'cloudLoad' stage around the fetch, applySnapshot(unpackPoints(snap), preview, { source: 'load' }), markClean) --
// the fetch answered from the project file, so Fred's cloud store is never touched; the unsaved-changes confirm is the
// one step skipped. Then the first edits on it: open the editor, one Generate (Brick if it has bricks, else Lattice if it
// has a lattice, else Frame), Apply.
//   MODE=fresh  every project on a fresh page (storage cleared, Math.random seeded)
//   MODE=chain  every project loaded on top of the previous one, in one page
// Per load: its time and stages, the blind time before the first card, blind GAPS (long tasks while no stage was on
// screen), page errors, and whether the restored board matches the project (every saved P key against persistableP(),
// the editor's layers / bricks / lattice pieces against the saved SVG, the 3D grid against the board size).
// Usage: MODE=fresh node tools/repro/project_load_audit.mjs <outDir> <project.json ...> [-- cdpPort httpPort]
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../bspline-frame-builder');
const argv = process.argv.slice(2), dash = argv.indexOf('--');
const [OUT, ...FILES] = dash < 0 ? argv : argv.slice(0, dash);
const [PORT, HTTP] = (dash < 0 ? [9685, 9686] : argv.slice(dash + 1)).map(Number);
const MODE = process.env.MODE || 'fresh', CPU = 4, QUIET_MS = 800;
// PROFILE=open,apply,...: those steps run under the CDP sampling profiler, and each BLIND moment (before the first card,
// and every gap) names the app functions that ran in it -- what to declare a stage around
const PROFILE = new Set((process.env.PROFILE || '').split(',').filter(Boolean));
if (!OUT || !FILES.length) { console.log('usage: MODE=fresh|chain node tools/repro/project_load_audit.mjs <outDir> <project.json ...> [-- cdpPort httpPort]'); process.exit(1); }
mkdirSync(`${OUT}/prof`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SEEDED = `try { localStorage.clear(); sessionStorage.clear(); } catch (e) {}
  (() => { let a = 0x2f6b9d1; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const server = spawn('python', [path.resolve(HERE, '../brick-matrix/serve.py'), String(HTTP)], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${OUT}/prof`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch { /* gone */ } try { server.kill(); } catch { /* gone */ } };
let ws;
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const u = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; if (u) ws = new WebSocket(u); } catch { /* not up */ } }
if (!ws) { console.log('NO CDP'); stop(); process.exit(1); }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map(), errors = [], cssFails = [], dialogs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 200));
  // the app's unsaved-changes prompt (beforeunload) after an edited project: a fresh page's navigation must not sit on
  // it (MEASURED 2026-10-10: the 2nd project's load hung the whole run -- every evaluate waits behind an open dialog)
  if (m.method === 'Page.javascriptDialogOpening') { dialogs.push(m.params.type); send('Page.handleJavaScriptDialog', { accept: true }); }
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && /[.]css([?#]|$)/.test(m.params.response.url)) cssFails.push(m.params.response.url);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) errors.push('EVAL: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0]);
  return r.result?.result?.value;
};
const jsJSON = async (e) => { const v = await js(e); try { return JSON.parse(v); } catch { return null; } };

// page-side recorders: long tasks, the stage's on/off per animation frame, the stage texts
const RECORDERS = `(() => { if (window.__rec) return 1; window.__rec = 1;
  // the profiler's clock anchor: a named 20 ms busy wait that returns its own performance.now() (blame finds its samples)
  window.__profMark = function __profMark() { const t = performance.now(), e = t + 20; while (performance.now() < e); return t; };
  const el = () => document.getElementById('loading-stage');
  window.__vis = () => { const e = el(); return !!e && !e.hidden && e.getClientRects().length > 0; };
  window.__long = []; window.__flips = [[performance.now(), window.__vis()]]; window.__texts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] });
  { let was = window.__vis(); const tick = () => { const v = window.__vis(); if (v !== was) { window.__flips.push([performance.now(), v]); was = v; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  new MutationObserver(() => { const e = el(); if (window.__vis()) { const t = (e.querySelector('.loading-stage-text') || e).textContent.trim(); const last = window.__texts[window.__texts.length - 1]; if (!last || last[1] !== t) window.__texts.push([performance.now(), t]); } })
    .observe(el() || document.body, { attributes: true, childList: true, characterData: true, subtree: true });
  // settled: QUIET ms with no long task since the action ended and no stage on screen; then what happened since t0
  window.__settle = async (t0, quiet) => { const t1 = performance.now(), tEnd = t1 + 120000;
    for (;;) { await new Promise((r) => setTimeout(r, 100)); const last = window.__long.filter(([s]) => s >= t0 - 5).reduce((m, [s, d]) => Math.max(m, s + d), t1);
      if ((performance.now() - last >= quiet && !window.__vis()) || performance.now() > tEnd) break; }
    const tasks = window.__long.filter(([s]) => s >= t0 - 5);
    const visAt = (t) => { let v = false; for (const [ft, fv] of window.__flips) { if (ft > t) break; v = fv; } return v; };
    const firstOn = window.__flips.find(([t, v]) => v && t >= t0 - 5)?.[0];
    const shownAtT0 = visAt(t0);
    const before = shownAtT0 ? 0 : tasks.reduce((s, [st, d]) => s + Math.max(0, Math.min(st + d, firstOn ?? Infinity) - st), 0);
    const gaps = tasks.filter(([st]) => (firstOn != null || shownAtT0) && st >= (shownAtT0 ? t0 : firstOn) && !visAt(st));
    const end = tasks.reduce((m, [s, d]) => Math.max(m, s + d), t1);
    return JSON.stringify({ ms: Math.round(end - t0), cardMs: shownAtT0 ? 0 : firstOn == null ? null : Math.round(firstOn - t0), blindMs: Math.round(before),
      gapMs: Math.round(gaps.reduce((s, [, d]) => s + d, 0)), gaps: gaps.map(([s, d]) => [Math.round(s - t0), Math.round(d)]),
      longestMs: Math.round(tasks.reduce((m, [, d]) => Math.max(m, d), 0)), stages: window.__texts.filter(([t]) => t >= t0 - 5).map(([, x]) => x) }); };
  return 1; })()`;

async function touch(x, y) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tap(sel) {
  const c = await jsJSON(`JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left + r.width / 2, r.top + r.height / 2] : null; })())`);
  if (!c) return false; await touch(c[0], c[1]); return true;
}
// the whole machine's CPU busy % between two os.cpus() readings (other seats' load shows up here, not in the page)
const cpuTimes = () => os.cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
const busyPct = (a, b) => Math.round(100 * (b.busy - a.busy) / Math.max(1, b.all - a.all));
// one measured step: CPU throttled, then settled
async function measure(how, step) {
  await send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const prof = PROFILE.has(step);
  let markT = null;
  if (prof) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); await send('Profiler.start'); markT = await js('window.__profMark()'); }
  const t0 = await js('performance.now()'); const e0 = errors.length, c0 = cpuTimes();
  const did = await how();
  const m = did === false ? { skipped: true } : await jsJSON(`window.__settle(${t0}, ${QUIET_MS})`);
  if (prof) { const p = (await send('Profiler.stop')).result?.profile; if (p && m && !m.skipped) m.blame = blame(p, t0, m, markT); }
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { ...m, cpuBusy: busyPct(c0, cpuTimes()), errors: errors.slice(e0) };
}
// the profile's samples inside each blind window -> the app call chains that ran there (leaf-most 4 app frames), in ms.
// The profile's clock is mapped to performance.now() by the anchor: the first sample inside __profMark is its returned time.
// (MEASURED 2026-10-11: assuming the profile starts at t0 put every blind window outside the samples -- empty blames.)
function blame(p, t0, m, markT) {
  const byId = new Map(p.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const app = (n) => n.callFrame.url.includes('/html/') ? `${n.callFrame.functionName || '(anon)'}@${n.callFrame.url.split('/html/').pop()}:${n.callFrame.lineNumber + 1}` : null;
  const chain = (id) => { const out = []; for (let k = id; k != null && out.length < (globalThis.BLAME_DEPTH || 4); k = parent.get(k)) { const a = app(byId.get(k)); if (a) out.push(a); } return out.join(' <- ') || '(no app frame: ' + (byId.get(id)?.callFrame.functionName || 'native') + ')'; };
  const windows = [];
  if (m.blindMs > 0) windows.push(['before card', t0, t0 + (m.cardMs ?? m.ms)]);
  for (const [s, d] of m.gaps || []) windows.push([`gap @${s}`, t0 + s, t0 + s + d]);
  if (!windows.length) return [];
  const res = windows.map(([w]) => ({ w, ms: {} }));
  let off = t0, acc = 0;
  for (let i = 0; i < p.samples.length; i++) { acc += p.timeDeltas[i] / 1000; if (markT != null && byId.get(p.samples[i])?.callFrame.functionName === '__profMark') { off = markT - acc; break; } }
  let t = 0;
  for (let i = 0; i < p.samples.length; i++) {
    t += p.timeDeltas[i] / 1000; const at = off + t;
    const k = windows.findIndex(([, a, b]) => at >= a && at < b); if (k < 0) continue;
    const c = chain(p.samples[i]); res[k].ms[c] = (res[k].ms[c] || 0) + (p.timeDeltas[i + 1] || p.timeDeltas[i]) / 1000;
  }
  return res.map(({ w, ms }) => ({ w, top: Object.entries(ms).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => [Math.round(v), c]) }));
}
async function bootPage() {
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: SEEDED });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html` });
  for (let i = 0; i < 120 && !(await js('!!document.getElementById("btnStampEdit") && !!window.svgEditor')); i++) await sleep(500);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier });
  await sleep(4000);
  const styled = await js(`getComputedStyle(document.getElementById('previewCanvas')).position`);
  if (styled !== 'absolute' || cssFails.length) throw new Error(`styles not served (${styled}, ${cssFails.join(' ')})`);
  await js(RECORDERS);
}

// the load, as _loadFrom does it (window.__snap holds the file's JSON)
const LOAD = `(async () => {
  const L = await import('./core/loading-signal.js'); const S = await import('./main/snapshot-manager.js');
  const { COORD_SYSTEM } = await import('./core/coords.js'); const { AppState } = await import('./main/app-state.js'); const D = await import('./core/dirty.js');
  L.beginLoadingSequence('projectLoad');
  const snap = await L.withLoadingStage('cloudLoad', async () => JSON.parse(window.__snapText));
  if (snap?.P && Array.isArray(snap.P.points)) snap.P.points = snap.P.points.map((pt) => { const u = COORD_SYSTEM.toUI(pt[0], pt[1]); return [u.x, u.y]; });
  await S.applySnapshot(snap, AppState.preview, { source: 'load' });
  D.markClean(); return 1; })()`;
// the restored board against the file
const CHECK = `(async () => {
  const St = await import('./core/state.js'); const { resolveGrid } = await import('./core/terrain.js');
  const snapP = JSON.parse(window.__snapText).P; const now = St.persistableP();
  const SKIP = new Set(['activeSculptLayer', 'points', 'editorSvg']);
  // an object-valued key names its own differing sub-keys (brickSettings{groutColor,...}): what to look for, not just where
  const sub = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((q) => JSON.stringify((a || {})[q]) !== JSON.stringify((b || {})[q]));
  // the app's DECLARED migrations rewrite a key on load on purpose (geometry kept): reported as migrated, not as a
  // mismatch -- each with the condition under which the migration applies to the saved value
  const MIGRATED = [
    { key: 'brickSettings', sub: 'windowSurround', id: 'window-surround-legacy-none', applies: (saved) => saved === undefined },
    { key: 'noiseType', id: 'photo-filter-to-layer', applies: (saved) => saved === 'photo' },
  ];
  const migrated = [];
  const isMigrated = (k, q) => { const m = MIGRATED.find((x) => x.key === k && x.sub === q); if (m && m.applies(q ? (snapP[k] || {})[q] : snapP[k])) { migrated.push(m.id); return true; } return false; };
  const keys = Object.keys(snapP).filter((k) => !SKIP.has(k) && JSON.stringify(now[k]) !== JSON.stringify(snapP[k]))
    .map((k) => {
      if (!(snapP[k] && typeof snapP[k] === 'object' && !Array.isArray(snapP[k]))) return isMigrated(k, undefined) ? null : k;
      const left = sub(snapP[k], now[k]).filter((q) => !isMigrated(k, q));
      return left.length ? k + '{' + left.slice(0, 6).join(',') + '}' : null;
    }).filter(Boolean);
  const count = (svg, re) => (svg.match(re) || []).length;
  // the drawing: the editor re-serialises it on open, so the TEXT differs; compare its structure -- every data-*
  // attribute's count and every element tag's count -- and name what moved
  const hist = (svg) => { const h = {}; for (const m of svg.matchAll(/ (data-[a-z-]+)=/g)) h[m[1]] = (h[m[1]] || 0) + 1; for (const m of svg.matchAll(/<([a-z]+)[\\s>/]/g)) h['<' + m[1]] = (h['<' + m[1]] || 0) + 1; return h; };
  const hs = hist(snapP.editorSvg || ''), hn = hist(now.editorSvg || '');
  const svgDiff = [...new Set([...Object.keys(hs), ...Object.keys(hn)])].filter((k) => (hs[k] || 0) !== (hn[k] || 0)).map((k) => k + ' ' + (hs[k] || 0) + '->' + (hn[k] || 0));
  if (svgDiff.length) keys.push('editorSvg[' + svgDiff.slice(0, 8).join(', ') + ']');
  const saved = snapP.editorSvg || '';
  const ed = window.svgEditor, node = ed?._sketchLayer?.node;
  const live = (sel) => (node ? node.querySelectorAll(sel).length : -1);
  let savedLayers = 0; try { savedLayers = JSON.parse((saved.match(/data-editor-layers="([^"]*)"/)?.[1] || '[]').replace(/&quot;/g, '"').replace(/&amp;/g, '&')).length; } catch { savedLayers = -1; }
  const g = resolveGrid(St.P.widthIn, St.P.heightIn, St.P.spacing), r = St.lastResult;
  return JSON.stringify({ pKeysDiffer: keys, migrated: [...new Set(migrated)],
    layers: [savedLayers, Array.isArray(ed?._layers) ? ed._layers.length : -1],
    bricks: [count(saved, / data-brick-piece=/g), live('[data-brick-piece]')],
    lattice: [count(saved, / data-lattice=/g), live('[data-lattice]')],
    grid3d: r ? (r.nx === g.nx && r.nz === g.nz ? 'ok' : r.nx + 'x' + r.nz + ' vs ' + g.nx + 'x' + g.nz) : 'none',
    template: St.P.frame?.templateId || null, size: St.P.widthIn + 'x' + St.P.heightIn, filter: St.P.noiseType, z: St.P.carveZ }); })()`;

const rows = [];
// a step that never returns (a hung page) shows WHERE: each step announces itself first (stderr, unbuffered)
const progress = (name, step) => process.stderr.write(`  ... ${name}: ${step} ${new Date().toISOString().slice(11, 19)}
`);
try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] }); // never the cloud
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  if (MODE === 'chain') await bootPage();
  for (const file of FILES) {
    const name = path.basename(file).replace(/\.project\.json$/, '');
    const text = readFileSync(file, 'utf8');
    try {
      if (MODE === 'fresh') await bootPage();
      await js(`window.__snapText = ${JSON.stringify(text)}; 1`);
      progress(name, 'load');
      const load = await measure(() => js(LOAD), 'load');
      progress(name, 'check');
      const check = await jsJSON(CHECK);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      if (shot.result?.data) writeFileSync(`${OUT}/${MODE}_${name}.png`, Buffer.from(shot.result.data, 'base64'));
      // the first edits: open the editor, one Generate, Apply
      const kind = check.bricks[0] > 0 ? 'brick' : check.lattice[0] > 0 ? 'lattice' : 'frame';
      progress(name, 'open');
      const open = await measure(() => tap('#viewMode_2d'), 'open'); // the phone's way in: the 2D / 3D toggle on the preview
      await sleep(500);
      // the Brick tab opens on General (no Generate there since 2026-10-10): the Wall tool first
      const pre = { brick: ['#editorTabBrick', '#brickTool_wall'], lattice: ['#editorTabArtwork', '#artTab_lattice'], frame: ['#editorTabFrame'] }[kind];
      for (const s of pre) { await tap(s); await sleep(900); }
      progress(name, 'generate ' + kind);
      const gen = await measure(() => tap({ brick: '#brickGenerate', lattice: '#latticeGenerate', frame: '#editorFrameGenerate' }[kind]), 'gen');
      progress(name, 'apply');
      const apply = await measure(() => tap('#viewMode_3d_editor'), 'apply'); // back to 3D: the Apply way when anything changed
      const row = { name, mode: MODE, bytes: text.length, load, check, kind, open, gen, apply };
      rows.push(row); writeFileSync(`${OUT}/${MODE}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const fm = (m) => (m.skipped ? 'skip' : `${m.ms}ms card ${m.cardMs ?? 'never'} blind ${m.blindMs} gap ${m.gapMs} cpu ${m.cpuBusy}%${m.errors.length ? ` ERR ${m.errors.length}` : ''}`);
      const mism = [check.pKeysDiffer.length ? `P:${check.pKeysDiffer.join(',')}` : '', check.layers[0] !== check.layers[1] ? `layers ${check.layers}` : '',
        check.bricks[0] !== check.bricks[1] ? `bricks ${check.bricks}` : '', check.lattice[0] !== check.lattice[1] ? `lattice ${check.lattice}` : '', check.grid3d !== 'ok' ? `3d ${check.grid3d}` : ''].filter(Boolean).join(' ') + (check.migrated && check.migrated.length ? ` (migrated: ${check.migrated.join(', ')})` : '');
      for (const [st, mm] of Object.entries({ load, open, gen, apply })) for (const b of mm.blame || []) console.log(`   blame ${st} ${b.w}: ${b.top.map(([ms, c]) => ms + 'ms ' + c).join(' | ')}`);
      console.log(`${name.padEnd(10)} LOAD ${fm(load)} | ${mism || 'restored OK'} | open ${fm(open)} | ${kind} gen ${fm(gen)} | apply ${fm(apply)}`);
    } catch (e) { console.log(`${name.padEnd(10)} ERROR ${e.message}`); rows.push({ name, mode: MODE, error: e.message }); }
  }
} finally { stop(); }
console.log('dialogs accepted', dialogs.length, JSON.stringify([...new Set(dialogs)]));
console.log('page errors', errors.length, JSON.stringify([...new Set(errors)].slice(0, 12)));
process.exit(0);
