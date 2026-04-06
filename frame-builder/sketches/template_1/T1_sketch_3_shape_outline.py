def get_sketch(geometry):
    # Split geometry into three groups
    # Only include outline geometry, not skeleton lines
    outline_ids = {
        'G_05', 'G_10', 'horn_RU', 'horn_RL', 'horn_LL', 'horn_LU',
        'arc_shoulder_R', 'arc_shoulder_L', 'arc_hip_R', 'arc_hip_L',
        'arc_waist_R', 'arc_waist_L'
    }
    # Add StartID/EndID to all lines in outline_geometry for semantic endpoint naming
    outline_geometry = []
    for g in geometry:
        if g['ID'] in outline_ids:
            if g['Type'] == 'Line':
                g = dict(g)  # shallow copy
                g['StartID'] = f"{g['ID']}:S"
                g['EndID'] = f"{g['ID']}:E"
            outline_geometry.append(g)
    outer_arc_ids = {'arc_shoulder_R', 'arc_shoulder_L', 'arc_hip_R', 'arc_hip_L'}
    outer_arcs = [g for g in outline_geometry if g['ID'] in outer_arc_ids]
    waist_arcs = [g for g in outline_geometry if g['ID'] in ('arc_waist_R', 'arc_waist_L')]

    return {
        'Name': '3_shape-outline',
        'BoundingBoxProjections': [
            {"SourceSketch": "1_bounding-box", "SourceID": "off_corner_TL", "TargetID": "proj_TL"},
            {"SourceSketch": "1_bounding-box", "SourceID": "off_corner_TR", "TargetID": "proj_TR"},
            {"SourceSketch": "1_bounding-box", "SourceID": "off_corner_BL", "TargetID": "proj_BL"},
            {"SourceSketch": "1_bounding-box", "SourceID": "off_corner_BR", "TargetID": "proj_BR"}
        ],
        'SkeletonProjections': [
            {"SourceSketch": "2_skeleton", "SourceID": "skel_shoulder_pin_R:E", "TargetID": "skel_shoulder_pin_R_E"},
            {"SourceSketch": "2_skeleton", "SourceID": "skel_shoulder_pin_L:E", "TargetID": "skel_shoulder_pin_L_E"},
            {"SourceSketch": "2_skeleton", "SourceID": "skel_waist_pin_R:E", "TargetID": "skel_waist_pin_R_E"},
            {"SourceSketch": "2_skeleton", "SourceID": "skel_waist_pin_L:E", "TargetID": "skel_waist_pin_L_E"},
            {"SourceSketch": "2_skeleton", "SourceID": "skel_hip_pin_R:E", "TargetID": "skel_hip_pin_R_E"},
            {"SourceSketch": "2_skeleton", "SourceID": "skel_hip_pin_L:E", "TargetID": "skel_hip_pin_L_E"}
        ],
        'PreGeometry': [g for g in outline_geometry if g['Type'] != 'Arc3Point'],
        'PreConstraints': [
            # Manifold lines and horn constraints only (no skeleton)
            {'Type': 'Coincident', 'Targets': ['G_05:S', 'proj_TL']},
            {'Type': 'Coincident', 'Targets': ['G_05:E', 'proj_TR']},
            {'Type': 'Coincident', 'Targets': ['G_10:S', 'proj_BR']},
            {'Type': 'Coincident', 'Targets': ['G_10:E', 'proj_BL']},
            {'Type': 'Coincident', 'Targets': ['G_05:E', 'horn_RU:S']},
            {'Type': 'Coincident', 'Targets': ['horn_RL:E', 'G_10:S']},
            {'Type': 'Coincident', 'Targets': ['G_10:E', 'horn_LL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_LU:E', 'G_05:S']},
            {'Type': 'Coincident', 'Targets': ['horn_RU:S', 'proj_TR']},
            {'Type': 'Coincident', 'Targets': ['horn_RL:E', 'proj_BR']},
            {'Type': 'Coincident', 'Targets': ['horn_LL:S', 'proj_BL']},
            {'Type': 'Coincident', 'Targets': ['horn_LU:E', 'proj_TL']},
            {'Type': 'Vertical', 'Targets': ['horn_RU']},
            {'Type': 'Vertical', 'Targets': ['horn_RL']},
            {'Type': 'Vertical', 'Targets': ['horn_LL']},
            {'Type': 'Vertical', 'Targets': ['horn_LU']},
        ],
        'PreDimensions': [],
        'Geometry': outer_arcs,
        'Constraints': [
            {'Type': 'Coincident', 'Targets': ['horn_RU:E', 'arc_shoulder_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:E', 'horn_RL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_LL:E', 'arc_hip_L:S']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'horn_LU:S']},
            {'Type': 'Tangent', 'Targets': ['horn_RU', 'arc_shoulder_R']},
            {'Type': 'Tangent', 'Targets': ['arc_hip_R', 'horn_RL']},
            {'Type': 'Tangent', 'Targets': ['horn_LL', 'arc_hip_L']},
            {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'horn_LU']},
        ],
        'PostGeometry': waist_arcs,
        'PostConstraints': [
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:E', 'arc_hip_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:E', 'arc_waist_L:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:S']},
            {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'arc_waist_R']},
            {'Type': 'Tangent', 'Targets': ['arc_waist_R', 'arc_hip_R']},
            {'Type': 'Tangent', 'Targets': ['arc_hip_L', 'arc_waist_L']},
            {'Type': 'Tangent', 'Targets': ['arc_waist_L', 'arc_shoulder_L']},
        ],
        'Dimensions': []
    }
