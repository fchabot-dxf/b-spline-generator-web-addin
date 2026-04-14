def get_block(ui_data=None):
    """
    Step 5: Silhouette Loop.
    Geometric seeds for the 12-segment clockwise frame.
    """
    outer_x = "widthIn/2 - boundingboxoffset"
    top_y   = "heightIn/2 - boundingboxoffset"
    bot_y   = "-(heightIn/2 - boundingboxoffset)"

    seq = [
        # 1. Bounding Box Rails (Seeded 0.001 off-target)
        {'ID': 'top_edge',    'Type': 'Line', 'Points': [[f'-({outer_x}) + 0.001', f'({top_y}) - 0.001'], [f'({outer_x}) - 0.001', f'({top_y}) - 0.001']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[f'({outer_x}) - 0.001', f'({bot_y}) + 0.001'], [f'-({outer_x}) + 0.001', f'({bot_y}) + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical Horns (Seeded 0.001 off-target)
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [[f'({outer_x}) - 0.001', f'({top_y}) - 0.001'],  [outer_x, 'heightIn * 0.183']],  'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [[f'({outer_x}) - 0.001', f'({bot_y}) + 0.001'],  [outer_x, '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [[f'-({outer_x}) + 0.001', f'({top_y}) - 0.001'], [f'-({outer_x})', 'heightIn * 0.183']],  'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [[f'-({outer_x}) + 0.001', f'({bot_y}) + 0.001'], [f'-({outer_x})', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},
        
        {'Type': 'Vertical',   'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. CORNER TOPOLOGY (Anchor edges to Ground, then Horns to Edges)
        {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_corner_TL']},

        {'Type': 'Coincident', 'Targets': ['top_edge:E',    'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},

        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

        # 4. ARC SEEDS
        # RIGHT side — flows top to bottom
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point',
         'Points': [['widthIn * 0.297525', '-heightIn * 0.00656168'], ['heightIn * 0.175', '0'], ['widthIn * 0.38582677', '-heightIn * 0.08836395']], 
         'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C', 'Bulge': ['heightIn * 0.175', '0']},
        {'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'heightIn/11', 'Name': 'seed_rad_waist_R'},

        {'ID': 'arc_hip_R', 'Type': 'Arc3Point',
         'Points': [['widthIn * 0.99285714', '-heightIn * 0.08444444'], ['widthIn * 0.88285714', '-heightIn * 0.29888889'], ['widthIn * 1.18', '-heightIn * 0.29888889']], 
         'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C', 'Bulge': ['widthIn * 0.88285714', '-heightIn * 0.29888889']},
        {'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'heightIn/11', 'Name': 'seed_rad_hip_R'},

        # LEFT side — flows bottom to top
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point',
         'Points': [['-widthIn * 0.99285714', '-heightIn * 0.08444444'], ['-widthIn * 0.88285714', '-heightIn * 0.29888889'], ['-widthIn * 1.18', '-heightIn * 0.29888889']], 
         'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C', 'Bulge': ['-widthIn * 0.88285714', '-heightIn * 0.29888889']},
        {'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'heightIn/11', 'Name': 'seed_rad_hip_L'},

        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point',
         'Points': [['widthIn * 0.99285714', '-heightIn * 0.08444444'], ['widthIn * 1.16', 'heightIn * 0.10555556'], ['widthIn * 0.86428571', 'heightIn * 0.10555556']], 
         'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E', 'CenterID': 'arc_shoulder_R:C', 'Bulge': ['widthIn * 1.16', 'heightIn * 0.10555556']},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R',    'Expression': 'heightIn/11', 'Name': 'seed_rad_shoulder_R'},

        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point',
         'Points': [['-widthIn * 0.99285714', '-heightIn * 0.08444444'], ['-widthIn * 1.16', 'heightIn * 0.10555556'], ['-widthIn * 0.86428571', 'heightIn * 0.10555556']], 
         'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E', 'CenterID': 'arc_shoulder_L:C', 'Bulge': ['-widthIn * 1.16', 'heightIn * 0.10555556']},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L',    'Expression': 'heightIn/11', 'Name': 'seed_rad_shoulder_L'},

    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p05_loop',
        'BuildSequence': seq
    }
