"""Shared FrameBuilder attribute readers.

Two authoritative read sites exist in this codebase:

* ``ownership_gate._has_framebuilder_attribute`` — boolean "does this
  entity carry any FrameBuilder tag?" for the ownership gate.

* ``rename_selection._existing_fb_id`` — value read to decide whether
  a pending rename should preserve the existing ID.

Before consolidation both carried their own ``hasattr`` / ``itemByName``
walk with an identical Layer-2 guard (``hasattr`` INSIDE the try block
— see below). The gate logged on RuntimeError via the ``[attr-raised]``
prefix; the rename side swallowed silently. Keeping them as separate
sites meant a future change to the FrameBuilder attribute contract
(new slot, different namespace, alternate fallback) had to be mirrored
or the two readers would drift. That's what this module prevents.

The Layer-2 guard — ``hasattr(ent, 'attributes')`` is wrapped inside
the try/except, not outside — deserves restating because both callers
independently hit the same crash before they added this guard: Python
3's ``hasattr`` only swallows ``AttributeError``, but Fusion raises
``"3 : object does not support attributes"`` as a bare ``RuntimeError``
when a constraint subtype's proxy refuses the attribute-slot access
(notably ``CoincidentConstraint`` on the picked-proxy path). Leaving
``hasattr`` outside the guard lets that RuntimeError escape and takes
down the caller — exactly the shape of crash that the ownership gate
and the rename path used to hit.

Both the ID and legacy ``name`` attributes count as ownership. Old
sketches stamped only the ``name`` attribute; the runtime accepts both,
so the readers must too — otherwise a legacy-named entity would be
invisible to the gate (untagged, filtered out) AND would be re-stamped
by rename (overwriting the user's intentional tag).
"""

from detection_log import _log_detection


def get_fb_id(ent, log_on_error=False, log_prefix='attr-raised'):
    """Return the FrameBuilder tag on ``ent``, or '' if none is set.

    Prefers the current-generation ``FrameBuilder:ID`` attribute and
    falls back to the legacy ``FrameBuilder:name``. Returns '' for
    unowned entities, untaggable subtypes (constraints that refuse
    ``.attributes``), and any proxy state that raises during the read.

    ``log_on_error`` exists for the ownership-gate caller: when the
    gate's attribute walk raises, we want that on disk (fsynced) so a
    subsequent native-AV's log tail identifies the offending subtype.
    Rename-side callers pass False — a failed attribute read there is
    non-fatal (the entity just won't be preserved as already-owned) and
    the crash-diagnostic value is lower for that code path. Passing a
    distinct ``log_prefix`` lets future callers differentiate their
    failure trail (e.g. ``gate-attr`` vs. ``rename-attr``) without
    having to subclass the helper.
    """
    if not ent:
        return ''
    try:
        if not hasattr(ent, 'attributes'):
            return ''
        attr = ent.attributes.itemByName('FrameBuilder', 'ID')
        if attr and attr.value:
            return attr.value
        attr_old = ent.attributes.itemByName('FrameBuilder', 'name')
        if attr_old and attr_old.value:
            return attr_old.value
    except Exception as e:
        if log_on_error:
            _log_detection(
                None,
                f"[{log_prefix}]   {type(ent).__name__}: "
                f"{type(e).__name__}: {e}",
            )
    return ''


def has_fb_id(ent, log_on_error=False, log_prefix='attr-raised'):
    """Boolean wrapper around :func:`get_fb_id`.

    Kept as a separate public name (rather than making callers write
    ``bool(get_fb_id(...))``) because the gate's intent — "is this
    entity owned?" — reads more clearly at the call site as
    ``has_fb_id(ent)`` than as a truthiness check on a string.
    """
    return bool(get_fb_id(ent, log_on_error=log_on_error, log_prefix=log_prefix))
