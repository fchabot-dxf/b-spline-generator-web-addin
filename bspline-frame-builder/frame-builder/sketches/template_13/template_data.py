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

TEMPLATE_NAME = "Template 13 - Narrow Neck - Tapered sides"
TEMPLATE_DESCRIPTION = "Standardized Arc Series - Inches Unified"

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
    # All anatomy/silhouette span and radius sliders (and their en_*
    # lock toggles, plus all ck_* constraint gates) were removed when
    # the drivers phase was retired. Seeds are hardcoded as literal
    # widthIn/heightIn fractions inside the phase files; if you want
    # different proportions, edit the seeds (or regenerate via the
    # template-maker) rather than driving them from the UI.
    #
    # No T2 phase currently consumes a CK gate, so none are declared
    # here either. Re-add them per-template if a phase ever needs a
    # runtime kill-switch.
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Static 2.0 in cap - p03_03_inner_corner_resolve handles
        # the merged-offset regime so the tight geometric cap is no
        # longer required. See template_1's copy for rationale.
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
    # 'frame_height_offset' user parameter (see template_1's copy). No
    # depth parameter is declared here.
]


# ---------------------------------------------------------------------------
# FB-APP S1: this template's frame declaration, read by
# fb_engine.frame_definition.build_frame_defs -> frame-defs.json (the app) and,
# from S6, by the extruder. Region ids are the ones this template's own
# p03_* phases create; test_frame_defs.py fails if any id is missing from the
# blocks (so a renamed curve goes red before Fusion ever runs).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "bottle"   # the app's editor-shape-lattice-generator PRESETS key
_OUTLINE = ['proj_top_edge', 'proj_horn_TR', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_horn_TL']
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c}:S", f"inner_{c}:S"] for c in     # p03_04 Source -> Target
               ("proj_top_edge", "proj_horn_TR", "proj_bottom_edge", "proj_horn_BL")],
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
    {"key": "neckWidth",  "label": "Neck width",        "basis": "hw", "binding": "seeded"},
    {"key": "skeletonX",  "label": "S-curve tightness", "basis": "hw", "binding": "seeded"},
    {"key": "neckLength", "label": "Shoulder height",   "basis": "h",  "binding": "seeded"},
    # F27 item 2 (Fred: an arc radius with no handle "can never be set anywhere"): the body
    # (hip) arc's own radius, a RADIUS handle ON the arc. The neck arc's radius already has one
    # (skeletonX, "S-curve tightness": radius = skeletonX - neckWidth); the body arc had none. No
    # template param sets it (the arc_hip_R/L seed arcs carry it, FRAME_SEED_MAP below): seeded.
    {"key": "bodyRadius", "label": "Body radius",       "basis": "hw", "binding": "seeded"},
    # F30 item 3 (Fred's own taper copies): the "Taper angle" handle (advisor-confirmed, 2026-10-01) lands in a
    # later pass, once the template itself is built and Fusion-verified -- see WORK-LOG-fb-app.md.
]
# FB-APP F11 (option B, Fred: "simply seed it in position"): where each of
# this template's shape-outline SEEDS comes from when the app sends seeded
# handles: the app's own solved outline (editor-shape-lattice-generator
# primitive `prim`, the order frameCutProfile returns). No dimension and no
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
    {"id": "top_edge",    "kind": "line", "prim": 9, "reverse": False},
    {"id": "bottom_edge", "kind": "line", "prim": 4, "reverse": False},
    {"id": "horn_TR",     "kind": "line", "prim": 0, "reverse": False},
    {"id": "horn_BR",     "kind": "line", "prim": 3, "reverse": True},
    {"id": "horn_TL",     "kind": "line", "prim": 8, "reverse": True},
    {"id": "horn_BL",     "kind": "line", "prim": 5, "reverse": False},
    {"id": "arc_waist_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "arc_hip_R",   "kind": "arc",  "prim": 2, "reverse": True},
    {"id": "arc_waist_L", "kind": "arc",  "prim": 7, "reverse": False},
    {"id": "arc_hip_L",   "kind": "arc",  "prim": 6, "reverse": True},
    {"id": "p02_SketchLine",    "kind": "pin", "prim": 1, "outer": "S"},
    {"id": "p02_SketchLine_02", "kind": "pin", "prim": 7, "outer": "E"},
    {"id": "p02_SketchLine_03", "kind": "pin", "prim": 6, "outer": "E"},
    {"id": "p02_SketchLine_04", "kind": "pin", "prim": 2, "outer": "S"},
]
FRAME_FEATURES = COMMON_FRAME_FEATURES
# F8: this template's app shape is a MODEL fitted from the recorded Fusion
# goldens (fb_engine/frame_shape_fit.py, run by tools/gen_frame_defs.py);
# the F6 constant fractions it replaces could not match every board size.

# F30 item 3 (Fred's own taper copies): no recorded Fusion goldens for this template yet -- a PROVISIONAL model
# (fb_engine/frame_shape_fit.provisional_taper_model) built from Template 2's own fitted one, every feature kept
# exactly, plus a new scale-invariant `taperAngle` (degrees; the "from" base's own neck/body tangency is
# otherwise untouched: see editor-shape-lattice-generator.js's own `_taperedCorner` doc comment). Replace with
# the real fit once goldens are recorded and tools/gen_frame_defs.py is re-run.
FRAME_PROVISIONAL_SHAPE = {"from": "template_2", "taperAngleDeg": 8.0}

# F30 item 3: hidden from the template picker until this build is verified live in Fusion (T10's own "no Fusion
# fix yet" precedent, same flag). Flip to False once confirmed; a saved record that already picked this id still
# loads and draws (frame-record.js looks up templates by id over the full list, hidden or not).
FRAME_HIDDEN = True


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 2.
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
            "seedMap": [dict(e) for e in FRAME_SEED_MAP],
            "provisionalShape": dict(FRAME_PROVISIONAL_SHAPE),
            "hidden": FRAME_HIDDEN,
        },
    }
