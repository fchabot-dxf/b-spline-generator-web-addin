def get_block(ui_data=None):
    """
    Phase 4: Arc Chain.
    Head-to-tail Coincident constraints connecting the six arc seeds
    into a continuous curve on each side before tangency is applied.
    Isolated as its own phase for incremental inspection.
    """
    seq = [
        # RIGHT side: shoulder top → waist → hip bottom (head-to-tail E→S)
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:S']},
        # LEFT side: hip bottom → waist → shoulder top (head-to-tail E→S)
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:E',      'arc_waist_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E',    'arc_shoulder_L:S']},
    ]

    return {"Name": "ArcChain", "BuildSequence": seq}
