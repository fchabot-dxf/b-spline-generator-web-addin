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
# Crash-durable diagnostic channel — same fsync-per-write log that the
# ``[probe-*]`` and ``[gate-*]`` instrumentation uses. We need finer-grained
# ``[bp-*]`` markers in this module to catch the silence gap between
# ``build_template_payload: selection=N`` and the first ``[gate-*]`` line.
# For the CoincidentConstraint crash chain the gate's own logs never fire,
# so death must be happening in ``_expand_offset_picks`` OR in an early
# branch of ``is_framebuilder_owned`` before the constraint-branch
# instrumentation kicks in. ``[bp-*]`` pinpoints which entity and which
# call was the last thing Fusion did before silence.
from detection_log import _log_detection


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


def _type_short(ent):
    """Short objectType name for log lines — never raises.

    Used only by ``[bp-*]`` diagnostic lines. Wraps the ``objectType``
    read itself in try/except because the whole point of this
    instrumentation is to survive a settling-proxy that refuses basic
    slot access (which is exactly the CoincidentConstraint symptom
    ``_has_framebuilder_attribute`` is chasing).
    """
    try:
        ot = getattr(ent, 'objectType', '') or ''
        return ot.split('::')[-1] if ot else type(ent).__name__
    except Exception:
        return '<unreadable>'


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
    _log_detection(None, f"[bp-expand-in]  entities={len(entities)}")
    expanded = []
    seen_ocs = set()
    for idx, ent in enumerate(entities):
        _log_detection(
            None,
            f"[bp-expand]     [{idx}] native-in type={_type_short(ent)}",
        )
        native = _get_native(ent)
        native_type = _type_short(native)
        _log_detection(
            None,
            f"[bp-expand]     [{idx}] native-out type={native_type}",
        )
        _log_detection(
            None,
            f"[bp-expand]     [{idx}] is_offset_constraint check",
        )
        if is_offset_constraint(native):
            _log_detection(None, f"[bp-expand]     [{idx}] IS offset, keeping")
            key = oc_identity_key(native)
            if key is None or key in seen_ocs:
                continue
            seen_ocs.add(key)
            expanded.append(native)
            continue
        # Skip the offset-child reverse-lookup for non-curve entity types.
        # Constraints (other than OffsetConstraint, handled above) and
        # dimensions can never appear in an OffsetConstraint's
        # ``childCurves`` collection, so the lookup is semantically
        # meaningless for them.
        #
        # Skipping is also required for crash safety:
        # ``find_owning_offset_constraint`` reads ``curve.parentSketch`` as
        # its first slot, and on a ``CoincidentConstraint`` proxy that read
        # is a VERIFIED delayed native-AV site. The ``_safe_getattr``
        # wrapper catches the Python-level RuntimeError cleanly, but the
        # slot touch still corrupts Fusion's internal state and a repaint
        # ~4 s later dereferences the poisoned pointer. See the ``[foc-*]``
        # diagnostic log for the 20:58:47 repro — last durable line before
        # Fusion dies is exactly ``[foc-probe] parentSketch`` on a
        # ``CoincidentConstraint``.
        #
        # Arcs, lines, circles, splines, points, and dimensions all
        # tolerate ``parentSketch`` cleanly (observed in the same repro
        # log), so the guard is narrow to constraint/dimension types.
        # Dimensions are excluded from the lookup for the semantic reason
        # only — no crash hazard for them.
        if native_type.endswith('Constraint') or native_type.endswith('Dimension'):
            _log_detection(
                None,
                f"[bp-expand]     [{idx}] non-curve type={native_type}, "
                "skipping offset reverse-lookup",
            )
            # Coincidence is now expressed via ENTITY selection
            # (coincidence_clusters.detect_coincidence_pairs) rather
            # than by picking a CC glyph. A directly-picked
            # CoincidentConstraint is therefore a user mistake — the
            # picked-proxy form is hazardous to probe (``.point`` /
            # ``.entity`` corrupt Fusion's pointer graph with a delayed
            # native-AV) and we no longer have a safe iterated-proxy
            # swap pre-pass. The ownership gate's ``cc_proxy`` canary
            # refuses it cleanly at that later stage, so we just pass
            # it through unchanged here and let the gate reject it.
            expanded.append(native)
            continue
        _log_detection(
            None,
            f"[bp-expand]     [{idx}] find_owning_offset_constraint",
        )
        oc = find_owning_offset_constraint(native)
        _log_detection(
            None,
            f"[bp-expand]     [{idx}] find_owning_offset_constraint -> "
            f"{_type_short(oc) if oc is not None else 'None'}",
        )
        if oc is not None:
            key = oc_identity_key(oc)
            if key is None or key in seen_ocs:
                continue
            seen_ocs.add(key)
            expanded.append(oc)
            continue
        expanded.append(native)
    _log_detection(None, f"[bp-expand-out] kept={len(expanded)}")
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
    _log_detection(None, f"[bp-enter]      build_payload_items entities={len(entities)}")
    entities = _expand_offset_picks(entities)
    items = []
    unowned = []
    label_counts = {}
    for idx, ent in enumerate(entities):
        _log_detection(
            None,
            f"[bp-item]       [{idx}] type={_type_short(ent)} -> _get_native",
        )
        native = _get_native(ent)
        _log_detection(
            None,
            f"[bp-item]       [{idx}] native type={_type_short(native)} "
            f"-> is_framebuilder_owned",
        )
        owned = is_framebuilder_owned(native)
        _log_detection(
            None,
            f"[bp-item]       [{idx}] owned={owned}",
        )
        if not owned:
            unowned.append(_describe_unowned(native))
            continue
        base_label = _label_for_entity(native)
        label = make_unique_label(native, base_label, label_counts, phase_prefix=phase_prefix)
        coord = get_entity_coord(native) or ''
        expr = _strip_point_prefix(get_entity_coord_expr(native)) or coord
        hint = _build_entity_hint(native, None, get_entity_coord_expr, name_override=label)
        meta = get_fb_metadata(native) if hasattr(native, 'attributes') else ''

        # ``construction`` is a palette-facing cosmetic flag — the
        # Sequence renderer uses it to prefix construction seeds with
        # a muted "◌" glyph so users can tell at a glance which picks
        # were construction curves. The authoritative source of truth
        # for the runtime is still the ``isConstruction=True`` kwarg
        # baked into ``hint`` by the shape-hint handlers; this key is
        # redundant for code emission but cheaper to read in JS than
        # re-parsing the hint string.
        try:
            is_construction = bool(getattr(native, 'isConstruction', False))
        except Exception:
            is_construction = False
        items.append({
            'name': label,
            'coord': coord,
            'coordExpr': expr,
            'meta': meta,
            'hint': hint,
            'construction': is_construction,
        })
    _log_detection(
        None,
        f"[bp-exit]       build_payload_items items={len(items)} unowned={len(unowned)}",
    )
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
