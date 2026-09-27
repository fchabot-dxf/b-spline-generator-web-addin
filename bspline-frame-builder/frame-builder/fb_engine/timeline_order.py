"""
timeline_order.py — FB-ORDER (Fred 2026-09-26): "the inlay sketch should
interact with the frame-builder sketches, but the frame is generated
after it, so the inlay can't see it" / "move the frame before the inlay
but still after the initial comp creation".

Target timeline order:
    [Send to Fusion: B-Spline Set comp + body]
 -> [Frame_N comp + its sketches/planes/features]
 -> [Plane for L... / Source - L... (the inlay)]

Two layers, deliberately split:
  * `reorder_frame_before_inlay` — the PURE algorithm. Takes a
    timeline-LIKE object (anything with `.count` and `.item(i)` -> an
    item exposing `.name`/`.index`/`.canReorder(beforeIndex)`/`.reorder(i)`) and two
    predicate functions that each take an ITEM (not just its name, so a
    real predicate can inspect `.entity`/owning-component identity
    without a name-collision risk). No adsk import — testable with a
    plain fake shim, matching the dispatch's own explicit test list.
  * `reorder_frame_before_inlay_in_design` — the real-Fusion glue: knows
    WHICH predicates to use (declared name patterns for the inlay;
    "does this timeline item belong to the Frame_N component" for the
    frame block) and calls the pure function above with
    `design.timeline`. This is the one piece "NO FUSION" (this turn's own
    dispatch constraint) means is UNTESTED against the real API — the
    exact property Fusion exposes for "which component owns this
    TimelineObject's entity" can differ by entity type (Occurrence vs.
    Sketch vs. ConstructionPlane vs. Feature); flagged for the advisor's
    own live verification pass (same "NO FUSION -> advisor verifies
    live" split this whole engine already uses elsewhere).

Advisor's own live measurement (ROADMAP.md "Queued — FB-ORDER"):
TimelineObject.reorder of a LATER item to an EARLIER index works
(canReorder True); moving the EARLIER inlay/plane LATER is refused
(canReorder False) — so this always moves the frame earlier, never the
inlay later.
"""

# Declared once: the attribute the frame build stamps on every FEATURE it
# creates, naming its Frame_N component. MEASURED live (F3): Fusion puts a
# cut feature in the component of the body it CUTS — the TRIM_CUT's
# parentComponent is 'Clean', not 'Frame_1' — so component ownership alone
# cannot find it. Written by extrusion_engine, read by is_frame_timeline_item.
FRAME_MEMBER_ATTR = ("FrameBuilder", "FrameComponent")


def _declared_frame_member(entity):
    """The Frame_N name stamped via FRAME_MEMBER_ATTR, or None."""
    try:
        attr = entity.attributes.itemByName(*FRAME_MEMBER_ATTR)
        return attr.value if attr else None
    except Exception:
        return None


# Declared once (not hand-rolled per call site) — the inlay's own two
# timeline item name prefixes: b-spline-gen.py's own naming,
# `f"Plane for {sketch_name}"` (_compute_artwork_plane) and
# `f"Source - {sketch_name}"`. MEASURED live (F11): a shape-lattice layer's
# plane is "Plane for pattern lattice-…", so the old "Plane for L" missed it.
INLAY_NAME_PREFIXES = ("Plane for ", "Source - ")


def is_inlay_item_name(name):
    """True if a timeline item's own name marks it as (part of) the
    per-layer inlay Send to Fusion creates — the plane it projects onto,
    or the imported/constrained sketch itself."""
    name = name or ""
    return any(name.startswith(prefix) for prefix in INLAY_NAME_PREFIXES)


def reorder_frame_before_inlay(timeline, is_frame_item, is_inlay_item, logger=None):
    """Pure reorder algorithm — no adsk import.

    Args:
        timeline: object with `.count` (int) and `.item(i)` -> an item
            exposing `.name` (str), `.index` (int, current position),
            `.canReorder(beforeIndex)` (method -> bool), `.reorder(new_index)` (method).
        is_frame_item: predicate(item) -> bool, which items belong to
            the frame block being moved.
        is_inlay_item: predicate(item) -> bool, which items are the
            inlay this block moves in front of.
        logger: optional object with `.log(msg, level='INFO')`.

    Returns:
        {"moved": bool, "reason": str|None} — `reason` is set whenever
        `moved` is False (no inlay, no frame items, already in order, or
        which item refused).
    """
    def _log(msg, level="INFO"):
        if logger:
            try:
                logger.log(msg, level)
            except Exception:
                pass

    items = [timeline.item(i) for i in range(timeline.count)]
    frame_items = [it for it in items if is_frame_item(it)]
    inlay_items = [it for it in items if is_inlay_item(it)]

    if not inlay_items:
        return {"moved": False, "reason": "no inlay present"}
    if not frame_items:
        return {"moved": False, "reason": "no frame items present"}

    earliest_inlay_index = min(it.index for it in inlay_items)

    # Only items CURRENTLY after the inlay need to move — a frame item
    # already ahead of it (e.g. a prior run already reordered it, or it's
    # somehow earlier by construction) is left exactly where it is.
    to_move = sorted(
        (it for it in frame_items if it.index > earliest_inlay_index),
        key=lambda it: it.index,
    )
    if not to_move:
        return {"moved": False, "reason": "already in order"}

    # Move each, in ORIGINAL relative order, to the (advancing) target
    # position -- lands the whole block, in its own original order,
    # immediately before the inlay's own original position.
    # Each item is checked (`canReorder(beforeIndex)`, a METHOD, MEASURED F3)
    # right before ITS move, not all up front: MEASURED live (F11), a sketch
    # inside Frame_N refuses to go before the inlay while Frame_N's own
    # occurrence is still after it, and only accepts once the occurrence
    # (first in the block) has moved. One refusal still moves NOTHING in the
    # end: the items already moved go back, in reverse order, each before its
    # original successor (children first, so no item ever lands before the
    # component it lives in).
    items_before = [timeline.item(i) for i in range(timeline.count)]
    successor = {id(it): (items_before[it.index + 1] if it.index + 1 < len(items_before) else None) for it in to_move}
    target = earliest_inlay_index
    moved = []
    for it in to_move:
        if not it.canReorder(target):
            for m in reversed(moved):
                nxt = successor[id(m)]
                m.reorder(nxt.index if nxt is not None else timeline.count)
            _log(f"FB-ORDER: '{it.name}' refused reorder -- moving nothing.", "WARNING")
            return {"moved": False, "reason": f"'{it.name}' refused reorder"}
        it.reorder(target)
        moved.append(it)
        target += 1

    _log(f"FB-ORDER: moved {len(to_move)} frame timeline item(s) before the inlay.")
    return {"moved": True, "reason": None}


def _component_name_for_entity(entity):
    """Best-effort "which component does this TimelineObject's entity
    belong to" — the property Fusion exposes differs by entity type
    (UNVERIFIED beyond this turn's own reading of the API docs; "NO
    FUSION" this turn, flagged for the advisor's own live check).
    An Occurrence (the frame's own component-creation item) exposes
    `.component` (the child it creates); everything else built INSIDE
    that component (sketches, construction planes, features) exposes
    `.parentComponent`. Returns None (never raises) if neither is
    present or reading either throws — the caller treats that as "not a
    frame item" rather than crashing the whole reorder."""
    if entity is None:
        return None
    try:
        comp = getattr(entity, "component", None)
        if comp is not None:
            return comp.name
    except Exception:
        pass
    try:
        comp = getattr(entity, "parentComponent", None)
        if comp is not None:
            return comp.name
    except Exception:
        pass
    return None


def is_frame_timeline_item(timeline_item, frame_component_name):
    """`is_frame_item` predicate for `reorder_frame_before_inlay` — a
    timeline item belongs to the frame block if its own entity lives in
    (or, for the occurrence-creation item itself, CREATES) the Frame_N
    component `_create_incremental_component` (frame_engine.py) already
    names — the one place that name is decided, so this takes it as a
    parameter rather than re-deriving it."""
    try:
        entity = timeline_item.entity
    except Exception:
        return False
    if entity is None:
        return False
    declared = _declared_frame_member(entity)
    if declared is not None:
        return declared == frame_component_name
    return _component_name_for_entity(entity) == frame_component_name


def reorder_frame_before_inlay_in_design(design, frame_component_name, logger=None):
    """Real-Fusion glue — see this module's own docstring for what's
    verified (the pure algorithm, unit-tested) vs. not (this function,
    "NO FUSION" this turn; the advisor verifies it live)."""
    if not design or not getattr(design, "timeline", None):
        return {"moved": False, "reason": "no timeline"}

    is_frame_item = lambda it: is_frame_timeline_item(it, frame_component_name)
    is_inlay_item = lambda it: is_inlay_item_name(getattr(it, "name", None))

    return reorder_frame_before_inlay(design.timeline, is_frame_item, is_inlay_item, logger=logger)


# Declared once: reorder outcomes that are NORMAL (nothing to warn about).
# Every other not-moved reason (a refusal, no frame items, no timeline)
# is logged as a warning by ensure_frame_before_inlay below.
BENIGN_NOT_MOVED_REASONS = ("no inlay present", "already in order")


def ensure_frame_before_inlay(design, frame_component_name, logger=None):
    """The ONE call every frame build step ends with. The sketch build
    (frame_engine.run_sketch_only / run_full_synthesis) AND the solid build
    (solid_coordinator.SolidCoordinator.run) both call it, because each one
    appends new frame items to the END of the timeline. Measured live in
    F2: with only the sketch build calling it, the solid build's BAR
    extrudes + TRIM_CUT landed AFTER the inlay. Re-running the reorder
    moves only the items currently after the inlay, so the block ends up
    contiguous (occurrence -> sketches -> extrudes -> trim) right before
    the inlay. Returns the reorder result dict; warns on any
    non-benign not-moved reason (the any-refusal-moves-nothing rule
    stays in reorder_frame_before_inlay)."""
    result = reorder_frame_before_inlay_in_design(design, frame_component_name, logger)
    if not result["moved"] and result["reason"] not in BENIGN_NOT_MOVED_REASONS:
        if logger:
            try:
                logger.log(f"FB-ORDER: frame NOT reordered before inlay — {result['reason']}", "WARNING")
            except Exception:
                pass
    return result
