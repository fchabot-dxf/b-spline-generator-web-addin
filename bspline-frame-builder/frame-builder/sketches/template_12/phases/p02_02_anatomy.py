def get_block(ui_data=None):
    """
    Anatomy: skeleton lines defining shoulder, waist, and hip zones (Template 12 - Hourglass - Tapered sides).

    Same pins, ids and constraints as Template 1's p02_02_anatomy; only the
    literal seed Y/X values differ, recomputed together with p02_03_loop's
    own seeds (F30 item 3: the app's own taper construction only ever moves
    the TOP horn and, past its own feasible floor, the shoulder circle --
    the waist/hip are untouched by taper, same algebra as Template 1 -- but
    every pin is still recomputed at the SAME reference board as the loop
    seeds below, same discipline Template 3's own p02_02_anatomy already
    established, so the default (pre-"Send frame") sketch is internally
    consistent rather than mixing two different boards' numbers).

    Seeds: the 7x9 solve of the app's provisional Template 12 shape at its
    own default taperAngle (8 deg) -- paramsFromShapeModel('hourglass',
    Template 1's shapeModel, the board's own SAFE ZONE, 6.5x8.5 at 7x9/0.25in
    border) through hourglassConstruction, each absolute value then divided
    by the RAW board size (seed_basis.py's own "seed board" convention: a
    literal fraction f means f * widthIn, chosen so that AT THE DEFAULT
    boundingboxoffset it equals the safe-zone-based value -- Template 3's own
    p02_02_anatomy doc comment has the worked example). Symmetric L/R
    (Template 1's own slight L/R asymmetry is not reproduced; this template
    always draws symmetric). The waist and hip numbers below are IDENTICAL
    to Template 3's own (both untouched by either template's own feature,
    the same T1 fit): waist R/L outer X = +/-widthIn * 0.41562, Y =
    -heightIn * 0.000304; hip R/L outer X = +/-widthIn * 0.375249, Y =
    -heightIn * 0.141685 -- cross-checked against Template 3's own shipped
    values, not just computed in isolation.
      shoulder R/L: outer X = +/-widthIn * 0.375249, Y = heightIn * 0.141077
      waist    R/L: outer X = +/-widthIn * 0.41562,  Y = -heightIn * 0.000304
      hip      R/L: outer X = +/-widthIn * 0.375249, Y = -heightIn * 0.141685

    Seeds are deliberately offset by 0.001 at the inner endpoint to avoid
    Fusion auto-coincidence with the Y axis before the explicit Y_AXIS
    constraint applies.

    StartID / EndID convention (as Template 1):
      :S = inner endpoint (near origin)
      :E = outer endpoint (at the span, = the arc's own centre)
    """
    seq = [
        # SHOULDER pair (unchanged by taper: Branch A never moves the shoulder circle's own centre, see
        # editor-shape-lattice-generator.js's own _taperedCorner doc comment)
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'Points': [['0.001', 'heightIn * 0.141077'], ['widthIn * 0.375249', 'heightIn * 0.141077']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.141077'], ['-widthIn * 0.375249', 'heightIn * 0.141077']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E', 'IsConstruction': True},

        # WAIST pair
        {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'Points': [['0.001', '-heightIn * 0.000304'], ['widthIn * 0.41562', '-heightIn * 0.000304']], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'Points': [['-0.001', '-heightIn * 0.000304'], ['-widthIn * 0.41562', '-heightIn * 0.000304']], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E', 'IsConstruction': True},

        # HIP pair
        {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'Points': [['0.001', '-heightIn * 0.141685'], ['widthIn * 0.375249', '-heightIn * 0.141685']], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'Points': [['-0.001', '-heightIn * 0.141685'], ['-widthIn * 0.375249', '-heightIn * 0.141685']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E', 'IsConstruction': True},

        # Horizontal on every pin (locks Y to the seed Y).
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},

        # Anchor each pair's inner endpoint to the Y axis.
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'Y_AXIS']},

        # Merge inner endpoints across each pair (R:S coincident with L:S).
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'skel_waist_pin_L:S']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'skel_hip_pin_L:S']},
    ]

    return {
        'Name': 'Anatomy',
        'PhaseID': 'p02_02_anatomy',
        'BuildSequence': seq,
    }
