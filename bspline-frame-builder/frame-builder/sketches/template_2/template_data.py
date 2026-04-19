import sys, os

# Ensure this package's directory is on sys.path so flat sibling imports resolve
# regardless of whether this module is loaded as a package or directly.
_here = os.path.dirname(os.path.realpath(__file__))
if _here not in sys.path:
    sys.path.insert(0, _here)

from template_loader import load_all_sketches, reload_all

# Fusion 360 caches Python modules across Run invocations; drop the loader's
# internal caches on every reimport so edited phase files take effect
# without a full Fusion restart. Matches the old per-template reload_modules.
reload_all()


# ---------------------------------------------------------------------------
# UI metadata — declared at module load time. ``get_template_logic`` simply
# stamps these onto the auto-discovered sketch dicts.
# ---------------------------------------------------------------------------

TEMPLATE_NAME = "Template 2 - Narrow Neck"
TEMPLATE_DESCRIPTION = "Standardized Arc Series - Metric Unified"

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly — owned by b-spline add-in, displayed but not editable
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 14.0,  "Unit": "cm", "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 5.0,   "Unit": "cm", "ReadOnly": True},
    # Read-only bounding box border display
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.635, "Unit": "cm", "ReadOnly": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # Anatomy — solver seeds, user-lockable
    {"Name": "ShoulderSpan", "Label": "Shoulder Width",  "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,  "Unit": "", "DisplayUnit": "x"},
    {"Name": "WaistSpan",    "Label": "Waist Width",     "Category": "Anatomy", "Val": 0.95, "Min": 0.2,  "Max": 1.25, "Unit": "", "DisplayUnit": "x"},
    {"Name": "HipSpan",      "Label": "Hip Width",       "Category": "Anatomy", "Val": 0.80, "Min": 0.2,  "Max": 0.9,  "Unit": "", "DisplayUnit": "x"},
    {"Name": "TopGap",       "Label": "Top Height %",     "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,  "Unit": "", "DisplayUnit": "%"},
    {"Name": "BottomGap",    "Label": "Bottom Height %",  "Category": "Anatomy", "Val": 0.15, "Min": 0.0,  "Max": 0.5,  "Unit": "", "DisplayUnit": "%"},
    {"Name": "WaistOffset",  "Label": "Waist Offset",      "Category": "Anatomy", "Val": 0.0,  "Min": -1.0, "Max": 1.0,  "Unit": "cm", "Expose": True},

    # Silhouette — solver seeds, user-lockable. Factors of heightIn
    # (matches the widthIn/heightIn factor convention used by Spans and
    # Gaps). Resolver wraps as ``(heightIn * N)``; UI de-scales back to
    # the factor on panel reopen. Defaults reproduce the prior 2.5/2.8/
    # 2.5 cm values at the default heightIn=5 cm.
    {"Name": "ShoulderRadius", "Label": "Shoulder Radius", "Category": "Silhouette", "Val": 0.5,  "Min": 0.1, "Max": 2.0, "Unit": "", "DisplayUnit": "x"},
    {"Name": "WaistRadius",    "Label": "Waist Radius",    "Category": "Silhouette", "Val": 0.56, "Min": 0.1, "Max": 2.0, "Unit": "", "DisplayUnit": "x"},
    {"Name": "HipRadius",      "Label": "Hip Radius",      "Category": "Silhouette", "Val": 0.5,  "Min": 0.1, "Max": 2.0, "Unit": "", "DisplayUnit": "x"},

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

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        "Name": "frame_thickness",
        "Label": "Frame thickness",
        "Category": "Frame Spec",
        "Val": 2.0,
        "Unit": "cm",
        "Min": 0.5,
        "Max": 5.0,
        "Expose": True,
    },
]


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 2.
    Standardized to Metric (cm) to prevent unit-flip explosions.
    Supports dynamic pinning via ui_data injection.

    Sketches are discovered automatically by ``template_loader`` via
    filename convention (``sketch_N_*.py``). Their phase lists come
    from the same loader scanning ``phases/pNN_MM_*.py``. UI metadata
    (Label / Parameters) is loaded at module level above and stamped
    onto each sketch dict here.
    """
    sketches = load_all_sketches(ui_data)
    s1, s2, s3 = sketches[0], sketches[1], sketches[2]

    s1["Label"] = SKETCH_1_LABEL
    s1["Parameters"] = SKETCH_1_PARAMETERS

    s2["Label"] = SKETCH_2_LABEL
    s2["Parameters"] = SKETCH_2_PARAMETERS

    s3["Label"] = SKETCH_3_LABEL
    s3["Parameters"] = SKETCH_3_PARAMETERS

    return {
        "Name": TEMPLATE_NAME,
        "Description": TEMPLATE_DESCRIPTION,
        "Sketches": [s1, s2, s3],
    }
