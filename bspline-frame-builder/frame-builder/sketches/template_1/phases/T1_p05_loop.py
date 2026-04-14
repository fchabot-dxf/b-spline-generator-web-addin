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
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.274', 'heightIn * 0.093'], ['heightIn * 0.338', 'heightIn * 0.119'], ['heightIn * 0.364', 'heightIn * 0.183']], 
         'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/11', 'Name': 'seed_rad_shoulder_R'},

        {'ID': 'arc_waist_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.266', 'heightIn * 0.092'], ['heightIn * 0.175', '0'], ['heightIn * 0.266', '-heightIn * 0.090']], 
         'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'heightIn/11', 'Name': 'seed_rad_waist_R'},

        {'ID': 'arc_hip_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.274', '-heightIn * 0.093'], ['heightIn * 0.338', '-heightIn * 0.119'], ['heightIn * 0.364', '-heightIn * 0.183']], 
         'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'heightIn/11', 'Name': 'seed_rad_hip_R'},

        # LEFT side — flows bottom to top
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.364', '-heightIn * 0.183'], ['-heightIn * 0.338', '-heightIn * 0.119'], ['-heightIn * 0.274', '-heightIn * 0.093']], 
         'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'heightIn/11', 'Name': 'seed_rad_hip_L'},

        {'ID': 'arc_waist_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.266', '-heightIn * 0.090'], ['-heightIn * 0.175', '0'], ['-heightIn * 0.266', 'heightIn * 0.092']], 
         'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L',    'Expression': 'heightIn/11', 'Name': 'seed_rad_waist_L'},

        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.364', 'heightIn * 0.183'], ['-heightIn * 0.338', 'heightIn * 0.119'], ['-heightIn * 0.274', 'heightIn * 0.093']], 
         'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/11', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p05_loop',
        'BuildSequence': seq
    }
