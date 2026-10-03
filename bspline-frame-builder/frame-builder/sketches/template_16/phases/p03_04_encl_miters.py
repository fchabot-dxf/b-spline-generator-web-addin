def get_block(ui_data=None):
    """
    Enclosure Miters (Template 16 - Arched Funnel): 6 miters, one per corner, each from the outer
    corner to its resolved inner corner (p03_03). Every joint in this template is a miter -- there
    is no tangent chain at all (fb_engine/t16_geometry.py's own module docstring), unlike
    Template 7/11 where only the peak/eave/base corners are miters.

    Naming convention: each corner's outer id is whichever of its two meeting pieces' own `:S`/`:E`
    physically lands there (p02_02_loop.py's own docstring table); this phase always picks the ARC's
    own endpoint (never the line's), matching p03_03's own InnerID choice exactly.
      topR   -> arch:S      (arch's own physical topR end is its :S)
      waistR -> lower_R:E   (lower_R's own physical waistR end is its :E -- swapped, see p02_02)
      BR     -> lower_R:S   (lower_R's own physical BR end is its :S -- swapped, see p02_02)
      BL     -> lower_L:E   (lower_L's own physical BL end is its :E -- swapped, see p02_02)
      waistL -> lower_L:S   (lower_L's own physical waistL end is its :S -- swapped, see p02_02)
      topL   -> arch:E      (arch's own physical topL end is its :E -- swapped, see p02_02)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_arch:S',     'Target': 'inner_proj_arch:S',     'IsConstruction': False},
            {'Source': 'proj_lower_R:E',  'Target': 'inner_proj_lower_R:E',  'IsConstruction': False},
            {'Source': 'proj_lower_R:S',  'Target': 'inner_proj_lower_R:S',  'IsConstruction': False},
            {'Source': 'proj_lower_L:E',  'Target': 'inner_proj_lower_L:E',  'IsConstruction': False},
            {'Source': 'proj_lower_L:S',  'Target': 'inner_proj_lower_L:S',  'IsConstruction': False},
            {'Source': 'proj_arch:E',     'Target': 'inner_proj_arch:E',     'IsConstruction': False},
        ]
    }
