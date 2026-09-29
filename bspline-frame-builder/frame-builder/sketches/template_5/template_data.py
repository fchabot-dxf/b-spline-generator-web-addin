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

TEMPLATE_NAME = "Template 5 - Hourglass Dipped Top"
TEMPLATE_DESCRIPTION = "Hourglass with a smooth dip in the middle of the top edge - Inches Unified"

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
# T5 HOURGLASS DIPPED TOP (Template 1 with the top edge dipped in the middle; base flat, sides and square corners
# as Template 1): the flat top edge becomes FIVE pieces, clockwise from the top-left corner: a straight stub
# (top_edge_L), a convex shoulder arc, the concave dip arc, a convex shoulder arc, a straight stub (top_edge_R)
# into the top-right corner, so 16 pieces in all. The app draws it with the SAME hourglass construction plus the
# frame-only `topDipWidth` / `topDipDepth` params (editor-shape-lattice-generator.js hourglassConstruction
# `topDip`: the three top arcs share one radius). The corners stay square with a straight stub on both legs, so
# the four mitered bars keep clean 45 deg miters; the top bar (frame_top) is one curved bar.
_OUTLINE = ['proj_top_edge_L', 'proj_arc_top_shoulder_L', 'proj_arc_top_dip', 'proj_arc_top_shoulder_R',
            'proj_top_edge_R', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL']
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c}:S", f"inner_{c}:S"] for c in     # p03_04 Source -> Target (T5: TL = the left stub's start)
               ("proj_top_edge_L", "proj_horn_TR", "proj_bottom_edge", "proj_horn_BL")],
    "surround": "surround_rect",                           # p03_05
}
# FB-APP F9: the frame shape HANDLES, the ONE binding table (the app's Frame tab
# reads it from frame-defs.json; S5's [Send frame] will too). Each handle drags
# one of the app's shape params (editor-shape-lattice-generator.js PARAM_ORDER
# key), a fraction of `basis`: the safe zone's half width "hw", half height
# "hh", or full height "h".
#   binding "seeded": no existing template param controls this feature (the
#     shape comes from the literal seeds in phases/p02_*), so the dragged value
#     lives in the frame record's `seeds`, and [Send frame] writes it into the
#     sketch as a plain value: no user parameter is ever created.
#   binding {"param": "<name>"}: an EXISTING template param, only once per-value
#     goldens prove the preview matches Fusion (FB-APP-DESIGN.md §3.2).
FRAME_HANDLES = [
    {"key": "waistReach",   "label": "Waist reach",     "basis": "hw", "binding": "seeded"},
    # F20 SHOULDER-HIP (Fred: "two different handles for shoulder and hip"): the corners are seeded
    # separately. MEASURED live (Ranchy, 7x9, shoulder 0.15 / hip 0.45 and reversed): no constraint
    # ties them (p02_10 welds each arc to its OWN skeleton pin; p02_11 Equal is L/R only), the
    # seeds hold to 4e-5 in, no new parameter.
    {"key": "cornerRadiusTop",    "label": "Shoulder", "basis": "hw", "binding": "seeded"},
    {"key": "cornerRadiusBottom", "label": "Hip",      "basis": "hw", "binding": "seeded"},
    {"key": "waistCenterY", "label": "Waist position",  "basis": "hh", "binding": "seeded"},
    # F27 item 2 (Fred, Frame tab, Hourglass: the waist's arc radius "can never be set anywhere, it
    # needs a handle"): the waist arc's own radius, a RADIUS handle ON the arc (the app's
    # editor-shape-lattice-interaction.js catalogue). No template param sets the waist radius (the
    # phases seed it: seed_rad_waist_R/L + the arc_waist_R/L seed arcs, FRAME_SEED_MAP below), so it
    # is seeded like the others (Fred's ruling: no new Fusion parameter unless allowed).
    {"key": "waistRadius",  "label": "Waist radius",    "basis": "hw", "binding": "seeded"},
    # T5: the top dip. Its depth below the top edge (fraction of hh; a position square at the dip's lowest point)
    # and its half width (centre line -> where the straight stub from each corner ends, fraction of hw; a
    # position square there). Seeded like the others: the phases leave the dip's size to the seeds (p02_03: the
    # stubs only lie flat on the top line from the corners; p02_06 / p02_11 keep it symmetric), so moving the
    # seeds IS setting it -- no parameter.
    {"key": "topDipDepth",  "label": "Top dip depth",   "basis": "hh", "binding": "seeded"},
    {"key": "topDipWidth",  "label": "Top dip width",   "basis": "hw", "binding": "seeded"},
]
# T5 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}

# FB-APP F11 (option B, Fred: "simply seed it in position"): where each of
# this template's shape-outline SEEDS comes from when the app sends seeded
# handles: the app's own solved outline (editor-shape-lattice-generator
# primitive `prim`, the order frameCutProfile returns). No dimension and no
# parameter is added: only the seed geometry the phases already declare moves.
#   kind "line": Points [S, E] = the primitive's ends ("reverse": E, S)
#   kind "arc":  Points [S, mid, E] (Arc3Point) = the primitive's ends + its
#                on-arc midpoint ("reverse" swaps S and E; T5 "nudgeX": every point
#                moved that many inches in +x)
#   kind "pin":  a skeleton pin: its `outer` end ("S"|"E") = the arc centre,
#                the inner end on the Y axis at that height
#   kind "radius": a temporary seed radius dim (deleted later by the phases)
#                  = the primitive's radius
# Orientation is checked against the template's own literal seeds
# (tests/frame-seed-geometry.test.js).
FRAME_SEED_MAP = [
    # T5: the dipped top, app primitives 11..15 (left stub, left top shoulder, dip, right top shoulder, right stub)
    {"id": "top_edge_L",         "kind": "line", "prim": 11, "reverse": False},
    {"id": "arc_top_shoulder_L", "kind": "arc",  "prim": 12, "reverse": False},
    # the dip's centre lands ON the Y axis; `nudgeX` (in) moves its seed points off it by the pins' own
    # anti-auto-coincidence nudge (PIN_AXIS_NUDGE_IN), p02_06 then puts the centre on the axis explicitly
    {"id": "arc_top_dip",        "kind": "arc",  "prim": 13, "reverse": False, "nudgeX": 0.01},
    {"id": "arc_top_shoulder_R", "kind": "arc",  "prim": 14, "reverse": False},
    {"id": "top_edge_R",         "kind": "line", "prim": 15, "reverse": False},
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
    {"id": "seed_rad_top_shoulder_L", "kind": "radius", "prim": 12},
    {"id": "seed_rad_top_dip",        "kind": "radius", "prim": 13},
    {"id": "seed_rad_top_shoulder_R", "kind": "radius", "prim": 14},
]
FRAME_FEATURES = COMMON_FRAME_FEATURES
# F8: the app shape is a MODEL fitted from the recorded Fusion goldens (fb_engine/frame_shape_fit.py, run by
# tools/gen_frame_defs.py). T5: fitted with the dipped-top extractor (the sides as Template 1's + the dip's half
# width and depth); until its goldens are recorded live (LIVE_CHECK.md) the app gets a PROVISIONAL model instead
# (Template 1's fitted model + a dip topDipDepthOfHh x hh deep, topDipHalfWidthOfHw x hw half wide), never none.
FRAME_SHAPE_EXTRACTOR = "hourglass_dipped_top"
FRAME_PROVISIONAL_SHAPE = {"from": "template_1", "topDipDepthOfHh": 0.14, "topDipHalfWidthOfHw": 0.72}  # 7x9: 0.6 in deep, 0.91 in stubs


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 5 (Hourglass Dipped Top).
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
