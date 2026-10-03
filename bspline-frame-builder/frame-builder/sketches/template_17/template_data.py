import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t16_geometry import (TOP_WIDTH_FRAC_DEFAULT, ARCH_RISE_FRAC_DEFAULT,
                                     WAIST_WIDTH_FRAC_DEFAULT, WAIST_HEIGHT_FRAC_DEFAULT,
                                     BULGE_FRAC_DEFAULT, T17_UPPER_CURVE_FRAC_DEFAULT,
                                     SHARED_LOWER_SKETCH_2_PARAMETERS, UPPER_ARC_SKETCH_2_PARAMETERS)

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

TEMPLATE_NAME = "Template 17 - Tulip"
TEMPLATE_DESCRIPTION = ("A one-piece arch over concave tapering sides, two outward-bulging lower "
                        "curves and a flat base (6 mitered bars) - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
# T84 item 3: shares Template 16's own lower half VERBATIM (fb_engine/t16_geometry.py's own
# SHARED_LOWER_SKETCH_2_PARAMETERS -- arch + 2 lower bulges), plus this template's own additional
# concave-upper-side chain (UPPER_ARC_SKETCH_2_PARAMETERS, t17_ur_*) -- see that module's own
# comment for the derivation/verification and the Unit="" rationale.
SKETCH_2_PARAMETERS = list(SHARED_LOWER_SKETCH_2_PARAMETERS) + list(UPPER_ARC_SKETCH_2_PARAMETERS)

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Static 2.0 in cap, as every other template - p03_03_inner_corner_resolve finds inner
        # corners by computed position, so the tight geometric cap other templates once needed
        # isn't required.
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
# FB-APP S1: this template's frame declaration (frame-defs.json for the app, the extruder from S6).
# T17 TULIP: 6 bars (upper_right, lower_right, base, lower_left, upper_left, arch) -- every joint a
# miter, no tangent-chain grouping. Same bar names/layout as Template 16 (only the upper sides'
# own geometry differs between the two templates).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "tulip"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-right corner (p03_01; the app's primitives 0..5).
_OUTLINE = ['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_arch']

# T84 item 3: same FRAME_BARS escape hatch Template 16 needs (Template 6's own precedent) -- every
# arc here is miter-joined at BOTH its own ends, which breaks declared_profiles.bar_index's own
# generic miter-walk default.
FRAME_BARS = [
    {"name": "frame_upper_right", "curves": ["proj_upper_R"]},
    {"name": "frame_lower_right", "curves": ["proj_lower_R"]},
    {"name": "frame_base",        "curves": ["proj_base"]},
    {"name": "frame_lower_left",  "curves": ["proj_lower_L"]},
    {"name": "frame_upper_left",  "curves": ["proj_upper_L"]},
    {"name": "frame_arch",        "curves": ["proj_arch"]},
]
# No "corners": like Template 10/16, nothing in fb_engine or the app's own JS currently reads
# `regions["corners"]`.
#
# p02_02_loop.py's own docstring table: IDENTICAL to Template 16's own table (the concave upper
# arcs happen to agree with the suffixes the straight lines they replaced already had) -- 3 of
# these 6 corners are only reachable via an arc's own `:E`, never its `:S`.
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [
        ["proj_arch:S",    "inner_proj_arch:S"],      # topR
        ["proj_lower_R:E", "inner_proj_lower_R:E"],   # waistR
        ["proj_lower_R:S", "inner_proj_lower_R:S"],   # BR
        ["proj_lower_L:E", "inner_proj_lower_L:E"],   # BL
        ["proj_lower_L:S", "inner_proj_lower_L:S"],   # waistL
        ["proj_arch:E",    "inner_proj_arch:E"],      # topL
    ],
    "surround": "surround_rect",                           # p03_05
    "bars": [dict(b) for b in FRAME_BARS],
    # F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual
    # toggle" -- every two-part waist, this template's own included): fb_engine/joined_miters.py's
    # own apply_joined_miters() reads this to merge the two named bars into one and flip the named
    # miter's own IsConstruction when the user toggles it JOINED (the default is SPLIT, i.e. this
    # list is declared but inert until a frame record actually asks for it). Identical to Template
    # 16's own declaration (same outline/bar/miter structure, only the curvature differs).
    "joinable": [
        {"id": "waistR", "bars": ["frame_upper_right", "frame_lower_right"],
         "miterSource": "proj_lower_R:E", "mirror": "waistL"},
        {"id": "waistL", "bars": ["frame_lower_left", "frame_upper_left"],
         "miterSource": "proj_lower_L:S", "mirror": "waistR"},
    ],
}
# FB-APP F9: the frame shape HANDLES. 6 seeded (Template 16's own 5, plus this template's own
# upperCurveFrac): no template param sets the outline's own shape (the phases leave it to the
# seeds, p02_02_loop.py), so moving the seeds IS setting it -- no parameter.
#   topWidth/archRiseFrac/waistWidthFrac/waistHeightFrac/bulgeFrac: identical to Template 16's own
#     table (topWidth is T84 item 4's own shared key, same as seat C's Sand Timer/Flask).
#   upperCurveFrac: the two upper sides' own INWARD (concave) sagitta, a fraction of hw -- 0 would
#     degenerate to Template 16's own straight sides (bulgeArc's own documented sag<1e-9 -> a
#     straight-line identity, fb_engine/t16_geometry.py's own outline() docstring), but Template 16
#     already owns that shape as its own separate template, so this one stays > 0.
# H23 item 63's own 180-deg undercut guard (outlineHasUndercut) applies here same as any other
# template; T84 item 3's own dispatch asks for MODERATE ranges specifically so Generate stays
# clear of it. `generateRange` MEASURED the same way as Template 16's own copy of this comment
# (editor-shape-lattice-generator.js's own _archedTimerRange), WITH this template's own
# upperCurveFrac active throughout (not Template 16's own ranges reused -- the same "Tulip's OWN
# bulge/waist-height ranges" lesson the diagram script's own header comment already recorded).
FRAME_HANDLES = [
    {"key": "topWidth",        "label": "Top width",        "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.64, "max": 0.86}},
    {"key": "archRiseFrac",    "label": "Arch rise",        "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.205, "max": 0.565}},
    {"key": "waistWidthFrac",  "label": "Waist width",      "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.335, "max": 0.405}},
    {"key": "waistHeightFrac", "label": "Waist height",     "basis": "h",  "binding": "seeded",
     "generateRange": {"min": 0.45, "max": 0.67}},
    {"key": "bulgeFrac",       "label": "Lower bulge",      "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.089, "max": 0.174}},
    {"key": "upperCurveFrac",  "label": "Upper side curve", "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.09, "max": 0.215}},
]
# T17 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the
# app's tulip order: 0 upper_R .. 5 arch, this template_data.py's own _OUTLINE order). "reverse"
# flags are a FIRST GUESS, same honest gap as Template 16's own copy of this comment -- must be
# checked against tests/frame-seed-geometry.test.js once the app-side solver exists.
FRAME_SEED_MAP = [
    {"id": "upper_R", "kind": "arc",  "prim": 0, "reverse": False},
    {"id": "lower_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "base",    "kind": "line", "prim": 2, "reverse": False},
    {"id": "lower_L", "kind": "arc",  "prim": 3, "reverse": False},
    {"id": "upper_L", "kind": "arc",  "prim": 4, "reverse": False},
    {"id": "arch",    "kind": "arc",  "prim": 5, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 6 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. No base template to derive it from (T17 is new) -- a PROVISIONAL model
# of its own, same as Template 16: the template's own tested default proportions
# (fb_engine/t16_geometry.py's own *_DEFAULT constants - DRY, not re-typed here).
FRAME_SHAPE_EXTRACTOR = "tulip"
FRAME_PROVISIONAL_SHAPE = {
    "topWidthFracOfHw": TOP_WIDTH_FRAC_DEFAULT,
    "archRiseFracOfHw": ARCH_RISE_FRAC_DEFAULT,
    "waistWidthFracOfHw": WAIST_WIDTH_FRAC_DEFAULT,
    "waistHeightFracOfH": WAIST_HEIGHT_FRAC_DEFAULT,
    "bulgeFracOfHw": BULGE_FRAC_DEFAULT,
    "upperCurveFracOfHw": T17_UPPER_CURVE_FRAC_DEFAULT,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 17 (Tulip). Standardized to Inches at the schema
    level (see Template 1). Sketches and their phases are discovered by ``TemplateLoader``; UI
    metadata is stamped onto each sketch dict here.
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
