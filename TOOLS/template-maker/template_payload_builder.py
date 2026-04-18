from template_payload import (
    _build_entity_hint,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
    _strip_point_prefix,
    _get_native,
    _label_for_entity,
    is_framebuilder_owned,
)
from template_naming import make_unique_label
from entity_helpers import get_entity_coord, get_fb_metadata
from expression_coords import get_entity_coord_expr
from template_code import wrap_statement
from phase_parser import parse_statement_to_phase_step, format_phase_step
from offset_hint import (
    is_offset_constraint,
    find_owning_offset_constraint,
    oc_identity_key,
)


def _describe_unowned(ent):
    """Compact dict for one entity that failed the ownership gate.

    The palette surfaces these so the user knows which picks were
    skipped, without us having to round-trip the native object.
    """
    try:
        ent_type = getattr(ent, 'objectType', '') or ''
        type_short = ent_type.split('::')[-1] if ent_type else 'Entity'
    except Exception:
        type_short = 'Entity'
    token = ''
    try:
        token = getattr(ent, 'entityToken', '') or ''
        if not token and hasattr(ent, 'tempId'):
            token = f'tempId:{ent.tempId}'
    except Exception:
        pass
    return {'type': type_short, 'token': token}


def _expand_offset_picks(entities):
    """Resolve each picked entity to what actually belongs in the phase block.

    Three cases, checked in this order:

    1. The pick IS an OffsetConstraint — keep it (deduplicated by
       identity key so two picks of the same OC don't emit twice).
    2. The pick is a child curve of some OffsetConstraint — replace it
       with the owning OC. This is the common case: users almost always
       click the offset-result curves, not the OC glyph itself. The scan
       has to reverse-lookup the OC from the child so the emitter gets
       one ``Offset.From(...)`` step per constraint rather than one
       un-seedable naked curve per child.
    3. Everything else — pass through unchanged.

    Cases 1 and 2 share the ``seen_ocs`` dedup set so picking a parent
    OC *and* one of its children collapses to a single entry, regardless
    of which order they were selected in.

    Returns a list of native entities with offsets collapsed. Callers
    still run the ownership gate and label pass on the result — that
    logic is unchanged downstream of this pre-pass.
    """
    expanded = []
    seen_ocs = set()
    for ent in entities:
        native = _get_native(ent)
        if is_offset_constraint(native):
            key = oc_identity_key(native)
            if key is None or key in seen_ocs:
                continue
            seen_ocs.add(key)
            expanded.append(native)
            continue
        oc = find_owning_offset_constraint(native)
        if oc is not None:
            key = oc_identity_key(oc)
            if key is None or key in seen_ocs:
                continue
            seen_ocs.add(key)
            expanded.append(oc)
            continue
        expanded.append(native)
    return expanded


def build_payload_items(entities, phase_prefix=None):
    """Build hint/coord items for each entity that passes the ownership gate.

    Returns a ``(items, unowned)`` tuple:

      items   — list of payload item dicts for FrameBuilder-owned picks.
                Shape unchanged from the pre-gate version, so the rest of
                the pipeline (code preview, phase-step parser, variable
                collector) doesn't need to know the gate exists.

      unowned — list of ``{'type', 'token'}`` dicts describing every
                pick that was filtered out. The palette uses this to
                surface a "N untagged entities skipped — rename first"
                warning. Empty list on the happy path.

    A pre-pass via ``_expand_offset_picks`` collapses child-curve picks
    to their owning OffsetConstraints (and dedups direct OC picks). Done
    up front so the ownership gate + label pass see a single canonical
    entity per offset rather than N-times-the-children drift.
    """
    entities = _expand_offset_picks(entities)
    items = []
    unowned = []
    label_counts = {}
    for ent in entities:
        native = _get_native(ent)
        if not is_framebuilder_owned(native):
            unowned.append(_describe_unowned(native))
            continue
        base_label = _label_for_entity(native)
        label = make_unique_label(native, base_label, label_counts, phase_prefix=phase_prefix)
        coord = get_entity_coord(native) or ''
        expr = _strip_point_prefix(get_entity_coord_expr(native)) or coord
        hint = _build_entity_hint(native, None, get_entity_coord_expr, name_override=label)
        meta = get_fb_metadata(native) if hasattr(native, 'attributes') else ''

        items.append({
            'name': label,
            'coord': coord,
            'coordExpr': expr,
            'meta': meta,
            'hint': hint
        })
    return items, unowned


def build_code_preview(items):
    """Render the Sequence section as phase-step dict literals.

    FrameBuilder's parametric engine executes ``BuildSequence`` — a list
    of dict specs like ``{'ID': ..., 'Type': ..., 'Points': [...]}``.
    The earlier ``seeds.append(Seeds.Arc(...))`` format this function
    used to emit doesn't map to any runtime path in the engine, so
    assembling Wrapper + Sequence + Footer produced Python that loaded
    cleanly but executed as a no-op.

    Each item's ``hint`` (a ``Seeds.*`` / ``Constraints.*`` /
    ``Dimensions.*`` call string built by ``_build_entity_hint``) is
    parsed into a step dict via ``parse_statement_to_phase_step`` and
    then formatted by ``format_phase_step``. ``wrap_statement`` adds
    the list-interior indent so the output slots directly into the
    wrapper's ``seq = [ ... ]``.

    Items that fail to parse are skipped silently — the canonical place
    for that failure is the detection log, not the preview.
    """
    lines = []
    for item in items:
        step = parse_statement_to_phase_step(item['hint'])
        if not step:
            continue
        formatted = format_phase_step(step)
        wrapped = wrap_statement(formatted)
        if wrapped:
            lines.append(wrapped)
    return '\n'.join(lines)
