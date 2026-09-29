def get_block(ui_data=None):
    """
    Anatomy: skeleton lines defining shoulder, waist, and hip zones
    (Template 4 - Offset Hourglass; same pins and ids as Template 1's
    p02_02_anatomy, the left and right pins no longer welded together).

    Three pairs of horizontal construction lines, one pair per anatomical
    level, each pin's inner end on the Y_AXIS. Each pin's OUTER end is
    welded to its arc's centre later (p02_06 waist, p02_10 shoulder/hip).

    T4 OFFSET HOURGLASS: Template 1 merges each pair's inner ends
    (Coincident R:S = L:S), which forces the left and right pins of a level
    to the same height, i.e. the left waist pinch at the right one's height.
    Here each pin's inner end sits on the Y_AXIS on its own, so the left
    pinch (and the shoulder / hip that follow it through the tangencies)
    keeps its own height. Per pin that is the same count Template 1 used for
    the R pin (Horizontal + Coincident to the Y_AXIS), so nothing new can
    over-constrain; the left pin just trades "same point as R:S" (2 eqs) for
    "on the Y axis" (1 eq): one more degree of freedom per level, its height.

    Seeds (T4): the pin ends at the arc centres of the 7x9 solve of the
    app's provisional Template 4 shape (see p02_03_loop), as widthIn /
    heightIn fractions. Right pinch low, left pinch high:
      shoulder R: outer X =  widthIn * 0.375249, Y =  heightIn * 0.046632
      shoulder L: outer X = -widthIn * 0.375249, Y =  heightIn * 0.235521
      waist    R: outer X =  widthIn * 0.41562,  Y = -heightIn * 0.094749
      waist    L: outer X = -widthIn * 0.41562,  Y =  heightIn * 0.09414
      hip      R: outer X =  widthIn * 0.375249, Y = -heightIn * 0.236129
      hip      L: outer X = -widthIn * 0.375249, Y = -heightIn * 0.04724

    Seeds are deliberately offset by 0.001 at the inner endpoint to avoid
    Fusion auto-coincidence with the Y axis before the explicit Y_AXIS
    constraint applies.

    StartID / EndID convention (as Template 1):
      :S = inner endpoint (on Y_AXIS)
      :E = outer endpoint (welded to the arc centre)
    """
    seq = [
        # SHOULDER pair
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'Points': [['0.001', 'heightIn * 0.046632'], ['widthIn * 0.375249', 'heightIn * 0.046632']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.235521'], ['-widthIn * 0.375249', 'heightIn * 0.235521']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E', 'IsConstruction': True},

        # WAIST pair (T4: the right pinch low, the left one high)
        {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'Points': [['0.001', '-heightIn * 0.094749'], ['widthIn * 0.41562', '-heightIn * 0.094749']], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.09414'], ['-widthIn * 0.41562', 'heightIn * 0.09414']], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E', 'IsConstruction': True},

        # HIP pair
        {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'Points': [['0.001', '-heightIn * 0.236129'], ['widthIn * 0.375249', '-heightIn * 0.236129']], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'Points': [['-0.001', '-heightIn * 0.04724'], ['-widthIn * 0.375249', '-heightIn * 0.04724']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E', 'IsConstruction': True},

        # Horizontal on every pin (locks Y to the seed Y).
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},

        # Anchor EVERY pin's inner endpoint to the Y axis on its own (T4: no R:S = L:S merge, see above).
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_L:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_L:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_L:S', 'Y_AXIS']},
    ]

    return {
        'Name': 'Anatomy',
        'PhaseID': 'p02_02_anatomy',
        'BuildSequence': seq,
    }
