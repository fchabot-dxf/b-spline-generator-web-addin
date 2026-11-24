"""
frame_bars.py -- Bars Off (Fred 2026-11-23: "a version of a board WITHOUT the wood frame, but with the board's outline
cut to the frame's shape"). The web app's frame record carries `bars: false` (core/frame-record.js; absent = on), and
[Send frame] then builds the frame SHAPE only: the same sketch, the same TRIM_CUT (the panel cut to the outline, or to
its panel lip) and the same inset-window hole cut -- but no bar body, main or window.

The solid build re-resolves the template from disk (solid_coordinator._declared_frame), so the choice travels as a
component attribute stamped by the sketch build -- the JoinedMiters pattern (fb_engine/joined_miters.py) -- and a
palette rebuild of the same frame reads it too. Absent attribute = bars on (every frame built before this).

Pure: no adsk.
"""

BARS_ATTR = ("FrameBuilder", "Bars")  # the frame component's attribute group/name; value BARS_OFF when off
BARS_OFF = "off"


def bars_of(payload):
    """True (build the bars) unless the payload says `bars: false` literally -- anything else is the old default."""
    return not (isinstance(payload, dict) and payload.get("bars") is False)


def stamp_bars(comp, bars, log=None):
    """Tag the frame component BARS_OFF when `bars` is False; nothing at all when on (an old frame is untagged)."""
    if bars is not False or comp is None:
        return False
    try:
        comp.attributes.add(BARS_ATTR[0], BARS_ATTR[1], BARS_OFF)
        return True
    except Exception as e:  # a component that refuses attributes builds with bars, as before
        if log:
            log(f"Could not tag component '{getattr(comp, 'name', '?')}' with the Bars attribute: {e}", "WARNING")
        return False


def bars_on_comp(comp):
    """False when the frame component carries BARS_OFF, else True (untagged / unreadable = bars on)."""
    try:
        a = comp.attributes.itemByName(*BARS_ATTR)
    except Exception:
        return True
    return not (a and getattr(a, "value", None) == BARS_OFF)


def drop_bar_plans(to_process):
    """The extrude list without its BAR plans (the main bars and the window bars): the SURROUND trim and the
    window hole cut stay. `to_process` = [(profile, plan, index)] (extrusion_engine's own list)."""
    return [c for c in to_process if c[1].get("kind") != "BAR"]
