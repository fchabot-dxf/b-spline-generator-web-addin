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

TEMPLATE_NAME = "Template 8 - Dipped Top + Left-Only Wave"
TEMPLATE_DESCRIPTION = "A dipped top (off centre) over a plain straight right side and base, with a pinch on the left side only - Inches Unified"

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    # Inches throughout to match the rest of the user-facing UI; Fusion
    # stores cm internally (createByString honours the "in" suffix).
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 5.51, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 1.97, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    # The trim offset: the gap between the board edge and the frame's outer
    # perimeter. FB-APP F9 (gate A): a normal template param (not ReadOnly),
    # so the resolver writes the sent value on every build, like frame_thickness.
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # All anatomy/silhouette span and radius sliders (and their en_* lock
    # toggles) were removed when the drivers phase was retired. Seeds
    # are now hardcoded as literal widthIn/heightIn fractions inside the
    # phase files; if you want different proportions, edit the seeds
    # (or regenerate via the template-maker) rather than driving them
    # from the UI.

    # Constraint Toggles - 1.0 = apply, 0.0 = skip. Only the LEFT side's own
    # weld toggles exist (p02_10_welds) - there is no skeleton Equal to gate
    # (p02_11's own doc comment: no right pin exists to tie the left one to).
    {"Name": "ck_arc_shoulder_weld",   "Label": "Shoulder Arc Weld", "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
    {"Name": "ck_arc_hip_weld",        "Label": "Hip Arc Weld",      "Category": "Constraints", "Val": 1.0, "Unit": "", "Expose": True},
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Static 2.0 in cap, as every other template - see Template 5's own
        # note: the p03_03_inner_corner_resolve phase handles the merged
        # regime by finding inner corners by computed position, so the
        # tight geometric cap isn't required.
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
FRAME_SILHOUETTE_PRESET = "dippedLeftWave"   # the app's editor-shape-lattice-generator PRESETS key (frame-only)
# T8 DIPPED TOP + LEFT-ONLY WAVE (Fred's backlog / HANDOFF-ranchy.md section 5, sketch clarified in an amendment:
# the dip sits off centre, in the middle-right of the top edge; the left side has an S-wave pinch; the right side
# and base are straight; 4 mitred square corners): Template 1's classic 4-bar layout and square corners, but the
# right leg (horn_TR + arc_shoulder_R + arc_waist_R + arc_hip_R + horn_BR in Template 1) collapses into ONE plain
# straight line (`side_R`, corner to corner - no pinch at all); the LEFT leg is Template 1's own pinch, unchanged
# (this template's only pinch, "the wave"); the top is Template 5's dipped top, its dip shifted off the centre
# line (`topDipPosition`, new - see editor-shape-lattice-generator.js `hourglassConstruction`'s own doc comment).
# 12 pieces total (1 right + 1 base + 5 left leg + 5 top dip). The corners stay square with a straight stub on
# both legs, so the four mitered bars keep clean 45 deg miters, same as every other template.
_OUTLINE = ['proj_side_R', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L',
            'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_top_edge_L', 'proj_arc_top_shoulder_L', 'proj_arc_top_dip',
            'proj_arc_top_shoulder_R', 'proj_top_edge_R']
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c}:S", f"inner_{c}:S"] for c in     # p03_04 Source -> Target (TL/TR/BR/BL, each piece's own :S)
               ("proj_top_edge_L", "proj_side_R", "proj_bottom_edge", "proj_horn_BL")],
    "surround": "surround_rect",                           # p03_05
}
# FB-APP F9: the frame shape HANDLES, the ONE binding table (the app's Frame tab
# reads it from frame-defs.json; S5's [Send frame] will too). Each handle drags
# one of the app's shape params (editor-shape-lattice-generator.js PARAM_ORDER
# key), a fraction of `basis`: the safe zone's half width "hw" or half height "hh".
#   binding "seeded": no existing template param controls this feature (the
#     shape comes from the literal seeds in phases/p02_*), so the dragged value
#     lives in the frame record's `seeds`, and [Send frame] writes it into the
#     sketch as a plain value: no user parameter is ever created.
FRAME_HANDLES = [
    # Fred's approved handle list (F28 amendment): the wave's own height and reach (Template 1's per-side
    # construction, editor-shape-lattice-generator.js `_solveDippedLeftWave`), then the dip's width, position
    # (new: middle-right of the top edge, not centred) and depth (Template 5's own construction).
    {"key": "waveHeight",     "label": "Left wave height", "basis": "hh", "binding": "seeded"},
    {"key": "waveReach",      "label": "Left wave reach",  "basis": "hw", "binding": "seeded"},
    {"key": "topDipWidth",    "label": "Top dip width",    "basis": "hw", "binding": "seeded"},
    {"key": "topDipPosition", "label": "Top dip position", "basis": "hw", "binding": "seeded"},
    {"key": "topDipDepth",    "label": "Top dip depth",    "basis": "hh", "binding": "seeded"},
]
# T8 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}

# FB-APP F11 (option B, Fred: "simply seed it in position"): where each of
# this template's shape-outline SEEDS comes from when the app sends seeded
# handles: the app's own solved outline (editor-shape-lattice-generator
# primitive `prim`, the order _solveDippedLeftWave returns - see that
# function's own doc comment for the 0-11 piece order). No dimension and no
# parameter is added: only the seed geometry the phases already declare moves.
#   kind "line": Points [S, E] = the primitive's ends ("reverse": E, S)
#   kind "arc":  Points [S, mid, E] (Arc3Point) = the primitive's ends + its
#                on-arc midpoint ("reverse" swaps S and E)
#   kind "pin":  a skeleton pin: its `outer` end ("S"|"E") = the arc centre,
#                the inner end on the Y axis at that height
#   kind "radius": a temporary seed radius dim (deleted later by the phases)
#                  = the primitive's radius
# Orientation is checked against the template's own literal seeds
# (tests/frame-seed-geometry.test.js).
FRAME_SEED_MAP = [
    {"id": "side_R",              "kind": "line", "prim": 0,  "reverse": False},
    {"id": "bottom_edge",         "kind": "line", "prim": 1,  "reverse": False},
    {"id": "horn_BL",             "kind": "line", "prim": 2,  "reverse": False},
    {"id": "arc_hip_L",           "kind": "arc",  "prim": 3,  "reverse": True},
    {"id": "arc_waist_L",         "kind": "arc",  "prim": 4,  "reverse": False},
    {"id": "arc_shoulder_L",      "kind": "arc",  "prim": 5,  "reverse": True},
    {"id": "horn_TL",             "kind": "line", "prim": 6,  "reverse": True},
    {"id": "top_edge_L",          "kind": "line", "prim": 7,  "reverse": False},
    {"id": "arc_top_shoulder_L",  "kind": "arc",  "prim": 8,  "reverse": False},
    {"id": "arc_top_dip",         "kind": "arc",  "prim": 9,  "reverse": False},
    {"id": "arc_top_shoulder_R",  "kind": "arc",  "prim": 10, "reverse": False},
    {"id": "top_edge_R",          "kind": "line", "prim": 11, "reverse": False},
    {"id": "skel_shoulder_pin_L", "kind": "pin", "prim": 5, "outer": "E"},
    {"id": "skel_waist_pin_L",    "kind": "pin", "prim": 4, "outer": "E"},
    {"id": "skel_hip_pin_L",      "kind": "pin", "prim": 3, "outer": "E"},
    {"id": "seed_rad_hip_L",             "kind": "radius", "prim": 3},
    {"id": "seed_rad_waist_L",           "kind": "radius", "prim": 4},
    {"id": "seed_rad_shoulder_L",        "kind": "radius", "prim": 5},
    {"id": "seed_rad_top_shoulder_L",    "kind": "radius", "prim": 8},
    {"id": "seed_rad_top_dip",           "kind": "radius", "prim": 9},
    {"id": "seed_rad_top_shoulder_R",    "kind": "radius", "prim": 10},
]
FRAME_FEATURES = COMMON_FRAME_FEATURES
# F8: the app shape is a MODEL fitted from the recorded Fusion goldens (fb_engine/frame_shape_fit.py, run by
# tools/gen_frame_defs.py). T8: fitted with the dipped_left_wave extractor; until its goldens are recorded live
# (LIVE_CHECK.md) the app gets a PROVISIONAL model instead (like Template 6's tab top, no base template: the
# right side is a plain straight edge and the dip sits off centre, neither of which any earlier template's
# fitted features describe), never none. 0.2 wave reach (MEASURED: 0.4 collapsed the LEFT horn at 12x6, hornLen
# 0.34in < frame_thickness 0.75in; 0.2 keeps a safe hornLen 1.04in margin there) / 0 wave height keep the wave
# modest but visible; 0.14 deep / 0.4 half-wide / 0.15 hw right of centre match a modest, visible dip off centre
# (see editor-shape-lattice-generator.js PRESETS.dippedLeftWave's own literal defaults, kept in sync).
FRAME_SHAPE_EXTRACTOR = "dipped_left_wave"
FRAME_PROVISIONAL_SHAPE = {
    "waveReachOfHw": 0.2,
    "waveHeightOfHh": 0.0,
    "topDipHalfWidthOfHw": 0.4,
    "topDipDepthOfHh": 0.14,
    "topDipPositionOfHw": 0.15,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 8 (Dipped Top + Left-Only Wave).
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
        },
    }
