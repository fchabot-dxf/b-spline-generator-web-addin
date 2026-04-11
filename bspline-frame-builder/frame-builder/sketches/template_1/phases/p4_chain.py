def get_block(ui_data=None):
    """
    Phase 4: Arc Chain.
    Head-to-tail Coincident constraints connecting the six arc seeds
    into a continuous curve on each side before tangency is applied.
    Isolated as its own phase for incremental inspection.
    """
    seq = [
        # RIGHT side junctions (waist :S/E are flipped vs shoulder/hip)
        # shoulder_R:E (shoulder junction) meets waist_R:E (shoulder junction)
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:E']},
        # waist_R:S (hip junction) meets hip_R:S (hip junction)
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:S',    'arc_hip_R:S']},
        # LEFT side junctions
        # hip_L:E (hip junction) meets waist_L:E (hip junction)
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:E',      'arc_waist_L:E']},
        # waist_L:S (shoulder junction) meets shoulder_L:S (shoulder junction)
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:S',    'arc_shoulder_L:S']},
    ]

    return {"Name": "ArcChain", "BuildSequence": seq}
