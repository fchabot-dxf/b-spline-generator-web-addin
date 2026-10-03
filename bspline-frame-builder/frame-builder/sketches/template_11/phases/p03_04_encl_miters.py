def get_block(ui_data=None):
    """
    Enclosure Miters (Template 11 - Diamond-top, 3-arc Hourglass): 5 miters, one per corner, each from
    the outer corner to its resolved inner corner (p03_03). The shoulder/waist/hip tangent chain is NOT
    here - those joins are smooth (Tangent, p02_04_tangency.py), not miters, per the approved spec
    (fb_engine/t11_geometry.py's own module docstring).

    Naming convention: "start of next curve" applied to the silhouette loop traversed clockwise from
    the peak (p03_01_encl_projs.py's own doc comment).
      peak    -> roof_R:S           (roof_R starts at the peak going down-right)
      eave_R  -> eave_straight_R:S  (eave_straight_R starts at the right eave tip)
      base_R  -> bottom_edge:S      (bottom_edge starts at the base-right corner)
      base_L  -> side_straight_L:S  (side_straight_L starts at the base-left corner)
      eave_L  -> roof_L:S           (roof_L starts at the left eave tip)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_roof_R:S',          'Target': 'inner_proj_roof_R:S',          'IsConstruction': False},
            {'Source': 'proj_eave_straight_R:S', 'Target': 'inner_proj_eave_straight_R:S', 'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S',      'Target': 'inner_proj_bottom_edge:S',      'IsConstruction': False},
            {'Source': 'proj_side_straight_L:S',  'Target': 'inner_proj_side_straight_L:S',  'IsConstruction': False},
            {'Source': 'proj_roof_L:S',           'Target': 'inner_proj_roof_L:S',           'IsConstruction': False},
        ]
    }
