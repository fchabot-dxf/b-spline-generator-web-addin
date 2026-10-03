/**
 * core/bricks/library.js — PORTABLE declared data (see rng.js's own header for the portability
 * rule). No logic here beyond trivial lookups -- the piece catalogue and the brick-sample sets,
 * as DATA, so the engine never hand-rolls what should be declared.
 *
 * H23 item 72: piece catalogue read directly off shots/advisor/brick_piece_catalog.png's own
 * labels (A1-A6 = 2-brick groups, B1-B9 = 3-brick groups; "shift"/"stair"/"zigzag" fractions are
 * the catalogue's own words). `offsets` is ABSOLUTE position (in brick-length fractions) of each
 * member brick relative to the piece's own anchor brick (brick 0, always offsets[0]=0) -- e.g. a
 * "zigzag 1/4" step sequence [+1/4,-1/4] becomes the absolute list [0, 1/4, 0].
 * `enabled` is a per-piece declared flag (Fred is still picking which pieces to keep; all start
 * enabled so nothing is silently excluded before he decides).
 */
export const PIECE_CATALOGUE = Object.freeze([
  // -- trivial: a piece can also be just one brick (no grouping at all) --
  { id: 'single', bricks: 1, offsets: [0], enabled: true },

  // -- A: 2-brick groups --
  { id: 'A1', bricks: 2, offsets: [0, 0], enabled: true },         // shift 0
  { id: 'A2', bricks: 2, offsets: [0, 1 / 6], enabled: true },     // shift 1/6
  { id: 'A3', bricks: 2, offsets: [0, 1 / 4], enabled: true },     // shift 1/4
  { id: 'A4', bricks: 2, offsets: [0, 1 / 3], enabled: true },     // shift 1/3
  { id: 'A5', bricks: 2, offsets: [0, 1 / 2], enabled: true },     // shift 1/2 (standard running bond)
  { id: 'A6', bricks: 2, offsets: [0, 2 / 3], enabled: true },     // shift 2/3

  // -- B: 3-brick groups --
  { id: 'B1', bricks: 3, offsets: [0, 1 / 4, 1 / 2], enabled: true },        // stair 1/4
  { id: 'B2', bricks: 3, offsets: [0, 1 / 3, 2 / 3], enabled: true },        // stair 1/3
  { id: 'B3', bricks: 3, offsets: [0, 1 / 2, 1], enabled: true },            // stair 1/2
  { id: 'B4', bricks: 3, offsets: [0, 1 / 4, 0], enabled: true },            // zigzag 1/4
  { id: 'B5', bricks: 3, offsets: [0, 1 / 3, 0], enabled: true },            // zigzag 1/3
  { id: 'B6', bricks: 3, offsets: [0, 1 / 2, 0], enabled: true },            // zigzag 1/2
  { id: 'B7', bricks: 3, offsets: [0, 1 / 2, 1 / 4], enabled: true },        // out 1/2, back 1/4
  { id: 'B8', bricks: 3, offsets: [0, 1 / 6, 1 / 2], enabled: true },        // stair 1/6 then 1/3
  { id: 'B9', bricks: 3, offsets: [0, 0, 1 / 2], enabled: true },            // pair + shifted 1/2
]);

/**
 * Brick-sample SETS -- a fixed max of 3 (Fred: "no open-ended library machinery"). Each set is a
 * DIFFERENT kind of brick: its own sample photos, its own measured proportions/shape/layout/
 * joints. Set 3 is a declared empty slot for later. The piece catalogue above is shared across
 * every set (Fred, after briefly trying per-set pieces then reverting: "the piece catalogue stays
 * shared across sets").
 *
 * `samples[].id` matches a file under html/data/bricks/<id>.png (copied from shots/advisor/
 * redbricks/ for Set 1, shots/advisor/bricks/ for Set 2). `odd:true` flags a sample that should
 * only appear at `oddSampleRate` (Fred: "a few odd samples can appear at a low, declared rate") --
 * picked by MEASURING mean luminance of all 47 Set-1 crops (median 109); rw_44/45/46/47 form a
 * distinct darker cluster (83.5-92.7 vs the rest starting at 96.5) and are flagged odd.
 */
export const BRICK_SETS = Object.freeze([
  {
    id: 1,
    name: 'Brick 1 (red)',
    engine: 'masonry', // Fred's own name for this engine (separate textured units + mortar joints,
    // vs P2's 'mc' = the MathieuConnery chiselled-ribbon engine) -- declared per set so the
    // adapter can route a set to the right engine without a type-sniffing guess.
    shape: 'rect',
    layout: 'bond', // P1: implemented. P2/P3 add 'grid'/'runs' to the layout table, not here.
    // H23 item 72 CORRECTION: a real architectural brick (~8in) was the first draft here -- wrong
    // scale for this app's own boards (~7x9in decorative panels; an 8in brick wouldn't even fit
    // once across a 7in-wide board). Declared at a DECORATIVE/miniature scale instead, in the
    // same ballpark as the frame band-width examples Fred gave (0.75/0.25/0.5in).
    // Set-1 source SWAPPED (advisor, turn 504+): the garden-edging b1_* photos dropped in favour
    // of Fred's own red-brick wall photos (shots/fred/photo_test_red_brick_{wall,closeup}.jpg),
    // auto-extracted to shots/advisor/redbricks/ (47 crops). Proportions MEASURED directly off
    // those 47 crops' own pixel dimensions (median w/h = 3.70:1, mean 3.67:1) -- the advisor's own
    // "≈3.3:1" was a quick eyeball estimate; the direct pixel measurement is used instead (ratio
    // rounded to a clean 3.75:1 so brickLengthIn/brickHeightIn stay tidy declared numbers).
    brickLengthIn: 0.75,
    brickHeightIn: 0.2, // 3.75:1, matches the measured 3.70:1 median within rounding
    // GROUT (advisor, Fred: "every Masonry set and layout has a GROUT parameter... ONE shared
    // declared group used by all Masonry"): widthIn is the layout's own joint gap (what every
    // layout/band/brush reads); depthIn/profile are the height-map adapter's own concern (a recess
    // below the brick face, never the raised-bead profile -- Fred didn't pick that one). widthIn
    // MEASURED from a column-redness profile on the closeup photo (2 clean head-joint runs, median
    // 108px, vs median brick run 1278px -> ratio 0.085); 0.75in * 0.085 = 0.064, rounded to 0.06.
    // (The wall photo gave a noisier 0.14 on a single scanline -- perspective skew on that angled
    // shot; the closeup's more fronto-parallel measurement is trusted instead, per "measure, don't
    // re-reason": when two measurements disagree, prefer the better-conditioned one, don't average
    // them away.) depthIn is NOT measured (no depth data from a flat photo) -- a declared default,
    // comfortably inside reliefIn's own 0.125 budget.
    grout: { widthIn: 0.06, depthIn: 0.05, profile: 'recessed' },
    // H23 item 72 (Fred): brick relief height in inches, default 0.125, NEVER more than 0.25 --
    // jitter/undulation must stay inside this budget (total brick top <= reliefIn), the user's
    // own control clamped at reliefMaxIn. Replaces an earlier, unrelated `jointDepthIn` guess.
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.015, // well inside the reliefIn budget
    oddSampleRate: 0.08, // ~1 in 12 bricks draws from the odd (darker) pool instead of the main one
    samples: [
      'rc_02', 'rc_03', 'rc_04', 'rc_05', 'rc_06', 'rc_07',
      'rw_01', 'rw_06', 'rw_07', 'rw_09', 'rw_10', 'rw_11', 'rw_13', 'rw_14', 'rw_15', 'rw_16',
      'rw_17', 'rw_18', 'rw_19', 'rw_20', 'rw_21', 'rw_22', 'rw_23', 'rw_24', 'rw_25', 'rw_26',
      'rw_27', 'rw_28', 'rw_29', 'rw_30', 'rw_31', 'rw_32', 'rw_33', 'rw_34', 'rw_35', 'rw_36',
      'rw_37', 'rw_38', 'rw_39', 'rw_40', 'rw_41', 'rw_42', 'rw_43',
    ].map((id) => ({ id, image: `data/bricks/${id}.png` })).concat(
      ['rw_44', 'rw_45', 'rw_46', 'rw_47'].map((id) => ({ id, image: `data/bricks/${id}.png`, odd: true })),
    ),
  },
  {
    id: 2,
    name: 'Brick 2',
    engine: 'mc', // the MathieuConnery chiselled-ribbon engine (pyramid/hip tiles) -- P2, not yet implemented
    shape: 'rect', // P2's own 'grid' squares reuse this set's samples once that layout lands
    layout: 'grid',
    brickLengthIn: 0.75,
    brickHeightIn: 0.25,
    grout: { widthIn: 0.03, depthIn: 0.04, profile: 'recessed' }, // declared default -- P2, not yet exercised
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.015,
    samples: ['b2_01', 'b2_02', 'b2_03', 'b2_04', 'b2_05'].map((id) => ({ id, image: `data/bricks/${id}.png` })),
  },
  {
    id: 3,
    name: '(empty)',
    // Was "parked" (ashlar/pavers). Un-parked by Fred ("do a few masonry") as its own P1c item --
    // Masonry sets for ashlar stone (shots/fred/photo_test_ashlar_stone_wall.jpg) and granite
    // pavers (shots/advisor/bricks/b1_* -- the original garden-edging crops, freed up by Set 1's
    // own swap to red brick). NOT built here: P1a (this item) ships red brick only.
    engine: null,
    shape: null,
    layout: null,
    samples: [],
  },
]);

/**
 * H23 item 72, frame refinement (Fred: "patterns of different width"): the brick-contour FRAME is
 * a declared list of BANDS, outside -> in, each its own width + pattern. `pattern` is one of:
 *   'stretcher' — brick length runs ALONG the contour (pitch = brickLengthIn, row width = brickHeightIn)
 *   'soldier'   — brick length runs ACROSS the band, perpendicular to the contour (pitch = brickHeightIn, row width = brickLengthIn)
 *   'header'    — brick's short (height) face out, same packing rhythm as soldier but the brick's
 *                 own HEIGHT also spans the band width (a near-square footprint), not the full length
 *                 (DECLARED, not yet implemented by along-path.js's own orientation switch -- no
 *                 preset below uses it).
 * `widthIn` is SNAPPED by contour-bands.js to the nearest whole number of that pattern's own
 * brick-row width (never stretched) -- the values below are chosen to land exactly on that
 * rounding (0.75 = one soldier row at this set's own brickLengthIn, 0.2/0.6 = 1/3 stretcher rows
 * at brickHeightIn) so what ships matches what's declared, with three_band's own middle band
 * genuinely 3 courses deep (demonstrating the multi-row stacking, not just a single wide brick).
 */
export const FRAME_PRESETS = Object.freeze({
  single_soldier: [{ widthIn: 0.75, pattern: 'soldier' }],
  soldier_stretcher: [
    { widthIn: 0.75, pattern: 'soldier' },
    { widthIn: 0.2, pattern: 'stretcher' },
  ],
  three_band: [
    { widthIn: 0.75, pattern: 'soldier' },
    { widthIn: 0.6, pattern: 'stretcher' },
    { widthIn: 0.75, pattern: 'soldier' },
  ],
});

export function brickSetById(id) {
  return BRICK_SETS.find((s) => s.id === id) || null;
}

export function enabledPieces(catalogue = PIECE_CATALOGUE) {
  return catalogue.filter((p) => p.enabled !== false);
}

/**
 * Advisor (Fred): "every entry point takes opts.scale (uniform multiplier on the set's brick
 * length and height, default 1; grout width unaffected)". A scaled COPY of `set` -- never mutates
 * the declared original -- with `brickLengthIn`/`brickHeightIn` multiplied and every other field
 * (grout, relief, samples, engine, ...) carried over untouched. `scale` omitted or 1 returns `set`
 * itself (no allocation) so the common, unscaled path stays cheap.
 */
export function scaledSet(set, scale) {
  if (!scale || scale === 1) return set;
  return { ...set, brickLengthIn: set.brickLengthIn * scale, brickHeightIn: set.brickHeightIn * scale };
}
