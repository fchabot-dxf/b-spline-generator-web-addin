def get_block(ui_data=None):
    """
    Anatomy: skeleton lines defining the LEFT wave's shoulder, waist, and hip zones (Template 8 - Dipped Top +
    Left-Only Wave).

    Template 1 pairs a LEFT and a RIGHT skeleton pin per level (shoulder / waist / hip), merged at their inner
    (Y axis) endpoint so both sides pinch at the same height (p02_02_anatomy.py's own doc comment). Template 8's
    right side has no pinch at all (a plain straight side, see p02_03_loop's own doc comment) - there is no right
    pin to merge with - so each LEFT pin anchors its inner endpoint to the Y axis ON ITS OWN, exactly Template 4's
    own trick for keeping a pinch independent (per pin: Horizontal + one Coincident to Y_AXIS, the same count
    Template 1 uses for its own R pin, so nothing over-constrains).

    Seeds: Template 1's own LEFT literals (widthIn / heightIn fractions) - a reasonable hand-build default; the
    app's own "left wave reach" / "left wave height" handles seed the LIVE shape at Send time (frame-only, seeded
    binding - see template_data.py FRAME_SEED_MAP), so these literals are only the template's own starting point.

    StartID / EndID convention (as Template 1):
      :S = inner endpoint (on Y_AXIS)
      :E = outer endpoint (welded to the arc centre, p02_06 waist / p02_10 shoulder+hip)
    """
    seq = [
        {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [['-0.001', 'heightIn * 0.15042'], ['-widthIn * 0.350521', 'heightIn * 0.15042']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E', 'IsConstruction': True},
        {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'Points': [['-0.001', '0'], ['widthIn * -0.35', '0']], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E', 'IsConstruction': True},
        {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'Points': [['-0.001', '-heightIn * 0.151146'], ['-widthIn * 0.34996', '-heightIn * 0.151146']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E', 'IsConstruction': True},

        {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
        {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},

        {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_L:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_waist_pin_L:S', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['skel_hip_pin_L:S', 'Y_AXIS']},
    ]

    return {
        'Name': 'Anatomy',
        'PhaseID': 'p02_02_anatomy',
        'BuildSequence': seq,
    }
