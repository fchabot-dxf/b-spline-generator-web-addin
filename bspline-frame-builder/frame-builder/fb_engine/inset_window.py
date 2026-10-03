"""
inset_window.py — T82 item 6 (INSET-WINDOW-DESIGN.md), the Fusion/CAM side of the inset window (item 2's
app side already built the record, the 2D/3D preview and the drag UI; this module is the ONE place its
`{enabled, cx, cy, w, h}` record becomes sketch geometry).

A second, small, rectangular mitred subframe set into the panel, entirely inside the main frame's own
opening: 3 nested, axis-aligned, centred rectangles (outer -> bars -> inner -> [lip ring] -> hole), same
centre `(cx, cy)`, built into the SAME frame-enclosure sketch the main outline already lives in (never a
new sketch or component -- a second tagged component would break `find_frame_component`'s "first tag hit",
`send_frame.find_frames(design)[-1]`, delete-on-resend and CAM's one-`parentComponent`-per-move
assumption). `cx`/`cy` are already in Fusion's own sketch coordinates (the record's own board-centre, +y-up
convention IS that coordinate system -- `core/inset-window.js`'s `insetWindowOuterRect` is the one place a
board-local x1/y1/x2/y2 form is derived, for the 2D app side only; this module reads cx/cy/w/h directly).

Mirrors fb_engine/panel_lip.py's own shape (pure, no adsk; a disabled or below-floor window returns the
template unchanged; curve ids are named by a FIXED rule, never stored, since the solid build re-resolves
the template from disk without the original payload) -- but unlike panel_lip (an offset of the EXISTING
outline), the window's three rectangles are independently drawn (RectangleCenter, same primitive Template
6's own surround rectangle and every `p03_05_encl_surround_rect`-style phase already uses live), each sized
directly from `w`/`h`/`frame_thickness`/`panel_lip` rather than offset from one another -- a plain centred
rectangle can never self-intersect regardless of size, so none of this needs `ResolveInnerCorners` (that
machinery exists only to repair a CONCAVE offset's own self-intersecting corners, which a rectangle never
has).

Floors (mirrors core/inset-window.js's `insetWindowGeometry` exactly, so the app preview and the Fusion
build agree on when nothing is built/cut):
  - disabled, or the window's own bars would be <= 0 (`w`/`h` <= 2 * frame_thickness): NOTHING is built --
    identity return, same as panel_lip's own "lip 0" floor.
  - bars > 0 (the common case): the outer+inner rectangles and the 4 miters are ALWAYS built.
  - panel_lip > 0 but it would clamp the hole to <= 0 (lip wider than the window's own opening): the bars
    still exist, but NO hole rectangle and NO cut feature are built at all (a true no-op cut, matching the
    JS side's own "clamp it shut (zero-area) rather than invert" floor) -- not yet confirmed live on real
    geometry (flagged in WORK-LOG, not guessed past).
  - panel_lip > 0 and the hole is valid: a third, further-inset hole rectangle is built, and the ring
    between the window's own inner boundary and its hole is a no-feature ring (the panel keeps it) --
    exactly mirroring the main frame's own panel-lip ring. The classify() side tolerates this ring being
    reported as one piece or split by the window's own miters (it only asserts a SUBSET of the allowed
    ids), so either shape -- a MEASURED fact for the main lip ring, not yet separately measured here --
    classifies correctly without needing to know which one Fusion actually produces.
"""
import copy

from fb_engine.panel_lip import _frame_sketch

OUTER_PHASE_ID = "p03_91_inset_window_outer"
INNER_PHASE_ID = "p03_92_inset_window_inner"
HOLE_PHASE_ID = "p03_93_inset_window_hole"
MITERS_PHASE_ID = "p03_94_inset_window_miters"

OUTER_ID = "window_outer"
INNER_ID = "window_inner"
HOLE_ID = "window_hole"

BAR_NAMES = ("frame_window_top", "frame_window_right", "frame_window_bottom", "frame_window_left")
_SIDES = ("", "_right", "_bottom", "_left")  # LineIDs order: top, right, bottom, left (geometry._create_rectangle)


def _line_ids(base):
    """A RectangleCenter's own 4 line ids. The TOP line's real id ends up being `base` itself (geom_step
    overwrites LineIDs[0] with the rectangle's own ID -- geometry.py's own gotcha, confirmed live, T1's own
    surround rect already relies on it), so LineIDs[0] is declared as `base` too: no silent rename."""
    return [f"{base}{s}" for s in _SIDES]


def _vertex_id(base, corner):
    return f"{base}_V_{corner}"


def _rect_block(phase_id, geo_id, cx_expr, cy_expr, w_expr, h_expr):
    return {
        "PhaseID": phase_id,
        "Name": phase_id,
        "BuildSequence": [{
            "Type": "RectangleCenter",
            "ID": geo_id,
            "Center": [cx_expr, cy_expr],
            "Size": [w_expr, h_expr],
            "LineIDs": _line_ids(geo_id),
        }],
    }


def _in(v):
    return f"{float(v)} in"


def apply_inset_window(template, window, frame_thickness_in, panel_lip_in=0.0):
    """The template with the inset window's blocks appended to its frame sketch, and
    `template["Frame"]["regions"]["window"]` declared for declared_profiles.classify() to read -- or the
    template unchanged (enabled false/absent, or window bars would be <= 0)."""
    w = window or {}
    if not w.get("enabled"):
        return template
    try:
        cx, cy, width, height = float(w["cx"]), float(w["cy"]), float(w["w"]), float(w["h"])
    except (KeyError, TypeError, ValueError):
        return template
    ft = float(frame_thickness_in or 0)
    if not (width > 2 * ft and height > 2 * ft):
        return template  # the window's own bars would be <= 0: no feature, mirrors the app's own floor

    out = copy.deepcopy(template)
    outline = out["Frame"]["regions"]["outline"]
    sk = _frame_sketch(out, outline)
    if sk is None:
        raise ValueError("the template's frame sketch (its outline Offset) was not found")

    cx_e, cy_e = _in(cx), _in(cy)
    sk["Blocks"].append(_rect_block(OUTER_PHASE_ID, OUTER_ID, cx_e, cy_e, _in(width), _in(height)))
    inner_w_expr = f"{_in(width)} - 2 * frame_thickness"
    inner_h_expr = f"{_in(height)} - 2 * frame_thickness"
    sk["Blocks"].append(_rect_block(INNER_PHASE_ID, INNER_ID, cx_e, cy_e, inner_w_expr, inner_h_expr))

    miters = [
        (_vertex_id(OUTER_ID, "TL"), _vertex_id(INNER_ID, "TL")),
        (_vertex_id(OUTER_ID, "TR"), _vertex_id(INNER_ID, "TR")),
        (_vertex_id(OUTER_ID, "BL"), _vertex_id(INNER_ID, "BL")),
        (_vertex_id(OUTER_ID, "BR"), _vertex_id(INNER_ID, "BR")),
    ]
    sk["Blocks"].append({
        "PhaseID": MITERS_PHASE_ID,
        "Name": MITERS_PHASE_ID,
        "Miters": [{"Source": a, "Target": b, "IsConstruction": False} for a, b in miters],
    })

    lip = max(0.0, float(panel_lip_in or 0))
    hole_ids, cut = None, "inner"
    if lip > 0:
        hole_w, hole_h = width - 2 * ft - 2 * lip, height - 2 * ft - 2 * lip
        if hole_w > 0 and hole_h > 0:
            sk["Blocks"].append(_rect_block(
                HOLE_PHASE_ID, HOLE_ID, cx_e, cy_e,
                f"{_in(width)} - 2 * frame_thickness - 2 * panel_lip",
                f"{_in(height)} - 2 * frame_thickness - 2 * panel_lip",
            ))
            hole_ids, cut = _line_ids(HOLE_ID), "hole"
        else:
            cut = None  # the lip would clamp the hole shut: bars still exist, nothing is cut (app parity)

    out["Frame"]["regions"]["window"] = {
        "outer": _line_ids(OUTER_ID),
        "inner": _line_ids(INNER_ID),
        "hole": hole_ids,
        "cut": cut,
        "miters": miters,
        "bars": [{"name": n, "curves": [c]} for n, c in zip(BAR_NAMES, _line_ids(OUTER_ID))],
    }
    return out
