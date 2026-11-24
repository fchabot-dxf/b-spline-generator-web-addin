"""
back_mode.py -- the board's Back mode (the Thicken line's Back: Shell / Flat, the web app's P.backMode) as the frame
builder sees it: it chooses how a cut through the panel reaches past it (frame_definition.CUT_THROUGH_BY_BACK_MODE;
2026-11-24: through all on both sides refused a flat-bottom panel, and a fixed distance is not bit-identical to it on a
shell around an inset window's hole -- so shell keeps through all, flat cuts by the distance).

The Send puts the board's back mode on the frame payload (`backMode`, b-spline-gen send_targets.frame_payload_of);
[Send frame] stamps it on the frame component and the solid build reads it there -- the Bars Off pattern
(fb_engine/frame_bars.py), so a palette rebuild of the same frame cuts the same way. Only a non-default mode is stamped;
an untagged frame (every frame built before this) is shell.

Pure: no adsk.
"""
from fb_engine.frame_definition import CUT_THROUGH_BY_BACK_MODE, DEFAULT_BACK_MODE

BACK_MODE_ATTR = ("FrameBuilder", "BackMode")  # the frame component's attribute group/name; value = the mode


def back_mode_of(payload):
    """The payload's declared back mode; absent / unknown = DEFAULT_BACK_MODE (shell)."""
    mode = payload.get("backMode") if isinstance(payload, dict) else None
    return mode if mode in CUT_THROUGH_BY_BACK_MODE else DEFAULT_BACK_MODE


def stamp_back_mode(comp, mode, log=None):
    """Tag the frame component with `mode` when it is not the default; nothing at all for shell. True when stamped."""
    if comp is None or mode == DEFAULT_BACK_MODE or mode not in CUT_THROUGH_BY_BACK_MODE:
        return False
    try:
        comp.attributes.add(BACK_MODE_ATTR[0], BACK_MODE_ATTR[1], mode)
        return True
    except Exception as e:  # a component that refuses attributes cuts as a shell, as before
        if log:
            log(f"Could not tag component '{getattr(comp, 'name', '?')}' with the BackMode attribute: {e}", "WARNING")
        return False


def back_mode_on_comp(comp):
    """The frame component's stamped back mode; untagged / unreadable / unknown = DEFAULT_BACK_MODE."""
    try:
        a = comp.attributes.itemByName(*BACK_MODE_ATTR)
    except Exception:
        return DEFAULT_BACK_MODE
    mode = getattr(a, "value", None) if a else None
    return mode if mode in CUT_THROUGH_BY_BACK_MODE else DEFAULT_BACK_MODE
