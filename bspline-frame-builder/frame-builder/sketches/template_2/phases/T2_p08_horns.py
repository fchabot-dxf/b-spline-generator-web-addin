def get_block(ui_data=None):
    """
    Phase 4b: Horn Tip Welds.
    Connects each horn :E endpoint to the free end of its adjacent waist/hip arc.
    Runs after the waist chain (p4_chain) so the chain-side endpoints are already taken:
      arc_waist_R:E and arc_waist_L:E are used by waist chain → free end is :S
      arc_hip_R:E    and arc_hip_L:E    are used by waist chain → free end is :S
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['horn_TR:E', 'arc_waist_R:S'], 'Name': 'horn_tip_weld_TR'},
        {'Type': 'Coincident', 'Targets': ['horn_BR:E', 'arc_hip_R:S'],      'Name': 'horn_tip_weld_BR'},
        {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'arc_waist_L:S'], 'Name': 'horn_tip_weld_TL'},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'arc_hip_L:E'],      'Name': 'horn_tip_weld_BL'},
    ]

    return {"Name": "HornTips", "PhaseID": "p08_horns", "BuildSequence": seq}
