def get_block(ui_data=None):
    """Auto-generated phase block."""
    seq = [
        {'ID': 'p02_SketchLine', 'Type': 'Line', 'Points': [['widthIn * 0.3721', 'heightIn * 0.3308'], ['widthIn * 0.0029', 'heightIn * 0.3308']], 'StartID': 'p02_SketchLine:S', 'EndID': 'p02_SketchLine:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_02', 'Type': 'Line', 'Points': [['widthIn * -0.0029', 'heightIn * 0.3308'], ['widthIn * -0.3721', 'heightIn * 0.3308']], 'StartID': 'p02_SketchLine_02:S', 'EndID': 'p02_SketchLine_02:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_03', 'Type': 'Line', 'Points': [['widthIn * -0.004', 'heightIn * 0.1'], ['widthIn * -0.3823', 'heightIn * 0.1']], 'StartID': 'p02_SketchLine_03:S', 'EndID': 'p02_SketchLine_03:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_04', 'Type': 'Line', 'Points': [['widthIn * 0.3817', 'heightIn * 0.1'], ['widthIn * 0.0034', 'heightIn * 0.1']], 'StartID': 'p02_SketchLine_04:S', 'EndID': 'p02_SketchLine_04:E', 'IsConstruction': True},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine:E", "p02_SketchLine_02:S"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine_04:E", "p02_SketchLine_03:S"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine_03:S", "Y_AXIS"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine:E", "Y_AXIS"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_02"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_03"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_04"]},
    ]
    
    return {
        'Name': 'p02_02_anatomy',
        'PhaseID': 'p02_02_anatomy',
        'BuildSequence': seq,
    }