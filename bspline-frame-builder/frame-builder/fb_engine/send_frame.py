"""
send_frame.py — FB-APP S5 (F10): the web app's [Send frame] (FB-APP-DESIGN.md §4).

The frame on its own, re-sendable (Q1): delete the previous frame, found by
ATTRIBUTE (never by name or count), then rebuild it through the SAME entry
points the Frame Builder palettes use:

  0  refuse without a B-spline body (the bar extrude goes TO its underside)
  1  delete the previous frame: every component tagged
     FrameBuilder.ComponentType=Frame (its occurrences), and the features it
     put in OTHER components (the TRIM_CUT lives in Clean) found by their
     FrameBuilder.FrameComponent tag
  2  frame_engine.build_sketch_logic_v3: the full sketch build (the Sketch
     Builder palette's path; build_frame_logic calls a method that does not
     exist, see WORK-LOG turn 18). ui_data = the payload's params, filtered to
     the template's OWN declared params: every ui_data key becomes a user
     parameter (parametric_engine._sync_user_parameters), so nothing else may
     be in it. Frames never get new params,
     except F22's `panel_lip` (sync_panel_lip_param: created/updated when the
     payload's panelLip > 0, removed when 0 and nothing references it).
  3  solid_coordinator.build_solid_logic_v3 to the declared core.underside
     (the core body's dominant downward-facing face, H23 item 37: an area-
     weighted UV-grid average, n.z ~ -1), start at the payload's frameBottomZ,
     in the chosen wood
  4  FB-ORDER: both builds already end with ensure_frame_before_inlay (verified
     live in F3), so the whole block lands before the inlay whichever button
     came first; nothing extra here

Seeds (the Frame tab's SEEDED shape handles), F11 option B: the app sends
`seedGeometry`, its seeded outline as the template's OWN seed geometry
(template_data FRAME_SEED_MAP); the sketch build moves those seeds
(fb_engine/seed_geometry.py). No dimension and no parameter is added.

Pure orchestration: the Fusion-touching collaborators are injected, so the
fake-Fusion tests drive this exact code.
"""

from fb_engine.frame_definition import DEFAULT_FRAME_BOTTOM_EXPR, APPEARANCE_OPTIONS
from fb_engine.seed_geometry import apply_seed_geometry, SeedGeometryError
from fb_engine.parameter_schema import PANEL_LIP_PARAM, ParameterSchema

FRAME_TYPE_ATTR = ("FrameBuilder", "ComponentType")   # value "Frame" (frame_engine._create_incremental_component)
FRAME_TYPE_VALUE = "Frame"
FRAME_MEMBER_ATTR = ("FrameBuilder", "FrameComponent")  # value = the frame component's name (extrusion_engine)
# core.underside (frame_definition EXTRUSION_SETTINGS toFace): n.z ~ -1, measured
# on NURBS faces, so "~" is a declared bound, not an exact -1.
# H23 item 37 (MEASURED, 2026-10-02): a coarse pointOnFace + 4-corner average, checked against a
# single numeric bound, is a hair-trigger -- every real sculpted panel's TRUE underside has scored
# -0.98, -0.98, -0.97, -0.95, -0.90, -0.90, -0.86 (items 22/23) and then -0.6975 (T7 @ 7x9, 402
# in^2, by FAR its body's largest downward face; the next-best was -0.5482 at only 10.0 in^2) --
# refused by the old -0.7 bound by a margin of 0.0025, moving the bound per new panel is
# whack-a-mole. _face_downward_z now averages n.z over an AREA-WEIGHTED UV grid (the surface's own
# first fundamental form, |dU x dV| per sample -- exact for any parametrization, not an
# approximation) instead of 5 arbitrary points, and underside_face picks the most-downward face
# with an area-dominance sanity check against every other downward-scoring face, refusing only
# when nothing on the body points down at all -- no more per-panel numeric-bound tuning.
UNDERSIDE_GRID = 9  # samples per UV axis (81 points), cell centres only (never the exact boundary,
                     # where a trimmed NURBS face's own derivatives/normals can be degenerate)
# A second downward-scoring face whose area is this fraction of the top candidate's (or more) makes
# the "largest downward face" pick ambiguous -- refuse loudly rather than guess. MEASURED: every
# real panel's own edge faces are 10-20 in^2 against a 300-1200 in^2 underside (under 5%); this
# ratio has margin on both sides of that population and has not been tripped by a real panel yet.
AREA_DOMINANCE_RATIO = 0.5

SEEDS_NOT_APPLIED = "the payload has seeds but no seedGeometry (an app older than F11 sent it)"


PARAM_OWNER_ATTR = ("FrameBuilder", "owner")  # F22: the frame group's owner tag (panel_lip)


def panel_lip_of(payload):
    """The payload's panel lip in inches (0 when absent, non-numeric or negative)."""
    try:
        v = float(payload.get("panelLip") or 0)
    except (TypeError, ValueError):
        return 0.0
    return v if v > 0 else 0.0


def inset_window_of(payload):
    """The payload's inset window record ({enabled, cx, cy, w, h}), or None when absent/disabled/malformed
    (T82 item 6; `core/frame-record.js`'s own normalized shape, carried in framePayload() as `insetWindow`)."""
    w = payload.get("insetWindow")
    if not isinstance(w, dict) or not w.get("enabled"):
        return None
    try:
        float(w["cx"]), float(w["cy"]), float(w["w"]), float(w["h"])
    except (KeyError, TypeError, ValueError):
        return None
    return w


def sync_panel_lip_param(design, lip, log, value_input=None):
    """F22: the ONE writer of `panel_lip` (ParameterSchema FRAME group). lip > 0: create or update it
    ("<lip> in") and tag it FrameBuilder.owner. lip 0: remove it when it exists and nothing references it
    (after the previous frame is deleted, the lip offset that used it is gone). Returns what it did.
    `value_input(expr)` builds the adsk ValueInput (injected, so the fake-Fusion tests drive this code)."""
    assert ParameterSchema.is_frame_owned(PANEL_LIP_PARAM)
    params = design.userParameters
    p = params.itemByName(PANEL_LIP_PARAM)
    if lip > 0:
        expr = f"{lip} in"
        if p is None:
            if value_input is None:
                import adsk.core  # the real one (tests inject theirs)
                value_input = adsk.core.ValueInput.createByString
            p = params.add(PANEL_LIP_PARAM, value_input(expr), "in", "Panel lip: the panel is trimmed this far outside the frame outline")
            action = "created"
        else:
            p.expression = expr
            action = "updated"
        try:
            if not p.attributes.itemByName(*PARAM_OWNER_ATTR):
                p.attributes.add(*PARAM_OWNER_ATTR, "1")
        except Exception as e:  # the tag is bookkeeping; the parameter itself is what the build needs
            log(f"PANEL LIP: owner tag not written ({e})", "WARNING")
        log(f"PANEL LIP: {PANEL_LIP_PARAM} {action} = {expr}")
        return action
    if p is None:
        return "none"
    deps = getattr(getattr(p, "dependentParameters", None), "count", None)
    if deps == 0:
        p.deleteMe()
        log(f"PANEL LIP: lip 0, {PANEL_LIP_PARAM} removed")
        return "removed"
    log(f"PANEL LIP: lip 0 but {PANEL_LIP_PARAM} is still referenced ({deps}); kept", "WARNING")
    return "kept"


class SendFrameError(Exception):
    """A clear, user-facing reason the frame was not sent."""


def frame_ui_data(payload, declared_names):
    """The payload's params as the build's ui_data: only the template's own
    declared params (so no new user parameter), values as strings like the
    Sketch Builder palette sends them."""
    params = payload.get("params") or {}
    return {k: str(v) for k, v in params.items() if k in declared_names}


def declared_param_names(template):
    """Every param the template itself declares (the ones the build creates)."""
    return {p["Name"] for s in template.get("Sketches", []) for p in s.get("Parameters", [])}


def find_frames(design):
    """Components tagged as frames, by attribute."""
    out = []
    for a in design.findAttributes(*FRAME_TYPE_ATTR) or []:
        if getattr(a, "value", None) == FRAME_TYPE_VALUE and a.parent is not None and a.parent not in out:
            out.append(a.parent)
    return out


def delete_previous_frames(design, log):
    """Delete every tagged frame: first the features it owns elsewhere (by
    FrameComponent tag), then its occurrences. Returns the deleted names."""
    names = []
    for comp in find_frames(design):
        name = comp.name
        for a in list(design.findAttributes(*FRAME_MEMBER_ATTR) or []):
            if getattr(a, "value", None) == name and a.parent is not None:
                a.parent.deleteMe()
        for occ in list(design.rootComponent.allOccurrencesByComponent(comp) or []):
            occ.deleteMe()
        names.append(name)
        log(f"SEND FRAME: deleted previous frame {name}")
    return names


def _uv_point(u, v):
    import adsk.core  # the real one -- a fake evaluator's own methods never call this
    return adsk.core.Point2D.create(u, v)


def _face_downward_z(face, grid=UNDERSIDE_GRID, uv_point=None):
    """A face's own "how downward is it" score: the AREA-WEIGHTED mean n.z over a
    `grid` x `grid` UV sample (H23 item 37 -- replaces a pointOnFace + 4-corner
    average, MEASURED to hair-trigger: a doubly-curved sheet's corners can read
    very differently from its bulk, and a coarse 5-point average still missed a
    genuine 402 in^2 underside by 0.0025). Each sample is weighted by its own
    local area element |dU x dV| (the surface's own first fundamental form --
    exact for any parametrization, not an approximation), so a small locally-
    tilted patch can never outweigh the face's own dominant curvature.
    `uv_point` is injected (the real one builds an adsk.core.Point2D; a fake test
    can pass a plain tuple instead -- its own fake evaluator never needs the
    real type). Late-bound to the module-level `_uv_point` (not a plain default
    value) so a test can monkeypatch `send_frame._uv_point` once for every call,
    including the ones made deep inside underside_face/send_frame -- the same
    "collaborator injected" pattern sync_panel_lip_param already uses here for
    value_input."""
    uv_point = uv_point or _uv_point
    ev = face.evaluator
    rng = ev.parametricRange()
    u0, v0, u1, v1 = rng.minPoint.x, rng.minPoint.y, rng.maxPoint.x, rng.maxPoint.y
    wsum, zsum = 0.0, 0.0
    for i in range(grid):
        u = u0 + (u1 - u0) * (i + 0.5) / grid
        for j in range(grid):
            v = v0 + (v1 - v0) * (j + 0.5) / grid
            pt = uv_point(u, v)
            ok_n, n = ev.getNormalAtParameter(pt)
            ok_d, du, dv = ev.getFirstDerivative(pt)
            if not (ok_n and ok_d):
                continue
            w = _cross_mag(du, dv)
            wsum += w
            zsum += w * n.z
    return zsum / wsum if wsum > 0 else None


def _cross_mag(a, b):
    """|a x b| for two Vector3D-like objects (.x/.y/.z) -- the local area-scaling
    factor at a UV sample, from the surface's own partial derivatives."""
    cx = a.y * b.z - a.z * b.y
    cy = a.z * b.x - a.x * b.z
    cz = a.x * b.y - a.y * b.x
    return (cx * cx + cy * cy + cz * cz) ** 0.5


def underside_face(body, score=_face_downward_z):
    """The core body's TRUE underside: the face pointing down the most (its own
    area-weighted score, see _face_downward_z) whose area clearly DOMINATES every
    other face that also scores downward (H23 item 37 -- replaces a single
    numeric bound that needed re-tuning per new panel). Refuses (None) only when
    nothing on the body points down at all, or the pick is genuinely ambiguous
    (another downward face is comparably large -- reported, never guessed).
    `score` is injected (tests drive this selection logic directly with the real
    measured (z, area) pairs, without needing a fake UV-grid evaluator too)."""
    scored = [(z, face.area, face) for face in body.faces for z in (score(face),) if z is not None]
    if not scored:
        return None
    scored.sort(key=lambda t: t[0])
    best_z, best_area, best_face = scored[0]
    if best_z >= 0:
        return None  # nothing on this body points down at all
    for z, area, _face in scored[1:]:
        if z < 0 and area >= best_area * AREA_DOMINANCE_RATIO:
            return None  # ambiguous: another face is both downward and comparably large
    return best_face


def send_frame(design, payload, find_core_body, logger, *, resolve_template, build_sketch, build_solid, value_input=None):
    """Run [Send frame]. `find_core_body()` returns the B-spline body (or None);
    it is asked TWICE: up front (refuse without one) and again right before the
    solid build. MEASURED live (F11): a BRepFace taken before the delete + sketch
    build + reorder was invalid by the time the bars extruded to it
    ("InternalValidationError : face" on every bar, 0 bars built), so the target
    face is resolved fresh at the moment it is used.
    Returns {ok, error, deleted, frame, fit, seeds}; never raises for a
    user-facing reason (it is reported as `error`)."""
    log = lambda msg, level="INFO": logger.log(msg, level)
    seeds = dict(payload.get("seeds") or {})
    seed_geometry = payload.get("seedGeometry") or None
    # H23 item 42 (ONE build path, declared): `seeds` is the UI's own normalized handle values
    # (for the "N seed(s) sent but not applied" version-skew warning below, SEEDS_NOT_APPLIED's
    # own reason -- an app older than F11 sending seeds with no seedGeometry at all); whether
    # seed_geometry gets APPLIED must depend on seed_geometry alone. A fresh/unseeded record
    # (seeds == {}, e.g. right after picking a template, before Generate or a handle) still sends
    # the current params' own seed geometry (frame-panel.js's frameSendPayload, now unconditional)
    # -- this used to read `applied = False` here and silently fall through to the template's own
    # LEGACY literal/formula construction, which is where T7's reflex arc and T10's unsplit miter
    # (H23 item 41) were actually coming from, not from anything seed-related.
    applied = bool(seed_geometry)
    result = {"ok": False, "error": None, "deleted": [], "frame": None, "fit": None,
              "seeds": {"count": len(seeds), "applied": applied,
                        "reason": SEEDS_NOT_APPLIED if seeds and not applied else None}}
    try:
        template_id = payload.get("templateId")
        if not template_id:
            raise SendFrameError("No frame chosen: pick a template in the FRAME section.")
        core_body = find_core_body()
        if core_body is None:
            raise SendFrameError("No B-spline body in this document: press Send B-spline first "
                                 "(the frame's bars extrude up to its underside).")
        face = underside_face(core_body)
        if face is None:
            raise SendFrameError("The B-spline body has no downward face (core.underside) to extrude the bars to.")
        wood = payload.get("appearance")
        if wood is not None and wood not in APPEARANCE_OPTIONS:  # F12: never a silent fallback in Fusion
            raise SendFrameError(f"Unknown wood {wood!r}: choose one of {', '.join(APPEARANCE_OPTIONS)}.")
        try:
            template, _prefix = resolve_template(template_id)
        except ValueError as e:
            raise SendFrameError(f"Unknown frame template {template_id!r}: {e}")
        ui_data = frame_ui_data(payload, declared_param_names(template))
        if applied:  # refuse a bad seedGeometry BEFORE anything is deleted
            try:
                apply_seed_geometry(template, seed_geometry)
            except SeedGeometryError as e:
                raise SendFrameError(f"The frame shape could not be seeded: {e}")

        result["deleted"] = delete_previous_frames(design, log)
        lip = panel_lip_of(payload)
        result["panelLip"] = {"in": lip, "param": sync_panel_lip_param(design, lip, log, value_input)}
        data = {"ui_data": ui_data}
        if lip > 0:
            data["panel_lip"] = lip
        if applied:
            data["seed_geometry"] = seed_geometry
        window = inset_window_of(payload)
        if window:
            data["inset_window"] = window
        result["fit"] = build_sketch(style_id=template_id, external_logger=logger, data=data)
        frames = find_frames(design)
        if not frames:
            raise SendFrameError("The frame sketch build created no frame (see the Frame Builder log).")
        result["frame"] = frames[-1].name
        early_face_valid = getattr(face, "isValid", True)
        core_body = find_core_body()
        face = underside_face(core_body) if core_body is not None else None
        if face is None:
            raise SendFrameError("The B-spline body is gone after the frame sketch build (see the log).")
        log(f"SEND FRAME: underside face resolved fresh for the solid build (the early one valid: {early_face_valid})")
        z = payload.get("frameBottomZ")
        build_solid(to_face=face, start_offset_expr=f"{float(z)} in" if z is not None else DEFAULT_FRAME_BOTTOM_EXPR,
                    appearance_name=payload.get("appearance"), external_logger=logger)
        if seeds and not applied:
            log(f"SEND FRAME: {len(seeds)} seed(s) sent but not applied: {SEEDS_NOT_APPLIED}", "WARNING")
        result["ok"] = True
    except SendFrameError as e:
        result["error"] = str(e)
        log(f"SEND FRAME refused: {e}", "WARNING")
    return result
