"""
frame_definition.py — FB-APP S1: the ONE declaration of a frame that both
the web app (JS preview, via the generated frame-defs.json) and fb_engine
(Python build) read.

Pure: no ``adsk`` import, so ``tools/gen_frame_defs.py`` can serialize it
in plain Python.

What lives where:
  * Per template (``sketches/template_N/template_data.py``): its phase
    blocks (unchanged), its parameters, and a ``"Frame"`` key in the spec
    ``get_template_logic`` returns: the app silhouette preset, the named
    regions (outline / inner / miters / surround ids), and the features.
  * Here: what is common to every frame. That is the features (bars +
    trim), the solid-extrusion settings (what the Extrude Frame palette
    sets), the one appearance list, and the "no frame" default.
  * ``build_frame_defs()`` assembles both into the dict
    ``frame-defs.json`` is serialized from.
"""

FRAME_DEFS_VERSION = 1

# Fred (Q2): the app starts with NO frame; a frame is optional and added by
# the user. A board sent with no frame behaves exactly as today.
DEFAULT_TEMPLATE = None

# Fred (Q4): ONE appearance list, the Extrude Frame palette's own woods
# (ui/html/solid_builder_palette.html, guarded by a test to stay equal).
# Read by appearance_manager.APPEARANCE_PRESETS, the palette's Python
# fallback (solid_builder_ui) and the app.
APPEARANCE_OPTIONS = (
    "3D Ash - Unfinished",
    "3D Mahogany - Unfinished",
    "3D Pine - Unfinished",
    "3D Cherry - Unfinished",
    "3D Maple - Unfinished",
)
DEFAULT_APPEARANCE = APPEARANCE_OPTIONS[0]
# F7: the colour the app's 3D preview paints each wood with (a preview tint,
# not Fusion's material). Declared beside the list so a new wood cannot ship
# without one (test_frame_defs checks the keys match).
APPEARANCE_PREVIEW_COLORS = {
    "3D Ash - Unfinished": "#d9c9a3",
    "3D Mahogany - Unfinished": "#7a3b2e",
    "3D Pine - Unfinished": "#e3c07a",
    "3D Cherry - Unfinished": "#9c4a2f",
    "3D Maple - Unfinished": "#ead7ad",
}

# Fred (Q3, "it's a position, not a value"): frame_height_offset is the Z of
# the frame's bottom relative to the frame sketch plane (negative = below).
# MEASURED (F2): every bar's bottom lies at exactly that z; the top meets the
# core's underside.
FRAME_BOTTOM_PARAM = "frame_height_offset"
DEFAULT_FRAME_BOTTOM_EXPR = "-1 in"

# The solid-extrusion settings, i.e. exactly what the Extrude Frame palette
# sets today (inventoried: solid_builder_palette.html #solid-offset,
# #solid-appearance, the face pick; SolidCoordinator.offset_expr for the
# end offset). The app's sidebar FRAME section shows the "ui" ones.
EXTRUSION_SETTINGS = (
    {"key": "frameBottomZ", "param": FRAME_BOTTOM_PARAM, "unit": "in", "default": -1.0,
     "label": "Frame bottom (z)", "ui": True, "owner": "frame",
     "meaning": "z position of the frame bottom relative to the frame sketch plane "
                "(negative = below); a position, not a length"},
    {"key": "appearance", "label": "Wood", "ui": True, "default": DEFAULT_APPEARANCE,
     "options": "appearance"},
    {"key": "endOffset", "unit": "in", "default": 0.0, "label": "End offset", "ui": False,
     "meaning": "offset of the bar top from the target face; a fixed literal today "
                "(SolidCoordinator.offset_expr = '0 in', flush fit)"},
    {"key": "toFace", "value": "core.underside", "ui": False,
     "meaning": "the Clean panel's face whose normal at pointOnFace has n.z ~ -1 "
                "(MEASURED F2; every face of a Send panel is NURBS)"},
)

# The features every current template builds from sketch 3. The extruder
# still classifies profiles by bounding box today (S6 switches it to read
# this); the regions named here are each template's own FRAME_REGIONS.
COMMON_FRAME_FEATURES = (
    {"id": "bars", "op": "newBody", "region": "outline-minus-inner", "splitBy": "miters",
     "start": FRAME_BOTTOM_PARAM, "extent": {"toFace": "core.underside", "offset": "0 in"},
     "taper": "0 deg",
     "bodyNames": ["frame_top", "frame_right", "frame_bottom", "frame_left"]},
    {"id": "trim", "op": "cut", "region": "surround-minus-outline", "start": "0 in",
     "extent": "throughAll", "taper": "0 deg"},
)


# FB-FIX (F4): "board too small for this frame". Measured on the S4 goldens:
# at 5.51 x 1.97 in the safe zone is 1.97 - 2*0.25 = 1.47 in < 2*0.75 in, the
# inner offset collapses, and the build gives 0 bars with no error. Declared
# once; the app evaluates `rule` (it is in frame-defs.json) and fb_engine calls
# frame_fit() before building. The hourglass waist can be stricter than this
# bounding-box rule; that is a known gap, not covered here.
FRAME_FIT = {
    "rule": "2 * frame_thickness < min(widthIn, heightIn) - 2 * boundingboxoffset",
    "message": ("Board too small for this frame: the safe zone is {safe:.2f} in "
                "but the frame needs more than {need:.2f} in (2 x frame thickness). "
                "Use a bigger board or a thinner frame."),
}


def frame_fit(width_in, height_in, frame_thickness_in, bbox_offset_in):
    """Evaluate FRAME_FIT. Returns {"ok", "safeZoneIn", "requiredIn", "message"}."""
    safe = min(width_in, height_in) - 2 * bbox_offset_in
    need = 2 * frame_thickness_in
    ok = need < safe
    return {
        "ok": ok,
        "safeZoneIn": round(safe, 4),
        "requiredIn": round(need, 4),
        "message": None if ok else FRAME_FIT["message"].format(safe=safe, need=need),
    }


def _param_entry(p_info):
    from fb_engine.parameter_schema import ParameterSchema
    name = p_info["Name"]
    entry = {
        "name": name,
        "label": p_info.get("Label", name),
        "unit": ParameterSchema.default_unit(name, p_info),
        "default": p_info.get("Val"),
        "owner": "board" if ParameterSchema.is_board_owned(name) else "frame",
    }
    for src, dst in (("Min", "min"), ("Max", "max"), ("ReadOnly", "readOnly"),
                     ("Expose", "expose"), ("Category", "category")):
        if src in p_info:
            entry[dst] = p_info[src]
    return entry


def build_frame_defs(source_hash, goldens_dir=None):
    """The dict frame-defs.json is serialized from. Templates come from
    template_resolver's own folder discovery, not a hand-kept list."""
    from fb_engine.template_resolver import get_available_templates, resolve_template
    from fb_engine.frame_shape_fit import fit_shape_model
    templates = []
    for t in get_available_templates():
        spec, prefix = resolve_template(t["value"])
        frame = spec.get("Frame") or {}
        params = [_param_entry(p) for sk in spec["Sketches"] for p in sk.get("Parameters", [])]
        templates.append({
            "id": t["value"],
            "name": spec["Name"],
            "prefix": prefix,
            "silhouettePreset": frame.get("silhouettePreset"),
            # F8: fitted from the recorded Fusion goldens (frame_shape_fit.py)
            "shapeModel": fit_shape_model(t["value"], frame.get("silhouettePreset"), goldens_dir) if goldens_dir else None,
            "params": params,
            "regions": frame.get("regions"),
            "features": frame.get("features"),
            "handles": frame.get("handles") or [],  # F9: the shape handle binding table
            "sketches": spec["Sketches"],
        })
    return {
        "frameDefsVersion": FRAME_DEFS_VERSION,
        "sourceHash": source_hash,
        "units": "in",
        "defaultTemplate": DEFAULT_TEMPLATE,
        "appearance": {"default": DEFAULT_APPEARANCE, "options": list(APPEARANCE_OPTIONS),
                       "previewColors": dict(APPEARANCE_PREVIEW_COLORS)},
        "extrusion": [dict(s) for s in EXTRUSION_SETTINGS],
        "fit": dict(FRAME_FIT),
        "templates": templates,
    }
