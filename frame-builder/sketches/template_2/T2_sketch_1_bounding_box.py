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
                "LineEndpointIDs": {
                    "rect_T": ["rect_T:S", "rect_T:E"],
                    "rect_R": ["rect_R:S", "rect_R:E"],
                    "rect_B": ["rect_B:S", "rect_B:E"],
                    "rect_L": ["rect_L:S", "rect_L:E"]
                }
            }
        ],
        "Constraints": [
            # H/V are implicit from addCenterPointRectangle — adding them again crashes the solver.
            # Only Coincident is needed to pin the rectangle to the origin.
            {"Type": "Coincident", "Targets": ["main_bounding_rectangle:C", "ORIGIN"]}
        ],
        "Dimensions": [
            {"Targets": ["rect_T:S", "rect_T:E"], "Expr": "widthIn",  "Name": "dim_width"},
            {"Targets": ["rect_R:S", "rect_R:E"], "Expr": "heightIn", "Name": "dim_height"}
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
