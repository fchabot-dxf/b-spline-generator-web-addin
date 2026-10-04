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
 * H23 item 74/76 (Fred via advisor): "add half bricks in voids... No arbitrary cut sizes." Where a
 * course's own run doesn't divide evenly into whole pieces (against the board outline, a frame's
 * inner contour, a window, a scissors cut, OR simply a declared corner), the FINAL piece is one of
 * these declared fractions of the set's own brickLengthIn/brickHeightIn (whichever is the pitch
 * axis) -- never an arbitrary leftover length. Descending order (along-path.js's own scheduler
 * tries the biggest fraction first, matching "mostly whole bricks, minimal small cuts"). A
 * genuinely non-square edge (an angled outline side, a curve, a tapered template) still cuts that
 * chosen-fraction piece on the DIAGONAL via the SAME mitre-line clip every corner already uses
 * ("like the corner mitres") -- the fraction controls the piece's own SIZE/position, the clip
 * controls its exact final SHAPE; the two are independent.
 *
 * H23 item 76 (advisor's own FINAL piece set, superseding item 74's own [1,2/3,1/2,1/3]):
 * "declared PIECES = whole, 3/4 bat, 1/2 bat, 1/4 bat (straight fills; DROP the thirds)..." -- these
 * 4 are the STRAIGHT (along-path, along-arc) fill fractions. The OTHER 4 approved pieces (queen
 * closer, mitred 3/4, mitred 1/2, king closer) are CORNER-specific, declared separately in
 * CORNER_PIECES below (a queen closer/king closer aren't plain length fractions -- they have their
 * own distinct shape: a queen closer is whole-length-but-half-height, a king closer is a whole
 * brick with one corner cut diagonally).
 */
export const FILL_FRACTIONS = Object.freeze([1, 3 / 4, 1 / 2, 1 / 4]);

/**
 * H23 item 76 (advisor's own FINAL piece set): the 4 declared CORNER-specific pieces, used only
 * where a run meets a declared corner (never mid-run) -- a mason's own real vocabulary for turning
 * a corner while keeping the bond:
 *   'queenCloser'  — whole LENGTH, HALF height -- keeps a half-brick stagger alive across a corner
 *                    where two bonded runs meet (same role a queen closer plays in real brickwork).
 *   'kingCloser'   — a whole brick with ONE corner cut off on the diagonal (45deg from one short
 *                    end) -- fills a corner without a full mitre.
 *   'mitredThreeQuarter' / 'mitredHalf' — a 3/4- or 1/2-length piece with its OWN diagonal
 *                    (mitre) cut, for a corner run built from varied-length mitred pieces rather
 *                    than one full mitred whole brick (Fred: "more variation... different
 *                    lengths... diagonal cuts only for mitre").
 * Declared as DATA (their own fraction-of-brickLengthIn, and whether they carry a diagonal/mitre
 * cut) so a future piece can be added here without touching any engine code.
 */
export const CORNER_PIECES = Object.freeze([
  { id: 'queenCloser', lengthFraction: 1, heightFraction: 1 / 2, mitred: false },
  { id: 'kingCloser', lengthFraction: 1, heightFraction: 1, mitred: true },
  { id: 'mitredThreeQuarter', lengthFraction: 3 / 4, heightFraction: 1, mitred: true },
  { id: 'mitredHalf', lengthFraction: 1 / 2, heightFraction: 1, mitred: true },
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
    // below the brick face, never the raised-bead profile -- Fred didn't pick that one).
    // F35 item 7 review (advisor): the original 0.06 was measured as a fraction of brickLengthIn
    // (0.085 of the brick RUN, off a column-redness profile) -- against brickHeightIn (0.2) that's
    // 30%, much wider than a real brick's own joint:height ratio (3/8in on a 2.25in brick ≈ 17%).
    // REVISED to 0.17 x brickHeightIn (0.17 x 0.2 = 0.034, the advisor's own "~0.035in" target) --
    // this ratio is what `scaledSet`'s own grout-scaling now preserves when the user's Scale slider
    // changes brickHeightIn, so grout stays proportionally correct at any brick size, not a fixed
    // absolute width. depthIn is NOT measured (no depth data from a flat photo) -- a declared
    // default, comfortably inside reliefIn's own 0.125 budget.
    grout: { widthIn: 0.034, depthIn: 0.05, profile: 'recessed' },
    // H23 item 72 (Fred): brick relief height in inches, default 0.125, NEVER more than 0.25 --
    // jitter/undulation must stay inside this budget (total brick top <= reliefIn), the user's
    // own control clamped at reliefMaxIn. Replaces an earlier, unrelated `jointDepthIn` guess.
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.015, // well inside the reliefIn budget
    // H23 item 73(c) (advisor, shots/advisor/brick_3d_compare.png: "rounded worn edges + slight
    // crown + chipped corners"): the 3D height PROFILE within a brick's own top face, declared
    // data read by height-profile.js's own brickTopHeight. Not measured off the photo (it's a
    // style reference, not a dimensioned one) -- declared defaults, chosen to read clearly at this
    // set's own miniature scale (brickHeightIn=0.2) while staying comfortably inside reliefIn.
    heightProfile: {
      edgeRadiusIn: 0.035, // the rounded shoulder's own reach, well under brickHeightIn/2 (0.1)
      crown: 0.12, // within the advisor's own declared 0-0.2 range
      chipRate: 0.06, // Fred's own "chipped corners" -- occasional, not universal
      chipSizeIn: 0.045,
      // F35 item 5 review (advisor, after f35item5_01_red_3d_closeup.png: "bricks read as spiky
      // bark, grout barely shows"): LOWERED from the original 0.3 -- at this set's own miniature
      // scale (brickHeightIn=0.2) the full photo-detail amplitude competed with the shoulder/crown/
      // grout shape instead of riding on top of it. 0.12 keeps the shape dominant; re-tunable again
      // once Fred sees this live.
      surfaceShare: 0.12,
    },
    oddSampleRate: 0.08, // ~1 in 12 bricks draws from the odd (darker) pool instead of the main one
    // H23 item 73(b): re-encoded from the original 47 PNG crops (~10MB total) to JPEG q85, max
    // 480px long side (textures, not pixel-art -- MEASURED visually clean at this quality/size) --
    // 0.82MB total, well under the 3MB target; `.png` -> `.jpg` is the ONLY change here, same ids.
    samples: [
      'rc_02', 'rc_03', 'rc_04', 'rc_05', 'rc_06', 'rc_07',
      'rw_01', 'rw_06', 'rw_07', 'rw_09', 'rw_10', 'rw_11', 'rw_13', 'rw_14', 'rw_15', 'rw_16',
      'rw_17', 'rw_18', 'rw_19', 'rw_20', 'rw_21', 'rw_22', 'rw_23', 'rw_24', 'rw_25', 'rw_26',
      'rw_27', 'rw_28', 'rw_29', 'rw_30', 'rw_31', 'rw_32', 'rw_33', 'rw_34', 'rw_35', 'rw_36',
      'rw_37', 'rw_38', 'rw_39', 'rw_40', 'rw_41', 'rw_42', 'rw_43',
    ].map((id) => ({ id, image: `data/bricks/${id}.jpg` })).concat(
      ['rw_44', 'rw_45', 'rw_46', 'rw_47'].map((id) => ({ id, image: `data/bricks/${id}.jpg`, odd: true })),
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
    name: 'White rocks',
    // H23 item 74b (advisor): "P1c: Set 2 'White rocks'" -- but BRICK_SETS id:2 is already
    // declared ('Brick 2', engine:'mc', P2's own reserved MathieuConnery slot); this item's own
    // earlier Set-3 comment already earmarked THIS slot for exactly this ashlar/stone follow-up
    // ("NOT built here: P1a (this item) ships red brick only"). Treating the dispatch note's "Set
    // 2" as loose phrasing (the second STONE kind to ship, not literally BRICK_SETS[1]) rather than
    // overwriting Set 2's own already-declared, not-yet-built P2 data -- flagged in WORK-LOG for
    // the advisor to correct if a literal id:2 swap was actually intended.
    engine: 'masonry',
    shape: 'irregular', // rock-faced quoin stones -- the layout below produces irregular polygons, not rectangles
    layout: 'fieldstone', // H23 item 74c's own new layout (Poisson-disc -> Voronoi -> shrink -> round)
    // `brickLengthIn` is reused by the 'fieldstone' layout as its own TARGET STONE SPACING (see
    // layouts/fieldstone.js's own header) -- NOT a literal rectangular brick length. Declared at a
    // bigger decorative scale than Set 1's bricks (0.75in): real quoin/fieldstone units read
    // noticeably larger than a brick in a real wall too, kept in the same decorative ballpark
    // Set 1 established. `brickHeightIn` is unused by this layout (kept for vocabulary parity).
    brickLengthIn: 1.1,
    brickHeightIn: 1.1,
    // GROUT: Fred/advisor "wider grout default" (vs Set 1's own MEASURED 0.06in). An actual pixel
    // measurement off stones_white's own dark mortar band was ATTEMPTED (a luminance scan like Set
    // 1's own) but the rough rock-face texture's own local contrast swamped the joint's signal --
    // no clean band found, unlike Set 1's smoother brick faces. Declared instead, using the
    // real-world brick:fieldstone joint-width ratio (fieldstone joints typically read ~1.5-2.5x a
    // brick's own) as a guide -- 0.12in, 2x Set 1's measured 0.06.
    grout: { widthIn: 0.12, depthIn: 0.06, profile: 'recessed' },
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.02,
    // Declared the same SHAPE as Set 1's own (shoulder+crown+chips) at proportionally bigger
    // numbers (this set's own stones are ~1.5x Set 1's bricks): not measured off a 3D reference
    // (stones_white is a flat-photo style reference, same situation Set 1's own heightProfile was
    // in) -- a reasonable declared default, re-tunable once Fred sees a live preview.
    heightProfile: {
      edgeRadiusIn: 0.05,
      crown: 0.1,
      chipRate: 0.1, // rock-faced stones read "chippier" than smooth brick -- a higher declared rate
      chipSizeIn: 0.07,
      surfaceShare: 0.35,
    },
    // H23 item 74b: 10 stones (shots/advisor/stones_white/stone_02..11.png -- stone_01 excluded,
    // it's a corner/context crop showing the adjacent brick coursing, not a clean stone face),
    // re-encoded PNG -> JPEG q85, max 480px long side (0.65MB -> 0.12MB).
    samples: ['stone_02', 'stone_03', 'stone_04', 'stone_05', 'stone_06', 'stone_07', 'stone_08', 'stone_09', 'stone_10', 'stone_11']
      .map((id) => ({ id, image: `data/bricks/${id}.jpg` })),
  },
]);

/**
 * F35 item 7 (advisor-approved proposal, agreed with f3 by DM since f3 owns contour-bands/Frame
 * bands): ONE declared pattern table, shared by Wall (layouts/bond.js's own zones) and -- once f3's
 * own contour-bands rebuild lands -- Frame bands, so both read the SAME names/parameters instead of
 * two independent, never-unified vocabularies (the pre-item-7 state: bond.js's own BOND_KINDS vs.
 * along-path.js's bare `orientation==='soldier'` ternary). A pattern is placed in local (u,v) space
 * -- u=along a course/band, v=across it -- and each CONSUMER supplies its own (u,v) frame: Wall's
 * is the identity (u=x, v=y, layouts/bond.js below); a Frame band's is its own path-local frame
 * (arc-length + perpendicular offset) -- H23 item 77 follow-up: that frame is `contour-bands.js`'s
 * own exported `bandFrameAt(primitives)`, which returns a `(u,v) -> {x,y,tx,ty,nx,ny}` sampler (v=0
 * = the board's own true outline, increasing = inward, same convention `bricksContourBands`'
 * bands/rows already use). `bricksContourBands` itself still only consumes 'course'-kind patterns
 * directly; `bandFrameAt` is the separate, smaller hook a 'tile2d' (or any other) pattern generator
 * needs to place itself along a curved band -- it does not by itself solve tile2d-on-a-curve (a
 * tile2d CELL's own shape distorting around curvature is a separate, harder question, still open).
 *
 * `kind` tags which cell-generation family a pattern needs:
 *   'course'             — one row of UNIFORMLY-pitched bricks, the pre-item-7 model generalised
 *                          from a `rotated` boolean to explicit `pitchAxis`/`crossAxis` axes (either
 *                          'length'|'height' into brickLengthIn/brickHeightIn) + a `staggerFrac`
 *                          (0..1, a FRACTION of one column pitch, not a bare bool) applied to every
 *                          odd course. Covers stretcher/stack/soldier (the pre-item-7 three) AND
 *                          header (needs ONLY its pitch axis swapped, unlike soldier which swaps
 *                          both -- a plain `rotated` flag could never express this, see
 *                          layouts/bond.js's own header for the full reasoning).
 *   'course-alternating' — one course repeats a DECLARED sequence of differently-sized units
 *                          instead of one uniform brick (flemish: stretcher then header, period
 *                          L+J+H+J), with alternate courses offset by half that period -- the
 *                          textbook flemish-bond stagger (layouts/bond.js's own flemishRow).
 *   'tile2d'              — genuinely two-dimensional placement that cannot reduce to stacked rows
 *                          at all (herringbone's 45-degree diagonal weave, basketweave's alternating
 *                          horizontal/vertical pairs) -- same category of limitation that made
 *                          fieldstone its own layout FILE rather than a bond.js variant; each gets
 *                          its own `core/bricks/layouts/<name>.js`, dispatched by `set.layout` (NOT
 *                          zone-mixable with course-kind patterns this round -- an honest, named
 *                          scope line matching fieldstone's own precedent, not a silent gap: mixing
 *                          a tile2d pattern into one zone of an otherwise course-based Wall fill is
 *                          a bigger, separate unification not attempted here).
 */
export const BRICK_PATTERNS = Object.freeze({
  stretcher: { kind: 'course', pitchAxis: 'length', crossAxis: 'height', staggerFrac: 0.5 },
  stack: { kind: 'course', pitchAxis: 'length', crossAxis: 'height', staggerFrac: 0 },
  soldier: { kind: 'course', pitchAxis: 'height', crossAxis: 'length', staggerFrac: 0 },
  // header: same pitch axis as soldier (brickHeightIn -- a near-square footprint reads right only
  // with a tight pitch), but its OWN cross/course-height axis is ALSO brickHeightIn (soldier's own
  // cross axis is brickLengthIn, since a soldier brick stands its full length upright) -- the one
  // combination a `rotated` boolean could never express. staggerFrac 0.5: real header-bond coursing
  // staggers the same as running bond, a declared convention (not measured off a photo reference).
  header: { kind: 'course', pitchAxis: 'height', crossAxis: 'height', staggerFrac: 0.5 },
  // flemish: see layouts/bond.js's own flemishRow for the exact repeat-unit/stagger construction --
  // the textbook alternating-stretcher-and-header bond, no further parameters needed here (the unit
  // sequence itself isn't user-tunable, matching how stretcher/soldier/etc. have no exposed knobs).
  flemish: { kind: 'course-alternating' },
  herringbone: { kind: 'tile2d' },
  basketweave: { kind: 'tile2d' },
});

/**
 * H23 item 72, frame refinement (Fred: "patterns of different width"): the brick-contour FRAME is
 * a declared list of BANDS, outside -> in, each its own width + pattern -- `pattern` is any
 * `BRICK_PATTERNS` key above. F35 item 8 (de): 'header'/'flemish'/'stack' are now real too, routed
 * through `editor-brick-tool.js`'s own `frameBricksFor` to `band-course.js` (never `along-path.js`'s
 * own orientation switch, which stays untouched, soldier/stretcher-only) -- `header_band` below is
 * the first preset to use one.
 * `widthIn` is SNAPPED by contour-bands.js to the nearest whole number of that pattern's own
 * brick-row width (never stretched) -- the values below are chosen to land exactly on that
 * rounding (0.75 = one soldier row at this set's own brickLengthIn, 0.2/0.6 = 1/3 stretcher rows
 * at brickHeightIn) so what ships matches what's declared, with three_band's own middle band
 * genuinely 3 courses deep (demonstrating the multi-row stacking, not just a single wide brick).
 */
/**
 * T86 item 1 (Fred's sketch, shots/fred/fred_sketch_butt_corner.jpg): `cornerStyle` on a band is
 * the per-corner TREATMENT contour-bands.js's own ribbonPieces call reads (default 'mitre' when a
 * band declares none, matching every preset above) -- 'butt' and 'lapped' are the same asymmetric
 * through/butt construction (see primitive-ribbon.js's own `buildButtJoint` header); 'lapped' flips
 * which side is through on every other BAND (advisor's own decision, turn 291) -- a single-band
 * lapped frame is identical to 'butt' by construction, so `double_course` below declares 2 bands,
 * the minimum that actually shows the alternation. 'block' inserts a solid quoin unit (from the
 * declared "White rocks" set, `BRICK_SETS[2]`, regardless of the band's own set) at the same
 * corners instead -- `quoin_corners` below.
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
  butt_frame: [{ widthIn: 0.75, pattern: 'soldier', cornerStyle: 'butt' }],
  quoin_corners: [{ widthIn: 0.75, pattern: 'soldier', cornerStyle: 'block' }],
  double_course: [
    { widthIn: 0.75, pattern: 'soldier', cornerStyle: 'lapped' },
    { widthIn: 0.75, pattern: 'soldier', cornerStyle: 'lapped' },
  ],
  // F35 item 8 (de) + T86 item 1: "header pattern + king-closer mitres" needs no cornerStyle
  // override at all -- band-course.js's own mitre-corner handling (confirmed: it explicitly inserts
  // the TRUE mitre corner point via mitreOffset, not a naive (u,v) approximation) already produces
  // whole-brick (king-closer-fraction) corner pieces for header's own small pitch, the same way
  // single_soldier's own default mitre corners do. 3 rows (0.6in total depth) -- de's own measured
  // safe range on a tight template (T1's shoulder fillet) is roughly 1.2-1.5in before band-course.js
  // degrades, so this stays comfortably inside it.
  header_band: [{ widthIn: 0.6, pattern: 'header' }],
});

export function brickSetById(id) {
  return BRICK_SETS.find((s) => s.id === id) || null;
}

export function enabledPieces(catalogue = PIECE_CATALOGUE) {
  return catalogue.filter((p) => p.enabled !== false);
}

/**
 * A scaled COPY of `set` -- never mutates the declared original -- with `brickLengthIn`/
 * `brickHeightIn` multiplied and every other field (relief, samples, engine, ...) carried over
 * untouched. `scale` omitted or 1 returns `set` itself (no allocation) so the common, unscaled path
 * stays cheap.
 *
 * F35 item 7 review (advisor, REVISING the original "grout width unaffected" rule): grout.widthIn
 * now scales WITH the brick, same factor as length/height -- so a set's own measured
 * grout:brickHeightIn RATIO (library.js's own declared default, e.g. Set 1's 0.17) stays correct at
 * any Scale slider value, instead of a fixed absolute width reading proportionally wider on a
 * shrunk brick or thinner on an enlarged one.
 */
export function scaledSet(set, scale) {
  if (!scale || scale === 1) return set;
  return {
    ...set,
    brickLengthIn: set.brickLengthIn * scale,
    brickHeightIn: set.brickHeightIn * scale,
    grout: { ...set.grout, widthIn: set.grout.widthIn * scale },
  };
}
