// The "claude" creations, DECLARED: each piece is one idea -- a concept (harmony or contrast, and why), a title and
// two or three hand-chosen effects -- rebuilt by capture_creations.mjs (the step kinds live in page_steps.js). Board
// coordinates: inches, origin top-left, y down (the editor's own frame). Order = presentation order (claude 1 .. 4;
// pieces 5-10 are other agents' and live in their own recipe slots).
// Art comes in two declared styles (Fred): HAND-DRAWN = many short jittered strokes (sketch / leaves), or PRECISE =
// many small exact repeats (dots, petals, chevrons) -- never one big perfect shape.

// ---- composed motifs (pure geometry -> point lists / SVG path data) ----
export const f3 = (v) => +v.toFixed(3);
/** a seeded PRNG (mulberry32): the same seed redraws the same hand */
export const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** an arc of a circle from angle a0 to a1 (radians; y down, so +angle turns clockwise on screen) */
export const arc = (cx, cy, r, a0, a1, n = 60) => Array.from({ length: n + 1 }, (_, k) => {
  const a = a0 + (a1 - a0) * k / n; return [f3(cx + r * Math.cos(a)), f3(cy + r * Math.sin(a))];
});
/** a circle as a point list */
export const ring = (cx, cy, r, n = 72) => arc(cx, cy, r, 0, 2 * Math.PI, n);
/** points along an Archimedean spiral (angle a0 -> a1, radius r0 -> r1) */
export const spiral = (cx, cy, r0, r1, a0, a1, n = 160) => Array.from({ length: n + 1 }, (_, k) => {
  const t = k / n, a = a0 + (a1 - a0) * t, r = r0 + (r1 - r0) * t; return [f3(cx + r * Math.cos(a)), f3(cy + r * Math.sin(a))];
});
/** a point list as SVG path data */
export const pathOf = (pts) => 'M ' + pts.map(([x, y]) => `${f3(x)} ${f3(y)}`).join(' L ');
/** a polyline by arc length: the point and unit tangent at distance s */
export const along = (pts) => {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (s) => { let i = 1; while (i < pts.length - 1 && cum[i] < s) i++; const L = cum[i] - cum[i - 1] || 1, u = Math.max(0, Math.min(1, (s - cum[i - 1]) / L));
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u, tx: (x1 - x0) / L, ty: (y1 - y0) / L }; };
  return { total: cum[cum.length - 1], at };
};
/**
 * HAND-DRAWN: walks the guide polyline in short strokes of seg[0]..seg[1] in (each overlapping the last by up to
 * `overlap`), every point nudged up to `jitter` in and each stroke slightly bowed. SVG path data, one subpath per
 * stroke; the same `rand` seed redraws it identically.
 */
export function sketch(pts, rand, { seg = [0.22, 0.42], overlap = 0.08, jitter = 0.025 } = {}) {
  const g = along(pts), out = [];
  const j = () => (rand() * 2 - 1) * jitter;
  for (let s = 0; s < g.total - 0.02;) {
    const len = seg[0] + rand() * (seg[1] - seg[0]), e = Math.min(g.total, s + len);
    const a = g.at(s), m = g.at((s + e) / 2), b = g.at(e), bow = (rand() * 2 - 1) * jitter;
    out.push(`M ${f3(a.x + j())} ${f3(a.y + j())} Q ${f3(m.x - m.ty * bow + j())} ${f3(m.y + m.tx * bow + j())} ${f3(b.x + j())} ${f3(b.y + j())}`);
    if (e >= g.total) break;
    s = e - rand() * overlap;
  }
  return out.join(' ');
}
/** HAND-DRAWN leaves along a guide: every ~`every` in, alternating sides, each leaf two short sketched arcs */
export function leaves(pts, rand, { every = 0.55, size = 0.32, start = 0.4 } = {}) {
  const g = along(pts), out = [];
  for (let s = start, side = 1; s < g.total - 0.2; s += every * (0.85 + rand() * 0.3), side = -side) {
    const p = g.at(s), nx = -p.ty * side, ny = p.tx * side, ang = 0.6 + rand() * 0.4;
    const tip = [p.x + (nx * Math.cos(ang) + p.tx * Math.sin(ang)) * size, p.y + (ny * Math.cos(ang) + p.ty * Math.sin(ang)) * size];
    const mid = [(p.x + tip[0]) / 2, (p.y + tip[1]) / 2], w = size * 0.28;
    out.push(sketch([[p.x, p.y], [mid[0] + p.tx * w, mid[1] + p.ty * w], tip], rand, { seg: [0.12, 0.2], jitter: 0.012 }));
    out.push(sketch([[p.x, p.y], [mid[0] - p.tx * w, mid[1] - p.ty * w], tip], rand, { seg: [0.12, 0.2], jitter: 0.012 }));
  }
  return out.join(' ');
}

/** PRECISE: a pointed (equilateral) gothic arch -- springline y, sides x0..x1, sill y1 -- as an inside test + outline */
export const gothicArch = (x0, x1, spring, sill) => {
  const w = x1 - x0;
  const inside = (x, y) => x >= x0 && x <= x1 && y <= sill && (y >= spring || (Math.hypot(x - x1, y - spring) <= w && Math.hypot(x - x0, y - spring) <= w));
  const apexA = -Math.PI / 3; // from the right centre, the left arc runs from angle PI (springline) up to the apex
  const outline = [[x0, sill], [x0, spring], ...arc(x1, spring, w, Math.PI, Math.PI + Math.PI / 3, 30).slice(1), ...arc(x0, spring, w, -Math.PI / 3, 0, 30).slice(1), [x1, sill], [x0, sill]];
  return { inside, outline, apexA };
};
/** PRECISE: a field of small exact diamonds (quarry glazing) on a pitch, kept where all four corners are inside */
export const diamondField = (inside, x0, x1, y0, y1, px, py, hx, hy) => {
  const out = [];
  for (let r = 0, y = y0; y <= y1; r++, y += py) for (let x = x0 + (r % 2 ? px / 2 : 0); x <= x1; x += px) {
    const c = [[x, y - hy], [x + hx, y], [x, y + hy], [x - hx, y]];
    if (c.every(([cx, cy]) => inside(cx, cy))) out.push('M ' + c.map(([cx, cy]) => `${f3(cx)} ${f3(cy)}`).join(' L ') + ' Z');
  }
  return out.join(' ');
};

/** PRECISE: bubbles -- small exact circles, seeded positions in a box, smaller and denser toward the top */
export const bubbles = (rand, x0, x1, y0, y1, count, rMin, rMax) => {
  const out = [], placed = [];
  for (let k = 0, tries = 0; k < count && tries < count * 40; tries++) {
    const t = Math.pow(rand(), 0.8), y = y0 + (y1 - y0) * t, x = x0 + (x1 - x0) * rand(), r = rMin + (rMax - rMin) * t * (0.6 + 0.4 * rand());
    if (placed.some(([px, py, pr]) => Math.hypot(px - x, py - y) < pr + r + 0.06)) continue;
    placed.push([x, y, r]); k++;
    out.push(`M ${f3(x - r)} ${f3(y)} A ${f3(r)} ${f3(r)} 0 1 0 ${f3(x + r)} ${f3(y)} A ${f3(r)} ${f3(r)} 0 1 0 ${f3(x - r)} ${f3(y)} Z`);
  }
  return out.join(' ');
};
/** PRECISE: rain -- short slanted dashes on a staggered grid */
export const rain = (x0, x1, y0, y1, px, py, len, angDeg) => {
  const a = angDeg * Math.PI / 180, dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2, out = [];
  for (let r = 0, y = y0; y <= y1; r++, y += py) for (let x = x0 + (r % 2 ? px / 2 : 0); x <= x1; x += px) out.push(`M ${f3(x - dx)} ${f3(y - dy)} L ${f3(x + dx)} ${f3(y + dy)}`);
  return out.join(' ');
};

const FRONT = { theta: 0.15, phi: 0.6 };
/** the vine's guide: a sinuous climb up the trellis, bottom to top */
const climb = (x, y0, y1, amp, periods, n = 120) => Array.from({ length: n + 1 }, (_, k) => {
  const t = k / n; return [f3(x + amp * Math.sin(t * periods * 2 * Math.PI) * (0.6 + 0.4 * t)), f3(y0 + (y1 - y0) * t)];
});
const VINE = climb(3.5, 8.0, 1.3, 0.85, 1.75);
const WOOD = { rail: '#6d4c41', tie: '#6d4c41', node: '#5d4037' };
const ARCH = gothicArch(2.7, 5.3, 4.3, 10.0);

export const CREATIONS = [
  {
    n: 1, title: 'Hourglass Garden',
    concept: 'Harmony: a garden trellis that follows the hourglass -- its slats pinch at the waist and flare into the bulbs, braced into diamonds, all built on the frame-offset contour (the Shape Lattice offset-from-frame) -- with a hand-drawn vine (many short jittered strokes, alternating leaves) climbing one slat, inside a weathered grey fieldstone ring.',
    template: 'template_1', board: [7, 9], seed: 111,
    steps: [
      { frame: { template: 'template_1' } },
      { filter: { id: 'mycelium' } },
      { params: { carveZ: 0.9, symmetry: 'none' } },
      { bricks: { size: 1, frameSet: 5, framePreset: 'single_soldier', frame: true, surface: 'weathered', wear: 0.6 } },
      { trellis: { layer: { name: 'Trellis', depth: 0.1, profile: 'vbit' }, distance: 1.05, rails: 5, brace: 0.95, width: 0.1, color: '#6d4c41',
        vine: { rail: 3, amp: 0.35, wave: 1.6, seed: 11, width: 0.09, layer: { name: 'Vine', depth: 0.2, profile: 'ballnose' }, leaves: { every: 0.45, size: 0.36 } } } },
    ],
    view: FRONT,
  },
  {
    n: 2, title: 'Sand Timer',
    concept: 'Contrast: masonry against flow -- crisp running-bond red bricks fill the upper bulb of a tapered hourglass, and below the waist a narrow raised stream of sand falls onto a V-bit cone pile with a crisp apex, all inside a weathered grey fieldstone ring.',
    template: 'template_3', board: [8, 10], seed: 222,
    steps: [
      { frame: { template: 'template_3' } },
      { filter: { id: 'dunes' } },
      { params: { carveZ: 1.0, symmetry: 'none' } },
      { bricks: { size: 1, frameSet: 5, framePreset: 'single_soldier', frame: true, wallSet: 1, wallPattern: 'stretcher', wall: true, surface: 'weathered', wear: 0.4 } },
      { areas: { width: 2, list: [{ pattern: 'stretcher', points: [[0.6, 1.0], [7.4, 1.0]] }, { pattern: 'stretcher', points: [[0.6, 2.4], [7.4, 2.4]] }, { pattern: 'stretcher', points: [[0.6, 3.7], [7.4, 3.7]] }] } },
      { art: { layer: { name: 'Stream', depth: 0.12, profile: 'vbit', angle: 90 }, paths: [{ d: 'M 4 4.7 L 4 7.0', width: 0.12, color: '#c9a227' }] } },
      { art: { layer: { name: 'Pile', depth: 0.6, profile: 'vbit', angle: 120 }, paths: [{ d: pathOf(ring(4, 7.9, 1.0, 96)) + ' Z', width: 0.02, fill: '#c9a227', color: '#c9a227' }] } },
    ],
    view: FRONT,
  },
  {
    n: 3, title: 'Tide Pool',
    concept: 'Harmony: a small dipped-top board as a rock pool -- a gently sculpted basin at its heart and four ripple rings spreading out to the edge, each a true offset of the frame contour (the Shape Lattice offset-from-frame), so the water answers the frame; a reef floor (tube worms softened) stays rocky texture under rings raised high enough to read all the way round.',
    template: 'template_5', board: [5, 7], seed: 333,
    steps: [
      { frame: { template: 'template_5' } },
      { filter: { id: 'reef', tweaks: { tubeStrength: 0.3 } } },
      { params: { carveZ: 0.8, symmetry: 'none', spacing: '0.03' } },
      { sculpt: { mode: 'draw', radius: 1.2, strength: 0.01, strokes: [{ pts: ring(2.5, 3.7, 0.2, 24), dy: 2, step: 0.08 }] } },
      { echo: { layer: { name: 'Ripples', depth: 0.12, profile: 'ballnose' }, offsets: [0.7, 0.9, 1.1, 1.3], width: 0.08, color: '#1e88e5' } },
    ],
    view: FRONT,
  },
  {
    n: 4, title: 'Tracery',
    concept: 'Contrast: precise against rugged -- a gothic window of quarry glazing, hundreds of small exact raised diamonds filling a pointed arch, set in a quiet smooth panel inside a weathered grey fieldstone ring.',
    template: 'template_12', board: [8, 12], seed: 444,
    steps: [
      { frame: { template: 'template_12' } },
      { filter: { id: 'sandstone' } },
      { params: { carveZ: 0.5, spacing: '0.03' } },
      { art: { layer: { name: 'Quarries', depth: 0.1, profile: 'vbit' }, paths: [
        { d: diamondField(ARCH.inside, 2.7, 5.3, 1.9, 10.0, 0.34, 0.24, 0.14, 0.1), width: 0.01, fill: '#90a4ae', color: '#90a4ae' } ] } },
      { art: { layer: { name: 'Arch', depth: 0.1, profile: 'vbit' }, paths: [{ d: pathOf(ARCH.outline), width: 0.1, color: '#455a64' }] } },
      { bricks: { size: 1, frameSet: 5, framePreset: 'single_soldier', frame: true, surface: 'weathered', wear: 0.5 } },
    ],
    view: FRONT,
  },
  // ---- batch 2 (pieces 11-14) ----
  {
    n: 11, title: "Alchemist's Flask",
    concept: 'Harmony: a flask of something alive -- a field of small precise bubbles rising through the bulb, smaller and denser toward the neck, over a molten, bubbling magma surface, with one raised ring tracing the glass wall just inside the frame.',
    template: 'template_15', board: [9, 12], seed: 1111,
    steps: [
      { frame: { template: 'template_15' } },
      { filter: { id: 'magma' } },
      { params: { carveZ: 0.9, symmetry: 'none' } },
      { echo: { layer: { name: 'Glass', depth: 0.1, profile: 'ballnose' }, offsets: [1.0], width: 0.1, color: '#90caf9' } },
      { art: { layer: { name: 'Bubbles', depth: 0.14, profile: 'ballnose' }, paths: [{ d: bubbles(rng(1111), 2.2, 6.8, 4.2, 10.3, 70, 0.07, 0.24), width: 0.01, fill: '#e3f2fd', color: '#e3f2fd' }] } },
    ],
    view: FRONT,
  },
  {
    n: 12, title: 'Causeway',
    concept: 'Harmony: a Giant Causeway -- a crisp path of grey hexagon pavers laid as a painted wall area, crossing the offset hourglass from notch to notch over a bold basalt terrain whose columns the hexagons echo.',
    template: 'template_4', board: [8, 10], seed: 1212,
    steps: [
      { frame: { template: 'template_4' } },
      { filter: { id: 'basalt' } },
      { params: { carveZ: 1.3, symmetry: 'none' } },
      { bricks: { size: 0.75, wallSet: 4, wallPattern: 'hexagon', wall: true } },
      { areas: { width: 2, list: [{ pattern: 'hexagon', points: [[1.0, 8.6], [3.0, 6.4], [5.0, 3.6], [7.0, 1.4]] }] } },
    ],
    view: FRONT,
  },
  {
    n: 13, title: 'First Rain',
    concept: 'Contrast: precise rain on dry ground -- hundreds of identical short slanted dashes carved in a staggered field, falling across a cracked-earth terrain in a narrow-necked panel.',
    template: 'template_2', board: [7, 10], seed: 1313,
    steps: [
      { frame: { template: 'template_2' } },
      { filter: { id: 'cracked' } },
      { params: { carveZ: 1.5, symmetry: 'none' } },
      { art: { layer: { name: 'Rain', depth: -0.12, profile: 'vbit' }, paths: [{ d: rain(0.9, 6.2, 0.9, 9.2, 0.45, 0.55, 0.38, 70), width: 0.06, color: '#1565c0' }] } },
    ],
    view: FRONT,
  },
  {
    n: 14, title: 'Fishing Net',
    concept: 'Harmony: a net cast along the shore -- a diamond-meshed net whose cords follow the frame contour, swelling with the wave on the left edge and narrowing at the dip, over a carved terrain of rolling wave ridges.',
    template: 'template_8', board: [10, 14], seed: 1414,
    steps: [
      { frame: { template: 'template_8' } },
      { filter: { id: 'carved' } },
      { params: { carveZ: 1.4, symmetry: 'none' } },
      { trellis: { layer: { name: 'Net', depth: 0.1, profile: 'ballnose' }, distance: 0.9, rails: 8, brace: 0.85, width: 0.07, color: '#795548' } },
    ],
    view: FRONT,
  },
];
