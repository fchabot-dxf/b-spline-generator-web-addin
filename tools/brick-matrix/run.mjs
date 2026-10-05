// Brick-tab end-to-end matrix: drives every declared control (controls.mjs) in the real app in headless
// Chrome and checks {pending dot, 2D canvas, 3D heightmap} against what it declares. Exit code 1 on any FAIL.
//
//   node tools/brick-matrix/run.mjs [--out <dir>] [--port 9701] [--root <bspline-frame-builder dir>]
//
// Writes <out>/brick-matrix.json, <out>/brick-matrix.md and a screenshot per FAIL row. Serves --root
// (default: this checkout's bspline-frame-builder/) with python's http.server, as tools/repro/* do.
// Chrome: CHROME env var, else the standard Windows install path.
//
// Merge gate:  node tools/brick-matrix/run.mjs --parallel --only-if-changed origin/main --out <dir>
//   --only-if-changed <ref>  run only if `git diff --name-only <ref>...HEAD` touches gate-paths.mjs's paths
//   --parallel               one Chrome per row GROUP (Wall / Frame / Brush+Stripe / Sidebar), each with its
//                            own fresh baseline, run side by side; reports merged into <out>
//   --group <name>           run one group only (what --parallel spawns)
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BRICK_CONTROLS, REQUIRES_SOURCE, PERSIST_BOARD, PEEK_LAYOUT, CLEAR_MENU, LAY_WARNING, SELECT_ELEMENT, MIGRATION } from './controls.mjs';
import { touchesBrickMatrix } from './gate-paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = (name) => process.argv.includes(`--${name}`);
const ROOT = arg('root', path.resolve(HERE, '../../bspline-frame-builder'));
const OUT = path.resolve(arg('out', 'brick-matrix-report'));
const PORT = Number(arg('port', 9701)), HTTP = PORT + 1;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Row groups: rows share state (and a baseline) only within a group, so groups can run side by side.
const GROUPS = ['wall', 'frame', 'brush', 'sidebar-quick', 'sidebar-3d', 'layout', 'clear', 'lay', 'select', 'migration', 'persistence'];

// The Project Manager's cloud API (window.BSPLINE_PRESETS_API_URL + /projects), answered IN THE PAGE from
// localStorage, installed before any page script runs: a matrix run must never write Fred's real projects.
// Only that URL prefix is intercepted; everything else goes to the real fetch.
const CLOUD_STAND_IN = `(() => {
  const KEY = 'brickMatrixCloudStandIn';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const keep = (m) => localStorage.setItem(KEY, JSON.stringify(m));
  const real = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const api = window.BSPLINE_PRESETS_API_URL ? String(window.BSPLINE_PRESETS_API_URL).replace(/[/]+$/, '') : null;
    if (!api || !url.startsWith(api + '/projects')) return real(input, init);
    const m = load(); const method = String(init.method || 'GET').toUpperCase();
    const name = decodeURIComponent(url.slice((api + '/projects').length).split('?')[0].replace(/^[/]/, ''));
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'PUT' && name) { const savedAt = Date.now(); m[name] = { body: init.body, savedAt }; keep(m); return json({ ok: true, savedAt }); }
    if (method === 'GET' && !name) return json({ items: Object.entries(m).map(([n, v]) => ({ name: n, savedAt: v.savedAt })) });
    if (method === 'GET' && m[name]) return new Response(m[name].body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'DELETE' && name) { delete m[name]; keep(m); return json({ ok: true }); }
    return json({ error: 'not found (brick-matrix cloud stand-in)' }, 404);
  };
})();`;
const groupOf = (c) => (c.group ? c.group : c.kind === 'opens' ? 'sidebar-quick' : c.kind === 'sidebar' ? (c.do.click?.startsWith('brickQuick_') ? 'sidebar-quick' : 'sidebar-3d')
  : c.kind === 'brush' || c.kind === 'stripe' ? 'brush' : c.tool);

if (arg('only-if-changed')) {
  const base = arg('only-if-changed');
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: path.resolve(HERE, '../..'), encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!touchesBrickMatrix(changed)) {
    console.log(`brick-matrix: skipped -- no change under gate-paths.mjs since ${base} (${changed.length} file(s) changed)`);
    process.exit(0);
  }
}

if (flag('parallel')) {
  const t0 = Date.now();
  const kids = GROUPS.map((g, i) => new Promise(async (resolve) => {
    await sleep(10000 * i); // staggered: N apps booting at once starve each other (measured: 2 of 4 never came up)
    const out = path.join(OUT, g);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--group', g, '--port', String(PORT + 10 * (i + 1)), '--out', out, '--root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${g}] ${l}`).join('\n') + '\n'));
    child.stderr.on('data', (d) => process.stderr.write(`[${g}] ${d}`));
    child.on('exit', (code) => resolve({ g, code, out }));
  }));
  const done = await Promise.all(kids);
  const rows = [], pageErrors = [];
  for (const k of done) {
    try { const r = JSON.parse(readFileSync(path.join(k.out, 'brick-matrix.json'), 'utf8')); rows.push(...r.rows); pageErrors.push(...r.pageErrors); }
    catch { pageErrors.push(`group ${k.g}: no report (exit ${k.code})`); }
  }
  const order = new Map(BRICK_CONTROLS.map((c, i) => [c.name, i]));
  rows.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
  writeReport(rows, pageErrors);
  const fails = failRows(rows);
  console.log(`\n${rows.length} rows, ${fails.length} FAIL, page errors ${pageErrors.length}, ${Math.round((Date.now() - t0) / 1000)}s (parallel) -> ${OUT}`);
  process.exit(fails.length || pageErrors.length || done.some((k) => k.code > 1) ? 1 : 0);
}

const CONTROLS = arg('group') ? BRICK_CONTROLS.filter((c) => groupOf(c) === arg('group')) : BRICK_CONTROLS;

// ---------------------------------------------------------------- browser
// A BRAND-NEW profile every run: the app restores its last saved session from localStorage, so a reused
// profile starts the matrix from the previous run's end state (a row that re-picks the current value then
// "does nothing"). Removed again in stop().
const profile = mkdtempSync(path.join(os.tmpdir(), `brick-matrix-chrome-${PORT}-`));
// ... and nothing may already answer on that port: two trees often serve an identical palette page, so the
// byte check below alone cannot tell another seat's server from ours.
if (await fetch(`http://127.0.0.1:${HTTP}/`).then(() => true, () => false)) {
  rmSync(profile, { recursive: true, force: true }); console.error(`brick-matrix: port ${HTTP} is already serving something (another seat's run?); pick another --port`); process.exit(2);
}
const server = spawn('python', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
const dropProfile = () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} };
// The served app must BE --root (37, turn 207: a run whose HTTP port was already held by another seat's server
// silently drove that other build -- 329 baseline bricks instead of 204, rows "not in this build"). http.server
// failing to bind exits quietly, so compare one served file byte-for-byte with the same file under ROOT.
const SERVED_CHECK = 'b-spline-gen/html/bspline_gen_palette.html';
let serverExit = null; server.on('exit', (code) => { serverExit = code; });
{
  const want = readFileSync(path.join(ROOT, SERVED_CHECK));
  let got = null;
  for (let i = 0; i < 150 && serverExit === null; i++) { // 30 s: under a 10-group --parallel load the 10th server took > 10 s
    await sleep(200);
    try { got = Buffer.from(await (await fetch(`http://127.0.0.1:${HTTP}/${SERVED_CHECK}`)).arrayBuffer()); if (got.equals(want)) break; } catch {}
  }
  if (serverExit !== null || !got || !got.equals(want)) {
    stop(); dropProfile();
    console.error(`brick-matrix: port ${HTTP} is not serving --root ${ROOT} (${serverExit !== null ? `own server exited ${serverExit}, port likely taken` : got ? `${SERVED_CHECK} differs from the file under --root` : 'no response'}); pick another --port`);
    process.exit(2);
  }
}
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { stop(); console.error('brick-matrix: no Chrome DevTools endpoint'); process.exit(2); }
const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
});
// A DevTools reply that never comes (MEASURED: three runs booting at once, one sat 12+ min at "baseline
// attempt 2" on an evaluate with no answer) must be a reported error, never a hang. CDP_TIMEOUT_MS is far
// above the longest legitimate single call (an in-page click wait of 2.5 s; Page.navigate/reload return at
// commit), so it only ever fires on a lost reply. The rejection lands in the run's own catch: a page error,
// exit 1.
const CDP_TIMEOUT_MS = 60000;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const i = ++id;
  const timer = setTimeout(() => { pending.delete(i); reject(new Error(`DevTools ${method} got no reply in ${CDP_TIMEOUT_MS / 1000}s`)); }, CDP_TIMEOUT_MS);
  pending.set(i, (m) => { clearTimeout(timer); resolve(m); });
  ws.send(JSON.stringify({ id: i, method, params }));
});
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
const click = (elId, wait = 1200) => js(`(async()=>{ const b=document.getElementById(${JSON.stringify(elId)}); if(!b) return 'MISSING'; if(b.disabled) return 'DISABLED'; b.click(); await new Promise(r=>setTimeout(r,${wait})); return 'ok'; })()`);
const setValue = (elId, v, event) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); if(!e) return 'MISSING'; if(e.disabled) return 'DISABLED'; e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event(${JSON.stringify(event)})); return 'ok'; })()`);
const act = async (d) => (d.click ? click(d.click, 400) : setValue(d.set, d.value, d.event));
const targetId = (d) => d.click || d.set;
// controls.mjs `requires`: is the other control in the state this one depends on?
const requirementMet = (q) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(q.control)}); if(!e) return false;
  const s=${JSON.stringify(q.satisfied)}; if ('gt' in s) return Number(e.value) > s.gt; if ('active' in s) return e.classList.contains('active') === s.active;
  if ('checked' in s) return e.checked === s.checked; return false; })()`);
// unmet requirement: greyed out (disabled) or not shown at all
const isDisabled = (elId) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); return !e || !!e.disabled || e.offsetParent===null; })()`);
const appRule = (elId) => js(`(async()=>{ let mod, eng;
  try { mod = await import('./main/brick-control-requires.js'); eng = await import('./core/bricks/index.js'); } catch { return null; }
  const el = document.getElementById(${JSON.stringify(elId)}); if (!el) return null;
  const ids = []; for (let n = el; n; n = n.parentElement) if (n.id) ids.push(n.id);
  const rule = (mod.BRICK_CONTROL_REQUIRES || []).find((r) => (r.controls || []).some((c) => ids.includes(c))); if (!rule) return null;
  const ctl = rule.requires.control ? document.getElementById(rule.requires.control) : null;
  const met = mod.requirementMet(rule.requires, ctl, { engineOptions: eng.ENGINE_OPTIONS || [] });
  return JSON.stringify({ met, why: rule.why, requires: rule.requires, source: 'app' }); })()`).then((v) => (v ? JSON.parse(v) : null));
const exists = (elId) => js(`!!document.getElementById(${JSON.stringify(elId)})`);

// ---------------------------------------------------------------- measures
// 2D: every brick-tool element, attributes SORTED (serialization order differs after a reopen), ids and
// display-only classes dropped -- so equal layouts hash equal.
const CANVAS = `(()=>{ const ed=window.svgEditor; if(!ed?._sketchLayer) return 'none';
  const SKIP=new Set(['id','class','data-brick-element','data-brick-owner']);
  const ns=[...ed._sketchLayer.node.querySelectorAll('[data-brick]')];
  // fill-pattern ids carry a global creation counter (editor-brick-surface.js brickfill-<sample>-<N>): drop it
  const norm=(v)=>v.replace(/(url[(]#brickfill-[^)]*?)-[0-9]+[)]/g,'$1)'); // no backslashes: this is inside a template literal
  const s=ns.map(n=>n.tagName+'{'+[...n.attributes].filter(a=>!SKIP.has(a.name)).map(a=>a.name+'='+norm(a.value)).sort().join(';')+'}').join('|');
  let x=2166136261; for (let i=0;i<s.length;i++){ x^=s.charCodeAt(i); x=Math.imul(x,16777619);} return ns.length+'#'+(x>>>0).toString(36); })()`;
const BRUSH = CANVAS.replace("'[data-brick]'", `'[data-brick="brush"]'`).replace("'data-brick-owner'", "'data-brick-owner','data-brick-id'");
// 3D: the live terrain heightmap (core/state.js lastResult.heights), quantised to 1e-5 in.
const HEIGHTS = `(async()=>{ const m=await import('./core/state.js'); const h=m.lastResult?.heights; if(!h) return 'none';
  let x=2166136261; for (let i=0;i<h.length;i++){ x^=Math.round(h[i]*1e5); x=Math.imul(x,16777619);} return h.length+'#'+(x>>>0).toString(36); })()`;
const isPending = () => js(`!!document.getElementById('brickGenerate')?.classList.contains('pending')`);
// a rebuild is async: wait until the heightmap hash is stable for 3 polls (and give a change 6s to appear)
async function heightsSettled(prev, maxMs = 30000) {
  let last = await js(HEIGHTS), same = 0; const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(700); const h = await js(HEIGHTS);
    if (h === last) { if (++same >= 3 && (h !== prev || Date.now() - t0 > 6000)) return h; } else { same = 0; last = h; }
  }
  return last;
}
// The canvas after an at-once re-lay: poll until it has moved off `before` and then held still for two
// polls (the re-lay is async), or until CANVAS_SETTLE_MS -- unchanged by then means it did not re-lay.
const CANVAS_SETTLE_MS = 10000;
async function canvasSettled(before) {
  let last = await js(CANVAS), still = 0;
  for (let t = 0; t < CANVAS_SETTLE_MS; t += 300) {
    await sleep(300);
    const now = await js(CANVAS);
    still = now === last ? still + 1 : 0; last = now;
    if (now !== before && still >= 2) break;
  }
  return last;
}
// the distinct data-brick-set values on the bricks of each kind (item 23): { wall: ['3'], frame: ['1'] }
const brickSets = (kinds) => js(`(()=>{ const out={}; for (const k of ${JSON.stringify(kinds)}) out[k]=[...new Set([...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="'+k+'"]')].map(n=>n.getAttribute('data-brick-set')))]; return JSON.stringify(out); })()`).then(JSON.parse);
const editorOpen = () => js(`getComputedStyle(document.getElementById('svgEditorModal')).display !== 'none'`);
async function openBrickTool(tool) {
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  await click('editorTabBrick', 800);
  const active = await js(`document.querySelector('#editorToolbarBrick .tool-btn.active')?.id || ''`);
  if (tool && active !== `brickTool_${tool}`) await click(`brickTool_${tool}`, 800);
}
const apply = () => click('editorApply', 2000);

// ---------------------------------------------------------------- run
const rows = [];
let Z = null; // the heightmap after the last commit
const verdict = (observed, expected) => (expected === null ? 'n/a' : observed === expected ? 'PASS' : 'FAIL');
async function record(c, obs) {
  const v = { pending: verdict(obs.pending, c.expect.pending), canvas: verdict(obs.canvas, c.expect.canvas), threeD: verdict(obs.threeD, c.expect.threeD) };
  if (c.expect.sets) v.set = obs.setsOk ? 'PASS' : 'FAIL'; // item 23: per-element brick sets
  if (c.expect.reads) v.reads = obs.readsOk ? 'PASS' : 'FAIL'; // per-element joint (fb-app 1404b72)
  const row = { name: c.name, kind: c.kind, tool: c.tool || null, result: obs.result, observed: { pending: obs.pending, canvas: obs.canvas, threeD: obs.threeD, sets: obs.sets, reads: obs.reads }, expect: c.expect, verdict: v, hashes: obs.hashes };
  rows.push(row);
  const fail = Object.values(v).includes('FAIL') || obs.result !== 'ok';  // e.g. 'MISSING' / 'DISABLED' control
  console.log(`${fail ? 'FAIL' : 'pass'}  ${c.name.padEnd(34)} pending ${v.pending.padEnd(4)} canvas ${v.canvas.padEnd(4)} 3D ${v.threeD}${v.set ? ' sets ' + v.set + ' ' + JSON.stringify(obs.sets) : ''}${v.reads ? ' reads ' + v.reads + ' ' + JSON.stringify(obs.reads) : ''}${obs.result !== 'ok' ? '  (' + obs.result + ')' : ''}`);
  if (fail) await shot(`FAIL_${c.name.replace(/[^a-z0-9]+/gi, '_')}`);
}

try {
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOUD_STAND_IN });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html` });
  for (let i = 0; i < 90; i++) { await sleep(1000); if (await js(`!!document.getElementById('btnStampEdit') && !document.getElementById('app-splash-name')?.offsetParent`)) break; }
  await sleep(3000);
  // baseline: a wall and a frame laid, applied. Under load (--parallel) the app can still be starting, so
  // the editor must really exist and the baseline must really hold bricks before any row is measured --
  // retried, and a setup that never comes up is a SETUP error, not N misleading row FAILs.
  let baseline = 'none';
  for (let attempt = 1; attempt <= 4 && !/^[1-9]/.test(baseline); attempt++) {
    if (attempt > 1) { console.log(`baseline attempt ${attempt} (got ${baseline})`); await sleep(5000); }
    if (attempt > 2) { // a page that never brought the editor up: reload it, wait for the app again
      await send('Page.reload', {});
      for (let i = 0; i < 90; i++) { await sleep(1000); if (await js(`!!document.getElementById('btnStampEdit') && !document.getElementById('app-splash-name')?.offsetParent`)) break; }
      await sleep(3000);
    }
    await openBrickTool('wall');
    for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
    await click('brickGenerate', 1800);
    await openBrickTool('frame'); await click('brickGenerate', 1800);
    baseline = await js(CANVAS);
  }
  if (!/^[1-9]/.test(baseline)) throw new Error(`setup failed: no bricks laid at baseline (${baseline})`);
  await apply(); Z = await heightsSettled(null);
  console.log('baseline', baseline, Z, '| requires from:', REQUIRES_SOURCE);

  for (const c of CONTROLS) {
    if (c.introducedBy) {
      if (c.kind === 'stripe') { await openBrickTool('brush'); await click('brickTool_stripe', 600); }
      if (!(await exists(targetId(c.do)))) {
        rows.push({ name: c.name, kind: c.kind, result: `skipped: not in this build (introduced by ${c.introducedBy})`, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a' } });
        console.log(`skip  ${c.name.padEnd(34)} not in this build (introduced by ${c.introducedBy})`);
        continue;
      }
    }
    // `requires`: the APP's own rule for this control (main/brick-control-requires.js, judged in the page by
    // the app's requirementMet + the engine's ENGINE_OPTIONS -- found on the control or any ancestor, e.g.
    // a whole row), else this row's own fallback declaration.
    let rule = await appRule(targetId(c.do));
    if (!rule && c.requires) rule = { met: await requirementMet(c.requires), why: c.requires.why, requires: c.requires, source: 'matrix' };
    if (rule && !rule.met) {
      if (c.kind === 'editor' || c.kind === 'editor3d') await openBrickTool(c.tool);
      else if (c.kind === 'brush' || c.kind === 'stripe') await openBrickTool('brush');
      else if (await editorOpen()) { await apply(); Z = await heightsSettled(Z); }
      if (c.kind === 'sidebar') await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
      // the dependency is unmet: the control must be greyed out or hidden -- that is the whole check for this row
      const disabled = await isDisabled(targetId(c.do));
      const row = { name: c.name, kind: c.kind, tool: c.tool || null, result: 'requires unmet', requires: rule.requires, requiresSource: rule.source,
        observed: { disabled }, expect: { disabled: true }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', greyedOut: disabled ? 'PASS' : 'FAIL' } };
      rows.push(row);
      console.log(`${disabled ? 'pass' : 'FAIL'}  ${c.name.padEnd(34)} requires ${JSON.stringify(rule.requires)} unmet -> ${disabled ? 'greyed/hidden' : 'NOT greyed or hidden'} (${rule.why})`);
      if (!disabled) await shot(`FAIL_${c.name.replace(/[^a-z0-9]+/gi, '_')}`);
      continue;
    }
    if (c.kind === 'editor' || c.kind === 'editor3d') {
      await openBrickTool(c.tool);
      const c0 = await js(CANVAS);
      const p0 = await isPending();
      const result = await act(c.do);
      const p = (await isPending()) && !p0;
      // 'at once' (F35 item 27): read the canvas straight after the change, never via Generate -- a setting
      // that only lands on Generate must FAIL here. Otherwise the old path: Generate, then read.
      const atOnce = c.expect.commit === 'at once';
      if (!atOnce && c.kind === 'editor' && await js(`!!document.getElementById('brickGenerate')?.offsetParent`)) await click('brickGenerate', 1800);
      const c1 = atOnce ? await canvasSettled(c0) : await js(CANVAS);
      const sets = c.expect.sets ? await brickSets(Object.keys(c.expect.sets)) : null;
      const reads = c.expect.reads ? JSON.parse(await js(`JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(c.expect.reads))}.map((id) => [id, Number(document.getElementById(id)?.value)])))`)) : null;
      const readsOk = !!reads && Object.entries(c.expect.reads).every(([id, v]) => Math.abs(reads[id] - v) < 1e-6);
      const setsOk = !!sets && Object.entries(c.expect.sets).every(([k, id]) => sets[k] && sets[k].length === 1 && sets[k][0] === String(id));
      await apply();
      const z1 = await heightsSettled(Z);
      await record(c, { result, pending: p, canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 }, sets, setsOk, reads, readsOk });
      Z = z1;
    } else if (c.kind === 'relay') {
      // Generate = "re-lay now": take one brick of the tool's kind off the canvas by hand, then Generate must
      // put back exactly the layout the current settings make (canonical canvas hash equal to before).
      await openBrickTool(c.tool);
      // the baseline is what the current settings lay (one Generate first): a reopened editor shows the
      // saved board, whose canonical hash can differ after the save/load round trip (MEASURED on fb-app
      // 9eb45d2: reopened 274#rsmdu4, the settings' own layout 274#1cbr1o)
      const cPrev = await js(CANVAS);
      await act(c.do);
      const c0 = await canvasSettled(cPrev);
      const removed = await js(`(()=>{ const n=window.svgEditor?._sketchLayer?.node.querySelector('[data-brick=${JSON.stringify(c.tool)}]'); if(!n) return false; n.remove(); return true; })()`);
      const cGap = await js(CANVAS);
      const result = await act(c.do);
      const c1 = await canvasSettled(cGap);
      const ok = removed && cGap !== c0 && c1 === c0;
      rows.push({ name: c.name, kind: c.kind, tool: c.tool, result, observed: { removed, disturbed: cGap !== c0, restored: c1 === c0 }, expect: c.expect,
        verdict: { pending: 'n/a', canvas: ok ? 'PASS' : 'FAIL', threeD: 'n/a' }, hashes: { c0, cGap, c1 } });
      console.log(`${ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(34)} brick removed ${removed}, canvas restored ${c1 === c0}`);
      if (!ok) await shot(`FAIL_${c.name.replace(/[^a-z0-9]+/gi, '_')}`);
    } else if (c.kind === 'brush') {
      const brushTool = c.tool || 'brush'; // e.g. 'raisedBrush' -- any stroke-drawing Brick tool
      await openBrickTool(brushTool);
      const stroke = async () => { await click(`brickTool_${brushTool}`, 300); await drag([[0.3, 0.45], [0.5, 0.5], [0.7, 0.45]]); };
      await stroke(); const a = await js(BRUSH); await key('z');
      const p0 = await isPending();
      const result = await act(c.do); const p = (await isPending()) && !p0;
      await stroke(); const b = await js(BRUSH); await key('z');
      await record(c, { result, pending: p, canvas: a !== b, threeD: null, hashes: { before: a, after: b } });
    } else if (c.kind === 'stripe') {
      // a fresh stroke, striped into 4 runs, then the style pick
      await openBrickTool('brush');
      await click('brickTool_brush', 300); await drag([[1.5 / 7, 0.5], [5.5 / 7, 0.5]]);
      await click('brickTool_stripe', 600);
      await js(`(async()=>{ const m=await import('./editor/editor-stripe-tool.js'); const ed=window.svgEditor;
        const spine=[...ed._sketchLayer.children()].reverse().find((el)=>el.attr('data-brick')==='brush-spine');
        m.stripeAt(ed, spine, { ...m.stripeSettings(ed), drive: 'count', count: 4 }); await new Promise(r=>setTimeout(r,1200)); return 1; })()`);
      const a = await js(BRUSH);
      const p0 = await isPending();
      const result = await act(c.do); await sleep(800);
      const p = (await isPending()) && !p0; const b = await js(BRUSH);
      await record(c, { result, pending: p, canvas: a !== b, threeD: null, hashes: { before: a, after: b } });
    } else if (c.kind === 'opens') {
      // a sidebar button that opens the editor on a declared tab: open?, on that tab? -- then close it again
      if (await editorOpen()) { await apply(); Z = await heightsSettled(Z); }
      await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
      const result = await act(c.do);
      await sleep(2500);
      const opened = await editorOpen();
      const tab = await js(`(async()=>{ const m = await import('./main/editor-tabs.js'); return m.getEditorTab(); })()`);
      const v = { opened: opened ? 'PASS' : 'FAIL', tab: tab === c.expect.tab ? 'PASS' : 'FAIL' };
      // `closeWith` (item 25, the [2D|3D] pill): that control must close the editor again
      let closed = null;
      if (opened && c.closeWith) { await click(c.closeWith, 2500); closed = !(await editorOpen()); Z = await heightsSettled(Z); }
      const ok = v.opened === 'PASS' && v.tab === 'PASS' && closed !== false;
      rows.push({ name: c.name, kind: c.kind, result, observed: { opened, tab, closed }, expect: c.expect, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', opens: ok ? 'PASS' : 'FAIL' } });
      console.log(`${ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(34)} opened ${v.opened} tab ${tab} (${v.tab})${c.closeWith ? ` closed by ${c.closeWith}: ${closed}` : ''}`);
      if (await editorOpen()) { await apply(); Z = await heightsSettled(Z); }
    } else if (c.kind === 'sidebar') {
      if (await editorOpen()) { await apply(); Z = await heightsSettled(Z); }
      await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
      const c0 = await js(CANVAS);
      const result = await act(c.do);
      await sleep(1500);
      const c1 = await js(CANVAS);
      const z1 = await heightsSettled(Z);
      await record(c, { result, pending: await isPending(), canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 } });
      Z = z1;
    }
  }
  if (!arg('group') || arg('group') === 'layout') await runLayout();
  if (!arg('group') || arg('group') === 'clear') await runClear();
  if (!arg('group') || arg('group') === 'lay') await runLayWarnings();
  if (!arg('group') || arg('group') === 'select') await runSelect();
  if (!arg('group') || arg('group') === 'migration') await runMigration();
  // persistence reloads the page, so it always runs LAST (and alone in --parallel's own 'persistence' group)
  if (!arg('group') || arg('group') === 'persistence') await runPersistence();
} catch (e) {
  pageErrors.push(`run error: ${e.message}`); // e.g. setup failed -- reported, exit 1
  console.log(`ERROR  ${e.message}`);
} finally {
  writeReport(rows, pageErrors);
  const fails = failRows(rows);
  console.log('');
  console.log(`${rows.length} rows, ${fails.length} FAIL, page errors ${pageErrors.length} -> ${OUT}`);
  stop();
  await sleep(1500); dropProfile(); // after Chrome has let go of it
  process.exit(fails.length || pageErrors.length ? 1 : 0);
}

// ---------------------------------------------------------------- persistence (hoisted)
async function waitApp() {
  for (let i = 0; i < 90; i++) { await sleep(1000); if (await js(`!!document.getElementById('btnStampEdit') && !document.getElementById('app-splash-name')?.offsetParent`)) break; }
  await sleep(3000);
}
async function openBrickTab() {
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click('editorTabBrick', 1000);
}
async function runPersistence() {
  // 1. lay the declared board through the UI, applied
  for (const step of PERSIST_BOARD.setup) {
    if (step.tool) { await openBrickTool(step.tool); continue; }
    if (step.stroke) { await click('brickTool_brush', 300); await drag(step.stroke); continue; }
    if (step.apply) {
      // the declared board must really lay every kind it checks, BEFORE anything is persisted: an empty kind
      // would make its "painted" row pass vacuously or fail as 0/0 far from the cause (MEASURED: 1.5 in bricks +
      // three White Rocks rings filled T1 completely once item 16(c) stopped the wall filling a bogus region)
      const counts = JSON.parse(await js(`JSON.stringify(Object.fromEntries(${JSON.stringify(PERSIST_BOARD.bricks.map((b) => b.kind))}.map((k) => [k, window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="' + k + '"]').length || 0])))`));
      const empty = Object.entries(counts).filter(([, n]) => !n).map(([k]) => k);
      if (empty.length) throw new Error(`setup: the persistence board lays no ${empty.join(', ')} bricks (${JSON.stringify(counts)})`);
      console.log(`persistence board laid ${JSON.stringify(counts)}`);
      await apply(); await heightsSettled(null); continue;
    }
    if (step.sidebar) {
      if (await editorOpen()) await apply();
      await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
      continue;
    }
    if (step.click === 'brickGenerate') { await click('brickGenerate', 1800); continue; }
    await act(step);
  }
  await sleep(2000);
  // 2. a reload
  await send('Page.reload', {}); await waitApp();
  await checkPersisted('reload');
  // 3. project Save As -> (fresh app) -> Load, through the real Project Manager modal (cloud stand-in)
  if (await editorOpen()) await apply();
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input'); if(!i) return 'no prompt'; i.value='brick-matrix-persist'; document.querySelector('.pm-prompt-ok').click(); await new Promise(r=>setTimeout(r,4000)); return 'ok'; })()`);
  const saved = await js(`Object.keys(JSON.parse(localStorage.getItem('brickMatrixCloudStandIn')||'{}'))`);
  console.log('project saved to the stand-in:', JSON.stringify(saved));
  // a fresh app: drop the app's own saved session (keep only the stand-in's store), reload -> defaults
  await js(`(()=>{ const keep=localStorage.getItem('brickMatrixCloudStandIn'); localStorage.clear(); if (keep) localStorage.setItem('brickMatrixCloudStandIn', keep); return 1; })()`);
  await send('Page.reload', {}); await waitApp();
  await click('btnOpenProjectManager', 2500);
  const picked = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')==='brick-matrix-persist'); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  console.log('project load:', picked);
  await checkPersisted('project load');
}
async function checkPersisted(phase) {
  await openBrickTab();
  // evidence: what the app's STATE holds -- a FAIL with the right state here means the panel/canvas lost it
  const st = await js(`(async()=>{ const { P } = await import('./core/state.js'); const s=P.brickSettings||{};
    return JSON.stringify({ setId: s.setId, pattern: s.pattern, brickLengthIn: s.brickLengthIn, frameBandPreset: s.frameBandPreset,
      surfaceStyle: s.surfaceStyle, reliefIn: s.reliefIn, elementLevelIn: s.elementLevelIn }); })()`);
  console.log(`state after ${phase}: ${st}`);
  for (const p of PERSIST_BOARD.panel) {
    const shown = p.active
      ? await js(`!!document.getElementById(${JSON.stringify(p.active)})?.classList.contains('active')`)
      : await js(`(()=>{ const e=document.getElementById(${JSON.stringify(p.value[0])}); return !!e && Math.abs(Number(e.value) - ${p.value[1]}) < 1e-6; })()`);
    persistRow(`Persist (${phase}): ${p.name}`, shown, p.active ? `active ${p.active}` : `${p.value[0]} = ${p.value[1]}`);
  }
  for (const b of PERSIST_BOARD.bricks) {
    const r = JSON.parse(await js(`JSON.stringify((()=>{ const ns=[...(window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="${b.kind}"]') || [])];
      const painted=ns.filter((n)=>{ const f=n.getAttribute('fill')||''; const m=f.match(/url[(]#([^)]+)[)]/); return !m || !!document.getElementById(m[1]); }).length;
      return { n: ns.length, painted }; })())`));
    persistRow(`Persist (${phase}): ${b.name}`, r.n > 0 && r.painted === r.n, `${r.painted}/${r.n} painted`);
  }
  await shot(`persist_${phase.replace(/[^a-z]+/gi, '_')}`);
}
function persistRow(name, ok, detail) {
  rows.push({ name, kind: 'persist', result: 'ok', observed: { detail }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', persists: ok ? 'PASS' : 'FAIL' } });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}

// ---------------------------------------------------------------- layout (hoisted)
// Layout rows judge only a SETTLED page (the advisor's loaded --parallel gate measured mid-boot and mid-re-snap):
// the Brick tab really active, the drawer really in its fixed (drawer) layout and not dragging, the tool
// really active, and Generate's rect unchanged over SETTLE_SAMPLES polls (> the drawer's 0.18s snap transition).
// (the Brick panel itself stays hidden until a tool is picked, so readiness is the editor + the active tab;
// the per-tool settle below then requires Generate to have a real box)
function brickTabReady() { return js(`!!window.svgEditor?._sketchLayer && !!document.getElementById('editorTabBrick')?.classList.contains('active')`); }
function LAYOUT_PROBE(tool) { return `JSON.stringify((()=>{ const g=document.getElementById(${JSON.stringify(PEEK_LAYOUT.element)}); const d=document.getElementById('editorMobileDrawer');
  const b=g ? g.getBoundingClientRect() : { top: 0, bottom: 0, height: 0 };
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), innerW: innerWidth, innerH: innerHeight,
    drawerLayout: !!d && getComputedStyle(d).position === 'fixed', dragging: !!d && d.classList.contains('is-dragging'), peek: !!d && d.classList.contains('is-peek'),
    toolActive: !!document.getElementById(${JSON.stringify('brickTool_' + tool)})?.classList.contains('active'),
    shownPx: Math.round(Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0))) }; })())`; }
async function settledLayout(tool) {
  const SETTLE_SAMPLES = 4, SETTLE_POLL_MS = 300, SETTLE_MAX_MS = 20000;
  let last = null, same = 0, r = null;
  for (let t = 0; t < SETTLE_MAX_MS; t += SETTLE_POLL_MS) {
    r = JSON.parse(await js(LAYOUT_PROBE(tool)));
    const ready = r.drawerLayout && !r.dragging && r.toolActive && r.h > 0;
    const key = `${r.top}/${r.h}/${r.innerW}`;
    same = ready && key === last ? same + 1 : 0; last = key;
    if (same >= SETTLE_SAMPLES - 1) return { r, settled: true };
    await sleep(SETTLE_POLL_MS);
  }
  return { r, settled: false };
}
async function runLayout() {
  for (const vp of PEEK_LAYOUT.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    let ready = false;
    for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
      if (attempt > 1) console.log(`layout ${vp.name}: Brick tab not up, attempt ${attempt}`);
      await send('Page.reload', {}); await waitApp();
      await openBrickTab(); ready = await brickTabReady();
    }
    for (const tool of PEEK_LAYOUT.tools) {
      for (let i = 0; i < 3 && !(await js(`!!document.getElementById(${JSON.stringify('brickTool_' + tool)})?.classList.contains('active')`)); i++) await click(`brickTool_${tool}`, 1000);
      const { r, settled } = await settledLayout(tool);
      const ok = settled && r.top >= 0 && r.bottom <= r.innerH + 0.5;
      const name = `Peek ${vp.name}: ${tool} Generate fully shown`;
      rows.push({ name, kind: 'layout', result: settled ? 'ok' : 'setup: page never settled (see observed)', observed: r,
        verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', layout: ok ? 'PASS' : 'FAIL' } });
      console.log(`${ok ? 'pass' : 'FAIL'}  Peek ${vp.name}: ${tool} Generate`.padEnd(54) + (settled ? ` ${r.shownPx}/${r.h} px shown, bottom ${r.bottom} of ${r.innerH}${r.peek ? ' (drawer at peek)' : ''}`
        : ` NOT SETTLED ${JSON.stringify(r)}`));
      if (!ok) await shot(`FAIL_peek_${vp.width}_${tool}`);
    }
  }
}

// ---------------------------------------------------------------- clear menu (hoisted; CLEAR_MENU in controls.mjs)
function clearKinds() { return ['frame', 'artwork', 'photo', 'bricks']; }
// One fingerprint per kind: { empty, hash }. Bricks and art are told apart by the Bricks layers (editor/layers.js
// isBricksLayer), the way the editor's own layer list does; brickfill-<N> pattern ids are stripped (a counter).
function clearProbe() { return `(async()=>{ const { P } = await import('./core/state.js'); const L = await import('./editor/layers.js'); const ed = window.svgEditor;
  const bricksLayers = (ed._layers || []).filter(L.isBricksLayer); const ids = new Set(bricksLayers.map((l) => String(l.id)));
  const kids = [...ed._sketchLayer.node.children]; const onBricks = (n) => ids.has(String(n.getAttribute('data-layer')));
  const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
  const canon = (ns) => ns.map((n) => n.outerHTML.replace(/brickfill-[0-9]+/g, '').replace(/ ?svg-selected/g, '')).join('|');
  const records = [...ed._sketchLayer.node.querySelectorAll('[data-brick-record]')]; // item 22: hidden <g> records, never art
  const art = kids.filter((n) => !onBricks(n) && !n.hasAttribute('data-brick-record')), gen = [...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"]')];
  return JSON.stringify({
    frame: { empty: P.frame?.templateId == null, hash: h(JSON.stringify(P.frame || null)) },
    artwork: { empty: art.length === 0, hash: art.length + '#' + h(canon(art)) },
    photo: { empty: P.photoImageDataUrl == null && !(P.photoEdits || []).length && P.photoPatternId == null,
      hash: h(String(P.photoImageDataUrl).slice(-300) + JSON.stringify(P.photoEdits || []) + P.photoPatternId) },
    bricks: { empty: gen.length === 0 && records.length === 0, hash: gen.length + '/' + records.length + '#' + h(canon(gen)) } }); })()`; }
async function clearFingerprint() { return JSON.parse(await js(clearProbe())); }
// A board holding all four kinds, each made through the real UI: a photo through the Photo panel's file input,
// the template_1 frame, a Pen stroke on the Artwork tab, a Wall laid with Generate.
async function seedClearBoard() {
  await send('Page.reload', {}); await waitApp();
  const doc = await send('DOM.getDocument', { depth: 0 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#photoFileInput' });
  await send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [path.join(ROOT, CLEAR_MENU.seed.photoFile)] });
  for (let i = 0; i < 30 && !(await js(`(async()=>{ const { P } = await import('./core/state.js'); return P.photoImageDataUrl != null; })()`)); i++) await sleep(500);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click('editorTabFrame', 800);
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 'none'; s.value='template_1'; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,1500)); return s.value; })()`);
  await click('editorTabArtwork', 800); await click('toolDraw', 400); await drag(CLEAR_MENU.seed.stroke); await click('toolSelect', 400);
  await click('editorTabBrick', 800); await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  return clearFingerprint();
}
function clearRow(name, ok, detail) {
  rows.push({ name, kind: 'clear', result: 'ok', observed: { detail }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', clear: ok ? 'PASS' : 'FAIL' } });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}
async function runClear() {
  for (const o of CLEAR_MENU.options) {
    const f0 = await seedClearBoard();
    const unseeded = clearKinds().filter((k) => f0[k].empty);
    if (unseeded.length) { clearRow(`${o.name}: clears only its kind`, false, `setup: the seeded board lacks ${unseeded.join(', ')}`); continue; }
    await click(o.tab, 800);
    await click(CLEAR_MENU.button, 600);
    if (!(await exists(o.item))) {
      rows.push({ name: `${o.name}: clears only its kind`, kind: 'clear', result: `skipped: not in this build (introduced by ${CLEAR_MENU.introducedBy})`, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a' } });
      console.log(`skip  ${o.name.padEnd(48)} not in this build (introduced by ${CLEAR_MENU.introducedBy})`);
      continue;
    }
    await click(o.item, 800);
    if (o.confirm === 'ok') await js(`(()=>{ document.querySelector(${JSON.stringify(CLEAR_MENU.confirmOk)})?.click(); return 1; })()`);
    if (o.confirm === 'keep') await js(`(()=>{ const ok=document.querySelector(${JSON.stringify(CLEAR_MENU.confirmOk)}); const keep=[...(ok?.parentElement?.querySelectorAll('button')||[])].find((b)=>b!==ok); keep?.click(); return 1; })()`);
    await sleep(2500); // the frame clear re-lays after its 350 ms settle; bricks re-lay at once
    const f1 = await clearFingerprint();
    const problems = [];
    for (const k of clearKinds()) {
      if (o.clears.includes(k)) { if (!f1[k].empty) problems.push(`${k} not cleared`); }
      else if (o.changes.includes(k)) { if (f1[k].empty) problems.push(`${k} gone`); }
      else if (f1[k].hash !== f0[k].hash) problems.push(`${k} changed`);
    }
    clearRow(`${o.name}: clears only its kind`, !problems.length,
      problems.length ? problems.join('; ') : `cleared [${o.clears.join(', ')}]${o.changes.length ? `, re-laid [${o.changes.join(', ')}]` : ''}, the rest identical`);
    await shot(`clear_${o.item}_${o.confirm || 'run'}`);
    if (o.undo === false || !o.clears.length) continue;
    await key('z'); await sleep(2500);
    const f2 = await clearFingerprint();
    const notBack = clearKinds().filter((k) => f2[k].hash !== f0[k].hash);
    clearRow(`${o.name}: one undo restores all`, !notBack.length, notBack.length ? `not restored: ${notBack.join(', ')}` : 'every kind back as seeded');
  }
}

// ---------------------------------------------------------------- lay warnings + Select (hoisted)
function checkRow(kind, name, ok, detail, skip) {
  if (skip) {
    rows.push({ name, kind, result: `skipped: not in this build (introduced by ${skip})`, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a' } });
    console.log(`skip  ${name.padEnd(48)} not in this build (introduced by ${skip})`);
    return;
  }
  rows.push({ name, kind, result: 'ok', observed: { detail }, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', check: ok ? 'PASS' : 'FAIL' } });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
}
async function plainKey(keyName) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code: keyName, windowsVirtualKeyCode: keyName === 'Escape' ? 27 : 0 });
  await sleep(700);
}
async function wallCount() { return js(`window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="wall"]').length ?? -1`); }
async function noteState(id) {
  return JSON.parse(await js(`JSON.stringify((()=>{ const n=document.getElementById(${JSON.stringify(id)}); if(!n) return { missing: true }; return { shown: n.offsetParent !== null && getComputedStyle(n).display !== 'none', text: (n.textContent||'').trim() }; })())`));
}
async function openEditorTab(tabId) {
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click(tabId, 900);
}

async function runLayWarnings() {
  const W = LAY_WARNING;
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(W.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await apply(); await heightsSettled(null);
  await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
  if (!(await exists(W.tooMany))) { checkRow('lay', `${W.template}: too many bands -> no wall + notes`, false, '', W.introducedBy); return; }
  // 1. bands that cover the board: no wall, both notes say so
  await click(W.tooMany, 2500);
  const side1 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900); // the Brick panel (and its note) shows once a tool is picked
  const walls1 = await wallCount(), ed1 = await noteState(W.notes.editor);
  const ok1 = walls1 === 0 && side1.shown && ed1.shown && side1.text.includes(W.text) && ed1.text.includes(W.text);
  checkRow('lay', `${W.template}: too many bands -> no wall + notes`, ok1, `wall ${walls1}, sidebar note ${side1.shown ? 'shown' : 'hidden'}, editor note ${ed1.shown ? 'shown' : 'hidden'}${side1.text.includes(W.text) ? '' : ' (text differs: ' + side1.text.slice(0, 60) + ')'}`);
  await apply(); await heightsSettled(null);
  // 2. bands that fit again: the wall comes back, both notes go
  await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
  await click(W.fits, 2500);
  const side2 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900);
  const walls2 = await wallCount(), ed2 = await noteState(W.notes.editor);
  checkRow('lay', `${W.template}: bands fit again -> wall back, notes hidden`, walls2 > 0 && !side2.shown && !ed2.shown,
    `wall ${walls2}, sidebar note ${side2.shown ? 'shown' : 'hidden'}, editor note ${ed2.shown ? 'shown' : 'hidden'}`);
  if (await editorOpen()) { await apply(); await heightsSettled(null); }
}

async function runSelect() {
  const S = SELECT_ELEMENT;
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 800); await click('brickGenerate', 2000);
  if (!(await exists(S.wallSelect))) { checkRow('select', 'Wall tool -> element Select', false, '', S.introducedBy); return; }
  // 1. the Wall tool arms element Select; the Area sub-tool stays hidden until the engine offers 'wallRegion'
  await click(S.wallTool, 900);
  const st = JSON.parse(await js(`JSON.stringify({ mode: window.svgEditor._currentMode, sel: !!document.getElementById(${JSON.stringify(S.wallSelect)})?.classList.contains('active'), area: (()=>{ const n=document.getElementById(${JSON.stringify(S.wallArea)}); return !!n && n.offsetParent !== null; })() })`));
  checkRow('select', 'Wall tool -> element Select', st.mode === S.selectMode && st.sel && !st.area, `mode ${st.mode}, Select ${st.sel ? 'active' : 'not active'}, Area ${st.area ? 'SHOWN' : 'hidden'}`);
  // 2. a real click on a frame brick selects the Frame element: its tool, its label, its outline -- drawing untouched
  const before = await js(CANVAS);
  const at = JSON.parse(await js(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const n=ns[Math.floor(ns.length/2)]; if(!n) return null; const r=n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, frames: ns.length }; })())`));
  if (!at) { checkRow('select', 'Click a frame brick -> the Frame element', false, 'no frame brick on the canvas'); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1000);
  const sel = JSON.parse(await js(`JSON.stringify({ frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active'), label: (document.getElementById(${JSON.stringify(S.frameLabel.id)})?.textContent||'').trim(), outline: (window.svgEditor._brickElementOutline||[]).length })`));
  const after = await js(CANVAS);
  checkRow('select', 'Click a frame brick -> the Frame element', sel.frameTool && sel.label.includes(S.frameLabel.text) && sel.outline === at.frames,
    `frame tool ${sel.frameTool ? 'active' : 'NOT active'}, label "${sel.label}", outline ${sel.outline} of ${at.frames} frame bricks`);
  checkRow('select', 'Selecting adds nothing to the drawing', before === after, before === after ? 'canvas hash unchanged' : `canvas changed ${before} -> ${after}`);
  // 3. Esc once clears the selection (tool stays), Esc twice clears the tool
  await plainKey('Escape');
  const e1 = JSON.parse(await js(`JSON.stringify({ outline: (window.svgEditor._brickElementOutline||[]).length, frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active') })`));
  checkRow('select', 'Esc once -> selection cleared, tool stays', e1.outline === 0 && e1.frameTool, `outline ${e1.outline}, frame tool ${e1.frameTool ? 'active' : 'cleared'}`);
  await plainKey('Escape');
  const e2 = await js(`[...document.querySelectorAll('[id^="brickTool_"].active')].map((b)=>b.id).join(',')`);
  checkRow('select', 'Esc twice -> no Brick tool active', !e2, e2 ? `still active: ${e2}` : 'no tool active');
  if (await editorOpen()) { await apply(); await heightsSettled(null); }
}

// ---------------------------------------------------------------- migration (hoisted; MIGRATION in controls.mjs)
// A board saved by pre-item-22 code (fixtures/pre22-board.json: laid + saved by b75e836^ through the real Project
// Manager into the cloud stand-in) must load on today's code migrated in place: records added, owners stamped,
// the roster's shared key retired -- and nothing re-laid, nothing in the 3D changed, through a save + load too.
function migrationProbe() {
  return `(async()=>{ const ed=window.svgEditor; const layer=ed._sketchLayer.node; const L=await import('./editor/layers.js');
    const recs={}; for (const r of layer.querySelectorAll('[data-brick-record]')) recs[r.getAttribute('data-brick-record')]=r.getAttribute('data-brick-laid');
    const bricks=[...layer.querySelectorAll('[data-brick="wall"],[data-brick="frame"]')];
    const canon=(ns)=>ns.map((n)=>n.getAttribute('data-brick')+':'+(n.getAttribute('points')||'').trim()).sort().join('|');
    const bricksLayers=(ed._layers||[]).filter(L.isBricksLayer);
    const { lastResult } = await import('./core/state.js');
    return JSON.stringify({ wall: layer.querySelectorAll('[data-brick="wall"]').length, frame: layer.querySelectorAll('[data-brick="frame"]').length,
      records: recs, unowned: bricks.filter((n)=>!n.getAttribute('data-brick-owner')).length,
      roster: bricksLayers.map((l)=>({ holdsBricks: !!l.holdsBricks, key: l.brickLaidKey ?? null, kinds: l.brickLaidKinds ?? null })),
      polys: canon(bricks) }); })()`;
}
// '<settings JSON>#frame:<frame JSON>' -- equal lays: identical frame part, identical settings except grout,
// whose width is compared as the effective one (groutByElement null = the set's declared default)
function sameLay(oldKey, newKey, setGrout, neutral = MIGRATION.neutralNewFields || {}) {
  if (!oldKey || !newKey) return false;
  const split = (k) => { const i = k.indexOf('#'); return [k.slice(0, i < 0 ? k.length : i), i < 0 ? '' : k.slice(i)]; };
  const [os, of] = split(oldKey), [ns, nf] = split(newKey);
  if (of !== nf) return false;
  let o, n; try { o = JSON.parse(os); n = JSON.parse(ns); } catch { return os === ns; }
  const oldWidth = o.grout?.widthIn;
  const newWidth = n.groutByElement ? (n.groutByElement.wall ?? setGrout) : n.grout?.widthIn;
  for (const x of [o, n]) { delete x.grout; delete x.groutByElement; }
  // a field the old key lacks lays as before when every leaf of it is its declared neutral value
  const leaves = (v) => (v && typeof v === 'object' ? Object.values(v).flatMap(leaves) : [v]);
  for (const [k, value] of Object.entries(neutral)) if (!(k in o) && k in n && leaves(n[k]).every((x) => x === value)) delete n[k];
  return JSON.stringify(o) === JSON.stringify(n) && Math.abs((oldWidth ?? setGrout) - (newWidth ?? setGrout)) < 1e-9;
}

async function loadFromStandIn(name) {
  await click('btnOpenProjectManager', 2500);
  const r = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')===${JSON.stringify(name)}); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  if (r !== 'loaded') throw new Error(`setup: project "${name}" ${r}`);
}
async function runMigration() {
  const M = MIGRATION;
  const body = readFileSync(path.join(HERE, M.fixture), 'utf8');
  // the OLD board, as it was saved: its bricks and its shared key, read from the fixture's own SVG in the page
  await send('Page.reload', {}); await waitApp();
  const old = JSON.parse(await js(`(()=>{ const body=${JSON.stringify(body)}; const svg=new DOMParser().parseFromString(JSON.parse(body).P.editorSvg, 'image/svg+xml');
    const layers=JSON.parse(svg.documentElement.getAttribute('data-editor-layers')||'[]'); const key=(layers.find((l)=>l.brickLaidKey)||{}).brickLaidKey||null;
    const bricks=[...svg.querySelectorAll('[data-brick="wall"],[data-brick="frame"]')];
    return JSON.stringify({ key, polys: bricks.map((n)=>n.getAttribute('data-brick')+':'+(n.getAttribute('points')||'').trim()).sort().join('|') }); })()`));
  if (!old.key) throw new Error('setup: the migration fixture holds no shared brickLaidKey (not a pre-item-22 board?)');
  // the app restores its last session on load: seed it with the old board, reload -> migrated in place
  await js(`(()=>{ localStorage.clear(); localStorage.setItem(${JSON.stringify(M.sessionKey)}, ${JSON.stringify(body)}); return 1; })()`);
  await send('Page.reload', {}); await waitApp();
  const z1 = await heightsSettled(null);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const a = JSON.parse(await js(migrationProbe()));
  const setGrout = M.setGroutWidthIn;
  const lay = (k) => sameLay(old.key, k, setGrout);
  checkRow('migration', 'Pre-item-22 board: records carry the old lay', lay(a.records['wall-full']) && lay(a.records.frame),
    `records ${JSON.stringify(Object.keys(a.records))}, same lay: wall ${lay(a.records['wall-full'])}, frame ${lay(a.records.frame)}${a.records['wall-full'] === old.key ? ' (byte-equal)' : ' -- differs in: ' + layDiff(old.key, a.records['wall-full'])}`);
  checkRow('migration', 'Pre-item-22 board: every brick owned', a.unowned === 0, `${a.unowned} of ${a.wall + a.frame} bricks without data-brick-owner`);
  const rosterOk = a.roster.length > 0 && a.roster.every((l) => l.holdsBricks && l.key === null && l.kinds === null);
  checkRow('migration', 'Pre-item-22 board: roster migrated', rosterOk, JSON.stringify(a.roster));
  checkRow('migration', 'Pre-item-22 board: nothing re-laid', a.wall === M.wall && a.frame === M.frame && a.polys === old.polys,
    `wall ${a.wall}/${M.wall}, frame ${a.frame}/${M.frame}, polygons ${a.polys === old.polys ? 'identical' : 'CHANGED'}`);
  // the migrated board through another save + restore: records kept, nothing re-laid, 3D identical
  if (await editorOpen()) await apply();
  await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  const z2 = await heightsSettled(null);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const b = JSON.parse(await js(migrationProbe()));
  const keptOk = b.records['wall-full'] === a.records['wall-full'] && b.records.frame === a.records.frame;
  checkRow('migration', 'Migrated board: restore keeps records, bricks and 3D', keptOk && z1 === z2 && b.polys === a.polys,
    `records kept ${keptOk}, 3D ${z1 === z2 ? 'identical' : z1 + ' -> ' + z2}, polygons ${b.polys === a.polys ? 'identical' : 'CHANGED'}`);
  if (await editorOpen()) await apply();
}
// the settings fields that differ between two lay keys (for the report)
function layDiff(oldKey, newKey) {
  try {
    const o = JSON.parse(oldKey.split('#')[0]), n = JSON.parse((newKey || '').split('#')[0]);
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]));
    return keys.map((k) => `${k}: ${JSON.stringify(o[k])} -> ${JSON.stringify(n[k])}`).join('; ').slice(0, 300) + ((oldKey.split('#')[1] || '') !== ((newKey || '').split('#')[1] || '') ? '; FRAME PART differs' : '');
  } catch { return 'unparseable'; }
}

// ---------------------------------------------------------------- report (hoisted; shared by --parallel)
function failRows(rows) {
  return rows.filter((r) => Object.values(r.verdict).includes('FAIL') || !(['ok', 'requires unmet'].includes(r.result) || String(r.result).startsWith('skipped')));
}
function writeReport(rows, pageErrors) {
  const fails = failRows(rows);
  writeFileSync(path.join(OUT, 'brick-matrix.json'), JSON.stringify({ requiresSource: REQUIRES_SOURCE, rows, pageErrors }, null, 1));
  const md = ['| Control | Kind | Pending | Canvas | 3D | Greyed out (requires) | Persists | Layout | Clear | Check |', '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.name} | ${r.kind}${r.tool ? ' (' + r.tool + ')' : ''} | ${r.verdict.pending} | ${r.verdict.canvas} | ${r.verdict.threeD} | ${r.verdict.greyedOut || ''} | ${r.verdict.persists || ''} | ${r.verdict.layout || ''} | ${r.verdict.clear || ''} | ${r.verdict.check || ''} |`)];
  const NL = String.fromCharCode(10);
  writeFileSync(path.join(OUT, 'brick-matrix.md'), md.join(NL) + NL + NL + `${fails.length} FAIL row(s); page errors: ${pageErrors.length}` + NL);
}

// ---------------------------------------------------------------- input helpers (hoisted)
async function key(k) {
  const code = 'Key' + k.toUpperCase();
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, modifiers: 2, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers: 2, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) });
  await sleep(900);
}
async function drag(pts) {
  const at = async ([fx, fy]) => JSON.parse(await js(`(()=>{ const svg=window.svgEditor._sketchLayer.node.ownerSVGElement; const r=svg.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*${fx}, y:r.top+r.height*${fy}}); })()`));
  const ps = []; for (const p of pts) ps.push(await at(p));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[0].x, y: ps[0].y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ps[0].x, y: ps[0].y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i < ps.length; i++) for (let k = 1; k <= 8; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[i - 1].x + (ps[i].x - ps[i - 1].x) * k / 8, y: ps[i - 1].y + (ps[i].y - ps[i - 1].y) * k / 8, button: 'left', buttons: 1 });
    await sleep(15);
  }
  const z = ps[ps.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1200);
}
