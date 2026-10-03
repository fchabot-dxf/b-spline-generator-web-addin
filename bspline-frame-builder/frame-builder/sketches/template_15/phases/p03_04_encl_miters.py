def get_block(ui_data=None):
    """
    Enclosure Miters (Template 15 - Flask): 6 miters, one per corner, each from the outer corner to
    its resolved inner corner (p03_03). Every joint in this template is a miter -- there is no
    tangent chain at all (fb_engine/t15_flask_geometry.py's own module docstring).

    Naming convention: each corner's outer id is whichever of its two meeting pieces' own `:S`/`:E`
    physically lands there (p02_02_loop.py's own docstring table); this phase always picks the SAME
    owner piece p03_03's own InnerID choice did, so the two can never drift apart.
      topR         -> neck_R:S   (neck_R's own physical topR end is its :S, unswapped)
      neckBottomR  -> dome_R:E   (dome_R's own physical neckBottomR end is its :E -- swapped)
      BR           -> dome_R:S   (dome_R's own physical BR end is its :S -- swapped)
      BL           -> dome_L:E   (dome_L's own physical BL end is its :E -- swapped)
      neckBottomL  -> dome_L:S   (dome_L's own physical neckBottomL end is its :S -- swapped)
      topL         -> neck_L:E   (neck_L's own physical topL end is its :E, unswapped)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_neck_R:S', 'Target': 'inner_proj_neck_R:S', 'IsConstruction': False},
            {'Source': 'proj_dome_R:E', 'Target': 'inner_proj_dome_R:E', 'IsConstruction': False},
            {'Source': 'proj_dome_R:S', 'Target': 'inner_proj_dome_R:S', 'IsConstruction': False},
            {'Source': 'proj_dome_L:E', 'Target': 'inner_proj_dome_L:E', 'IsConstruction': False},
            {'Source': 'proj_dome_L:S', 'Target': 'inner_proj_dome_L:S', 'IsConstruction': False},
            {'Source': 'proj_neck_L:E', 'Target': 'inner_proj_neck_L:E', 'IsConstruction': False},
        ]
    }
