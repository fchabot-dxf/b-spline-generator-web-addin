def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 9 - I Shape): 12 corners.

    Same resolver as every template (fb_engine/inner_corners.py): each
    inner corner is the outer corner pulled in by frame_thickness along an
    axis-aligned (dx, dy), then the nearest SketchPoint is tagged. The
    outline is all axis-aligned lines, so the rule holds at the 4 INSIDE
    (reflex) corners too, exactly as Template 6's own single notch -- here
    there are 4 of them (one per flange/stem transition), each sharing its
    own notch's direction with its convex twin (MEASURED by solid/void: at
    the top-right notch, moving in from EITHER the flange's own outer corner
    or the stem's own inner corner lands on solid material only by going
    left AND up, direction (-1, 1); each of the other 3 notches mirrors
    this the same way Template 6's two corners do).

    Must match template_data.FRAME_CORNERS (test_frame_defs.py checks it).
    """
    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'TL':             {'OuterID': 'proj_top_edge:S',       'InnerID': 'inner_proj_top_edge:S',       'Direction': ( 1, -1)},
                    'TR':             {'OuterID': 'proj_flange_side_R:S',  'InnerID': 'inner_proj_flange_side_R:S',  'Direction': (-1, -1)},
                    'notch_TR_outer': {'OuterID': 'proj_shoulder_TR:S',    'InnerID': 'inner_proj_shoulder_TR:S',    'Direction': (-1,  1)},
                    'notch_TR_inner': {'OuterID': 'proj_stem_side_R:S',    'InnerID': 'inner_proj_stem_side_R:S',    'Direction': (-1,  1)},
                    'notch_BR_inner': {'OuterID': 'proj_shoulder_BR:S',    'InnerID': 'inner_proj_shoulder_BR:S',    'Direction': (-1, -1)},
                    'notch_BR_outer': {'OuterID': 'proj_flange_side_BR:S', 'InnerID': 'inner_proj_flange_side_BR:S', 'Direction': (-1, -1)},
                    'BR':             {'OuterID': 'proj_bottom_edge:S',    'InnerID': 'inner_proj_bottom_edge:S',    'Direction': (-1,  1)},
                    'BL':             {'OuterID': 'proj_flange_side_BL:S', 'InnerID': 'inner_proj_flange_side_BL:S', 'Direction': ( 1,  1)},
                    'notch_BL_outer': {'OuterID': 'proj_shoulder_BL:S',    'InnerID': 'inner_proj_shoulder_BL:S',    'Direction': ( 1, -1)},
                    'notch_BL_inner': {'OuterID': 'proj_stem_side_L:S',    'InnerID': 'inner_proj_stem_side_L:S',    'Direction': ( 1, -1)},
                    'notch_TL_inner': {'OuterID': 'proj_shoulder_TL:S',    'InnerID': 'inner_proj_shoulder_TL:S',    'Direction': ( 1,  1)},
                    'notch_TL_outer': {'OuterID': 'proj_flange_side_TL:S', 'InnerID': 'inner_proj_flange_side_TL:S', 'Direction': ( 1,  1)},
                },
            }
        ]
    }
