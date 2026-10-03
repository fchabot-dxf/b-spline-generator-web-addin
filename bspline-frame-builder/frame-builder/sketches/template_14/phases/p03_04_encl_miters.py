def get_block(ui_data=None):
    """
    Enclosure Miters (Template 14 - Sand Timer): 6 miters, one per corner, each from the outer
    corner to its resolved inner corner (p03_03). Every joint in this template is a miter -- there
    is no tangent chain at all (fb_engine/t14_sandtimer_geometry.py's own module docstring).

    Naming convention: each corner's outer id is whichever of its two meeting pieces' own `:S`/`:E`
    physically lands there (p02_02_loop.py's own docstring table); this phase always picks the SAME
    owner piece p03_03's own InnerID choice did, so the two can never drift apart.
      topR   -> upper_R:E   (upper_R's own physical topR end is its :E -- swapped, see p02_02)
      pinchR -> upper_R:S   (upper_R's own physical pinchR end is its :S -- swapped, see p02_02)
      BR     -> lower_R:S   (lower_R's own physical BR end is its :S -- swapped, see p02_02)
      BL     -> lower_L:E   (lower_L's own physical BL end is its :E -- swapped, see p02_02)
      pinchL -> upper_L:E   (upper_L's own physical pinchL end is its :E -- swapped, see p02_02)
      topL   -> upper_L:S   (upper_L's own physical topL end is its :S -- swapped, see p02_02)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_upper_R:E',  'Target': 'inner_proj_upper_R:E',  'IsConstruction': False},
            {'Source': 'proj_upper_R:S',  'Target': 'inner_proj_upper_R:S',  'IsConstruction': False},
            {'Source': 'proj_lower_R:S',  'Target': 'inner_proj_lower_R:S',  'IsConstruction': False},
            {'Source': 'proj_lower_L:E',  'Target': 'inner_proj_lower_L:E',  'IsConstruction': False},
            {'Source': 'proj_upper_L:E',  'Target': 'inner_proj_upper_L:E',  'IsConstruction': False},
            {'Source': 'proj_upper_L:S',  'Target': 'inner_proj_upper_L:S',  'IsConstruction': False},
        ]
    }
