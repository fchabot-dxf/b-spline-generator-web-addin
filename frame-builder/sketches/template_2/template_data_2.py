# Exhaustive Command-Driven Specification for Template 2
# (Placeholder for future design variants)

TEMPLATE_2 = {
    "Name": "Template 2",
    "Parameters": [
        {"Name": "widthIn", "Val": 17.78, "Unit": "cm"},
        {"Name": "heightIn", "Val": 22.86, "Unit": "cm"},
        {"Name": "Skel_Frame_Offset", "Val": -1.905, "Unit": "cm"},
        {"Name": "Skel_Slot_Tolerance", "Val": 0.635, "Unit": "cm"},
        {"Name": "boundingboxoffset", "Val": 0.635, "Unit": "cm"}
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
                    "LineID": ["edge_bottom", "edge_right", "edge_top", "edge_left"] 
                }
            ],
            "Offsets": [
                {
                    "SourceID": ["edge_bottom", "edge_right", "edge_top", "edge_left"], 
                    "TargetID": "inner_offset_boundary_loop",
                    "TargetIDs": ["offset_edge_bottom", "offset_edge_right", "offset_edge_top", "offset_edge_left"],
                    "DistanceExpr": "-boundingboxoffset"
                }
            ],
            "Constraints": [
                {"Type": "Coincident", "Targets": ["main_bounding_rectangle:D1", "ORIGIN"]},
                {"Type": "Coincident", "Targets": ["main_bounding_rectangle:D2", "ORIGIN"]},
                {"Type": "Horizontal", "Targets": ["edge_bottom"]},
                {"Type": "Perpendicular", "Targets": ["edge_left", "edge_bottom"]},
                {"Type": "Parallel", "Targets": ["edge_top", "edge_bottom"]},
                {"Type": "Parallel", "Targets": ["edge_right", "edge_left"]}
            ],
            "Dimensions": [
                {"Name": "widthIn", "Target": "edge_bottom", "Type": "Distance"},
                {"Name": "heightIn", "Target": "edge_left", "Type": "Distance"}
            ]
        },
        {
            "Name": "2_shape-outline",
            "Projections": [
                {"SourceSketch": "1_bounding-box", "SourceID": "offset_edge_top:MINX", "TargetID": "silhouette_corner_top_left"},
                {"SourceSketch": "1_bounding-box", "SourceID": "offset_edge_top:MAXX", "TargetID": "silhouette_corner_top_right"},
                {"SourceSketch": "1_bounding-box", "SourceID": "offset_edge_bottom:MINX", "TargetID": "silhouette_corner_bot_left"},
                {"SourceSketch": "1_bounding-box", "SourceID": "offset_edge_bottom:MAXX", "TargetID": "silhouette_corner_bot_right"},
                {"SourceSketch": "1_bounding-box", "SourceID": "vertical_symmetry_axis", "TargetID": "outline_symmetry_axis"}
            ],
            "Geometry": [
                {"ID": "vertical_symmetry_axis", "Type": "Line", "Points": [[0, -11.43], [0, 11.43]], "IsConstruction": True},
                {"ID": "outline_edge_top", "Type": "Line", "Points": [[-8.26, 10.79], [8.26, 10.79]]},
                {"ID": "outline_edge_bottom", "Type": "Line", "Points": [[-8.26, -10.79], [8.26, -10.79]]},
                {"ID": "outline_edge_left", "Type": "Line", "Points": [[-8.26, -10.79], [-8.26, 10.79]]},
                {"ID": "outline_edge_right", "Type": "Line", "Points": [[8.26, -10.79], [8.26, 10.79]]}
            ],
            "Constraints": [
                {"Type": "Vertical", "Targets": ["vertical_symmetry_axis"]},
                {"Type": "Coincident", "Targets": ["vertical_symmetry_axis:S", "ORIGIN"]},
                {"Type": "Coincident", "Targets": ["outline_edge_top:S", "silhouette_corner_top_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_top:E", "silhouette_corner_top_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_bottom:S", "silhouette_corner_bot_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_bottom:E", "silhouette_corner_bot_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_left:S", "silhouette_corner_bot_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_left:E", "silhouette_corner_top_left"]},
                {"Type": "Coincident", "Targets": ["outline_edge_right:S", "silhouette_corner_bot_right"]},
                {"Type": "Coincident", "Targets": ["outline_edge_right:E", "silhouette_corner_top_right"]}
            ]
        },
        {
            "Name": "3_frame",
            "Projections": [
                {"SourceSketch": "2_shape-outline", "SourceID": "outline_edge_top", "TargetID": "proj_silhouette_top"},
                {"SourceSketch": "2_shape-outline", "SourceID": "outline_edge_bottom", "TargetID": "proj_silhouette_bottom"},
                {"SourceSketch": "2_shape-outline", "SourceID": "outline_edge_left", "TargetID": "proj_silhouette_left"},
                {"SourceSketch": "2_shape-outline", "SourceID": "outline_edge_right", "TargetID": "proj_silhouette_right"}
            ],
            "Offsets": [
                {
                    "SourceID": ["proj_silhouette_top", "proj_silhouette_right", "proj_silhouette_bottom", "proj_silhouette_left"], 
                    "TargetID": "master_frame_inner_boundary",
                    "TargetIDs": ["frame_top", "frame_right", "frame_bottom", "frame_left"],
                    "DistanceExpr": "-Skel_Frame_Offset"
                }
            ],
            "Constraints": [
                {"Type": "Coincident", "Targets": ["proj_silhouette_top:E", "proj_silhouette_right:E"]},
                {"Type": "Coincident", "Targets": ["proj_silhouette_right:S", "proj_silhouette_bottom:E"]},
                {"Type": "Coincident", "Targets": ["proj_silhouette_bottom:S", "proj_silhouette_left:S"]},
                {"Type": "Coincident", "Targets": ["proj_silhouette_left:E", "proj_silhouette_top:S"]}
            ]
        }
    ]
}
