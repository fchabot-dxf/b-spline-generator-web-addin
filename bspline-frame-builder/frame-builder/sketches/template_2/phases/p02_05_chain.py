def get_block(ui_data=None):
    """
    Phase 7: Arc Chain.
    Head-to-tail Coincident constraints connecting the six arc seeds
    and horn tips into a continuous curve on each side before tangency
    is applied. Isolated as its own phase for incremental inspection.
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ["arc_waist_R:S", "horn_TR:E"]},
        {'Type': 'Coincident', 'Targets': ["arc_waist_R:E", "arc_hip_R:E"]},
        {'Type': 'Coincident', 'Targets': ["arc_hip_R:S", "horn_BR:E"]},
        {'Type': 'Coincident', 'Targets': ["arc_waist_L:E", "horn_TL:E"]},
        {'Type': 'Coincident', 'Targets': ["arc_waist_L:S", "arc_hip_L:S"]},
        {'Type': 'Coincident', 'Targets': ["horn_BL:E", "arc_hip_L:E"]},
    ]
    seq += [
        {'Type': 'Tangent', 'Targets': ["horn_BL", "arc_hip_L"]},
        {'Type': 'Tangent', 'Targets': ["arc_waist_L", "arc_hip_L"]},
        {'Type': 'Tangent', 'Targets': ["arc_waist_L", "horn_TL"]},
        {'Type': 'Tangent', 'Targets': ["horn_TR", "arc_waist_R"]},
        {'Type': 'Tangent', 'Targets': ["arc_waist_R", "arc_hip_R"]},
        {'Type': 'Tangent', 'Targets': ["arc_hip_R", "horn_BR"]},
    ]
    seq += [
        {'Type': 'Equal', 'Targets': ["arc_waist_L", "arc_waist_R"]},
        {'Type': 'Equal', 'Targets': ["arc_hip_L", "arc_hip_R"]},
    ]
    return {
        'Name': 'ArcChain',
        'PhaseID': 'p02_05_chain',
        'BuildSequence': seq,
    }
