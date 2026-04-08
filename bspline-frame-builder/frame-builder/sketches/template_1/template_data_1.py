import importlib
import T1_sketch_1_bounding_box, T1_sketch_2_shape_outline

importlib.reload(T1_sketch_1_bounding_box)
importlib.reload(T1_sketch_2_shape_outline)

from T1_sketch_1_bounding_box import get_sketch as get_sketch_1
from T1_sketch_2_shape_outline import get_sketch as get_sketch_2

def get_template_logic():
    """
    Returns the parametric logic for Template 1.
    Standardized clone of T3 — shares all variables and IDs with T2/T3/T4.
    """
    return {
        "Name": "Template 1",
        "Description": "Standardized Arc Series - Clone base, ready for customization",
        "Parameters": [
            {"Name": "widthIn",           "Val": 7.0,   "Unit": "in"},
            {"Name": "heightIn",          "Val": 9.0,   "Unit": "in"},
            {"Name": "boundingboxoffset", "Val": "0.25 in",  "Unit": "in"},
            {"Name": "Skel_Frame_Offset", "Val": "-0.75 in", "Unit": "in"},

            # Sub-parameters (Standardized DNA)
            {"Name": "ShoulderSpan",      "Val": "widthIn * 0.8",  "Unit": "in"},
            {"Name": "WaistSpan",         "Val": "widthIn * 0.95", "Unit": "in"},
            {"Name": "HipSpan",           "Val": "widthIn * 0.8",  "Unit": "in"},
            {"Name": "TopGap",            "Val": "heightIn * 0.15", "Unit": "in"},
            {"Name": "BottomGap",         "Val": "heightIn * 0.15", "Unit": "in"},

            # UI Toggles
            {"Name": "en_ShoulderSpan",   "Val": 1.0, "Unit": ""},
            {"Name": "en_WaistSpan",      "Val": 0.0, "Unit": ""},  # OFF by default
            {"Name": "en_HipSpan",        "Val": 1.0, "Unit": ""},
            {"Name": "en_TopGap",         "Val": 1.0, "Unit": ""},
            {"Name": "en_BottomGap",      "Val": 1.0, "Unit": ""}
        ],
        "Sketches": [
            get_sketch_1(),
            get_sketch_2(),
        ]
    }

TEMPLATE_1 = get_template_logic()
