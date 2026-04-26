import os

from template_loader import TemplateLoader

# Per-template loader instance. State (caches, folder path) lives on the
# instance so two templates can never share caches or step on each
# other's sys.modules entries. ``reload_all`` drops caches so edited
# phase files take effect without restarting Fusion.
_loader = TemplateLoader(os.path.dirname(os.path.realpath(__file__)))
load_all_sketches = _loader.load_all_sketches
reload_all = _loader.reload_all

reload_all()


# ---------------------------------------------------------------------------
# UI metadata - declared at module load time. ``get_template_logic`` simply
# stamps these onto the auto-discovered sketch dicts.
# ---------------------------------------------------------------------------

TEMPLATE_NAME = "Template 1 - Hourglass"
TEMPLATE_DESCRIPTION = "Standardized Arc Series - Inches Unified"

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    # Inches throughout to match the rest of the user-facing UI; Fusion
    # stores cm internally (createByString honours the "in" suffix).
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 5.51, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 1.97, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    # Read-only bounding box border display
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "ReadOnly": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # All anatomy/silhouette span and radius sliders (and their en_* lock
    # toggles) were removed when the drivers phase was retired. Seeds
    # are now hardcoded as literal widthIn/heightIn fractions inside the
    # phase files; if you want different proportions, edit the seeds
    # (or regenerate via the template-maker) rather than driving them
    # from the UI.

    # Constraint Toggles - 1.0 = apply, 0.0 = skip.
    # Only kept the ones still consumed by phase code:
    #   ck_arc_shoulder_weld / ck_arc_hip_weld - p02_10_welds
    #   ck_skel_shoulder_equal / ck_skel_waist_equal - p02_11_symmetry
    # (Hip equal was removed - hip seeds are already symmetric so the
    # constraint over-constrained the sketch.)
    {"Name": "ck_arc_shoulder_weld",   "Label": "Shoulder Arc Weld",       "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
    {"Name": "ck_arc_hip_weld",        "Label": "Hip Arc Weld",            "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
    {"Name": "ck_skel_shoulder_equal", "Label": "Shoulder Skeleton Equal", "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
    {"Name": "ck_skel_waist_equal",    "Label": "Waist Skeleton Equal",    "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        "Name": "frame_thickness",
        "Label": "Frame thickness",
        "Category": "Frame Spec",
        "Val": 0.75,
        "Unit": "in",
        "Min": 0.1,
        "Max": 2.0,
        "Expose": True,
    },
    {
        # Z-axis extrusion height for the jesmonite frame body. Read by
        # fb_engine.frame_engine._extrude_jesmo_frame via the Fusion
        # UserParameter of the same name. Previously a hidden default
        # (2.54 cm = 1.00 in) in fb_value_resolver - now user-adjustable.
        "Name": "frame_depth",
        "Label": "Frame depth",
        "Category": "Frame Spec",
        "Val": 0.75,
        "Unit": "in",
        "Min": 0.1,
        "Max": 4.0,
        "Expose": True,
    },
]


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 1.
    Standardized to Inches at the schema level - Fusion stores cm
    internally; createByString("X in") in frame_engine Phase 1 honours
    the suffix so the UI shows inches end-to-end.
    Supports dynamic pinning via ui_data injection.

    Sketches are discovered automatically by ``TemplateLoader`` via
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
