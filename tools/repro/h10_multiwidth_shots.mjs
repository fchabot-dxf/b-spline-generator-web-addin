// H10 acceptance shots: the header stays ONE row (no empty first row) and
// Stock Dimensions' Width/Height steppers never clip, at every width Fred
// asked for -- phone (390) through iPad portrait/landscape (768/834/1024/
// 1366). All widths use pointer:coarse (touch) since that's what actually
// gates the mobile header/stepper CSS, not viewport width alone -- iPad
// keeps the DESKTOP fixed-260px sidebar (only max-width:700 switches to a
// full-width stacked sidebar) while still matching the coarse-pointer
// block, which is exactly what caused the Height stepper to clip there.
//   node tools/repro/h10_multiwidth_shots.mjs <outPrefix> <paletteUrl> [port]
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9592);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-h10-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) {}
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r, rej) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); } }, 15000);
});
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');

const WIDTHS = [
  { w: 390, h: 844, name: '390' },
  { w: 768, h: 1024, name: '768' },
  { w: 834, h: 1194, name: '834' },
  { w: 1024, h: 768, name: '1024' },
  { w: 1366, h: 1024, name: '1366' },
];

for (const { w, h, name } of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: URL });
  await sleep(name === WIDTHS[0].name ? 6000 : 3000);

  check((await evalJS('document.documentElement.scrollWidth')) <= w, `H10@${name}: no horizontal scroll`);

  const headerInfo = JSON.parse(await evalJS(`(()=>{
    const nav = document.querySelector('.cad-navbar');
    const group = nav.querySelector('.cad-nav-group');
    const actions = nav.querySelector('.cad-navbar-actions');
    const gr = group.getBoundingClientRect(), ar = actions.getBoundingClientRect(), nr = nav.getBoundingClientRect();
    const oneRow = Math.abs((gr.top + gr.height / 2) - (ar.top + ar.height / 2)) < 5;
    return JSON.stringify({ navHeight: Math.round(nr.height), oneRow, navRight: Math.round(ar.right) });
  })()`));
  console.log(`header@${name}:`, JSON.stringify(headerInfo));
  check(headerInfo.oneRow, `H10@${name}: back+dot and the action buttons share ONE row (navHeight=${headerInfo.navHeight})`);
  check(headerInfo.navRight <= w + 0.5, `H10@${name}: the action buttons stay within the viewport (right=${headerInfo.navRight})`);

  await evalJS(`[...document.querySelectorAll('.panel-header.collapsed')].forEach(h=>h.click())`);
  await sleep(200);
  const stepperInfo = JSON.parse(await evalJS(`(()=>{
    const sidebar = document.querySelector('.cad-sidebar');
    const sr = sidebar.getBoundingClientRect();
    const widthIn = document.getElementById('widthIn'), heightIn = document.getElementById('heightIn');
    const wStepper = widthIn.closest('.cad-stepper'), hStepper = heightIn.closest('.cad-stepper');
    const check1 = (input, stepper) => {
      const btns = [...stepper.querySelectorAll('button')].map(b => b.getBoundingClientRect());
      const ir = input.getBoundingClientRect(), sr2 = stepper.getBoundingClientRect();
      return { inputW: Math.round(ir.width), btnWidths: btns.map(b => Math.round(b.width)),
        clipped: sr2.right > sr.right + 0.5 || btns.some(b => b.right > sr.right + 0.5) };
    };
    return JSON.stringify({ width: check1(widthIn, wStepper), height: check1(heightIn, hStepper) });
  })()`));
  console.log(`steppers@${name}:`, JSON.stringify(stepperInfo));
  check(!stepperInfo.width.clipped && stepperInfo.width.inputW >= 20 && stepperInfo.width.btnWidths.every(b => b >= 20),
    `H10@${name}: Width stepper not clipped, input/buttons visible (${JSON.stringify(stepperInfo.width)})`);
  check(!stepperInfo.height.clipped && stepperInfo.height.inputW >= 20 && stepperInfo.height.btnWidths.every(b => b >= 20),
    `H10@${name}: Height stepper not clipped, input/buttons visible (${JSON.stringify(stepperInfo.height)})`);

  // H12 (Fred: V-Bit Angle's stepper showed an empty grey box trailing
  // after "+" -- a NESTED .cad-stepper, inside a wider .cad-nested-input,
  // didn't fill its own parent, leaving the parent's own background
  // visible past the last button). General sweep so a stray like this
  // can't hide again: every VISIBLE stepper on the page, wherever it
  // lives, must have (a) exactly its own buttons+input as children (no
  // stray extra element inside the .cad-stepper itself), (b) its
  // outermost VISIBLE box (the .cad-nested-input parent when nested,
  // else the .cad-stepper itself) with NO gap before the first button or
  // after the last one, and (c) both buttons the same width as each
  // other.
  const allSteppers = JSON.parse(await evalJS(`(()=>{
    const steppers = [...document.querySelectorAll('.cad-stepper')].filter(s => s.getBoundingClientRect().width > 0);
    return JSON.stringify(steppers.map((stepper) => {
      const btns = [...stepper.querySelectorAll('button')];
      const input = stepper.querySelector('input');
      const container = stepper.parentElement.classList.contains('cad-nested-input') ? stepper.parentElement : stepper;
      const cr = container.getBoundingClientRect();
      const firstBtn = btns[0]?.getBoundingClientRect();
      const lastBtn = btns[btns.length - 1]?.getBoundingClientRect();
      const widths = btns.map(b => Math.round(b.getBoundingClientRect().width));
      return {
        id: input?.id || '(no id)',
        structureOk: stepper.children.length === btns.length + 1,
        // 3px tolerance: a nested stepper's outer box (.cad-nested-input)
        // and the stepper's own box can each carry a 1px border, so up to
        // ~2px of that is legitimate border chrome, not a stray gap --
        // measured live (H12): a genuinely un-nested stepper is ~1px, the
        // V-Bit bug before its fix was 108px, nothing legitimate sits
        // in between.
        noLeadingGap: firstBtn ? Math.abs(cr.left - firstBtn.left) < 3 : true,
        noTrailingGap: lastBtn ? Math.abs(cr.right - lastBtn.right) < 3 : true,
        consistentWidths: widths.length < 2 || widths.every(w => Math.abs(w - widths[0]) < 1),
        widths,
      };
    }));
  })()`));
  console.log(`allSteppers@${name}: ${allSteppers.length} visible steppers checked`, JSON.stringify(allSteppers));
  for (const s of allSteppers) {
    check(s.structureOk, `H12@${name}: stepper "${s.id}" has only its own buttons+input as children`);
    check(s.noLeadingGap, `H12@${name}: stepper "${s.id}" has no leading gap before its first button`);
    check(s.noTrailingGap, `H12@${name}: stepper "${s.id}" has no trailing gap after its last button (widths=${JSON.stringify(s.widths)})`);
    check(s.consistentWidths, `H12@${name}: stepper "${s.id}" has matching -/+ button widths (${JSON.stringify(s.widths)})`);
  }

  // H10/H12: every label + its trailing muted sub-label ("Width (X)",
  // "Offset X (screens)", etc.) must stay on one line. These labels are
  // `display:flex` (base.css's global rule), so a stacked layout is still
  // ONE block-level box -- label.getClientRects() always reports exactly 1
  // rect whether the two children sit side by side OR stacked (caught
  // live, H10: an earlier version of this check used that and passed even
  // against the unfixed, genuinely-stacked baseline, i.e. it was vacuous).
  // Comparing the leading text node's own line position against the
  // trailing span's instead: same row -> vertical centers match; stacked
  // -> the span sits a line-height below.
  // H12: generalized from 3 hardcoded ids (Width/Height/Carve Depth) to
  // every `.cad-label-inline` on the page -- H12 gave every label with
  // this exact shape that SAME declared class (base.css), so querying it
  // directly covers all 14 (and any future one) without hardcoding ids.
  // Filtered to visible ones only (width>0), same reasoning as the
  // stepper check above -- a label inside a still-collapsed panel or a
  // closed modal (the Skeleton-Editor fullscreen editor's own copies)
  // measures 0x0 and isn't a real failure.
  const labelInfo = JSON.parse(await evalJS(`(()=>{
    const sidebar = document.querySelector('.cad-sidebar');
    const sidebarRight = sidebar.getBoundingClientRect().right;
    const labels = [...document.querySelectorAll('label.cad-label-inline')]
      .filter(label => label.getBoundingClientRect().width > 0);
    return JSON.stringify(labels.map((label) => {
      const span = label.querySelector('span');
      const textNode = [...label.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const textRect = range.getClientRects()[0];
      const spanRect = span.getBoundingClientRect();
      const sameLine = Math.abs((textRect.top + textRect.height / 2) - (spanRect.top + spanRect.height / 2)) < 5;
      const overflows = spanRect.right > sidebarRight + 0.5;
      return { sameLine, overflows, text: label.textContent.trim() };
    }));
  })()`));
  console.log(`labels@${name}: ${labelInfo.length} visible labels checked`, JSON.stringify(labelInfo));
  for (const l of labelInfo) {
    check(l.sameLine, `H12@${name}: label "${l.text}" stays on one line`);
    check(!l.overflows, `H12@${name}: label "${l.text}" doesn't overflow the sidebar`);
  }

  // H10: the main Seed number field is hidden (not deleted) -- Generate
  // New Seed is the only way to re-roll now.
  const seedInfo = JSON.parse(await evalJS(`(()=>{
    const seed = document.getElementById('seed');
    return JSON.stringify({ seedVisible: seed.getBoundingClientRect().width > 0, seedInDom: !!seed });
  })()`));
  console.log(`seed@${name}:`, JSON.stringify(seedInfo));
  check(seedInfo.seedInDom && !seedInfo.seedVisible, `H10@${name}: #seed stays in the DOM but hidden (${JSON.stringify(seedInfo)})`);

  await evalJS(`document.getElementById('carveZ').scrollIntoView({block:'center'})`);
  await sleep(150);
  await shot(name);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);
