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
from fb_engine.parameter_schema import PANEL_LIP_PARAM  # F22: the panel lip setting names its (frame-owned) parameter

FRAME_DEFS_VERSION = 1

# Fred (Q2): the app starts with NO frame; a frame is optional and added by
# the user. A board sent with no frame behaves exactly as today.
DEFAULT_TEMPLATE = None

# Fred (Q4): ONE appearance list, the Extrude Frame palette's own woods
# (ui/html/solid_builder_palette.html, guarded by a test to stay equal).
# Read by appearance_manager.APPEARANCE_PRESETS, the palette's Python
# fallback (solid_builder_ui) and the app.
#
# F12: every name is a REAL Fusion library appearance (validated against the
# recorded library listing tests/fixtures/fusion-appearance-library.json by
# test_frame_defs.py). MEASURED (F11/F12, Fusion 2705): there is no
# "3D Cherry - Unfinished" nor "3D Maple - Unfinished"; the closest real ones
# are "Cherry" (the only cherry) and "3D Maple - Painted" (the only maple).
# F14 (Fred: "keep only 3D grain ones", "yes oak"): only "3D ..." appearances.
# Cherry (a flat, non-3D appearance) is removed; a saved Cherry frame gets the
# default, by the record gate's own rule for an unlisted wood. Oak is added.
APPEARANCE_OPTIONS = (
    "3D Ash - Unfinished",
    "3D Mahogany - Unfinished",
    "3D Pine - Unfinished",
    "3D Maple - Painted",
    "3D Oak - Painted",
)
# F12: names saved before the fix -> their real appearance, so a saved project
# keeps its wood (applied by the app's record gate, normalizeFrameRecord).
APPEARANCE_RENAMED = {
    "3D Maple - Unfinished": "3D Maple - Painted",
}
DEFAULT_APPEARANCE = APPEARANCE_OPTIONS[0]
# F7: the colour the app's 3D preview paints each wood with (a preview tint,
# not Fusion's material). Declared beside the list so a new wood cannot ship
# without one (test_frame_defs checks the keys match).
APPEARANCE_PREVIEW_COLORS = {
    "3D Ash - Unfinished": "#d9c9a3",
    "3D Mahogany - Unfinished": "#7a3b2e",
    "3D Pine - Unfinished": "#e3c07a",
    "3D Maple - Painted": "#ead7ad",
    "3D Oak - Painted": "#b88a55",
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
    # F22 (Fred: "for the panel I sometimes want a small offset outward ... so I can flush trim at the end"):
    # the panel is trimmed this far OUTSIDE the frame outline. A plain value in the trim sketch, never a user
    # parameter. It can not exceed the board-to-frame gap (the Trim offset): a declared range.
    {"key": "panelLip", "param": PANEL_LIP_PARAM, "unit": "in", "default": 0.0, "min": 0.0, "max": "boundingboxoffset",
     "label": "Panel lip (in)", "ui": True, "owner": "frame",
     "meaning": "the panel is trimmed this far outside the frame outline (a flush-trim allowance); 0 = on the outline"},
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
# reads these (F14 S6: fb_engine/declared_profiles.py); the regions named here
# are each template's own FRAME_REGIONS. `bodyNames` follow the `miters` order
# (each miter starts a bar).
COMMON_FRAME_FEATURES = (
    {"id": "bars", "op": "newBody", "region": "outline-minus-inner", "splitBy": "miters",
     "start": FRAME_BOTTOM_PARAM, "extent": {"toFace": "core.underside", "offset": "0 in"},
     "taper": "0 deg",
     "bodyNames": ["frame_top", "frame_right", "frame_bottom", "frame_left"]},
    {"id": "trim", "op": "cut", "region": "surround-minus-outline", "start": "0 in",
     "extent": "throughAll", "taper": "0 deg"},
)


def frame_features(body_names=None):
    """N-BAR: the common features with the bars' `bodyNames` set to a template's own bar list (in its `miters`
    order; a template that declares `regions["bars"]` passes their names). None = COMMON_FRAME_FEATURES as is,
    the 4-bar default every template before Template 6 uses."""
    out = [dict(f) for f in COMMON_FRAME_FEATURES]
    if body_names is not None:
        for f in out:
            if f["id"] == "bars":
                f["bodyNames"] = list(body_names)
    return tuple(out)


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


def template_shape_model(template_id, frame, goldens_dir):
    """F8: one template's app shape model, fitted from its recorded goldens by its extractor (the Frame's
    optional `shapeExtractor`, T3; else its silhouette preset's own).

    T3 TAPERED HOURGLASS: a template with too few goldens that declares a `provisionalShape`
    ({"from": <template id>, "topInsetOfDepth": k}) gets a PROVISIONAL model built from that template's fitted
    one (frame_shape_fit.provisional_shape_model), so the app never gets a null shapeModel for it. Recording
    its goldens and re-running tools/gen_frame_defs.py replaces it with the real fit.
    T4 OFFSET HOURGLASS: {"from": <template id>, "waistOffsetOfHh": k} instead builds
    frame_shape_fit.provisional_offset_waist_model (the two pinches k x hh apart from the middle, each way).
    T5 HOURGLASS DIPPED TOP: {"from": <template id>, "topDipDepthOfHh": d, "topDipHalfWidthOfHw": w} builds
    frame_shape_fit.provisional_dipped_top_model (the base model plus a top dip d x hh deep, w x hw half wide).
    T6 TAB TOP: {"tabHalfWidthOfHw": w, "tabHeightOfHh": h} (no `from`: nothing to derive it from) builds
    frame_shape_fit.provisional_tab_top_model.
    T8 DIPPED TOP + LEFT-ONLY WAVE: {"waveReachOfHw": ..., "waveHeightOfHh": ..., "topDipHalfWidthOfHw": ...,
    "topDipDepthOfHh": ..., "topDipPositionOfHw": ...} (no `from` either: like T6, no earlier template's fitted
    features describe a plain straight side or an off-centre dip) builds
    frame_shape_fit.provisional_dipped_left_wave_model.
    T9 I SHAPE: {"stemHalfWidthOfHw": w, "flangeHeightOfHh": h} (no `from`: like T6, nothing to derive it from)
    builds frame_shape_fit.provisional_i_shape_model.
    T10 ARCHED HOURGLASS v2 (F29 item 2): {"from": <template id>, "cornerRTopOfHw": ...} (distinguished by that
    key, since it also carries an "archCornerAngleDeg") builds frame_shape_fit.
    provisional_reconstructed_arched_hourglass_model (every one of the base model's own features replaced, not
    kept -- Fred's own hand-rebuilt sketch)."""
    from fb_engine.frame_shape_fit import (fit_shape_model, provisional_shape_model, provisional_offset_waist_model,
                                           provisional_dipped_top_model)
    from fb_engine.template_resolver import resolve_template
    model = fit_shape_model(template_id, frame.get("shapeExtractor") or frame.get("silhouettePreset"), goldens_dir)
    prov = frame.get("provisionalShape")
    if model is None and prov and "from" not in prov:
        if "tabHalfWidthOfHw" in prov:
            # T6 TAB TOP: a shape of its own (no base template): {"tabHalfWidthOfHw": w, "tabHeightOfHh": h}
            from fb_engine.frame_shape_fit import provisional_tab_top_model
            return provisional_tab_top_model(prov["tabHalfWidthOfHw"], prov["tabHeightOfHh"])
        if "stemHalfWidthOfHw" in prov:
            # T9 I SHAPE: also a shape of its own: {"stemHalfWidthOfHw": w, "flangeHeightOfHh": h}
            from fb_engine.frame_shape_fit import provisional_i_shape_model
            return provisional_i_shape_model(prov["stemHalfWidthOfHw"], prov["flangeHeightOfHh"])
        # T8 DIPPED TOP + LEFT-ONLY WAVE: also a shape of its own (see this function's own doc comment).
        from fb_engine.frame_shape_fit import provisional_dipped_left_wave_model
        return provisional_dipped_left_wave_model(prov["waveReachOfHw"], prov["waveHeightOfHh"],
                                                  prov["topDipHalfWidthOfHw"], prov["topDipDepthOfHh"],
                                                  prov["topDipPositionOfHw"])
    if model is None and prov:
        base_frame = resolve_template(prov["from"])[0].get("Frame") or {}
        base = template_shape_model(prov["from"], base_frame, goldens_dir)
        if base is not None:
            if "waistOffsetOfHh" in prov:
                model = provisional_offset_waist_model(base, prov["waistOffsetOfHh"])
            elif "topDipDepthOfHh" in prov:
                model = provisional_dipped_top_model(base, prov["topDipDepthOfHh"], prov["topDipHalfWidthOfHw"])
            elif "cornerRTopOfHw" in prov:
                # T10 ARCHED HOURGLASS v2 (F29 item 2): Fred's own hand-rebuilt sketch, every feature replaced.
                from fb_engine.frame_shape_fit import provisional_reconstructed_arched_hourglass_model
                model = provisional_reconstructed_arched_hourglass_model(
                    base, prov["depthOfHw"], prov["cornerRTopOfHw"], prov["cornerRBottomOfHw"], prov["waistROfHw"],
                    prov["waistCyOfHh"], prov["notchOfHw"], prov["topInsetOfHw"], prov["archCornerAngleDeg"])
            else:
                model = provisional_shape_model(base, prov["topInsetOfDepth"])
    return model


def build_frame_defs(source_hash, goldens_dir=None):
    """The dict frame-defs.json is serialized from. Templates come from
    template_resolver's own folder discovery, not a hand-kept list."""
    from fb_engine.template_resolver import get_available_templates, resolve_template
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
            "shapeModel": template_shape_model(t["value"], frame, goldens_dir) if goldens_dir else None,
            "params": params,
            "regions": frame.get("regions"),
            "features": frame.get("features"),
            "handles": frame.get("handles") or [],  # F9: the shape handle binding table
            "handleMigrations": frame.get("handleMigrations") or {},  # F20: old seed key -> the keys it became
            "seedMap": frame.get("seedMap") or [],   # F11: where each outline seed comes from (option B)
            # F29 item 1: a template can be hidden from the picker (its own shape isn't ready yet) while a
            # saved record that already uses it keeps loading and drawing normally -- every lookup here is
            # still by id over the FULL templates list; only the app's own dropdown reads this flag.
            "hidden": frame.get("hidden", False),
            "sketches": spec["Sketches"],
        })
    return {
        "frameDefsVersion": FRAME_DEFS_VERSION,
        "sourceHash": source_hash,
        "units": "in",
        "defaultTemplate": DEFAULT_TEMPLATE,
        "appearance": {"default": DEFAULT_APPEARANCE, "options": list(APPEARANCE_OPTIONS),
                       "previewColors": dict(APPEARANCE_PREVIEW_COLORS),
                       "renamed": dict(APPEARANCE_RENAMED)},
        "extrusion": [dict(s) for s in EXTRUSION_SETTINGS],
        "fit": dict(FRAME_FIT),
        "templates": templates,
    }
