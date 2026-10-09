// Build each declared creation (recipes.mjs) in the real app, headless, then capture what Fusion would receive.
// Per piece n, into <outDir>:
//   claude_<n>.json          the real "Send to Fusion" payload (the stub records the generate_* stream; cdp_capture_lib)
//   claude_<n>_app3d.png     the app's 3D preview, framed (recipe.view)
//   claude_<n>.app.json      the readback: every step's effect as the app holds it, + the project round-trip check
//   claude_<n>.project.json  the app project (cloud-project-manager.js buildSnapshot), named "claude <n>" when uploaded
//
//   node tools/repro/creations/capture_creations.mjs <outDir> [--only=1,3] [--http=8793] [--cdp=9783] [--reuse] [--quick]
// Without --reuse it starts its own static server (tools/brick-matrix/serve.py: the app root, styles included, a real
// listen backlog) and its own headless Chrome, and stops both at the end. --reuse drives an already-running pair.
// Heavy run: wait for the gate flags + >= 4 GB free RAM before starting it (see the advisor rules).
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, connectPage, fusionStubSource, payloadFromSends, sleep } from '../cdp_capture_lib.mjs';
import { CREATIONS, f3, along, rng, sketch, leaves } from './recipes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '../../../bspline-frame-builder');
const OUT = process.argv[2];
if (!OUT) { console.log('usage: capture_creations.mjs <outDir> [--only=1,2] [--http=8793] [--cdp=9783] [--reuse]'); process.exit(1); }
const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const HTTP = Number(opt('http', 8793)), CDP = Number(opt('cdp', 9783)), REUSE = process.argv.includes('--reuse');
const QUICK = process.argv.includes('--quick'); // build + 3D shot only (iterating on a piece's look)
const ONLY = opt('only', '') ? opt('only', '').split(',').map(Number) : null;
// the recipe file's own art helpers, handed to the page as source (page steps that compute geometry in the page --
// e.g. a vine on a contour-following trellis -- draw with the SAME seeded hand, not a copy)
const ART_HELPERS = `window.__art = (() => { const f3 = ${f3}; const along = ${along}; const rng = ${rng}; ${sketch} ${leaves} return { rng, sketch, leaves }; })();`;
const PAGE_STEPS = ART_HELPERS + String.fromCharCode(10) + readFileSync(path.join(HERE, 'page_steps.js'), 'utf8');
const URL = `http://127.0.0.1:${HTTP}/b-spline-gen/html/bspline_gen_palette.html`;
mkdirSync(OUT, { recursive: true });

let server = null, chrome = null;
if (!REUSE) {
  server = spawn('python', [path.resolve(HERE, '../../brick-matrix/serve.py'), String(HTTP)], { cwd: APP_ROOT, stdio: 'ignore' });
  const profile = path.join(OUT, `chrome-creations-${CDP}`);
  rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
  chrome = launchChrome(CDP, profile, ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
  console.log('started server pid', server.pid, 'chrome pid', chrome.pid);
}
const stop = () => { try { chrome?.kill(); } catch { /* gone */ } try { server?.kill(); } catch { /* gone */ } };
const page = await connectPage(CDP);
if (!page) { console.log('NO CDP'); stop(); process.exit(1); }
const { send, evalJS } = page;
await send('Runtime.enable'); await send('Page.enable');
await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] }); // never the cloud API
const VIEWPORT = { width: 1600, height: 1000 };

let stubId = null;
async function freshPage(seed) {
  if (stubId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
  stubId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: fusionStubSource(seed, { clearStorage: true }) })).result.identifier;
  await send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 120 && !(await evalJS('!!window.svgEditor && !!document.getElementById("btnStampEdit")')); i++) await sleep(500);
  await sleep(3000);
  const styled = await evalJS(`getComputedStyle(document.getElementById('previewCanvas')).position`);
  if (styled !== 'absolute') throw new Error('app styles not served (previewCanvas position ' + styled + ')');
  await evalJS(PAGE_STEPS);
  await evalJS('window.__creations.idle()');
}

const SAME_KEYS = ['board', 'template', 'filter', 'carveZ', 'terrainSeed', 'insetWindow', 'photo', 'lattice'];
const summary = [];
try {
  for (const [i, c] of CREATIONS.entries()) {
    const n = i + 1;
    if (ONLY && !ONLY.includes(n)) continue;
    const base = path.join(OUT, `claude_${n}`);
    console.log(`\n== ${n}. ${c.title} (${c.template}, ${c.board.join('x')}, seed ${c.seed})`);
    await freshPage(c.seed);
    const recipe = { ...c, steps: [{ board: { w: c.board[0], h: c.board[1] } }, ...c.steps] };
    const log = await evalJS(`window.__creations.run(${JSON.stringify(recipe)})`);
    if (!log) throw new Error('recipe run failed: ' + c.title);
    const app = await evalJS('window.__creations.readback()');
    // the 3D shot
    const clip = await evalJS(`window.__creations.prepShot(${JSON.stringify(c.view || {})})`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    writeFileSync(`${base}_app3d.png`, Buffer.from(shot.result.data, 'base64'));
    if (QUICK) { console.log('quick:', JSON.stringify({ n, bricks: app.bricks.byKind, lattice: app.lattice, sculpt: app.sculpt })); continue; }
    // the project (before Send: what Fred would save)
    const snap = await evalJS('window.__creations.snapshot()');
    writeFileSync(`${base}.project.json`, JSON.stringify(snap));
    // Send to Fusion
    const sends = await evalJS(`(async()=>{ window.__sends = []; document.getElementById('btnDownload').click();
      for (let i = 0; i < 1800; i++) { await new Promise(r=>setTimeout(r,100)); if (window.__sends.some(s => s[0] === 'generate_finish' || s[0] === 'generate')) break; }
      return window.__sends; })()`);
    const payload = payloadFromSends(sends);
    if (!payload) throw new Error('NO PAYLOAD for ' + c.title);
    writeFileSync(`${base}.json`, payload);
    const keys = Object.keys(JSON.parse(payload));
    // round-trip: the project into a fresh page through the app's own applySnapshot, read back
    await freshPage(c.seed + 1000);
    await evalJS(`window.__creations.restore(${JSON.stringify(snap)})`);
    const back = await evalJS('window.__creations.readback()');
    const diffs = SAME_KEYS.filter((k) => JSON.stringify(app[k]) !== JSON.stringify(back[k]));
    if (JSON.stringify(app.bricks.byKind) !== JSON.stringify(back.bricks.byKind)) diffs.push('bricks.byKind');
    if (JSON.stringify(app.layers.map((l) => [l.name, l.carve, l.elements])) !== JSON.stringify(back.layers.map((l) => [l.name, l.carve, l.elements]))) diffs.push('layers');
    if (Math.abs(app.sculpt.maxIn - back.sculpt.maxIn) > 1e-4 || app.sculpt.touchedPoints !== back.sculpt.touchedPoints) diffs.push('sculpt');
    const roundTrip = { ok: diffs.length === 0, diffs, back: diffs.length ? Object.fromEntries(diffs.map((k) => [k, k.includes('.') ? back.bricks.byKind : back[k]])) : undefined };
    const out = { n, title: c.title, concept: c.concept, template: c.template, board: c.board, seed: c.seed, stepsMs: log, payloadBytes: payload.length, payloadKeys: keys,
      projectBytes: JSON.stringify(snap).length, roundTrip, readback: app };
    writeFileSync(`${base}.app.json`, JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ n, payloadBytes: payload.length, roundTrip: roundTrip.ok ? 'ok' : diffs, bricks: app.bricks.byKind, lattice: app.lattice, sculpt: app.sculpt, layers: app.layers.map((l) => `${l.name}:${l.elements}${l.carve ? '*' : ''}`).join(' ') }));
    summary.push({ n, title: c.title, payloadBytes: payload.length, roundTrip: roundTrip.ok });
  }
} finally {
  page.close(); stop();
}
console.log('\nSUMMARY', JSON.stringify(summary));
