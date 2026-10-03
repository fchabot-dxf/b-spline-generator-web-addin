"""
FB-APP F14 (S6): which extrude each sketch-3 profile gets, read from the
template's DECLARED frame features (template_data FRAME_REGIONS +
frame_definition.COMMON_FRAME_FEATURES, the same data frame-defs.json carries
to the app), not guessed from the profile's bounding box.

A profile is known by the FrameBuilder.ID of the sketch curves bounding it
(the outline, miter and surround curves carry one, measured live F14):
  - it touches the declared `surround` curve  -> region "surround-minus-outline"
  - else it touches an `outline` curve         -> region "outline-minus-inner";
    which bar it is follows the declared `miters` (each miter starts a bar at
    its outline curve's start, in outline order) and the feature's `bodyNames`
  - F22: else it touches a panel-LIP curve (lip_<outline id>, fb_engine/panel_lip.py) -> the lip ring between
    the outline and the lip loop: no feature (the panel keeps it; the trim follows the lip loop)
  - else it is the frame's opening (inside the inner edge)  -> no feature.
    Its curves' ids are NOT required: MEASURED F14 (T2 12x6), Fusion re-solves
    the inner offset later in the build and the replacement curves carry no
    FrameBuilder.ID. Any id it does carry must be an `inner` one.
The extruder keeps its bounding-box classifier ONLY for a frame component that
declares no template (built before S6, or a template without a "Frame" block).

Pure: no adsk. extrusion_engine gathers the ids and builds from the plan.
"""

SURROUND_REGION = "surround-minus-outline"
BAR_REGION = "outline-minus-inner"
# T82 item 6: the inset window (fb_engine/inset_window.py), a second mitred subframe entirely inside the
# main frame's own opening -- same dispatch pattern, its own region names.
WINDOW_BAR_REGION = "window-outline-minus-inner"
WINDOW_CUT_REGION = "window-hole"


def miter_curve_id(src_id, tgt_id):
    """The FrameBuilder.ID of the miter line from `src_id` to `tgt_id` (a template's `miters` pair). The ONE naming
    rule: fb_engine/miters.py names the line with it, the lip rule below derives the ids with it."""
    return f"miter-{src_id}_{tgt_id}"


class DeclaredProfileError(ValueError):
    """A profile the declaration can not place (logged; that profile is skipped)."""


def _feature_for(features, region):
    for f in features:
        if f.get("region") == region:
            return f
    raise DeclaredProfileError(f"the template declares no feature for region '{region}'")


def bar_index(curve_id, regions):
    """Which bar (index into the miter list, = bodyNames index) an outline curve belongs to.

    N-BAR: a template that declares its bars (`regions["bars"]`: [{"name", "curves"}], in miter order, Template
    6) is read directly; otherwise (every earlier template) the miter walk below, the 4-bar default."""
    if regions.get("bars"):
        for k, bar in enumerate(regions["bars"]):
            if curve_id in bar["curves"]:
                return k
        raise ValueError(f"outline curve {curve_id!r} is in no declared bar")
    outline = list(regions["outline"])
    starts = [outline.index(m[0].split(":")[0]) for m in regions["miters"]]
    j = outline.index(curve_id)
    before = [k for k, s in enumerate(starts) if s <= j]
    if before:
        return max(before, key=lambda k: starts[k])
    return max(range(len(starts)), key=lambda k: starts[k])  # wraps round to the last miter's bar


def frame_bars(frame):
    """N-BAR: a template's bars as [{"name", "curves"}] in miter order: its declared `regions["bars"]`, or (the
    default, Templates 1-5) derived from the miter walk and the bars feature's `bodyNames`."""
    regions = frame["regions"]
    if regions.get("bars"):
        return [{"name": b["name"], "curves": list(b["curves"])} for b in regions["bars"]]
    names = _feature_for(frame["features"], BAR_REGION)["bodyNames"]
    out = [{"name": n, "curves": []} for n in names]
    for c in regions["outline"]:
        out[bar_index(c, regions)]["curves"].append(c)
    return out


def classify(curve_ids, frame):
    """``(feature, body_name)`` for a profile bounded by ``curve_ids``;
    ``(None, None)`` for the frame's opening. ``frame`` is a template's "Frame"
    block (regions + features). Raises DeclaredProfileError for a profile the
    declaration does not describe."""
    regions, features = frame["regions"], frame["features"]
    ids = set(curve_ids)
    if regions["surround"] in ids:
        return _feature_for(features, SURROUND_REGION), None
    from fb_engine.panel_lip import lip_ids
    lip = set(lip_ids(regions["outline"]))
    if ids & lip:
        # MEASURED live (F22, T1 7x9): the miters meet the outline at its corners and split the ring into pieces,
        # so a ring piece is bounded by lip + outline + miter curves
        miters = {miter_curve_id(a, b) for a, b in regions["miters"]}
        stray = ids - lip - set(regions["outline"]) - miters
        if stray:
            raise DeclaredProfileError(f"lip profile curves {sorted(stray)} are not the outline, its lip or a miter")
        return None, None  # the lip ring: the panel keeps it
    outline = ids & set(regions["outline"])
    if outline:
        feat = _feature_for(features, BAR_REGION)
        bars = {bar_index(c, regions) for c in outline}
        if len(bars) != 1:
            raise DeclaredProfileError(
                f"one profile spans {len(bars)} bars ({sorted(outline)}): a miter did not split it")
        return feat, feat["bodyNames"][bars.pop()]

    # T82 item 6: the inset window (fb_engine/inset_window.py). MEASURED live: the window's own curve ids
    # are FIXED names, never dependent on cx/cy/w/h, and never stored in `regions` -- the solid build's own
    # `_declared_frame()` re-resolves the STATIC template from disk, so anything the sketch build computed
    # from the payload is gone by then. These hypothetical ids are therefore recomputed fresh every call,
    # exactly like `lip_ids(regions["outline"])` above: a window-less build's curve ids never intersect
    # them, so every check below is a harmless no-op when there is no window.
    from fb_engine.inset_window import OUTER_ID, INNER_ID, HOLE_ID, line_ids, window_miters, window_bars
    window_outer_ids = set(line_ids(OUTER_ID))
    window_inner_ids = set(line_ids(INNER_ID))
    window_hole_ids = set(line_ids(HOLE_ID))

    # A profile that ALSO touches the main frame's own inner ids is the opening with the window's outer
    # loop as an island (below), never a window-bar profile -- a genuine window bar never touches `inner`.
    if (ids & window_outer_ids) and not (ids & set(regions["inner"])):
        feat = _feature_for(features, WINDOW_BAR_REGION)
        touched = ids & window_outer_ids
        bars = {bar_index(c, {"bars": window_bars()}) for c in touched}
        if len(bars) != 1:
            raise DeclaredProfileError(
                f"one window profile spans {len(bars)} bars ({sorted(touched)}): a miter did not split it")
        return feat, feat["bodyNames"][bars.pop()]

    if ids & window_hole_ids:
        if not (ids - window_hole_ids):
            return _feature_for(features, WINDOW_CUT_REGION), None  # the pocket cut, lip > 0
        window_miter_ids = {miter_curve_id(a, b) for a, b in window_miters()}
        stray = ids - window_inner_ids - window_hole_ids - window_miter_ids
        if stray:
            raise DeclaredProfileError(
                f"window lip profile curves {sorted(stray)} are not the window's inner boundary, "
                "its hole or a miter")
        return None, None  # the window's own lip ring: the panel keeps it
    if ids and not (ids - window_inner_ids):
        return _feature_for(features, WINDOW_CUT_REGION), None  # the pocket cut, no lip (or a clamped one)

    stray = ids - set(regions["inner"]) - window_outer_ids
    if not stray:
        return None, None  # the opening (punched by the window's own outer loop, if a window exists)
    raise DeclaredProfileError(f"profile curves {sorted(stray)} are not in the declared regions")


def extrude_plan(feature, body_name, start_param_expr):
    """The extrude a declared feature asks for. ``start_param_expr`` is the
    value of the FRAME_BOTTOM_PARAM the coordinator synced (a feature whose
    `start` names a parameter starts at that parameter)."""
    from fb_engine.frame_definition import FRAME_BOTTOM_PARAM
    start = feature.get("start", "0 in")
    extent = feature["extent"]
    return {
        "kind": "SURROUND" if feature["op"] == "cut" else "BAR",
        "name": body_name,
        "start": start_param_expr if start == FRAME_BOTTOM_PARAM else start,
        "extent": ("throughAll",) if extent == "throughAll" else ("toFace", extent.get("offset", "0 in")),
        "taper": feature.get("taper", "0 deg"),
        "order": feature["id"],
    }
