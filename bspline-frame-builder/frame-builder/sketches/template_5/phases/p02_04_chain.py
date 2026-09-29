def get_block(ui_data=None):
    """
    Phase 4: Arc Chain.
    Head-to-tail Coincident constraints connecting the six arc seeds
    into a continuous curve on each side before tangency is applied.
    Isolated as its own phase for incremental inspection.

    T5: the dipped top's three arcs chain the same way (Fusion orders
    every arc counter-clockwise: the left shoulder runs dip -> stub, the
    dip left -> right, the right shoulder stub -> dip).
    """
    seq = [
        # RIGHT side: waist:S meets shoulder:S, waist:E meets hip:E
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:S', 'arc_shoulder_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E', 'arc_hip_R:E']},
        # LEFT side: waist:S meets hip:S, waist:E meets shoulder:E
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:S', 'arc_hip_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:E']},
        # T5 TOP: dip:S meets the left top shoulder's dip end (:S), dip:E the right one's (:E)
        {'Type': 'Coincident', 'Targets': ['arc_top_dip:S', 'arc_top_shoulder_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_top_dip:E', 'arc_top_shoulder_R:E']},
    ]

    return {"Name": "ArcChain", "PhaseID": "p02_04_chain", "BuildSequence": seq}
