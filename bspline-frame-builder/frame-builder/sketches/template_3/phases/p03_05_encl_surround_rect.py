def get_block(ui_data=None):
    """
    Phase 19: Enclosure Surround Rectangle.
    Adds the surround rectangle in Sketch 3 using the same variable-based logic as Template 2,
    with a small center offset to avoid origin-snapping problems before grounding the center.
    """
    return {
        "PhaseID": "p03_05_encl_surround_rect",
        "Name": "Enclosure Surround Rectangle",
        "BuildSequence": [
            {
                "Type": "RectangleCenter",
                "ID": "surround_rect",
                "Center": ['0.001', '0.001'],
                "Size": ['widthIn * 1.25', 'heightIn * 1.25'],
                "LineIDs": ['surround_top', 'surround_right', 'surround_bottom', 'surround_left']
            },
            {
                "Type": "Coincident",
                "Targets": ['surround_rect:C', 'ORIGIN'],
                "AllowNudge": True
            }
        ]
    }
