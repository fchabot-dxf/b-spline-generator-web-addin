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

TEMPLATE_NAME = "Template 19 - Arched Head - Tapered sides"
TEMPLATE_DESCRIPTION = ("Template 18's own narrow head topped by an arch, its sides leaning inward "
                        "toward the arch instead of running straight up, over the same 3-arc hourglass "
                        "pinch and straight base - Inches Unified")

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
# FB-APP F9: the frame shape HANDLES -- Template 18's own 4 (archRise/topInset/waistReach/
# waistCenterY), plus `taperAngle`, the SAME precedent T12/T13 set (F30 item 3, "- Tapered sides"):
# the head's own sides lean inward toward the arch instead of running straight up. The shoulder/hip
# radii stay at their own resolved (independent) defaults, unexposed -- same convention every
# hourglass-family template already uses for params it doesn't list here.
FRAME_HANDLES = [
    {"key": "archRise",     "label": "Arch rise",      "basis": "hh", "binding": "seeded"},
    {"key": "topInset",     "label": "Head width",     "basis": "hw", "binding": "seeded"},
    {"key": "waistReach",   "label": "Waist reach",    "basis": "hw", "binding": "seeded"},
    {"key": "waistCenterY", "label": "Waist position", "basis": "hh", "binding": "seeded"},
    # H23 item 80 (F30 item 3's own precedent): seeded, like every other handle here -- no new Fusion
    # parameter, the shape comes from the literal horn/shoulder-arc seeds this template's own
    # p02_03_loop declares, moved by the app's own taper construction (`_taperedCorner`, which already
    # accounts for `topInset`/`archRise` together, H23 item 59's own fix).
    {"key": "taperAngle",   "label": "Taper angle",    "basis": "hw", "binding": "seeded"},
]
FRAME_HANDLE_MIGRATIONS = {}  # T19 is new: no record was ever saved before, so nothing to migrate.

# FB-APP F11 (option B): where each of this template's shape-outline SEEDS comes from when the app
# sends seeded handles -- identical to Template 18's own table (same phase files, same curve names;
# taperAngle moves the SAME seeded horn/shoulder points, it adds no new seed-map entry of its own).
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
# H23 item 80: Template 19's app shape MODEL -- the SAME "from"-based composition T12/T13 already use
# (frame_definition.py's own generic dispatch, zero new code here): `{"from": "template_18",
# "taperAngleDeg": 8.0}` resolves Template 18's own provisional model first (every one of its own
# features -- waistReach/cornerRadiusTop/cornerRadiusBottom/waistCenterY/waistRadius/topInset/
# archRise/waistOpeningFtIn -- kept verbatim) then layers `taperAngle` on top
# (frame_shape_fit.provisional_taper_model).
#
# `shapeExtractor` override IS needed here, unlike T12/T13: MEASURED (this item, after recording this
# template's own first-ever goldens) -- omitting it, T12/T13's own stated reason ("the plain hourglass
# extractor's own validity check already rejects a tapered shoulder") does NOT hold for this template:
# the generic `_hourglass` extractor doesn't check for `topInset`/`archRise` at all, so it silently
# "succeeded" at a REAL fit from these goldens -- and in doing so completely DROPPED archRise/topInset/
# cornerRTop/cornerRBottom/waistOpeningFtIn (every feature that makes this template's own head what it
# is), extracting only the base 5 Template-1-style features from the wrong curves entirely. Reusing
# Template 18's own dedicated stub extractor (`_hourglass_narrow_arched_head`, always `return False,
# {}` until someone writes the real one -- its own docstring already explains why) correctly forces
# this template back onto its provisional model instead, the same safety T18 itself already has.
FRAME_SHAPE_EXTRACTOR = "hourglass_narrow_arched_head"
FRAME_PROVISIONAL_SHAPE = {"from": "template_18", "taperAngleDeg": 8.0}

# H23 item 80: un-hidden -- the 22-case live matrix (every declared handle at its own reachable
# {min, max} + default, x {7x9, 9x12}, the SAME methodology T18's own un-hide used) is all-BUILT (4
# bars, sketch_3 created, timeline healthy, every case). 3 cases hit a transient session-degradation
# false failure mid-run (the fusion360-quirks skill's own already-documented "long session, many
# scratch docs" pattern -- a plain stop/run resolved it, re-tested clean immediately after, no code at
# fault); see WORK-LOG.md for the full record.
FRAME_HIDDEN = False


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 19 (Arched Head - Tapered sides).
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
