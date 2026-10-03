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

MEASURED LIVE (T82 item 6, first real build): the curve-id NAMING is fixed (never depends on cx/cy/w/h),
which matters because `solid_coordinator._declared_frame()` re-resolves the STATIC template from disk at
solid-build time -- it has no access to the sketch-build's own in-memory, window-augmented template, so
nothing this module computes at apply_inset_window() time (a `regions["window"]` dict, an earlier attempt)
ever reaches declared_profiles.classify() later. The fix, mirroring panel_lip's OWN `lip_ids()` exactly:
classify() calls the zero-argument helpers below (`window_bars()`, `window_miters()`, `line_ids(...)`)
FRESH each time, from these fixed names, rather than reading anything stored. A profile's curve ids either
contain these names (the window exists in THIS sketch) or they don't (a window-less build) -- the check is
inherently safe either way, exactly like `ids & lip_ids(...)` already is for panel_lip.

Floors (mirrors core/inset-window.js's `insetWindowGeometry` exactly, so the app preview and the Fusion
build agree on when nothing is built/cut):
  - disabled, or the window's own bars would be <= 0 (`w`/`h` <= 2 * frame_thickness): NOTHING is built --
    identity return, same as panel_lip's own "lip 0" floor.
  - bars > 0 (the common case): the outer+inner rectangles and the 4 miters are ALWAYS built.
  - panel_lip > 0 and the hole is valid: a third, further-inset hole rectangle is built, and the ring
    between the window's own inner boundary and its hole is a no-feature ring (the panel keeps it) --
    mirrors the main frame's own panel-lip ring; classify() tolerates that ring arriving as one piece or
    split by the window's own miters, the same tolerance the main lip ring already needed (MEASURED there).
  - panel_lip > 0 but it would clamp the hole to <= 0 (lip wider than the window's own opening): NO hole
    rectangle is built -- SIMPLIFIED, T82 item 6 (live build): this now cuts the FULL inner rectangle
    (identical to no lip at all) rather than cutting nothing. The original design (a true no-op cut,
    matching the app's own "clamp it shut" zero-area preview) needed a build-time fact (did a hole actually
    get drawn, or was it clamped shut) that isn't derivable from curve ids alone once this stage can't see
    the payload any more, and this combination isn't in T82 item 6's own live-check scope. Flagged, not
    silently guessed past -- revisit if this combination is ever actually wanted.
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
_CORNERS = ("TL", "TR", "BL", "BR")


def line_ids(base):
    """A RectangleCenter's own 4 line ids. The TOP line's real id ends up being `base` itself (geom_step
    overwrites LineIDs[0] with the rectangle's own ID -- geometry.py's own gotcha, confirmed live, T1's own
    surround rect already relies on it), so LineIDs[0] is declared as `base` too: no silent rename."""
    return [f"{base}{s}" for s in _SIDES]


def vertex_id(base, corner):
    return f"{base}_V_{corner}"


def window_bars():
    """The window's own 4 bars as `declared_profiles.bar_index`'s own N-BAR shape (fixed names, no
    dependency on cx/cy/w/h -- see the module docstring)."""
    return [{"name": n, "curves": [c]} for n, c in zip(BAR_NAMES, line_ids(OUTER_ID))]


def window_miters():
    """The window's own 4 corner miters as (Source, Target) vertex-id pairs -- fixed names."""
    return [(vertex_id(OUTER_ID, c), vertex_id(INNER_ID, c)) for c in _CORNERS]


def _rect_block(phase_id, geo_id, cx_expr, cy_expr, w_expr, h_expr):
    return {
        "PhaseID": phase_id,
        "Name": phase_id,
        "BuildSequence": [{
            "Type": "RectangleCenter",
            "ID": geo_id,
            "Center": [cx_expr, cy_expr],
            "Size": [w_expr, h_expr],
            "LineIDs": line_ids(geo_id),
        }],
    }


def _in(v):
    return f"{float(v)} in"


def apply_inset_window(template, window, frame_thickness_in, panel_lip_in=0.0):
    """The template with the inset window's blocks appended to its frame sketch -- or the template
    unchanged (enabled false/absent, or window bars would be <= 0)."""
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
    sk["Blocks"].append({
        "PhaseID": MITERS_PHASE_ID,
        "Name": MITERS_PHASE_ID,
        "Miters": [{"Source": a, "Target": b, "IsConstruction": False} for a, b in window_miters()],
    })

    lip = max(0.0, float(panel_lip_in or 0))
    if lip > 0:
        hole_w, hole_h = width - 2 * ft - 2 * lip, height - 2 * ft - 2 * lip
        if hole_w > 0 and hole_h > 0:
            sk["Blocks"].append(_rect_block(
                HOLE_PHASE_ID, HOLE_ID, cx_e, cy_e,
                f"{_in(width)} - 2 * frame_thickness - 2 * panel_lip",
                f"{_in(height)} - 2 * frame_thickness - 2 * panel_lip",
            ))
        # else: the lip would clamp the hole shut -- no hole rect; the window cuts its full inner
        # rectangle instead (see the module docstring's "SIMPLIFIED" note).
    return out
