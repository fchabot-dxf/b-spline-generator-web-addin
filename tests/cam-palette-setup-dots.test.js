// H23 item 82 (advisor: fix the status dots in this item). The CAM palette's B-spline report lights one status dot
// per setup. The old match turned 'B-spline Back' into 'b_spline_back' and looked for SETUP_KEYS 'bspline_back'
// with only ONE underscore stripped, so it never matched: only Stock and Frame ever lit up. The key now comes from
// one function, setupKeyFor(name), and every setup card the palette declares (data-setup + data-setup-name = the
// SETUP_SPECS name) must map onto its own dot.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const HTML = readFileSync('bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html', 'utf-8');

function paletteFn() {
  const keys = HTML.match(/const SETUP_KEYS = (\[[^\]]*\]);/);
  const fn = HTML.match(/function setupKeyFor\(name\) \{[\s\S]*?\n  \}/);
  if (!keys || !fn) return null;
  return new Function(`const SETUP_KEYS = ${keys[1]}; ${fn[0]}; return setupKeyFor;`)();
}

const CARDS = [...HTML.matchAll(/class="cam-card" data-setup="([^"]+)" data-setup-name="([^"]+)"/g)]
  .map((m) => ({ key: m[1], name: m[2] }));

describe('CAM palette: report setup names light their own status dot', () => {
  it('declares the four B-spline-mode cards', () => {
    expect(CARDS.map((c) => c.name)).toEqual(['Stock', 'B-spline Back', 'B-spline Top', 'Frame']);
  });

  it('SETUP_KEYS lists exactly the cards\' keys', () => {
    const keys = HTML.match(/const SETUP_KEYS = (\[[^\]]*\]);/);
    expect(JSON.parse(keys[1].replace(/'/g, '"'))).toEqual(CARDS.map((c) => c.key));
  });

  it('every card name maps onto its own dot key', () => {
    const setupKeyFor = paletteFn();
    expect(setupKeyFor).toBeTypeOf('function');
    for (const c of CARDS) expect(setupKeyFor(c.name)).toBe(c.key);
    for (const c of CARDS) expect(HTML).toContain(`id="dot-${c.key}"`);
  });

  it('an unknown setup name lights nothing', () => {
    expect(paletteFn()('Some Other Setup')).toBe(null);
  });
});
