import importlib
import sys, os

# Ensure this package's directory is on sys.path so flat sibling imports resolve
# regardless of whether this module is loaded as a package or directly.
_here = os.path.dirname(os.path.realpath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

import T2_sketch_1_bounding_box, T2_sketch_2_shape_outline, T2_sketch_3_frame_enclosure

def reload_modules():
    """Manual reload of the entire template tree to ensures stability in Fusion 360."""
    importlib.reload(T2_sketch_1_bounding_box)
    importlib.reload(T2_sketch_2_shape_outline)
    importlib.reload(T2_sketch_3_frame_enclosure)

reload_modules()

from T2_sketch_1_bounding_box import get_sketch as get_sketch_1
from T2_sketch_2_shape_outline import get_sketch as get_sketch_2
from T2_sketch_3_frame_enclosure import get_sketch as get_sketch_3

def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 2.
    Standardized to Metric (cm) to prevent unit-flip explosions.
    Supports dynamic pinning via ui_data injection.
    Parameters are declared per-sketch for UI panel grouping.
    """
    s1 = get_sketch_1(ui_data)
    s2 = get_sketch_2(ui_data)
    s3 = get_sketch_3(ui_data)

    s1["Label"] = "Bounding Box"
    s1["Parameters"] = [
        # ReadOnly — owned by b-spline add-in, displayed but not editable
        {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 14.0,  "Unit": "cm", "ReadOnly": True},
        {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 5.0,   "Unit": "cm", "ReadOnly": True},
        # Read-only bounding box border display
        {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.635, "Unit": "cm", "ReadOnly": True},
    ]

    s2["Label"] = "Shape Outline"
    s2["Parameters"] = [
        # Anatomy — solver seeds, user-lockable
        {"Name": "ShoulderSpan", "Label": "Shoulder Width",  "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,  "Unit": "", "DisplayUnit": "x"},
        {"Name": "WaistSpan",    "Label": "Waist Width",     "Category": "Anatomy", "Val": 0.95, "Min": 0.2,  "Max": 1.25, "Unit": "", "DisplayUnit": "x"},
        {"Name": "HipSpan",      "Label": "Hip Width",       "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,  "Unit": "", "DisplayUnit": "x"},
        {"Name": "TopGap",       "Label": "Top Height %",     "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,  "Unit": "", "DisplayUnit": "%"},
        {"Name": "BottomGap",    "Label": "Bottom Height %",  "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,  "Unit": "", "DisplayUnit": "%"},
        {"Name": "WaistOffset",  "Label": "Waist Offset",      "Category": "Anatomy", "Val": 0.0,  "Min": -1.0, "Max": 1.0,  "Unit": "cm", "Expose": True},

        # Silhouette — solver seeds, user-lockable
        {"Name": "ShoulderRadius", "Label": "Shoulder Radius", "Category": "Silhouette", "Val": 2.5, "Min": 0.5, "Max": 15.0, "Unit": "cm"},
        {"Name": "WaistRadius",    "Label": "Waist Radius",    "Category": "Silhouette", "Val": 2.8, "Min": 0.5, "Max": 15.0, "Unit": "cm"},
        {"Name": "HipRadius",      "Label": "Hip Radius",      "Category": "Silhouette", "Val": 2.5, "Min": 0.5, "Max": 15.0, "Unit": "cm"},

        # Anatomy Toggles — 0.0 = seed, 1.0 = hard constraint
        {"Name": "en_ShoulderSpan",   "Category": "Anatomy",    "Val": 0.0, "Unit": ""},
        {"Name": "en_WaistSpan",      "Category": "Anatomy",    "Val": 0.0, "Unit": ""},
        {"Name": "en_HipSpan",        "Category": "Anatomy",    "Val": 0.0, "Unit": ""},
        {"Name": "en_TopGap",         "Category": "Anatomy",    "Val": 0.0, "Unit": ""},
        {"Name": "en_BottomGap",      "Category": "Anatomy",    "Val": 0.0, "Unit": ""},

        # Silhouette Toggles — 0.0 = seed, 1.0 = hard constraint
        {"Name": "en_ShoulderRadius", "Category": "Silhouette", "Val": 0.0, "Unit": ""},
        {"Name": "en_WaistRadius",    "Category": "Silhouette", "Val": 0.0, "Unit": ""},
        {"Name": "en_HipRadius",      "Category": "Silhouette", "Val": 0.0, "Unit": ""},

        # Constraint Toggles — 1.0 = apply, 0.0 = skip
        {"Name": "ck_arc_shoulder_weld",   "Label": "Shoulder Arc Weld",      "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_arc_hip_weld",        "Label": "Hip Arc Weld",           "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_shoulder_merge", "Label": "Shoulder Skeleton Merge","Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_shoulder_equal", "Label": "Shoulder Skeleton Equal", "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_neck_merge",    "Label": "Neck Skeleton Merge",   "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_neck_equal",    "Label": "Neck Skeleton Equal",    "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_hip_merge",      "Label": "Hip Skeleton Merge",     "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_hip_equal",      "Label": "Hip Skeleton Equal",      "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_shoulder_horiz", "Label": "Shoulder Horizontal",    "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_neck_horiz",    "Label": "Neck Horizontal",       "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
        {"Name": "ck_skel_hip_horiz",      "Label": "Hip Horizontal",         "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
    ]

    s3["Label"] = "Frame Enclosure"
    s3["Parameters"] = [
        {
            "Name": "frame_thickness",
            "Label": "Frame thickness",
            "Category": "Frame Spec",
            "Val": 2.0,
            "Unit": "cm",
            "Min": 0.5,
            "Max": 5.0,
            "Expose": True
        },
    ]

    return {
        "Name": "Template 2 - Narrow Neck",
        "Description": "Standardized Arc Series - Metric Unified",
        "Sketches": [s1, s2, s3]
    }
