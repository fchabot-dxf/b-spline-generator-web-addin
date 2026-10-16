/**
 * main/job-timeline-strip.js _renderDeltaBadge -- job-timeline step 3 slice 3 (Fred-approved mockup
 * shots/seatD/timeline/lock_mock_2_delta_tooltip.png): an amber "Δ .008" badge on the playhead's own tab, shown
 * only when the weighted Δ > 0; tap/hover opens a tooltip table (per surface: Δ × weight = weighted, then the
 * total), closed by an outside tap.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, bootRestore, setLastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { globalHistoryLog, globalRedoLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { renderJobStrips, moveHeadBefore } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';
import { setJobTimelineEnabled } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-enabled.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

const GRID_NX = 3, GRID_NZ = 3;
function fixture(topFill, backFill) {
  const heights = new Float32Array(GRID_NX * GRID_NZ).fill(topFill);
  const offsetPts = new Float32Array(GRID_NX * GRID_NZ * 3);
  for (let k = 0; k < GRID_NX * GRID_NZ; k++) offsetPts[k * 3 + 2] = backFill;
  return { heights, thickenData: { offsetPts }, nx: GRID_NX, nz: GRID_NZ };
}

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  setJobTimelineEnabled(true);
  window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }] };
  P.frame = null;
  P.jobTimeline = null;
  bootRestore.complete = true;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  setLastResult(null);
});

function headEl() { return document.querySelector('#jobStrip3d [data-job-head="1"]'); }

describe('no badge: the weighted Δ is 0', () => {
  it('nothing captured yet -- no .job-delta-badge at all', () => {
    renderJobStrips(document);
    expect(headEl().querySelector('.job-delta-badge')).toBeNull();
  });

  it('right after a capture (current === baseline): still no badge -- nothing has drifted yet', () => {
    setLastResult(fixture(1, -0.25));
    renderJobStrips(document); // default order: stock, seed, skeleton, filter, sculptTop, back, vector:L1
    moveHeadBefore('vector:L1'); // locks sculptTop ('top') and back ('back') -- captures both
    expect(P.jobTimeline.snapshots.top).toBeDefined();
    expect(P.jobTimeline.snapshots.back).toBeDefined();
    expect(headEl().querySelector('.job-delta-badge')).toBeNull();
  });

  it('advisor review (a live shot): quantization round-trip noise on a VARIED board never shows the badge, even though the raw score is technically nonzero', () => {
    // a flat fixture (fixture() above) round-trips through 16-bit quantization bit-exact (zero span -> one
    // bucket) -- it can never reproduce this. A varied field quantizes each cell to a DIFFERENT bucket, so
    // dequantizing back is only approximately equal to the live value (core/job-timeline-snapshot.js's own
    // round-trip test pins this to 3 decimals, not exact) -- a captured-then-immediately-read baseline is
    // "untouched" in every real sense, but its raw Δ is a tiny nonzero float, not literal 0.
    const nx = 3, nz = 3;
    const heights = new Float32Array([0, 0.37, 0.91, 0.12, 0.64, 0.08, 0.55, 0.23, 0.79]);
    const offsetPts = new Float32Array(nx * nz * 3);
    for (let k = 0; k < nx * nz; k++) offsetPts[k * 3 + 2] = -0.25;
    setLastResult({ heights, thickenData: { offsetPts }, nx, nz });
    renderJobStrips(document);
    moveHeadBefore('vector:L1'); // captures sculptTop ('top') + back baselines from these exact varied heights
    expect(headEl().querySelector('.job-delta-badge')).toBeNull();
  });
});

describe('the badge + tooltip once the weighted Δ is > 0', () => {
  function lockThenDrift() {
    setLastResult(fixture(1, -0.25));
    renderJobStrips(document);
    moveHeadBefore('vector:L1'); // captures top (sculptTop) + back baselines; no frame on this fixture's board
    setLastResult(fixture(1.1, -0.4)); // top Δ = 0.1, back Δ = 0.15, frame Δ = 0 (no frame)
    renderJobStrips(document);
  }

  it('the badge reads the mockup\'s own short form ("Δ .175", no leading 0)', () => {
    lockThenDrift();
    const badge = headEl().querySelector('.job-delta-badge');
    expect(badge).not.toBeNull();
    // score = 1*0.15 (back) + 1*0 (frame) + 0.25*0.1 (top) = 0.175
    expect(badge.textContent).toBe('Δ .175');
  });

  it('the tooltip table: Back/Frame/Top rows (Δ × weight = weighted), the total, and the "shown only" note', () => {
    lockThenDrift();
    const tip = headEl().querySelector('.job-delta-tooltip');
    expect(tip).not.toBeNull();
    expect(tip.hidden).toBe(true); // closed until opened
    const text = tip.textContent;
    expect(text).toContain('Changed since the cut');
    expect(text).toContain('Back');
    expect(text).toContain('0.150"');
    expect(text).toContain('Frame');
    expect(text).toContain('0.000"');
    expect(text).toContain('Top');
    expect(text).toContain('0.100"');
    expect(text).toContain('0.025"'); // top's own weighted contribution (0.1 x 0.25)
    expect(text).toContain('0.175"'); // the total
    expect(text).toContain('Shown only -- nothing is blocked.');
  });

  it('clicking the badge opens the tooltip; clicking again closes it', () => {
    lockThenDrift();
    const badge = headEl().querySelector('.job-delta-badge');
    const tip = headEl().querySelector('.job-delta-tooltip');
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tip.hidden).toBe(false);
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tip.hidden).toBe(true);
  });

  it('hovering the badge opens it; an outside click closes it', () => {
    lockThenDrift();
    const badge = headEl().querySelector('.job-delta-badge');
    const tip = headEl().querySelector('.job-delta-tooltip');
    badge.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tip.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tip.hidden).toBe(true);
  });
});

describe('the Settings switch off: no badge, same as the rest of the strip', () => {
  it('score > 0 but the switch is off -- renderJobStrips clears the whole strip first', () => {
    setLastResult(fixture(1, -0.25));
    setJobTimelineEnabled(true);
    renderJobStrips(document);
    moveHeadBefore('vector:L1');
    setLastResult(fixture(1.1, -0.4));
    setJobTimelineEnabled(false);
    renderJobStrips(document);
    expect(document.getElementById('jobStrip3d')).toBeNull(); // _clearStrips removes the bar entirely
  });
});
