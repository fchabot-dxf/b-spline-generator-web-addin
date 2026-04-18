import re
from template_payload import _get_native, _label_for_entity
from template_naming import make_unique_label, safe_name
from detection_log import _write_debug_log as _rename_log


def _normalize_prefix(value):
    if not value:
        return ''
    return safe_name(value)


def build_phase_prefix(phase_id=None, sketch_name=None):
    phase_id = (phase_id or '').strip()
    sketch_name = (sketch_name or '').strip()
    if phase_id and sketch_name:
        return f'{_normalize_prefix(phase_id)}_{_normalize_prefix(sketch_name)}'
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


def _existing_fb_id(ent):
    """Return the FrameBuilder:ID value already stamped on this entity,
    or '' if none is set. Existing IDs are considered user-owned — the
    user intentionally reuses IDs across features, so Rename Selection
    must never overwrite one that's already there.

    The ``hasattr`` probe is INSIDE the broad try/except on purpose:
    Python 3's ``hasattr`` only swallows ``AttributeError``, but Fusion
    raises ``"3 : object does not support attributes"`` as a bare
    ``RuntimeError`` when a subtype's proxy refuses an attribute-slot
    access (e.g. a CoincidentConstraint during a rename pass). A naked
    ``if not hasattr(ent, 'attributes')`` outside the guard lets that
    RuntimeError escape and takes the rename handler down with it —
    which is exactly what crashed Fusion for CoincidentConstraint picks
    before this guard was added.
    """
    if not ent:
        return ''
    try:
        if not hasattr(ent, 'attributes'):
            return ''
        attr = ent.attributes.itemByName('FrameBuilder', 'ID')
        if attr and attr.value:
            return attr.value
    except Exception:
        pass
    return ''


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
        else:
            _rename_log(f"[rename_selection] ent[{idx}] stamp REJECTED by subtype — not counted")

    _rename_log(f"[rename_selection] DONE renamed={renamed}")
    return renamed
