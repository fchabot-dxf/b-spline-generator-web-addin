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
     be in it. Frames never get new params.
  3  solid_coordinator.build_solid_logic_v3 to the declared core.underside
     (the core body's face whose normal at pointOnFace has n.z ~ -1), start at
     the payload's frameBottomZ, in the chosen wood
  4  FB-ORDER: both builds already end with ensure_frame_before_inlay (verified
     live in F3), so the whole block lands before the inlay whichever button
     came first; nothing extra here

Seeds (the Frame tab's SEEDED shape handles) are NOT applied in Fusion yet:
the template phases have no dimension to receive them (T1's seed radius dims
are deleted by p02_09, T2 has none), so mapping them needs new plain
dimensions proven on Fusion. That is a GATE (WORK-LOG turn 18); the result
says so instead of dropping them silently.

Pure orchestration: the Fusion-touching collaborators are injected, so the
fake-Fusion tests drive this exact code.
"""

from fb_engine.frame_definition import DEFAULT_FRAME_BOTTOM_EXPR

FRAME_TYPE_ATTR = ("FrameBuilder", "ComponentType")   # value "Frame" (frame_engine._create_incremental_component)
FRAME_TYPE_VALUE = "Frame"
FRAME_MEMBER_ATTR = ("FrameBuilder", "FrameComponent")  # value = the frame component's name (extrusion_engine)
# core.underside (frame_definition EXTRUSION_SETTINGS toFace): n.z ~ -1, measured
# on NURBS faces, so "~" is a declared bound, not an exact -1.
UNDERSIDE_MAX_NORMAL_Z = -0.9

SEEDS_NOT_APPLIED = ("seeded shape handles are not applied in Fusion yet: the template phases have "
                     "no dimension to receive them (gate, WORK-LOG turn 18)")


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


def underside_face(body):
    """The core body's face pointing down the most (n.z at pointOnFace), when it
    is within the declared bound; else None."""
    best, best_z = None, 0.0
    for face in body.faces:
        ok, n = face.evaluator.getNormalAtPoint(face.pointOnFace)
        if ok and n.z < best_z:
            best, best_z = face, n.z
    return best if best is not None and best_z <= UNDERSIDE_MAX_NORMAL_Z else None


def send_frame(design, payload, core_body, logger, *, resolve_template, build_sketch, build_solid):
    """Run [Send frame]. Returns {ok, error, deleted, frame, fit, seeds}; never
    raises for a user-facing reason (it is reported as `error`)."""
    log = lambda msg, level="INFO": logger.log(msg, level)
    seeds = dict(payload.get("seeds") or {})
    result = {"ok": False, "error": None, "deleted": [], "frame": None, "fit": None,
              "seeds": {"count": len(seeds), "applied": False, "reason": SEEDS_NOT_APPLIED if seeds else None}}
    try:
        template_id = payload.get("templateId")
        if not template_id:
            raise SendFrameError("No frame chosen: pick a template in the FRAME section.")
        if core_body is None:
            raise SendFrameError("No B-spline body in this document: press Send B-spline first "
                                 "(the frame's bars extrude up to its underside).")
        face = underside_face(core_body)
        if face is None:
            raise SendFrameError("The B-spline body has no downward face (core.underside) to extrude the bars to.")
        try:
            template, _prefix = resolve_template(template_id)
        except ValueError as e:
            raise SendFrameError(f"Unknown frame template {template_id!r}: {e}")
        ui_data = frame_ui_data(payload, declared_param_names(template))

        result["deleted"] = delete_previous_frames(design, log)
        result["fit"] = build_sketch(style_id=template_id, external_logger=logger, data={"ui_data": ui_data})
        frames = find_frames(design)
        if not frames:
            raise SendFrameError("The frame sketch build created no frame (see the Frame Builder log).")
        result["frame"] = frames[-1].name
        z = payload.get("frameBottomZ")
        build_solid(to_face=face, start_offset_expr=f"{float(z)} in" if z is not None else DEFAULT_FRAME_BOTTOM_EXPR,
                    appearance_name=payload.get("appearance"), external_logger=logger)
        if seeds:
            log(f"SEND FRAME: {len(seeds)} seed(s) sent but not applied: {SEEDS_NOT_APPLIED}", "WARNING")
        result["ok"] = True
    except SendFrameError as e:
        result["error"] = str(e)
        log(f"SEND FRAME refused: {e}", "WARNING")
    return result
