# Exhaustive Command-Driven Specification for Template 3
# (Placeholder for future design variants)

TEMPLATE_3 = {
    "Name": "Template 3",
    "Parameters": [
        {"Name": "widthIn", "Val": 17.78, "Unit": "cm"},
        {"Name": "heightIn", "Val": 22.86, "Unit": "cm"},
        {"Name": "Skel_Frame_Offset", "Val": -1.905, "Unit": "cm"}
    ],
    "Sketches": [
        {
            "Name": "1_bounding-box",
            "Geometry": [
                {
                    "ID": "main_bounding_rectangle", 
                    "Type": "Rectangle", 
                    "Center": [0, 0], 
                    "Size": [17.78, 22.86],
                    "LineIDs": ["edge_bottom", "edge_right", "edge_top", "edge_left"] 
                }
            ],
            "Constraints": [
                {"Type": "Coincident", "Targets": ["main_bounding_rectangle:D1", "ORIGIN"]},
                {"Type": "Coincident", "Targets": ["main_bounding_rectangle:D2", "ORIGIN"]}
            ]
        },
        {
            "Name": "2_shape-outline",
            "Projections": [
                {"SourceSketch": "1_bounding-box", "SourceID": "edge_top:MINX", "TargetID": "outer_corner_top_left"},
                {"SourceSketch": "1_bounding-box", "SourceID": "edge_top:MAXX", "TargetID": "outer_corner_top_right"},
                {"SourceSketch": "1_bounding-box", "SourceID": "edge_bottom:MINX", "TargetID": "outer_corner_bot_left"},
                {"SourceSketch": "1_bounding-box", "SourceID": "edge_bottom:MAXX", "TargetID": "outer_corner_bot_right"}
            ],
            "Geometry": [
                {"ID": "outline_edge_top", "Type": "Line", "Points": [[-8.89, 11.43], [8.89, 11.43]]},
                {"ID": "outline_edge_bottom", "Type": "Line", "Points": [[-8.89, -11.43], [8.89, -11.43]]},
                {"ID": "outline_edge_left", "Type": "Line", "Points": [[-8.89, -11.43], [-8.89, 11.43]]},
                {"ID": "outline_edge_right", "Type": "Line", "Points": [[8.89, -11.43], [8.89, 11.43]]}
            ],
            "Constraints": [
                {"Type": "Coincident", "Targets": ["outline_edge_top:S", "outer_corner_top_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_top:E", "outer_corner_top_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_bottom:S", "outer_corner_bot_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_bottom:E", "outer_corner_bot_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_left:S", "outer_corner_bot_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_left:E", "outer_corner_top_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_right:S", "outer_corner_bot_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_right:E", "outer_corner_top_right"]}
            ]
        }
    ]
}
