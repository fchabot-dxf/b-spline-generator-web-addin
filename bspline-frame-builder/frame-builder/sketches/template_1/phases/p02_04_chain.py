def get_block(ui_data=None):
    """
    Phase 4: Arc Chain.
    Head-to-tail Coincident constraints connecting the six arc seeds
    into a continuous curve on each side before tangency is applied.
    Isolated as its own phase for incremental inspection.
    """
    seq = [
        # RIGHT side: waist:S meets shoulder:S, waist:E meets hip:E
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:S', 'arc_shoulder_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E', 'arc_hip_R:E']},
        # LEFT side: waist:S meets hip:S, waist:E meets shoulder:E
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:S', 'arc_hip_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:E']},
    ]

    return {"Name": "ArcChain", "PhaseID": "p02_04_chain", "BuildSequence": seq}
