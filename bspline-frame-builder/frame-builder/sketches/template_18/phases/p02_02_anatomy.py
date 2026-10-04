def get_block(ui_data=None):
    """
    Anatomy: skeleton lines defining shoulder, waist, and hip zones.

    Identical to Template 1's own (the sides and base are untouched by the top arch; only p02_03's own top rails
    and p02_01's own extra top-line projection differ). See Template 1's copy of this phase for the full
    rationale.

    Hardcoded values (X is per-side outer endpoint = total span / 2):
      shoulder R: outer X = widthIn * 0.34996,   Y =  heightIn * 0.15042
      shoulder L: outer X = widthIn * -0.350521, Y =  heightIn * 0.15042
      waist  R/L: outer X = widthIn * +/-0.35,   Y =  0
      hip    R/L: outer X = widthIn * +/-0.34996, Y = -heightIn * 0.151146

    StartID / EndID convention preserved from Template 1:
      :S = inner endpoint (near origin)
      :E = outer endpoint (at the span)
    """
    seq = [
        # SHOULDER pair
        {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'Points': [['0.001', 'heightIn * 0.15042'], ['widthIn * 0.34996', 'heightIn * 0.15042']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.15042'], ['-widthIn * 0.350521', 'heightIn * 0.15042']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E', 'IsConstruction': True},

        # WAIST pair
        {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'Points': [['0.001', '0'], ['widthIn * 0.35', '0']], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'Points': [['-0.001', '0'], ['widthIn * -0.35', '0']], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E', 'IsConstruction': True},

        # HIP pair
        {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'Points': [['0.001', '-heightIn * 0.151146'], ['widthIn * 0.34996', '-heightIn * 0.151146']], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E', 'IsConstruction': True},
        {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'Points': [['-0.001', '-heightIn * 0.151146'], ['-widthIn * 0.34996', '-heightIn * 0.151146']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E', 'IsConstruction': True},

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
