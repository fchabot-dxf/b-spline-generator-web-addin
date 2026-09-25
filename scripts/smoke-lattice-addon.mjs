// Usage: node scripts/smoke-lattice-addon.mjs <outDir> [url]
// SE7h ADD-ON (Fred: generated Rails/Ties/Nodes were unclickable in
// Select/Node modes) + ADD-ON 2 (Fred: "add a check box for nodes at rail
// end") — headless-Chrome (CDP, no deps) browser proof, standing in for a
// Fusion live check per Fred's hard rule (no Fusion tool calls while he's
// using it): serve the repo root (python -m http.server 8765 --directory .
// from the REPO ROOT) and pass
// http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// as <url>. Standalone script (same reasoning as smoke-lattice-orientation.mjs:
// no collision risk with a shared script another seat might touch this
// same cycle).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9342;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-se7h-addon`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-se7h-addon`,
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

async function modelToScreen(mx, my) {
  return evalJS(`(() => {
    const svg = document.querySelector('#editorSVGContainer svg');
    const pt = svg.createSVGPoint();
    pt.x = ${mx}; pt.y = ${my};
    const s = pt.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  })()`);
}
async function clickAt(mx, my) {
  const s = await modelToScreen(mx, my);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(60);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(300);
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

// ============================================================
// ADD-ON 2 (railEnds checkbox): unchecked by default, toggling it on
// adds a node at each rail's own end; toggling off removes it again.
// ============================================================
report.railEndsUncheckedByDefault = await evalJS(`!document.getElementById('latticeNodesRailEnds').checked`);

await evalJS(`document.getElementById('latticeTiesDensity').value = 0.4; true`); // realistic default, exercised elsewhere too
// Generate always rolls a fresh seed on every press (SE7g) — pin
// Math.random for each of the 3 generates below so the TIE layout stays
// identical across them, isolating what railEnds alone changes instead of
// comparing against a different random tie layout each time.
await evalJS(`window.Math.random = () => 0.42; true`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.beforeRailEnds = await evalJS(`(() => {
  const rail = document.querySelector('[data-lattice=rail]');
  const nodes = [...document.querySelectorAll('[data-lattice=node]')].map(n => ({ cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy') }));
  return { railStart: rail ? { x: +rail.getAttribute('x1'), y: +rail.getAttribute('y1') } : null, nodeCount: nodes.length,
           nodeAtRailStart: rail ? nodes.some(n => n.cx === +rail.getAttribute('x1') && n.cy === +rail.getAttribute('y1')) : null };
})()`);

await evalJS(`document.getElementById('latticeNodesRailEnds').checked = true; true`);
await evalJS(`window.Math.random = () => 0.42; true`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.afterRailEndsChecked = await evalJS(`(() => {
  const rail = document.querySelector('[data-lattice=rail]');
  const nodes = [...document.querySelectorAll('[data-lattice=node]')].map(n => ({ cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy') }));
  return { nodeCount: nodes.length,
           nodeAtRailStart: rail ? nodes.some(n => n.cx === +rail.getAttribute('x1') && n.cy === +rail.getAttribute('y1')) : null,
           patternFlag: window.svgEditor._latticePattern.nodes.railEnds };
})()`);
report.railEndsAddedANode = report.afterRailEndsChecked.nodeAtRailStart === true
  && !report.beforeRailEnds.nodeAtRailStart
  && report.afterRailEndsChecked.nodeCount > report.beforeRailEnds.nodeCount;
await shot(`se7h-addon-1-railends-on.png`);

await evalJS(`document.getElementById('latticeNodesRailEnds').checked = false; true`);
await evalJS(`window.Math.random = () => 0.42; true`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.afterRailEndsUnchecked = await evalJS(`(() => {
  const rail = document.querySelector('[data-lattice=rail]');
  const nodes = [...document.querySelectorAll('[data-lattice=node]')].map(n => ({ cx: +n.getAttribute('cx'), cy: +n.getAttribute('cy') }));
  return { nodeCount: nodes.length, nodeAtRailStart: rail ? nodes.some(n => n.cx === +rail.getAttribute('x1') && n.cy === +rail.getAttribute('y1')) : null };
})()`);
report.railEndsToggleIsReversible = report.afterRailEndsUnchecked.nodeAtRailStart === false
  && report.afterRailEndsUnchecked.nodeCount === report.beforeRailEnds.nodeCount;

// ============================================================
// ADD-ON 1 (Rails/Ties/Nodes unclickable in Select/Node modes): a click
// on a generated piece, while a DIFFERENT layer ("Layer 1") is active,
// selects it AND makes its own layer the active one; a marquee drag
// picks up elements across multiple visible layers too.
// ============================================================
report.layerIds = await evalJS(`(() => {
  const e = window.svgEditor;
  const layer1 = e._layers.find(l => l.name === 'Layer 1');
  return { layer1: layer1 && layer1.id, rails: e._latticePattern.layers.rails, nodes: e._latticePattern.layers.nodes, activeAfterGenerate: e._activeLayer };
})()`);
report.layer1IsActiveAfterGenerate = report.layerIds.activeAfterGenerate === report.layerIds.layer1;

await evalJS(`document.getElementById('toolSelect').click(); true`);
await sleep(400);

const railPt = await evalJS(`(() => {
  const r = document.querySelector('[data-lattice=rail]');
  return { x: (+r.getAttribute('x1') + +r.getAttribute('x2')) / 2, y: +r.getAttribute('y1') };
})()`);
await clickAt(railPt.x, railPt.y);
report.selectClickOnRail = await evalJS(`(() => {
  const e = window.svgEditor;
  return {
    activeLayerAfter: e._activeLayer,
    becameRailsLayer: e._activeLayer === e._latticePattern.layers.rails,
    selectedKind: e._selectedElement ? e._selectedElement.node.getAttribute('data-lattice') : null,
  };
})()`);
await shot(`se7h-addon-2-select-click-rail.png`);

// Reset: click empty canvas to deselect, reactivate Layer 1 via its row.
await clickAt(-5, -5);
await evalJS(`(() => { const row = document.querySelector('.layer-row[data-layer-id="${report.layerIds.layer1}"]'); if (row) row.click(); })(); true`);
await sleep(300);

await evalJS(`document.getElementById('toolNode').click(); true`);
await sleep(400);
const nodePt = await evalJS(`(() => {
  const n = document.querySelector('[data-lattice=node]');
  return { x: +n.getAttribute('cx'), y: +n.getAttribute('cy') };
})()`);
await clickAt(nodePt.x, nodePt.y);
report.nodeClickOnNode = await evalJS(`(() => {
  const e = window.svgEditor;
  return {
    activeLayerAfter: e._activeLayer,
    becameNodesLayer: e._activeLayer === e._latticePattern.layers.nodes,
    selectedKind: e._selectedElement ? e._selectedElement.node.getAttribute('data-lattice') : null,
  };
})()`);
await shot(`se7h-addon-3-node-click-node.png`);

// Reset again, then marquee-drag across the whole generated area (Select
// mode) — should pick elements from more than one layer at once.
await evalJS(`document.getElementById('toolSelect').click(); true`);
await sleep(300);
await clickAt(-5, -5);
await evalJS(`(() => { const row = document.querySelector('.layer-row[data-layer-id="${report.layerIds.layer1}"]'); if (row) row.click(); })(); true`);
await sleep(300);

const bounds = await evalJS(`(() => {
  const els = [...document.querySelectorAll('[data-lattice]')];
  const xs = [], ys = [];
  els.forEach(e => {
    if (e.hasAttribute('x1')) { xs.push(+e.getAttribute('x1'), +e.getAttribute('x2')); ys.push(+e.getAttribute('y1'), +e.getAttribute('y2')); }
    else if (e.hasAttribute('cx')) { xs.push(+e.getAttribute('cx')); ys.push(+e.getAttribute('cy')); }
  });
  return { minX: Math.min(...xs) - 0.2, minY: Math.min(...ys) - 0.2, maxX: Math.max(...xs) + 0.2, maxY: Math.max(...ys) + 0.2 };
})()`);
await dragFromTo({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
report.marquee = await evalJS(`(() => {
  const e = window.svgEditor;
  const sel = e._selectedElements || [];
  const layersHit = new Set(sel.map(s => s.node.getAttribute('data-layer')));
  return { selectedCount: sel.length, distinctLayers: [...layersHit] };
})()`);
report.marqueeSpannedMultipleLayers = report.marquee.distinctLayers.length > 1 && report.marquee.selectedCount > 1;
await shot(`se7h-addon-4-marquee-multi-layer.png`);

report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);
