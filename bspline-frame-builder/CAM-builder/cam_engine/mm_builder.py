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

    # B-spline-specific second pass: inside the B-Spline Set, mirror
    # the design-tree visibility rules but via deleteMe() since this is
    # the CAM snapshot, not the live design:
    #   - If a Stamped panel exists, delete the Clean occurrence entirely
    #     (Stamped wins, we don't machine the un-stamped variant).
    #   - Strip every 'surface' body from the remaining panel occurrence
    #     (CAM only needs the solid panel — surfaces are reference-only).
    if rule == 'bspline_set':
        try:
            _apply_bspline_panel_filter(mm, logger)
        except Exception as e:
            _log(logger, f"MM BUILD ({rule}): bspline panel filter raised: {e}", "WARNING")

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


def _apply_bspline_panel_filter(mm, logger):
    """Inside the bspline_set MM, enforce the same primary-panel rules
    that the b-spline generator enforces on the live design tree, but
    using ``deleteMe()`` instead of visibility toggles because this is
    the CAM snapshot.

    Rules:
      1. The B-Spline Set parent has up to two children: ``Clean`` and
         ``Stamped`` (both contain a ``panel`` body and optional
         ``surface`` body). If a Stamped occurrence with a panel body
         exists, delete the Clean occurrence and any of its descendants
         — Stamped is what we machine; Clean is a fallback that the
         user already decided not to use.
      2. On every remaining panel-bearing occurrence, delete bodies
         named ``surface`` / ``surface_N``. CAM only needs the solid
         ``panel`` body; surfaces are reference geometry from the
         export pipeline and would just confuse stock/contact tests.

    Wrapped in a single BaseFeature edit so the MM timeline gets one
    'Base Feature' entry instead of one Remove per body/occurrence
    deletion — matches the pattern in ``_apply_occurrence_filter``.
    """
    try:
        comp = mm.occurrence.component
    except Exception as e:
        _log(logger, f"BSPLINE FILTER: could not read mm.occurrence.component: {e}", "ERROR")
        return

    # Find every B-Spline Set occurrence in the snapshot. Usually one,
    # but iterate defensively.
    try:
        all_occs = [comp.allOccurrences.item(i) for i in range(comp.allOccurrences.count)]
    except Exception as e:
        _log(logger, f"BSPLINE FILTER: enumerate allOccurrences failed: {e}", "ERROR")
        return

    bspline_set_occs = []
    for o in all_occs:
        try:
            nm = (o.component.name or '').lower()
        except Exception:
            continue
        if 'b-spline set' in nm or 'bspline set' in nm:
            bspline_set_occs.append(o)

    if not bspline_set_occs:
        _log(logger, "BSPLINE FILTER: no B-Spline Set occurrence found in MM snapshot", "DEBUG")
        return

    # For each B-Spline Set, look at its direct children for Clean/Stamped.
    occs_to_delete = []
    surface_bodies_to_delete = []
    for parent_occ in bspline_set_occs:
        try:
            child_count = parent_occ.childOccurrences.count
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: childOccurrences read failed: {e}", "WARNING")
            continue

        clean_children   = []
        stamped_children = []
        orphan_children  = []
        for i in range(child_count):
            try:
                child = parent_occ.childOccurrences.item(i)
                cn = (child.component.name or '').lower()
            except Exception:
                continue
            # Orphans from bspline-gen consolidation: '_bsg_orphan_*'.
            # The source design keeps these alive (just hidden + renamed)
            # so the CopyPasteBodies parametric ref stays valid. They
            # must NEVER reach CAM, so always delete them from the MM
            # snapshot - cross-component occurrence delete works fine
            # inside the wrapper-component BaseFeature edit.
            if cn.startswith('_bsg_orphan'):
                orphan_children.append(child)
                continue
            has_panel = _component_has_panel_body(child.component)
            if 'stamped' in cn and has_panel:
                stamped_children.append(child)
            elif 'clean' in cn:
                clean_children.append(child)

        # Always delete orphans, regardless of whether Stamped/Clean rule applies.
        for orph in orphan_children:
            try:
                nm = orph.component.name
            except Exception:
                nm = '<unnamed>'
            occs_to_delete.append((orph, nm))
            _log(logger, f"BSPLINE FILTER: queued orphan delete '{nm}'", "DEBUG")

        # Rule 1: Stamped wins.
        if stamped_children:
            for clean_occ in clean_children:
                try:
                    nm = clean_occ.component.name
                except Exception:
                    nm = '<unnamed>'
                occs_to_delete.append((clean_occ, nm))

        # Rule 2: collect surface bodies on the panel-bearing survivors.
        # Match ALL surface name shapes the bspline-gen produces and any
        # Fusion auto-uniquified variants:
        #   'surface'       — clean rename
        #   'surface_1'     — bspline-gen's underscore suffix
        #   'surface (1)'   — Fusion's space+parens auto-suffix when the
        #                     setter detects a name collision
        # Bodies named 'panel' / 'panel_N' / 'panel (N)' are NOT touched.
        survivors = stamped_children if stamped_children else clean_children
        for surv in survivors:
            try:
                bodies = [surv.component.bRepBodies.item(i)
                          for i in range(surv.component.bRepBodies.count)]
            except Exception:
                bodies = []
            for b in bodies:
                try:
                    bn = (b.name or '').lower()
                except Exception:
                    continue
                if _is_surface_body_name(bn):
                    surface_bodies_to_delete.append((b, surv.component.name, b.name))

    if not occs_to_delete and not surface_bodies_to_delete:
        _log(logger, "BSPLINE FILTER: nothing to prune (no Stamped/Clean overlap, no surface bodies)", "DEBUG")
        return

    # ── Phase A: occurrence deletes (cross-component, BaseFeature-friendly) ──
    # Occurrence deletion inside a BaseFeature edit on the wrapper component
    # is special-cased by Fusion and works across child boundaries — that's
    # how _apply_occurrence_filter collapses N deletes into one timeline row.
    # We use the same pattern here for the Clean-occurrence delete.
    occ_deleted = 0
    if occs_to_delete:
        base_feat = None
        try:
            base_feat = comp.features.baseFeatures.add()
            base_feat.startEdit()
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: BaseFeature wrap (occ phase) unavailable: {e}", "DEBUG")
            base_feat = None

        try:
            for occ, nm in occs_to_delete:
                try:
                    if not occ.isValid:
                        occ_deleted += 1
                        continue
                    if occ.deleteMe():
                        occ_deleted += 1
                        _log(logger, f"BSPLINE FILTER: DEL Clean occ '{nm}' (Stamped takes primary)", "INFO")
                    else:
                        _log(logger, f"BSPLINE FILTER: deleteMe() returned False for occ '{nm}'", "WARNING")
                except Exception as e:
                    _log(logger, f"BSPLINE FILTER: deleteMe() raised on occ '{nm}': {e}", "WARNING")
        finally:
            if base_feat is not None:
                try:
                    base_feat.finishEdit()
                except Exception as e:
                    _log(logger, f"BSPLINE FILTER: BaseFeature.finishEdit (occ phase) failed: {e}", "WARNING")

    # ── Phase B: body deletes (must run OUTSIDE any BaseFeature edit) ──
    # The surface bodies live in CHILD components (Stamped / Clean), not the
    # wrapper. A BaseFeature edit is scoped to its host component for body
    # operations — body.deleteMe() on a child-component body inside a wrapper
    # BaseFeature edit raises 'InternalValidationError : res' (verified in
    # cam-builder-cam-debug.log at 06:34:59 and 06:57:29). Cross-component
    # body deletion only works as an ordinary parametric op. Each body
    # produces its own 'Remove' timeline entry; with at most one or two
    # surfaces per consolidated occurrence that's a tolerable cost in
    # exchange for the deletion actually taking effect.
    body_deleted = 0
    for body, comp_name, body_name in surface_bodies_to_delete:
        try:
            if not body.isValid:
                _log(logger, f"BSPLINE FILTER: skipping invalid body '{body_name}' in '{comp_name}'", "DEBUG")
                continue
            if body.deleteMe():
                body_deleted += 1
                _log(logger, f"BSPLINE FILTER: DEL surface body '{body_name}' from '{comp_name}'", "DEBUG")
            else:
                _log(logger, f"BSPLINE FILTER: deleteMe() returned False for body '{body_name}' in '{comp_name}'", "WARNING")
        except Exception as e:
            _log(logger, f"BSPLINE FILTER: surface body delete raised on '{body_name}' in '{comp_name}': {e}", "WARNING")

    _log(logger, f"BSPLINE FILTER: pruned {occ_deleted} Clean occurrence(s) and {body_deleted} surface body/bodies", "INFO")


def _component_has_panel_body(comp):
    """``True`` if ``comp`` owns a body classified as a panel.

    Accepts ``panel``, ``panel_N`` (bspline-gen's own suffix), and
    ``panel (N)`` (Fusion's auto-uniquifier). Mirrors the surface
    matcher so the two are symmetric."""
    try:
        n = comp.bRepBodies.count
    except Exception:
        return False
    for i in range(n):
        try:
            bn = (comp.bRepBodies.item(i).name or '').lower()
        except Exception:
            continue
        if _is_panel_body_name(bn):
            return True
    return False


def _is_panel_body_name(bn):
    """True for: 'panel', 'panel_N', 'panel (N)'."""
    if bn == 'panel':
        return True
    if bn.startswith('panel_'):
        return True
    if bn.startswith('panel (') and bn.endswith(')'):
        # 'panel (1)' / 'panel (12)' — Fusion uniquifier
        return True
    return False


def _is_surface_body_name(bn):
    """True for: 'surface', 'surface_N', 'surface (N)'."""
    if bn == 'surface':
        return True
    if bn.startswith('surface_'):
        return True
    if bn.startswith('surface (') and bn.endswith(')'):
        return True
    return False


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
