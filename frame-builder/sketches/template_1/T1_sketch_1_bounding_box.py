def get_sketch():
    """
    Logic for Sketch 1: Bounding Box.
    Defines the outer limits and creates the inner boundary via Offset.
    Utilizes a center-point rectangle anchored to the origin via diagonals.
    """
    return {
        "Name": "1_bounding-box",
        "Geometry": [
            {
                "ID": "main_bounding_rectangle", 
                "Type": "Rectangle", 
                "Center": [0, 0], 
                "Size": ["widthIn", "heightIn"],
                "LineIDs": ["rect_T", "rect_R", "rect_B", "rect_L"],
                # Semantic endpoint IDs for each rectangle line (clockwise from top)
                "LineEndpointIDs": {
                    "rect_T": ["rect_T:S", "rect_T:E"],
                    "rect_R": ["rect_R:S", "rect_R:E"],
                    "rect_B": ["rect_B:S", "rect_B:E"],
                    "rect_L": ["rect_L:S", "rect_L:E"]
                }
            }
        ],
        "Constraints": [
            {"Type": "Coincident", "Targets": ["main_bounding_rectangle:C", "ORIGIN"]},
            {"Type": "Horizontal", "Targets": ["rect_T"]},
            {"Type": "Horizontal", "Targets": ["rect_B"]},
            {"Type": "Vertical", "Targets": ["rect_L"]},
            {"Type": "Vertical", "Targets": ["rect_R"]}
        ],
        "Dimensions": [
            {"Target": "rect_T", "Expression": "widthIn", "Name": "dim_width"},
            {"Target": "rect_R", "Expression": "heightIn", "Name": "dim_height"}
        ],
        "Steps": [
            {
                "Type": "Offset",
                "SourceID": ["rect_T", "rect_R", "rect_B", "rect_L"],
                "DistanceExpr": "boundingboxoffset",
                "TargetIDs": ["off_T", "off_R", "off_B", "off_L"],
                "Direction": [0.1, 0.1, 0],
                "CornerIDs": {
                    "TL": "off_corner_TL",
                    "TR": "off_corner_TR",
                    "BL": "off_corner_BL",
                    "BR": "off_corner_BR"
                }
            }
        ]
    }
