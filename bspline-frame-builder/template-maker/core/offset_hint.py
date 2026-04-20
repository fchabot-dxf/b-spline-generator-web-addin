"""Hint builder for Fusion OffsetConstraint picks.

OffsetConstraint is the special case in the Template Maker grammar.
The other constraints emit ``Constraints.<Type>(target1, target2)``
statements that ``phase_parser._build_constraint_step`` turns into
``{'Type': '<Type>', 'Targets': [...]}`` step dicts. Offsets don't
fit that mould for three reasons:

* The runtime treats an offset as a Step (``{'Type': 'Offset', ...}``)
  in the BuildSequence, not a regular constraint. It's applied via
  ``sketch.geometricConstraints.addOffset2(...)`` which internally
  builds the OffsetConstraint + its owning dimension in one call.
* Its targets come as *collections* (``parentCurves`` / ``childCurves``)
  plus a scalar ``dimension``, not the per-subtype single slots in
  ``CONSTRAINT_TARGET_PROPS_BY_TYPE``. The generic constraint target
  walk can't be pointed at a collection without drift.
* The useful UX is inverted — users usually click the **offset-result
  (child) curves** rather than the OC glyph itself. The picker needs
  to reverse-lookup the owning OC from any selected child.

This module owns:

1. ``find_owning_offset_constraint(curve)`` — the child → OC lookup.
2. ``parent_curves`` / ``child_curves`` / ``distance_expression`` —
   safe accessors that don't escape on stale proxies.
3. ``derive_target_names(source_names, child_count)`` — the
   ``offset_<parent>`` naming rule.
4. ``build_offset_step(oc)`` — emits the parseable ``Offset.From(...)``
   hint string that ``phase_parser._build_offset_step`` converts into
   the final step dict.

Direction and CornerIDs are deliberately omitted from the emitted
step. The user's existing hand-written templates don't set them —
``addOffset2`` takes direction from the sign of ``DistanceExpr``, and
corner naming is a downstream concern for rectangle cases that the
user hand-edits after generation.

All slot probes go through ``_safe_getattr`` because Python 3's
``getattr(obj, name, default)`` only swallows ``AttributeError``, and
several Fusion subtypes raise a bare ``RuntimeError`` ("3 : object
does not support attributes") when a proxy's slot refuses access.
Unchecked getattr on a stale or out-of-subtype slot is a
native-AV / process-kill hazard; the wrapper returns ``None``
instead so the walk can continue.
"""

from entity_helpers import get_fb_name
from entity_util import _get_native, _same_entity
# ``[foc-*]`` diagnostic markers narrow the CoincidentConstraint crash
# chain down to a single slot. The last Fusion reproduction stopped
# exactly at ``[bp-expand] find_owning_offset_constraint`` with no
# completion line — the native AV is somewhere inside this function's
# slot walk. fsync-per-write so the last marker survives even a hard
# process kill.
from detection_log import _log_detection


# Type tag matching the runtime's dispatch in ``parametric_engine._process_sequence``
# (the ``t == "Offset"`` branch). Centralised here so the hint builder,
# parser, and tests all reference the same constant.
OFFSET_STEP_TYPE = 'Offset'


def _safe_getattr(obj, name):
    """``getattr`` + broad try/except guard for Fusion proxy slot probes.

    Python 3's ``getattr(obj, name, default)`` only swallows
    ``AttributeError`` — Fusion raises a bare ``RuntimeError``
    ("3 : object does not support attributes") for subtype-refused
    slots. Any exception becomes ``None`` here so the walk can skip
    the bad slot and carry on.
    """
    try:
        return getattr(obj, name, None)
    except Exception:
        return None


def _iter_curve_collection(coll):
    """Yield items from a Fusion ``SketchCurveList`` / ``SketchEntityList``.

    Fusion exposes these collections as ``count`` + ``item(i)``. For
    tests we also accept plain Python iterables.

    Per-item ``try/except`` around ``coll.item(i)`` keeps one stale
    proxy in the middle of the list from taking the whole walk down —
    same pattern as ``relation_hints._iter_connected_entities``.
    """
    if coll is None:
        return
    try:
        count = getattr(coll, 'count', None)
        if count is not None:
            for i in range(count):
                try:
                    yield coll.item(i)
                except Exception:
                    continue
            return
    except Exception:
        pass
    try:
        for item in coll:
            yield item
    except Exception:
        return


def parent_curves(oc):
    """List the native parent (source) curves of an OffsetConstraint.

    Returns ``[]`` if the collection is unreachable — the gate treats
    an empty parent list as unowned, which is the correct refusal
    for a stale proxy.
    """
    return list(_iter_curve_collection(_safe_getattr(oc, 'parentCurves')))


def child_curves(oc):
    """List the native child (offset-result) curves of an OffsetConstraint."""
    return list(_iter_curve_collection(_safe_getattr(oc, 'childCurves')))


def distance_expression(oc):
    """Read the offset distance expression from the OC's owning dimension.

    Layout: ``OffsetConstraint.dimension.parameter.expression`` — a
    parametric string like ``"boundingboxoffset"`` or ``"5 mm"``.
    Every step in the chain is read through ``_safe_getattr`` because
    any one of them can refuse on a settling proxy.

    Falls back to ``.value`` (numeric) if ``.expression`` is missing,
    and to the string ``'0'`` if neither is readable — ``'0'`` is a
    benign placeholder the user will see in the generated step and
    can immediately spot as wrong.
    """
    dim = _safe_getattr(oc, 'dimension')
    if dim is None:
        return '0'
    param = _safe_getattr(dim, 'parameter')
    if param is None:
        return '0'
    expr = _safe_getattr(param, 'expression')
    if expr:
        return str(expr)
    val = _safe_getattr(param, 'value')
    if val is not None:
        return str(val)
    return '0'


def derive_target_names(source_names, child_count):
    """Produce ``TargetIDs`` for the generated offset step.

    Naming rules, in order of preference:

    * **N sources, N children (same count)** — 1:1 by index.
      ``['horn_TL', 'horn_L'] -> ['offset_horn_TL', 'offset_horn_L']``.
      This is the common case: an offset of a chain produces one child
      per source segment in the same order.
    * **One source, one child** — ``['offset_<source>']``.
    * **Mismatched counts** — fall back to
      ``['offset_<first_source>_01', '_02', ...]`` for ``child_count``
      entries. Conscious of being simple rather than clever: if the
      user hits this branch often, that's a signal to rethink the
      sketch, not to overfit the naming rule.
    * **No sources** — ``['offset_01', '_02', ...]``. Indicates a
      stale proxy or an unnamed parent chain; the generated step
      will still be syntactically valid but the user will want to
      investigate.

    Deliberately does not consult the child curves' own names — child
    curves in a fresh offset carry Fusion-generated labels that
    change between rebuilds and would produce unstable TargetIDs.
    """
    if not source_names:
        return [f'offset_{i + 1:02d}' for i in range(child_count)]
    if child_count == 0:
        return []
    if child_count == 1:
        return [f'offset_{source_names[0]}']
    if child_count == len(source_names):
        return [f'offset_{s}' for s in source_names]
    first = source_names[0]
    return [f'offset_{first}_{i + 1:02d}' for i in range(child_count)]


def _named_parent_ids(parents):
    """Extract FrameBuilder IDs from a list of parent curves.

    Skips the sentinels ``get_fb_name`` falls back to when an entity
    has no FrameBuilder tag — ``'Entity'``, ``'None'``, ``Sketch*``,
    ``Vertex of*``. An untagged parent is the gate's job to reject
    upstream, but if one slips through we'd rather emit a
    ``SourceID`` list that's obviously short than one with a
    garbage label like ``"Entity"``.
    """
    names = []
    for p in parents:
        native = _get_native(p)
        label = get_fb_name(native)
        if not label:
            continue
        if label in ('Entity', 'None'):
            continue
        if label.startswith('Sketch'):
            continue
        if label.startswith('Vertex of'):
            continue
        names.append(label)
    return names


def find_owning_offset_constraint(curve, sketch=None):
    """If ``curve`` is a child of an OffsetConstraint, return that OC.

    Walks ``sketch.geometricConstraints`` filtering for
    ``OffsetConstraint`` subtypes, and checks each one's ``childCurves``
    collection for membership. Returns ``None`` if the curve isn't a
    child of any offset constraint in its parent sketch.

    This powers the "user clicks an offset-result curve" selection
    path — the picker reverse-looks-up the OC that owns the curve so
    the emitter can produce a single ``Offset.From(...)`` step rather
    than treating the offset-result as an un-seedable naked curve.

    ``sketch`` defaults to ``curve.parentSketch`` when omitted. Both
    ``parentSketch`` and ``geometricConstraints`` go through
    ``_safe_getattr`` because a proxy can refuse either slot.
    """
    if curve is None:
        _log_detection(None, "[foc-enter]   curve=None -> None")
        return None
    # Read objectType FIRST so the log records what we're about to walk
    # even if the next slot touch kills Fusion. Wrap the read itself so
    # the log is never the thing that crashes us.
    try:
        curve_type = (getattr(curve, 'objectType', '') or '').split('::')[-1]
    except Exception:
        curve_type = '<unreadable>'
    # isReference on the picked curve. The question this probe answers:
    # when a picked SketchLine ends up matching an OC's childCurves, is
    # the line also a projection (isReference=True)? If yes, Fusion's
    # data model allows a single entity to be BOTH a projection AND an
    # offset child — which means the dedicated-dispatch routing needs a
    # priority rule (projection should win; offsetting a projected line
    # is still semantically a projection, not a fresh offset seed). If
    # no, the user's "proj line" reading is a vocabulary/workflow
    # overlap (e.g. "the parents of this offset happen to be
    # projections, so I think of the child as a proj line too").
    picked_is_ref = _safe_getattr(curve, 'isReference')
    _log_detection(
        None,
        f"[foc-enter]   curve_type={curve_type} isReference={picked_is_ref}",
    )
    if sketch is None:
        sketch = _safe_getattr(curve, 'parentSketch')
    if sketch is None:
        _log_detection(None, "[foc-exit]    no parentSketch -> None")
        return None
    constraints = _safe_getattr(sketch, 'geometricConstraints')
    if constraints is None:
        _log_detection(None, "[foc-exit]    no geometricConstraints -> None")
        return None
    # Silent iteration — the per-item ``[foc-iter]`` noise was only needed
    # while we were isolating the ``parentSketch`` native-AV site. Now that
    # the CC guard in ``_expand_offset_picks`` skips constraints before we
    # ever reach here, a match (or the final no-match summary) is all the
    # log needs to record.
    for idx, c in enumerate(_iter_curve_collection(constraints)):
        obj_type = _safe_getattr(c, 'objectType') or ''
        # Match both the fully-qualified ``adsk::fusion::OffsetConstraint``
        # and the short ``OffsetConstraint`` that fakes may report.
        if not obj_type.endswith('OffsetConstraint'):
            continue
        for ch_idx, ch in enumerate(_iter_curve_collection(_safe_getattr(c, 'childCurves'))):
            # isReference on the candidate child — read before the
            # equality check so the log captures the child's state even
            # on a match. Paired with the [foc-enter] isReference
            # value, this resolves interpretation (2) vs (3):
            # both True = genuine data-model overlap; picked True but
            # child False = _same_entity false positive.
            ch_is_ref = _safe_getattr(ch, 'isReference')
            if _same_entity(ch, curve):
                _log_detection(
                    None,
                    f"[foc-exit]    [{idx}] matched -> OC "
                    f"(child[{ch_idx}] isReference={ch_is_ref})",
                )
                return c
    _log_detection(None, "[foc-exit]    no match -> None")
    return None


def is_offset_constraint(ent):
    """True if ``ent``'s objectType names it an ``OffsetConstraint``.

    Short helper so the scan loop doesn't have to know about the
    fully-qualified ``adsk::fusion::OffsetConstraint`` form.
    """
    if ent is None:
        return False
    obj_type = _safe_getattr(ent, 'objectType') or ''
    return obj_type.endswith('OffsetConstraint')


def oc_identity_key(oc):
    """Return a stable identity key for deduplicating OffsetConstraints.

    The scan loop expands multiple child-curve picks from the same
    offset into one OC item; this key is what it groups on.

    Prefers ``entityToken`` (Fusion's canonical identity) but falls
    back to ``id()`` when tokens aren't available (tests / stale
    proxies). The fallback is OK for dedup because the scan loop
    only compares keys from objects that are alive in the same
    Python process at the same moment.
    """
    if oc is None:
        return None
    try:
        tok = _safe_getattr(oc, 'entityToken')
        if tok:
            return ('token', tok)
    except Exception:
        pass
    return ('id', id(oc))


def build_offset_step(oc, label_override=None):
    """Emit the parseable ``Offset.From(...)`` hint for an OffsetConstraint.

    Shape emitted::

        Offset.From(
            ["horn_TL", "horn_L"],
            distance="hornOffset",
            targets=["offset_horn_TL", "offset_horn_L"]
        )

    ``phase_parser._build_offset_step`` then converts that into::

        {'Type': 'Offset',
         'SourceID':     ["horn_TL", "horn_L"],
         'DistanceExpr': "hornOffset",
         'TargetIDs':    ["offset_horn_TL", "offset_horn_L"]}

    which matches exactly the dict shape the runtime's
    ``fb_engine/offsets.py:offset_step`` reads.

    ``label_override`` is unused — offsets have no caller-supplied
    name to carry — but kept in the signature to match the other hint
    builders' ``(ent, name, ctx)`` contract. Will become meaningful
    if a future caller wants to prefix derived ``TargetIDs`` with a
    phase-scoped tag.
    """
    _ = label_override
    parents = parent_curves(oc)
    source_names = _named_parent_ids(parents)
    distance = distance_expression(oc)
    children = child_curves(oc)
    targets = derive_target_names(source_names, len(children))

    sources_lit = '[' + ', '.join(f'"{s}"' for s in source_names) + ']'
    targets_lit = '[' + ', '.join(f'"{t}"' for t in targets) + ']'
    return f'Offset.From({sources_lit}, distance="{distance}", targets={targets_lit})'
