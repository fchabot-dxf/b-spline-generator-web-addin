def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections.
    Projects the silhouette curves into the enclosure sketch.

    Identical to Template 1's own: `top_edge` is still the canonical name for the top piece (now solved as an
    arc, not a line, in sketch 2 -- this phase only projects it, the piece type doesn't matter here). The
    enclosure sketch never needs its own `proj_off_BB_top` (p02_01's own addition): the Offset step below
    offsets whatever `top_edge` SOLVED to, arc or line, the same way either way.
      TL → proj_top_edge:S    (top_edge starts at TL going right)
      TR → proj_horn_TR:S     (horn_TR starts at TR going down)
      BR → proj_bottom_edge:S (bottom_edge starts at BR going left)
      BL → proj_horn_BL:S     (horn_BL starts at BL going up)
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge',           'TargetID': 'proj_top_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TR',            'TargetID': 'proj_horn_TR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_R',     'TargetID': 'proj_arc_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_R',        'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_R',          'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BR',            'TargetID': 'proj_horn_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',        'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BL',            'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',          'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',        'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_L',     'TargetID': 'proj_arc_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TL',            'TargetID': 'proj_horn_TL'},
        ]
    }
