import os

from template_loader import TemplateLoader
from fb_engine.frame_definition import frame_features
from fb_engine.seed_basis import seed_sketch
from fb_engine.t16_geometry import (TOP_WIDTH_FRAC_DEFAULT, ARCH_RISE_FRAC_DEFAULT,
                                     WAIST_WIDTH_FRAC_DEFAULT, WAIST_HEIGHT_FRAC_DEFAULT,
                                     BULGE_FRAC_DEFAULT, SHARED_LOWER_SKETCH_2_PARAMETERS)

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

TEMPLATE_NAME = "Template 16 - Arched Funnel"
TEMPLATE_DESCRIPTION = ("A one-piece arch over straight tapering sides, two outward-bulging lower "
                        "curves and a flat base (6 mitered bars) - Inches Unified")

SKETCH_1_LABEL = "Bounding Box"
SKETCH_1_PARAMETERS = [
    # ReadOnly - owned by b-spline add-in, displayed but not editable.
    {"Name": "widthIn",           "Label": "Width (Model)",  "Category": "Frame Spec", "Val": 7.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "heightIn",          "Label": "Height (Model)", "Category": "Frame Spec", "Val": 9.0, "Unit": "in", "Min": 1.0, "Max": 48.0, "ReadOnly": True},
    {"Name": "boundingboxoffset", "Label": "BBox Border",    "Category": "Frame Spec", "Val": 0.25, "Unit": "in", "Min": 0.0, "Expose": True},
]

SKETCH_2_LABEL = "Shape Outline"
# T84 item 3: every joint here is a MITER (fb_engine/t16_geometry.py's own module docstring) --
# unlike T7/T11's tangent chains, each arc stands alone (its own chord + sagitta,
# fb_engine.closed_form_arc.sagitta_circle), so there is no coupled multi-arc solve to seed. The
# arch needs no named parameter at all (its own via point is exactly the apex (0, hh) by
# construction -- see p02_02_loop.py's own docstring); the two lower bulges need the full
# sagitta_circle + true_via_point chain -- declared ONCE in fb_engine/t16_geometry.py's own
# SHARED_LOWER_SKETCH_2_PARAMETERS (Template 17 shares this exact lower half verbatim; see that
# module's own comment for the Unit="" rationale and the inlining-blows-up-to-9,200-characters
# measurement that motivated named parameters at all).
SKETCH_2_PARAMETERS = list(SHARED_LOWER_SKETCH_2_PARAMETERS)

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
# T16 ARCHED FUNNEL: 6 bars (upper_right, lower_right, base, lower_left, upper_left, arch) -- every
# joint a miter, no tangent-chain grouping (fb_engine/t16_geometry.py's own module docstring).
# ---------------------------------------------------------------------------
FRAME_SILHOUETTE_PRESET = "archedFunnel"   # the app's editor-shape-lattice-generator preset (frame-only: no Shape Lattice button)
# The outline, clockwise from the top-right corner (p03_01; the app's primitives 0..5).
_OUTLINE = ['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_arch']

# T84 item 3: every one of this template's 6 corners is a miter, and EVERY arc (arch, lower_R,
# lower_L) is miter-joined at BOTH its own ends -- so two of a given arc's own miters share the
# SAME bare outline id (just its :S vs its :E), which breaks declared_profiles.bar_index's own
# generic miter-walk default (it maps each miter to its source's bare-id OUTLINE POSITION, so two
# miters on the same curve collapse onto one position and only 3 bars would ever be derived, not
# 6). FRAME_BARS is therefore declared explicitly (Template 6's own precedent for this exact
# escape hatch) -- one curve, one bar, read directly by bar_index instead of walked.
FRAME_BARS = [
    {"name": "frame_upper_right", "curves": ["proj_upper_R"]},
    {"name": "frame_lower_right", "curves": ["proj_lower_R"]},
    {"name": "frame_base",        "curves": ["proj_base"]},
    {"name": "frame_lower_left",  "curves": ["proj_lower_L"]},
    {"name": "frame_upper_left",  "curves": ["proj_upper_L"]},
    {"name": "frame_arch",        "curves": ["proj_arch"]},
]
# No "corners": like Template 10, nothing in fb_engine or the app's own JS currently reads
# `regions["corners"]` (declared_profiles.py derives everything it needs from "outline" + "miters"
# + "bars" above) -- confirmed by search before omitting it, not assumed.
#
# p02_02_loop.py's own docstring table: 3 of these 6 corners are only reachable via an arc's `:E`,
# never its `:S` (Fusion's CCW-arc convention swaps a clockwise-declared triplet) -- each pair
# below names whichever end is PHYSICALLY there, matching p03_03/p03_04's own choice exactly.
FRAME_REGIONS = {
    "outline": _OUTLINE,                                   # p03_02 SourceID
    "inner": ["inner_" + i for i in _OUTLINE],             # p03_02 TargetIDs
    "miters": [
        ["proj_arch:S",    "inner_proj_arch:S"],      # topR
        ["proj_lower_R:E", "inner_proj_lower_R:E"],   # waistR
        ["proj_lower_R:S", "inner_proj_lower_R:S"],   # BR
        ["proj_lower_L:E", "inner_proj_lower_L:E"],   # BL
        ["proj_lower_L:S", "inner_proj_lower_L:S"],   # waistL
        ["proj_arch:E",    "inner_proj_arch:E"],      # topL
    ],
    "surround": "surround_rect",                           # p03_05
    "bars": [dict(b) for b in FRAME_BARS],
}
# FB-APP F9: the frame shape HANDLES (see template_1's table for the binding rules). All 5 seeded:
# no template param sets the outline's own shape (the phases leave it to the seeds,
# p02_02_loop.py), so moving the seeds IS setting it -- no parameter (same convention as every
# other hand-built template's own seeded handles).
#   topWidth:        T84 item 4 (Fred-approved): the arch's own half-span, a fraction of hw --
#                    shared key with seat C's own Sand Timer/Flask (fb_engine/t16_geometry.py's
#                    own TOP_WIDTH_FRAC_DEFAULT).
#   archRiseFrac:    the arch's own rise, a fraction of hw.
#   waistWidthFrac:  the waist's own half-width, a fraction of hw.
#   waistHeightFrac: how far down the waist sits (0=top edge, 1=bottom edge of the full safe
#                    height) -- basis "h", matching F31 item 1's own pinchHeightFrac convention
#                    (fb_engine/t16_geometry.py's own module docstring), NOT "hh" (that would halve
#                    the intended travel).
#   bulgeFrac:       the lower curves' own outward sagitta, a fraction of hw.
# H23 item 63's own 180-deg undercut guard (outlineHasUndercut) applies to this template's own
# outline same as any other; T84 item 3's own dispatch asks for MODERATE ranges (about halfway
# from the default to each extreme the diagram found) specifically so Generate stays clear of it,
# not because this template needs its own bespoke floor the way T7's gableNeckWidth did.
FRAME_HANDLES = [
    {"key": "topWidth",        "label": "Top width",     "basis": "hw", "binding": "seeded"},
    {"key": "archRiseFrac",    "label": "Arch rise",     "basis": "hw", "binding": "seeded"},
    {"key": "waistWidthFrac",  "label": "Waist width",   "basis": "hw", "binding": "seeded"},
    {"key": "waistHeightFrac", "label": "Waist height",  "basis": "h",  "binding": "seeded"},
    {"key": "bulgeFrac",       "label": "Lower bulge",   "basis": "hw", "binding": "seeded"},
]
# T16 is new: no record was ever saved before a split, so nothing to migrate.
FRAME_HANDLE_MIGRATIONS = {}
# FB-APP F11 (option B): the seeds come from the app's own solved outline, primitive `prim` (the
# app's archedFunnel order: 0 upper_R .. 5 arch, this template_data.py's own _OUTLINE order).
# "reverse" flags are a FIRST GUESS (each primitive assumed to run the SAME direction as sketch
# 2's own :S->:E in DECLARED point order, p02_02_loop.py) and MUST be checked against a real
# seed-geometry test (tests/frame-seed-geometry.test.js) once the app-side solver exists -- NOT YET
# WRITTEN for this template (same honest gap T7's own copy of this comment flags for itself).
FRAME_SEED_MAP = [
    {"id": "upper_R", "kind": "line", "prim": 0, "reverse": False},
    {"id": "lower_R", "kind": "arc",  "prim": 1, "reverse": False},
    {"id": "base",    "kind": "line", "prim": 2, "reverse": False},
    {"id": "lower_L", "kind": "arc",  "prim": 3, "reverse": False},
    {"id": "upper_L", "kind": "line", "prim": 4, "reverse": False},
    {"id": "arch",    "kind": "arc",  "prim": 5, "reverse": False},
]
# N-BAR: the common features (bars + trim) with this template's 6 bar names.
FRAME_FEATURES = frame_features([b["name"] for b in FRAME_BARS])
# F8: the app shape MODEL. No base template to derive it from (T16 is new) -- a PROVISIONAL model
# of its own, same as Template 6/7/8/9: the template's own tested default proportions
# (fb_engine/t16_geometry.py's own *_DEFAULT constants - DRY, not re-typed here).
FRAME_SHAPE_EXTRACTOR = "arched_funnel"
FRAME_PROVISIONAL_SHAPE = {
    "topWidthFracOfHw": TOP_WIDTH_FRAC_DEFAULT,
    "archRiseFracOfHw": ARCH_RISE_FRAC_DEFAULT,
    "waistWidthFracOfHw": WAIST_WIDTH_FRAC_DEFAULT,
    "waistHeightFracOfH": WAIST_HEIGHT_FRAC_DEFAULT,
    "bulgeFracOfHw": BULGE_FRAC_DEFAULT,
}


def get_template_logic(ui_data=None):
    """
    Returns the parametric logic for Template 16 (Arched Funnel). Standardized to Inches at the
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
