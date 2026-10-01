import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t11_geometry import (
    inner_corner_directions, WAIST_REACH_DEFAULT, CORNER_RADIUS_DEFAULT, WAIST_CENTER_Y_FRAC_DEFAULT,
)

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

TEMPLATE_NAME = "Template 11 - Hourglass Roof"
TEMPLATE_DESCRIPTION = ("A 90-degree gable roof (Template 7's own roof/eave) over a 3-arc hourglass "
                        "pinch side (Template 1's own shoulder/waist/hip construction) and a straight "
                        "base (5 mitered bars) - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    # Inches throughout to match the rest of the user-facing UI; Fusion
    # stores cm internally (createByString honours the "in" suffix).
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    # The trim offset: the gap between the board edge and the frame's outer
    # perimeter. Not ReadOnly, like every other template's own bbox border:
    # the resolver writes the sent value on every build, like frame_thickness.
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # No ck_* gates: like Template 7, every constraint here is load-bearing for the one
    # tangent-chain solve, and a gate would be a new template parameter.
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
# T11 HOURGLASS ROOF: 5 bars (roof_left, roof_right, side_left, side_right, base, same division as
# Template 7's own 5-bar layout). It declares its CORNER list and its BAR list (N-BAR, regions["corners"]
# / regions["bars"]); the miters, the inner-corner table (p03_03) and the bars' body names all follow
# from them, same as Template 7/6.
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "diamondTopHourglassPinch"   # NOT YET REGISTERED in editor-shape-lattice-generator.js -- app-side wiring is this template's own next piece of work, same as Template 7's own Turn 207/208.
# The outline, clockwise from the peak (p03_01; the app's primitives 0..12).
_OUTLINE = ['proj_roof_R', 'proj_eave_straight_R', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R',
            'proj_side_straight_R', 'proj_bottom_edge',
            'proj_side_straight_L', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L',
            'proj_eave_straight_L', 'proj_roof_L']

# Default-state corner directions/distances (7x9, bbo 0.25, thickness 0.75 - SKETCH_1/3_PARAMETERS'
# own "Val" defaults), computed from the SAME tested fb_engine functions p03_03_inner_corner_resolve.py
# calls live - documentary here (see that phase file's own docstring for the authoritative,
# live-recomputed values; this module-load-time snapshot is what gen_frame_defs.py / A/B see when
# no ui_data is supplied).
_DEF_W, _DEF_H, _DEF_T, _DEF_BBO = 7.0, 9.0, 0.75, 0.25
_def_corners = inner_corner_directions(_DEF_W - 2 * _DEF_BBO, _DEF_H - 2 * _DEF_BBO, _DEF_T)
_eave_dir, _eave_dist = _def_corners['eave_R']

# One corner per outline piece: where that piece starts (its :S end). `direction` = the (unit-vector)
# inward direction to the inner corner (inner_corners.py); `reflex` = none here (T11 has no inside/
# 270-degree corners, same as Template 7).
FRAME_CORNERS = [
    {"id": "peak",   "curve": "proj_roof_R",          "direction": [0.0, -1.0],                   "reflex": False},
    {"id": "eave_R", "curve": "proj_eave_straight_R",  "direction": [_eave_dir[0], _eave_dir[1]],  "reflex": False},
    {"id": "base_R", "curve": "proj_bottom_edge",      "direction": [-1.0, 1.0],                   "reflex": False},
    {"id": "base_L", "curve": "proj_side_straight_L",  "direction": [1.0, 1.0],                    "reflex": False},
    {"id": "eave_L", "curve": "proj_roof_L",           "direction": [-_eave_dir[0], _eave_dir[1]], "reflex": False},
]
# One bar per side (the eave-straight + shoulder + waist + hip + side-straight quintet is ONE bar -
# they are TANGENT joins, not miters, see fb_engine/t11_geometry.py's own module docstring). Body names
# start with "frame_" (the CAM builder's frame-body rule) and none is a Template 1 name, so CAM takes
# its N-bar layout path.
FRAME_BARS = [
    {"name": "frame_roof_right", "curves": ["proj_roof_R"]},
    {"name": "frame_side_right", "curves": ["proj_eave_straight_R", "proj_arc_shoulder_R", "proj_arc_waist_R", "proj_arc_hip_R", "proj_side_straight_R"]},
    {"name": "frame_base",       "curves": ["proj_bottom_edge"]},
    {"name": "frame_side_left",  "curves": ["proj_side_straight_L", "proj_arc_hip_L", "proj_arc_waist_L", "proj_arc_shoulder_L", "proj_eave_straight_L"]},
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
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). T11 reuses
# Template 1's own hourglass side VERBATIM (fb_engine/t11_geometry.py's own module docstring), so its
# handle set matches Template 1's own 5 hourglass handles exactly, same keys
# (editor-shape-lattice-generator.js's own PARAM_ORDER.hourglass) -- NOT YET WIRED there, same
# forward-declared status as FRAME_SILHOUETTE_PRESET above. All 5 seeded: no template param sets the
# shoulder/waist/hip shape (the phases leave it to the seeds, p02_02_loop.py), so moving the seeds IS
# setting it -- no parameter (same convention as Template 7's own 3 seeded handles).
FRAME_HANDLES = [
    {"key": "waistReach",         "label": "Waist reach",     "basis": "hw", "binding": "seeded"},
    {"key": "cornerRadiusTop",    "label": "Shoulder",        "basis": "hw", "binding": "seeded"},
    {"key": "cornerRadiusBottom", "label": "Hip",              "basis": "hw", "binding": "seeded"},
    {"key": "waistCenterY",       "label": "Waist position",  "basis": "hh", "binding": "seeded"},
    {"key": "waistRadius",        "label": "Waist radius",    "basis": "hw", "binding": "seeded"},
]
# T11 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the app's
# diamondTopHourglassPinch order: 0 roof_R .. 12 roof_L, this template_data.py's own _OUTLINE order).
# Its own "reverse" flags are a first guess (each primitive assumed to run the SAME direction as
# sketch 2's own :S->:E) and must be checked against a real seed-geometry test
# (tests/frame-seed-geometry.test.js, as every other template's orientation is checked there) -
# NOT YET WRITTEN for this template, same as Template 7's own first pass (see that template's
# LIVE_CHECK.md entry).
FRAME_SEED_MAP = [
    {"id": "roof_R",          "kind": "line", "prim": 0,  "reverse": False},
    {"id": "eave_straight_R", "kind": "line", "prim": 1,  "reverse": False},
    {"id": "arc_shoulder_R",  "kind": "arc",  "prim": 2,  "reverse": False},
    {"id": "arc_waist_R",     "kind": "arc",  "prim": 3,  "reverse": False},
    {"id": "arc_hip_R",       "kind": "arc",  "prim": 4,  "reverse": False},
    {"id": "side_straight_R", "kind": "line", "prim": 5,  "reverse": False},
    {"id": "bottom_edge",     "kind": "line", "prim": 6,  "reverse": False},
    {"id": "side_straight_L", "kind": "line", "prim": 7,  "reverse": False},
    {"id": "arc_hip_L",       "kind": "arc",  "prim": 8,  "reverse": False},
    {"id": "arc_waist_L",     "kind": "arc",  "prim": 9,  "reverse": False},
    {"id": "arc_shoulder_L",  "kind": "arc",  "prim": 10, "reverse": False},
    {"id": "eave_straight_L", "kind": "line", "prim": 11, "reverse": False},
    {"id": "roof_L",          "kind": "line", "prim": 12, "reverse": False},
    {"id": "seed_rad_shoulder_R", "kind": "radius", "prim": 2},
    {"id": "seed_rad_waist_R",    "kind": "radius", "prim": 3},
    {"id": "seed_rad_hip_R",      "kind": "radius", "prim": 4},
    {"id": "seed_rad_hip_L",      "kind": "radius", "prim": 8},
    {"id": "seed_rad_waist_L",    "kind": "radius", "prim": 9},
    {"id": "seed_rad_shoulder_L", "kind": "radius", "prim": 10},
]
# N-BAR: the common features (bars + trim) with this template's 5 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. Fitted from recorded goldens by the diamond_top_hourglass_pinch extractor
# once it (and they) exist -- NOT YET WRITTEN, same forward-declared status as FRAME_SILHOUETTE_PRESET
# above. Until then a PROVISIONAL model of its own: the template's own tested default proportions
# (fb_engine/t11_geometry.py WAIST_REACH_DEFAULT etc. - DRY, not re-typed here). `waistRadiusOfHw` is
# not a literal constant in t11_geometry.py (it's DERIVED, `_waist_radius_frac`) -- baked here as the
# already-collapsed value at these literal defaults (0.33, see p02_02_loop.py's own docstring for the
# derivation), matching what a user who never drags the waist-radius handle actually gets.
FRAME_SHAPE_EXTRACTOR = "diamond_top_hourglass_pinch"
FRAME_PROVISIONAL_SHAPE = {
    "waistReachOfHw": WAIST_REACH_DEFAULT,
    "cornerRadiusTopOfHw": CORNER_RADIUS_DEFAULT,
    "cornerRadiusBottomOfHw": CORNER_RADIUS_DEFAULT,
    "waistCenterYOfHh": WAIST_CENTER_Y_FRAC_DEFAULT,
    "waistRadiusOfHw": 0.33,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 11 (Hourglass Roof). Standardized to Inches at the
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
