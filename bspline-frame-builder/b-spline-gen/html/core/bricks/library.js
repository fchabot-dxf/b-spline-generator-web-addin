import { TILE_PARAMS } from './layouts/tiles.js'; // F35 item 14: the tile patterns' declared params
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

/** The quarter-brick floor: a leftover piece smaller than this fraction of one brick (or, for fieldstone, of its
 *  smallest tier's grout-free stone) is not laid -- it reads as a slightly wider joint. ONE declaration (T86 item
 *  28, advisor): layouts/bond.js (a course's leftover top strip), layouts/fieldstone.js (the smallest stone),
 *  fill-shape.js (a wall piece cut by a brush stroke) and contour-bands.js (a band piece cut to the board) read it. */
export const MIN_PIECE_FRACTION = 0.25;

/** T86-27 correction (seat C 02, advisor ruling, 2026-10-05): where a TILE's row 0 sits on the wall, for EVERY tile
 *  input of the bond layout -- customBond's courses and accentCuts' rows (layouts/bond.js tileRowOf). 'bottom' = the
 *  wall's bottom course (the pattern builder draws row 0 at the bottom: walls are laid up from the ground). Declared
 *  once because two matching conventions drifted: customBond counted from the top and accentCuts from the bottom,
 *  so which bond course a tile row marked flipped with the wall's course-count parity (measured: a 3.4 in wall
 *  marked the half-brick courses, a 3.8 in wall the whole ones). The built-in bonds' own stagger is NOT a tile and
 *  keeps counting from the top (every saved wall lays as before). */
export const COURSE_ROW_ORIGIN = 'bottom';

/** T86 item 22 (Fred: rustic running bond): `rustic` 0..1 (0 = today's uniform bricks) varies brick lengths within a
 *  course -- lengths in [1 - lengthSpread x rustic, 1 + lengthSpread x rustic] x the brick (0.6-1.4 at 1) -- keeping a
 *  joint at least minLap x the brick away from every joint of the course below (the bond stays staggered), and lifts or
 *  sinks each brick by up to levelIn x rustic. Wall (layouts/bond.js, running bond) and Brush (along-path.js). */
export const RUSTIC = Object.freeze({ lengthSpread: 0.4, minLap: 0.25, levelIn: 0.02 });

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
    // REVISED to 0.17 x brickHeightIn (0.17 x 0.2 = 0.034, the advisor's own "~0.035in" target).
    // F35 item 16 (Fred, reversing the item 7 rule this ratio used to feed): this 0.17 ratio now
    // only ever SEEDS the one GLOBAL grout width the first time a board gets bricks -- it no longer
    // rescales with brick size afterward (scaledSet, this file, never touches grout at all).
    // depthIn is NOT measured (no depth data from a flat photo) -- a declared default, comfortably
    // inside reliefIn's own 0.125 budget.
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
    // Fred (2026-10-05, via advisor, picked from a 0.034 / 0.08 / 0.14 sheet): rubble/fieldstone joints 0.08 in (Red Brick keeps
    // its 0.034). MEASURED: the app laid rocks at 0.034 regardless of this field (editor-brick-tool.js
    // resolvedSetFor replaces the set's width with the user's one Grout width, whose default is Red Brick's);
    // seat 37 makes that control start from the selected element's set default. Walls and bands alike: the
    // fieldstone layout shrinks every stone by half this joint.
    grout: { widthIn: 0.08, depthIn: 0.06, profile: 'recessed' },
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
      wearWholeFace: true, // T86 item 23: the Wear amount wears the whole stone face at its edge (height-profile.js)
    },
    // H23 item 74b: 10 stones (shots/advisor/stones_white/stone_02..11.png -- stone_01 excluded,
    // it's a corner/context crop showing the adjacent brick coursing, not a clean stone face),
    // re-encoded PNG -> JPEG q85, max 480px long side (0.65MB -> 0.12MB).
    samples: ['stone_02', 'stone_03', 'stone_04', 'stone_05', 'stone_06', 'stone_07', 'stone_08', 'stone_09', 'stone_10', 'stone_11']
      .map((id) => ({ id, image: `data/bricks/${id}.jpg` })),
  },
  // T86 item 24 (Fred's grey photos, shots/fred/grey_set): faces cut by ~/.bspline-status/tools/extract_grey.py
  // (luminance: light faces, dark joints -- extract_bricks.py's redness test has no hue to work with). Proportions and
  // joint read off grey_brick_512.png: faces ~90 x 40 px (2.3:1), joints ~8 px (~9% of a face's length).
  {
    id: 4,
    name: 'Grey brick',
    engine: 'masonry',
    shape: 'rect',
    layout: 'bond',
    brickLengthIn: 0.75,
    brickHeightIn: 0.32,
    grout: { widthIn: 0.05, depthIn: 0.05, profile: 'recessed' },
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.015,
    heightProfile: { edgeRadiusIn: 0.04, crown: 0.12, chipRate: 0.08, chipSizeIn: 0.05, surfaceShare: 0.15 },
    samples: Array.from({ length: 42 }, (_, i) => `gb_${String(i + 1).padStart(2, '0')}`).map((id) => ({ id, image: `data/bricks/${id}.jpg` })),
  },
  // T86 item 25: grey stone in COURSED RUBBLE (layouts/coursed-rubble.js), faces from rubble_coursed_stone_600.png
  // (gs_01..27, stones ~80 x 55 px) and grey_stone_ashlar_2048.png (gs_28..64). Dark joints like the rock set's.
  {
    id: 5,
    name: 'Grey stone',
    // F35 item 61: its own pieces lay a FRAME's bands (measured live: grey stones in each band; coursed rubble itself is a
    // Wall-only pattern); seat A's D4 build laid a Set 5 frame, reachable then only by code (editor-brick-tool.js frameModeOfSet)
    frameBands: 'set',
    engine: 'masonry',
    shape: 'irregular',
    layout: 'coursed_rubble',
    // advisor ruling by precedent (Fred: a stone set's bands are the stone ring, as White rocks): its frame bands are
    // fieldstone rings with these grey faces (contour-bands.js setBandPattern reads bandLayout)
    bandLayout: 'fieldstone',
    brickLengthIn: 1.1,
    brickHeightIn: 0.7,
    grout: { widthIn: 0.08, depthIn: 0.06, profile: 'recessed' },
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.02,
    heightProfile: { edgeRadiusIn: 0.05, crown: 0.1, chipRate: 0.1, chipSizeIn: 0.07, surfaceShare: 0.35, wearWholeFace: true }, // T86 item 23
    samples: Array.from({ length: 64 }, (_, i) => `gs_${String(i + 1).padStart(2, '0')}`).map((id) => ({ id, image: `data/bricks/${id}.jpg` })),
  },
  // Rough ashlar (Fred picked mock E, 2026-10-10; layouts/coursed-ashlar.js): broken-course grey blocks. The Rough ashlar
  // PATTERN picks this set (editor-brick-tool.js patternSetId), as Coursed rubble picks Grey stone. brickHeightIn is the
  // base course height H every block length is declared in (COURSED_ASHLAR); L = H, so the brick size control sets H.
  // Faces: the ashlar-photo grey stones (gs_28..64, cut from grey_stone_ashlar_2048.png); no new images.
  {
    id: 6,
    name: 'Grey ashlar',
    engine: 'masonry',
    shape: 'irregular',
    layout: 'coursed_ashlar',
    brickLengthIn: 1.0,
    brickHeightIn: 1.0,
    grout: { widthIn: 0.05, depthIn: 0.06, profile: 'recessed' },
    reliefIn: 0.125,
    reliefMaxIn: 0.25,
    heightJitterIn: 0.02,
    heightProfile: { edgeRadiusIn: 0.05, crown: 0.1, chipRate: 0.1, chipSizeIn: 0.07, surfaceShare: 0.35, wearWholeFace: true },
    samples: Array.from({ length: 37 }, (_, i) => `gs_${String(i + 28).padStart(2, '0')}`).map((id) => ({ id, image: `data/bricks/${id}.jpg` })),
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
 *   'none'                — F35 item 12 follow-up (Fred): the Wall picker's own OFF switch -- no
 *                          wall bricks at all (editor-brick-tool.js's own applyWallPattern reads
 *                          this `kind` and tells generateBricks to skip the Wall fill entirely,
 *                          one check in the ONE generator, not a special case per button). Not
 *                          band-mixable (same reason a tile2d pattern isn't): main/brick-panel.js's
 *                          own per-band picker disables it right alongside tile2d entries -- "no
 *                          pattern" isn't a real band, only a real top-level "fill nothing" choice.
 */
export const BRICK_PATTERNS = Object.freeze({
  none: { kind: 'none' },
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
  // smallestFace 'header' (seat E 2026-10-14): the bond's header courses are whole pieces -- a tip's course front reads them
  // (tip-fill.js bareTips: a piece of half a WHOLE piece is a course; english / monk left a T14 tip bare when only a stretcher
  // counted). Declared on english / monk only: on header and flemish it MEASURED a different frame tip fill (T14 / T16 1.25
  // in), and a saved board re-lays as before (Fred 2026-10-14) -- they keep the stretcher rule
  flemish: { kind: 'course-alternating' },
  english: { kind: 'course-alternating', subtype: 'english', smallestFace: 'header' },
  monk: { kind: 'course-alternating', subtype: 'monk', smallestFace: 'header' },
  herringbone: { kind: 'tile2d' },
  double_herringbone: { kind: 'tile2d' },
  basketweave: { kind: 'tile2d' },
  windmill: { kind: 'tile2d' },
  // F35 item 13: Fred's sheet (shots/fred/ref_brick_pattern_sheet.jpg), layouts/sheet-patterns.js -- Wall-only
  stacked_horizontal: { kind: 'tile2d' },
  chevron: { kind: 'tile2d' },
  stacked_variation: { kind: 'tile2d' },
  basketweave_variation: { kind: 'tile2d' },
  basketweave_stacked: { kind: 'tile2d' },
  // F35 item 14: tiles / pavers (Fred's sheet 3, layouts/tiles.js) -- Wall-only. `family` groups them in the picker;
  // `params` = what the user picks (TILE_PARAMS: options + one default); `fixed` = layout params the entry pins.
  square_grid: { kind: 'tile2d', family: 'tiles' },
  square_diamond: { kind: 'tile2d', family: 'tiles', params: TILE_PARAMS.squareDiamond, fixed: { rotationDeg: 0 } },
  octagon_square: { kind: 'tile2d', family: 'tiles', params: TILE_PARAMS.octagonDot, fixed: { rotationDeg: 45 } },
  hexagon: { kind: 'tile2d', family: 'tiles' },
  lozenge: { kind: 'tile2d', family: 'tiles' },
  framed_square: { kind: 'tile2d', family: 'tiles' },
  // F35 item 12(b): fieldstone was already a real `fill-shape.js` LAYOUTS entry (f3's own item 74,
  // for the White Rocks set's own declared `layout:'fieldstone'` default) but had no BRICK_PATTERNS
  // key, so the Wall picker couldn't select it -- a Poisson-disc Voronoi tiling, not tied to any
  // one set's own sample photos (`fieldstoneLayout` only reads brickLengthIn/grout.widthIn), so it
  // works with either set exactly like herringbone/basketweave already do.
  // T86 item 20 (Fred: "a frame of fieldstone and a wall of soldier with dot raised"): `bandCapable`
  // is the declared flag contour-bands.js's own per-band dispatch reads (and 37's own picker, so the
  // option enables itself there with no separate UI-side list to keep in sync) -- herringbone/
  // basketweave stay Wall-only (no flag) since nothing asked for them as a band yet; an AREA-fill
  // pattern needs no new `kind` to become band-capable, just this one flag, since a band fill is the
  // SAME `fieldstoneLayout` call Wall already makes, just against the band's own ribbon region
  // instead of the whole interior (see contour-bands.js's own `buildAreaBandBricks`).
  fieldstone: { kind: 'tile2d', bandCapable: true },
  // 37 (F35, grey-sets T86 item 25): Set 5's coursed rubble as a Wall pattern -- it picks that set the way Fieldstone
  // picks Set 3 (editor-brick-tool.js patternSetId: the set whose layout IS the pattern). Wall only: not band-capable.
  coursed_rubble: { kind: 'tile2d', family: 'fieldstone' },
  // Rough ashlar (Fred picked mock E, 2026-10-10): picks Set 6 (Grey ashlar) the same way. Wall only: not band-capable.
  coursed_ashlar: { kind: 'tile2d', family: 'fieldstone' },
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
/**
 * UX refine (Fred, 2026-10-10): a preset's optional `bestSize` -- the brick size (inches, one of the Size chips:
 * 0.375 / 0.75 / 1 / 1.25 / 1.5 / 3 / 8) it reads best at. Since 2026-10-11 (Fred: per-pattern defaults) it IS the
 * preset's DEFAULT size (patternDefaultsOf below): the Brick frame lays at it unless the user overrides the frame's
 * size. Absent = BRICK_PATTERN_DEFAULTS' size. It rides on the band list as a NON-enumerable property, so every
 * reader of the bands (iteration, spread, map, JSON, the engine) sees exactly the list it always did -- read it as
 * `FRAME_PRESETS[id].bestSize`.
 */
function withBestSize(bestSize, bands) {
  return Object.defineProperty(bands, 'bestSize', { value: bestSize, enumerable: false });
}
/** 2026-10-11 (Fred approved the advisor's mock "Rowlock arch + keystone"): a preset's optional `arch` -- a blind arch
 *  inside the frame (core/bricks/arch-surround.js ARCH_SPECS id), laid with the Frame element; the wall is cut around
 *  it and fills its opening. Non-enumerable like bestSize: every reader of the bands sees the list it always did. */
function withArch(arch, bands) {
  return Object.defineProperty(bands, 'arch', { value: arch, enumerable: false });
}

/** Fred 2026-10-11: a frame PRESET bundles its bands, its CORNER (each band's `cornerStyle`) and its best size -- the
 *  separate Corners picker is retired. A look that needs another corner is a VARIANT preset, declared here: these presets
 *  each get a quoin variant `<id>_quoin` (the same bands, every corner a quoin block -- the inner bands wrap it with an L,
 *  contour-bands.js QUOIN_INNER_WRAP -- and the same best size), listed right after them. */
export const QUOIN_VARIANT_OF = Object.freeze([
  'soldier_stretcher', 'three_band', 'mixed_bands', 'recessed_panel',
  'craftsman_apron', 'double_soldier',
  'tudor_frieze', 'corbelled_cornice',
]);
/** The corner variants each QUOIN_VARIANT_OF preset gets, in chip order: `<id>_<suffix>` = its bands with every corner
 *  `cornerStyle`, named "<look> · <label>" (main/brick-panel.js). + Fred 2026-10-15: the TOOTHED quoin (the block plus its
 *  teeth, primitive-ribbon.js QUOIN_TOOTH). */
export const QUOIN_VARIANTS = Object.freeze([
  Object.freeze({ suffix: 'quoin', cornerStyle: 'block', label: 'quoin' }),
  Object.freeze({ suffix: 'toothed', cornerStyle: 'toothed', label: 'stepped' }), // Fred 2026-10-16 (seat E, via the advisor): display label only -- suffix/cornerStyle (preset ids, saved boards) stay 'toothed'
]);
const cornered = (bands, cornerStyle) => {
  const v = bands.map((b) => ({ ...b, cornerStyle }));
  return bands.bestSize ? withBestSize(bands.bestSize, v) : v;
};
const withQuoinVariants = (presets) => Object.fromEntries(Object.entries(presets).flatMap(([id, bands]) =>
  [[id, bands], ...(QUOIN_VARIANT_OF.includes(id) ? QUOIN_VARIANTS.map((v) => [`${id}_${v.suffix}`, cornered(bands, v.cornerStyle)]) : [])]));

export const FRAME_PRESETS = Object.freeze(withQuoinVariants({
  // F35 item 12 follow-up (Fred): the Frame band preset's own OFF switch -- an EMPTY band list,
  // not a special case anywhere downstream: zero bands means `bricksContourBands` has nothing to
  // shrink by, so its own `innerPath` comes back as the frame contour unchanged -- Wall fills
  // right up to the frame's own true outer contour, with no decorative band drawn along it. (T86
  // item 14: engine.js's own generateBricks used to collapse this all the way to the plain
  // rectangular `boardOutline` instead -- fixed to gate on `frame.primitives` existing at all, not
  // on `frame.bands.length`, so this preset's own true contour survives.)
  none: [],
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
  toothed_corners: [{ widthIn: 0.75, pattern: 'soldier', cornerStyle: 'toothed' }], // Fred 2026-10-15: Soldier · toothed
  double_course: [
    { widthIn: 0.75, pattern: 'soldier', cornerStyle: 'lapped' },
    { widthIn: 0.75, pattern: 'soldier', cornerStyle: 'lapped' },
  ],
  // F35 item 8 (de) + T86 item 1: "header pattern + king-closer mitres" needs no cornerStyle
  // override at all -- the mitre corner machinery every pattern already shares (true analytic
  // offset + clip, `primitive-ribbon.js`'s own `buildButtJoint`/ordinary-mitre path) naturally
  // produces whole-brick (king-closer-fraction) corner pieces for header's own small pitch, the same
  // way single_soldier's own default mitre corners do. T86 item 2: `bricksContourBands` now builds
  // 'header' directly (declared piece-length sequences, see contour-bands.js's own header) -- the
  // de-measured "1.2-1.5in before band-course.js degrades" caution no longer applies to THIS path at
  // all (confirmed: no bending/oversampling possible, every piece comes from the same exact clip
  // math soldier/stretcher always used). `editor-brick-tool.js`'s own `frameBricksFor` special-case
  // (de's) is RETIRED (F35 item 8 round 4) -- the live app now always routes header/flemish/stack
  // through this same `bricksContourBands` path, so the caution above no longer applies anywhere.
  header_band: [{ widthIn: 0.6, pattern: 'header' }],
  // T86 item 2: the dispatch's own preview combination -- header (outer, a tight decorative band),
  // flemish (middle, the alternating stretcher/header look), soldier (inner) -- in ONE frame,
  // demonstrating 3 different pattern kinds (course/course-alternating/course) stacking cleanly.
  // UX refine (2026-10-10): `bestSize` (withBestSize, above) -- its two outer bands are ONE course each,
  // the shallowest of any preset (0.2 of a brick length), so they read best a size up from the 1 1/4 in default.
  mixed_bands: withBestSize(1.5, [
    { widthIn: 0.2, pattern: 'header' }, // one course, brickHeightIn deep (courseHeightFor: header too)
    { widthIn: 0.2, pattern: 'flemish' }, // one flemish COURSE is also brickHeightIn deep -- the
    // [L,H] along-run ALTERNATION is a separate axis from the row's own cross-depth (bond.js's own
    // `courseHeightFor`: 'course-alternating' always resolves to H, confirmed, not re-derived).
    { widthIn: 0.75, pattern: 'soldier' },
  ]),
  // Frame motifs phase 1 (BAND_MOTIFS above): `rows` = the band's declared course count at every brick size (a plain band
  // without it snaps widthIn to rows, which changes with the size); widthIn = that depth at Set 1's own size (the icons).
  // Every joint is a mitre. Recommended brick size: withBestSize (the UI hint reads it); FRAME_PRESET_SIZES lists the six.
  dentil_corbel: withBestSize(1, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'dentil' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher', motif: 'corbel_table' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
  ]),
  // the border, two plain courses before the ring, the raised ring; the wall inside it recessed (`insideRelief`). The ring's
  // notched corners are NOT laid (phase 2: they need a path off the contour, not a band motif)
  recessed_panel: withBestSize(1.25, [
    { widthIn: 0.4, rows: 2, pattern: 'stretcher' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'raised', insideRelief: 'recessed' },
  ]),
  zigzag_band: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.8, rows: 4, pattern: 'header', motif: 'zigzag' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
  ]),
  // an outer plain course (the mockup had none): a stack of two obeys the fit rule (contour-bands.js fitBandStack: the lattice
  // loses rows on a narrow board); a lone 5-course band was narrowed to ONE deep row instead (narrowSingleBand -- MEASURED on
  // T6 / T11 / T14 / T15 / T16 / T17: the lattice gone, bare patches up to 0.13 of a brick face)
  diaper_lattice: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 1, rows: 5, pattern: 'header', motif: 'diaper' },
  ]),
  soldier_string: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier', motif: 'raised' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
  ]),
  dentil_cornice: withBestSize(1, [
    { widthIn: 0.4, rows: 2, pattern: 'stretcher', motif: 'raised' },
    { widthIn: 0.3, rows: 1, pattern: 'stretcher', motif: 'cornice_dentil' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
  ]),
  // 2026-10-11 (Fred, the mock's board 1; then "the large blocks should touch the edge of the frame directly"): no band of
  // its own -- the arch (withArch) is the frame, its hood and rings the outermost rows, its stones from the frame's edge
  arch_keystone: withBestSize(1, withArch('rowlock_keystone', [])),
  // 2026-10-11 (Fred, ref5): a mosaic -- ONE band of 12 square-tile rows (BAND_MOTIFS.greek_key), every tile the same size
  // (one brick height); widthIn = 12 rows at Set 1's own size. Best at the 0.75 in chip (Fred 2026-10-11 picked it): a 0.2
  // in tile pitch (0.166 in tiles), the band 2.4 in deep (at 0.375 in the 0.066 in tiles were a third grout)
  greek_key_mosaic: withBestSize(0.75, [
    { widthIn: 2.4, rows: 12, pattern: 'header', motif: 'greek_key' },
  ]),
  craftsman_apron: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher' },
  ]),
  double_soldier: withBestSize(1.25, [
    { widthIn: 0.75, rows: 1, pattern: 'soldier' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier' },
  ]),
  english_frame: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
  ]),
  stepped_fret: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher', motif: 'raised' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
  ]),
  tudor_frieze: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.8, rows: 4, pattern: 'header', motif: 'diaper' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier', motif: 'raised', insideRelief: 'recessed' },
  ]),
  corbelled_cornice: withBestSize(1, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher', motif: 'corbel_table' },
    { widthIn: 0.2, rows: 1, pattern: 'header', insideRelief: 'recessed' },
  ]),
  flemish_architrave: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.4, rows: 2, pattern: 'flemish' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier', insideRelief: 'recessed' },
  ]),
  chicago_dentil: withBestSize(1.25, [
    { widthIn: 0.3, rows: 1, pattern: 'stretcher', motif: 'dentil' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier', motif: 'raised', insideRelief: 'recessed' },
  ]),
  crenellated_battlement: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'dentil' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
  ]),
  art_deco_stepped: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.4, rows: 2, pattern: 'stretcher', motif: 'raised' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier' },
  ]),
  florentine_architrave: withBestSize(1.25, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
    { widthIn: 0.75, rows: 1, pattern: 'soldier', motif: 'raised' },
  ]),
  venetian_dentil: withBestSize(1, [
    { widthIn: 0.4, rows: 2, pattern: 'stretcher' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'dentil' },
    { widthIn: 0.2, rows: 1, pattern: 'header' },
  ]),
  // Fred 2026-10-14 ("some that are NARROWER ... 2 or 3 runners"): slim border runners, 0.2-0.4 in deep at their best size --
  // the narrowest preset before them is 1 in (header_band at 1.25 in). Every joint a mitre (tests/bricks-narrow-runners.test.js)
  slim_runner: withBestSize(0.75, [ // one raised course of small stretchers
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'raised' },
  ]),
  checker_tile_runner: withBestSize(0.75, [ // two rows of square tiles (header cells), raised checkerboard, solid corner squares
    { widthIn: 0.4, rows: 2, pattern: 'header', motif: 'checker' },
  ]),
  twin_runner: withBestSize(0.375, [ // two very thin courses, the outer raised
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'raised' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher' },
  ]),
  // Fred 2026-10-14 ("3 more brick frames that use smaller bricks but not tiles, over 3 bands" -> six, more varied): three
  // courses of SHORT bricks (BAND_MOTIFS half_ / third_: the course's height, 1/2 or 1/3 of the brick length), best at
  // 1 in (Fred 2026-10-15: three bands survive on more narrow boards than at 1 1/4). `bond` (motif units, from the board's corner line): equal = joints stacked across bands. Every joint a mitre
  // (tests/bricks-short-brick-bands.test.js)
  half_running_bond: withBestSize(1, [ // half bricks in running bond, the middle course raised
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course', bond: 0 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course_raised', bond: 1 / 4 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course', bond: 0 },
  ]),
  // half bricks, joints stacked through all three courses, the outer course raised (halves, not thirds: stacked thirds are
  // nearly square and read as a tile grid -- shots/advisor/frames, first render)
  half_stack_bond: withBestSize(1, [
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course_raised', bond: 0 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course', bond: 0 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course', bond: 0 },
  ]),
  third_stepped_bond: withBestSize(1, [ // third bricks, each course a third of a brick on (the joints step), the inner raised
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course', bond: 0 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course', bond: 1 / 9 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course_raised', bond: 2 / 9 },
  ]),
  half_slim_third: withBestSize(1, [ // raised half-brick courses either side of a slim course of thirds
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course_raised', bond: 0 },
    { widthIn: 0.12, rows: 1, pattern: 'stretcher', motif: 'slim_third_course', bond: 1 / 6 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course_raised', bond: 1 / 4 },
  ]),
  short_alternating: withBestSize(1, [ // every brick alternates raised / flush: thirds, halves, thirds a brick on (a checker)
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course_alternating', bond: 0 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'half_course_alternating', bond: 1 / 4 },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course_alternating', bond: 1 / 3 },
  ]),
  half_soldier_course: withBestSize(1, [ // half bricks standing as raised soldiers between two courses of thirds
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course', bond: 0 },
    { widthIn: 0.375, rows: 1, pattern: 'stretcher', motif: 'half_soldier_raised' },
    { widthIn: 0.2, rows: 1, pattern: 'stretcher', motif: 'third_course', bond: 1 / 6 },
  ]),
}));

/** Frame motifs phase 1: each motif preset's RECOMMENDED brick size (in) -- the biggest that still shows its structure,
 *  read off the approved mockups (shots/advisor/frames/mock_ref1-3.png). */
export const FRAME_PRESET_SIZES = Object.freeze(Object.fromEntries(
  ['dentil_corbel', 'recessed_panel', 'zigzag_band', 'diaper_lattice', 'soldier_string', 'dentil_cornice', 'greek_key_mosaic'].map((id) => [id, FRAME_PRESETS[id].bestSize])));

/**
 * Frame motifs phase 1 (2026-10-10, Fred's approved mockups shots/advisor/frames/mock_ref1-3.png, lighter = raised): every
 * laid piece of a motif band carries a RELIEF tag and the height map lifts or sinks it by the declared amount (added to its
 * heightOffset, so the app's height mask and engine.js sampleHeight read it with no further change; sampleHeight still clamps
 * the top to [0, reliefMaxIn]).
 */
// Fred 2026-10-11 (the motifs did not read in 3D: their 2D look is a tint, 3D has only this): raised 1/8 in -- a raised top
// reaches reliefIn + 1/8 = reliefMaxIn (the clamp keeps its crown at the cap); recessed -1/8 (Fred: "allow it, it's my
// responsibility" -- a recessed top sits AT the ground, level with the joints; he declined the guard that kept it above).
export const RELIEF_LEVELS = Object.freeze({ raised: 0.125, flush: 0, recessed: -0.125 });
/** A motif tile's cell characters (BAND_MOTIFS grid tiles). */
export const RELIEF_CHARS = Object.freeze({ R: 'raised', '.': 'flush', S: 'recessed' });

/**
 * The band MOTIF: a repeating sequence (or 2D on/off pattern) of RAISED / FLUSH / RECESSED pieces along a band's run -- one
 * shared mechanism (core/bricks/band-motif.js), each motif pure data. A FRAME_PRESETS band names one as `motif`.
 *   fill            -- every piece of the band (all rows, corner pieces included) takes this relief; the band's own pattern
 *                      lays the pieces as before.
 *   unit            -- 'L' or 'H': the module lengths below are in brick lengths or brick heights (of the scaled set).
 *   rowDepth        -- one row's depth, in brick heights (default 1 = a course).
 *   rows            -- 1D runs, one entry per row (outer -> inner): `seq` = the cycled [modules, relief] slots, `offset` = the
 *                      phase of the seq (modules) from the band's corner line, so rows of one band line up (the corbel's
 *                      header sits centred under its stretcher). A MODULE includes one joint: a slot of m modules lays a
 *                      piece m x unit - joint long, so the lattice is exact. Each run's first and last piece (the mitred
 *                      corner pieces, and a run's end closer) take `ends`.
 *   grid            -- 2D on/off on square cells (unit 'H', one cell per module per row): `tile` rows (outer -> inner) of
 *                      RELIEF_CHARS, repeated along the run from its start corner; `corner` = an R x R tile for the cells of
 *                      the corner square (column < R from either end of a run, R = the band's rows), e.g. a diamond.
 * The lattice is anchored at the band's corner line at a right-angle mitre (each deeper row starts one row-depth further
 * along). On a curve (an arc run) a 1D sequence still runs along the arc; a grid cannot (its columns do not line up row to
 * row on a curve) and is laid FLUSH there, as are a corner's fan slices and a quoin.
 */
export const BAND_MOTIFS = Object.freeze({
  raised: { fill: 'raised' },
  // dentil course: header ends (half a brick) raised, spaced half a brick apart (Ref 1)
  dentil: { unit: 'L', rows: [{ seq: [[0.5, 'raised'], [0.5, 'flush']] }], ends: 'raised' },
  // corbel table: inverted T -- a raised stretcher (outer row) over a raised header centred under it (inner row) (Ref 1)
  corbel_table: { unit: 'L', rows: [
    { seq: [[1, 'raised'], [0.75, 'flush']] },
    { offset: 0.25, seq: [[0.5, 'raised'], [1.25, 'flush']] },
  ], ends: 'raised' },
  // the cornice's dentils: half-brick dentils a course and a half deep, the gaps between them recessed (Ref 3)
  cornice_dentil: { unit: 'L', rowDepth: 1.5, rows: [{ seq: [[0.5, 'raised'], [0.25, 'recessed']] }], ends: 'raised' },
  // header grid, raised zigzag 2 squares thick through 4 courses; diamond corner blocks (Ref 2). Fred 2026-10-11 ("looks
  // like scattered light squares"): the period-4 tile read as noise even drawn by relief alone -- now a SYMMETRIC V, period 6
  // (down 3 courses, up 3), its arms 2 cells thick, each course's cells overlapping the next course's (one continuous
  // figure); compared in shots/seatE/relief (before / a lopsided 6 / this)
  // raisedTop / joinRaised (Fred 2026-10-11, the 3D read): its raised pieces are flat-topped plateaus and the joints between
  // two raised neighbours are filled up to them -- a V arm reads as ONE ridge (band-motif.js tagMotifRow; the height mask)
  zigzag: { unit: 'H', raisedTop: 'flat', joinRaised: true, grid: { tile: ['RR...R', '.RR.RR', '..RRR.', '...R..'], corner: ['.RR.', 'RRRR', 'RRRR', '.RR.'] } },
  // header grid, raised diamond lattice through 5 courses; diamond corners (Ref 2). 2026-10-11 (the zigzag's fault: lines
  // of single cells met only at corners) -- period 6, hollow diamonds 2 cells thick, touching side to side
  diaper: { unit: 'H', raisedTop: 'flat', joinRaised: true, grid: { tile: ['..RR..', '.RRRR.', 'RR..RR', '.RRRR.', '..RR..'], corner: ['..R..', '.RRR.', 'RRRRR', '.RRR.', '..R..'] } },
  // Greek key MOSAIC (Fred 2026-10-11, shots/advisor/frames/ref5_greek_key_mosaic.jpg: "one more frame with this spiral
  // mosaic", "so much smaller tiles"): square tiles, green = raised, white = flush. Rows 3-8 are the photo's meander read
  // cell by cell (period 6: a top bar, a spiral hook hanging from it, a full-height stem, the solid baseline); a white /
  // green / white strip either side of it. Corner: the strips turn as an L; the key's corner is a concentric square (ring +
  // 2x2 centre), symmetric about the diagonal (both runs read it). Flat raised tops with the joints between raised neighbours
  // filled (as the zigzag / diaper): the key reads as continuous strokes, not a scatter of green tiles.
  greek_key: { unit: 'H', raisedTop: 'flat', joinRaised: true, grid: {
    tile: ['......', 'RRRRRR', '......', 'RRRR.R', '...R.R', '.R.R.R', '.RRR.R', '.....R', 'RRRRRR', '......', 'RRRRRR', '......'],
    corner: [
      '............',
      '.RRRRRRRRRRR',
      '.R..........',
      '.R.RRRRRRRRR',
      '.R.R....R...',
      '.R.R.RR.R...',
      '.R.R.RR.R...',
      '.R.R....R...',
      '.R.RRRRRRRRR',
      '.R.R....R...',
      '.R.R....R.RR',
      '.R.R....R.R.',
    ] } },
  // 2026-10-14 (the narrow runners): a two-row checkerboard of square tiles; each corner square solid raised
  checker: { unit: 'H', grid: { tile: ['R.', '.R'], corner: ['RR', 'RR'] } },
  // 2026-10-14 (Fred: "smaller bricks but not tiles ... small as in not as long"): SHORT bricks, the course's own height and
  // 1/2 or 1/3 of the brick length -- the seq length (unit 'L') IS that length factor. Bond across bands: the band's `bond`
  // (FRAME_PRESETS, band-motif.js motifRowPlan). maxPieceFactor 1.5 (Fred 2026-10-15): no end closer or merged piece longer
  // than 1.5 x the motif's own brick (band-motif.js motifRowPlan)
  half_course: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 2, 'flush']] }] },
  half_course_raised: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 2, 'raised']] }], ends: 'raised' },
  half_course_alternating: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 2, 'raised'], [1 / 2, 'flush']] }] },
  third_course: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 3, 'flush']] }] },
  third_course_raised: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 3, 'raised']] }], ends: 'raised' },
  third_course_alternating: { unit: 'L', maxPieceFactor: 1.5, rows: [{ seq: [[1 / 3, 'raised'], [1 / 3, 'flush']] }] },
  // a slim course, 0.6 of a course deep (the thinner middle band)
  slim_third_course: { unit: 'L', maxPieceFactor: 1.5, rowDepth: 0.6, rows: [{ seq: [[1 / 3, 'flush']] }] },
  // half bricks standing as soldiers across the band: one course height along, half a Set 1 brick length deep (0.375 / 0.2)
  half_soldier_raised: { unit: 'H', maxPieceFactor: 1.5, rowDepth: 1.875, rows: [{ seq: [[1, 'raised']] }], ends: 'raised' },
});

/**
 * T86 item 7 (Fred: "add brick orientation and patterns for brush", refined by the advisor: "a
 * brush line can have a few brick patterns, maybe 2 and 3 bricks wide" -- "the brush = the SAME
 * band list as the frame ... laid along an OPEN path instead of a closed contour, rows offset
 * either side of the stroke centreline"). The SAME declared shape as `FRAME_PRESETS` above (so
 * `bricksContourBands` consumes either identically) -- `contour-bands.js`'s own `opts.closed:false,
 * opts.centered:true` is what makes a brush stroke's own bands straddle its centreline instead of
 * nesting inward from an outer edge; these presets never need to know that themselves. A
 * deliberately SMALL, named set (not all 7 FRAME_PRESETS) -- a thin stroke reads differently from a
 * wide frame band, so only the combinations Fred actually asked for are declared.
 */
export const BRUSH_PRESETS = Object.freeze({
  stretcher_1: [{ widthIn: 0.2, pattern: 'stretcher' }],
  stretcher_2_running: [{ widthIn: 0.4, pattern: 'stretcher' }], // 2 rows, one band -- running bond's own staggerFrac (0.5) already alternates row-to-row, no second band needed
  flemish_soldier_flemish_3: [
    { widthIn: 0.2, pattern: 'flemish' },
    { widthIn: 0.75, pattern: 'soldier' },
    { widthIn: 0.2, pattern: 'flemish' },
  ],
});

/**
 * PATTERN DEFAULTS (Fred 2026-10-11: "patterns aren't all bricks" -- pavers, blocks, mosaics): every pattern declares its
 * default SIZE (in, the absolute size the element lays at: scaleFor = size / its set's own length) and GROUT (joint width,
 * depth, profile). An element (Wall / Brick frame / Brush) lays at its pattern's defaults unless the user overrides a value
 * in that element's Size & joint section (brickSettings.sizeByElement / groutByElement / groutDepthByElement /
 * groutProfileByElement, null = the default). BRICK_PATTERN_DEFAULTS is the fallback every pattern starts from; each table
 * below lists only what a pattern changes. groutWidthIn null = the element's brick set's own declared joint.
 */
// size: Fred 2026-10-05's new-board 1 1/4 in; the joint depth is Set 1's own declared one (audit C4: never a second guess);
// a new board's joints are Recessed (Fred, turn 207)
export const BRICK_PATTERN_DEFAULTS = Object.freeze({ sizeIn: 1.25, groutWidthIn: null, groutDepthIn: BRICK_SETS.find((x) => x.id === 1).grout.depthIn, groutProfile: 'recessed' });
/** the Wall's patterns (BRICK_PATTERNS ids): none differs yet (non-brick defaults come as rows, Fred 2026-10-11) */
export const WALL_PATTERN_DEFAULTS = Object.freeze({});
/** the Brick frame's presets: their size is the preset's bestSize (withBestSize, above); other values per preset here */
export const FRAME_PRESET_DEFAULTS = Object.freeze({});
/** the Brush's presets (BRUSH_PRESETS ids): none differs yet */
export const BRUSH_PRESET_DEFAULTS = Object.freeze({});
/** Which pattern registry an element reads, and which brickSettings key holds its pick (raisedBrush paints the Brush's). */
export const ELEMENT_PATTERN = Object.freeze({
  wall: Object.freeze({ key: 'pattern', table: WALL_PATTERN_DEFAULTS }),
  frame: Object.freeze({ key: 'frameBandPreset', table: FRAME_PRESET_DEFAULTS }),
  brush: Object.freeze({ key: 'brushBandPreset', table: BRUSH_PRESET_DEFAULTS }),
});
/** A pattern's defaults: the fallback, its bestSize (a frame preset), then its own table row. `kind` wall | frame | brush. */
export function patternDefaultsOf(kind, id) {
  const spec = ELEMENT_PATTERN[kind];
  const best = kind === 'frame' && FRAME_PRESETS[id] && FRAME_PRESETS[id].bestSize;
  return { ...BRICK_PATTERN_DEFAULTS, ...(best ? { sizeIn: best } : {}), ...((spec && spec.table[id]) || {}) };
}

export function brickSetById(id) {
  return BRICK_SETS.find((s) => s.id === id) || null;
}

/** Fred 2026-10-11 (EDGE TAPER: "the current ones seem particularly tapered, fine, but I want to control it"): the
 *  per-element override of a set's heightProfile.edgeRadiusIn (the shoulder's reach), 0 = a sharp edge up to
 *  `maxFactor` x the widest set default. Untouched = the element's set's own (P.brickSettings.edgeByElement null). */
export const EDGE_TAPER = Object.freeze((() => {
  const maxFactor = 2, stepIn = 0.005;
  const widest = Math.max(...BRICK_SETS.map((s) => (s.heightProfile && s.heightProfile.edgeRadiusIn) || 0));
  return { minIn: 0, maxIn: Math.ceil((maxFactor * widest) / stepIn) * stepIn, stepIn, maxFactor };
})());

export function enabledPieces(catalogue = PIECE_CATALOGUE) {
  return catalogue.filter((p) => p.enabled !== false);
}

/**
 * A scaled COPY of `set` -- never mutates the declared original -- with `brickLengthIn`/
 * `brickHeightIn` multiplied and every other field (relief, samples, engine, ...) carried over
 * untouched. `scale` omitted or 1 returns `set` itself (no allocation) so the common, unscaled path
 * stays cheap.
 *
 * F35 item 16 (Fred, REVERSING F35 item 7's own revision below): grout width is ONE GLOBAL value
 * in inches (`P.brickSettings.grout.widthIn`, main/brick-panel.js) that does NOT move when brick
 * size changes -- the set's own declared grout:brickHeightIn ratio (e.g. Set 1's 0.17) only ever
 * SEEDS that global value once, the first time a board gets bricks; after that the user's own
 * grout width is independent of brick size, same as a real mason doesn't re-measure the joint
 * every time the brick supplier changes. `scaledSet` itself never touches `grout` at all now --
 * item 7's own "scale it WITH the brick" rule is exactly what this reverses; the caller
 * (toBrickOpts) is the one place that still overrides `grout.widthIn`, from the global value
 * directly, regardless of `scale`.
 */
export function scaledSet(set, scale) {
  if (!scale || scale === 1) return set;
  return {
    ...set,
    brickLengthIn: set.brickLengthIn * scale,
    brickHeightIn: set.brickHeightIn * scale,
  };
}
