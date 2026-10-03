import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t14_sandtimer_geometry import (TOP_WIDTH_FRAC_DEFAULT, PINCH_REACH_FRAC_DEFAULT,
                                               BULGE_FRAC_DEFAULT, PINCH_HEIGHT_FRAC_DEFAULT,
                                               SKETCH_2_PARAMETERS as T14_SKETCH_2_PARAMETERS)

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

TEMPLATE_NAME = "Template 14 - Sand Timer"
TEMPLATE_DESCRIPTION = ("A flat top and base with two outward-bulging arcs per side meeting at a "
                        "sharp pinch (6 mitered bars) - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
# T84 item 5: every joint here is a MITER (fb_engine/t14_sandtimer_geometry.py's own module
# docstring) -- unlike T7/T11's tangent chains, each arc stands alone (its own chord + sagitta,
# fb_engine.closed_form_arc.sagitta_circle), so there is no coupled multi-arc solve to seed. ALL
# FOUR side pieces need the full sagitta_circle + true_via_point chain (unlike T16's arch, which
# needed none by symmetry) -- declared ONCE in fb_engine/t14_sandtimer_geometry.py's own
# SKETCH_2_PARAMETERS (two independent chains, upper_R's and lower_R's own; lower_L/upper_L are
# each the exact x-mirror, negated inline in p02_02_loop.py).
SKETCH_2_PARAMETERS = list(T14_SKETCH_2_PARAMETERS)

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
# T14 SAND TIMER: 6 bars (upper_right, lower_right, base, lower_left, upper_left, top) -- every
# joint a miter, no tangent-chain grouping (fb_engine/t14_sandtimer_geometry.py's own module
# docstring).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "sandTimer"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-right corner (p03_01; the app's primitives 0..5).
_OUTLINE = ['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_top']

# T84 item 5: every one of this template's 6 corners is a miter, and EVERY arc (upper_R, lower_R,
# lower_L, upper_L) is miter-joined at BOTH its own ends -- so two of a given arc's own miters
# share the SAME bare outline id (just its :S vs its :E), which breaks declared_profiles.bar_index's
# own generic miter-walk default (it maps each miter to its source's bare-id OUTLINE POSITION, so
# two miters on the same curve collapse onto one position). FRAME_BARS is therefore declared
# explicitly (Template 6/16's own precedent for this exact escape hatch) -- one curve, one bar,
# read directly by bar_index instead of walked.
FRAME_BARS = [
    {"name": "frame_upper_right", "curves": ["proj_upper_R"]},
    {"name": "frame_lower_right", "curves": ["proj_lower_R"]},
    {"name": "frame_base",        "curves": ["proj_base"]},
    {"name": "frame_lower_left",  "curves": ["proj_lower_L"]},
    {"name": "frame_upper_left",  "curves": ["proj_upper_L"]},
    {"name": "frame_top",         "curves": ["proj_top"]},
]
# No "corners": like Template 10/16, nothing in fb_engine or the app's own JS currently reads
# `regions["corners"]` (declared_profiles.py derives everything it needs from "outline" + "miters"
# + "bars" above) -- confirmed by search before omitting it, not assumed.
#
# p02_02_loop.py's own docstring table: ALL FOUR arcs here are only reachable via a MIX of `:S`/`:E`
# depending on which corner -- each pair below names whichever end is PHYSICALLY there, matching
# p03_03/p03_04's own choice exactly. BR/BL are labelled under `base`, not their own arc (lower_R/
# lower_L) -- p03_03_inner_corner_resolve.py's own module docstring explains why: labelling every
# one of the 4 line-circle corners under its own arc (Template 16/17's always-arc convention)
# collides here -- two PAIRS of corners would land on the SAME declaredMiterJointIndices index
# (editor-frame-profile.js) -- found by brute-force search over every physically-valid label choice;
# `base:S`/`base:E` and `lower_R:S`/`lower_L:E` are each the SAME physical point either way.
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [
        ["proj_upper_R:E", "inner_proj_upper_R:E"],   # topR
        ["proj_upper_R:S", "inner_proj_upper_R:S"],   # pinchR
        ["proj_base:S",    "inner_proj_base:S"],      # BR
        ["proj_base:E",    "inner_proj_base:E"],      # BL
        ["proj_upper_L:E", "inner_proj_upper_L:E"],   # pinchL
        ["proj_upper_L:S", "inner_proj_upper_L:S"],   # topL
    ],
    "surround": "surround_rect",                           # p03_05
    "bars": [dict(b) for b in FRAME_BARS],
    # F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual
    # toggle" -- every two-part waist, this template's own pinch included): fb_engine/
    # joined_miters.py's own apply_joined_miters() reads this to merge the two named bars into one
    # and flip the named miter's own IsConstruction when the user toggles it JOINED (the default is
    # SPLIT, i.e. this list is declared but inert until a frame record actually asks for it).
    "joinable": [
        {"id": "pinchR", "bars": ["frame_upper_right", "frame_lower_right"],
         "miterSource": "proj_upper_R:S", "mirror": "pinchL"},
        {"id": "pinchL", "bars": ["frame_lower_left", "frame_upper_left"],
         "miterSource": "proj_upper_L:E", "mirror": "pinchR"},
    ],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). All 4 seeded:
# no template param sets the outline's own shape (the phases leave it to the seeds,
# p02_02_loop.py), so moving the seeds IS setting it -- no parameter (same convention as every
# other hand-built template's own seeded handles).
#   topWidth:         T84 item 4 (Fred-approved): the top's own half-span, a fraction of hw --
#                     shared key with Templates 16/17 (fb_engine/t14_sandtimer_geometry.py's own
#                     TOP_WIDTH_FRAC_DEFAULT). Default 1.0 (full width, as drawn) sits AT its own
#                     range ceiling -- the handle only ever narrows the approved look, never widens
#                     past it (A > hw is structurally invalid, is_valid_outline's own check).
#   pinchReachFrac:   how far IN from the side the pinch sits, a fraction of 1 (not of hw directly
#                     -- pinch_half = hw*(1-pinchReachFrac) is the hw-basis quantity); basis "hw"
#                     for range-narrowing purposes, same as every other horizontal handle here.
#   bulgeFrac:        the four side arcs' own outward sagitta, a fraction of hw (ONE shared value
#                     across all four -- unlike T16's two independent bulge-ish parameters).
#   pinchHeightFrac:  how far down the pinch sits (0=top edge, 1=bottom edge of the full safe
#                     height) -- basis "h", matching Template 16's own waistHeightFrac convention
#                     (which itself matched F31 item 1's own pinchHeightFrac naming), NOT "hh".
# H23 item 63's own 180-deg undercut guard (outlineHasUndercut) applies to this template's own
# outline same as any other. generateRange MEASURED via a closed-form bisection sweep against this
# module's own is_valid_outline() PLUS a neck/miter-collision check (the circle-circle pinch corner
# resolved with Concave1=Concave2=False must stay strictly on the outward side of the centreline --
# the Python-side proxy for frame-no-hooked-miters.test.js's own generic guard, re-confirmed once
# the JS side exists), at 3 board sizes (6x9/7x9/9x12), taking the midpoint-to-extreme HALFWAY
# point, tightest across all 3 -- same methodology T16/T17's own generateRange comment describes.
FRAME_HANDLES = [
    {"key": "topWidth",        "label": "Top width",     "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.57, "max": 1.0}},
    {"key": "pinchReachFrac",  "label": "Pinch reach",    "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.30, "max": 0.61}},
    {"key": "bulgeFrac",       "label": "Pinch bulge",    "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.07, "max": 0.146}},
    {"key": "pinchHeightFrac", "label": "Pinch height",   "basis": "h",  "binding": "seeded",
     "generateRange": {"min": 0.43, "max": 0.57}},
]
# T14 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the
# app's sandTimer order: 0 upper_R .. 5 top, this template_data.py's own _OUTLINE order).
# "reverse" flags are a FIRST GUESS (each primitive assumed to run the SAME direction as sketch
# 2's own :S->:E in DECLARED point order, p02_02_loop.py) and MUST be checked against a real
# seed-geometry test (tests/frame-seed-geometry.test.js) once the app-side solver exists -- NOT YET
# WRITTEN for this template (same honest gap T7/T16's own copy of this comment flags for itself).
FRAME_SEED_MAP = [
    {"id": "upper_R", "kind": "arc",  "prim": 0, "reverse": False},
    {"id": "lower_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "base",    "kind": "line", "prim": 2, "reverse": False},
    {"id": "lower_L", "kind": "arc",  "prim": 3, "reverse": False},
    {"id": "upper_L", "kind": "arc",  "prim": 4, "reverse": False},
    {"id": "top",     "kind": "line", "prim": 5, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 6 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. No base template to derive it from (T14 is new) -- a PROVISIONAL model
# of its own, same as Template 6/7/8/9/16's own precedent: the template's own tested default
# proportions (fb_engine/t14_sandtimer_geometry.py's own *_DEFAULT constants - DRY, not re-typed
# here).
FRAME_SHAPE_EXTRACTOR = "sand_timer"
FRAME_PROVISIONAL_SHAPE = {
    "topWidthFracOfHw": TOP_WIDTH_FRAC_DEFAULT,
    "pinchReachFracOfHw": PINCH_REACH_FRAC_DEFAULT,
    "bulgeFracOfHw": BULGE_FRAC_DEFAULT,
    "pinchHeightFracOfH": PINCH_HEIGHT_FRAC_DEFAULT,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 14 (Sand Timer). Standardized to Inches at the
    schema level (see Template 1). Sketches and their phases are discovered by ``TemplateLoader``;
    UI metadata is stamped onto each sketch dict here.
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
