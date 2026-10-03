"""
timeline_health.py — H23 item 32: the correct "is this Fusion timeline healthy" predicate.

MEASURED live (2026-10-02): a Fusion `TimelineGroup`'s own `healthState` is ALWAYS
`UnknownFeatureHealthState` (5), regardless of its children's actual health -- confirmed on a
trivial, unrelated group (two freshly-created sketches, each independently Healthy, grouped with
nothing else in the document) reporting health=5 with an empty `errorOrWarningMessage`, identical
to a real B-Spline Set import's own auto-created "Group1" (also health=5, empty message, while
BOTH of its own children -- " Clean:1", "Base Feature1" -- report Healthy). A group is a visual
container, not a feature with its own geometric health rollup; Fusion's API simply has no "this
group's contents are all fine" state to report.

Three repro scripts (underside_extrude_probe.py, f20_live_parity.py, record_frame_parity.py) each
independently checked `item.healthState == Healthy` across every top-level timeline item, which
means EVERY one of them has been reporting a false "unhealthy" the moment a real Send (through
`_handle_generate`'s own STEP import) creates ANY timeline group -- which it always does. The
underlying features were never actually unhealthy; the check itself was wrong. Declared once here
so the three callers (and anything else that asks this question later) share one correct, tested
answer instead of three copies that can drift.

No adsk import at module level -- callers pass real timeline items in; test_timeline_health.py
exercises the pure recursion with fakes, no Fusion needed.
"""


def is_item_healthy(item, healthy_value=0):
    """A single timeline item (feature OR group) is healthy iff: a plain feature reports the
    Healthy state directly, or a GROUP's own children are ALL healthy (recursively) -- never the
    group's own `healthState`, which carries no real signal (see module docstring). `healthy_value`
    defaults to `adsk.fusion.FeatureHealthStates.HealthyFeatureHealthState`'s own integer value (0)
    so this stays import-free; pass the real enum value if it's ever not 0."""
    if getattr(item, "isGroup", False):
        return all(is_item_healthy(item.item(i), healthy_value) for i in range(item.count))
    return item.healthState == healthy_value


def unhealthy_names(timeline, healthy_value=0):
    """Every top-level timeline item's own name that is NOT healthy by `is_item_healthy` -- a
    group counts as unhealthy only if something genuinely unhealthy is inside it (named by the
    group's own top-level name, since that's what a user sees collapsed in the UI)."""
    out = []
    for i in range(timeline.count):
        it = timeline.item(i)
        if not is_item_healthy(it, healthy_value):
            out.append(it.name)
    return out


def is_timeline_healthy(timeline, healthy_value=0):
    return all(is_item_healthy(timeline.item(i), healthy_value) for i in range(timeline.count))
