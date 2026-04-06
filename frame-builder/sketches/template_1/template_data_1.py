import importlib
from . import T1_sketch_1_bounding_box, T1_sketch_2_shape_outline

importlib.reload(T1_sketch_1_bounding_box)
importlib.reload(T1_sketch_2_shape_outline)

from .T1_sketch_1_bounding_box import get_sketch as get_sketch_1
from .T1_sketch_2_shape_outline import get_sketch as get_sketch_2

def get_template_logic():
    """
    Returns the parametric logic for Template 1 (Signature Frame).
    Refactored to properly inject skeleton geometry for offset support.
    """
    from engine.template_factory import get_skeleton, assemble_12nd_order
    
    # Initialize Skeleton & Curve Logic
    skel = get_skeleton()
    geometry_loop = assemble_12nd_order(skel, show_skeleton=True, seal_manifold=False)
    
    return {
        "Name": "Signature (Template 1)",
        "Description": "Signature Series - 12nd-Order S-Curve (Consolidated 2-Sketch System)",
        "Parameters": [
            {"Name": "widthIn",           "Val": 7.0,   "Unit": "in"},
            {"Name": "heightIn",          "Val": 9.0,   "Unit": "in"},
            {"Name": "boundingboxoffset", "Val": 0.25,  "Unit": "in"},
            {"Name": "Skel_Frame_Offset", "Val": -0.75, "Unit": "in"},
            
            # Sub-parameters (Standardized DNA)
            {"Name": "ShoulderSpan",      "Val": "widthIn * 0.8", "Unit": "in"},
            {"Name": "WaistSpan",         "Val": "widthIn * 0.95", "Unit": "in"},
            {"Name": "HipSpan",           "Val": "widthIn * 0.8", "Unit": "in"},
            {"Name": "TopGap",            "Val": "heightIn * 0.15", "Unit": "in"},
            {"Name": "BottomGap",         "Val": "heightIn * 0.15", "Unit": "in"},

            # UI Toggles
            {"Name": "en_ShoulderSpan",   "Val": 1.0, "Unit": ""},
            {"Name": "en_WaistSpan",      "Val": 0.0, "Unit": ""}, # OFF by default
            {"Name": "en_HipSpan",        "Val": 1.0, "Unit": ""},
            {"Name": "en_TopGap",         "Val": 1.0, "Unit": ""},
            {"Name": "en_BottomGap",      "Val": 1.0, "Unit": ""}
        ],
        "Sketches": [
            get_sketch_1(),
            get_sketch_2(geometry_loop),
        ]
    }

TEMPLATE_1 = get_template_logic()
