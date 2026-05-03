import importlib
import T4_sketch_1_bounding_box, T4_sketch_2_shape_outline

importlib.reload(T4_sketch_1_bounding_box)
importlib.reload(T4_sketch_2_shape_outline)

from T4_sketch_1_bounding_box import get_sketch as get_sketch_1
from T4_sketch_2_shape_outline import get_sketch as get_sketch_2

def get_template_logic():
    """
    Returns the parametric logic for Template 4 (Cloned from Template 2).
    """
    from fb_engine.template_factory import get_skeleton, assemble_12nd_order
    
    # Initialize Skeleton & Curve Logic
    skel = get_skeleton()
    geometry_loop = assemble_12nd_order(skel, show_skeleton=True, seal_manifold=False)
    
    return {
        "Name": "Template 4",
        "Description": "Dynamic Clone of Template 2 - Standardized T4 Wiring",
        "Parameters": [
            {"Name": "widthIn",           "Val": 7.0,   "Unit": "in"},
            {"Name": "heightIn",          "Val": 9.0,   "Unit": "in"},
            {"Name": "boundingboxoffset", "Val": "0.25 in",  "Unit": "in"},
            {"Name": "frame_thickness",     "Val": "-0.75 in", "Unit": "in"},
            
            # Sub-parameters (Standardized DNA)
            {"Name": "ShoulderSpan",      "Val": 0.8,  "Unit": "", "DisplayUnit": "x"},
            {"Name": "WaistSpan",         "Val": 0.95, "Unit": "", "DisplayUnit": "x"},
            {"Name": "HipSpan",           "Val": 0.8,  "Unit": "", "DisplayUnit": "x"},
            {"Name": "TopGap",            "Val": 0.15, "Unit": "", "DisplayUnit": "%"},
            {"Name": "BottomGap",         "Val": 0.15, "Unit": "", "DisplayUnit": "%"},

            # UI Toggles
            {"Name": "en_ShoulderSpan",   "Val": 1.0, "Unit": ""},
            {"Name": "en_WaistSpan",      "Val": 0.0, "Unit": ""},
            {"Name": "en_HipSpan",        "Val": 1.0, "Unit": ""},
            {"Name": "en_TopGap",         "Val": 1.0, "Unit": ""},
            {"Name": "en_BottomGap",      "Val": 1.0, "Unit": ""}
        ],
        "Sketches": [
            get_sketch_1(),
            get_sketch_2(geometry_loop),
        ]
    }

TEMPLATE_4 = get_template_logic()
