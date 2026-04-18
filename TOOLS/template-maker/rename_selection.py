import re
from template_payload import _get_native, _label_for_entity
from template_naming import make_unique_label, safe_name


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
    if not ent or not name:
        return

    try:
        if hasattr(ent, 'attributes'):
            attr = ent.attributes.itemByName('FrameBuilder', 'ID')
            if attr:
                attr.value = name
            else:
                ent.attributes.add('FrameBuilder', 'ID', name)

            attr_old = ent.attributes.itemByName('FrameBuilder', 'name')
            if attr_old:
                attr_old.value = name
            else:
                ent.attributes.add('FrameBuilder', 'name', name)

        if hasattr(ent, 'name'):
            try:
                ent.name = name
            except Exception:
                pass
    except Exception:
        pass


def _existing_fb_id(ent):
    """Return the FrameBuilder:ID value already stamped on this entity,
    or '' if none is set. Existing IDs are considered user-owned — the
    user intentionally reuses IDs across features, so Rename Selection
    must never overwrite one that's already there."""
    if not ent or not hasattr(ent, 'attributes'):
        return ''
    try:
        attr = ent.attributes.itemByName('FrameBuilder', 'ID')
        if attr and attr.value:
            return attr.value
    except Exception:
        pass
    return ''


def rename_selection(entities, phase_prefix=None):
    if not entities:
        return 0

    label_counts = {}
    renamed = 0

    for ent in entities:
        native = _get_native(ent)

        # Preserve any FrameBuilder:ID that's already assigned. The user
        # reuses IDs across features (sometimes on multiple entities at
        # once), so a rename pass must leave them alone. We still
        # register the existing ID in label_counts so fresh entities in
        # the same pass don't accidentally generate a label that
        # collides with it.
        existing_id = _existing_fb_id(native)
        if existing_id:
            label_counts[existing_id] = label_counts.get(existing_id, 0) + 1
            continue

        base_label = _label_for_entity(native)
        new_label = make_unique_label(native, base_label, label_counts, phase_prefix=phase_prefix)
        if new_label != base_label:
            set_entity_fb_name(native, new_label)
            renamed += 1

    return renamed
