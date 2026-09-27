// H3 NO-PIECE-WIDTH acceptance: the "Selected piece" panel's Width/size
// control now edits the lattice's GENERAL width/node_diameter (every piece
// of that kind changes together), with no per-piece Reset for it. Colour
// stays per-piece (rails/ties/nodes) or the older segmentColors mechanism
// (contour, unaffected by this turn).
//   node tools/repro/no_piece_width_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9410);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-nopiecewidth-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }
const visiblePanel = `[...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0)`;

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolLattice').click(); await W(800);
  document.getElementById('latticeGenerate').click(); await W(2500);
})()`);

// 1) A selected RAIL: Width row shows "Width (all)", no Reset button at all
// (the button element itself no longer exists in the DOM).
const railState = await evalJS(`(()=>{
  const rail = document.querySelector('[data-lattice="rail"]');
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === rail);
  ed._select(wrapped);
  rail.id = 'lt_rail0';
  const panel = ${visiblePanel};
  return JSON.stringify({
    widthLabel: panel.querySelector('.lattice-piece-width-label')?.textContent,
    widthResetExists: !!panel.querySelector('.lattice-piece-width-reset'),
    widthValue: panel.querySelector('.lattice-piece-width')?.value,
  });
})()`);
console.log('rail panel state:', railState);
const r1 = JSON.parse(railState);
check(r1.widthLabel === 'Width (all)', `H3: rail width row label reads "Width (all)" (got "${r1.widthLabel}")`);
check(!r1.widthResetExists, 'H3: no width Reset button exists for a rail');
await shot('rail_selected');

// 2) Editing the rail's width changes EVERY rail, not just the selected one.
const beforeRails = await evalJS(`window.svgEditor._sketchLayer.children().toArray().map(c => c.node).filter(n => n.getAttribute('data-lattice') === 'rail' && n.hasAttribute('data-lattice-gen')).map(r => +r.getAttribute('stroke-width')).join(',')`);
await evalJS(`(()=>{
  const panel = ${visiblePanel};
  const input = panel.querySelector('.lattice-piece-width');
  input.value = '0.9';
  input.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(200);
const afterRails = await evalJS(`window.svgEditor._sketchLayer.children().toArray().map(c => c.node).filter(n => n.getAttribute('data-lattice') === 'rail' && n.hasAttribute('data-lattice-gen')).map(r => +r.getAttribute('stroke-width'))`);
console.log('rail widths before:', beforeRails, 'after:', JSON.stringify(afterRails));
check(afterRails.every((w) => w === 0.9), `H3: editing the panel's width changed EVERY rail to 0.9 (got ${JSON.stringify(afterRails)})`);
const storedRailsWidth = await evalJS(`(()=>{ const p = window.svgEditor._layers.find(l => l.pattern)?.pattern; return p?.widths?.rails; })()`);
check(storedRailsWidth === 0.9, `H3: PATTERN.widths.rails updated to the new general value (got ${storedRailsWidth})`);
await shot('rail_width_changed');

// 3) A selected NODE: label reads "Size (all)", editing it changes every
// node's radius AND PATTERN.widths.nodeDiameter.
const nodeSelect = await evalJS(`(()=>{
  const node = document.querySelector('[data-lattice="node"]');
  if (!node) return JSON.stringify({ found: false });
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === node);
  ed._select(wrapped);
  const panel = ${visiblePanel};
  return JSON.stringify({ found: true, label: panel.querySelector('.lattice-piece-width-label')?.textContent });
})()`);
const nsel = JSON.parse(nodeSelect);
check(nsel.found, 'H3: a node exists in this generation to select');
if (nsel.found) {
  check(nsel.label === 'Size (all)', `H3: node size row label reads "Size (all)" (got "${nsel.label}")`);
  const beforeNodes = await evalJS(`window.svgEditor._sketchLayer.children().toArray().map(c => c.node).filter(n => n.getAttribute('data-lattice') === 'node' && n.hasAttribute('data-lattice-gen')).map(n => +n.getAttribute('r')).join(',')`);
  await evalJS(`(()=>{
    const panel = ${visiblePanel};
    const input = panel.querySelector('.lattice-piece-width');
    input.value = '0.3';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(200);
  const afterNodes = await evalJS(`window.svgEditor._sketchLayer.children().toArray().map(c => c.node).filter(n => n.getAttribute('data-lattice') === 'node' && n.hasAttribute('data-lattice-gen')).map(n => +n.getAttribute('r'))`);
  console.log('node radii before:', beforeNodes, 'after:', JSON.stringify(afterNodes));
  check(afterNodes.every((r) => Math.abs(r - 0.15) < 1e-9), `H3: editing the panel's size changed EVERY node's radius to 0.15 (diameter 0.3) (got ${JSON.stringify(afterNodes)})`);
  const storedNodeDiameter = await evalJS(`(()=>{ const p = window.svgEditor._layers.find(l => l.pattern)?.pattern; return p?.widths?.nodeDiameter; })()`);
  check(storedNodeDiameter === 0.3, `H3: PATTERN.widths.nodeDiameter updated to the new general value (got ${storedNodeDiameter})`);
  await shot('node_size_changed');
}

// 4) A plain drawing element (a hand-drawn line) keeps its OWN per-element
// width, unaffected -- the "Selected piece" panel doesn't even show for
// it (pieceKindOf/CONTOUR_SEG_INDEX_ATTR both correctly say "not a lattice
// piece"), so its width still goes through the main toolbar's own stroke
// control (editor.setStrokeWidth), never this panel at all.
const plainState = await evalJS(`(()=>{
  const ed = window.svgEditor;
  const line = ed._sketchLayer.line(0, 0, 1, 1).stroke({ color: '#000', width: 0.2 }).attr('data-layer', ed._activeLayer);
  ed._select(line);
  const panel = ${visiblePanel};
  const visible = panel && panel.getBoundingClientRect().width > 0;
  ed.setStrokeWidth(0.5);
  return JSON.stringify({ panelVisibleForPlainLine: !!visible, lineWidthAfter: +line.attr('stroke-width') });
})()`);
const p4 = JSON.parse(plainState);
console.log('plain element check:', plainState);
check(!p4.panelVisibleForPlainLine, 'H3: the Selected-piece panel does NOT show for a plain hand-drawn line');
check(p4.lineWidthAfter === 0.5, 'H3: a plain line still gets its own per-element width via the main toolbar stroke control');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);
