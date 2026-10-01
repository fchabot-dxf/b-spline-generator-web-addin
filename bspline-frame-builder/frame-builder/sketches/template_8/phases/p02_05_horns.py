def get_block(ui_data=None):
    """
    Phase 4b: Horn Tip Welds (Template 8 - Dipped Top + Left-Only Wave).
    Connects each horn/stub :E endpoint to the free end of its adjacent arc.
    Runs after the arc chain (p02_04) so the chain-side endpoints are already taken:
      arc_shoulder_L:S is used by the waist chain -> free end is :E
      arc_hip_L:E      is used by the waist chain -> free end is :S
      arc_top_shoulder_L:S / arc_top_shoulder_R:E are used by the top chain -> free ends are :E / :S
    No RIGHT side weld: `side_R` has no arc to weld to (its own ends are already Coincident to the top/bottom
    stubs, set in p02_03's corner topology).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'arc_shoulder_L:S'], 'Name': 'horn_tip_weld_TL'},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'arc_hip_L:E'],      'Name': 'horn_tip_weld_BL'},
        {'Type': 'Coincident', 'Targets': ['top_edge_L:E', 'arc_top_shoulder_L:E'], 'Name': 'top_stub_weld_L'},
        {'Type': 'Coincident', 'Targets': ['top_edge_R:S', 'arc_top_shoulder_R:S'], 'Name': 'top_stub_weld_R'},
    ]

    return {"Name": "HornTips", "PhaseID": "p02_05_horns", "BuildSequence": seq}
