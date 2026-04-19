def get_block(ui_data=None):
    """
    Step 5a: Silhouette Lines.
    Places the straight horn and boundary segments for the silhouette.
    """
    seq = [
        # 1. Bounding Box Rails
        {'ID': 'top_edge',    'Type': 'Line', 'Points': [['-widthIn * 0.294934', 'heightIn * 0.469711'], ['widthIn * 0.294934', 'heightIn * 0.469711']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['-widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical Horns
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn * 0.294934', 'heightIn * 0.469711'], ['widthIn * 0.294934', 'heightIn * 0.266667']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['widthIn * 0.464286', 'heightIn * 0.127919']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn * 0.294934', 'heightIn * 0.469711'], ['-widthIn * 0.294934', 'heightIn * 0.272222']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['-widthIn * 0.464286', 'heightIn * 0.136048']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical',   'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. CORNER TOPOLOGY (Anchor top edge to the top offset projection and then connect horns)
        {'Type': 'Horizontal', 'Targets': ['top_edge']},
        {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_BB_top']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},

        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

    ]

    return {
        'Name': 'Silhouette Lines',
        'PhaseID': 'p02_03_lines',
        'BuildSequence': seq
    }
