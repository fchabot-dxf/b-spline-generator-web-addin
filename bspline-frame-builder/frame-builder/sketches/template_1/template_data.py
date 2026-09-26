import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import COMMON_FRAME_FEATURES

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
        # Static 2.0 in cap. The previous heightIn-relative cap was
        # there because high frame_thickness made Fusion's offset merge
        # the side arcs and corrupt the miter pipeline. The
        # p03_03_inner_corner_resolve phase now handles the merged
        # regime by finding inner corners by computed position, so the
        # tight geometric cap isn't required - miters fire even when
        # the side arcs collapse.
        # Min at 0.25 in (typical wall thickness floor for a cast
        # jesmonite frame).
        "Name": "frame_thickness",
        "Label": "Frame thickness",
        "Category": "Frame Spec",
        "Val": 0.75,
        "Unit": "in",
        "Min": 0.25,
        "Max": 1.5,
        "Expose": True,
    },
    # NOTE: the solid builder's Z extrusion depth is driven by the
    # 'frame_height_offset' user parameter, created/updated on each build
    # from the Solid Builder palette's Start Offset field. It has no effect
    # on sketch geometry, so no parameter is declared here. (The old
    # 'frame_depth' param and its unused extrude path were removed.)
]


# ---------------------------------------------------------------------------
# FB-APP S1: this template's frame declaration, read by
# fb_engine.frame_definition.build_frame_defs -> frame-defs.json (the app) and,
# from S6, by the extruder. Region ids are the ones this template's own
# p03_* phases create; test_frame_defs.py fails if any id is missing from the
# blocks (so a renamed curve goes red before Fusion ever runs).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "hourglass"   # the app's editor-shape-lattice-generator PRESETS key
_OUTLINE = ['proj_top_edge', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL']
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c}:S", f"inner_{c}:S"] for c in     # p03_04 Source -> Target
               ("proj_top_edge", "proj_horn_TR", "proj_bottom_edge", "proj_horn_BL")],
    "surround": "surround_rect",                           # p03_05
}
FRAME_FEATURES = COMMON_FRAME_FEATURES
# F6: the app preset's shape params for this template (gate 3.2 = no handles
# yet: the frame's shape comes from the template + these declared params).
# FITTED to the live-recorded S4 golden at the 7x9 reference board
# (tests/fixtures/frame-parity/template_1_7x9.json):
#   safe-zone pinch depth 1.039 in -> waistReach 0.32; shoulder radius 0.624 in -> cornerRadius 0.19;
#   waist centred. At 12x6 Fusion's own solve differs (waistReach ~0.24, cornerRadius ~0.07):
#   a close match at other sizes is S4's parity job.
FRAME_SHAPE_PARAMS = {"waistReach": 0.32, "cornerRadius": 0.19, "waistCenterY": 0.0}


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
        "Frame": {
            "silhouettePreset": FRAME_SILHOUETTE_PRESET,
            "regions": FRAME_REGIONS,
            "features": [dict(f) for f in FRAME_FEATURES],
            "shapeParams": dict(FRAME_SHAPE_PARAMS),
        },
    }
