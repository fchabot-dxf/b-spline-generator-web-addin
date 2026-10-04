import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import COMMON_FRAME_FEATURES
from fb_engine.seed_basis import seed_sketch

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

TEMPLATE_NAME = "Template 18 - Arched Head"
TEMPLATE_DESCRIPTION = ("A narrow vertical-sided head topped by an arch, over a 3-arc hourglass "
                        "pinch (independent shoulder/hip radii) and a straight base - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    # Inches throughout to match the rest of the user-facing UI; Fusion
    # stores cm internally (createByString honours the "in" suffix).
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    # The trim offset: the gap between the board edge and the frame's outer
    # perimeter. FB-APP F9 (gate A): a normal template param (not ReadOnly),
    # so the resolver writes the sent value on every build, like frame_thickness.
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # Same constraint toggles as Template 10 (p02_10_welds / p02_11_symmetry still gate on them); the top arch's
    # own constraints (p02_03: Fix on S/E) are never gated -- a gate would be a new template parameter
    # (Fred's rule, Template 6's own finding), and they are needed unconditionally for the top solve.
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
        "Min": 0.25,
        "Max": 1.5,
        "Expose": True,
    },
]


# ---------------------------------------------------------------------------
# FB-APP S1: this template's frame declaration, read by
# fb_engine.frame_definition.build_frame_defs -> frame-defs.json (the app) and,
# from S6, by the extruder. Region ids are the ones this template's own
# p03_* phases create; test_frame_defs.py fails if any id is missing from the
# blocks (so a renamed curve goes red before Fusion ever runs).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "hourglass"   # the SAME shared preset Templates 1/3/4/5/10 use -- the sides/base
                                         # are the same Template-1 tangency algebra, split into independent
                                         # shoulder/hip radii (like Template 11's own pinch) rather than one
                                         # shared `cornerRadius`.
_OUTLINE = ['proj_top_edge', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL']
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c}:S", f"inner_{c}:S"] for c in     # p03_04 Source -> Target
               ("proj_top_edge", "proj_horn_TR", "proj_bottom_edge", "proj_horn_BL")],
    "surround": "surround_rect",                           # p03_05
    # No "corners" / "bars": like Templates 1/3/4/5/10, this stays the generic 4-bar default
    # (fb_engine/declared_profiles.py derives it from "outline" + "miters" above).
}
# FB-APP F9: the frame shape HANDLES. "Head width" (topInset) is new vs Template 10 -- the dispatch's
# own "top/head-width handle". archRise/waistReach/waistCenterY match Template 10's own set. The
# shoulder/hip radii stay at their own resolved (independent) defaults, unexposed -- same convention
# every hourglass-family template already uses for params it doesn't list here. No taperAngle: Fred's
# own reconstruction has no default taper (a tapered variant is its own template, 19, not this one's
# parameter).
FRAME_HANDLES = [
    {"key": "archRise",     "label": "Arch rise",      "basis": "hh", "binding": "seeded"},
    {"key": "topInset",     "label": "Head width",     "basis": "hw", "binding": "seeded"},
    {"key": "waistReach",   "label": "Waist reach",    "basis": "hw", "binding": "seeded"},
    {"key": "waistCenterY", "label": "Waist position", "basis": "hh", "binding": "seeded"},
]
FRAME_HANDLE_MIGRATIONS = {}  # T18 is new: no record was ever saved before, so nothing to migrate.

# FB-APP F11 (option B): where each of this template's shape-outline SEEDS comes from when the app
# sends seeded handles -- identical to Template 10's own table (same phase files, same curve names).
FRAME_SEED_MAP = [
    {"id": "top_edge",       "kind": "arc",  "prim": 11, "reverse": False},
    {"id": "bottom_edge",    "kind": "line", "prim": 5,  "reverse": False},
    {"id": "horn_TR",        "kind": "line", "prim": 0,  "reverse": False},
    {"id": "horn_BR",        "kind": "line", "prim": 4,  "reverse": True},
    {"id": "horn_TL",        "kind": "line", "prim": 10, "reverse": True},
    {"id": "horn_BL",        "kind": "line", "prim": 6,  "reverse": False},
    {"id": "arc_shoulder_R", "kind": "arc",  "prim": 1,  "reverse": False},
    {"id": "arc_waist_R",    "kind": "arc",  "prim": 2,  "reverse": True},
    {"id": "arc_hip_R",      "kind": "arc",  "prim": 3,  "reverse": False},
    {"id": "arc_hip_L",      "kind": "arc",  "prim": 7,  "reverse": True},
    {"id": "arc_waist_L",    "kind": "arc",  "prim": 8,  "reverse": False},
    {"id": "arc_shoulder_L", "kind": "arc",  "prim": 9,  "reverse": True},
    {"id": "skel_shoulder_pin_R", "kind": "pin", "prim": 1, "outer": "E"},
    {"id": "skel_shoulder_pin_L", "kind": "pin", "prim": 9, "outer": "E"},
    {"id": "skel_waist_pin_R",    "kind": "pin", "prim": 2, "outer": "E"},
    {"id": "skel_waist_pin_L",    "kind": "pin", "prim": 8, "outer": "E"},
    {"id": "skel_hip_pin_R",      "kind": "pin", "prim": 3, "outer": "E"},
    {"id": "skel_hip_pin_L",      "kind": "pin", "prim": 7, "outer": "E"},
    {"id": "seed_rad_shoulder_R", "kind": "radius", "prim": 1},
    {"id": "seed_rad_waist_R",    "kind": "radius", "prim": 2},
    {"id": "seed_rad_hip_R",      "kind": "radius", "prim": 3},
    {"id": "seed_rad_hip_L",      "kind": "radius", "prim": 7},
    {"id": "seed_rad_waist_L",    "kind": "radius", "prim": 8},
    {"id": "seed_rad_shoulder_L", "kind": "radius", "prim": 9},
]
FRAME_FEATURES = COMMON_FRAME_FEATURES
# H23 item 78c: Template 18's app shape MODEL. No live Fusion goldens exist yet (brand new template):
# a PROVISIONAL model built from Fred's own hand-reconstructed sketch dump, fitted exactly by
# tools/repro/h23_item78b_t10_target_vs_current.mjs (every arc's centre/radius matches the dump to
# within its own 4-decimal rounding -- see WORK-LOG.md's H23 item 78b/c entries). Reuses Template
# 11's own split-corner-radius pinch builder (`provisional_narrow_head_arched_top_model`, itself built
# on `provisional_diamond_top_hourglass_pinch_model`) plus topInset (narrow head) and archRise (arch).
# `cornerRadiusTopOfHw` is 0.27692 (0.9in at 7x9), not Fred's own exact sketch value (0.10554,
# 0.343in): his exact value is an UNDERCUT at frame_thickness=0.75in (bisected: clears at ~0.88in);
# Fred approved this rounder shoulder, confirmed against the H23 item 78b-step-1 and 78c renders.
# H23 item 78c (advisor's Option A, after the live 7x9 build physically merged the left/right bars --
# MEASURED, WORK-LOG.md): "waistOpeningFrameThicknessIn" arms the size-aware waist-opening clamp
# (frame_shape_fit.provisional_narrow_head_arched_top_model / editor-shape-lattice-generator.js's own
# paramsFromShapeModel) at this template's own declared default frame_thickness (SKETCH_3_PARAMETERS
# above, 0.75in) -- narrows waistReach automatically at small boards so the waist opening never closes
# below FRAME_MIN_OPENING_IN, leaves 9x12 (already safe) untouched.
FRAME_SHAPE_EXTRACTOR = "hourglass_narrow_arched_head"
FRAME_PROVISIONAL_SHAPE = {
    "waistReachOfHw": 0.77292, "cornerRadiusTopOfHw": 0.27692, "cornerRadiusBottomOfHw": 0.39705,
    "waistCenterYOfHh": 0.27784, "waistRadiusOfHw": 0.21726, "topInsetOfHw": 0.41092, "archRiseOfHw": 0.19419,
    "waistOpeningFrameThicknessIn": 0.75,
}

# H23 item 78c: hidden from the template picker until the Fusion phases are built and live-verified
# (goldens at 7x9 + 9x12, the live matrix, guard-clean at every size) -- same mechanism every other
# brand-new template uses before its own first live check (F29 item 1 precedent). A saved project
# that already picked Template 18 keeps loading and drawing exactly as before -- every lookup is
# still by id over the full template list (frame-record.js findFrameTemplate); only the picker's own
# dropdown (frame-panel.js) reads this flag. Flip back to False once the live checks pass and before
# merging the t10-reconstruction branch to main.
FRAME_HIDDEN = True


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 18 (Arched Head).
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
    seed_sketch(s2)  # F14 (S8): the seeds follow the safe zone (fb_engine/seed_basis.py)

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
            "handles": [dict(h) for h in FRAME_HANDLES],
            "handleMigrations": {k: list(v) for k, v in FRAME_HANDLE_MIGRATIONS.items()},
            "seedMap": [dict(e) for e in FRAME_SEED_MAP],
            "shapeExtractor": FRAME_SHAPE_EXTRACTOR,
            "provisionalShape": dict(FRAME_PROVISIONAL_SHAPE),
            "hidden": FRAME_HIDDEN,
        },
    }
