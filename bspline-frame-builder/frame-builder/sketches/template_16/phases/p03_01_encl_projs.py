def get_block(ui_data=None):
    """
    Enclosure Projections (Template 16 - Arched Funnel).
    Projects the 6-piece silhouette into the enclosure sketch, clockwise from the top-right corner
    (matches template_data.py's FRAME_SEED_MAP `prim` order):
      upper_R, lower_R, base, lower_L, upper_L, arch.
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'upper_R', 'TargetID': 'proj_upper_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'lower_R', 'TargetID': 'proj_lower_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'base',    'TargetID': 'proj_base'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'lower_L', 'TargetID': 'proj_lower_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'upper_L', 'TargetID': 'proj_upper_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arch',    'TargetID': 'proj_arch'},
        ]
    }
