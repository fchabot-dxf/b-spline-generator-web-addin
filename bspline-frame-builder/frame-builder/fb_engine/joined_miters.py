"""
joined_miters.py — F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a
manual toggle"). Every two-part-waist template (T14 Sand Timer, T15 Flask, T16 Arched Funnel, T17
Tulip) declares `Frame.regions["joinable"]`: the joints where its own upper and lower bar may be
built as ONE continuous bar (no miter cut there) instead of two mitered bars (today's default).

Mirrors fb_engine/panel_lip.py's and fb_engine/inset_window.py's own shape (pure, no adsk; an empty
`joined` set returns the template unchanged) -- but UNLIKE those two, a joined set genuinely depends
on the RECORD (which joints the user actually toggled), not a fixed board-independent geometry, so
it cannot use inset_window.py's own "classify() re-derives fixed names from nothing" trick (that
module's own docstring explains why: `solid_coordinator._declared_frame()` re-resolves the template
FRESH FROM DISK at solid-build time, with no access to this module's own in-memory mutation). The
joined set must therefore ALSO be stamped onto the Fusion component as an attribute (alongside the
existing TemplateId stamp, frame_engine.py) so `_declared_frame()` can re-apply this SAME mutation
before `declared_profiles.classify()` runs -- see JOINED_MITERS_ATTR below, and frame_engine.py /
solid_coordinator.py's own call sites.

The mechanism, once a joint IS joined:
  1. Its own declared miter line (p03_04's own "Miters" block entry, found by `miterSource`) is set
     `IsConstruction = True`. Fusion's own sketch-profile-finder only splits profiles at non-
     construction curves, so the two bars' own profiles MERGE into one continuous profile (zero new
     Fusion API surface -- `IsConstruction` was already a per-miter flag every phase declares).
  2. `regions["bars"]`'s two named bar entries merge into one (curves concatenated, the FIRST bar's
     own name kept) so `declared_profiles.bar_index`/`classify` (the N-BAR explicit-bars lookup
     every one of these 4 templates already uses) resolve both halves' curves to the SAME bar.
  3. The "bars" feature's own `bodyNames` (frame_definition.frame_features) is regenerated from the
     new, shorter bar list, so the extrude-and-trim feature builds one fewer body.

`regions["miters"]` itself is left UNCHANGED (still every possible miter position): nothing in the
Python build pipeline reads it for bar-grouping on these 4 templates (bar_index's explicit-"bars"
branch never consults it -- confirmed by reading declared_profiles.py directly before relying on
this), only the JS editor side reads it (to decide which miter LINES to draw in the 2D preview,
F31 item 2c's own UI piece, a separate concern from this module).
"""
import copy

JOINED_MITERS_ATTR = ("FrameBuilder", "JoinedMiters")  # the component-attribute group/name pair,
# alongside TEMPLATE_ID_ATTR (frame_engine.py) -- see this module's own docstring on why a joined
# set needs its own stamp, unlike panel_lip/inset_window.


def joinable_by_id(template):
    """`{id: entry}` for this template's own declared `regions["joinable"]` (empty dict if none)."""
    return {j["id"]: j for j in (template.get("Frame", {}).get("regions", {}).get("joinable") or [])}


def _flip_miter_construction(template, source_id):
    """Sets `IsConstruction = True` on the FIRST declared Miters-block entry whose own `Source`
    matches `source_id`, wherever it lives (mirrors panel_lip.py's own `_frame_sketch` scan -- a
    miter's own phase isn't assumed to be any one sketch by name). Returns True if found."""
    for sk in template.get("Sketches", []):
        for block in sk.get("Blocks", []):
            for m in block.get("Miters") or []:
                if m.get("Source") == source_id:
                    m["IsConstruction"] = True
                    return True
    return False


def apply_joined_miters(template, joined_ids):
    """The template with each of `joined_ids` (joint ids from its own declared
    `regions["joinable"]`) built as ONE continuous bar instead of two mitered ones -- or the
    template unchanged (`joined_ids` empty/absent, or an id not in this template's own declared
    set, which is silently ignored: a stale id from an old record after a template swap must never
    crash the build, same tolerance normalizeFrameRecord's own JS-side filtering already gives it)."""
    ids = set(joined_ids or [])
    joinable = joinable_by_id(template)
    to_apply = [joinable[i] for i in ids if i in joinable]
    if not to_apply:
        return template

    out = copy.deepcopy(template)
    regions = out["Frame"]["regions"]
    bars = regions["bars"]
    by_name = {b["name"]: b for b in bars}
    for j in to_apply:
        name_a, name_b = j["bars"]
        if name_a not in by_name or name_b not in by_name:
            continue  # already merged by another joined id sharing a bar, or a stale declaration
        by_name[name_a]["curves"] = list(by_name[name_a]["curves"]) + list(by_name[name_b]["curves"])
        bars[:] = [b for b in bars if b["name"] != name_b]
        del by_name[name_b]
        _flip_miter_construction(out, j["miterSource"])

    bar_names = [b["name"] for b in bars]
    for feat in out["Frame"]["features"]:
        if feat.get("id") == "bars":
            feat["bodyNames"] = bar_names
    return out
