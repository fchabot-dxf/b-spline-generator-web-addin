// Capture the REAL "Send to Fusion" payload the app builds, without Fusion: a stub `adsk.fusionSendData`
// is planted before the page loads, records every call, and the generate_start/chunk/finish stream is
// reassembled exactly like b-spline-gen.py does. The payload can then be replayed into the add-in's own
// _handle_generate inside Fusion (live checks without clicking in the palette).
//   node tools/repro/capture_send_payload.mjs <out.json> <paletteUrl> [scenario] [port] [--drag]
//   scenario: shape-lattice (default) | box-lattice | shape-lattice-frame
//   shape-lattice-frame (F21): T1 chosen in the Frame tab + its [Generate] (a SEEDED frame; unseeded, Fusion builds
//          the template's literal shape, up to ~0.02 in off the app's fitted model, F8), Shape Lattice Generate, then its contour "Offset from frame"
//          ON (distance 0.25); ALSO writes the [Send frame] payload to <out>.frame.json (replay: _handle_send_frame).
//   --template=<id> (F30 item 3): the Frame tab's own template id for the shape-lattice-frame scenario (default
//          template_1) -- was a hardcoded literal every earlier per-template live check hand-edited in place.
//   --board=WxH (T83 item 2, T11 live check): sets widthIn/heightIn before capture (default: whatever the
//          page's own fresh-profile default is).
//   --drag (F17, Send as drawn): after Generate, HAND-DRAG the middle rail down and one tie sideways with real mouse
//          events through the lattice tool's own handlers, then write the pieces as drawn to <out>.drawn.json
//          ({W, H, rails:[{x1,y1,x2,y2}], ties:[...], moved:{rail, tie}}), in canvas order = manifest id order.
//   --cut  (F18, SE16): after Generate, CUT the rail with the most tie contacts at a tie contact AND mid-rail (the
//          editor's own cutAt command), colour 2 of its 3 segments, write <out>.drawn.json with `cut`.
//   --carve (H23 item 82, CAM same-position stock): after the scenario, turn 3D carve ON for the layers it drew
//          (CARVE_LAYERS below) so the stamp bakes and the Send carries the STAMPED STEP variant next to Clean
//          (export-flow.js ships 'Stamped' only when a carving layer exists). Without it: Clean only, as before.
//   scenario brick-e2e (H23 item 83, end-to-end brick acceptance): T1 frame + bricks per BRICK_E2E below -- the
//          frame band in Set 5 (Grey stone; written into P.brickSettings: the app's set picker only offers the bond
//          sets), a pattern-builder custom bond at unit 1/2 with raised cells, two painted wall areas with different
//          patterns (areas replace the whole-board wall in the app), one raised brush stroke, one 'Art' layer with a
//          carving stroke (carve on, the editor's own Apply bakes the masks). Also writes <out>.app.json (the app's
//          own piece counts by kind, areas, layers) and <out>.png (the editor view).
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const ARGS = process.argv.slice(2).filter((a) => a !== '--drag' && a !== '--cut' && a !== '--carve' && !a.startsWith('--lip=') && !a.startsWith('--template=') && !a.startsWith('--board='));
// F22: --lip=<in> sets the Frame section's "Panel lip" (the real field) before the frame payload is taken
const LIP = (process.argv.find((a) => a.startsWith('--lip=')) || '').slice(6);
// F30 item 3: --template=<id> picks the shape-lattice-frame scenario's own Frame tab template (default template_1).
const TEMPLATE = (process.argv.find((a) => a.startsWith('--template=')) || '').slice(11) || 'template_1';
// T83 item 2 (T11 live check): --board=WxH sets widthIn/heightIn before capture (default: whatever the page's
// own fresh-profile default is, unchanged for every existing caller).
const BOARD = (process.argv.find((a) => a.startsWith('--board=')) || '').slice(8); // "WxH" or ''
const DRAG = process.argv.includes('--drag');
const CUT = process.argv.includes('--cut');
// --carve: the layer names the lattice scenarios draw into (editor layer .name), carved for a Stamped Send.
const CARVE = process.argv.includes('--carve');
const CARVE_LAYERS = ['Rails', 'Contour', 'Ties', 'Nodes'];
// H23 item 83: the brick-e2e board, declared (board inches, origin top-left, y down -- the editor's own frame).
const BRICK_E2E = {
  template: 'template_1',
  frameSet: 5,                                     // Grey stone: its bandLayout 'fieldstone' rings the frame
  builder: { base: 'custom', unit: 0.5, joins: [[0, 0, 1]], raised: [[0, 0], [1, 2]], levelIn: 0.0625 },
  areaWidthIn: 2,
  // Painted in this order. The app drops a custom tile's raised marks whenever another bond is picked (item 31,
  // setWallPattern), and the accent is shared by every area -- so the builder area comes LAST, with no pattern
  // pick after it. pattern 'builder' = lay with the pattern builder's custom bond above.
  areas: [
    { pattern: 'herringbone', points: [[1.6, 6.4], [3.5, 6.0], [5.4, 6.4]] },
    { pattern: 'builder', points: [[1.6, 2.2], [3.5, 2.6], [5.4, 2.2]] },
  ],
  raisedStroke: [[1.4, 4.5], [2.5, 4.2], [3.5, 4.5], [4.5, 4.8], [5.6, 4.5]],
  art: { name: 'Art', path: 'M 2.2 3.4 C 3.0 2.9, 4.0 3.9, 4.8 3.4', strokeIn: 0.05 },
};
const [OUT, URL, SCENARIO = 'shape-lattice', PORTARG] = ARGS;
const PORT = Number(PORTARG || 9395);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(OUT)}/chrome-capture-${PORT}`;
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
  if (msg.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', msg.params.exceptionDetails?.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) console.log('PAGE EVAL ERROR:', String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
  return r?.result?.value;
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
// The stub: the app detects Fusion mode through window.adsk; every send is recorded, nothing answers.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__sends = [];
  window.adsk = { fusionSendData(action, data) { window.__sends.push([action, data]); return ''; } };` });
await send('Page.navigate', { url: URL }); await sleep(9000);

const steps = {
  'shape-lattice': `document.getElementById('toolShapeLattice').click(); await W(900);
     document.getElementById('shapeLatticeGenerate').click(); await W(3000);`,
  'box-lattice': `document.getElementById('toolLattice').click(); await W(900);
     document.getElementById('latticeGenerate').click(); await W(2500);`,
  // F30 item 3: editFrame() (not the <select>'s own .value=) so a FRAME_HIDDEN template (no <option> in the
  // DOM until synced) still selects correctly -- editFrame -> setFrameRecord + syncFramePanel, the same path
  // the hidden-template test itself relies on to inject the current-but-hidden id as a temporary option.
  'shape-lattice-frame': `(await import('./main/frame-panel.js')).editFrame({ templateId: '${TEMPLATE}', params: {} }); await W(1500);
     document.getElementById('editorFrameGenerate').click(); await W(1500); // SEEDED: Fusion follows the app's seeds exactly (F11)
     document.getElementById('toolShapeLattice').click(); await W(900);
     document.getElementById('shapeLatticeGenerate').click(); await W(3000);
     const f = document.getElementById('shapeLatticeContourFromFrame'); f.checked = true; f.dispatchEvent(new Event('change')); await W(3000);`,
  // H23 item 83: see BRICK_E2E. Each step is the app's own exported function (the ones its tests drive).
  'brick-e2e': `const E = ${JSON.stringify(BRICK_E2E)};
     (await import('./main/frame-panel.js')).editFrame({ templateId: E.template, params: {} }); await W(1500);
     document.getElementById('editorFrameGenerate').click(); await W(1500);
     document.getElementById('editorTabBrick').click(); await W(800);
     const B = await import('./main/brick-panel.js'), S = await import('./core/state.js');
     const L = await import('./editor/layers.js'), T = await import('./editor/editor-brick-tool.js');
     const ed = window.svgEditor;
     S.P.brickSettings.setIds = { ...S.P.brickSettings.setIds, frame: E.frameSet }; S.P.brickSettings.frameBandPatterns = [];
     document.getElementById('brickTool_frame').click(); await W(500); document.getElementById('brickGenerate').click(); await W(3000);
     document.getElementById('brickTool_wall').click(); await W(500); document.getElementById('brickGenerate').click(); await W(3000);
     B.setWallAreaWidth(E.areaWidthIn);
     for (const a of E.areas) { B.selectBrickElement(null);
       if (a.pattern === 'builder') { B.openPatternBuilder(); B.builderSetBase(E.builder.base); B.builderSetUnit(E.builder.unit);
         for (const [r, x, y] of E.builder.joins) B.builderJoin(r, x, y);
         for (const [r, c] of E.builder.raised) B.builderToggleCell(r, c);
         B.setAccentLevel(E.builder.levelIn); await W(3000); B.selectBrickElement(null); }
       else { B.setWallPattern(a.pattern); await W(800); }
       B.paintWallArea(a.points.map(([x, y]) => ({ x, y }))); await W(3500); }
     B.closePatternBuilder && B.closePatternBuilder();
     B.selectBrickElement(null);
     document.getElementById('brickTool_raisedBrush').click(); await W(500);
     const st = E.raisedStroke; T.brickBrushHandler.start(ed, { x: st[0][0], y: st[0][1] });
     for (const [x, y] of st.slice(1)) T.brickBrushHandler.update(ed, { x, y });
     T.brickBrushHandler.finish(ed); await W(3500);
     const art = L.addLayer(ed, { name: E.art.name }); L.setActiveLayer(ed, art.id);
     ed._sketchLayer.path(E.art.path).fill('none').stroke({ color: '#000', width: E.art.strokeIn }).attr('data-layer', art.id);
     (await import('./editor/editor-commit.js')).commitEdit(ed); await W(800);
     L.setLayerCarve(ed, art.id, true); await W(800);
     document.getElementById('editorApply').click(); await W(9000);`,
}[SCENARIO];
if (!steps) { console.log('unknown scenario', SCENARIO); chrome.kill(); process.exit(1); }
const [BOARD_W, BOARD_H] = BOARD ? BOARD.split('x') : [];
const boardStep = BOARD ? `
  { const w = document.getElementById('widthIn'), h = document.getElementById('heightIn');
    w.value = '${BOARD_W}'; w.dispatchEvent(new Event('change'));
    h.value = '${BOARD_H}'; h.dispatchEvent(new Event('change')); await W(500); }` : '';
const built = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  ${boardStep}
  ${steps}
  return document.querySelectorAll('[data-lattice]').length;
})()`);
if (DRAG) {
  // F17: a real hand drag (mouse events -> the lattice tool's handlers), verified to have grabbed the intended piece
  const toScreen = (id, t) => `(()=>{ try { const el=window.svgEditor._sketchLayer.node.querySelector('[data-f17="${id}"]'); const svg=el.ownerSVGElement; const p=svg.createSVGPoint();
    const x1=+el.getAttribute('x1'),y1=+el.getAttribute('y1'),x2=+el.getAttribute('x2'),y2=+el.getAttribute('y2');
    p.x=x1+(x2-x1)*${t}; p.y=y1+(y2-y1)*${t}; const q=p.matrixTransform(el.getScreenCTM()); return JSON.stringify([q.x,q.y]);
    } catch (e) { return JSON.stringify({ error: String(e) }); } })()`;
  const drag = async (id, dx, dy) => {
    // off-centre first: the Shape Lattice tool hit-tests its shape handles (one sits at the board centre) BEFORE pieces
    for (const t of [0.3, 0.7, 0.2, 0.8]) {
      const at = JSON.parse(await evalJS(toScreen(id, t)));
      if (!Array.isArray(at)) { console.log('drag: cannot locate', id, JSON.stringify(at)); return false; }
      const [x, y] = at;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await sleep(60);
      const grabbed = await evalJS(`(()=>{ const m = window.svgEditor._latticeMove; return m && m.el && m.el.node ? m.el.node.getAttribute('data-f17') + '|' + m.mode : null; })()`);
      if (!grabbed || !grabbed.startsWith(id + '|') || !grabbed.endsWith('|move')) {
        console.log('drag: grab miss at', t, 'got', grabbed, 'under:', await evalJS(`(()=>{ const e=document.elementFromPoint(${x},${y}); return e ? e.tagName + '#' + e.id + '.' + (e.getAttribute('class')||'') + ' lat=' + e.getAttribute('data-lattice') : 'none'; })()`), 'at', x, y);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        await sleep(200); continue;
      }
      for (let i = 1; i <= 8; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx * i / 8, y: y + dy * i / 8, button: 'left', buttons: 1 }); await sleep(30); }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
      await sleep(600);
      return true;
    }
    return false;
  };
  // the lattice tool's "tap a piece" sub-mode (the same step tools/repro/select_drag_shape.mjs selectPiece uses)
  await evalJS(`(async()=>{ const b=[...document.querySelectorAll('button,[role=button]')].find(x=>x.offsetParent && /tap a piece/i.test(x.title||''));
    if (b) b.click(); await new Promise(r=>setTimeout(r,400)); })()`);
  await sleep(1500);
  const picked = JSON.parse(await evalJS(`(()=>{ const L=window.svgEditor._sketchLayer.node; const rails=[...L.querySelectorAll('[data-lattice="rail"][data-lattice-gen]')];
    const ties=[...L.querySelectorAll('[data-lattice="tie"][data-lattice-gen]')];
    const r = rails.slice().sort((a,b)=>(+a.getAttribute('y1'))-(+b.getAttribute('y1')))[Math.floor(rails.length/2)];
    const t = ties.slice().sort((a,b)=>Math.abs(+b.getAttribute('y2')-(+b.getAttribute('y1')))-Math.abs(+a.getAttribute('y2')-(+a.getAttribute('y1'))))[0];
    r.setAttribute('data-f17', 'f17_rail'); t.setAttribute('data-f17', 'f17_tie');
    const idx = (list, el) => list.indexOf(el);
    const at = (e) => ['x1','y1','x2','y2'].map(k => +e.getAttribute(k));
    return JSON.stringify({ rail: idx(rails, r), tie: idx(ties, t), railBefore: at(r), tieBefore: at(t) }); })()`));
  const railOk = await drag('f17_rail', 0, 45);
  const tieOk = await drag('f17_tie', 35, 0);
  const drawn = JSON.parse(await evalJS(`(()=>{ const q=(k)=>[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-lattice="'+k+'"][data-lattice-gen]')]
    .map(e=>({x1:+e.getAttribute('x1'),y1:+e.getAttribute('y1'),x2:+e.getAttribute('x2'),y2:+e.getAttribute('y2'),mark:e.getAttribute('data-f17')}));
    const ed=window.svgEditor; return JSON.stringify({ W: ed._mW, H: ed._mH, rails: q('rail'), ties: q('tie') }); })()`));
  drawn.moved = { ...picked, railOk, tieOk };
  writeFileSync(OUT.replace(/\.json$/, '') + '.drawn.json', JSON.stringify(drawn, null, 1));
  console.log('hand drag:', JSON.stringify(drawn.moved));
}
if (CUT) {
  const cut = JSON.parse(await evalJS(`(async()=>{ const ct = await import('./editor/editor-cut-tool.js'); const o = await import('./editor/editor-piece-override.js');
    const ed = window.svgEditor, L = ed._sketchLayer.node, sp = ed._grid.spacing || 0.25;
    const els = ed._sketchLayer.children().toArray().filter((e) => e.type === 'line' && e.node.hasAttribute('data-lattice-gen'));
    const P = (e) => ({ x1: +e.attr('x1'), y1: +e.attr('y1'), x2: +e.attr('x2'), y2: +e.attr('y2') });
    const rails = els.filter((e) => e.node.getAttribute('data-lattice') === 'rail'), ties = els.filter((e) => e.node.getAttribute('data-lattice') === 'tie');
    const horiz = (r) => Math.abs(P(r).y1 - P(r).y2) < 1e-9;
    const contacts = (r) => { const q = P(r), row = q.y1, lo = Math.min(q.x1, q.x2), hi = Math.max(q.x1, q.x2);
      return [...new Set(ties.flatMap((t) => [[P(t).x1, P(t).y1], [P(t).x2, P(t).y2]]).filter(([x, y]) => Math.abs(y - row) < 1e-9 && x > lo + 2 * sp && x < hi - 2 * sp).map(([x]) => x))].sort((a, b) => a - b); };
    const R = rails.filter(horiz).sort((a, b) => contacts(b).length - contacts(a).length)[0];
    const q = P(R), row = q.y1, lo = Math.min(q.x1, q.x2), hi = Math.max(q.x1, q.x2), cs = contacts(R);
    const onTie = cs[0];
    let mid = null; for (let u = Math.ceil((lo + 2 * sp) / sp) * sp; u <= hi - 2 * sp + 1e-9; u += sp) if (Math.abs(u - onTie) >= 3 * sp && !cs.some((c) => Math.abs(c - u) < 1e-9)) { mid = u; break; }
    const [s1, s2] = ct.cutAt(ed, R, { x: onTie, y: row });
    const right = s2, target = (mid > onTie) ? right : s1;
    const [t1, t2] = ct.cutAt(ed, target, { x: mid, y: row });
    const three = ed._sketchLayer.children().toArray().filter((e) => e.type === 'line' && e.node.getAttribute('data-lattice') === 'rail' && Math.abs(+e.attr('y1') - row) < 1e-9 && Math.abs(+e.attr('y2') - row) < 1e-9);
    o.applyColorOverride(three[0], 'rails', '#e53935'); o.applyColorOverride(three[1], 'rails', '#1e88e5');
    ed.pushState();
    return JSON.stringify({ row, onTie, mid, segments: three.map(P), colours: three.map((e) => e.node.getAttribute('data-override-color')) }); })()`));
  const drawn = JSON.parse(await evalJS(`(()=>{ const q=(k)=>[...window.svgEditor._sketchLayer.node.querySelectorAll('[data-lattice="'+k+'"][data-lattice-gen]')]
    .map(e=>({x1:+e.getAttribute('x1'),y1:+e.getAttribute('y1'),x2:+e.getAttribute('x2'),y2:+e.getAttribute('y2'),color:e.getAttribute('data-override-color')}));
    const ed=window.svgEditor; return JSON.stringify({ W: ed._mW, H: ed._mH, rails: q('rail'), ties: q('tie') }); })()`));
  drawn.cut = cut;
  writeFileSync(OUT.replace(/\.json$/, '') + '.drawn.json', JSON.stringify(drawn, null, 1));
  console.log('cut:', JSON.stringify(cut));
}
if (CARVE) {
  const carved = await evalJS(`(async()=>{ const L = await import('./editor/layers.js'); const ed = window.svgEditor;
    const want = ${JSON.stringify(CARVE_LAYERS)}; const done = [];
    for (const l of ed._layers || []) if (want.includes(l.name)) { L.setLayerCarve(ed, l.id, true); done.push(l.name); }
    await new Promise(r=>setTimeout(r,800));
    // the editor's own Apply (#editorApply -> onCommit -> refreshAllStampMasks) bakes the carving masks; the
    // 'apply stencils' button the step below looks for no longer exists. The remask is not awaited by the app.
    document.getElementById('editorApply').click(); await new Promise(r=>setTimeout(r,8000));
    return done.join(','); })()`);
  console.log('carve ON:', carved || 'NONE (no matching layer)');
}
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  [...document.querySelectorAll('button')].find(b => /apply stencils/i.test(b.textContent))?.click(); await W(4000);
})()`);
console.log('lattice pieces drawn:', built);
if (SCENARIO === 'brick-e2e') {
  const app = JSON.parse(await evalJS(`(async()=>{ const ed = window.svgEditor, S = await import('./core/state.js');
    const X = await import('./main/export-flow.js'); const T = await import('./editor/editor-brick-tool.js');
    const polys = [...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"]')];
    const byKind = {}; for (const p of polys) { const k = p.getAttribute('data-brick') || '?'; byKind[k] = (byKind[k] || 0) + 1; }
    const raised = polys.filter((p) => p.getAttribute('data-brick-accent-marked') === '1').length;
    const offs = polys.map((p) => +p.getAttribute('data-brick-height-offset') || 0).filter((v) => v !== 0);
    return JSON.stringify({ pieces: polys.length, byKind, accentMarked: raised, heightOffsets: [...new Set(offs)],
      areas: (T.wallAreaRecords ? T.wallAreaRecords(ed).length : null), carving: X.activeStampLayers().length,
      layers: ed._layers.map((l) => ({ id: l.id, name: l.name, carve: l.carve, holdsBricks: !!l.holdsBricks })),
      brickSettings: { setIds: S.P.brickSettings.setIds, pattern: S.P.brickSettings.pattern, accent: S.P.brickSettings.accent } }); })()`));
  writeFileSync(OUT.replace(/\.json$/, '') + '.app.json', JSON.stringify(app, null, 1));
  console.log('app readback:', JSON.stringify({ pieces: app.pieces, byKind: app.byKind, accentMarked: app.accentMarked, areas: app.areas, carving: app.carving }));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot?.result?.data) writeFileSync(OUT.replace(/\.json$/, '') + '.png', Buffer.from(shot.result.data, 'base64'));
}
if (CARVE) {
  const st = await evalJS(`(async()=>{ const X = await import('./main/export-flow.js');
    return JSON.stringify({ carving: X.activeStampLayers().length, exportable: X.exportableStampLayers().length,
      stencilBtn: !![...document.querySelectorAll('button')].find(b => /apply stencils/i.test(b.textContent)) }); })()`);
  console.log('after stencils:', st);
}
await evalJS(`(async()=>{ document.getElementById('btnDownload').click(); await new Promise(r=>setTimeout(r,30000)); })()`);
const sends = await evalJS('window.__sends');
const actions = (sends || []).map((s) => s[0]);
console.log('sends:', [...new Set(actions)].join(', '), '| total', actions.length);
const chunks = (sends || []).filter((s) => s[0] === 'generate_chunk').map((s) => JSON.parse(s[1]))
  .sort((a, b) => a.index - b.index).map((c) => c.data);
const single = (sends || []).find((s) => s[0] === 'generate');
const payload = chunks.length ? chunks.join('') : single?.[1];
if (!payload) { console.log('NO PAYLOAD captured'); chrome.kill(); process.exit(2); }
writeFileSync(OUT, payload);
if (SCENARIO === 'shape-lattice-frame') { // F21: the [Send frame] payload, the panel's own sendFrame()
  if (LIP !== '') await evalJS(`(async()=>{ const e = document.getElementById('framePanelLip'); e.value = '${LIP}'; e.dispatchEvent(new Event('change')); await new Promise(r=>setTimeout(r,500)); })()`);
  await evalJS(`(async()=>{ window.__sends = []; (await import('./main/frame-panel.js')).sendFrame(); })()`);
  const fs = (await evalJS('window.__sends') || []).find((q) => q[0] === 'send_frame');
  if (fs) writeFileSync(OUT.replace(/\.json$/, '') + '.frame.json', fs[1]);
  console.log('send_frame payload:', fs ? fs[1].length + ' bytes' : 'NONE');
}
const p = JSON.parse(payload);
console.log('payload keys:', Object.keys(p).join(', '));
console.log('bytes:', payload.length);
ws.close(); chrome.kill();
