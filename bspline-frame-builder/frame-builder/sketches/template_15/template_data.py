import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t15_flask_geometry import (TOP_WIDTH_FRAC_DEFAULT, NECK_HEIGHT_FRAC_DEFAULT,
                                           DOME_FULLNESS_FRAC_DEFAULT,
                                           SKETCH_2_PARAMETERS as T15_SKETCH_2_PARAMETERS)

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

TEMPLATE_NAME = "Template 15 - Flask"
TEMPLATE_DESCRIPTION = ("A straight neck meeting an outward-bulging dome down to a flat base "
                        "(6 mitered bars) - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
# F31 item 2b: every joint here is a MITER (fb_engine/t15_flask_geometry.py's own module
# docstring) -- unlike T7/T11's tangent chains, the dome stands alone (its own chord + sagitta,
# fb_engine.closed_form_arc.sagitta_circle), so there is no coupled multi-arc solve to seed. ONLY
# the dome needs the full sagitta_circle + true_via_point chain -- declared ONCE in
# fb_engine/t15_flask_geometry.py's own SKETCH_2_PARAMETERS (one independent chain, dome_R's own;
# dome_L is the exact x-mirror, negated inline in p02_02_loop.py).
SKETCH_2_PARAMETERS = list(T15_SKETCH_2_PARAMETERS)

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
# T15 FLASK: 6 bars (neck_right, dome_right, base, dome_left, neck_left, top) -- every joint a
# miter, no tangent-chain grouping (fb_engine/t15_flask_geometry.py's own module docstring).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "flask"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-right corner (p03_01; the app's primitives 0..5).
_OUTLINE = ['proj_neck_R', 'proj_dome_R', 'proj_base', 'proj_dome_L', 'proj_neck_L', 'proj_top']

# F31 item 2b: every one of this template's 6 corners is a miter, and the dome (dome_R/dome_L) is
# miter-joined at BOTH its own ends -- so its two miters would share the SAME bare outline id (just
# its :S vs its :E), which breaks declared_profiles.bar_index's own generic miter-walk default (it
# maps each miter to its source's bare-id OUTLINE POSITION, so two miters on the same curve collapse
# onto one position). FRAME_BARS is therefore declared explicitly (Template 6/14/16's own precedent
# for this exact escape hatch) -- one curve, one bar, read directly by bar_index instead of walked.
FRAME_BARS = [
    {"name": "frame_neck_right", "curves": ["proj_neck_R"]},
    {"name": "frame_dome_right", "curves": ["proj_dome_R"]},
    {"name": "frame_base",       "curves": ["proj_base"]},
    {"name": "frame_dome_left",  "curves": ["proj_dome_L"]},
    {"name": "frame_neck_left",  "curves": ["proj_neck_L"]},
    {"name": "frame_top",        "curves": ["proj_top"]},
]
# No "corners": like Template 10/14/16, nothing in fb_engine or the app's own JS currently reads
# `regions["corners"]` (declared_profiles.py derives everything it needs from "outline" + "miters"
# + "bars" above) -- confirmed by search before omitting it, not assumed.
#
# UNLIKE T14, no corner here needs relabelling under a neighbour piece: the dome only ever touches
# TWO corners (neckBottomR/BR on the right, mirrored on the left), so there is no
# declaredMiterJointIndices collision to dodge (p03_03_inner_corner_resolve.py's own module
# docstring) -- every corner below is labelled under its own arc/line, the clean convention T16/T17
# always use.
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [
        ["proj_neck_R:S", "inner_proj_neck_R:S"],   # topR
        ["proj_dome_R:E", "inner_proj_dome_R:E"],   # neckBottomR
        ["proj_dome_R:S", "inner_proj_dome_R:S"],   # BR
        ["proj_dome_L:E", "inner_proj_dome_L:E"],   # BL
        ["proj_dome_L:S", "inner_proj_dome_L:S"],   # neckBottomL
        ["proj_neck_L:E", "inner_proj_neck_L:E"],   # topL
    ],
    "surround": "surround_rect",                           # p03_05
    "bars": [dict(b) for b in FRAME_BARS],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). All 3 seeded:
# no template param sets the outline's own shape (the phases leave it to the seeds,
# p02_02_loop.py), so moving the seeds IS setting it -- no parameter (same convention as every
# other hand-built template's own seeded handles).
#   topWidth:        T84 item 4 (Fred-approved): the neck's own half-span, a fraction of hw --
#                    shared key with Templates 14/16/17 (fb_engine/t15_flask_geometry.py's own
#                    TOP_WIDTH_FRAC_DEFAULT): the neck is dead straight for its whole height, so
#                    "neck width" and "topWidth" are the SAME physical quantity (Fred, 2026-10-03).
#   neckHeightFrac:  how far down the neck extends before the dome starts (0=top edge, 1=base
#                    edge); basis "h", matching Template 14's own pinchHeightFrac / Template 16's
#                    own waistHeightFrac sign convention.
#   domeFullnessFrac: the dome's own outward sagitta, a fraction of hw -- generalises the "vertical
#                    tangent at base" construction the advisor's own approved render used (zero free
#                    parameters) into a genuine handle around that construction's own implied
#                    default (fb_engine/t15_flask_geometry.py's own module docstring).
# H23 item 63's own 180-deg undercut guard (outlineHasUndercut) applies to this template's own
# outline same as any other. generateRange MEASURED via a closed-form bisection sweep against this
# module's own is_valid_outline() PLUS the frame_thickness floor every piece must clear (re-measured
# 2026-10-03 after the raw "clean" bisection alone missed a case where a piece dropped under
# frame_thickness before any outline defect appeared -- T14's own pinchReachFrac item-61 lesson,
# re-applied proactively here instead of waiting for a live sweep to catch it), at 3 board sizes
# (6x9/7x9/9x12 -- project_portrait_only), taking the midpoint-to-extreme HALFWAY point, tightest
# across all 3 -- same methodology T14/T16/T17's own generateRange comment describes.
FRAME_HANDLES = [
    {"key": "topWidth",          "label": "Top width",     "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.365, "max": 0.48}},
    {"key": "neckHeightFrac",    "label": "Neck height",   "basis": "h",  "binding": "seeded",
     "generateRange": {"min": 0.27, "max": 0.62}},
    {"key": "domeFullnessFrac",  "label": "Dome fullness", "basis": "hw", "binding": "seeded",
     "generateRange": {"min": 0.082, "max": 0.151}},
]
# T15 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the
# app's flask order: 0 neck_R .. 5 top, this template_data.py's own _OUTLINE order).
# "reverse" flags are a FIRST GUESS (each primitive assumed to run the SAME direction as sketch
# 2's own :S->:E in DECLARED point order, p02_02_loop.py) and MUST be checked against a real
# seed-geometry test (tests/frame-seed-geometry.test.js) once the app-side solver exists -- NOT YET
# WRITTEN for this template (same honest gap T7/T14/T16's own copy of this comment flags for itself).
FRAME_SEED_MAP = [
    {"id": "neck_R", "kind": "line", "prim": 0, "reverse": False},
    {"id": "dome_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "base",   "kind": "line", "prim": 2, "reverse": False},
    {"id": "dome_L", "kind": "arc",  "prim": 3, "reverse": False},
    {"id": "neck_L", "kind": "line", "prim": 4, "reverse": False},
    {"id": "top",    "kind": "line", "prim": 5, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 6 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. No base template to derive it from (T15 is new) -- a PROVISIONAL model
# of its own, same as Template 6/7/8/9/14/16's own precedent: the template's own tested default
# proportions (fb_engine/t15_flask_geometry.py's own *_DEFAULT constants - DRY, not re-typed here).
FRAME_SHAPE_EXTRACTOR = "flask"
FRAME_PROVISIONAL_SHAPE = {
    "topWidthFracOfHw": TOP_WIDTH_FRAC_DEFAULT,
    "neckHeightFracOfH": NECK_HEIGHT_FRAC_DEFAULT,
    "domeFullnessFracOfHw": DOME_FULLNESS_FRAC_DEFAULT,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 15 (Flask). Standardized to Inches at the
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
