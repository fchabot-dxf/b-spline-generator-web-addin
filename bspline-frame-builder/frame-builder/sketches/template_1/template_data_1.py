import importlib
import T1_sketch_1_bounding_box, T1_sketch_2_shape_outline

importlib.reload(T1_sketch_1_bounding_box)
importlib.reload(T1_sketch_2_shape_outline)

from T1_sketch_1_bounding_box import get_sketch as get_sketch_1
from T1_sketch_2_shape_outline import get_sketch as get_sketch_2

def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 1.
    Standardized to Metric (cm) to prevent unit-flip explosions.
    Supports dynamic pinning via ui_data injection.
    """
    return {
        "Name": "Template 1",
        "Description": "Standardized Arc Series - Metric Unified",
        "Parameters": [
            # Note: widthIn and heightIn are read from existing model parameters in inches.
            # We reference them here with cm defaults for fallback/initialization.
            {"Name": "widthIn",           "Val": 14.0,  "Unit": "cm"},
            {"Name": "heightIn",          "Val": 5.0,   "Unit": "cm"},
            {"Name": "boundingboxoffset", "Val": 0.635, "Unit": "cm"},
            {"Name": "Skel_Frame_Offset", "Val": -1.905, "Unit": "cm"},

            # Sub-parameters (Aligned to cm)
            {"Name": "ShoulderSpan",      "Val": "widthIn * 0.8",   "Unit": "cm"},
            {"Name": "WaistSpan",         "Val": "widthIn * 0.7",   "Unit": "cm"},
            {"Name": "HipSpan",           "Val": "widthIn * 0.8",   "Unit": "cm"},
            {"Name": "TopGap",            "Val": "heightIn * 0.15", "Unit": "cm"},
            {"Name": "BottomGap",         "Val": "heightIn * 0.15", "Unit": "cm"},
            {"Name": "WaistOffset",       "Val": 0.0,               "Unit": "cm"},

            # Dynamic Aesthetic Radii (Used as SOFT SNAPS)
            {"Name": "ShoulderRadius",    "Val": 2.5,  "Unit": "cm"},
            {"Name": "WaistRadius",       "Val": 2.8,  "Unit": "cm"},
            {"Name": "HipRadius",         "Val": 2.5,  "Unit": "cm"},

            # UI Toggles
            {"Name": "en_ShoulderSpan",   "Val": 1.0, "Unit": ""},
            {"Name": "en_WaistSpan",      "Val": 1.0, "Unit": ""},
            {"Name": "en_HipSpan",        "Val": 1.0, "Unit": ""},
            {"Name": "en_TopGap",         "Val": 0.0, "Unit": ""},
            {"Name": "en_BottomGap",      "Val": 0.0, "Unit": ""}
        ],
        "Sketches": [
            get_sketch_1(ui_data),
            get_sketch_2(ui_data),
        ]
    }
