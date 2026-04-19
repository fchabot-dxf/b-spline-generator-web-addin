import re
from template_payload import _get_native, _label_for_entity
from template_naming import make_unique_label, safe_name
from detection_log import _write_debug_log as _rename_log
from role_points import ROLE_POINT_SLOTS
# Shared FrameBuilder attribute reader. Replaces the local
# ``_existing_fb_id`` walk that used to duplicate the hasattr /
# itemByName pair from ``ownership_gate._has_framebuilder_attribute``.
# ``log_on_error=False`` — rename-side read failures are non-fatal
# (entity just won't be preserved as already-owned) and we don't want
# to flood the detection log during a large rename pass.
from fb_attributes import get_fb_id


def _normalize_prefix(value):
    if not value:
        return ''
    return safe_name(value)


def build_phase_prefix(phase_id=None, sketch_name=None):
    # Format: "{sketch_name}_{phase_id}". Sketch name first so labels
    # group visually by the sketch in file browsers / attribute lists
    # (e.g. "T2_2_shapeoutline_p01_SketchLine_01" and
    # "T2_2_shapeoutline_p02_SketchLine_01" sort adjacent), with the
    # phase suffix disambiguating feature passes inside the same sketch.
    # Reversed from the earlier "{phase_id}_{sketch_name}" ordering.
    phase_id = (phase_id or '').strip()
    sketch_name = (sketch_name or '').strip()
    if phase_id and sketch_name:
        return f'{_normalize_prefix(sketch_name)}_{_normalize_prefix(phase_id)}'
    if phase_id:
        return _normalize_prefix(phase_id)
    if sketch_name:
        return _normalize_prefix(sketch_name)
    return None


def set_entity_fb_name(ent, name):
    """Stamp ``ent`` with FrameBuilder ``ID``/``name`` attributes.

    Returns True if at least one attribute write actually succeeded,
    False otherwise. The caller uses the return value to decide
    whether to count this entity in ``renamed``, so the palette's
    "N renamed" count reflects reality — some Fusion subtypes
    (notably ``CoincidentConstraint`` in this codebase's observed
    environment) raise ``"3 : object does not support attributes"``
    on the ``.attributes`` slot itself, meaning the entity simply
    cannot carry custom attributes. Without the return-value signal
    we'd report ``renamed=1`` for those failed writes.
    """
    if not ent or not name:
        return False

    try:
        ent_type = type(ent).__name__
    except Exception:
        ent_type = '<?>'
    _rename_log(f"[set_entity_fb_name] ent={ent_type} name={name}")

    any_write = False
    try:
        if hasattr(ent, 'attributes'):
            _rename_log(f"[set_entity_fb_name] {name} -> itemByName FrameBuilder/ID")
            attr = ent.attributes.itemByName('FrameBuilder', 'ID')
            if attr:
                _rename_log(f"[set_entity_fb_name] {name} -> update existing ID attr")
                attr.value = name
            else:
                _rename_log(f"[set_entity_fb_name] {name} -> add ID attr")
                ent.attributes.add('FrameBuilder', 'ID', name)
            any_write = True

            _rename_log(f"[set_entity_fb_name] {name} -> itemByName FrameBuilder/name")
            attr_old = ent.attributes.itemByName('FrameBuilder', 'name')
            if attr_old:
                _rename_log(f"[set_entity_fb_name] {name} -> update existing name attr")
                attr_old.value = name
            else:
                _rename_log(f"[set_entity_fb_name] {name} -> add name attr")
                ent.attributes.add('FrameBuilder', 'name', name)

        if hasattr(ent, 'name'):
            try:
                _rename_log(f"[set_entity_fb_name] {name} -> ent.name =")
                ent.name = name
            except Exception as _ne:
                _rename_log(f"[set_entity_fb_name] {name} -> ent.name assignment FAILED: {_ne}")
        _rename_log(f"[set_entity_fb_name] {name} DONE any_write={any_write}")
    except Exception as _e:
        _rename_log(f"[set_entity_fb_name] {name} EXCEPTION: {_e} (ent_type={ent_type})")

    return any_write


def _stamp_role_points(curve, curve_label):
    """Stamp ``curve``'s start/end/center role points with role-suffixed
    FrameBuilder IDs so the runtime resolver finds them via literal
    attribute match.

    The FrameBuilder runtime does NOT walk role suffixes — a target
    ``"Frame_p03_SketchLine:E"`` only resolves if some SketchPoint in
    the sketch physically carries that exact ``FrameBuilder:ID``.
    ``_derive_point_role_id`` in ``relation_hints`` handles the symmetric
    READ side for generation (labels, ownership gate); this helper is
    the WRITE side for rename. Without it, any Coincident/point-on-curve
    constraint whose target is ``"{line_name}:E"`` fails at runtime even
    though the curve itself is correctly named — which is what the user
    observed empirically.

    Preserves any role point that already has a FrameBuilder:ID (same
    rule ``rename_selection`` applies to curves — user may have
    deliberately stamped a cross-feature ID on the point itself).

    Returns the number of role points whose stamp actually landed.
    """
    stamped = 0
    for slot_name, suffix in ROLE_POINT_SLOTS:
        try:
            pt = getattr(curve, slot_name, None)
        except Exception:
            # Fusion proxies sometimes raise on slot access the same
            # way they do on ``.attributes`` — catch and skip rather
            # than crash the rename pass. A missing role point just
            # means the curve subtype doesn't have that slot (e.g. a
            # SketchCircle has no startSketchPoint) or it's on a
            # settling proxy that'll recover after the next rebuild.
            _rename_log(
                f"[stamp_role_points] {slot_name} raised on getattr -> skip"
            )
            continue
        if not pt:
            continue
        if _existing_fb_id(pt):
            _rename_log(
                f"[stamp_role_points] {slot_name} already has FB ID -> "
                "preserve (user-owned)"
            )
            continue
        role_label = f'{curve_label}{suffix}'
        _rename_log(f"[stamp_role_points] {slot_name} -> {role_label}")
        if set_entity_fb_name(pt, role_label):
            stamped += 1
    return stamped


def _existing_fb_id(ent):
    """Thin shim over :func:`fb_attributes.get_fb_id`.

    Kept as a named function so the existing log-trace lines in
    ``rename_selection`` (e.g. ``[rename_selection] ent[N] existing_id=...``)
    still line up with a grep for ``_existing_fb_id``. Behaviour change
    from the pre-consolidation version: this now also accepts a legacy
    ``FrameBuilder:name`` attribute as evidence of ownership, matching
    what the gate has always done. Legacy-named entities (pre-ID stamps)
    are therefore preserved by rename rather than silently overwritten —
    that's the intended behaviour; the old divergence between gate and
    rename was itself the bug.
    """
    return get_fb_id(ent)


def rename_selection(entities, phase_prefix=None):
    _rename_log(f"[rename_selection] enter, count={len(entities) if entities else 0} prefix={phase_prefix}")
    if not entities:
        return 0

    label_counts = {}
    renamed = 0

    for idx, ent in enumerate(entities):
        try:
            ent_type = type(ent).__name__
        except Exception:
            ent_type = '<?>'
        _rename_log(f"[rename_selection] ent[{idx}] type={ent_type} -> _get_native")
        native = _get_native(ent)
        try:
            nat_type = type(native).__name__
        except Exception:
            nat_type = '<?>'
        _rename_log(f"[rename_selection] ent[{idx}] native type={nat_type} -> _existing_fb_id")

        # Preserve any FrameBuilder:ID that's already assigned. The user
        # reuses IDs across features (sometimes on multiple entities at
        # once), so a rename pass must leave them alone. We still
        # register the existing ID in label_counts so fresh entities in
        # the same pass don't accidentally generate a label that
        # collides with it.
        existing_id = _existing_fb_id(native)
        if existing_id:
            _rename_log(f"[rename_selection] ent[{idx}] existing_id={existing_id} -> skip")
            label_counts[existing_id] = label_counts.get(existing_id, 0) + 1
            continue

        _rename_log(f"[rename_selection] ent[{idx}] no existing id -> _label_for_entity")
        base_label = _label_for_entity(native)
        _rename_log(f"[rename_selection] ent[{idx}] base_label={base_label} -> make_unique_label")
        new_label = make_unique_label(native, base_label, label_counts, phase_prefix=phase_prefix)
        _rename_log(f"[rename_selection] ent[{idx}] new_label={new_label}")
        # We already gated on _existing_fb_id above — reaching here means
        # the entity carries NO FrameBuilder ID yet, so a stamp is always
        # needed regardless of whether make_unique_label happened to add
        # a counter suffix. The old ``new_label != base_label`` guard
        # silently skipped the write for every first-of-its-kind label
        # (e.g. a single CoincidentConstraint, or the first Sketch_Line
        # in a clean sketch), which is why the "nothing actually got
        # written" bug surfaced as renamed=0 on the first rename press.
        #
        # We only count entities whose attribute write actually landed.
        # Reporting ``renamed=1`` for a CoincidentConstraint that rejected
        # its ``.attributes`` slot was misleading the palette (and the
        # caller's ``deferred_rebuild.schedule()`` decision — a rebuild
        # after a no-op rename was observed to native-AV Fusion while
        # re-probing the same subtype-rejected constraint proxies).
        _rename_log(f"[rename_selection] ent[{idx}] -> set_entity_fb_name({new_label})")
        wrote = set_entity_fb_name(native, new_label)
        if wrote:
            renamed += 1
            # Stamp the curve's role points with suffixed IDs
            # ("{new_label}:S|:E|:C") so the runtime resolver can find
            # them by literal FB-ID match. The derivation in
            # ``relation_hints._derive_point_role_id`` is generate-side
            # only; the runtime needs physical stamps. No-op for
            # entities that don't expose these slots (constraints,
            # dimensions, points picked directly).
            role_stamps = _stamp_role_points(native, new_label)
            if role_stamps:
                _rename_log(
                    f"[rename_selection] ent[{idx}] role-stamped "
                    f"{role_stamps} point(s)"
                )
        else:
            _rename_log(f"[rename_selection] ent[{idx}] stamp REJECTED by subtype — not counted")

    _rename_log(f"[rename_selection] DONE renamed={renamed}")
    return renamed
