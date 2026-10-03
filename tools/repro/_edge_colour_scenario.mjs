// Shared scenario builder for every live (CDP-driven) edge-colour repro script: template select,
// Shape Lattice generate with its contour Offset-from-frame ON, the real Stripe tool on every
// contour segment (black/white), and rails/ties/nodes coloured. Declared ONCE here so every new
// edge-colour repro script imports it instead of re-typing the same ~60-line block (items 67d/68/69
// each hand-copied it into their own now-deleted scratch scripts -- this is that block, named).
//
// H23 item 70 (Fred, via the advisor): edge-colour testing must use Offset-from-frame ON with
// DISTANCE 0 (the contour sits exactly on the board edge, not inset, so the edge-colour sampler
// genuinely samples the edge). Verified live (item 70's own check) that every prior edge-colour
// script already landed there BY DEFAULT -- the app auto-applies `fromFrame: {on:true, distance:0}`
// once a frame is chosen and no silhouette exists yet (properties-shape-lattice.js's own
// `_offsetFromFrameByDefault`), and the distance field's own HTML default is "0" -- but that
// default was never asserted EXPLICITLY anywhere, so a future change to either default could break
// every edge-colour repro silently. This helper sets it explicitly instead of relying on it.
//
// Usage: `import { buildEdgeColourScenario } from './_edge_colour_scenario.mjs';`
//   `await buildEdgeColourScenario(evalJS, sleep, { template: 'template_1' });`
// `evalJS`/`sleep` are the CALLING script's own (raw-CDP, no shared boilerplate -- same convention
// every tools/repro/*.mjs script already uses).

export async function buildEdgeColourScenario(evalJS, sleep, opts = {}) {
  const template = opts.template || 'template_1';

  // 1. Frame template.
  await evalJS(`(() => { const sel = document.getElementById('frameTemplate'); sel.value = '${template}'; sel.dispatchEvent(new Event('change')); return sel.value; })()`);
  await sleep(1200);

  // 2. Shape Lattice + Offset from frame (ON, distance EXPLICITLY 0 -- H23 item 70) + Generate.
  await evalJS(`document.getElementById('btnStampEdit').click(); true`);
  await sleep(2000);
  await evalJS(`document.getElementById('toolShapeLattice').click(); true`);
  await sleep(800);
  await evalJS(`(() => {
    const el = document.getElementById('shapeLatticeContourFromFrame');
    el.checked = true; el.dispatchEvent(new Event('input', { bubbles: true }));
    const d = document.getElementById('shapeLatticeContourFromFrameDistance');
    d.value = '0'; d.dispatchEvent(new Event('input', { bubbles: true })); d.dispatchEvent(new Event('change', { bubbles: true }));
    return { checked: el.checked, distance: d.value };
  })()`);
  await sleep(500);
  await evalJS(`document.getElementById('shapeLatticeGenerate').click(); true`);
  await sleep(3000);

  // 3. Stripe the CONTOUR black/white, every segment (items 66/67's own established technique).
  const stripeResult = await evalJS(`(async () => {
    document.getElementById('toolStripe').click();
    await new Promise(r => setTimeout(r, 400));
    window.svgEditor._stripe = { drive: 'count', count: 10, length: 1, three: false, colors: ['#000000', '#ffffff', null], ratio: [1] };
    const svg = document.querySelector('#editorSVGContainer svg');
    const tapAt = async (ex, ey) => {
      const pt = svg.createSVGPoint(); pt.x = ex; pt.y = ey;
      const screenPt = pt.matrixTransform(svg.getScreenCTM());
      const opts = { clientX: screenPt.x, clientY: screenPt.y, bubbles: true, cancelable: true, pointerId: 1, button: 0, isPrimary: true };
      document.elementFromPoint(screenPt.x, screenPt.y)?.dispatchEvent(new PointerEvent('pointerdown', opts));
      await new Promise(r => setTimeout(r, 30));
      window.dispatchEvent(new PointerEvent('pointerup', opts));
      await new Promise(r => setTimeout(r, 60));
    };
    let tapped = 0;
    for (let guard = 0; guard < 30; guard++) {
      const segs = [...document.querySelectorAll('[data-contour-seg]')].filter((s) => !s.hasAttribute('data-stripe'));
      if (!segs.length) break;
      const seg = segs[0];
      let ex, ey;
      if (seg.tagName === 'line') {
        ex = (parseFloat(seg.getAttribute('x1')) + parseFloat(seg.getAttribute('x2'))) / 2;
        ey = (parseFloat(seg.getAttribute('y1')) + parseFloat(seg.getAttribute('y2'))) / 2;
      } else if (seg.getTotalLength) {
        const len = seg.getTotalLength();
        if (!len) break;
        const p = seg.getPointAtLength(len / 2);
        ex = p.x; ey = p.y;
      } else break;
      await tapAt(ex, ey);
      tapped++;
    }
    return { tapped, remainingUnstriped: document.querySelectorAll('[data-contour-seg]:not([data-stripe])').length };
  })()`);

  // 4. Colour rails/ties/nodes too.
  await evalJS(`(() => {
    const wrap = (sel) => [...document.querySelectorAll(sel)].map(n => window.SVG.adopt(n)).filter(Boolean);
    window.svgEditor._selectMany(wrap('[data-lattice=rail]'));
    window.svgEditor.setColor('#c62828');
    window.svgEditor._selectMany(wrap('[data-lattice=tie]'));
    window.svgEditor.setColor('#f9c80e');
    window.svgEditor._selectMany(wrap('[data-lattice=node]'));
    window.svgEditor.setColor('#1a237e');
    window.svgEditor._selectMany([]);
    true;
  })()`);
  await sleep(300);

  return { stripeResult };
}
