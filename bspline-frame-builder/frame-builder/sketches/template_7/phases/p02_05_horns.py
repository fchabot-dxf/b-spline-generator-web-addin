def get_block(ui_data=None):
    """
    Phase 4b: Horn Tip Welds (T7: unchanged from Template 1 -- the horns'
    own far ends still weld to the shoulder/hip arcs exactly as before;
    only their NEAR ends now meet the roof instead of a flat top edge,
    wired in p02_03_loop.py).
    Connects each horn :E endpoint to the free end of its adjacent
    shoulder/hip arc. Runs after the waist chain (p02_04_chain) so the
    chain-side endpoints are already taken:
      arc_shoulder_R:S and arc_shoulder_L:S are used by waist chain -> free end is :E
      arc_hip_R:E    and arc_hip_L:E    are used by waist chain -> free end is :S
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['horn_TR:E', 'arc_shoulder_R:E'], 'Name': 'horn_tip_weld_TR'},
        {'Type': 'Coincident', 'Targets': ['horn_BR:E', 'arc_hip_R:S'],      'Name': 'horn_tip_weld_BR'},
        {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'arc_shoulder_L:S'], 'Name': 'horn_tip_weld_TL'},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'arc_hip_L:E'],      'Name': 'horn_tip_weld_BL'},
    ]

    return {"Name": "HornTips", "PhaseID": "p02_05_horns", "BuildSequence": seq}
