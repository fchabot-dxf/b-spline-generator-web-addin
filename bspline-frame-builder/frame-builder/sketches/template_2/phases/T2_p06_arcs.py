def get_block(ui_data=None):
    """
    Step 5b: Silhouette Arcs.
    Places the circular arc seeds for the 4-segment silhouette.
    """

    seq = [
        # 4. ARC SEEDS
        # RIGHT side — flows top to bottom
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point',
         'Points': [['widthIn * 0.297624', 'heightIn * 0.261211'], ['widthIn * 0.377981', 'heightIn * 0.261211'], ['widthIn * 0.377981', 'heightIn * 0.198711']], 
         'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C', 'Bulge': ['6.72', '5.97']},
        {'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'heightIn/16', 'Name': 'seed_rad_waist_R'},

        {'ID': 'arc_hip_R', 'Type': 'Arc3Point',
         'Points': [['widthIn * 0.465238', 'heightIn * 0.135216'], ['widthIn * 0.38488', 'heightIn * 0.135216'], ['widthIn * 0.38488', 'heightIn * 0.197716']], 
         'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C', 'Bulge': ['6.84', '3.09']},
        {'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'heightIn/16', 'Name': 'seed_rad_hip_R'},

        # LEFT side — flows bottom to top
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point',
         'Points': [['-widthIn * 0.383255', 'heightIn * 0.202523'], ['-widthIn * 0.383255', 'heightIn * 0.140023'], ['-widthIn * 0.463612', 'heightIn * 0.140023']], 
         'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C', 'Bulge': ['-6.81', '3.2']},
        {'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'heightIn/16', 'Name': 'seed_rad_hip_L'},

        {'ID': 'arc_waist_L', 'Type': 'Arc3Point',
         'Points': [['-widthIn * 0.37796', 'heightIn * 0.202858'], ['-widthIn * 0.37796', 'heightIn * 0.265358'], ['-widthIn * 0.297603', 'heightIn * 0.265358']], 
         'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C', 'Bulge': ['-6.72', '6.07']},
        {'Type': 'Radius', 'Target': 'arc_waist_L',    'Expression': 'heightIn/16', 'Name': 'seed_rad_waist_L'},
    ]

    return {
        'Name': 'Silhouette Arcs',
        'PhaseID': 'p06_arcs',
        'BuildSequence': seq
    }


