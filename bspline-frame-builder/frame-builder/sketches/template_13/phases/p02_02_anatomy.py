def get_block(ui_data=None):
    """
    Anatomy (Template 13 - Narrow Neck - Tapered sides). Same 4 pins, ids and constraints as Template 2's own
    p02_02_anatomy; only the literal seed values differ, recomputed together with p02_03_lines/p02_04_arcs's own
    seeds (F30 item 3: the neck circle's own centre is untouched by the default 8 deg taper, Branch A -- see
    editor-shape-lattice-generator.js's own `_taperedCorner` doc comment -- so these pins are a plain Template 2
    solve at this board, same discipline as Template 12's own p02_02_anatomy).

    Seeds: the 7x9 board's own safe zone (6.5x8.5) solve of the app's provisional Template 13 shape --
    paramsFromShapeModel('bottle', Template 2's shapeModel, the safe zone) through bottleConstruction, each
    absolute value expressed as a fraction of the RAW board size (fb_engine/seed_basis.py's own "seed board"
    convention, Template 3/12's own p02_02_anatomy doc comments have the worked example):
      neck pin (p02_SketchLine/_02) outer = +/-widthIn * 0.385159, Y = heightIn * 0.320803
      body pin (p02_SketchLine_03/_04) outer = +/-widthIn * 0.368274, Y = heightIn * 0.170368
    """
    seq = [
        {'ID': 'p02_SketchLine', 'Type': 'Line', 'Points': [['widthIn * 0.385159', 'heightIn * 0.320803'], ['widthIn * 0.0029', 'heightIn * 0.320803']], 'StartID': 'p02_SketchLine:S', 'EndID': 'p02_SketchLine:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_02', 'Type': 'Line', 'Points': [['widthIn * -0.0029', 'heightIn * 0.320803'], ['widthIn * -0.385159', 'heightIn * 0.320803']], 'StartID': 'p02_SketchLine_02:S', 'EndID': 'p02_SketchLine_02:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_03', 'Type': 'Line', 'Points': [['widthIn * -0.004', 'heightIn * 0.170368'], ['widthIn * -0.368274', 'heightIn * 0.170368']], 'StartID': 'p02_SketchLine_03:S', 'EndID': 'p02_SketchLine_03:E', 'IsConstruction': True},
        {'ID': 'p02_SketchLine_04', 'Type': 'Line', 'Points': [['widthIn * 0.368274', 'heightIn * 0.170368'], ['widthIn * 0.0034', 'heightIn * 0.170368']], 'StartID': 'p02_SketchLine_04:S', 'EndID': 'p02_SketchLine_04:E', 'IsConstruction': True},
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
