def get_sketch():
    # If any lines are added, ensure they have StartID/EndID for semantic endpoint naming
    return {
        'Name': '4_frame',
        'Geometry': [
            # Example:
            # {'ID': 'frame_line_1', 'Type': 'Line', 'Points': [[0,0],[1,0]], 'StartID': 'frame_line_1:S', 'EndID': 'frame_line_1:E'}
        ],
        'Constraints': [],
        'Offsets': [],
        'Dimensions': []
    }
