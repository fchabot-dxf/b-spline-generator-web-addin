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

TEMPLATE_NAME = "Template 20 - Trapezoid"
TEMPLATE_DESCRIPTION = ("Four straight mitred bars, the top and bottom parallel, the narrow side up or down, "
                        "each of its ends set in on its own - Inches Unified")

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
    # No ck_* gates and no shape parameter (Fred's rule: no new parameters): every constraint is needed for the
    # 4-DOF solve (p02_04), and the narrow side's two ends plus Up/Down are left to the seeds, like Template 6's tab.
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Same declaration as every straight-bar template (T6/T9): the
        # p03_03 phase finds the inner corners by computed position (the
        # true offset-line intersection here), so the miters fire at any
        # thickness in range. Min 0.25 in (a cast jesmonite wall floor).
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
    # 'frame_height_offset' user parameter (the Solid Builder palette's
    # Start Offset); no sketch geometry reads it, so it is not declared here.
]


# ---------------------------------------------------------------------------
# FB-APP S1: this template's frame declaration (frame-defs.json for the app, the extruder from S6).
# T20 TRAPEZOID (Fred 2026-11-22: "a simple trapezoid frame template, possible to set narrow side up or down
# simply"; amended the same day: "irregular taper sides too"): 4 straight bars, 4 corners, none reflex. It
# declares its CORNER and BAR lists like Template 6 (N-BAR), so the miters, the inner-corner table (p03_03) and the
# bar body names all follow from them.
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "trapezoid"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-left corner (p03_01; the app's trapezoid primitive order 0..3).
_OUTLINE = ['proj_top_edge', 'proj_side_R', 'proj_bottom_edge', 'proj_side_L']
# One corner per outline piece: where that piece starts (its :S end). `direction` = the axis-aligned inward
# (dx, dy) fallback (inner_corners.py; Fusion y up) -- p03_03 declares the two lines' far ends, so the real inner
# corner is the true offset-line intersection at any angle.
FRAME_CORNERS = [
    {"id": "TL", "curve": "proj_top_edge",    "direction": [1, -1],  "reflex": False},
    {"id": "TR", "curve": "proj_side_R",      "direction": [-1, -1], "reflex": False},
    {"id": "BR", "curve": "proj_bottom_edge", "direction": [-1, 1],  "reflex": False},
    {"id": "BL", "curve": "proj_side_L",      "direction": [1, 1],   "reflex": False},
]
# One bar per outline piece, in miter order (each miter starts a bar). Body names follow the BAR NAMING rule
# (fb_engine/frame_definition.py BAR_NAME_RULE): the classic four.
FRAME_BARS = [
    {"name": "frame_top",    "curves": ["proj_top_edge"]},
    {"name": "frame_right",  "curves": ["proj_side_R"]},
    {"name": "frame_bottom", "curves": ["proj_bottom_edge"]},
    {"name": "frame_left",   "curves": ["proj_side_L"]},
]
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c['curve']}:S", f"inner_{c['curve']}:S"] for c in FRAME_CORNERS],  # p03_04 Source -> Target
    "surround": "surround_rect",                           # p03_05
    "corners": [dict(c, outer=f"{c['curve']}:S", inner=f"inner_{c['curve']}:S") for c in FRAME_CORNERS],
    "bars": [dict(b) for b in FRAME_BARS],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). All seeded: no template param
# sets the shape (the phases leave the 4 corner x values to the seeds, p02_04), so moving the seeds IS setting it.
#   leftInset / rightInset: how far the narrow side's left / right end sits in from the wide side's corner, a
#       fraction of hw like every other seeded handle (0.3 = 15% of the wide side). Each its own value (Fred's
#       amendment: irregular taper sides); 0 = that side vertical. A position square on each narrow end.
#   insetLink: the Symmetric link (1 = on, the default: a write of one inset writes the other too). Not a shape
#       value: it only couples the two writes (editor/frame-handles.js linkedSeedPatch).
#   narrowSide: 1 = the narrow side UP (the default), -1 = DOWN. The same insets, mirrored top to bottom.
# `control` (T20, the declared Frame-panel control a handle shows besides / instead of its square, read by
# main/frame-panel.js -- every other template declares none, so its panel is unchanged): a slider shows the value
# times `scale` (fraction of hw -> % of the wide side) over its travel `min`..`max` (travel only, no clamp: the
# app's declared feasible range is the same 0..0.9 hw); a check / switch writes the listed values. `generateRange`
# (H23 item 40's own mechanism): [Generate] draws the insets in 0..30% only -- a drag or the slider still reaches 45%.
# `stopBeforeOverlap` -- Fred-approved clamp, 2026-11-22: "Stop just before overlap". The slider's END moves with the
# board and the frame: it stops at the largest inset Generate's own check still passes (the narrow side's two mitres
# just short of colliding; editor/editor-frame-profile.js frameSeedSafeMax). A saved value past it is kept as it is.
_SLIDER = {"kind": "slider", "unit": "%", "scale": 50, "min": 0, "max": 45, "step": 1, "stopBeforeOverlap": True}
FRAME_HANDLES = [
    {"key": "leftInset",  "label": "Left inset",  "basis": "hw", "binding": "seeded",
     "control": dict(_SLIDER), "generateRange": {"min": 0.0, "max": 0.6}},
    {"key": "rightInset", "label": "Right inset", "basis": "hw", "binding": "seeded",
     "control": dict(_SLIDER), "generateRange": {"min": 0.0, "max": 0.6}},
    {"key": "insetLink",  "label": "Symmetric",   "basis": "hw", "binding": "seeded",
     "control": {"kind": "check", "default": 1, "links": ["leftInset", "rightInset"]}},
    {"key": "narrowSide", "label": "Narrow side", "basis": "hh", "binding": "seeded",
     "control": {"kind": "switch", "default": 1, "options": [{"value": 1, "label": "Up"}, {"value": -1, "label": "Down"}]}},
]
# T20 is new: no record was ever saved before, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the app's trapezoid
# order, identical to the Fusion piece order above: every piece runs clockwise from the top-left, so nothing is
# reversed). Up and Down use the same 4 lines: only their positions differ.
FRAME_SEED_MAP = [
    {"id": "top_edge",    "kind": "line", "prim": 0, "reverse": False},
    {"id": "side_R",      "kind": "line", "prim": 1, "reverse": False},
    {"id": "bottom_edge", "kind": "line", "prim": 2, "reverse": False},
    {"id": "side_L",      "kind": "line", "prim": 3, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 4 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. Fitted from recorded goldens by the trapezoid extractor once they exist (a live Fusion
# session, tools/repro/record_frame_parity.py); until then a PROVISIONAL model of its own (no base template, like
# Template 6): each narrow end 0.3 x hw in (15% of the wide side, i.e. a 70% narrow side; Fred's own example
# default). Up / Down is not a model feature (a switch, not a size): its default (Up) is the app's declared
# DERIVED_PARAM_DEFAULTS.trapezoid.narrowSide, the same Up this template's own literal seeds build.
FRAME_SHAPE_EXTRACTOR = "trapezoid"
FRAME_PROVISIONAL_SHAPE = {"leftInsetOfHw": 0.3, "rightInsetOfHw": 0.3}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 20 (Trapezoid).
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
            "hidden": False,
        },
    }
