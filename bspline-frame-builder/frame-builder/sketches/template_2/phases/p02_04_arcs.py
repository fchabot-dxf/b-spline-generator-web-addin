def get_block(ui_data=None):
    """Auto-generated phase block."""
    seq = [
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C', 'Points': [['widthIn * -0.378', 'heightIn * 0.2029'], ['widthIn * -0.3211', 'heightIn * 0.2212'], ['widthIn * -0.2976', 'heightIn * 0.2654']]},
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C', 'Points': [['widthIn * -0.3833', 'heightIn * 0.2025'], ['widthIn * -0.4401', 'heightIn * 0.1842'], ['widthIn * -0.4636', 'heightIn * 0.14']]},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C', 'Points': [['widthIn * 0.2976', 'heightIn * 0.2612'], ['widthIn * 0.3212', 'heightIn * 0.217'], ['widthIn * 0.378', 'heightIn * 0.1987']]},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C', 'Points': [['widthIn * 0.4652', 'heightIn * 0.1352'], ['widthIn * 0.4417', 'heightIn * 0.1794'], ['widthIn * 0.3849', 'heightIn * 0.1977']]},
    ]
    return {
        'Name': 'p06',
        'PhaseID': 'p02_04_arcs',
        'BuildSequence': seq,
    }