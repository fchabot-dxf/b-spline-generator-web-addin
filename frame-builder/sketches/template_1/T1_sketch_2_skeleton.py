def get_sketch():
    return {
        'Name': '2_skeleton',
        'Geometry': [
            # Shoulder skeleton lines (unique endpoint IDs)
            {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'Points': [[0, 'heightIn/5'], ['widthIn/3', 'heightIn/5']], 'IsConstruction': True, 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
            {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'Points': [[0, 'heightIn/5'], ['-widthIn/3', 'heightIn/5']], 'IsConstruction': True, 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
            # Waist skeleton lines (unique endpoint IDs)
            {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'Points': [[0, 0], ['widthIn/2.2', 0]], 'IsConstruction': True, 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
            {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'Points': [[0, 0], ['-widthIn/2.2', 0]], 'IsConstruction': True, 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
            # Hip skeleton lines (unique endpoint IDs)
            {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'Points': [[0, '-heightIn/5'], ['widthIn/3', '-heightIn/5']], 'IsConstruction': True, 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
            {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'Points': [[0, '-heightIn/5'], ['-widthIn/3', '-heightIn/5']], 'IsConstruction': True, 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},
            # Unique shared vertices (even if coincident)
            {'ID': 'vertex_shoulder_R', 'Type': 'Point', 'Coords': [0, 'heightIn/5']},
            {'ID': 'vertex_shoulder_L', 'Type': 'Point', 'Coords': [0, 'heightIn/5']},
            {'ID': 'vertex_waist_R', 'Type': 'Point', 'Coords': [0, 0]},
            {'ID': 'vertex_waist_L', 'Type': 'Point', 'Coords': [0, 0]},
            {'ID': 'vertex_hip_R', 'Type': 'Point', 'Coords': [0, '-heightIn/5']},
            {'ID': 'vertex_hip_L', 'Type': 'Point', 'Coords': [0, '-heightIn/5']}
        ],
        'Constraints': [
            # All lines horizontal
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},
            # Coincident at Y axis for all left/right pairs
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_L:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_L:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_L:S', 'Y_AXIS']},
            # Coincident at shared endpoints
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'skel_waist_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S', 'skel_hip_pin_L:S']},
            # Waist skeleton pair: shared endpoint coincident to origin
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN']},
            # Equal constraints for each pair
            {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_waist_pin_R', 'skel_waist_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_hip_pin_R', 'skel_hip_pin_L']}
        ],
        'Dimensions': [
            # Waist: dimension one line to widthIn/2.2
            {'Target': 'skel_waist_pin_R', 'Expression': 'widthIn/2.2', 'Type': 'Distance'},
            # Shoulder: dimension one line to widthIn/3
            {'Target': 'skel_shoulder_pin_R', 'Expression': 'widthIn/3', 'Type': 'Distance'},
            # Hip: dimension one line to widthIn/3
            {'Target': 'skel_hip_pin_R', 'Expression': 'widthIn/3', 'Type': 'Distance'},
            # Vertical: waist to shoulder (Y)
            {'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_shoulder_pin_R:S', 'Expression': '-heightIn/5', 'Orientation': 'Vertical'},
            # Vertical: waist to hip (Y)
            {'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_hip_pin_R:S', 'Expression': '-heightIn/5', 'Orientation': 'Vertical'},
            # Vertical: shoulder to hip (Y)
            {'Type': 'VerticalDistance', 'Source': 'skel_shoulder_pin_R:S', 'Target': 'skel_hip_pin_R:S', 'Expression': '-2*heightIn/5', 'Orientation': 'Vertical'}
        ]
    }
