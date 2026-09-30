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

TEMPLATE_NAME = "Template 6 - Tab Top"
TEMPLATE_DESCRIPTION = "Rectangle with a narrower tab centred on top (8 mitered bars) - Inches Unified"

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
    # No ck_* gates: every T6 constraint is needed for the 2-DOF solve (p02_05_symmetry), and a gate would be a
    # new template parameter (Fred's rule). The tab's size is left to the seeds, like Template 2's.
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
# FB-APP S1: this template's frame declaration (frame-defs.json for the app, the extruder from S6).
# T6 TAB TOP: the first frame with more than 4 bars and with INSIDE corners. It declares its CORNER list and its
# BAR list (N-BAR, regions["corners"] / regions["bars"]); the miters, the inner-corner table (p03_03) and the
# bars' body names all follow from them. Templates 1-5 declare neither and keep the 4-bar default
# (declared_profiles.frame_bars).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "tabTop"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the tab's top-left corner (p03_01; the app's primitives 7, 0, 1, ... 6).
_OUTLINE = ['proj_tab_top', 'proj_tab_side_R', 'proj_shoulder_R', 'proj_side_R',
            'proj_bottom_edge', 'proj_side_L', 'proj_shoulder_L', 'proj_tab_side_L']
# One corner per outline piece: where that piece starts (its :S end). `direction` = the axis-aligned inward
# (dx, dy) to the inner corner (inner_corners.py; Fusion y up). `reflex` = an INSIDE (270 deg) corner, the
# shoulder meeting the tab side: mitered like the others (outer reflex vertex -> the inner corner).
FRAME_CORNERS = [
    {"id": "tab_TL",     "curve": "proj_tab_top",     "direction": [1, -1],  "reflex": False},
    {"id": "tab_TR",     "curve": "proj_tab_side_R",  "direction": [-1, -1], "reflex": False},
    {"id": "inside_R",   "curve": "proj_shoulder_R",  "direction": [-1, -1], "reflex": True},
    {"id": "shoulder_R", "curve": "proj_side_R",      "direction": [-1, -1], "reflex": False},
    {"id": "BR",         "curve": "proj_bottom_edge", "direction": [-1, 1],  "reflex": False},
    {"id": "BL",         "curve": "proj_side_L",      "direction": [1, 1],   "reflex": False},
    {"id": "shoulder_L", "curve": "proj_shoulder_L",  "direction": [1, -1],  "reflex": False},
    {"id": "inside_L",   "curve": "proj_tab_side_L",  "direction": [1, -1],  "reflex": True},
]
# One bar per outline piece, in miter order (each miter starts a bar). Body names start with "frame_" (the CAM
# builder's frame-body rule, cam-builder.py) and none is a Template 1 name, so the CAM layout takes its N-bar path.
FRAME_BARS = [
    {"name": "frame_tab_top",        "curves": ["proj_tab_top"]},
    {"name": "frame_tab_right",      "curves": ["proj_tab_side_R"]},
    {"name": "frame_shoulder_right", "curves": ["proj_shoulder_R"]},
    {"name": "frame_side_right",     "curves": ["proj_side_R"]},
    {"name": "frame_base",           "curves": ["proj_bottom_edge"]},
    {"name": "frame_side_left",      "curves": ["proj_side_L"]},
    {"name": "frame_shoulder_left",  "curves": ["proj_shoulder_L"]},
    {"name": "frame_tab_left",       "curves": ["proj_tab_side_L"]},
]
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [[f"{c['curve']}:S", f"inner_{c['curve']}:S"] for c in FRAME_CORNERS],  # p03_04 Source -> Target
    "surround": "surround_rect",                           # p03_05
    "corners": [dict(c, outer=f"{c['curve']}:S", inner=f"inner_{c['curve']}:S") for c in FRAME_CORNERS],
    "bars": [dict(b) for b in FRAME_BARS],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). Both seeded: no template
# param sets the tab (the phases leave its half width and height to the seeds, p02_05), so moving the seeds IS
# setting it -- no parameter.
#   tabWidth:  the tab's half width (centre line -> each tab side), a fraction of hw; a position square on the
#              right tab side.
#   tabHeight: the tab's height (the top edge down to the shoulders), a fraction of hh; a position square on the
#              right shoulder.
FRAME_HANDLES = [
    {"key": "tabWidth",  "label": "Tab width",  "basis": "hw", "binding": "seeded"},
    {"key": "tabHeight", "label": "Tab height", "basis": "hh", "binding": "seeded"},
]
# T6 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the app's tabTop
# order: 0 tab side R, 1 shoulder R, 2 side R, 3 base, 4 side L, 5 shoulder L, 6 tab side L, 7 tab top). Every
# piece runs the same way in both (clockwise from the tab's top-left), so nothing is reversed.
FRAME_SEED_MAP = [
    {"id": "tab_top",     "kind": "line", "prim": 7, "reverse": False},
    {"id": "tab_side_R",  "kind": "line", "prim": 0, "reverse": False},
    {"id": "shoulder_R",  "kind": "line", "prim": 1, "reverse": False},
    {"id": "side_R",      "kind": "line", "prim": 2, "reverse": False},
    {"id": "bottom_edge", "kind": "line", "prim": 3, "reverse": False},
    {"id": "side_L",      "kind": "line", "prim": 4, "reverse": False},
    {"id": "shoulder_L",  "kind": "line", "prim": 5, "reverse": False},
    {"id": "tab_side_L",  "kind": "line", "prim": 6, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 8 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. Fitted from recorded goldens by the tab_top extractor once they exist (LIVE_CHECK.md);
# until then a PROVISIONAL model of its own (no base template to derive it from): the tab half width 0.5 x hw and
# height 0.5 x hh (7x9: a 3.25 in wide, 2.125 in tall tab). The app clamps it to the frame thickness rule (12x6:
# the 1.375 in tab height becomes 2 x 0.75 = 1.5 in).
FRAME_SHAPE_EXTRACTOR = "tab_top"
FRAME_PROVISIONAL_SHAPE = {"tabHalfWidthOfHw": 0.5, "tabHeightOfHh": 0.5}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 6 (Tab Top).
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
