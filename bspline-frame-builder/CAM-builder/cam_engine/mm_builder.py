"""Manufacturing Model builder.

Three MMs, one per body filter rule:

  +------------------+--------------------------+------------------------+
  | Rule name        | Bodies kept              | Bodies removed         |
  +==================+==========================+========================+
  | ``stock``        | (none -- raw blank)      | all                    |
  | ``bspline_set``  | b-spline panel bodies    | frame bodies           |
  | ``frame``        | frame bodies             | b-spline bodies        |
  +------------------+--------------------------+------------------------+

Pass 1 (current code)
---------------------
``cam.manufacturingModels.add()`` auto-snapshots the active Design
state, so for the first verification pass we just create three MMs by
name -- all hold the full geometry. This proves the API plumbing works
in the user's environment before we layer body filtering on top.

Pass 2 (TODO)
-------------
Add a body-filter pass after creation:
  * walk ``mm.occurrence.component.bRepBodies`` (or
    ``allOccurrences[*].component.bRepBodies`` to reach panel bodies
    nested inside the "B-Spline Set" component)
  * call ``BRepBody.deleteMe()`` on bodies that don't match the rule
  * for the frame MM, also apply a reorient transform so the frame
    lays flat for cutting

Note on the Stock MM
--------------------
The Design tree carries a "stock" placeholder component, but it is
NOT a real body. The Stock MM workflow:
  1. Remove every body inherited from the Design snapshot
  2. Read the bounding box of the (formerly present) panel + frame
     bodies, plus a stock margin (configurable later)
  3. Create a sketch on the XY origin plane and draw a rectangle
     sized to the bbox
  4. Extrude it to stock thickness
This extrude happens inside the MM, so the Design is not polluted.

Reference: see ``CAM_API_NOTES.md`` -- "Manufacturing Model creation"
and "Body removal inside an MM".
"""

import adsk.core
import adsk.cam
import adsk.fusion


MM_RULES = ('stock', 'bspline_set', 'frame')

# Per-rule occurrence-DELETE policy. Keys are component-name classes
# returned by ``_classify_occurrence`` ('panel', 'frame',
# 'stock_placeholder', 'unknown'). Any occurrence whose class is in
# the delete set for the rule gets removed via ``Occurrence.deleteMe()``.
#
# Why DELETE instead of KEEP semantics:
#   When Fusion creates an MM from a Design, it wraps the entire
#   design under a single 'unknown' occurrence named after the
#   document. If we used a KEEP rule, that wrapper wouldn't match
#   {'panel'} or {'frame'}, so it would get deleted -- nuking all
#   our kept descendants with it. DELETE rules let unknowns ride
#   along (their classified children get pruned, the wrapper stays).
#
#   Stock MM is the exception: we want to nuke EVERYTHING including
#   the wrapper, so 'unknown' is in its delete set.
_DELETE_OCC_CLASSES = {
    'stock':        {'panel', 'frame', 'stock_placeholder', 'unknown'},
    'bspline_set':  {'frame', 'stock_placeholder'},
    'frame':        {'panel', 'stock_placeholder'},
}


def build_all_mms(cam, design, classifier, logger=None):
    """Build the three MMs in one pass and return ``{rule: ManufacturingModel}``."""
    out = {}
    for rule in MM_RULES:
        mm = build_mm(cam, design, rule, classifier, logger)
        if mm:
            out[rule] = mm
    return out


def build_mm(cam, design, rule, classifier, logger=None):
    """Build a single MM and apply its body-filter rule."""
    if rule not in MM_RULES:
        _log(logger, f"MM BUILD: unknown rule {rule!r}", "WARNING")
        return None

    if cam is None:
        _log(logger, f"MM BUILD ({rule}): cam is None", "ERROR")
        return None

    try:
        mm_input = cam.manufacturingModels.createInput()
        mm_input.name = _mm_display_name(rule)
        mm = cam.manufacturingModels.add(mm_input)
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): manufacturingModels.add raised: {e}", "ERROR")
        return None

    if mm is None:
        _log(logger, f"MM BUILD ({rule}): manufacturingModels.add returned None", "ERROR")
        return None

    try:
        _log(logger, f"MM BUILD ({rule}): created '{mm.name}'")
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): created (name read failed: {e})")

    # Apply the occurrence-filter rule. Failures here are logged but
    # not fatal -- the MM still exists, it just holds the full design
    # until we figure out why deleteMe() didn't take.
    try:
        kept, deleted, failed = _apply_occurrence_filter(mm, rule, classifier, logger)
        _log(logger, f"MM BUILD ({rule}): occurrence filter -> kept={kept} deleted={deleted} failed={failed}")
    except Exception as e:
        _log(logger, f"MM BUILD ({rule}): occurrence filter raised: {e}", "WARNING")

    # PASS 3 hook -- frame reorient + stock extrude go here.
    return mm


def _classify_occurrence(occ):
    """Classify a top-level occurrence by its component name.

    Returns one of:
        'panel'              -- B-Spline Set component (b-spline panel)
        'frame'              -- frame component (frame_* bodies inside)
        'stock_placeholder'  -- the user's "stock" placeholder component
        'unknown'            -- anything else; kept by every MM defensively

    Component-name based rather than body-classifier based because once
    bodies are inside an MM snapshot, the assemblyContext chain doesn't
    reliably resolve back to the original parent component name. The
    component name itself is preserved on the occurrence and is the
    only stable handle.
    """
    try:
        name = (occ.component.name or '').lower()
    except Exception:
        return 'unknown'

    # Frame: matches "Frame_1", "Frame 2", etc -- the extrusion engine
    # creates a component prefixed "Frame_<N>" and stamps body names
    # frame_<label> inside it.
    if name.startswith('frame') or 'frame' in name:
        return 'frame'

    if 'b-spline set' in name or 'bspline set' in name:
        return 'panel'

    if name == 'stock' or name.startswith('stock'):
        return 'stock_placeholder'

    return 'unknown'


def _apply_occurrence_filter(mm, rule, classifier, logger):
    """Walk every occurrence inside the MM (recursively, via
    ``component.allOccurrences``) and delete those whose class is in
    ``_DELETE_OCC_CLASSES[rule]``.

    Returns ``(kept, deleted, failed)`` counts.

    Walking recursively (not just top-level) is critical: when Fusion
    creates an MM from the Design, it wraps everything under a single
    'unknown' occurrence named after the document. The named groups
    we want to filter (B-Spline Set, Frame_1, stock) live one level
    inside that wrapper. Top-level-only walks see only the wrapper.

    Deletes deepest-first -- if a parent gets deleted before its
    children, the children are gone too, and the second deleteMe()
    call would fail with 'invalid object'. ``isValid`` skip handles
    that edge case anyway.

    The ``classifier`` argument is unused here -- the occurrence-name
    rule is sufficient and avoids the body-ancestry-lookup fragility
    that breaks inside an MM snapshot. We accept the parameter for
    signature compatibility.
    """
    delete = _DELETE_OCC_CLASSES[rule]

    try:
        comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): could not read mm.occurrence.component: {e}", "ERROR")
        return (0, 0, 0)

    # Snapshot the recursive occurrence list BEFORE deleting -- the
    # collection invalidates as we mutate.
    try:
        all_occs = [comp.allOccurrences.item(i) for i in range(comp.allOccurrences.count)]
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): could not enumerate allOccurrences: {e}", "ERROR")
        return (0, 0, 0)

    kept = 0
    to_delete = []
    for occ in all_occs:
        try:
            occ_name = occ.component.name
        except Exception:
            occ_name = '<unnamed>'
        cls = _classify_occurrence(occ)

        if cls in delete:
            to_delete.append((occ, occ_name, cls))
        else:
            kept += 1
            _log(logger, f"MM FILTER ({rule}): KEEP occ '{occ_name}' (class={cls})", "DEBUG")

    # Deepest-first delete order -- use fullPathName length as a depth
    # proxy. Fusion's path strings are slash-separated, so longer == deeper.
    def _depth(t):
        try:
            return -len(t[0].fullPathName or '')
        except Exception:
            return 0
    to_delete.sort(key=_depth)

    # Wrap deletes inside a BaseFeature edit so the MM's timeline gets
    # ONE collapsed entry ("Base Feature" with our deletions inside)
    # instead of N "Remove" entries -- one per deleteMe() call. That's
    # the difference between "Remove" semantics (parametric, every
    # action becomes a timeline feature) and "Delete" semantics
    # (direct-edit, batched into a single base feature).
    base_feat = None
    try:
        base_features = comp.features.baseFeatures
        base_feat = base_features.add()
        base_feat.startEdit()
    except Exception as e:
        _log(logger, f"MM FILTER ({rule}): BaseFeature wrap unavailable, deletions will land directly on timeline: {e}", "DEBUG")
        base_feat = None

    deleted = 0
    failed = 0
    try:
        for occ, occ_name, cls in to_delete:
            try:
                if not occ.isValid:
                    deleted += 1
                    continue
                ok = occ.deleteMe()
                if ok:
                    deleted += 1
                    _log(logger, f"MM FILTER ({rule}): DEL  occ '{occ_name}' (class={cls})", "DEBUG")
                else:
                    failed += 1
                    _log(logger, f"MM FILTER ({rule}): deleteMe() returned False for occ '{occ_name}' (class={cls})", "WARNING")
            except Exception as e:
                failed += 1
                _log(logger, f"MM FILTER ({rule}): deleteMe() raised on occ '{occ_name}' (class={cls}): {e}", "WARNING")
    finally:
        if base_feat is not None:
            try:
                base_feat.finishEdit()
                _log(logger, f"MM FILTER ({rule}): collapsed {deleted} deletions into 1 BaseFeature timeline entry", "DEBUG")
            except Exception as e:
                _log(logger, f"MM FILTER ({rule}): BaseFeature.finishEdit failed: {e}", "WARNING")

    return (kept, deleted, failed)


def _mm_display_name(rule):
    return {
        'stock':        'MM - Stock (raw blank)',
        'bspline_set':  'MM - B-spline set',
        'frame':        'MM - Frame (lay-flat)',
    }[rule]


def _log(logger, msg, level="INFO"):
    if logger is None:
        return
    try:
        logger.log(msg, level)
    except Exception:
        pass
