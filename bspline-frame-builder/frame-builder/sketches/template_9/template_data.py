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

TEMPLATE_NAME = "Template 9 - I Shape"
TEMPLATE_DESCRIPTION = "A capital serif I: full-width top and bottom flanges, a narrower stem between them (12 mitered bars) - Inches Unified"

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
    # No ck_* gates: every T9 constraint is needed for the 2-DOF solve (p02_05_symmetry), and a gate would be a
    # new template parameter (Fred's rule, Template 6's own finding). The stem's size is left to the seeds.
]

SKETCH_3_LABEL = "Frame Enclosure"
SKETCH_3_PARAMETERS = [
    {
        # Static 2.0 in cap, same reasoning as Template 6: the
        # p03_03_inner_corner_resolve phase finds inner corners by computed
        # position, so miters fire even if Fusion's own offset merges
        # colliding geometry at a high frame_thickness.
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
    # on sketch geometry, so no parameter is declared here.
]


# ---------------------------------------------------------------------------
# FB-APP S1: this template's frame declaration (frame-defs.json for the app, the extruder from S6).
# T9 I SHAPE: a frame with 4 INSIDE corners (Template 6 had 2), its own CORNER list and BAR list
# (regions["corners"] / regions["bars"]); the miters, the inner-corner table (p03_03) and the bars' body names
# all follow from them.
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "iShape"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-left corner (p03_01; the app's own primitive order, FRAME_SEED_MAP below).
_OUTLINE = ['proj_top_edge', 'proj_flange_side_R', 'proj_shoulder_TR', 'proj_stem_side_R',
            'proj_shoulder_BR', 'proj_flange_side_BR', 'proj_bottom_edge', 'proj_flange_side_BL',
            'proj_shoulder_BL', 'proj_stem_side_L', 'proj_shoulder_TL', 'proj_flange_side_TL']
# One corner per outline piece: where that piece starts (its :S end). `direction` = the axis-aligned inward
# (dx, dy) to the inner corner (inner_corners.py; Fusion y up), MEASURED by which side of each edge is solid
# (p03_03's own doc comment). `reflex` = an INSIDE (270 deg) corner, a shoulder meeting a stem side: mitered
# like the others (outer reflex vertex -> the inner corner).
FRAME_CORNERS = [
    {"id": "TL",             "curve": "proj_top_edge",       "direction": [1, -1],  "reflex": False},
    {"id": "TR",             "curve": "proj_flange_side_R",  "direction": [-1, -1], "reflex": False},
    {"id": "notch_TR_outer", "curve": "proj_shoulder_TR",    "direction": [-1, 1],  "reflex": False},
    {"id": "notch_TR_inner", "curve": "proj_stem_side_R",    "direction": [-1, 1],  "reflex": True},
    {"id": "notch_BR_inner", "curve": "proj_shoulder_BR",    "direction": [-1, -1], "reflex": True},
    {"id": "notch_BR_outer", "curve": "proj_flange_side_BR", "direction": [-1, -1], "reflex": False},
    {"id": "BR",             "curve": "proj_bottom_edge",    "direction": [-1, 1],  "reflex": False},
    {"id": "BL",             "curve": "proj_flange_side_BL", "direction": [1, 1],   "reflex": False},
    {"id": "notch_BL_outer", "curve": "proj_shoulder_BL",    "direction": [1, -1],  "reflex": False},
    {"id": "notch_BL_inner", "curve": "proj_stem_side_L",    "direction": [1, -1],  "reflex": True},
    {"id": "notch_TL_inner", "curve": "proj_shoulder_TL",    "direction": [1, 1],   "reflex": True},
    {"id": "notch_TL_outer", "curve": "proj_flange_side_TL", "direction": [1, 1],   "reflex": False},
]
# One bar per outline piece, in miter order (each miter starts a bar). Body names start with "frame_" (the CAM
# builder's frame-body rule, cam-builder.py) and none is a Template 1 name, so the CAM layout takes its N-bar path.
FRAME_BARS = [
    {"name": "frame_top",           "curves": ["proj_top_edge"]},
    {"name": "frame_flange_TR",     "curves": ["proj_flange_side_R"]},
    {"name": "frame_shoulder_TR",   "curves": ["proj_shoulder_TR"]},
    {"name": "frame_stem_right",    "curves": ["proj_stem_side_R"]},
    {"name": "frame_shoulder_BR",   "curves": ["proj_shoulder_BR"]},
    {"name": "frame_flange_BR",     "curves": ["proj_flange_side_BR"]},
    {"name": "frame_bottom",        "curves": ["proj_bottom_edge"]},
    {"name": "frame_flange_BL",     "curves": ["proj_flange_side_BL"]},
    {"name": "frame_shoulder_BL",   "curves": ["proj_shoulder_BL"]},
    {"name": "frame_stem_left",     "curves": ["proj_stem_side_L"]},
    {"name": "frame_shoulder_TL",   "curves": ["proj_shoulder_TL"]},
    {"name": "frame_flange_TL",     "curves": ["proj_flange_side_TL"]},
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
# param sets the stem (the phases leave its half width and the flange height to the seeds, p02_05), so moving
# the seeds IS setting it -- no parameter.
#   stemWidth:    the stem's half width (centre line -> each stem side), a fraction of hw; a position square on
#                 the right stem side.
#   flangeHeight: each flange's height (the top/bottom edge down/up to its own shoulder), a fraction of hh; a
#                 position square on the top-right shoulder.
FRAME_HANDLES = [
    {"key": "stemWidth",    "label": "Stem width",    "basis": "hw", "binding": "seeded"},
    {"key": "flangeHeight", "label": "Flange height", "basis": "hh", "binding": "seeded"},
]
# T9 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the app's iShape
# order, identical to the Fusion piece order above: every piece runs clockwise from the top-left, so nothing is
# reversed).
FRAME_SEED_MAP = [
    {"id": "top_edge",       "kind": "line", "prim": 0,  "reverse": False},
    {"id": "flange_side_R",  "kind": "line", "prim": 1,  "reverse": False},
    {"id": "shoulder_TR",    "kind": "line", "prim": 2,  "reverse": False},
    {"id": "stem_side_R",    "kind": "line", "prim": 3,  "reverse": False},
    {"id": "shoulder_BR",    "kind": "line", "prim": 4,  "reverse": False},
    {"id": "flange_side_BR", "kind": "line", "prim": 5,  "reverse": False},
    {"id": "bottom_edge",    "kind": "line", "prim": 6,  "reverse": False},
    {"id": "flange_side_BL", "kind": "line", "prim": 7,  "reverse": False},
    {"id": "shoulder_BL",    "kind": "line", "prim": 8,  "reverse": False},
    {"id": "stem_side_L",    "kind": "line", "prim": 9,  "reverse": False},
    {"id": "shoulder_TL",    "kind": "line", "prim": 10, "reverse": False},
    {"id": "flange_side_TL", "kind": "line", "prim": 11, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 12 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. Fitted from recorded goldens by the i_shape extractor once they exist (LIVE_CHECK.md);
# until then a PROVISIONAL model of its own (no base template to derive it from, as Template 6): the stem half
# width 0.45 x hw and the flange height 0.7 x hh (7x9: a 1.4625 in half-stem, 2.975 in flange -- H23 item 79,
# Fred's own pick, up from the original 0.4 x hh / 1.7 in). The app clamps it to the frame thickness rule --
# MEASURED (this item): 0.7 draws exactly where the board is roomy enough (7x9, 9x12), and silently clamps
# DOWN to whatever the board's own opening rule allows where it isn't (12x6: 0.591; 5x7/9x7: 0.654) -- zero
# defects at every size tried, the SAME existing frameCutProfile clamp-before-draw mechanism this comment's
# own prior note already described (T6/T9 are the two templates whose DRAWN frame, not just a drag, obeys
# the frame rule), not a new guard.
FRAME_SHAPE_EXTRACTOR = "i_shape"
FRAME_PROVISIONAL_SHAPE = {"stemHalfWidthOfHw": 0.45, "flangeHeightOfHh": 0.7}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 9 (I Shape).
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
