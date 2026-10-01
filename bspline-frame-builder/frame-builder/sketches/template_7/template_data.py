import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t7_geometry import (t7_outline, NECK_WIDTH_OF_HW_DEFAULT, NECK_HEIGHT_FRAC_DEFAULT,
                                   BODY_FLARE_HEIGHT_FRAC_DEFAULT)
from fb_engine.t7_roof_eave import eave_inner_corner

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

TEMPLATE_NAME = "Template 7 - Diamond-top Hourglass"
TEMPLATE_DESCRIPTION = ("A 90-degree gable roof over an hourglass S-curve side (concave neck, "
                        "convex body) and a straight base (5 mitered bars) - Inches Unified")

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
    # No ck_* gates: T7 has no skeleton pins and no independently-toggleable weld (unlike T1/T8's
    # pinch arcs) - every constraint here is load-bearing for the one S-curve solve, and a gate
    # would be a new template parameter (Fred's rule).
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Static 2.0 in cap, as every other template - the p03_03_inner_corner_resolve phase
        # finds inner corners by computed position, so the tight geometric cap other templates
        # once needed isn't required.
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
# T7 DIAMOND-TOP HOURGLASS: 5 bars (fewer than the classic 4?? no - MORE context-specific than T1's
# 4, like T6's 8): roof_left, roof_right, side_left, side_right, base (amendment 189 in
# .handoff/amendments.tsv, Fred's own markup). It declares its CORNER list and its BAR list
# (N-BAR, regions["corners"] / regions["bars"]); the miters, the inner-corner table (p03_03) and
# the bars' body names all follow from them, same as Template 6.
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "diamondTopHourglass"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the peak (p03_01; the app's primitives 0..8).
_OUTLINE = ['proj_roof_R', 'proj_arc_neck_R', 'proj_arc_body_R', 'proj_side_R', 'proj_bottom_edge',
            'proj_side_L', 'proj_arc_body_L', 'proj_arc_neck_L', 'proj_roof_L']

# Default-state corner directions/distances (7x9, bbo 0.25, thickness 0.75 - SKETCH_1/3_PARAMETERS'
# own "Val" defaults), computed from the SAME tested fb_engine functions p03_03_inner_corner_resolve.py
# calls live - documentary here (see that phase file's own docstring for the authoritative,
# live-recomputed values; this module-load-time snapshot is what gen_frame_defs.py / A/B see when
# no ui_data is supplied).
_DEF_W, _DEF_H, _DEF_T, _DEF_BBO = 5.51, 1.97, 0.75, 0.25
_def_outline = t7_outline(_DEF_W - 2 * _DEF_BBO, _DEF_H - 2 * _DEF_BBO, _DEF_T)
_eave_dir, _eave_dist, _ = eave_inner_corner(_DEF_W - 2 * _DEF_BBO, _DEF_H - 2 * _DEF_BBO, _DEF_T,
                                             _def_outline["C_neck"], _def_outline["r_neck"])

# One corner per outline piece: where that piece starts (its :S end). `direction` = the (unit-vector)
# inward direction to the inner corner (inner_corners.py); `reflex` = none here (T7 has no inside/
# 270-degree corners, unlike Template 6's tab).
FRAME_CORNERS = [
    {"id": "peak",   "curve": "proj_roof_R",     "direction": [0.0, -1.0],              "reflex": False},
    {"id": "eave_R", "curve": "proj_arc_neck_R", "direction": [_eave_dir[0], _eave_dir[1]],   "reflex": False},
    {"id": "base_R", "curve": "proj_bottom_edge","direction": [-1.0, 1.0],              "reflex": False},
    {"id": "base_L", "curve": "proj_side_L",     "direction": [1.0, 1.0],               "reflex": False},
    {"id": "eave_L", "curve": "proj_roof_L",     "direction": [-_eave_dir[0], _eave_dir[1]],  "reflex": False},
]
# One bar per side (the neck+body+line triple is ONE bar - they are TANGENT joins, not miters, see
# fb_engine/t7_geometry.py's own module docstring). Body names start with "frame_" (the CAM
# builder's frame-body rule) and none is a Template 1 name, so CAM takes its N-bar layout path.
FRAME_BARS = [
    {"name": "frame_roof_right", "curves": ["proj_roof_R"]},
    {"name": "frame_side_right", "curves": ["proj_arc_neck_R", "proj_arc_body_R", "proj_side_R"]},
    {"name": "frame_base",       "curves": ["proj_bottom_edge"]},
    {"name": "frame_side_left",  "curves": ["proj_side_L", "proj_arc_body_L", "proj_arc_neck_L"]},
    {"name": "frame_roof_left",  "curves": ["proj_roof_L"]},
]
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c['curve']}:S", f"inner_{c['curve']}:S"] for c in FRAME_CORNERS],  # p03_04 Source -> Target
    "surround": "surround_rect",                           # p03_05
    "corners": [dict(c, outer=f"{c['curve']}:S", inner=f"inner_{c['curve']}:S") for c in FRAME_CORNERS],
    "bars": [dict(b) for b in FRAME_BARS],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). All 3 seeded:
# no template param sets the neck/body shape (the phases leave it to the seeds, p02_02_loop.py), so
# moving the seeds IS setting it -- no parameter (same convention as Template 6's tab handles).
# Keys match editor-shape-lattice-generator.js's own PARAM_ORDER.diamondTopHourglass exactly (the
# app-side JS param names, not the Python-side provisional-shape argument names, which carry an
# OfHw/OfHh suffix convention of their own -- test_frame_defs.py's own
# test_every_handle_binding_is_declared_and_valid enforces this match). "gableNeckWidth", not the
# plain "neckWidth" Template 2's own bottle preset already owns: FRAME_ONLY_PARAM_KEYS and the
# manifest's own exclusion filter (editor-sketch-manifest.js) key by bare param NAME across every
# preset, not per-preset, so a bare "neckWidth" here would have silently excluded bottle's own real
# "neckWidth" parameter from the Fusion manifest too (caught live by
# tests/editor-sketch-manifest.test.js's own manifestFromShape(bottle) parameter-count check).
#   gableNeckWidth: the neck's own half width (centre line -> neck), a fraction of hw.
#   neckHeight:     how far down from the eave the neck sits, a fraction of the run below the eave.
#   bodyFlareHeight: how far down from the eave the body reaches full width, same fraction basis.
FRAME_HANDLES = [
    {"key": "gableNeckWidth",  "label": "Neck width",        "basis": "hw", "binding": "seeded"},
    {"key": "neckHeight",      "label": "Neck height",       "basis": "hh", "binding": "seeded"},
    {"key": "bodyFlareHeight", "label": "Body flare height", "basis": "hh", "binding": "seeded"},
]
# T7 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the
# app's diamondTopHourglass order: 0 roof_R .. 8 roof_L, this template_data.py's own _OUTLINE
# order, matching _solveDiamondTopHourglass's own doc comment in editor-shape-lattice-generator.js).
# Its own "reverse" flags are a first guess (each primitive assumed to run the SAME direction as
# sketch 2's own :S->:E) and must be checked against a real seed-geometry test
# (tests/frame-seed-geometry.test.js, as every other template's orientation is checked there) -
# NOT YET WRITTEN for this template, see LIVE_CHECK.md.
FRAME_SEED_MAP = [
    {"id": "roof_R",     "kind": "line", "prim": 0, "reverse": False},
    {"id": "arc_neck_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "arc_body_R", "kind": "arc",  "prim": 2, "reverse": False},
    {"id": "side_R",     "kind": "line", "prim": 3, "reverse": False},
    {"id": "bottom_edge","kind": "line", "prim": 4, "reverse": False},
    {"id": "side_L",     "kind": "line", "prim": 5, "reverse": False},
    {"id": "arc_body_L", "kind": "arc",  "prim": 6, "reverse": False},
    {"id": "arc_neck_L", "kind": "arc",  "prim": 7, "reverse": False},
    {"id": "roof_L",     "kind": "line", "prim": 8, "reverse": False},
    {"id": "seed_rad_neck_R", "kind": "radius", "prim": 1},
    {"id": "seed_rad_body_R", "kind": "radius", "prim": 2},
    {"id": "seed_rad_body_L", "kind": "radius", "prim": 6},
    {"id": "seed_rad_neck_L", "kind": "radius", "prim": 7},
]
# N-BAR: the common features (bars + trim) with this template's 5 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. Fitted from recorded goldens by the diamond_top_hourglass extractor once
# they exist (LIVE_CHECK.md); until then a PROVISIONAL model of its own (no base template to derive
# it from, like Template 6/8/9): the template's own tested default proportions
# (fb_engine/t7_geometry.py NECK_WIDTH_OF_HW_DEFAULT etc. - DRY, not re-typed here).
FRAME_SHAPE_EXTRACTOR = "diamond_top_hourglass"
FRAME_PROVISIONAL_SHAPE = {
    "neckWidthOfHw": NECK_WIDTH_OF_HW_DEFAULT,
    "neckHeightOfHh": NECK_HEIGHT_FRAC_DEFAULT,
    "bodyFlareOfHh": BODY_FLARE_HEIGHT_FRAC_DEFAULT,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 7 (Diamond-top Hourglass).
    Standardized to Inches at the schema level (see Template 1). Sketches
    and their phases are discovered by ``TemplateLoader``; UI metadata
    is stamped onto each sketch dict here.
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
