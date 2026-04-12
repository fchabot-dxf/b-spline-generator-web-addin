import importlib
import sys, os

# Ensure this package's directory is on sys.path so flat sibling imports resolve
# regardless of whether this module is loaded as a package or directly.
_here = os.path.dirname(os.path.realpath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

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
            {"Name": "widthIn",           "Label": "Width (Model)", "Category": "Frame Spec", "Val": 14.0,  "Unit": "cm", "ReadOnly": True},
            {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 5.0,   "Unit": "cm", "ReadOnly": True},
            {"Name": "boundingboxoffset", "Label": "BBox Border",   "Category": "Frame Spec", "Val": 0.635, "Unit": "cm"},
            {"Name": "frame_thickness",     "Label": "Wall Thickness", "Category": "Frame Spec", "Val": -0.75, "Unit": "in"},
            {"Name": "frame_depth",         "Label": "Frame Depth",    "Category": "Solid Spec", "Val": 2.54,  "Unit": "cm"},

            # Anatomy Block — Multiplier Factors (stored as cm for Fusion compatibility)
            # widthIn and heightIn are the base drivers.
            {"Name": "ShoulderSpan",      "Label": "Shoulder Factor", "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,   "Unit": "cm"},
            {"Name": "WaistSpan",         "Label": "Waist Factor",    "Category": "Anatomy", "Val": 0.70, "Min": 0.2,  "Max": 1.25,  "Unit": "cm"},
            {"Name": "HipSpan",           "Label": "Hip Factor",      "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,   "Unit": "cm"},
            {"Name": "TopGap",            "Label": "Top Height %",    "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,   "Unit": "cm"},
            {"Name": "BottomGap",         "Label": "Bottom Height %", "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,   "Unit": "cm"},
            {"Name": "WaistOffset",       "Label": "Waist Shift",     "Category": "Anatomy", "Val": 0.0,  "Min": -1.0, "Max": 1.0,   "Unit": "cm"},
 
            # Silhouette Block
            {"Name": "ShoulderRadius",    "Label": "Shoulder Radius", "Category": "Silhouette", "Val": 2.5, "Min": 0.5, "Max": 15.0, "Unit": "cm"},
            {"Name": "WaistRadius",       "Label": "Waist Radius",    "Category": "Silhouette", "Val": 2.8, "Min": 0.5, "Max": 15.0, "Unit": "cm"},
            {"Name": "HipRadius",         "Label": "Hip Radius",      "Category": "Silhouette", "Val": 2.5, "Min": 0.5, "Max": 15.0, "Unit": "cm"},

            # UI Toggles — 0.0 = unlocked (slider active), 1.0 = locked (slider disabled)
            {"Name": "en_ShoulderSpan",   "Label": "en_ShoulderSpan", "Category": "Anatomy", "Val": 0.0, "Unit": ""},
            {"Name": "en_WaistSpan",      "Label": "en_WaistSpan",    "Category": "Anatomy", "Val": 0.0, "Unit": ""},
            {"Name": "en_HipSpan",        "Label": "en_HipSpan",      "Category": "Anatomy", "Val": 0.0, "Unit": ""},
            {"Name": "en_TopGap",         "Label": "en_TopGap",       "Category": "Anatomy", "Val": 0.0, "Unit": ""},
            {"Name": "en_BottomGap",      "Label": "en_BottomGap",    "Category": "Anatomy", "Val": 0.0, "Unit": ""},

            # Silhouette Toggles
            {"Name": "en_ShoulderRadius", "Label": "en_ShoulderRadius", "Category": "Silhouette", "Val": 0.0, "Unit": ""},
            {"Name": "en_WaistRadius",    "Label": "en_WaistRadius",    "Category": "Silhouette", "Val": 0.0, "Unit": ""},
            {"Name": "en_HipRadius",      "Label": "en_HipRadius",      "Category": "Silhouette", "Val": 0.0, "Unit": ""}
        ],
        "Sketches": [
            get_sketch_1(ui_data),
            get_sketch_2(ui_data),
        ]
    }
