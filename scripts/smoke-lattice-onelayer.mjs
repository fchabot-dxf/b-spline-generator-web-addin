// Usage: node scripts/smoke-lattice-onelayer.mjs <outDir> [url]
// SE7i Section 1+2 — headless-Chrome (CDP, no deps) browser proof, standing
// in for a Fusion live check per Fred's hard rule (no Fusion tool calls
// while he's using it): serve the repo root (python -m http.server 8765
// --directory . from the REPO ROOT) and pass
// http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// as <url>. Standalone script (same reasoning as smoke-lattice-addon.mjs).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9343;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-se7i-onelayer`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-se7i-onelayer`,
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
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);

report.widthsRowPresent = await evalJS(`!!document.getElementById('latticeWidthRails') && !!document.getElementById('latticeWidthTies') && !!document.getElementById('latticeWidthNodes')`);
report.widthDefaults = await evalJS(`({ rails: document.getElementById('latticeWidthRails').value, ties: document.getElementById('latticeWidthTies').value, nodes: document.getElementById('latticeWidthNodes').value })`);

report.layerCountBeforeGenerate = await evalJS(`window.svgEditor._layers.length`);
report.layer1Id = await evalJS(`window.svgEditor._activeLayer`);

// --- Generate on Layer 1: no new layer created ---
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.afterGenerate = await evalJS(`(() => {
  const e = window.svgEditor;
  const rails = [...document.querySelectorAll('[data-lattice=rail]')];
  return {
    layerCount: e._layers.length,
    activeLayerUnchanged: e._activeLayer === '${report.layer1Id}',
    allElementsOnActiveLayer: [...document.querySelectorAll('[data-lattice]')].every(el => el.getAttribute('data-layer') === e._activeLayer),
    railWidth: rails[0] ? +rails[0].getAttribute('stroke-width') : null,
  };
})()`);
report.noNewLayerCreated = report.afterGenerate.layerCount === report.layerCountBeforeGenerate;
await shot(`se7i-1-layer1-generated.png`);

// --- Live width edit: bump the Rails width stepper, confirm owned rails resize immediately ---
await evalJS(`(() => {
  const el = document.getElementById('latticeWidthRails');
  el.value = '0.2';
  el.dispatchEvent(new Event('change', { bubbles: true }));
})(); true`);
await sleep(500);
report.widthLiveEdit = await evalJS(`+document.querySelector('[data-lattice=rail]').getAttribute('stroke-width')`);
report.widthLiveEditWorked = report.widthLiveEdit === 0.2 && report.widthLiveEdit !== report.afterGenerate.railWidth;
await shot(`se7i-2-rail-width-bumped.png`);

// --- Add a SECOND layer, activate it: the panel must show DEFAULTS, not Layer 1's pattern ---
const layer1Seed = await evalJS(`window.svgEditor._layers.find(l => l.id === '${report.layer1Id}').pattern.seed`);
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(500);
const layer2Id = await evalJS(`window.svgEditor._activeLayer`);
report.layer2DifferentFromLayer1 = layer2Id !== report.layer1Id;
report.panelResetOnNewLayer = await evalJS(`document.getElementById('latticeSeed').value !== '${layer1Seed}' && document.getElementById('latticeGenerate').textContent === 'Generate'`);

// Generate on Layer 2 with VERTICAL orientation — an independent pattern.
await evalJS(`document.getElementById('latticeOrientVertical').click(); true`);
await sleep(1500);
report.layer2 = await evalJS(`(() => {
  const e = window.svgEditor;
  const l2 = e._layers.find(l => l.id === '${layer2Id}');
  return { orientation: l2.pattern?.orientation, seed: l2.pattern?.seed, id: l2.pattern?.id };
})()`);

// Switch back to Layer 1 — the panel must reload LAYER 1's OWN settings
// (horizontal, its own seed), proving independence, not a shared pattern.
await evalJS(`(() => { document.querySelector('.layer-row[data-layer-id="${report.layer1Id}"]').click(); })(); true`);
await sleep(500);
report.backOnLayer1 = await evalJS(`({
  orientationShown: document.getElementById('latticeOrientHorizontal').classList.contains('active'),
  seedShown: document.getElementById('latticeSeed').value,
  activeLayer: window.svgEditor._activeLayer,
})`);
report.layersAreIndependent = report.backOnLayer1.activeLayer === report.layer1Id
  && report.backOnLayer1.orientationShown === true
  && report.backOnLayer1.seedShown === String(layer1Seed)
  && report.layer2.orientation === 'vertical';
await shot(`se7i-3-layer2-independent-pattern.png`);

// --- Regenerate sweeps a HAND-MOVED (still-owned) piece — the old detach-
// on-move rule is retired: drag an owned rail via Select, then Regenerate
// on Layer 1, confirm it's gone (not preserved at its dragged position). ---
await evalJS(`(() => { document.querySelector('.layer-row[data-layer-id="${report.layer1Id}"]').click(); })(); true`);
await sleep(400);
await evalJS(`document.getElementById('toolSelect').click(); true`);
await sleep(300);

async function modelToScreen(mx, my) {
  return evalJS(`(() => {
    const svg = document.querySelector('#editorSVGContainer svg');
    const pt = svg.createSVGPoint();
    pt.x = ${mx}; pt.y = ${my};
    const s = pt.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  })()`);
}
async function dragFromTo(mStart, mEnd) {
  const start = await modelToScreen(mStart.x, mStart.y);
  const end = await modelToScreen(mEnd.x, mEnd.y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
  await sleep(80);
  for (let k = 1; k <= 4; k++) {
    const x = start.x + (end.x - start.x) * (k / 4);
    const y = start.y + (end.y - start.y) * (k / 4);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await sleep(300);
}

// Scoped to editor._sketchLayer specifically (not document-wide) —
// editor._highlightLayer draws a CLONE of the selected element for its
// own selection-outline visual (an unrelated, pre-existing mechanism) and
// a stale copy of it can otherwise be mistaken for real sketch content.
const railPt = await evalJS(`(() => {
  const r = window.svgEditor._sketchLayer.children().toArray()
    .find(ch => ch.node.getAttribute('data-layer') === '${report.layer1Id}' && ch.node.getAttribute('data-lattice') === 'rail').node;
  return { x: (+r.getAttribute('x1') + +r.getAttribute('x2')) / 2, y: +r.getAttribute('y1') };
})()`);
await dragFromTo({ x: railPt.x, y: railPt.y }, { x: railPt.x, y: railPt.y + 0.5 });
report.railStillOwnedAfterDrag = await evalJS(`(() => {
  const r = window.svgEditor._sketchLayer.children().toArray()
    .find(ch => ch.node.getAttribute('data-layer') === '${report.layer1Id}' && ch.node.getAttribute('transform'));
  return r ? r.node.hasAttribute('data-lattice-gen') : 'NO_TRANSFORMED_RAIL_FOUND';
})()`);

await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.regenerateSweptTheMovedRail = await evalJS(`(() => {
  const layer1Rails = window.svgEditor._sketchLayer.children().toArray()
    .filter(ch => ch.node.getAttribute('data-layer') === '${report.layer1Id}' && ch.node.getAttribute('data-lattice') === 'rail');
  return { layer1Count: layer1Rails.length, anyWithTransform: layer1Rails.some(ch => ch.node.getAttribute('transform')) };
})()`);
report.movedPieceWasSwept = report.railStillOwnedAfterDrag === true
  && report.regenerateSweptTheMovedRail.anyWithTransform === false;
await shot(`se7i-4-moved-rail-swept-by-regenerate.png`);

report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
