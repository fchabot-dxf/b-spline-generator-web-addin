def get_sketch():
    """
    Logic for Sketch 1: Bounding Box.
    Defines the outer limits and creates the inner boundary via Offset.
    Utilizes a center-point rectangle anchored to the origin.
    """
    return {
        "Name": "1_bounding-box",
        "Geometry": [
            {
                "ID": "BB_RECT",
                "Type": "Rectangle",
                "Center": [0, 0],
                "Size": ["widthIn", "heightIn"],
                "LineIDs": ["BB_top", "BB_right", "BB_bottom", "BB_left"]
            }
        ],
        "Constraints": [
            {"Type": "Horizontal", "Targets": ["BB_top"]},
            {"Type": "Horizontal", "Targets": ["BB_bottom"]},
            {"Type": "Vertical",   "Targets": ["BB_left"]},
            {"Type": "Vertical",   "Targets": ["BB_right"]},
            # Center Point is mapped to ORIGIN inside the engine's Rectangle logic
            {"Type": "Coincident", "Targets": ["BB_RECT:C", "ORIGIN"]}
        ],
        "Dimensions": [
            {"Target": "BB_top",   "Expression": "widthIn",  "Name": "dim_width"},
            {"Target": "BB_right",  "Expression": "heightIn", "Name": "dim_height"}
        ],
        "Steps": [
            {
                "Type": "Offset",
                "SourceID": ["BB_top", "BB_right", "BB_bottom", "BB_left"],
                "DistanceExpr": "boundingboxoffset",
                "TargetIDs": ["offset_BB_top", "offset_BB_right", "offset_BB_bottom", "offset_BB_left"],
                "CornerIDs": {
                    "TL": "BB_corner_TL",
                    "TR": "BB_corner_TR",
                    "BL": "BB_corner_BL",
                    "BR": "BB_corner_BR"
                }
            }
        ]
    }
