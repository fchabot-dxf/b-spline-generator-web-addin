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
import { BRICK_CONTROLS, REQUIRES_SOURCE, PEEK_LAYOUT } from './controls.mjs';
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
const GROUPS = ['wall', 'frame', 'brush', 'sidebar-quick', 'sidebar-3d', 'layout'];
const groupOf = (c) => (c.kind === 'opens' ? 'sidebar-quick' : c.kind === 'sidebar' ? (c.do.click?.startsWith('brickQuick_') ? 'sidebar-quick' : 'sidebar-3d')
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
const server = spawn('python', ['-m', 'http.server', String(HTTP), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const stop = () => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} };
const dropProfile = () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} };
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
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
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
  const row = { name: c.name, kind: c.kind, tool: c.tool || null, result: obs.result, observed: { pending: obs.pending, canvas: obs.canvas, threeD: obs.threeD }, expect: c.expect, verdict: v, hashes: obs.hashes };
  rows.push(row);
  const fail = Object.values(v).includes('FAIL') || obs.result !== 'ok';  // e.g. 'MISSING' / 'DISABLED' control
  console.log(`${fail ? 'FAIL' : 'pass'}  ${c.name.padEnd(34)} pending ${v.pending.padEnd(4)} canvas ${v.canvas.padEnd(4)} 3D ${v.threeD}${obs.result !== 'ok' ? '  (' + obs.result + ')' : ''}`);
  if (fail) await shot(`FAIL_${c.name.replace(/[^a-z0-9]+/gi, '_')}`);
}

try {
  await send('Runtime.enable'); await send('Page.enable');
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
      if (c.kind === 'editor' && await js(`!!document.getElementById('brickGenerate')?.offsetParent`)) await click('brickGenerate', 1800);
      const c1 = await js(CANVAS);
      await apply();
      const z1 = await heightsSettled(Z);
      await record(c, { result, pending: p, canvas: c0 !== c1, threeD: z1 !== Z, hashes: { c0, c1, z0: Z, z1 } });
      Z = z1;
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
      rows.push({ name: c.name, kind: c.kind, result, observed: { opened, tab }, expect: c.expect, verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', opens: v.opened === 'PASS' && v.tab === 'PASS' ? 'PASS' : 'FAIL' } });
      console.log(`${v.opened === 'PASS' && v.tab === 'PASS' ? 'pass' : 'FAIL'}  ${c.name.padEnd(34)} opened ${v.opened} tab ${tab} (${v.tab})`);
      if (opened) { await apply(); Z = await heightsSettled(Z); }
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

// ---------------------------------------------------------------- layout (hoisted)
async function waitApp() { for (let i = 0; i < 90; i++) { await sleep(1000); if (await js(`!!document.getElementById('btnStampEdit') && !document.getElementById('app-splash-name')?.offsetParent`)) break; } await sleep(3000); }
async function openBrickTab() { if (!(await editorOpen())) await click('btnStampEdit', 2500); for (let i = 0; i < 30 && !(await js('!!window.svgEditor?._sketchLayer')); i++) await sleep(1000); await click('editorTabBrick', 1000); }
async function runLayout() {
  for (const vp of PEEK_LAYOUT.viewports) {
    await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile });
    await send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
    await send('Page.reload', {}); await waitApp();
    await openBrickTab();
    for (const tool of PEEK_LAYOUT.tools) {
      await click(`brickTool_${tool}`, 1500);
      const r = JSON.parse(await js(`JSON.stringify((()=>{ const g=document.getElementById(${JSON.stringify(PEEK_LAYOUT.element)}); if(!g) return { missing: true };
        const b=g.getBoundingClientRect(); const d=document.getElementById('editorMobileDrawer');
        return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), innerH: innerHeight, peek: !!d && d.classList.contains('is-peek'),
          shownPx: Math.round(Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0))) }; })())`));
      const ok = !r.missing && r.h > 0 && r.top >= 0 && r.bottom <= r.innerH + 0.5;
      rows.push({ name: `Peek ${vp.name}: ${tool} Generate fully shown`, kind: 'layout', result: 'ok', observed: r,
        verdict: { pending: 'n/a', canvas: 'n/a', threeD: 'n/a', layout: ok ? 'PASS' : 'FAIL' } });
      console.log(`${ok ? 'pass' : 'FAIL'}  Peek ${vp.name}: ${tool} Generate`.padEnd(54) + ` ${r.shownPx}/${r.h} px shown, bottom ${r.bottom} of ${r.innerH}${r.peek ? ' (drawer at peek)' : ''}`);
      if (!ok) await shot(`FAIL_peek_${vp.width}_${tool}`);
    }
  }
}

// ---------------------------------------------------------------- report (hoisted; shared by --parallel)
function failRows(rows) {
  return rows.filter((r) => Object.values(r.verdict).includes('FAIL') || !(['ok', 'requires unmet'].includes(r.result) || String(r.result).startsWith('skipped')));
}
function writeReport(rows, pageErrors) {
  const fails = failRows(rows);
  writeFileSync(path.join(OUT, 'brick-matrix.json'), JSON.stringify({ requiresSource: REQUIRES_SOURCE, rows, pageErrors }, null, 1));
  const md = ['| Control | Kind | Pending | Canvas | 3D | Greyed out (requires) | Layout |', '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.name} | ${r.kind}${r.tool ? ' (' + r.tool + ')' : ''} | ${r.verdict.pending} | ${r.verdict.canvas} | ${r.verdict.threeD} | ${r.verdict.greyedOut || ''} | ${r.verdict.layout || ''} |`)];
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
