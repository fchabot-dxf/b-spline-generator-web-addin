// Brick-tab end-to-end matrix: drives every declared control (groups/<group>.mjs) in the real app in headless
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
//   --real-cloud             talk to Fred's REAL projects worker (?realCloud=1, no stand-in) -- never by default: a
//                            loopback-served page points at a dead address otherwise (bspline_gen_palette.html)
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { GROUPS, GROUP_OF, RUNNER_ORDER, bindGroups, runGroup, CLEAR_MENU, EDIT_PASSWORD_TEST, BRICK_CONTROLS, REQUIRES_SOURCE, GROUP_SETUP } from './groups/index.mjs';
import { touchesBrickMatrix } from './gate-paths.mjs';
import { portBusy, dropStaleProfiles } from './ports.mjs';
import { registerRun, makeStop, readRuns, classifyOrphans, processTable } from './run-registry.mjs';
import { bootRetry } from './boot.mjs';
import { guardHeavyRun, HEAVY_RUN_CHILD_ENV } from '../heavy-run-guard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = (name) => process.argv.includes(`--${name}`);
const ROOT = arg('root', path.resolve(HERE, '../../bspline-frame-builder'));
const OUT = path.resolve(arg('out', 'brick-matrix-report'));
let PORT = Number(arg('port', 9701)), HTTP = PORT + 1;
const REAL_CLOUD = flag('real-cloud'); // see the header: the real worker only on request
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Row groups (GROUPS, groups/index.mjs): rows share state (and a baseline) only within a group, so groups can run side
// by side.

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
    // item 34: a write that carries a password must carry the declared test one (the worker answers 401 otherwise);
    // a write with NO Authorization header is pre-item-34 code and is accepted as before
    const hdrs = init.headers || {};
    const auth = typeof hdrs.get === 'function' ? hdrs.get('Authorization') : (hdrs.Authorization || hdrs.authorization);
    const writes = ['PUT', 'DELETE'].includes(String(init.method || 'GET').toUpperCase());
    if (writes && auth && auth !== 'Bearer __EDIT_PASSWORD__') return new Response(JSON.stringify({ error: 'wrong password (brick-matrix stand-in)' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
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
const groupOf = (c) => GROUP_OF.get(c); // the group file the row is declared in (groups/index.mjs)

if (arg('only-if-changed')) {
  const base = arg('only-if-changed');
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd: path.resolve(HERE, '../..'), encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!touchesBrickMatrix(changed)) {
    console.log(`brick-matrix: skipped -- no change under gate-paths.mjs since ${base} (${changed.length} file(s) changed)`);
    process.exit(0);
  }
}

// a heavy run from here on (--only-if-changed above may skip it for free): refused while the gate holds its lock
// (its own runs pass) or free RAM is under the floor -- tools/heavy-run-guard.mjs
guardHeavyRun('brick matrix');

if (flag('parallel')) {
  const t0 = Date.now();
  // MEASURED: two gates at once (the advisor's and a seat's) -- one group's served-root check found its port taken
  // and the group never ran. Pick a base whose every group port (DevTools + HTTP) is free; shift by 1000. Free = bindable
  // (ports.mjs: Fusion's adexmtsv.exe held 9891, strokes' DevTools port, and dropped HTTP -- the old fetch read it as free)
  const dropped = dropStaleProfiles();
  if (dropped) console.log(`brick-matrix: removed ${dropped} leftover Chrome profile dir(s) no Chrome was using`);
  // run-registry.mjs: report (never kill) what dead matrix runs left running -- their owner clears them with orphans.mjs
  const procs = processTable();
  const left = procs ? classifyOrphans(readRuns(), procs).filter((o) => o.pids.length) : [];
  if (left.length) console.log(`brick-matrix: ${left.length} dead matrix run(s) left ${left.reduce((t, o) => t + o.pids.length, 0)} process(es) running -- node tools/brick-matrix/orphans.mjs`);
  let base = PORT;
  for (let tries = 0; tries < 5; tries++) {
    const ports = GROUPS.flatMap((_, i) => [base + 10 * (i + 1), base + 10 * (i + 1) + 1]);
    const busy = (await Promise.all(ports.map(portBusy))).some(Boolean);
    if (!busy) break;
    console.log(`ports ${base + 10}..${base + 10 * GROUPS.length + 1} in use (another run?) -- trying ${base + 1000}`);
    base += 1000;
  }
  const kids = GROUPS.map((g, i) => new Promise(async (resolve) => {
    await sleep(10000 * i); // staggered: N apps booting at once starve each other (measured: 2 of 4 never came up)
    const out = path.join(OUT, g);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--group', g, '--port', String(base + 10 * (i + 1)), '--out', out, '--root', ROOT, ...(REAL_CLOUD ? ['--real-cloud'] : [])], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, [HEAVY_RUN_CHILD_ENV]: '1' } });
    child.stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter(Boolean).map((l) => `[${g}] ${l}`).join('\n') + '\n'));
    child.stderr.on('data', (d) => process.stderr.write(`[${g}] ${d}`));
    child.on('exit', (code) => resolve({ g, code, out }));
  }));
  const done = await Promise.all(kids);
  const rows = [], pageErrors = [], perGroup = new Map();
  for (const k of done) {
    try {
      const r = JSON.parse(readFileSync(path.join(k.out, 'brick-matrix.json'), 'utf8'));
      rows.push(...r.rows); pageErrors.push(...r.pageErrors);
      perGroup.set(k.g, { rows: r.rows.length, fail: failRows(r.rows).length, errors: r.pageErrors.length });
    } catch { pageErrors.push(`group ${k.g}: no report (exit ${k.code})`); }
  }
  const order = new Map(BRICK_CONTROLS.map((c, i) => [c.name, i]));
  rows.sort((a, b) => (order.get(a.name) ?? 999) - (order.get(b.name) ?? 999));
  writeReport(rows, pageErrors);
  const fails = failRows(rows);
  console.log(`\n${rows.length} rows, ${fails.length} FAIL, page errors ${pageErrors.length}, ${Math.round((Date.now() - t0) / 1000)}s (parallel) -> ${OUT}`);
  // the gate's contract (advisor): one line per DECLARED group, so a re-run can target exactly the groups that failed or
  // vanished -- "group <name>: rows N, FAIL K, page errors E" or "group <name>: did not report"
  for (const g of GROUPS) {
    const r = perGroup.get(g);
    console.log(r ? `group ${g}: rows ${r.rows}, FAIL ${r.fail}, page errors ${r.errors}` : `group ${g}: did not report`);
  }
  process.exit(fails.length || pageErrors.length || done.some((k) => k.code > 1) ? 1 : 0);
}

const CONTROLS = arg('group') ? BRICK_CONTROLS.filter((c) => groupOf(c) === arg('group')) : BRICK_CONTROLS;

// ---------------------------------------------------------------- browser
// A BRAND-NEW profile every run: the app restores its last saved session from localStorage, so a reused
// profile starts the matrix from the previous run's end state (a row that re-picks the current value then
// "does nothing"). Removed again in stop().
// advisor: a busy DEFAULT port (another seat's run) is skipped for the next free pair, not fatal; an explicit --port is
// held to (the check below still refuses it when taken)
if (!arg('port')) {
  const dropped = dropStaleProfiles();
  if (dropped) console.log(`brick-matrix: removed ${dropped} leftover Chrome profile dir(s) no Chrome was using`);
  for (let i = 0; i < 40 && ((await portBusy(PORT)) || (await portBusy(HTTP))); i++) { PORT += 10; HTTP = PORT + 1; }
  if (PORT !== 9701) console.log(`brick-matrix: the default port was busy; using ${PORT}/${HTTP}`);
} else if (await portBusy(PORT)) {
  console.error(`brick-matrix: DevTools port ${PORT} is held by another process (it cannot be bound); pick another --port`); process.exit(2);
}
const profile = mkdtempSync(path.join(os.tmpdir(), `brick-matrix-chrome-${PORT}-`));
// ... and nothing may already answer on that port: two trees often serve an identical palette page, so the
// byte check below alone cannot tell another seat's server from ours.
if (await fetch(`http://127.0.0.1:${HTTP}/`).then(() => true, () => false)) {
  rmSync(profile, { recursive: true, force: true }); console.error(`brick-matrix: port ${HTTP} is already serving something (another seat's run?); pick another --port`); process.exit(2);
}
// item 74k: serve.py = http.server with a 128 listen backlog (stock 5 refused module requests under load -- measured)
const server = spawn('python', [path.join(HERE, 'serve.py'), String(HTTP)], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
// run-registry.mjs: this run's Chrome and server on record, stopped (Chrome with its renderers) on EVERY exit path --
// the finally below, a signal (a timeout / task stop / Ctrl+C), process exit; a hard kill leaves the record for orphans.mjs
const runFile = registerRun({ runPid: process.pid, chromePid: chrome.pid, serverPid: server.pid, profile, port: PORT, http: HTTP, root: ROOT, startedAt: Date.now() });
const stop = makeStop({ chrome, server, file: runFile });
const dropProfile = () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { stop(); dropProfile(); process.exit(130); });
process.on('exit', stop);
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
// 30 s, as the server check above: under a 14-group --parallel load the 11th Chrome (frame-ui) missed a 10 s wait
// twice ("no Chrome DevTools endpoint"; alone it is 14/14)
for (let i = 0; i < 150 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} }
if (!wsUrl) { stop(); console.error('brick-matrix: no Chrome DevTools endpoint'); process.exit(2); }
const ws = new WebSocket(wsUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const pageErrors = [];
// item 74k: every request the page could not load (url -> error) -- a failed module request leaves no app at all, and
// a setup that never boots names them
const requestUrls = new Map(), failedRequests = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') requestUrls.set(m.params.requestId, m.params.request.url);
  if (m.method === 'Network.loadingFailed') failedRequests.push(`${(requestUrls.get(m.params.requestId) || '?').split('/html/').pop()}: ${m.params.errorText || `blocked ${m.params.blockedReason || '?'}`}`);
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
// A JSON probe that returns nothing is retried once (MEASURED in the advisor's loaded --parallel gate: the clear
// group's fingerprint came back undefined once, "undefined" is not valid JSON, and the same group passed alone),
// then fails NAMING the probe and the page's own exception instead of a bare JSON parse error.
async function jsJSON(expr) {
  for (let attempt = 1; ; attempt++) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    const v = r.result?.result?.value;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { /* fall through */ } }
    if (attempt >= 2) {
      const ex = r.result?.exceptionDetails;
      const why = ex ? ' -- the page threw: ' + String(ex.exception?.description || ex.text || '').split('\n')[0] : '';
      throw new Error(`probe returned ${v === undefined ? 'nothing' : JSON.stringify(v).slice(0, 60)}${why} [${expr.replace(/\s+/g, ' ').slice(0, 100)}]`);
    }
    await sleep(1000);
  }
}
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64')); };
const click = (elId, wait = 1200) => js(`(async()=>{ const b=document.getElementById(${JSON.stringify(elId)}); if(!b) return 'MISSING'; if(b.disabled) return 'DISABLED'; b.click(); await new Promise(r=>setTimeout(r,${wait})); return 'ok'; })()`);
const setValue = (elId, v, event) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); if(!e) return 'MISSING'; if(e.disabled) return 'DISABLED'; e.value=${JSON.stringify(String(v))}; e.dispatchEvent(new Event(${JSON.stringify(event)})); return 'ok'; })()`);
// F35 item 43: a Brick-panel control is acted on / checked with ITS tab up (General for a global block) -- hidden by
// the other tab is not "greyed out" (main/brick-panel.js revealBrickControl; a no-op for any other control)
const reveal = (elId) => js(`import('./main/brick-panel.js').then((m) => (m.revealBrickControl ? m.revealBrickControl(${JSON.stringify(elId)}) : 0, 1), () => 1)`);
const act = async (d) => { await reveal(d.click || d.set); return d.click ? click(d.click, 400) : setValue(d.set, d.value, d.event); };
const targetId = (d) => d.click || d.set;
// a row's `requires`: is the other control in the state this one depends on?
const requirementMet = (q) => js(`(()=>{ const e=document.getElementById(${JSON.stringify(q.control)}); if(!e) return false;
  const s=${JSON.stringify(q.satisfied)}; if ('gt' in s) return Number(e.value) > s.gt; if ('active' in s) return e.classList.contains('active') === s.active;
  if ('checked' in s) return e.checked === s.checked; return false; })()`);
// unmet requirement: greyed out (disabled) or not shown at all. A2 (seat D): a greyed number field counts only with its
// -/+ stepper greyed too (the stepper still moved a greyed Grout depth 0.05 -> 0.055 before the fix)
const isDisabled = async (elId) => (await reveal(elId), js(`(()=>{ const e=document.getElementById(${JSON.stringify(elId)}); if (!e || e.offsetParent===null) return true;
  return !!e.disabled && [...(e.closest('.cad-stepper')?.querySelectorAll('button') || [])].every((b) => b.disabled); })()`));
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
  const SKIP=new Set(['id','class','data-brick-element','data-brick-owner','data-brick-band','data-brick-row','data-brick-piece']); // editor-only, stripped at bake
  const ns=[...ed._sketchLayer.node.querySelectorAll('[data-brick]')];
  // a brick's fill is DISPLAY only (grey by height: neutral, then its layer's greys once the mask lands -- async): not layout
  const s=ns.map(n=>n.tagName+'{'+[...n.attributes].filter(a=>!SKIP.has(a.name) && !(a.name==='fill' && n.hasAttribute('data-brick-set'))).map(a=>a.name+'='+a.value).sort().join(';')+'}').join('|');
  let x=2166136261; for (let i=0;i<s.length;i++){ x^=s.charCodeAt(i); x=Math.imul(x,16777619);} return ns.length+'#'+(x>>>0).toString(36); })()`;
const BRUSH = CANVAS.replace("'[data-brick]'", `'[data-brick="brush"]'`).replace("'data-brick-owner'", "'data-brick-owner','data-brick-id'");
// 3D: the live terrain heightmap (core/state.js lastResult.heights), quantised to 1e-5 in.
const HEIGHTS = `(async()=>{ const m=await import('./core/state.js'); const h=m.lastResult?.heights; if(!h) return 'none';
  let x=2166136261; for (let i=0;i<h.length;i++){ x^=Math.round(h[i]*1e5); x=Math.imul(x,16777619);} return h.length+'#'+(x>>>0).toString(36); })()`;
const isPending = () => js(`!!document.getElementById('brickGenerate')?.classList.contains('pending')`);
// a rebuild is async: wait until the heightmap hash is stable for 3 polls (and give a change 6s to appear).
// MEASURED (advisor's band-rows gate, 182 rows): "Clumping 0.9 (Suppression 0.5)" read "3D unchanged" under the
// --parallel load while it passed alone on main afdc4c0 AND on the branch (47/47 each): the rebuild started after
// the 6 s window. A row that EXPECTS the 3D to change gives it THREE_D_EXPECTED_CHANGE_MS before calling it unchanged.
const THREE_D_CHANGE_MS = 6000, THREE_D_EXPECTED_CHANGE_MS = 20000;
// advisor follow-up: the rebuild's OWN completion count (core/state.js lastResultGeneration) -- `sinceGen` = the count
// before the action: "unchanged" is only concluded after a rebuild has COMPLETED since then (a build without the
// counter falls back to the time window alone)
const GEN = `import('./core/state.js').then((m) => (typeof m.lastResultGeneration === 'number' ? m.lastResultGeneration : null))`;
// item 37 (seat E): settled also means the app says it is BUILT -- no rebuild running, queued or scheduled
// (core/engine/rebuild.js whenRebuildIdle) and no loading card; equal polls alone read a between-stages surface as final
// (a build without whenRebuildIdle reads as built: the old 3-poll rule)
const BUILT = `import('./core/engine/rebuild.js').then((m) => (typeof m.whenRebuildIdle !== 'function' ? true
  : Promise.race([m.whenRebuildIdle().then(() => true), new Promise((r) => setTimeout(() => r(false), 0))]))
  .then((idle) => idle && (document.getElementById('loading-stage')?.hidden ?? true)))`;
async function heightsSettled(prev, maxMs = 30000, changeMs = THREE_D_CHANGE_MS, sinceGen = null) {
  let last = await js(HEIGHTS), same = 0; const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(700); const h = await js(HEIGHTS);
    const rebuilt = sinceGen == null || ((await js(GEN)) ?? Infinity) > sinceGen;
    if (h === last) { if (++same >= 3 && (h !== prev || (rebuilt && Date.now() - t0 > changeMs)) && (await js(BUILT))) return h; } else { same = 0; last = h; }
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
  // F35 item 43: the tools are tabs (editor/tab-strip.js .ui-tab) at the top of the Brick panel
  const active = await js(`document.querySelector('#editorToolbarBrick .ui-tab.active')?.id || ''`);
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
  // `backTo`: the named earlier row's before-state is where this row must land -- the 3D heights hash exactly, and the
  // canvas's brick count. Not the canvas hash itself: across an Apply the canonical canvas hash changes with nothing
  // re-laid (MEASURED on the rotation rows: 153#p42kdo after the 45 row, 153#16yw2lg as the next row starts), the 3D
  // does not (back to 25521#1ve26cw exactly)
  const back = c.expect.backTo ? rows.find((r) => r.name === c.expect.backTo) : null;
  const count = (h) => String(h).split('#')[0];
  if (c.expect.backTo) v.back = back && back.hashes && count(obs.hashes.c1) === count(back.hashes.c0) && obs.hashes.z1 === back.hashes.z0 ? 'PASS' : 'FAIL';
  const row = { name: c.name, kind: c.kind, tool: c.tool || null, result: obs.result, observed: { pending: obs.pending, canvas: obs.canvas, threeD: obs.threeD, sets: obs.sets, reads: obs.reads }, expect: c.expect, verdict: v, hashes: obs.hashes };
  rows.push(row);
  const fail = Object.values(v).includes('FAIL') || obs.result !== 'ok';  // e.g. 'MISSING' / 'DISABLED' control
  console.log(`${fail ? 'FAIL' : 'pass'}  ${c.name.padEnd(34)} pending ${v.pending.padEnd(4)} canvas ${v.canvas.padEnd(4)} 3D ${v.threeD}${v.set ? ' sets ' + v.set + ' ' + JSON.stringify(obs.sets) : ''}${v.reads ? ' reads ' + v.reads + ' ' + JSON.stringify(obs.reads) : ''}${v.back ? ' back ' + v.back : ''}${obs.result !== 'ok' ? '  (' + obs.result + ')' : ''}`);
  if (fail) await shot(`FAIL_${c.name.replace(/[^a-z0-9]+/gi, '_')}`);
}

try {
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  if (!REAL_CLOUD) await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOUD_STAND_IN.replace('__EDIT_PASSWORD__', EDIT_PASSWORD_TEST.password) });
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const paletteUrl = `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html${REAL_CLOUD ? '?realCloud=1' : ''}`;
  await send('Page.navigate', { url: paletteUrl });
  // item 74k (seat D, measured: "no bricks laid at baseline (none)" was a page whose app NEVER booted -- a refused module
  // request kills the module graph: no editor, the splash up; the old splash check timed out and the lay ran on a dead
  // page, retried blind): the baseline waits for the app's declared ready signal (waitApp: core/state.js
  // bootRestore.complete), then lays ONCE. A page that never boots is a named setup error.
  let boot = await waitApp();
  // the measured cases one retry cures (boot.mjs bootRetry): a module request lost to the machine's own network stack
  // under load (BOOT_RELOAD_ERRORS -- ERR_NO_BUFFER_SPACE: the client ran out of socket buffers, which no server setting
  // prevents) kills the page's module graph for good -> one reload; the palette DOCUMENT cancelled (ERR_ABORTED) leaves
  // the page on about:blank, where a reload reloads about:blank -> one fresh navigate. Then the same declared wait; any
  // other never-booted page is a named setup error.
  const retry = boot.booted ? null : bootRetry(failedRequests);
  if (retry) {
    console.log(`the app never booted (${failedRequests.slice(0, 3).join(', ')}) -- one ${retry}`);
    failedRequests.length = 0;
    await (retry === 'navigate' ? send('Page.navigate', { url: paletteUrl }) : send('Page.reload', {}));
    boot = await waitApp();
  }
  if (!boot.booted) throw new Error(`setup failed: the app never booted (${boot.why}; failed requests: ${failedRequests.slice(0, 4).join(', ') || 'none'})`);
  await openBrickTool('wall');
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  for (const pin of GROUP_SETUP[arg('group')] || []) { // a group's declared setup (its groups/<group>.mjs `setup`), before the baseline lay
    const r = await setValue(pin.set, pin.value, pin.event); console.log(`setup pin ${pin.set}=${pin.value}: ${r} (${pin.why})`); await sleep(1500);
  }
  await click('brickGenerate', 1800);
  await openBrickTool('frame'); await click('brickGenerate', 1800);
  const baseline = await js(CANVAS);
  if (!/^[1-9]/.test(baseline)) throw new Error(`setup failed: no bricks laid at baseline (${baseline})`);
  await apply(); Z = await heightsSettled(null);
  console.log('baseline', baseline, Z, '| requires from:', REQUIRES_SOURCE);

  for (const c of CONTROLS) {
    if (c.introducedBy) {
      if (c.kind === 'stripe') { await openBrickTool('brush'); await click('brickSubTool_brush_stripe', 600); } // item 43: Brush > Stripe
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
      if (c.kind === 'sidebar') await js(`import('./main/sidebar-tabs.js').then((m) => (m.revealSidebarSection('panel-brick'), 1))`);
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
      const reads = c.expect.reads ? (await jsJSON(`JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(c.expect.reads))}.map((id) => [id, Number(document.getElementById(id)?.value)])))`)) : null;
      const readsOk = !!reads && Object.entries(c.expect.reads).every(([id, v]) => Math.abs(reads[id] - v) < 1e-6);
      const setsOk = !!sets && Object.entries(c.expect.sets).every(([k, id]) => sets[k] && sets[k].length === 1 && sets[k][0] === String(id));
      const g0 = await js(GEN);
      await apply();
      const z1 = await heightsSettled(Z, 30000, c.expect.threeD === true ? THREE_D_EXPECTED_CHANGE_MS : THREE_D_CHANGE_MS, g0);
      await record(c, { result, pending: p, canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 }, sets, setsOk, reads, readsOk });
      Z = z1;
    } else if (c.kind === 'relay') {
      // Generate = "re-lay now": take one brick of the tool's kind off the canvas by hand, then Generate must
      // put back exactly the layout the current settings make (canonical canvas hash equal to before) -- or, with
      // expect.newSeed (F35 item 39: Generate rolls a new brick seed), a NEW layout with the removed brick back
      // (the same piece count, a different canvas).
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
      const count = (h) => String(h).split('#')[0];
      const restored = c.expect.newSeed ? count(c1) === count(c0) && c1 !== c0 : c1 === c0;
      const ok = removed && cGap !== c0 && restored;
      rows.push({ name: c.name, kind: c.kind, tool: c.tool, result, observed: { removed, disturbed: cGap !== c0, restored }, expect: c.expect,
        verdict: { pending: 'n/a', canvas: ok ? 'PASS' : 'FAIL', threeD: 'n/a' }, hashes: { c0, cGap, c1 } });
      console.log(`${ok ? 'pass' : 'FAIL'}  ${c.name.padEnd(34)} brick removed ${removed}, ${c.expect.newSeed ? `the count back ${count(c1) === count(c0)}, a new layout ${c1 !== c0}` : `canvas restored ${c1 === c0}`}`);
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
      await click('brickSubTool_brush_stripe', 600); // item 43: Stripe is a Brush sub-tool (no tab of its own)
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
      await js(`import('./main/sidebar-tabs.js').then((m) => (m.revealSidebarSection('panel-brick'), 1))`);
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
      await js(`import('./main/sidebar-tabs.js').then((m) => (m.revealSidebarSection('panel-brick'), 1))`);
      const c0 = await js(CANVAS);
      const result = await act(c.do);
      await sleep(1500);
      const c1 = await js(CANVAS);
      const z1 = await heightsSettled(Z, 30000, c.expect.threeD === true ? THREE_D_EXPECTED_CHANGE_MS : THREE_D_CHANGE_MS);
      await record(c, { result, pending: await isPending(), canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 } });
      Z = z1;
    }
  }
  // each group's own runner (groups/<name>.mjs), after the rows; persistence reloads the page, so it runs LAST (and
  // alone in --parallel's own 'persistence' group) -- groups/index.mjs RUNNER_ORDER
  bindGroups({ sleep, send, js, jsJSON, shot, click, rows, verdict, waitApp, openBrickTab, key, exists, clearFingerprint, seedClearBoard, heightsSettled, editorOpen, apply, checkRow, wallCount, openEditorTab, reloadWithStorage, CANVAS, HERE, record, reloadWithSession, setValue, canvasSettled, drag, ROOT, act, openBrickTool });
  for (const g of RUNNER_ORDER) if (!arg('group') || arg('group') === g) await runGroup(g);
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

// ---------------------------------------------------------------- page helpers shared by several groups (hoisted)
/** Wait for the page's app: { booted, why }. item 37 (seat E): the load's declared end is core/state.js
 *  bootRestore.complete (the boot build landed); a build without it keeps the old 3 s window. item 74k: it says so
 *  when the app never boots (a failed module request leaves no app at all), instead of returning as if it had. */
async function waitApp() {
  for (let i = 0; i < 90; i++) { await sleep(1000); if (await js(`!!document.getElementById('btnStampEdit') && !document.getElementById('app-splash-name')?.offsetParent`).catch(() => false)) break; }
  for (let i = 0; i < 180; i++) {
    const done = await js(`import('./core/state.js').then((m) => (m.bootRestore ? m.bootRestore.complete : null), () => 'import-failed')`).catch(() => false);
    if (done === null) { await sleep(3000); return { booted: true, why: 'no boot signal in this build' }; }
    if (done === true) return { booted: true, why: 'bootRestore.complete' };
    if (done === 'import-failed') return { booted: false, why: 'core/state.js failed to load -- a module request failed' };
    await sleep(500);
  }
  return { booted: false, why: 'bootRestore.complete never set in 90 s' };
}
async function openBrickTab() {
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click('editorTabBrick', 1000);
}
// ---------------------------------------------------------------- clear menu (hoisted; CLEAR_MENU in groups/clear.mjs; clear + layers use these)
// One fingerprint per kind: { empty, hash }. Bricks and art are told apart the app's own way: since F35 item 22 slice 3
// (37, fb-app bb9e664) bricks sit on any layer beside art, and editor/layers.js isBrickToolNode says which nodes are
// the brick tools' (the same test Send and Clear use); a build before slice 3 has no isBrickToolNode and told them
// apart by the Bricks layer (isBricksLayer). A brick's height-grey fill is display only (async after a mask update): dropped.
function clearProbe() { return `(async()=>{ const { P } = await import('./core/state.js'); const L = await import('./editor/layers.js'); const ed = window.svgEditor;
  const bricksLayers = (ed._layers || []).filter(L.isBricksLayer); const ids = new Set(bricksLayers.map((l) => String(l.id)));
  const kids = [...ed._sketchLayer.node.children];
  const onBricks = L.isBrickToolNode ? (n) => L.isBrickToolNode(n) : (n) => ids.has(String(n.getAttribute('data-layer')));
  const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
  // display-state classes are not content: svg-selected, and inactive-layer (slice 3: Clear Artwork changes the
  // active layer, which re-classes the bricks' layer -- measured, the record's attributes otherwise identical)
  const G = await import('./core/bricks/height-grey.js').catch(() => null);
  const greyFill = (n) => n.hasAttribute('data-brick-set') && G && (n.getAttribute('fill') === G.NEUTRAL_BRICK_GREY || String(n.getAttribute('fill') || '').startsWith('url(#brick-height-grey-'));
  const canon = (ns) => ns.map((n) => { const c = greyFill(n) ? n.cloneNode(true) : n; if (c !== n) c.removeAttribute('fill');
    return c.outerHTML.replace(/ ?(svg-selected|inactive-layer)/g, '').replace(/ class=""/g, ''); }).join('|');
  const records = [...ed._sketchLayer.node.querySelectorAll('[data-brick-record]')]; // item 22: hidden <g> records, never art
  const art = kids.filter((n) => !onBricks(n) && !n.hasAttribute('data-brick-record')), gen = [...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"]')];
  return JSON.stringify({
    frame: { empty: P.frame?.templateId == null, hash: h(JSON.stringify(P.frame || null)) },
    artwork: { empty: art.length === 0, hash: art.length + '#' + h(canon(art)) },
    photo: { empty: P.photoImageDataUrl == null && !(P.photoEdits || []).length && P.photoPatternId == null,
      hash: h(String(P.photoImageDataUrl).slice(-300) + JSON.stringify(P.photoEdits || []) + P.photoPatternId) },
    bricks: { empty: gen.length === 0 && records.length === 0, hash: gen.length + '/' + records.length + '#' + h(canon(gen)) } }); })()`; }
async function clearFingerprint() { return (await jsJSON(clearProbe())); }
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
async function wallCount() { return js(`window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="wall"]').length ?? -1`); }
async function openEditorTab(tabId) {
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  await click(tabId, 900);
}

// ---------------------------------------------------------------- migration (hoisted; MIGRATION in groups/migration.mjs)
async function loadFromStandIn(name) {
  await click('btnOpenProjectManager', 2500);
  const r = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')===${JSON.stringify(name)}); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  if (r !== 'loaded') throw new Error(`setup: project "${name}" ${r}`);
}
// ---------------------------------------------------------------- frame corners + per-element accents (hoisted)
// Reload with `key` = `value` in localStorage as the app starts. MEASURED: seeding storage and then reloading a
// DIRTY page loses the seed -- the page saves its own session on the way out, over it. A one-shot script that runs
// at the start of the next document (after that save, before the app reads storage) cannot be overwritten.
async function reloadWithSession(key, value) { return reloadWithStorage({ [key]: value }); }
// The same, for any set of keys: localStorage is exactly `entries` as the next document starts.
async function reloadWithStorage(entries) {
  const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); for (const [k, v] of Object.entries(${JSON.stringify(entries)})) localStorage.setItem(k, v); } catch (e) {}` });
  try { await send('Page.reload', {}); await waitApp(); }
  finally { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier }); }
}
// ---------------------------------------------------------------- wall areas (hoisted; the areas + grout runners live in groups/areas.mjs, groups/grout.mjs)
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
  const at = async ([fx, fy]) => (await jsJSON(`(()=>{ const svg=window.svgEditor._sketchLayer.node.ownerSVGElement; const r=svg.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width*${fx}, y:r.top+r.height*${fy}}); })()`));
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
