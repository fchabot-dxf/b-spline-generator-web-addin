"""FrameBuilder ownership gate for Template Maker picks.

The gate answers a single question: "Is it safe to include this
sketch entity in a generated phase block?" — i.e. can we identify it
by a FrameBuilder ID, directly or by derivation. Picks that fail the
gate are surfaced to the palette as "N untagged entities skipped"
rather than silently emitted with a made-up name.

Extracted from ``template_payload`` because the gate had grown into
the crash-critical path: it's the first thing that touches Fusion
relation proxies after a rename or new-constraint event, and the
wrong property walk here is what takes Fusion down with a native AV.
Keeping it next to ``relation_hints`` (which owns
``target_props_for``) makes it clear these two modules share a
correctness contract — both MUST use the same per-subtype slot map
or the gate and the emitter drift apart.

Three ownership paths are recognised:

1. **Direct** — the entity carries a ``FrameBuilder.ID`` attribute (or
   the legacy ``FrameBuilder.name``). This is every seed the runtime
   has stamped.

2. **Derived point** — a ``SketchPoint`` that serves as the start,
   end, or center of a named curve inherits that curve's identity
   (``"horn_TL:E"``). The point itself has no attribute; ownership
   flows through the parent curve via ``_derive_point_role_id``.

3. **Target-derived constraint/dimension** — Fusion never tags
   ``Constraint`` / ``Dimension`` objects, so ownership is inferred
   from their targets. Every target must itself be owned; one
   untagged target fails the whole constraint. This mirrors the
   refusal model ``detect_projections`` uses for untagged projection
   sources.

Anything else — user-drawn geometry, legacy untagged entities,
cross-sketch picks — returns ``False`` and is filtered out upstream
of the hint builders.

Back-compat
-----------
``template_payload`` re-exports ``is_framebuilder_owned`` and
``_has_framebuilder_attribute`` so any caller doing
``from template_payload import is_framebuilder_owned`` keeps working.
New callers should import from this module directly.
"""

from entity_util import _get_native
from relation_hints import _derive_point_role_id, _origin_axis_token, target_props_for
# Detection log — same fsync-per-line channel ``_constraint_targets``
# uses for its probe instrumentation. We import it here because the
# gate does its own independent slot walk (lines 147-154) and that
# walk is a separate crash site from the one in ``_constraint_targets``.
# Either walk can native-AV Fusion, and the per-probe lines are what
# let us tell them apart in the log tail after a crash.
from detection_log import _log_detection
from cc_proxy import is_iterated_cc_proxy
# Shared FrameBuilder attribute reader. ``has_fb_id`` replaces the
# local ``_has_framebuilder_attribute`` — both the gate and
# ``rename_selection._existing_fb_id`` previously carried identical
# hasattr/itemByName walks with the same Layer-2 guard; consolidated
# into ``fb_attributes`` so a future change to the attribute contract
# touches one place. ``log_on_error=True`` preserves the gate-side
# ``[attr-raised]`` crash-diagnostic trail.
from fb_attributes import has_fb_id


# Must match ``relation_hints._POINT_TYPES``. Redeclared rather than
# imported because ``relation_hints`` doesn't export it (it's a private
# helper constant there) and we'd rather not introduce a public name
# just to share a 3-tuple that almost never changes.
_POINT_TYPES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')


def _has_framebuilder_attribute(ent):
    """Back-compat shim around :func:`fb_attributes.has_fb_id`.

    ``template_payload`` re-exports this name for external callers
    doing ``from template_payload import _has_framebuilder_attribute``;
    dropping it outright would break them. New code should import
    ``has_fb_id`` from ``fb_attributes`` directly.

    ``log_on_error=True`` preserves the ``[attr-raised]`` log line the
    gate relies on for crash-site identification after a native AV —
    if the add-in dies shortly after, the fsynced tail tells us which
    subtype's attribute slot escalated.
    """
    return has_fb_id(ent, log_on_error=True, log_prefix='attr-raised')


def is_framebuilder_owned(ent):
    """Ownership gate for the Template Maker scan.

    Returns True iff the entity is safe to include in a generated phase
    block. See module docstring for the three ownership paths. Recursive
    for constraints/dimensions: every target must itself pass the gate.

    The constraint/dimension branch dispatches on ``ent.objectType`` via
    ``target_props_for`` so only slots Fusion actually defines for that
    subtype are probed. Probing an out-of-subtype slot on a freshly-
    created proxy can native-AV Fusion; no Python ``try/except`` catches
    a native AV, so the only safe approach is not to ask.
    """
    if not ent:
        return False
    _log_detection(None, f"[gate-enter]  type={type(ent).__name__}")
    ent = _get_native(ent)
    _log_detection(None, f"[gate-native] type={type(ent).__name__}")

    # (1) Direct attribute.
    if _has_framebuilder_attribute(ent):
        _log_detection(None, "[gate-exit]   direct-attr -> True")
        return True

    # (1b) Origin-entity whitelist — root construction axes and the origin
    #      point can never carry a FrameBuilder.ID attribute (they're
    #      design-level, not sketch-level) AND don't participate in the
    #      derived-point path (no parent curve owns them). But the runtime
    #      pre-seeds them in ``ctx.entity_map`` under the bare tokens
    #      ``"X_AXIS"`` / ``"Y_AXIS"`` / ``"ORIGIN"``, and
    #      ``relation_hints._format_target_reference`` emits those tokens
    #      verbatim. Allowing them through here makes origin-axis
    #      Coincident targets a first-class ownership path — mirroring the
    #      T2_p04 hand-written convention that's already in production
    #      phase files.
    origin_token = _origin_axis_token(ent)
    if origin_token:
        _log_detection(None, f"[gate-exit]   origin-token={origin_token} -> True")
        return True

    ent_type = getattr(ent, 'objectType', '') or ''
    _log_detection(None, f"[gate-type]   {ent_type or '<empty>'}")

    # (2) Derived ownership for SketchPoints via the parent curve.
    if ent_type in _POINT_TYPES:
        result = bool(_derive_point_role_id(ent))
        _log_detection(None, f"[gate-exit]   derived-point -> {result}")
        return result

    # (2b) OffsetConstraint — doesn't fit the generic constraint-targets
    #      mould. Its ownership flows from the parent (source) curves,
    #      not from a ``target_props_for`` slot list. The child curves
    #      are offset-result geometry that Fusion labels with generic
    #      names; only the parents carry user-owned FrameBuilder IDs.
    #      Empty ``parents`` means the collection was unreachable (stale
    #      proxy) — safest to refuse rather than emit a zero-source
    #      offset step.
    #
    #      Checked BEFORE the generic ``'Constraint' in ent_type`` branch
    #      because ``'OffsetConstraint'.__contains__('Constraint')`` would
    #      otherwise route the entity through ``target_props_for``, which
    #      has no entry for OffsetConstraint and would return no targets.
    if ent_type.endswith('OffsetConstraint'):
        from offset_hint import parent_curves
        parents = parent_curves(ent)
        if not parents:
            _log_detection(None, "[gate-exit]   oc-no-parents -> False")
            return False
        return all(is_framebuilder_owned(p) for p in parents)

    # (3) Constraints / dimensions inherit ownership from their targets.
    #     Every target must itself be owned; one untagged target fails
    #     the whole constraint.
    #
    # DIAGNOSTIC INSTRUMENTATION — mirror of the probe logging in
    # ``relation_hints._constraint_targets``. This walk is INDEPENDENT
    # of the one the emitter does; same slots, different function, so
    # it's its own potential crash site. Prefix is ``[gate-*]`` not
    # ``[probe-*]`` so a log tail can tell the two walks apart after
    # a native AV. See the comment in _constraint_targets for the
    # interpretation of each line shape.
    if 'Constraint' in ent_type or 'Dimension' in ent_type:
        _log_detection(None, f"[gate-begin]  {ent_type}")

        # CoincidentConstraint pre-flight — distinguish iterated proxy
        # (safe) from direct-pick proxy (hazardous) before probing
        # .point / .entity. See ``cc_proxy.is_iterated_cc_proxy`` for
        # the full rationale; the short version is that
        # ``_expand_offset_picks`` tries to swap picked CCs for
        # iterated ones upstream, but if the swap failed (ambiguous
        # pick, 3+ junction glyphs, no active sketch) we're still
        # looking at the hazardous proxy here. Touching .point or
        # .entity would corrupt Fusion's pointer graph and native-AV
        # on the next repaint.
        #
        # This pre-flight is CoincidentConstraint-specific because
        # CC is the only subtype with this pathology. Other constraint
        # subtypes have readable target slots on their picked proxies
        # and shouldn't pay the token-read cost.
        if ent_type.endswith('CoincidentConstraint'):
            if not is_iterated_cc_proxy(ent, log_prefix='gate-cc'):
                return False

        targets = []
        for prop_name in target_props_for(ent_type):
            _log_detection(None, f"[gate-probe]  {ent_type}.{prop_name}")
            try:
                item = getattr(ent, prop_name, None)
                _log_detection(
                    None,
                    f"[gate-got]    {ent_type}.{prop_name} -> "
                    f"{type(item).__name__ if item is not None else 'None'}",
                )
                if item is not None:
                    targets.append(item)
            except Exception as e:
                _log_detection(
                    None,
                    f"[gate-raised] {ent_type}.{prop_name} -> "
                    f"{type(e).__name__}: {e}",
                )
                continue
        if not targets:
            _log_detection(
                None,
                f"[gate-end]    {ent_type} -> False (no targets)",
            )
            return False
        result = all(is_framebuilder_owned(t) for t in targets)
        _log_detection(
            None,
            f"[gate-end]    {ent_type} -> {result} "
            f"(targets={len(targets)})",
        )
        return result

    _log_detection(None, f"[gate-exit]   fallthrough type={ent_type or '<empty>'} -> False")
    return False
