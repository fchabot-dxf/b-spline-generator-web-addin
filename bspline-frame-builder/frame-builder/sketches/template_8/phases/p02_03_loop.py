def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 8 - Dipped Top + Left-Only Wave).

    Combines Template 5's dipped top (stub, convex shoulder arc, concave dip arc, convex shoulder arc, stub) with
    a plain, arc-free right side and base (Template 1's classic corners, no pinch at all) and Template 1's own
    LEFT-side pinch (shoulder / waist / hip arcs, this template's only pinch - "the wave"). The corners stay
    square (a stub on both legs of each corner), so the four mitered bars keep clean 45 deg miters, same as every
    other template.

    RIGHT SIDE (Fred: "right side straight"): Template 1's horn_TR + arc_shoulder_R + arc_waist_R + arc_hip_R +
    horn_BR (5 pieces) collapse into ONE line, `side_R`, directly corner to corner. It needs no Vertical
    constraint of its own: both its ends are Coincident to `proj_off_corner_TR` / `proj_off_corner_BR` (via
    top_edge_R:E / bottom_edge:S below), two corners of the SAME axis-aligned offset rectangle, so they already
    share one X - `side_R` is vertical purely as a consequence of that, with 0 DOF left over (4 raw DOF, 2
    Coincidents removing 2 each).

    LEFT SIDE: Template 1's own hip / waist / shoulder arcs and horns, unchanged seeds - this template's "wave".

    TOP (Fred's sketch: the dip sits in the middle-RIGHT of the top edge, not centred): Template 5's own dip
    construction (stub, shoulder arc, dip arc, shoulder arc, stub) - the corner-anchored ends (top_edge_L:S at
    TL, top_edge_R:E at TR) stay exactly on the corners; the shoulders/dip sit at `topDipPositionOfHw` right of
    centre. The app's own "dip position" handle (seeded, see template_data.py FRAME_SEED_MAP) is what actually
    places it at Send time; the seed literals here are only this template's own starting point for a hand build.

    AMENDMENT (seat A's live finding on Template 5): copying Template 5's own dip seed literals verbatim would
    have repeated its bug -- its seed RADIUS scales with heightIn only (`heightIn * 0.272158`) while the span it
    bridges (the half width `a`) scales with widthIn, so the seed is only right at the one board (7x9) it was
    hand-tuned on and flips (12x6) or fails (5.51x1.97) elsewhere. Every dip seed below is instead a genuine
    closed-form Fusion EXPRESSION in BOTH `widthIn` and `heightIn` (via HW/HH, the bbox-offset-corrected half
    sizes), computed once per board by Fusion itself, not a decimal baked in at one board size:
      a (half width)  = HW * topDipWidth        (0.4, this template's own default)
      d (depth)       = HH * topDipDepth         (0.14)
      pos (shift)     = HW * topDipPosition      (0.15, right of centre)
      r (radius)      = (a^2 + d^2) / (4d)       -- the exact tangent-triple formula editor-shape-lattice-
                        generator.js's own hourglassConstruction uses, for ANY width/height/dip size
    The three arc points interpolate between the stub end (at HH) and the dip's own lowest point (HH - d, where
    the dip's own middle point sits exactly, by the same tangency this formula encodes) at the SAME proportions
    Template 5's own hand-tuned 7x9 seed used (fraction 0.5 at the shoulder/dip joint, 0.742 / 0.128 at each
    arc's own middle point) - only WHICH dimensions scale those proportions is fixed, not the proportions
    themselves (seat A's own existing numbers at 7x9 already validate SOME derivation gets a Fusion solve going;
    this is the one that also tracks correctly at other boards). UNIT-TESTED at 7x9 / 12x6 / 5.51x1.97 against
    the app's own exact formula (tests/frame-template-8.test.js's seed-geometry test, and a dedicated pytest
    checking this expression evaluates sanely at all three -- see fb_engine/test_seed_basis.py).

    Loop direction: clockwise, starting at the top-right corner (matches template_data.py's FRAME_SEED_MAP `prim`
    indices 0-11):
      0 side_R, 1 bottom_edge, 2 horn_BL, 3 arc_hip_L, 4 arc_waist_L (the wave), 5 arc_shoulder_L, 6 horn_TL,
      7 top_edge_L, 8 arc_top_shoulder_L, 9 arc_top_dip, 10 arc_top_shoulder_R, 11 top_edge_R.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    # The bbox-offset-corrected half width / height, as live Fusion expressions (both widthIn and heightIn are
    # Fusion parameters; boundingboxoffset is too - SKETCH_1_PARAMETERS in template_data.py).
    HW = '(widthIn/2 - boundingboxoffset)'
    HH = '(heightIn/2 - boundingboxoffset)'
    # This template's own dip defaults (fractions of HW/HH, matching FRAME_PROVISIONAL_SHAPE in template_data.py
    # and PRESETS.dippedLeftWave in editor-shape-lattice-generator.js).
    A = f'({HW} * 0.4)'        # half width
    D = f'({HH} * 0.14)'       # depth
    POS = f'({HW} * 0.15)'     # shift right of centre
    R = f'(({A}*{A} + {D}*{D}) / (4*{D}))'  # the exact tangent-triple radius, any board

    seq = [
        # 1. The plain right side + base (Template 1's literal corner-hugging seeds).
        {'ID': 'side_R', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn/2 - 0.001'], ['widthIn/2 - 0.001', '-heightIn/2 + 0.001']], 'StartID': 'side_R:S', 'EndID': 'side_R:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Top dip stubs: HW/HH-aware (see this function's own doc comment); the corner ends stay on the corners.
        {'ID': 'top_edge_L', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], [f'-{A} + {POS}', HH]], 'StartID': 'top_edge_L:S', 'EndID': 'top_edge_L:E'},
        {'ID': 'top_edge_R', 'Type': 'Line', 'Points': [[f'{A} + {POS}', HH], ['widthIn/2 - 0.001', 'heightIn/2 - 0.001']], 'StartID': 'top_edge_R:S', 'EndID': 'top_edge_R:E'},

        # 3. LEFT vertical horn (Template 1's own literal seed; no right horn - side_R replaces it entirely).
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TL', 'horn_BL']},

        # 4. Corner topology: exactly ONE direct anchor per corner (Template 1/5's own convention); every other
        # piece meeting there welds to that anchor's own endpoint (never independently to the projected corner).
        {'Type': 'Coincident', 'Targets': ['top_edge_L:S', 'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['top_edge_R:E', 'proj_off_corner_TR']},
        {'Type': 'Horizontal', 'Targets': ['top_edge_L', 'top_edge_R']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge_L:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},
        {'Type': 'Coincident', 'Targets': ['side_R:S', 'top_edge_R:E']},
        {'Type': 'Coincident', 'Targets': ['side_R:E', 'bottom_edge:S']},

        # 5. LEFT arcs (Template 1's own literal seeds, unchanged - this template's only pinch, "the wave").
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.079718'], ['-widthIn * 0.452856', '-heightIn * 0.100638'], ['-widthIn * 0.476432', '-heightIn * 0.151146']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.071429'], ['-widthIn * 0.315446', '0'], ['-widthIn * 0.395939', 'heightIn * 0.071429']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.476432', 'heightIn * 0.15042'], ['-widthIn * 0.452856', 'heightIn * 0.099912'], ['-widthIn * 0.395939', 'heightIn * 0.078992']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_L'},

        # 6. The dipped top's three arcs: HW/HH-aware (see this function's own doc comment - the AMENDMENT fix).
        # Each arc's 3-point seed interpolates between the stub end (at HH) and the shoulder/dip joint (at
        # HH - d/2) at Template 5's own hand-tuned proportions (0.742 / 0.128), now scaled by A/D (both
        # dimensions) instead of a single heightIn-only decimal. One seed radius each (the exact formula R,
        # not a board-specific constant), deleted in p02_09.
        {'ID': 'arc_top_shoulder_L', 'Type': 'Arc3Point', 'Points': [
            [f'-{A} + {POS}', HH],
            [f'-{A}*0.742 + {POS}', f'{HH} - {D}*0.128'],
            [f'-{A}*0.5 + {POS}', f'{HH} - {D}*0.5']], 'StartID': 'arc_top_shoulder_L:S', 'EndID': 'arc_top_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_top_shoulder_L', 'Expression': R, 'Name': 'seed_rad_top_shoulder_L'},
        {'ID': 'arc_top_dip', 'Type': 'Arc3Point', 'Points': [
            [f'-{A}*0.5 + {POS}', f'{HH} - {D}*0.5'],
            [f'{POS} + 0.001', f'{HH} - {D}'],
            [f'{A}*0.5 + {POS}', f'{HH} - {D}*0.5']], 'StartID': 'arc_top_dip:S', 'EndID': 'arc_top_dip:E'},
        {'Type': 'Radius', 'Target': 'arc_top_dip', 'Expression': R, 'Name': 'seed_rad_top_dip'},
        {'ID': 'arc_top_shoulder_R', 'Type': 'Arc3Point', 'Points': [
            [f'{A}*0.5 + {POS}', f'{HH} - {D}*0.5'],
            [f'{A}*0.742 + {POS}', f'{HH} - {D}*0.128'],
            [f'{A} + {POS}', HH]], 'StartID': 'arc_top_shoulder_R:S', 'EndID': 'arc_top_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_top_shoulder_R', 'Expression': R, 'Name': 'seed_rad_top_shoulder_R'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }
