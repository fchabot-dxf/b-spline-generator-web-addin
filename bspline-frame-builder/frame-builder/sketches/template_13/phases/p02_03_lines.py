def get_block(ui_data=None):
    """
    Step 5a: Silhouette Lines (Template 13 - Narrow Neck - Tapered sides).

    Same ids, order and topology as Template 2's own p02_03_lines; only the TOP differs: the top horns lean by
    taperAngle degrees from vertical instead of running straight up (F30 item 3, Fred's own taper copies), so the
    top edge is narrower still and the neck arc's own horn-facing end moves to the new tangent point. The neck
    arc's CENTRE and the body below it are untouched (editor-shape-lattice-generator.js's own `_taperedCorner`,
    Branch A: the default 8 deg taper never needs to inset the neck circle for Narrow Neck -- MEASURED, see its
    own doc comment: unlike Template 12's shoulder, this one never needs the inset branch across the whole
    declared +/-15 deg range). horn_BR/horn_BL (and bottom_edge) are exactly Template 2's own mechanism (Vertical,
    corner-pinned); horn_TR/horn_TL drop out of the Vertical targets (a slanted line has no such constraint) --
    top_edge already rode on the safe-zone top line via Horizontal + Coincident(top_edge:S, proj_off_BB_top)
    before this change (Narrow Neck's own top was already narrower than the board), so that part is unchanged.

    Seeds: the 7x9 board's own safe zone (6.5x8.5) solve of the app's provisional Template 13 shape at its own
    default taperAngle (8 deg) -- paramsFromShapeModel('bottle', Template 2's shapeModel, the safe zone) through
    bottleConstruction, each absolute value expressed as a fraction of the RAW board size (fb_engine/seed_basis.py's
    own "seed board" convention, Template 12's own p02_03_loop doc comment has the worked example). The body
    (horn_BR/BL, bottom_edge) is the SAME 7x9 solve's own untapered values (unaffected by taper).
    """
    seq = [
        # 1. Bounding Box Rails
        {'ID': 'top_edge',    'Type': 'Line', 'Points': [['-widthIn * 0.258693', 'heightIn * 0.472222'], ['widthIn * 0.258693', 'heightIn * 0.472222']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['-widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Horns. Top: slanted (taperAngle from vertical) -- from the narrow top edge's own ends down to the
        # neck arc's new (tapered) tangent point. Bottom: Template 2's own vertical horns, unchanged (the :E end
        # is the body arc's own tangent point, the safe-zone edge widthIn * 0.464286).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn * 0.258693', 'heightIn * 0.472222'], ['widthIn * 0.287974', 'heightIn * 0.31018']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['widthIn * 0.464286', 'heightIn * 0.170368']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn * 0.258693', 'heightIn * 0.472222'], ['-widthIn * 0.287974', 'heightIn * 0.31018']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn * 0.464286', '(-heightIn * 0.472222) + 0.001'], ['-widthIn * 0.464286', 'heightIn * 0.170368']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical',   'Targets': ['horn_BR', 'horn_BL']},

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
