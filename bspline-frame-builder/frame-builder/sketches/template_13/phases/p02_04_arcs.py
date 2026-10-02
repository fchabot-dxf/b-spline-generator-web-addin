def get_block(ui_data=None):
    """
    Arc seeds (Template 13 - Narrow Neck - Tapered sides), [Start, on-arc midpoint, End] -- Fusion's Arc3Point
    takes three points ON the arc. Same ids/topology as Template 2's own p02_04_arcs (arc_waist_R/L = the neck,
    concave; arc_hip_R/L = the body, convex): per p02_05_chain, arc_waist_R:S = horn_TR:E (horn end, TAPERED),
    arc_waist_R:E = arc_hip_R:E (the neck/body junction, untouched by taper); arc_waist_L is the mirror with S/E
    swapped (arc_waist_L:E = horn_TL:E). See p02_03_lines' own doc comment for where these numbers come from.
    """
    seq = [
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C', 'Points': [['-widthIn * 0.376624', 'heightIn * 0.244761'], ['-widthIn * 0.31761', 'heightIn * 0.265429'], ['-widthIn * 0.287974', 'heightIn * 0.31018']]},
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C', 'Points': [['-widthIn * 0.376624', 'heightIn * 0.244761'], ['-widthIn * 0.439055', 'heightIn * 0.220824'], ['-widthIn * 0.464286', 'heightIn * 0.170368']]},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C', 'Points': [['widthIn * 0.287974', 'heightIn * 0.31018'], ['widthIn * 0.31761', 'heightIn * 0.265429'], ['widthIn * 0.376624', 'heightIn * 0.244761']]},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C', 'Points': [['widthIn * 0.464286', 'heightIn * 0.170368'], ['widthIn * 0.439055', 'heightIn * 0.220824'], ['widthIn * 0.376624', 'heightIn * 0.244761']]},
    ]
    return {
        'Name': 'p06',
        'PhaseID': 'p02_04_arcs',
        'BuildSequence': seq,
    }
