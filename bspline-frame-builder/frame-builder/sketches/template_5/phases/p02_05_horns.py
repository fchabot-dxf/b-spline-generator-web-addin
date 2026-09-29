def get_block(ui_data=None):
    """
    Phase 4b: Horn Tip Welds.
    Connects each horn :E endpoint to the free end of its adjacent shoulder/hip arc.
    Runs after the waist chain (p4_chain) so the chain-side endpoints are already taken:
      arc_shoulder_R:S and arc_shoulder_L:S are used by waist chain → free end is :E
      arc_hip_R:E    and arc_hip_L:E    are used by waist chain → free end is :S
    T5: the dipped top's stubs weld to their shoulder arcs' free ends the same way
    (arc_top_shoulder_L:S / arc_top_shoulder_R:E are taken by the top chain).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['horn_TR:E', 'arc_shoulder_R:E'], 'Name': 'horn_tip_weld_TR'},
        {'Type': 'Coincident', 'Targets': ['horn_BR:E', 'arc_hip_R:S'],      'Name': 'horn_tip_weld_BR'},
        {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'arc_shoulder_L:S'], 'Name': 'horn_tip_weld_TL'},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'arc_hip_L:E'],      'Name': 'horn_tip_weld_BL'},
        {'Type': 'Coincident', 'Targets': ['top_edge_L:E', 'arc_top_shoulder_L:E'], 'Name': 'top_stub_weld_L'},
        {'Type': 'Coincident', 'Targets': ['top_edge_R:S', 'arc_top_shoulder_R:S'], 'Name': 'top_stub_weld_R'},
    ]

    return {"Name": "HornTips", "PhaseID": "p02_05_horns", "BuildSequence": seq}
