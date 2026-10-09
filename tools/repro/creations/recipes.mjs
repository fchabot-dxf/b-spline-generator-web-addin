// The ten "claude" creations, DECLARED: each piece is one idea -- a concept, a title and two or three hand-chosen,
// complementary effects -- rebuilt by capture_creations.mjs (the step kinds live in page_steps.js). Board coordinates:
// inches, origin top-left, y down (the editor's own frame). Order = presentation order (claude 1 .. claude 10).

// ---- composed motifs (pure geometry -> point lists / SVG path data) ----
const f3 = (v) => +v.toFixed(3);
/** a sine wave from x0 to x1 around y */
export const wave = (x0, x1, y, amp, periods, n = 80) => Array.from({ length: n + 1 }, (_, k) => {
  const t = k / n; return [f3(x0 + (x1 - x0) * t), f3(y + amp * Math.sin(t * periods * 2 * Math.PI))];
});
/** an arc of a circle from angle a0 to a1 (radians; y down, so +angle turns clockwise on screen) */
export const arc = (cx, cy, r, a0, a1, n = 60) => Array.from({ length: n + 1 }, (_, k) => {
  const a = a0 + (a1 - a0) * k / n; return [f3(cx + r * Math.cos(a)), f3(cy + r * Math.sin(a))];
});
/** a circle as a point list */
export const ring = (cx, cy, r, n = 72) => arc(cx, cy, r, 0, 2 * Math.PI, n);
/** evenly spaced points on a segment */
export const line = (x0, y0, x1, y1, n) => Array.from({ length: n }, (_, k) => [f3(x0 + (x1 - x0) * k / (n - 1)), f3(y0 + (y1 - y0) * k / (n - 1))]);
/** a point list as SVG path data */
export const pathOf = (pts) => 'M ' + pts.map(([x, y]) => `${x} ${y}`).join(' L ');
/** rays around a centre, as SVG path data (from radius a to b) */
export const rays = (cx, cy, a, b, count, start = 0) => Array.from({ length: count }, (_, k) => {
  const t = start + k * 2 * Math.PI / count; return `M ${f3(cx + a * Math.cos(t))} ${f3(cy + a * Math.sin(t))} L ${f3(cx + b * Math.cos(t))} ${f3(cy + b * Math.sin(t))}`;
}).join(' ');
/** small filled dots (sand grains, stars) as SVG path data */
export const dots = (pts, r) => pts.map(([x, y]) => `M ${f3(x - r)} ${y} A ${r} ${r} 0 1 0 ${f3(x + r)} ${y} A ${r} ${r} 0 1 0 ${f3(x - r)} ${y} Z`).join(' ');

const FRONT = { theta: 0.15, phi: 0.6 };

export const CREATIONS = [
  {
    title: 'Sandglass',
    concept: 'Harmony: a sand timer told in relief -- a dune terrain, two hand-sculpted dune crests swept in opposite directions in the two bulbs, and a raised trickle of sand grains falling through the waist.',
    template: 'template_14', board: [8, 10], seed: 101,
    steps: [
      { frame: { template: 'template_14' } },
      { filter: { id: 'dunes' } },
      { params: { carveZ: 0.5, symmetry: 'none' } },
      { sculpt: { mode: 'draw', radius: 0.8, strength: 0.01, strokes: [
        { pts: wave(2.0, 6.0, 2.6, 0.4, 1), dy: -2, step: 0.15 },
        { pts: wave(2.0, 6.0, 7.4, -0.4, 1), dy: -2, step: 0.15 } ] } },
      { sculpt: { mode: 'smooth', radius: 0.8, strength: 0.01, strokes: [
        { pts: wave(2.0, 6.0, 2.6, 0.4, 1), dy: 2, step: 0.2 },
        { pts: wave(2.0, 6.0, 7.4, -0.4, 1), dy: 2, step: 0.2 } ] } },
      { art: { layer: { name: 'Sand', depth: 0.12, profile: 'ballnose' }, paths: [{ d: dots(line(4, 3.9, 4, 6.1, 9), 0.09), width: 0.02, fill: '#c9a227', color: '#c9a227' }] } },
    ],
    view: FRONT,
  },
  {
    title: 'Garden Gate',
    concept: 'Contrast: an arched gate where a weathered grey fieldstone ring laid to the mitred frame rings a crisp red-brick herringbone court -- rough rustic stone against precise geometric brick, both laid as real layouts with recessed grout.',
    template: 'template_10', board: [9, 12], seed: 202,
    steps: [
      { frame: { template: 'template_10' } },
      { filter: { id: 'simplex' } },
      { params: { carveZ: 0.25 } },
      { bricks: { size: 1.25, frameSet: 5, framePreset: 'three_band', wallSet: 1, wallPattern: 'herringbone', frame: true, wall: true, surface: 'weathered', wear: 0.6 } },
    ],
    view: FRONT,
  },
  {
    title: 'Ripple Echo',
    concept: 'Harmony: the hourglass echoing itself -- three raised contour rings, each a true inward offset of the mitred frame outline, ripple in toward a sculpted dome at the waist over a soft silk relief.',
    template: 'template_1', board: [7, 9], seed: 303,
    steps: [
      { frame: { template: 'template_1' } },
      { filter: { id: 'silk' } },
      { params: { carveZ: 0.3, symmetry: 'none' } },
      { sculpt: { mode: 'inflate', radius: 1.3, strength: 0.01, strokes: [{ pts: ring(3.5, 4.5, 0.25, 24), dy: -2, step: 0.1 }] } },
      { echo: { layer: { name: 'Echo', depth: 0.12, profile: 'vbit' }, offsets: [1.0, 1.45, 1.9], width: 0.1 } },
    ],
    view: FRONT,
  },
  {
    title: 'Pebble Window',
    concept: 'Contrast: a riverbed photograph of close pebbles turned into relief (turned a quarter, softened with blur) fills the narrow-neck panel, and one crisp mitred inset window cuts through it -- organic photo texture against a hard rectangle.',
    template: 'template_13', board: [8, 10], seed: 404,
    steps: [
      { frame: { template: 'template_13', insetWindow: { cx: 0, cy: -1.4, w: 3.0, h: 3.6 } } },
      { params: { symmetry: 'none' } },
      { photo: { pattern: 'pebble_close', rotate: 1, blur: 1, height: 0.25 } },
    ],
    view: FRONT,
  },
  {
    title: 'Rising Sun',
    concept: 'Harmony: an arched-head panel as a sunrise window -- a sculpted dome lifting a raised sun disc and twelve rays, with ripples spreading out below like water.',
    template: 'template_18', board: [9, 12], seed: 505,
    steps: [
      { frame: { template: 'template_18' } },
      { filter: { id: 'ripples' } },
      { params: { carveZ: 0.35, symmetry: 'none', spacing: '0.03' } },
      { sculpt: { mode: 'inflate', radius: 1.4, strength: 0.01, strokes: [{ pts: ring(4.5, 4.0, 0.2, 24), dy: -2, step: 0.1 }] } },
      { art: { layer: { name: 'Sun', depth: 0.15, profile: 'ballnose' }, paths: [
        { d: pathOf(ring(4.5, 4.0, 0.9)), width: 0.18, color: '#e0a800' },
        { d: rays(4.5, 4.0, 1.3, 2.1, 12, Math.PI / 12), width: 0.16, color: '#e0a800' } ] } },
    ],
    view: FRONT,
  },
  {
    title: 'Courtyard',
    concept: 'Harmony: a roofed courtyard in plan -- a red three-band brick border, a basketweave court, and a raised brick path running straight up the axis to the gable, one material in three courses.',
    template: 'template_11', board: [10, 14], seed: 606,
    steps: [
      { frame: { template: 'template_11' } },
      { filter: { id: 'simplex' } },
      { params: { carveZ: 0.2 } },
      { bricks: { size: 1, frameSet: 1, framePreset: 'three_band', wallSet: 1, wallPattern: 'basketweave', frame: true, wall: true } },
      { raisedBrush: { level: 0.09, preset: 'stretcher_2_running', points: [[5, 12.9], [5, 4.6]] } },
    ],
    view: FRONT,
  },
  {
    title: 'Moon Garden',
    concept: 'Contrast: a small night piece -- a cratered moon terrain, a hand-sculpted crescent ridge rising out of it, and a scatter of crisp raised star points -- smooth hand-sculpted form against the pocked surface, at keepsake size.',
    template: 'template_5', board: [5, 7], seed: 707,
    steps: [
      { frame: { template: 'template_5' } },
      { filter: { id: 'moon' } },
      { params: { carveZ: 0.4, symmetry: 'none' } },
      { sculpt: { mode: 'draw', radius: 0.4, strength: 0.012, strokes: [{ pts: arc(2.6, 3.6, 1.3, 1.75, 4.55, 50), dy: -3, step: 0.06 }] } },
      { sculpt: { mode: 'smooth', radius: 0.5, strength: 0.01, strokes: [{ pts: arc(2.6, 3.6, 1.3, 1.75, 4.55, 50), dy: 2, step: 0.15 }] } },
      { art: { layer: { name: 'Stars', depth: 0.12, profile: 'ballnose' }, paths: [{ d: dots([[1.3, 1.7], [3.6, 1.5], [3.9, 2.6], [1.1, 5.4], [3.7, 5.6], [2.9, 6.1]], 0.12), width: 0.02, fill: '#ffffff', color: '#ffffff' }] } },
    ],
    view: FRONT,
  },
  {
    title: 'Signet',
    concept: 'Contrast: an I-shaped tablet -- grey brick in a custom bond drawn in the pattern builder (its accent cells standing proud), painted as three wall areas that fill the stem and both flanges, ringed by a red soldier course.',
    template: 'template_9', board: [9, 12], seed: 808,
    steps: [
      { frame: { template: 'template_9' } },
      { filter: { id: 'simplex' } },
      { params: { carveZ: 0.2 } },
      { bricks: { size: 1, frameSet: 1, framePreset: 'single_soldier', wallSet: 4, frame: true, wall: true } },
      { builder: { base: 'custom', unit: 0.5, joins: [[0, 0, 1]], raised: [[0, 0], [1, 2]], levelIn: 0.0625 } },
      { areas: { width: 2, list: [{ pattern: 'builder', points: [[4.5, 1.6], [4.5, 10.4]] }, { pattern: 'builder', points: [[1.4, 2.2], [7.6, 2.2]] }, { pattern: 'builder', points: [[1.4, 9.8], [7.6, 9.8]] }] } },
    ],
    view: FRONT,
  },
  {
    title: 'Lantern',
    concept: 'Contrast: a diamond-topped lantern -- a rigid leaded grid (Box Lattice, ties bridging rail to rail) laid over a faceted cut-glass relief inside the flowing bottle outline, with a mitred inset window as the lantern door.',
    template: 'template_7', board: [8, 10], seed: 909,
    steps: [
      { frame: { template: 'template_7', insetWindow: { cx: 0, cy: -1.4, w: 3.2, h: 3.4 } } },
      { filter: { id: 'faceted' } },
      { params: { carveZ: 0.4 } },
      { lattice: { kind: 'box', orientation: 'vertical', clicks: ['latticeTiesSpanModeRails', 'latticeTiesModeCount'], set: { latticeRailsSpacing: 0.8, latticeTiesCountMin: 18, latticeTiesCountMax: 22 }, layers: { Rails: { carve: true }, Ties: { carve: true }, Nodes: { carve: true } } } },
    ],
    view: FRONT,
  },
  {
    title: 'Grand Arch',
    concept: 'Harmony: the large piece -- an arched funnel with a weathered grey-stone surround matched to an eroded, rugged terrain, and one sculpted ridge arching under the head to echo it.',
    template: 'template_16', board: [12, 16], seed: 1010,
    steps: [
      { frame: { template: 'template_16' } },
      { filter: { id: 'eroded' } },
      { params: { carveZ: 0.5, symmetry: 'none' } },
      { sculpt: { mode: 'draw', radius: 0.9, strength: 0.01, strokes: [{ pts: arc(6, 7.5, 3.4, Math.PI * 1.15, Math.PI * 1.85, 50), dy: -3, step: 0.12 }] } },
      { bricks: { size: 1.25, frameSet: 5, framePreset: 'mixed_bands', frame: true, surface: 'weathered', wear: 0.6 } },
    ],
    view: FRONT,
  },
];
