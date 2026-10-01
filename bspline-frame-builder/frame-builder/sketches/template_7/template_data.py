import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
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

TEMPLATE_NAME = "Template 7 - Diamond-top Hourglass"
TEMPLATE_DESCRIPTION = "Hourglass with a 90 degree diamond peak instead of a flat top - Inches Unified"

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 5.51, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 1.97, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
SKETCH_2_PARAMETERS = [
    # Same constraint-toggle set as Template 1 (the sides/waist/hip are unchanged); the roof/peak has no
    # toggle of its own -- its only two constraints (Horizontal/Vertical on the 45-45-90 construction pair,
    # the Equal pinning the apex) are never optional.
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
# FB-APP S1: this template's frame declaration (frame-defs.json for the app, the extruder from S6).
# T7 DIAMOND-TOP HOURGLASS. ORIGINAL spec (Fred, HANDOFF-ranchy.md section 5): "A 90 deg diamond peak (45 deg
# miters), pinched waist, round hips, flat base." REVISED by Fred's own reference sketch (T82 item 1 REFERENCE
# amendment, template_sketches_2026-09-30.jpg, bottom-right): "a 90 deg diamond peak (two straight roof bars),
# a short horizontal ledge where each roof bar meets the side, then the pinched waist, then hips that FLARE
# OUTWARD down to a wider flat base (bell-like: the base is wider than the shoulders)." The waist/hip/shoulder-
# ARC geometry itself is still Template 1's OWN, unchanged; the flat top edge becomes a ledge + roof + peak +
# roof + ledge (see editor-shape-lattice-generator.js's own `topPeak` doc comment), and the hip/base widens via
# `hipFlare` (the SAME `side()` tangency algebra as `topInset`, negated -- see hourglassConstruction's own doc
# comment). Declares its own CORNER and BAR list (N-BAR, regions["corners"] / regions["bars"], fd82744) like
# Template 6; Templates 1-5 keep the 4-bar default.
#
# *** THE BOARD-OVERFLOW BUG, FOUND AND FIXED, NOT JUST DISCLOSED: *** the first build of this template (before
# the reference sketch arrived) put the peak's own rise ABOVE the safe zone's nominal top edge (rise = run =
# the horn's own half-width) -- Fred saw this live (a phone screenshot of the app's own 3D preview, T82 item 1
# amendment: "the diamond roof bars run above the board edge"). FIXED by pinning the peak to the safe zone's
# own top edge (Y = -hhDrawn, exactly like every other template's topmost point) and having the roof's own rise
# eat INTO the horn's existing length instead of extending past it (_solveHourglass's own `topEdgeY`) -- a
# WIDER board (shorter horn) therefore needs a WIDER ledge to keep the rise small enough to fit; the ledge's
# own range function (editor-shape-lattice-generator.js) enforces this as a geometric floor, not a suggestion.
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "hourglass"   # T7 reuses the hourglass preset (topPeak=1), like T3/T4/T5's own top variants
# The outline, clockwise starting at the right roof bar (p03_01; the app's primitives 13, 14, 0, 1, ..., 12 --
# see FRAME_SEED_MAP). Each curvy side now also carries its own ledge stub (WELDED to the side, not mitered --
# see FRAME_BARS' own doc comment).
_OUTLINE = ['proj_roof_R', 'proj_ledge_R', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R',
            'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L',
            'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_ledge_L', 'proj_roof_L']
# One corner per outline piece: where that piece starts (its :S end). `direction` = the axis-aligned inward
# (dx, dy) to the inner corner (inner_corners.py; Fusion y up) -- EXCEPT the peak, which is NOT axis-aligned
# (both its own legs sit at 45 deg): its own Direction is derived geometrically, not the usual (+-1, +-1) --
# see p03_03_inner_corner_resolve.py's own doc comment for the algebra. All 5 corners are convex (no reflex
# corner in this template, unlike Template 6's tab). `shoulder_R`/`shoulder_L` now sit where the roof meets its
# own LEDGE (not the horn directly any more -- the ledge is welded to the side, see FRAME_BARS) -- direction
# UNCHANGED from before the ledge: the roof still arrives at 45 deg from the same quadrant, only the piece it
# meets there (a horizontal ledge instead of a vertical horn) changed, and the corner's own inward quadrant
# does not depend on which piece continues from it.
FRAME_CORNERS = [
    {"id": "peak",       "curve": "proj_roof_R",      "direction": [0, -2 ** 0.5], "reflex": False},
    {"id": "shoulder_R", "curve": "proj_ledge_R",     "direction": [-1, -1],       "reflex": False},
    {"id": "BR",         "curve": "proj_bottom_edge", "direction": [-1, 1],        "reflex": False},
    {"id": "BL",         "curve": "proj_horn_BL",     "direction": [1, 1],         "reflex": False},
    {"id": "shoulder_L", "curve": "proj_roof_L",      "direction": [1, -1],        "reflex": False},
]
# One bar per outline piece OR contiguous run of pieces, in miter order (each miter starts a bar). Each curvy
# side now spans 6 outline pieces (ledge + horn + 3 arcs + horn) instead of 5 -- the ledge is WELDED to the
# side (same bar), not its own bar: it is a plain horizontal stub cut as part of the SAME piece of stock as the
# horn/arcs, the same way T1's own horn is welded to its shoulder arc rather than being a 6th bar. Body names
# start with "frame_" (the CAM builder's frame-body rule) and match none of the 4 classic names, so CAM takes
# its N-bar row-layout path (mm_builder.py), same as Template 6.
FRAME_BARS = [
    {"name": "frame_roof_right", "curves": ["proj_roof_R"]},
    {"name": "frame_side_right", "curves": ["proj_ledge_R", "proj_horn_TR", "proj_arc_shoulder_R", "proj_arc_waist_R", "proj_arc_hip_R", "proj_horn_BR"]},
    {"name": "frame_base",       "curves": ["proj_bottom_edge"]},
    {"name": "frame_side_left",  "curves": ["proj_horn_BL", "proj_arc_hip_L", "proj_arc_waist_L", "proj_arc_shoulder_L", "proj_horn_TL", "proj_ledge_L"]},
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
# FB-APP F9: the frame shape HANDLES -- IDENTICAL to Template 1's own (the waist/shoulder/hip geometry is
# unchanged; the peak has no handle of its own, see the module doc comment above). T82 item 1 HANDLES (Fred
# approved): "shoulder ledge width, waist reach, waist height, hip flare" -- the shoulder/hip corner RADII and
# the waist radius are no longer their own drag handles for this template (they keep their usual DEFAULTS, see
# DERIVED_PARAM_DEFAULTS.hourglass, just aren't independently exposed here), matching Fred's own approved list
# exactly. See template_1's own table for the binding rules.
FRAME_HANDLES = [
    {"key": "waistReach",         "label": "Waist reach",       "basis": "hw", "binding": "seeded"},
    {"key": "waistCenterY",       "label": "Waist height",      "basis": "hh", "binding": "seeded"},
    {"key": "shoulderLedgeWidth", "label": "Shoulder ledge",    "basis": "hw", "binding": "seeded"},
    {"key": "hipFlare",           "label": "Hip flare",         "basis": "hw", "binding": "seeded"},
]
# T7 is new: no record was ever saved before it existed, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): where each of this template's shape-outline SEEDS comes from -- the app's own solved
# outline, primitive `prim` (editor-shape-lattice-generator.js's own 15-primitive diamond-top order: 0 = right
# horn ... 10 = left horn, 11 = left ledge, 12 = left roof, 13 = right roof, 14 = right ledge, VERIFIED directly
# by calling generateSilhouette({...,params:{topPeak:1}}) and reading back its own keypoints, not assumed).
# IDENTICAL to Template 1 for every unchanged piece (skeleton pins, arcs, the 4 side horns): same prim indices.
FRAME_SEED_MAP = [
    {"id": "roof_R",         "kind": "line", "prim": 13, "reverse": False},
    {"id": "roof_L",         "kind": "line", "prim": 12, "reverse": False},
    {"id": "ledge_R",        "kind": "line", "prim": 14, "reverse": False},
    {"id": "ledge_L",        "kind": "line", "prim": 11, "reverse": False},
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
# N-BAR: the common features (bars + trim) with this template's 5 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: no shape feature of its own to fit/derive -- the sides/waist/hip are Template 1's OWN fitted model
# unchanged, and the peak has no feature (its height is DERIVED, never an independent fitted/provisional
# quantity -- see the module doc comment above). `{"from": "template_1"}` with no extra key asks
# frame_definition.template_shape_model() to return Template 1's own model exactly, once it exists (it
# already does: Template 1 has real recorded goldens).
FRAME_SHAPE_EXTRACTOR = "diamond_top_hourglass"
FRAME_PROVISIONAL_SHAPE = {"from": "template_1"}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 7 (Diamond-top Hourglass).
    Standardized to Inches at the schema level (see Template 1). Sketches
    and their phases are discovered by ``TemplateLoader``; UI metadata is
    stamped onto each sketch dict here.
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
