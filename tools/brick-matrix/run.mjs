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
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { BRICK_CONTROLS, REQUIRES_SOURCE, PERSIST_BOARD, PEEK_LAYOUT, CLEAR_MENU, LAY_WARNING, SELECT_ELEMENT, MIGRATION, EDIT_PASSWORD_TEST, GROUP_SETUP, BRICK_LAYERS, PATTERN_PARAM_PERSIST, BANDS_NOTE, WALL_AREAS, GENERATE_AFTER_RESTORE } from './controls.mjs';
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
const GROUPS = ['wall', 'frame', 'brush', 'sidebar-quick', 'sidebar-3d', 'layout', 'clear', 'lay', 'select', 'migration', 'frame-ui', 'password', 'layers', 'areas', 'persistence'];

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
  // MEASURED: two gates at once (the advisor's and a seat's) -- one group's served-root check found its port taken
  // and the group never ran. Pick a base whose every group port (DevTools + HTTP) answers nothing; shift by 1000.
  const answers = (port) => fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) }).then(() => true, () => false);
  let base = PORT;
  for (let tries = 0; tries < 5; tries++) {
    const ports = GROUPS.flatMap((_, i) => [base + 10 * (i + 1), base + 10 * (i + 1) + 1]);
    const busy = (await Promise.all(ports.map(answers))).some(Boolean);
    if (!busy) break;
    console.log(`ports ${base + 10}..${base + 10 * GROUPS.length + 1} in use (another run?) -- trying ${base + 1000}`);
    base += 1000;
  }
  const kids = GROUPS.map((g, i) => new Promise(async (resolve) => {
    await sleep(10000 * i); // staggered: N apps booting at once starve each other (measured: 2 of 4 never came up)
    const out = path.join(OUT, g);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--group', g, '--port', String(base + 10 * (i + 1)), '--out', out, '--root', ROOT], { stdio: ['ignore', 'pipe', 'pipe'] });
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
// 30 s, as the server check above: under a 14-group --parallel load the 11th Chrome (frame-ui) missed a 10 s wait
// twice ("no Chrome DevTools endpoint"; alone it is 14/14)
for (let i = 0; i < 150 && !wsUrl; i++) { await sleep(200); try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} }
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
  const SKIP=new Set(['id','class','data-brick-element','data-brick-owner','data-brick-band','data-brick-row','data-brick-piece']); // editor-only, stripped at bake
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
// a rebuild is async: wait until the heightmap hash is stable for 3 polls (and give a change 6s to appear).
// MEASURED (advisor's band-rows gate, 182 rows): "Clumping 0.9 (Suppression 0.5)" read "3D unchanged" under the
// --parallel load while it passed alone on main afdc4c0 AND on the branch (47/47 each): the rebuild started after
// the 6 s window. A row that EXPECTS the 3D to change gives it THREE_D_EXPECTED_CHANGE_MS before calling it unchanged.
const THREE_D_CHANGE_MS = 6000, THREE_D_EXPECTED_CHANGE_MS = 20000;
async function heightsSettled(prev, maxMs = 30000, changeMs = THREE_D_CHANGE_MS) {
  let last = await js(HEIGHTS), same = 0; const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(700); const h = await js(HEIGHTS);
    if (h === last) { if (++same >= 3 && (h !== prev || Date.now() - t0 > changeMs)) return h; } else { same = 0; last = h; }
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
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CLOUD_STAND_IN.replace('__EDIT_PASSWORD__', EDIT_PASSWORD_TEST.password) });
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
    for (const pin of GROUP_SETUP[arg('group')] || []) { // a group's declared setup (controls.mjs GROUP_SETUP), before the baseline lay
      const r = await setValue(pin.set, pin.value, pin.event); console.log(`setup pin ${pin.set}=${pin.value}: ${r} (${pin.why})`); await sleep(1500);
    }
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
      const reads = c.expect.reads ? (await jsJSON(`JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(c.expect.reads))}.map((id) => [id, Number(document.getElementById(id)?.value)])))`)) : null;
      const readsOk = !!reads && Object.entries(c.expect.reads).every(([id, v]) => Math.abs(reads[id] - v) < 1e-6);
      const setsOk = !!sets && Object.entries(c.expect.sets).every(([k, id]) => sets[k] && sets[k].length === 1 && sets[k][0] === String(id));
      await apply();
      const z1 = await heightsSettled(Z, 30000, c.expect.threeD === true ? THREE_D_EXPECTED_CHANGE_MS : THREE_D_CHANGE_MS);
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
      const z1 = await heightsSettled(Z, 30000, c.expect.threeD === true ? THREE_D_EXPECTED_CHANGE_MS : THREE_D_CHANGE_MS);
      await record(c, { result, pending: await isPending(), canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 } });
      Z = z1;
    }
  }
  if (!arg('group') || arg('group') === 'layout') await runLayout();
  if (!arg('group') || arg('group') === 'clear') await runClear();
  if (!arg('group') || arg('group') === 'lay') { await runLayWarnings(); await runBandsNote(); }
  if (!arg('group') || arg('group') === 'select') await runSelect();
  if (!arg('group') || arg('group') === 'migration') await runMigration();
  if (!arg('group') || arg('group') === 'frame-ui') await runFrameUi();
  if (!arg('group') || arg('group') === 'password') await runPassword();
  if (!arg('group') || arg('group') === 'layers') await runBrickLayers();
  if (!arg('group') || arg('group') === 'areas') await runWallAreas();
  // persistence reloads the page, so it always runs LAST (and alone in --parallel's own 'persistence' group)
  if (!arg('group') || arg('group') === 'persistence') { await runPersistence(); await runPatternParamPersist(); }
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
// A pattern's parameter chip survives save + reload, still active (PATTERN_PARAM_PERSIST in controls.mjs).
async function runPatternParamPersist() {
  const W = PATTERN_PARAM_PERSIST, name = 'Persist (reload): pattern chip Octagon L';
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 800);
  if (!(await exists(W.pattern))) { checkRow('persistence', name, false, '', W.introducedBy); return; }
  await click(W.pattern, 2000); await click(W.chip, 2000);
  const before = await js(`!!document.getElementById(${JSON.stringify(W.chip)})?.classList.contains('active')`);
  await apply(); await heightsSettled(null); await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 800);
  const st = await jsJSON(`JSON.stringify({ chip: !!document.getElementById(${JSON.stringify(W.chip)})?.classList.contains('active'), pattern: !!document.getElementById(${JSON.stringify(W.pattern)})?.classList.contains('active') })`);
  checkRow('persistence', name, before && st.chip && st.pattern, `chip active before ${before}; after reload: pattern ${st.pattern ? 'active' : 'NOT active'}, chip ${st.chip ? 'active' : 'NOT active'}`);
  if (await editorOpen()) await apply();
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
      const counts = (await jsJSON(`JSON.stringify(Object.fromEntries(${JSON.stringify(PERSIST_BOARD.bricks.map((b) => b.kind))}.map((k) => [k, window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="' + k + '"]').length || 0])))`));
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
  await js(`(()=>{ localStorage.setItem(${JSON.stringify(EDIT_PASSWORD_TEST.storageKey)}, ${JSON.stringify(EDIT_PASSWORD_TEST.password)}); return 1; })()`); // item 34: saves need it
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input'); if(!i) return 'no prompt'; i.value='brick-matrix-persist'; document.querySelector('.pm-prompt-ok').click(); await new Promise(r=>setTimeout(r,4000)); return 'ok'; })()`);
  const saved = await js(`Object.keys(JSON.parse(localStorage.getItem('brickMatrixCloudStandIn')||'{}'))`);
  console.log('project saved to the stand-in:', JSON.stringify(saved));
  // a fresh app: drop the app's own saved session (keep only the stand-in's store), reload -> defaults. At the next
  // document's start (reloadWithStorage): cleared here, the old page's pagehide saved the session straight back and
  // the load below proved nothing
  const keep = await js(`localStorage.getItem('brickMatrixCloudStandIn')`);
  await reloadWithStorage(keep ? { brickMatrixCloudStandIn: keep } : {});
  console.log('fresh app state:', await js(`(async()=>{ const { P } = await import('./core/state.js'); return JSON.stringify({ setId: P.brickSettings?.setId, frameBandPreset: P.brickSettings?.frameBandPreset }); })()`));
  await click('btnOpenProjectManager', 2500);
  const picked = await js(`(async()=>{ const it=[...document.querySelectorAll('#fmProjectList [data-name]')].find(e=>e.getAttribute('data-name')==='brick-matrix-persist'); if(!it) return 'not listed'; it.click(); await new Promise(r=>setTimeout(r,500)); document.getElementById('fmBtnLoad').click(); await new Promise(r=>setTimeout(r,6000)); return 'loaded'; })()`);
  console.log('project load:', picked);
  await checkPersisted('project load');
  // F35 item 39: Generate refreshes the LOADED project, then a RELOADED session; Apply + reopen keeps the new lay
  await checkGenerateAfterRestore('project load');
  await send('Page.reload', {}); await waitApp();
  await checkGenerateAfterRestore('reload');
}

async function checkGenerateAfterRestore(when) {
  const G = GENERATE_AFTER_RESTORE;
  const name = `Generate refreshes the board after ${when}`;
  if (!(await js(G.marker))) { checkRow('persistence', name, false, '', 'F35 item 39'); return; }
  const wallState = () => jsJSON(`JSON.stringify((()=>{ const ns=[...(window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick=${JSON.stringify(G.kind)}]')||[])];
    return { n: ns.length, seeds: [...new Set(ns.map((e)=>e.getAttribute(${JSON.stringify(G.seedAttr)})))] }; })())`);
  await openEditorTab('editorTabBrick'); await click(G.tool, 900);
  const before = await wallState();
  const c0 = await js(CANVAS);
  await click(G.generate, 1800);
  await canvasSettled(c0);
  const after = await wallState();
  await apply(); await heightsSettled(null);
  await openEditorTab('editorTabBrick');
  const kept = await wallState();
  const fresh = after.seeds.length === 1 && before.seeds.length === 1 && after.seeds[0] !== before.seeds[0];
  // not the piece count: this board's wall is Fieldstone, whose stone count follows the seed (measured 152 -> 142)
  checkRow('persistence', name, before.n > 0 && after.n > 0 && fresh && kept.n === after.n && kept.seeds.join() === after.seeds.join(),
    `wall ${before.n} pieces seed ${before.seeds} -> Generate ${after.n} seed ${after.seeds} -> Apply + reopen ${kept.n} seed ${kept.seeds}`);
  await apply(); await heightsSettled(null);
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
    const r = (await jsJSON(`JSON.stringify((()=>{ const ns=[...(window.svgEditor?._sketchLayer?.node.querySelectorAll('[data-brick="${b.kind}"]') || [])];
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
    r = (await jsJSON(LAYOUT_PROBE(tool)));
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
// One fingerprint per kind: { empty, hash }. Bricks and art are told apart the app's own way: since F35 item 22 slice 3
// (37, fb-app bb9e664) bricks sit on any layer beside art, and editor/layers.js isBrickToolNode says which nodes are
// the brick tools' (the same test Send and Clear use); a build before slice 3 has no isBrickToolNode and told them
// apart by the Bricks layer (isBricksLayer). brickfill-<N> pattern ids are stripped (a counter).
function clearProbe() { return `(async()=>{ const { P } = await import('./core/state.js'); const L = await import('./editor/layers.js'); const ed = window.svgEditor;
  const bricksLayers = (ed._layers || []).filter(L.isBricksLayer); const ids = new Set(bricksLayers.map((l) => String(l.id)));
  const kids = [...ed._sketchLayer.node.children];
  const onBricks = L.isBrickToolNode ? (n) => L.isBrickToolNode(n) : (n) => ids.has(String(n.getAttribute('data-layer')));
  const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
  // display-state classes are not content: svg-selected, and inactive-layer (slice 3: Clear Artwork changes the
  // active layer, which re-classes the bricks' layer -- measured, the record's attributes otherwise identical)
  const canon = (ns) => ns.map((n) => n.outerHTML.replace(/brickfill-[0-9]+/g, '').replace(/ ?(svg-selected|inactive-layer)/g, '').replace(/ class=""/g, '')).join('|');
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
  return (await jsJSON(`JSON.stringify((()=>{ const n=document.getElementById(${JSON.stringify(id)}); if(!n) return { missing: true }; return { shown: n.offsetParent !== null && getComputedStyle(n).display !== 'none', text: (n.textContent||'').trim() }; })())`));
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
  const size = async (id) => { // the Wall tool's brick size, then back to the sidebar
    await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900); await click(id, 2500);
    await apply(); await heightsSettled(null);
    await js(`(()=>{ const h=document.querySelector('.panel-brick > .panel-header'); if (h && h.classList.contains('collapsed')) h.click(); return 1; })()`);
  };
  // 1. bands that cover the board: no wall, both notes say so
  await size(W.tooManySize);
  await click(W.tooMany, 2500);
  const side1 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900); // the Brick panel (and its note) shows once a tool is picked
  const walls1 = await wallCount(), ed1 = await noteState(W.notes.editor);
  const ok1 = walls1 === 0 && side1.shown && ed1.shown && side1.text.includes(W.text) && ed1.text.includes(W.text);
  checkRow('lay', `${W.template}: too many bands -> no wall + notes`, ok1, `wall ${walls1}, sidebar note ${side1.shown ? 'shown' : 'hidden'}, editor note ${ed1.shown ? 'shown' : 'hidden'}${side1.text.includes(W.text) ? '' : ' (text differs: ' + side1.text.slice(0, 60) + ')'}`);
  await apply(); await heightsSettled(null);
  // 2. bands that fit again: the wall comes back, both notes go
  await size(W.fitsSize);
  await click(W.fits, 2500);
  const side2 = await noteState(W.notes.sidebar);
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 900);
  const walls2 = await wallCount(), ed2 = await noteState(W.notes.editor);
  checkRow('lay', `${W.template}: bands fit again -> wall back, notes hidden`, walls2 > 0 && !side2.shown && !ed2.shown,
    `wall ${walls2}, sidebar note ${side2.shown ? 'shown' : 'hidden'}, editor note ${ed2.shown ? 'shown' : 'hidden'}`);
  if (await editorOpen()) { await apply(); await heightsSettled(null); }
}

async function runBandsNote() {
  const W = BANDS_NOTE;
  await reloadWithStorage({}); // the defaults (1.25 in)
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(W.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900); await click('brickGenerate', 2000);
  if (!(await exists(W.note))) { checkRow('lay', `${W.template}: 3-band reduced to fit -> note, wall kept`, false, '', W.introducedBy); return; }
  const read = () => jsJSON(`JSON.stringify({ note: (()=>{ const e=document.getElementById(${JSON.stringify(W.note)}); return e && e.offsetParent!==null ? e.textContent.trim() : null; })(),
    dropped: document.querySelectorAll(${JSON.stringify(W.dropped)}).length,
    disabled: [...document.querySelectorAll('[id^="brickFrameBandPattern_1_"], [id^="brickFrameBandPattern_2_"]')].filter((b)=>!b.disabled).length,
    empty: (()=>{ const e=document.getElementById(${JSON.stringify(W.emptyWarning)}); return !!e && e.offsetParent!==null && getComputedStyle(e).display!=='none'; })() })`);
  await click(W.tooDeep, 2500);
  const a = await read(), wa = await wallCount();
  checkRow('lay', `${W.template}: 3-band reduced to fit -> note, wall kept`, wa > 0 && a.note === W.text && a.dropped === 2 && a.disabled === 0 && !a.empty,
    `wall ${wa}, note ${a.note === null ? 'HIDDEN' : `"${a.note}"`}, ${a.dropped} dropped band rows (${a.disabled} of their buttons still enabled), empty-wall warning ${a.empty ? 'SHOWN' : 'hidden'}`);
  await click(W.fits, 2500);
  const b = await read();
  checkRow('lay', `${W.template}: a stack that fits -> no note, no dropped rows`, b.note === null && b.dropped === 0, `note ${b.note === null ? 'hidden' : `"${b.note}"`}, ${b.dropped} dropped rows`);
  if (await editorOpen()) await apply();
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
  const st = (await jsJSON(`JSON.stringify({ mode: window.svgEditor._currentMode, sel: !!document.getElementById(${JSON.stringify(S.wallSelect)})?.classList.contains('active'), area: (()=>{ const n=document.getElementById(${JSON.stringify(S.wallArea)}); return !!n && n.offsetParent !== null; })() })`));
  const listed = await js(`import('./core/bricks/engine.js').then((m) => m.ENGINE_OPTIONS.includes('wallRegion'))`); // Area is shown iff the engine lists wallRegion (brick-control-requires)
  checkRow('select', 'Wall tool -> element Select', st.mode === S.selectMode && st.sel && st.area === listed, `mode ${st.mode}, Select ${st.sel ? 'active' : 'not active'}, Area ${st.area ? 'SHOWN' : 'hidden'} (wallRegion ${listed ? 'listed' : 'not listed'})`);
  // 2. a real click on a frame brick selects the Frame element: its tool, its label, its outline -- drawing untouched
  const before = await js(CANVAS);
  const at = (await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const n=ns[Math.floor(ns.length/2)]; if(!n) return null; const r=n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2, frames: ns.length }; })())`));
  if (!at) { checkRow('select', 'Click a frame brick -> the Frame element', false, 'no frame brick on the canvas'); return; }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1000);
  const sel = (await jsJSON(`JSON.stringify({ frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active'), label: (document.getElementById(${JSON.stringify(S.frameLabel.id)})?.textContent||'').trim(), outline: (window.svgEditor._brickElementOutline||[]).length })`));
  const after = await js(CANVAS);
  checkRow('select', 'Click a frame brick -> the Frame element', sel.frameTool && sel.label.includes(S.frameLabel.text) && sel.outline === at.frames,
    `frame tool ${sel.frameTool ? 'active' : 'NOT active'}, label "${sel.label}", outline ${sel.outline} of ${at.frames} frame bricks`);
  checkRow('select', 'Selecting adds nothing to the drawing', before === after, before === after ? 'canvas hash unchanged' : `canvas changed ${before} -> ${after}`);
  // 3. Esc once clears the selection (tool stays), Esc twice clears the tool
  await plainKey('Escape');
  const e1 = (await jsJSON(`JSON.stringify({ outline: (window.svgEditor._brickElementOutline||[]).length, frameTool: !!document.getElementById(${JSON.stringify(S.frameTool)})?.classList.contains('active') })`));
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
  const isNeutral = (v, value) => (value === 'empty' ? Array.isArray(v) && v.length === 0
    : value && typeof value === 'object' ? JSON.stringify(v) === JSON.stringify(value)
    : leaves(v).every((x) => x === value));
  for (const [k, value] of Object.entries(neutral)) if (!(k in o) && k in n && isNeutral(n[k], value)) delete n[k];
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
  const old = (await jsJSON(`(()=>{ const body=${JSON.stringify(body)}; const svg=new DOMParser().parseFromString(JSON.parse(body).P.editorSvg, 'image/svg+xml');
    const layers=JSON.parse(svg.documentElement.getAttribute('data-editor-layers')||'[]'); const key=(layers.find((l)=>l.brickLaidKey)||{}).brickLaidKey||null;
    const bricks=[...svg.querySelectorAll('[data-brick="wall"],[data-brick="frame"]')];
    return JSON.stringify({ key, polys: bricks.map((n)=>n.getAttribute('data-brick')+':'+(n.getAttribute('points')||'').trim()).sort().join('|') }); })()`));
  if (!old.key) throw new Error('setup: the migration fixture holds no shared brickLaidKey (not a pre-item-22 board?)');
  // the app restores its last session on load: seed it with the old board, reload -> migrated in place. Seeded at the
  // NEXT document's start (reloadWithSession): seeding here, then reloading, let the old page's pagehide save its own
  // default board over the fixture (37, measured: it only showed once the default brick length moved off 1 in)
  await reloadWithSession(M.sessionKey, body);
  const z1 = await heightsSettled(null);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const a = (await jsJSON(migrationProbe()));
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
  const b = (await jsJSON(migrationProbe()));
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

// ---------------------------------------------------------------- frame corners + per-element accents (hoisted)
// Seat 37: item 33 (fb-app f0e3728, the Frame's Corners row) and per-element accents (ed618f3). Expected values are
// read from the app's OWN declarations in the page (editor-brick-tool.js FRAME_CORNERS / FOLDED_FRAME_PRESETS /
// frameCornerOf, core FRAME_PRESETS) -- never copied numbers.
function frameUiState() {
  return `(async()=>{ const T=await import('./editor/editor-brick-tool.js'); const { P } = await import('./core/state.js'); const L=await import('./core/bricks/library.js');
    const list=document.getElementById('brickFrameCornerList'); const s=P.brickSettings||{};
    const frames=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')];
    return JSON.stringify({ corners: T.FRAME_CORNERS.map((c)=>c.id), folded: T.FOLDED_FRAME_PRESETS,
      ownCorner: T.frameCornerOf(s), preset: s.frameBandPreset, pick: s.frameCorner ?? null,
      presetCorners: Object.fromEntries(Object.entries(L.FRAME_PRESETS).map(([k,b])=>[k,(b[0]&&b[0].cornerStyle)||'mitre'])),
      listShown: !!list && list.offsetParent !== null && getComputedStyle(list).display !== 'none',
      buttons: list ? list.querySelectorAll('[id^="brickFrameCorner_"]').length : 0,
      active: list ? [...list.querySelectorAll('[id^="brickFrameCorner_"].active')].map((b)=>b.id.replace('brickFrameCorner_','')) : [],
      frames: frames.length, flat: frames.filter((n)=>!String(n.getAttribute('fill')||'').startsWith('url(')).length }); })()`;
}
async function frameUiRead() { return jsJSON(frameUiState()); }
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
async function relaid(before) { return (await canvasSettled(before)) !== before; }

async function runFrameUi() {
  await send('Page.reload', {}); await waitApp();
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900);
  if (!(await exists('brickFrameCornerList'))) { checkRow('frame-ui', 'Corners row', false, '', 'f0e3728'); return; }
  await click('brickFramePreset_single_soldier', 2000);
  // 1. Soldier: the row shows every declared corner, the preset's own (Mitre) active
  let st = await frameUiRead();
  checkRow('frame-ui', 'Corners: Soldier shows every corner, its own active', st.listShown && st.buttons === st.corners.length && st.active.length === 1 && st.active[0] === st.presetCorners.single_soldier,
    `shown ${st.listShown}, ${st.buttons}/${st.corners.length} buttons, active ${st.active.join(',')} (preset's own: ${st.presetCorners.single_soldier})`);
  // 2. each other corner re-lays the frame at once and becomes the active one
  for (const id of st.corners.filter((c) => c !== st.presetCorners.single_soldier)) {
    const before = await js(CANVAS);
    await click(`brickFrameCorner_${id}`, 400);
    const moved = await relaid(before);
    const s2 = await frameUiRead();
    checkRow('frame-ui', `Corners: ${id} re-lays the frame at once`, moved && s2.active[0] === id && s2.frames > 0,
      `re-laid ${moved}, active ${s2.active.join(',')}, ${s2.frames} frame bricks${id === 'block' ? `, ${s2.flat} without a texture` : ''}`);
    if (id === 'block') checkRow('frame-ui', 'Corners: quoin blocks wear the frame texture', s2.flat === 0, `${s2.flat} of ${s2.frames} frame bricks drawn flat (quoin-element-set)`);
  }
  // 3. a preset with its own corner: picking it shows that corner; a pick is dropped on a preset change
  const twoBand = Object.entries(st.presetCorners).find(([k, c]) => c !== 'mitre' && !(k in st.folded) && k !== 'none');
  if (twoBand) {
    await click(`brickFramePreset_${twoBand[0]}`, 2000);
    const s3 = await frameUiRead();
    checkRow('frame-ui', `Corners: ${twoBand[0]} shows its own corner`, s3.active[0] === twoBand[1], `active ${s3.active.join(',')}, preset's own ${twoBand[1]}`);
  }
  await click('brickFrameCorner_butt', 1500);
  await click('brickFramePreset_single_soldier', 2000);
  const s4 = await frameUiRead();
  checkRow('frame-ui', 'Corners: a preset change returns to the preset\'s own corner', s4.active[0] === s4.presetCorners.single_soldier && s4.pick === null,
    `after Butt then Soldier: active ${s4.active.join(',')}, pick ${s4.pick}`);
  // 4. no bands, or a rock frame: no corners row
  await click('brickFramePreset_none', 2000);
  const s5 = await frameUiRead();
  checkRow('frame-ui', 'Corners: hidden with no bands', !s5.listShown, `row ${s5.listShown ? 'SHOWN' : 'hidden'}`);
  await click('brickFramePreset_single_soldier', 2000);
  await click('brickFrameBandPattern_0_fieldstone', 2000);
  const s6 = await frameUiRead();
  checkRow('frame-ui', 'Corners: hidden on a rock frame', !s6.listShown, `row ${s6.listShown ? 'SHOWN' : 'hidden'}`);
  // 5. per-element accents (ed618f3): a band's own accent marks only that band; its level moves the relief
  if (await editorOpen()) await apply();
  let Z = await heightsSettled(null);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await click('brickFramePreset_three_band', 2000);
  if (!(await exists('brickAccent_band1_checker'))) { checkRow('frame-ui', 'Accents: band 1', false, '', 'ed618f3'); return; }
  await apply(); Z = await heightsSettled(Z);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await click('brickAccent_band1_checker', 2000);
  const acc = await jsJSON(`JSON.stringify((()=>{ const f=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="frame"]')]; const by=(b)=>f.filter((n)=>n.getAttribute('data-brick-band')===String(b)); return { b1: by(1).filter((n)=>n.getAttribute('data-brick-accent')==='1').length, b1n: by(1).length, b0: by(0).filter((n)=>n.getAttribute('data-brick-accent')==='1').length }; })())`);
  await apply(); const Z1 = await heightsSettled(Z);
  checkRow('frame-ui', 'Accents: band 1 checker marks band 1 only, 3D moves', acc.b1 > 0 && acc.b0 === 0 && Z1 !== Z, `band 1 outlined ${acc.b1}/${acc.b1n}, band 0 outlined ${acc.b0}, 3D ${Z1 !== Z ? 'changed' : 'UNCHANGED'}`);
  await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
  await setValue('brickAccentLevel_band1', -0.0625, 'change'); await sleep(1500);
  await apply(); const Z2 = await heightsSettled(Z1);
  checkRow('frame-ui', 'Accents: band 1 level -1/16 moves the relief', Z2 !== Z1, `3D ${Z2 !== Z1 ? 'changed' : 'UNCHANGED'}`);
  // 6. the brush's own accent outlines its bricks
  await openEditorTab('editorTabBrick'); await click('brickTool_brush', 900);
  if (await exists('brickAccent_brush_checker')) {
    await click('brickAccent_brush_checker', 800);
    await click('brickTool_brush', 300); await drag([[0.3, 0.5], [0.5, 0.55], [0.7, 0.5]]);
    const br = await jsJSON(`JSON.stringify((()=>{ const b=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="brush"]')]; return { n: b.length, marked: b.filter((n)=>n.getAttribute('data-brick-accent')==='1').length }; })())`);
    checkRow('frame-ui', 'Accents: brush checker outlines brush bricks', br.n > 0 && br.marked > 0, `${br.marked}/${br.n} brush bricks outlined`);
  }
  if (await editorOpen()) await apply();
  // 7. a board saved on a retired corner preset (butt_frame / quoin_corners) restores as its folded preset + corner:
  //    the migration fixture's own session with its preset rewritten, one per FOLDED_FRAME_PRESETS entry
  const folded = await jsJSON(`(async()=>{ const T=await import('./editor/editor-brick-tool.js'); return JSON.stringify(T.FOLDED_FRAME_PRESETS); })()`);
  const session = JSON.parse(readFileSync(path.join(HERE, MIGRATION.fixture), 'utf8'));
  for (const [old, want] of Object.entries(folded)) {
    session.P.brickSettings.frameBandPreset = old;
    await reloadWithSession(MIGRATION.sessionKey, JSON.stringify(session));
    await openEditorTab('editorTabBrick'); await click('brickTool_frame', 900);
    const st = await frameUiRead();
    checkRow('frame-ui', `Corners: a board saved on ${old} restores as ${want.preset} + ${want.corner}`, st.preset === want.preset && st.ownCorner === want.corner && st.active[0] === want.corner,
      `preset ${st.preset}, corner ${st.ownCorner}, active ${st.active.join(',')}`);
    if (await editorOpen()) await apply();
  }
}

// ---------------------------------------------------------------- the password to save (hoisted; EDIT_PASSWORD_TEST)
async function standInNames() { return jsJSON(`JSON.stringify(Object.keys(JSON.parse(localStorage.getItem('brickMatrixCloudStandIn')||'{}')))`); }
async function cachedPassword() { return js(`localStorage.getItem(${JSON.stringify(EDIT_PASSWORD_TEST.storageKey)})`); }
// Save As `name`; answer every password prompt with the next of `answers`. Returns the titles the app asked with.
async function saveAsAnswering(name, answers) {
  await click('btnOpenProjectManager', 1500);
  await click('fmBtnSaveAs', 1200);
  await js(`(async()=>{ const i=document.querySelector('.pm-prompt-input:not([type=password])'); if(!i) return 0; i.value=${JSON.stringify(name)}; i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-ok').click(); return 1; })()`);
  const asked = [];
  for (let k = 0; k < 6; k++) {
    await sleep(800);
    const title = await js(`(()=>{ const i=document.querySelector('.pm-prompt-overlay input[type=password]'); return i ? i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-title').textContent.trim() : null; })()`);
    if (!title) continue;
    asked.push(title);
    const answer = answers[asked.length - 1] ?? '';
    await js(`(()=>{ const i=document.querySelector('.pm-prompt-overlay input[type=password]'); i.value=${JSON.stringify(answer)}; i.closest('.pm-prompt-overlay').querySelector('.pm-prompt-ok').click(); return 1; })()`);
  }
  await sleep(1500);
  await js(`(()=>{ document.querySelectorAll('.pm-prompt-overlay .pm-prompt-cancel').forEach((b)=>b.click()); return 1; })()`);
  return asked;
}
async function runPassword() {
  const W = EDIT_PASSWORD_TEST;
  await send('Page.reload', {}); await waitApp();
  if (!(await exists('editPasswordStatus'))) { checkRow('password', 'Password to save', false, '', W.introducedBy); return; }
  if (await editorOpen()) await apply();
  // 1. no cached password: Save As asks once, the write is accepted, the password is cached
  await js(`(()=>{ localStorage.removeItem(${JSON.stringify(W.storageKey)}); return 1; })()`);
  let asked = await saveAsAnswering('brick-matrix-pw-1', [W.password]);
  let names = await standInNames();
  checkRow('password', 'First save asks once, saves, caches it', asked.length === 1 && asked[0] === W.askTitle && names.includes('brick-matrix-pw-1') && (await cachedPassword()) === W.password,
    `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-1')}, cached ${(await cachedPassword()) === W.password}`);
  // 2. cached: no prompt at all
  asked = await saveAsAnswering('brick-matrix-pw-2', []);
  names = await standInNames();
  checkRow('password', 'Next save: no prompt', asked.length === 0 && names.includes('brick-matrix-pw-2'), `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-2')}`);
  // 3. a wrong cached password: 401 -> re-asked with the retry title -> the right one -> saved and cached
  await js(`(()=>{ localStorage.setItem(${JSON.stringify(W.storageKey)}, 'not-the-password'); return 1; })()`);
  asked = await saveAsAnswering('brick-matrix-pw-3', [W.password]);
  names = await standInNames();
  checkRow('password', 'Wrong password: re-asked, then saved', asked.length === 1 && asked[0] === W.retryTitle && names.includes('brick-matrix-pw-3') && (await cachedPassword()) === W.password,
    `asked ${JSON.stringify(asked)}, saved ${names.includes('brick-matrix-pw-3')}, cached ${(await cachedPassword()) === W.password}`);
  // 4. Settings: the status says so; Clear forgets it
  const st1 = await js(`(document.getElementById('editPasswordStatus')?.textContent||'').trim()`);
  await js(`(()=>{ document.getElementById('editPasswordClear')?.click(); return 1; })()`); await sleep(500);
  const st2 = await js(`(document.getElementById('editPasswordStatus')?.textContent||'').trim()`);
  checkRow('password', 'Settings: status, then Clear forgets it', st1 === W.statusSaved && st2.startsWith(W.statusUnsetStarts) && !(await cachedPassword()),
    `before "${st1}", after Clear "${st2.slice(0, 40)}", cached ${!!(await cachedPassword())}`);
}

// ---------------------------------------------------------------- bricks on layers (hoisted; BRICK_LAYERS in controls.mjs)
// F35 item 22 slice 3 (37, fb-app bb9e664): Wall / Frame / Brush land on the ACTIVE layer beside art; a fresh board
// gets no Bricks layer. Read the app's own contract: brick nodes = layers.js isBrickToolNode, never a layer's name.
function layersState() {
  return `(async()=>{ const L = await import('./editor/layers.js'); const ed = window.svgEditor; const n = ed._sketchLayer.node;
    const all = (sel) => [...n.querySelectorAll(sel)];
    const ids = (sel) => [...new Set(all(sel).map((e) => String(e.getAttribute('data-layer'))))];
    const h = (str) => { let x = 5381; for (let i = 0; i < str.length; i++) x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; return x.toString(36); };
    const polys = (sel) => h(all(sel).map((e) => e.getAttribute('points') || e.getAttribute('d') || '').sort().join('|'));
    const art = [...n.children].filter((e) => !L.isBrickToolNode(e) && !e.hasAttribute('data-brick-record'));
    return JSON.stringify({ active: String(ed._activeLayer), layers: (ed._layers || []).map((l) => ({ id: String(l.id), name: l.name, carve: l.carve !== false, holdsBricks: !!l.holdsBricks })),
      wall: ids('[data-brick="wall"]'), wallN: all('[data-brick="wall"]').length, wallPolys: polys('[data-brick="wall"]'),
      frame: ids('[data-brick="frame"]'), frameN: all('[data-brick="frame"]').length,
      record: ids('[data-brick-record="wall-full"]'),
      brush: ids('[data-brick="brush"]'), brushN: all('[data-brick="brush"]').length, spine: ids('[data-brick="brush-spine"]'),
      artN: art.length, artLayers: [...new Set(art.map((e) => String(e.getAttribute('data-layer'))))],
      undo: (ed._history || ed._undoStack || []).length }); })()`;
}
async function layersRead() {
  // the editor must exist before the probe reads it (under --parallel load a reload can leave it booting: measured on the
  // grey-sets gate, "Cannot read properties of undefined (reading '_sketchLayer')", 8 of 10 rows reported)
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  return jsJSON(layersState());
}
// The context menu acts on the SELECTION (editor-context-menu.js bindContextMenu): pick the brick with the Artwork
// Select tool, then right-click it.
async function rightClickBrick(kind) {
  await click(BRICK_LAYERS.artworkTab, 800); await click(BRICK_LAYERS.selectTool, 500);
  const at = await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="${kind}"]')];
    for (const n of ns) { const r=n.getBoundingClientRect(); const x=r.left+r.width/2, y=r.top+r.height/2; if (document.elementFromPoint(x,y)===n) return {x,y}; } return null; })())`);
  if (!at) return false;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(500);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x, y: at.y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'right', buttons: 2, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'right', buttons: 0, clickCount: 1 });
  await sleep(700);
  return true;
}
async function menuRow(label) {
  return js(`(()=>{ const b=[...document.querySelectorAll('.context-menu-popover .context-menu-row')].find((r)=>(r.querySelector('.context-menu-row-label')?.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return 'missing'; b.click(); return 'ok'; })()`);
}
async function layerButton(layerId, cls) {
  await click(BRICK_LAYERS.artworkTab, 600); // the layer list
  return js(`(()=>{ const rs=[...document.querySelectorAll('.layer-row[data-layer-id="${layerId}"]')]; const r=rs.find((e)=>e.offsetParent!==null)||rs[0]; if(!r) return 'no row'; const b=${cls ? `r.querySelector(${JSON.stringify(cls)})` : 'r'}; if(!b) return 'no button'; b.click(); return 'ok'; })()`);
}

async function runBrickLayers() {
  const B = BRICK_LAYERS;
  await reloadWithStorage({}); // a FRESH board (no saved session): slice 3's contract is about new boards
  await openEditorTab('editorTabBrick');
  // slice 3's own marker: layers.js isBrickToolNode (a build before it has the layer UI but a Bricks layer)
  if (!(await js(`import('./editor/layers.js').then((L) => !!L.isBrickToolNode)`))) { checkRow('layers', 'Fresh board: bricks on the active layer', false, '', B.introducedBy); return; }
  const s0 = await layersRead();
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 800); await click('brickGenerate', 2000);
  // 1. a fresh board: Wall + Frame land on the active layer, no layer is added
  const s1 = await layersRead();
  checkRow('layers', 'Fresh board: Wall + Frame on the active layer, no new layer',
    s1.wallN > 0 && s1.frameN > 0 && s1.wall.length === 1 && s1.wall[0] === s1.active && s1.frame.length === 1 && s1.frame[0] === s1.active && s1.layers.length === s0.layers.length && !s1.layers.some((l) => l.holdsBricks),
    `active ${s1.active}; wall on ${s1.wall}, frame on ${s1.frame}; layers ${s0.layers.length} -> ${s1.layers.length}${s1.layers.some((l) => l.holdsBricks) ? ', a holdsBricks layer' : ''}`);
  // 2. Move to layer -> New layer...: the whole wall + its record move, the frame stays; one undo step brings it back
  let moved = false, detail = '';
  if (await rightClickBrick('wall')) {
    const a = await menuRow(B.menuMove); await sleep(500);
    const b = await menuRow(B.menuNewLayer); await sleep(1500);
    detail = `menu: ${a}/${b}`;
    moved = a === 'ok' && b === 'ok';
  } else detail = 'no wall brick under the pointer';
  const s2 = await layersRead();
  const newLayer = s2.layers.find((l) => !s1.layers.some((o) => o.id === l.id));
  const movedOk = moved && !!newLayer && s2.wall.length === 1 && s2.wall[0] === newLayer.id && s2.record.length === 1 && s2.record[0] === newLayer.id && s2.frame.join() === s1.frame.join() && s2.wallN === s1.wallN;
  checkRow('layers', 'Move to layer -> New layer: the wall + its record move, the frame stays',
    movedOk, `${detail}; new layer ${newLayer ? newLayer.id : 'NONE'}; wall on ${s2.wall} (${s2.wallN}), record on ${s2.record}, frame on ${s2.frame}`);
  if (movedOk) {
    await key('z'); await sleep(1200);
    const su = await layersRead();
    checkRow('layers', 'Move to layer: one undo puts the wall back', su.wall.join() === s1.wall.join() && su.record.join() === s1.wall.join(),
      `after one undo: wall on ${su.wall}, record on ${su.record}`);
    await key('y'); await sleep(1200); // redo: the wall on its new layer again, for the rows below
    const sr = await layersRead();
    if (sr.wall.join() !== s2.wall.join()) { await rightClickBrick('wall'); await menuRow(B.menuMove); await sleep(400); await menuRow(newLayer.name); await sleep(1500); }
  }
  await openEditorTab('editorTabBrick');
  // 3. a frame change re-lays the wall ON its new layer
  const s3a = await layersRead();
  await click('brickTool_frame', 800); await click(B.framePreset, 2500);
  const s3 = await layersRead();
  checkRow('layers', 'A frame change re-lays the wall on its own layer', s3.wallPolys !== s3a.wallPolys && s3.wall.join() === s3a.wall.join() && s3.wallN > 0,
    `wall re-laid ${s3.wallPolys !== s3a.wallPolys}, on ${s3a.wall} -> ${s3.wall}`);
  // 4. that layer's carve off moves the 3D; on again -> the 3D exactly as before
  const wallLayer = s3.wall[0];
  await apply(); const Z0 = await heightsSettled(null);
  await openEditorTab('editorTabBrick');
  const c1 = await layerButton(wallLayer, B.carveButton); await apply(); const Z1 = await heightsSettled(Z0);
  await openEditorTab('editorTabBrick');
  const c2 = await layerButton(wallLayer, B.carveButton); await apply(); const Z2 = await heightsSettled(Z1);
  checkRow('layers', 'The wall layer carve off -> 3D changes; on -> 3D identical', c1 === 'ok' && c2 === 'ok' && Z1 !== Z0 && Z2 === Z0,
    `carve toggles ${c1}/${c2}; 3D ${Z0} -> off ${Z1} -> on ${Z2}`);
  // 5. save + reload: the same layer per kind, carve kept, nothing re-laid
  await openEditorTab('editorTabBrick');
  await layerButton(wallLayer, B.carveButton); // carve OFF for the round trip
  await apply(); await heightsSettled(null);
  const s5a = await layersRead();
  await sleep(1500);
  await send('Page.reload', {}); await waitApp();
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const s5 = await layersRead();
  const carveOf = (s, id) => (s.layers.find((l) => l.id === id) || {}).carve;
  checkRow('layers', 'Save + reload: layers per kind, carve, nothing re-laid',
    s5.wall.join() === s5a.wall.join() && s5.frame.join() === s5a.frame.join() && carveOf(s5, wallLayer) === false && s5.wallPolys === s5a.wallPolys,
    `wall ${s5a.wall} -> ${s5.wall}, frame ${s5a.frame} -> ${s5.frame}, wall-layer carve ${carveOf(s5, wallLayer)}, wall ${s5.wallPolys === s5a.wallPolys ? 'identical' : 'RE-LAID'}`);
  await layerButton(wallLayer, B.carveButton); await apply(); await heightsSettled(null); // carve back on
  // 6. Clear -> Bricks takes every brick and leaves the art on the same layer; Clear -> Artwork leaves a brick layer
  for (const o of B.clears) {
    await reloadWithStorage({}); // the defaults, not the rows above's frame preset
    const f0 = await seedClearBoard();
    const sa = await layersRead();
    await click(o.tab, 800); await click(CLEAR_MENU.button, 600); await click(o.item, 1500); await sleep(2500);
    const sb = await layersRead();
    if (o.item === 'editorClear_bricks') {
      const shared = sa.artLayers.some((id) => sa.wall.includes(id));
      checkRow('layers', 'Clear Bricks: every brick goes, the art on its layer stays', shared && sa.wallN > 0 && sb.wallN === 0 && sb.frameN === 0 && sb.brushN === 0 && sb.artN === sa.artN,
        `art on ${sa.artLayers}, wall on ${sa.wall} (shared ${shared}); bricks ${sa.wallN + sa.frameN} -> ${sb.wallN + sb.frameN + sb.brushN}; art ${sa.artN} -> ${sb.artN}`);
    } else {
      const kept = sa.wall.every((id) => sb.layers.some((l) => l.id === id));
      checkRow('layers', 'Clear Artwork: a layer holding bricks stays, with its bricks', kept && sa.wallN > 0 && sb.wallN === sa.wallN && sb.wall.join() === sa.wall.join() && sb.artN === 0,
        `wall layer kept ${kept}; wall ${sa.wallN} -> ${sb.wallN} on ${sb.wall}; art ${sa.artN} -> ${sb.artN}`);
    }
    void f0;
  }
  // 7. a Brush stroke with Layer 2 active: spine + bricks on Layer 2; moving one brick moves the spine and every piece
  await reloadWithStorage({});
  await openEditorTab('editorTabBrick');
  await click(B.addLayer, 900);
  const s7a = await layersRead();
  const layer2 = s7a.active;
  await click('brickTool_brush', 900);
  await drag(B.stroke); await sleep(1500);
  const s7 = await layersRead();
  checkRow('layers', 'A Brush stroke goes on the active layer (Layer 2), spine and bricks',
    s7.brushN > 0 && s7.brush.length === 1 && s7.brush[0] === layer2 && s7.spine.length === 1 && s7.spine[0] === layer2 && s7a.layers.length >= 2,
    `active ${layer2} of ${s7a.layers.length} layers; bricks (${s7.brushN}) on ${s7.brush}, spine on ${s7.spine}`);
  const layer1 = s7a.layers.find((l) => l.id !== layer2);
  let m7 = 'no brush piece under the pointer';
  if (layer1 && await rightClickBrick('brush')) { const a = await menuRow(B.menuMove); await sleep(400); const b = await menuRow(layer1.name); await sleep(1500); m7 = `menu ${a}/${b}`; }
  const s7b = await layersRead();
  checkRow('layers', 'Move one brush piece to Layer 1: its spine and every piece follow',
    !!layer1 && s7b.brushN === s7.brushN && s7b.brush.join() === layer1.id && s7b.spine.join() === layer1.id,
    `${m7}; bricks (${s7b.brushN}) on ${s7b.brush}, spine on ${s7b.spine} (Layer 1 = ${layer1 ? layer1.id : 'none'})`);
  if (await editorOpen()) await apply();
  // 8. F35 item 40: the Brick tab shows the layers (hosted in its panel) with the Wall tool picked; a row picked there
  // is where the lay goes; Artwork gets the ONE list back
  const T = B.brickTab;
  if (!(await exists(T.slot)) && !(await js(`fetch('./bspline_gen_palette.html').then(r=>r.text()).then(t=>t.includes('id="${T.slot}"'))`))) {
    checkRow('layers', 'Brick tab: the layers show with a tool, a picked row takes the lay', false, '', 'F35 item 40'); return;
  }
  await reloadWithStorage({});
  await openEditorTab(B.artworkTab); await click(B.addLayer, 900);
  await openEditorTab('editorTabBrick'); await click(T.wallTool, 900);
  const vis = await jsJSON(`JSON.stringify((()=>{ const l=document.getElementById(${JSON.stringify(T.list)}); const slot=document.getElementById(${JSON.stringify(T.slot)});
    const rows=[...l.querySelectorAll('[data-layer-id]')]; const r=l.getBoundingClientRect();
    return { hosted: !!slot && slot.contains(l), shown: l.offsetParent !== null && r.height > 0, rows: rows.map((e)=>e.getAttribute('data-layer-id')), active: String(window.svgEditor._activeLayer) }; })())`);
  const pick = vis.rows.find((id) => id !== vis.active);
  if (pick) { await js(`document.querySelector('#${T.list} [data-layer-id="${pick}"]').click()`); await sleep(600); }
  await click(T.generate, 2000);
  const on = await jsJSON(`JSON.stringify([...new Set([...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].map((n)=>n.getAttribute('data-layer')))])`);
  await openEditorTab(B.artworkTab);
  const home = await js(`!document.getElementById(${JSON.stringify(T.slot)}).contains(document.getElementById(${JSON.stringify(T.list)})) && !!document.getElementById(${JSON.stringify(T.list)}).offsetParent`);
  checkRow('layers', 'Brick tab: the layers show with a tool, a picked row takes the lay',
    vis.hosted && vis.shown && vis.rows.length >= 2 && !!pick && on.length === 1 && on[0] === pick && home,
    `hosted ${vis.hosted}, shown ${vis.shown}, rows ${vis.rows.length}; picked ${pick}: wall on ${on}; Artwork has the list back ${home}`);
  if (await editorOpen()) await apply();
}

// ---------------------------------------------------------------- wall areas (hoisted; WALL_AREAS in controls.mjs)
// F35 item 22 slice 2 (37, fb-app 58be3ed) on T86 18b/18c: the Area brush paints wall areas of COMPLETE bricks,
// newest first (an older area drops the bricks that would touch a newer one). The sketch layer's units are board
// inches (the brush's own stroke width is widthIn), so a board point maps to the screen by the layer's own CTM.
async function dragIn(ptsIn) {
  const ps = await jsJSON(`JSON.stringify((()=>{ const m=window.svgEditor._sketchLayer.node.getScreenCTM(); return ${JSON.stringify(ptsIn)}.map(([x,y])=>({ x: m.a*x + m.c*y + m.e, y: m.b*x + m.d*y + m.f })); })())`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[0].x, y: ps[0].y, button: 'none', buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ps[0].x, y: ps[0].y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i < ps.length; i++) for (let k = 1; k <= 12; k++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ps[i - 1].x + (ps[i].x - ps[i - 1].x) * k / 12, y: ps[i - 1].y + (ps[i].y - ps[i - 1].y) * k / 12, button: 'left', buttons: 1 });
    await sleep(15);
  }
  const z = ps[ps.length - 1];
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: z.x, y: z.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2500);
}
/** the areas (records in order) and their bricks, in board inches */
function areasState() {
  return `JSON.stringify((()=>{ const n=window.svgEditor._sketchLayer.node;
    const poly=(e)=>(e.getAttribute('points')||'').trim().split(/\\s+/).map((p)=>p.split(',').map(Number)).map(([x,y])=>({x,y}));
    const recs=[...n.querySelectorAll('[data-brick-record="wall-area"]')].map((r)=>r.getAttribute('data-brick-element'));
    const owned=(id)=>[...n.querySelectorAll('[data-brick="wall"]')].filter((e)=>e.getAttribute('data-brick-owner')===id).map(poly);
    return { areas: recs, full: n.querySelectorAll('[data-brick-record="wall-full"]').length, wall: n.querySelectorAll('[data-brick="wall"]').length,
      bricks: Object.fromEntries(recs.map((id)=>[id, owned(id)])), frame: [...n.querySelectorAll('[data-brick="frame"]')].map(poly) }; })())`;
}
async function overlapPairs(a, b, tol) {
  const G = await import(pathToFileURL(path.join(ROOT, 'b-spline-gen/html/core/bricks/geometry.js')).href);
  let pairs = 0;
  for (const p of a) for (const q of b) if (Math.abs(G.signedArea(G.polygonIntersection(p, q))) > tol) pairs++;
  return pairs;
}

async function runWallAreas() {
  const A = WALL_AREAS;
  await reloadWithStorage({});
  await openEditorTab('editorTabFrame');
  await js(`(async()=>{ const s=document.getElementById('editorFrameTemplate'); if(!s) return 0; s.value=${JSON.stringify(A.template)}; s.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,2000)); return 1; })()`);
  await openEditorTab('editorTabBrick');
  await click('brickTool_wall', 800); await click('brickGenerate', 2000);
  await click('brickTool_frame', 900); await click('brickGenerate', 2000);
  await click('brickTool_wall', 900);
  // slice 2's own marker (the Area brush handler): main already carries the hidden Area button, so its presence is no guard
  if (!(await js(`import('./editor/editor-brick-tool.js').then((m) => !!m.brickWallAreaHandler)`))) { checkRow('areas', 'Area paints a wall of whole bricks', false, '', A.introducedBy); return; }
  const wall0 = await wallCount(), canvas0 = await js(CANVAS);
  const paint = async (pattern, width, stroke) => {
    await click('brickTool_wall', 700); // a tool pick clears the element selection: the next stroke starts a NEW area
    await click(pattern, 1500); await click(A.areaTool, 700); await click(width, 500);
    await dragIn(stroke);
    return jsJSON(areasState());
  };
  // 1. a stroke paints a wall area: one area record, the full wall's record gone, the area's own bricks
  const s1 = await paint(A.strokes[0].pattern, A.strokes[0].width, A.strokes[0].points);
  const a = s1.areas[0];
  checkRow('areas', 'Area paints a wall (one area, no full wall)', s1.areas.length === 1 && s1.full === 0 && (s1.bricks[a] || []).length > 0,
    `${s1.areas.length} area(s), full-wall records ${s1.full}, area bricks ${(s1.bricks[a] || []).length}`);
  // 2. a newer area with another pattern: the older one keeps whole bricks around it, no pair overlaps
  const s2 = await paint(A.strokes[1].pattern, A.strokes[1].width, A.strokes[1].points);
  const b = s2.areas.find((id) => id !== a);
  const ov = b ? await overlapPairs(s2.bricks[a] || [], s2.bricks[b] || [], 1e-4) : -1;
  checkRow('areas', 'Newest wins: the older area flows round, no overlap', s2.areas.length === 2 && !!b && ov === 0 && (s2.bricks[a] || []).length > 0 && (s2.bricks[b] || []).length > 0,
    `${s2.areas.length} areas; older ${(s2.bricks[a] || []).length} bricks, newer ${b ? (s2.bricks[b] || []).length : 0}; overlapping pairs ${ov}`);
  // 3. one undo step per stroke
  await key('z'); await sleep(1500);
  const u = await jsJSON(areasState());
  await key('y'); await sleep(1500);
  const r = await jsJSON(areasState());
  checkRow('areas', 'Undo / Redo: one step per stroke', u.areas.length === 1 && r.areas.length === 2, `after undo ${u.areas.length} area(s), after redo ${r.areas.length}`);
  // 4. an area across the frame band: its bricks stop at the band
  const s4 = await paint(A.strokes[2].pattern, A.strokes[2].width, A.strokes[2].points);
  const c = s4.areas.find((id) => !s2.areas.includes(id));
  const onBand = c ? await overlapPairs(s4.bricks[c] || [], s4.frame, 1e-3) : -1;
  checkRow('areas', 'An area across the band stops at the band', !!c && (s4.bricks[c] || []).length > 0 && onBand === 0,
    `area ${c ? 'painted' : 'MISSING'}, ${(c && s4.bricks[c] || []).length} bricks, ${onBand} on a frame brick`);
  // 5. Select on an area brings its own settings back
  await click('brickTool_wall', 700); await click(A.selectTool, 700);
  const at = await jsJSON(`JSON.stringify((()=>{ const ns=[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-brick="wall"]')].filter((e)=>e.getAttribute('data-brick-owner')===${JSON.stringify(a)});
    for (const n of ns) { const q=n.getBoundingClientRect(); const x=q.left+q.width/2, y=q.top+q.height/2; if (document.elementFromPoint(x,y)===n) return {x,y}; } return null; })())`);
  if (at) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(1200);
  }
  const sel = await jsJSON(`JSON.stringify({ pattern: !!document.getElementById(${JSON.stringify(A.strokes[0].pattern)})?.classList.contains('active'), label: (document.getElementById(${JSON.stringify(A.wallLabel.id)})?.textContent||'').trim() })`);
  checkRow('areas', 'Select an area: its own pattern, "Editing: this Wall"', !!at && sel.pattern && sel.label.includes(A.wallLabel.text), `${at ? '' : 'no brick of the first area under the pointer; '}pattern active ${sel.pattern}, label "${sel.label}"`);
  // 6. Apply + reopen: the areas persist
  await apply(); await heightsSettled(null);
  const saved = await js(`import('./core/state.js').then(({ P }) => (String(P.editorSvg || '').match(/data-brick-record="wall-area"/g) || []).length)`);
  if (!(await editorOpen())) await click('btnStampEdit', 2500);
  for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000);
  const re = await jsJSON(areasState());
  checkRow('areas', 'Apply + reopen: the areas persist', saved === 3 && re.areas.length === 3, `saved ${saved} area records, reopened ${re.areas.length}`);
  // 7. Clear areas: the full wall back, exactly the baseline
  await openEditorTab('editorTabBrick'); await click('brickTool_wall', 700);
  await click(A.strokes[0].pattern, 1500); await click(A.areaTool, 700); await click(A.clearAreas, 2500);
  const cl = await jsJSON(areasState()), canvas1 = await canvasSettled(null);
  checkRow('areas', 'Clear areas: the full wall back (the baseline)', cl.areas.length === 0 && cl.full === 1 && cl.wall === wall0 && canvas1 === canvas0,
    `${cl.areas.length} areas, full-wall records ${cl.full}, wall ${cl.wall}/${wall0}, canvas ${canvas1 === canvas0 ? 'identical' : canvas1 + ' vs ' + canvas0}`);
  // 8. Clear > Bricks removes the areas
  await paint(A.strokes[0].pattern, A.strokes[0].width, A.strokes[0].points);
  const before = await jsJSON(areasState());
  await click('editorTabBrick', 600); await click(CLEAR_MENU.button, 600); await click('editorClear_bricks', 2000);
  const after = await jsJSON(areasState());
  checkRow('areas', 'Clear > Bricks removes the areas', before.areas.length === 1 && after.areas.length === 0, `areas ${before.areas.length} -> ${after.areas.length}`);
  if (await editorOpen()) await apply();
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
