def get_block(ui_data=None):
    """
    Anatomy: skeleton lines defining shoulder, waist, and hip zones
    (Template 3 - Tapered Hourglass; same pins, ids and constraints as
    Template 1's p02_02_anatomy).

    Three pairs of horizontal construction lines meeting at the Y_AXIS,
    one pair per anatomical level. Each pin's OUTER end is welded to its
    arc's centre later (p02_06 waist, p02_10 shoulder/hip).

    Seeds (T3): the pin ends at the arc centres of the 7x9 solve of the
    app's provisional Template 3 shape (see p02_03_loop), as widthIn /
    heightIn fractions, symmetric L/R:
      shoulder R/L: outer X = +/-widthIn * 0.269947, Y =  heightIn * 0.089903
                    (shorter than Template 1's 0.35: the shoulder centre sits
                    under the narrow top horn, hw - topInset - r)
      waist    R/L: outer X = +/-widthIn * 0.41562,  Y = -heightIn * 0.000304
      hip      R/L: outer X = +/-widthIn * 0.375249, Y = -heightIn * 0.141685

    Seeds are deliberately offset by 0.001 at the inner endpoint to avoid
    Fusion auto-coincidence with the Y axis before the explicit Y_AXIS
    constraint applies.

    StartID / EndID convention (as Template 1):
      :S = inner endpoint (near origin)
      :E = outer endpoint (at the span)
        """
    seq = [
        # SHOULDER pair (T3: shorter -- the shoulder centre sits under the narrow top horn)
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'Points': [['0.001', 'heightIn * 0.089903'], ['widthIn * 0.269947', 'heightIn * 0.089903']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.089903'], ['-widthIn * 0.269947', 'heightIn * 0.089903']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E', 'IsConstruction': True},

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
