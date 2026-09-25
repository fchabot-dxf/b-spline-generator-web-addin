// Usage: node scripts/smoke-lattice-seed-color.mjs <outDir> [url]
// SE7g + amend — headless-Chrome (CDP, no deps) browser proof, standing in
// for a Fusion live check per Fred's hard rule (no Fusion tool calls while
// he's using it): serve the repo root (python -m http.server 8765 --directory .
// from the REPO ROOT — bspline_gen_palette.html's ../../ CSS/JS paths need
// that depth, see smoke-editor.mjs's own T25 comment) and pass
// http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// as <url>. Standalone (not a new smoke-editor.mjs mode) so this one-off
// SE7g check can't collide with seat B's own concurrent edits to that
// shared script — same minimal CDP driver, copied rather than imported
// (smoke-editor.mjs exports nothing; duplicating ~40 lines of driver
// boilerplate is cheaper than restructuring a script two seats touch).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9340;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-se7g`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-se7g`,
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
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = {};

await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
report.modalOpen = await evalJS(`getComputedStyle(document.getElementById('svgEditorModal')).display`);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);

// SE7g: the reroll button must be gone entirely — Generate does its job now.
report.rerollButtonRemoved = await evalJS(`document.getElementById('latticeReroll') === null`);

// --- First Generate ---
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.gen1 = await evalJS(`(() => ({
  seedField: document.getElementById('latticeSeed').value,
  seedPattern: window.svgEditor._latticePattern.seed,
  ties: [...document.querySelectorAll('[data-lattice=tie]')].map(e => e.getAttribute('x1')+','+e.getAttribute('y1')+'-'+e.getAttribute('x2')+','+e.getAttribute('y2')).sort(),
  railColor: document.querySelector('[data-lattice=rail]')?.getAttribute('stroke'),
  tieColor: document.querySelector('[data-lattice=tie]')?.getAttribute('stroke'),
  nodeColor: document.querySelector('[data-lattice=node]')?.getAttribute('fill'),
  swatchRails: getComputedStyle(document.getElementById('latticeColorRails')).backgroundColor,
}))()`);
await shot(`se7g-1-gen1.png`);

// --- Second Generate (Regenerate) ---
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.gen2 = await evalJS(`(() => ({
  seedField: document.getElementById('latticeSeed').value,
  seedPattern: window.svgEditor._latticePattern.seed,
  ties: [...document.querySelectorAll('[data-lattice=tie]')].map(e => e.getAttribute('x1')+','+e.getAttribute('y1')+'-'+e.getAttribute('x2')+','+e.getAttribute('y2')).sort(),
}))()`);
report.seedChangedBetweenPresses = report.gen1.seedPattern !== report.gen2.seedPattern;
report.seedFieldMatchesPatternSeed = String(report.gen2.seedField) === String(report.gen2.seedPattern);
report.tieSetChangedBetweenPresses = JSON.stringify(report.gen1.ties) !== JSON.stringify(report.gen2.ties);
await shot(`se7g-2-gen2.png`);

// --- Color swatch: open the shared mosaic, pick a color, confirm reuse + recolor-in-place ---
await evalJS(`document.getElementById('latticeColorRails').click(); true`);
await sleep(300);
report.mosaicOpened = await evalJS(`!!document.querySelector('.color-mosaic-popover')`);
report.mosaicCellCount = await evalJS(`document.querySelectorAll('.color-mosaic-grid .color-mosaic-cell').length`);
const railCountBefore = await evalJS(`document.querySelectorAll('[data-lattice=rail]').length`);
const seedBeforeColorPick = await evalJS(`window.svgEditor._latticePattern.seed`);
await shot(`se7g-3-mosaic-open.png`);

await evalJS(`document.querySelector('.color-mosaic-cell[title="#1a237e"]').click(); true`);
await sleep(300);
report.afterPick = await evalJS(`(() => ({
  mosaicClosed: !document.querySelector('.color-mosaic-popover'),
  swatchBg: getComputedStyle(document.getElementById('latticeColorRails')).backgroundColor,
  railStrokes: [...document.querySelectorAll('[data-lattice=rail]')].map(e => e.getAttribute('stroke')),
  railCount: document.querySelectorAll('[data-lattice=rail]').length,
  tieStroke: document.querySelector('[data-lattice=tie]')?.getAttribute('stroke'),
  patternColorsRails: window.svgEditor._latticePattern.colors.rails,
  seedAfterColorPick: window.svgEditor._latticePattern.seed,
}))()`);
report.recolorDidNotReseed = report.afterPick.seedAfterColorPick === seedBeforeColorPick;
report.recolorDidNotChangeCount = report.afterPick.railCount === railCountBefore;
report.tieUnaffectedByRailRecolor = report.afterPick.tieStroke !== '#1a237e';
await shot(`se7g-4-recolored.png`);

// --- Undo: restores previous pattern AND seed ---
await evalJS(`window.svgEditor.undo(); true`);
await sleep(500);
report.afterUndo1 = await evalJS(`(() => ({
  seedPattern: window.svgEditor._latticePattern ? window.svgEditor._latticePattern.seed : null,
  railStroke: document.querySelector('[data-lattice=rail]')?.getAttribute('stroke'),
}))()`);
// One more undo should land back on gen1's own seed (undoing the color pick,
// then the second Generate).
await evalJS(`window.svgEditor.undo(); true`);
await sleep(500);
report.afterUndo2 = await evalJS(`window.svgEditor._latticePattern ? window.svgEditor._latticePattern.seed : null`);
report.undoRestoresPriorSeed = report.afterUndo2 === report.gen1.seedPattern;
await shot(`se7g-5-after-undo.png`);

report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
