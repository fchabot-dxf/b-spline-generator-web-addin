"""
stage_timing_lib.py — H23 item 29 part 1 (PREP ONLY, advisor dispatch 2026-10-02): the pure,
Fusion-free pieces of send_stage_timing.py's own harness, kept in their own module so they can be
unit-tested (test_stage_timing_lib.py) without a bridge -- "dry-run its non-Fusion parts with
fakes" is this file's whole reason to exist separately from the fusion_execute script itself.

No adsk.* import anywhere in this file.
"""
import json
import os
import re


def stage_durations(events, end_time):
    """`events`: a time-ordered list of (label, timestamp) pairs (e.g. every call the harness's
    own _send_progress wrapper recorded). Returns [(label, duration_seconds)] -- each stage's
    duration is the time from ITS OWN timestamp to the NEXT event's (or `end_time` for the last
    one). An empty `events` list returns an empty list; a single event returns one stage running
    from its own timestamp to `end_time`."""
    out = []
    for i, (label, ts) in enumerate(events):
        nxt = events[i + 1][1] if i + 1 < len(events) else end_time
        out.append((label, nxt - ts))
    return out


def load_captured_payload(path):
    """Reads a captured Send payload (normally ~/.bspline-frame-builder/last_send.json, the file
    b-spline-gen.py's own _dump_last_send already writes on every real Send -- see that function's
    own docstring). Returns (payload_dict, warning_or_None).

    _dump_last_send deliberately EXCLUDES 'stepVariants' (the raw STEP geometry text, large and not
    needed for its own debugging purpose) -- so a payload loaded this way has no STEP text to
    import, and the harness's own STEP-import stage will be skipped with a stated reason rather
    than silently reporting a 0.0s "import". A full timing run needs a payload that DOES carry
    stepVariants/stepText -- point PAYLOAD_PATH at one instead (e.g. a capture taken with
    _dump_last_send's own exclusion temporarily lifted for one Send, by hand, never committed)."""
    if not os.path.exists(path):
        return None, f"no captured payload at {path} -- run a real Send first, or point PAYLOAD_PATH elsewhere"
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    has_steps = bool(payload.get("stepVariants")) or bool(payload.get("stepText"))
    warning = None if has_steps else (
        "captured payload has no stepVariants/stepText (last_send.json's own _dump_last_send "
        "excludes it) -- the STEP-import stage will be skipped")
    return payload, warning


def unwrap_captured_frame_payload(payload):
    """last_send.json's own 'frame' key is POST-PROCESSING shape -- b-spline-gen.py's
    _handle_send_frame calls `_merge_last_send_key('frame', {'payload': <original payload>,
    'result': <send_frame's own return>})` AFTER the frame actually builds, overwriting whatever
    `_dump_last_send` wrote earlier for that key. So a captured file's own `payload['frame']` is
    `{'payload': ..., 'result': ...}` by the time a Send finishes -- NOT the raw pre-send shape
    `_handle_generate` itself expects when it later reads `data.get('frame')`
    (b-spline-gen.py:1691, `frame_payload = data.get('frame')`). Replaying a captured file through
    `_handle_generate` needs this unwrap first, or `_handle_send_frame` receives the wrapper dict
    (no 'templateId' key at its own top level) instead of the real frame payload. A payload with no
    'frame' key at all, or one that's already unwrapped (no 'payload' sub-key), passes through
    unchanged."""
    frame = payload.get('frame')
    if isinstance(frame, dict) and 'payload' in frame:
        return dict(payload, frame=frame['payload'])
    return payload


def frame_build_ui_data(payload, declared_names):
    """The same ui_data construction fb_engine/send_frame.py's own frame_ui_data() makes (only the
    template's own declared params become user params, parametric_engine._sync_user_parameters's
    own rule), but built from a captured TOP-LEVEL Send payload rather than the frame sub-payload
    alone -- MEASURED live (H23 item 29 part 2): the frame's own params
    (payload['frame']['params']) carry NO board size at all (widthIn/heightIn live one level up,
    in the top-level payload['params']) -- passing frame['params'] alone (as this harness's first
    draft did) starts the empty-doc comparison missing every frame-declared gate
    (ck_arc_shoulder_weld etc.), which a real captured T1 seed turned into a live REFLEX ARC crash
    that has nothing to do with the seed itself. Both levels are merged before filtering to the
    template's own declared names, matching what send_frame.py's real call receives when `payload`
    there IS the frame sub-payload (board dims already present at that level in the real flow)."""
    frame = payload.get('frame') or {}
    merged = {**(payload.get('params') or {}), **(frame.get('params') or {})}
    return {k: str(v) for k, v in merged.items() if k in declared_names}


_PHASE_RE = re.compile(r"(Discovery|Extrusion|Finishing) Phase: ([\d.]+)s")
_TOTAL_RE = re.compile(r"SOLID SYNTHESIS FINISHED OK \(Total: ([\d.]+)s\)")


def parse_solid_coordinator_phases(log_text):
    """SolidCoordinator.run() (fb_engine/solid_coordinator.py) already logs its own per-phase
    timing -- 'Discovery Phase: X.XXs', 'Extrusion Phase: X.XXs', 'Finishing Phase: X.XXs', and a
    final 'SOLID SYNTHESIS FINISHED OK (Total: X.XXs)' -- read those back from the DebugLogger's
    own log text instead of monkeypatching SolidCoordinator itself (its own run() is one long
    method, not a set of separately-callable per-phase functions, so wrapping would mean editing
    production code -- reading its own already-written numbers back needs none).

    Returns {'discovery': s, 'extrusion': s, 'finishing': s, 'total': s} with any phase whose line
    never appeared left out (e.g. the build aborted before reaching it)."""
    out = {}
    for name, secs in _PHASE_RE.findall(log_text):
        out[name.lower()] = float(secs)
    m = _TOTAL_RE.search(log_text)
    if m:
        out["total"] = float(m.group(1))
    return out
