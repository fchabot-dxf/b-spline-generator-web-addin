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
from relation_hints import _derive_point_role_id, target_props_for


# Must match ``relation_hints._POINT_TYPES``. Redeclared rather than
# imported because ``relation_hints`` doesn't export it (it's a private
# helper constant there) and we'd rather not introduce a public name
# just to share a 3-tuple that almost never changes.
_POINT_TYPES = ('SketchPoint', 'SketchPoint3D', 'SketchPoint2D')


def _has_framebuilder_attribute(ent):
    """Return True if ``ent`` directly carries a FrameBuilder ID attribute.

    Checks both the current ``ID`` attribute and the legacy ``name``
    attribute that older sketches were stamped with before the switch.
    Missing or non-truthy values count as no tag. The broad try/except
    is the Layer-2 guard: attribute reads on a settling proxy have been
    observed to raise, and we want the gate to return "not owned" in
    that case rather than escape upstream.
    """
    if not ent or not hasattr(ent, 'attributes'):
        return False
    try:
        attr = ent.attributes.itemByName('FrameBuilder', 'ID')
        if attr and attr.value:
            return True
        attr_old = ent.attributes.itemByName('FrameBuilder', 'name')
        if attr_old and attr_old.value:
            return True
    except Exception:
        pass
    return False


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
    ent = _get_native(ent)

    # (1) Direct attribute.
    if _has_framebuilder_attribute(ent):
        return True

    ent_type = getattr(ent, 'objectType', '') or ''

    # (2) Derived ownership for SketchPoints via the parent curve.
    if ent_type in _POINT_TYPES:
        if _derive_point_role_id(ent):
            return True
        return False

    # (3) Constraints / dimensions inherit ownership from their targets.
    #     Every target must itself be owned; one untagged target fails
    #     the whole constraint.
    if 'Constraint' in ent_type or 'Dimension' in ent_type:
        targets = []
        for prop_name in target_props_for(ent_type):
            try:
                item = getattr(ent, prop_name, None)
                if item is not None:
                    targets.append(item)
            except Exception:
                continue
        if not targets:
            return False
        return all(is_framebuilder_owned(t) for t in targets)

    return False
