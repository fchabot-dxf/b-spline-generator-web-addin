def get_block(ui_data=None):
    """
    Phase 0a: Bounding Box Layout.
    Defines the outer model limits and anchors the center point to the origin.
    """
    return {
        "Name": "BB Layout",
        "PhaseID": "p01_01_bb_layout",
        "Geometry": [
            {
                "ID": "BB_RECT",
                "Type": "Rectangle",
                "Center": [0.0, 0.0],
                "Size": ["widthIn", "heightIn"],
                "LineIDs": ["BB_top", "BB_right", "BB_bottom", "BB_left"]
            }
        ],
        "Constraints": [
            {"Type": "Coincident", "Targets": ["BB_RECT:C", "ORIGIN"]}
        ],
        "Dimensions": [
            {"Target": "BB_top",   "Expression": "widthIn",  "Name": "dim_width"},
            {"Target": "BB_right", "Expression": "heightIn", "Name": "dim_height"}
        ]
    }
