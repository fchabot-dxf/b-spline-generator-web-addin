import adsk.core, adsk.fusion
from fb_shared.expression_coords import get_design_params, get_entity_coord_expr
from phase_parser import parse_statement_to_phase_step, format_phase_step, RawCode, LiteralString

_parse_statement_to_phase_step = parse_statement_to_phase_step
RawCode = RawCode
LiteralString = LiteralString
from template_payload import (
    _build_entity_hint,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
    _strip_point_prefix,
    _get_native,
    _log_detection,
    BUILTIN_TEMPLATE_VARIABLES,
)
from template_payload_builder import (
    build_payload_items,
    build_code_preview,
    _expand_offset_picks,
)
from template_code import build_header, build_footer, wrap_statement, format_phase_block
from template_variable_block import format_variable_block
# Coincidence-cluster detection for SketchPoint picks. Size-2 clusters
# auto-emit as ``CoincidentConstraint`` phase steps; size-3+ clusters
# surface via ``coincidenceClusters`` for palette-side disambiguation.
# Runs AFTER ``build_payload_items`` so the main entity list (seeds,
# constraints, dimensions) is fully resolved before we append the
# synthetic coincidence items.
from coincidence_clusters import detect_coincidence_pairs, emit_coincident_hint


# Legacy aliases preserved for compatibility with the existing test harness.
_default_header = build_header
_default_footer = build_footer
_wrap_sequence_hint = wrap_statement


def _build_phase_block_code(items, phase_name='Generated Phase', phase_id='p01_generated', function_name='get_block', template_number='T2'):
    # Only the get_block() wrapper contributes `# ...` lines. Items that
    # don't parse into a phase step are dropped silently rather than
    # showing as stray comment fallbacks in the output.
    lines = []
    for item in items:
        step = parse_statement_to_phase_step(item['hint'])
        if step:
            lines.append(format_phase_step(step))
    return format_phase_block(lines, phase_name=phase_name, phase_id=phase_id, function_name=function_name, template_number=template_number)


def build_template_payload(entities, phase_prefix=None, phase_id=None, phase_name=None, template_number='T2', detected_sketch_name=None, cluster_picks=None):
    count = len(entities)
    logs = []
    # CRITICAL: swap picked CoincidentConstraint proxies for iterated ones
    # BEFORE the variable collector touches them. _collect_variables calls
    # _build_entity_hint → _constraint_targets, which reads .point / .entity.
    # On a picked CC proxy those slots raise "vector too long" at the Python
    # level (caught) but corrupt Fusion's internal pointer graph — a repaint
    # ~4 s later dereferences the poisoned pointer and native-AVs.
    #
    # _expand_offset_picks is idempotent: an already-iterated CC distance-
    # matches itself (0 dist) and passes through unchanged, so build_payload_
    # items calling the same helper again downstream is a safe no-op. The
    # swap is cheap (one O(n) walk over sketch.geometricConstraints) next
    # to the cost of crashing the host.
    if count:
        entities = _expand_offset_picks(entities)
    design_vars = _collect_design_variables(logs, get_design_params)
    # Only accept selection-derived tokens that are real Fusion user
    # parameters (minus built-ins like widthIn/heightIn which are always
    # pre-existing in the Frame Builder runtime and read-only — they should
    # not be declared again in the T1 vars block).
    all_param_names = set((get_design_params() or {}).keys())
    valid_names = all_param_names - BUILTIN_TEMPLATE_VARIABLES
    selection_vars = _collect_variables(
        entities,
        '',
        logs,
        None,
        get_entity_coord_expr,
        lambda ent, params: _build_entity_hint(ent, params, get_entity_coord_expr),
        valid_names=valid_names,
    )
    _log_detection(logs, f"build_template_payload: selection={count} design_vars={len(design_vars)} selection_vars={len(selection_vars)}")
    merged_variables = _merge_variables(design_vars, selection_vars)
    payload = {
        'count': count,
        'mainFeature': 'Select sketch geometry...',
        'description': 'Select sketch geometry to preview seed and constraint snippets.',
        'codePreview': '# No selection yet. Select sketch entities to generate code previews.',
        'phaseBlockCode': '# No phase block generated yet.',
        'headerText': build_header(template_number=template_number),
        'footerText': build_footer(phase_name=phase_name or 'PhaseName', phase_id=phase_id or 'p01'),
        'variables': merged_variables,
        'variableBlock': format_variable_block(merged_variables),
        'logs': logs,
        'items': [],
        'linked': [],
        'linked_expr': [],
        'listLabel': 'Selection',
        'type': 'TemplateMaker',
        'detectedSketchName': detected_sketch_name or '',
        # Ownership gate — populated by ``build_payload_items``. The
        # palette reads ``unownedCount`` to decide whether to render the
        # "N untagged entities skipped" banner; ``unownedDetails`` is
        # kept for diagnostics so users can see which picks failed.
        'unownedCount': 0,
        'unownedDetails': [],
        # Track B — coincidence-cluster surface. ``coincidenceClusters``
        # carries EVERY size-3+ cluster (forced-resolved AND still-
        # unresolved) so the palette can keep its checkbox section
        # persistently visible — the earlier ``ambiguousClusters`` field
        # hid resolved clusters, which confused users trying to un-pick
        # a 2/2 cluster. ``autoCoincidentCount`` is a diagnostic so the
        # palette can show "N coincidences auto-paired" without having
        # to re-parse the emitted phase block.
        'coincidenceClusters': [],
        'autoCoincidentCount': 0,
    }

    if count == 0:
        return payload

    items, unowned = build_payload_items(entities, phase_prefix=phase_prefix)
    payload['items'] = items
    payload['unownedCount'] = len(unowned)
    payload['unownedDetails'] = unowned
    _log_detection(logs, f"Ownership gate: {len(items)} owned, {len(unowned)} unowned")

    # Coincidence-cluster pass — runs AFTER the main ownership gate so
    # that ``detect_coincidence_pairs`` can rely on every SketchPoint
    # having passed role-ID resolution at least once upstream. Size-2
    # clusters append synthetic ``CoincidentConstraint`` items; size-3+
    # clusters surface through the ``coincidenceClusters`` payload field
    # (palette renders checkboxes) regardless of whether they're still
    # ambiguous or already resolved via ``cluster_picks``. ``cluster_picks``
    # is the round-trip dict the palette sends back for size-3+ clusters.
    auto_pairs, coincidence_clusters = detect_coincidence_pairs(
        entities, forced_picks=cluster_picks,
    )
    for id_a, id_b in auto_pairs:
        hint = emit_coincident_hint(id_a, id_b)
        # Synthetic item shape — same keys the real entity items carry
        # so downstream consumers (``build_code_preview``,
        # ``_build_phase_block_code``, the palette's "linked" list
        # renderer) don't need to special-case. Empty ``name`` /
        # ``coord`` / ``coordExpr`` is intentional: constraints carry
        # no label or coord in the emitted phase block, and the
        # linked-list renderer skips empty-name items.
        items.append({
            'name': '',
            'coord': '',
            'coordExpr': '',
            'meta': '',
            'hint': hint,
        })
    payload['autoCoincidentCount'] = len(auto_pairs)
    payload['coincidenceClusters'] = coincidence_clusters
    unresolved = sum(1 for c in coincidence_clusters if not c['resolved'])
    _log_detection(
        logs,
        f"Coincidence clusters: auto_pairs={len(auto_pairs)} "
        f"size3+={len(coincidence_clusters)} unresolved={unresolved}",
    )

    for item in items:
        # Skip empty-name synthetics (coincidence auto-pairs) in the
        # linked-list view — those are constraint-only and would render
        # as blank pipe-separated lines. Their hint still lands in
        # ``codePreview`` / ``phaseBlockCode`` via ``items``.
        if not item['name']:
            continue
        payload['linked'].append(f"{item['name']} | {item['coord']}")
        payload['linked_expr'].append(f"{item['name']} | {item['coordExpr']}")

    payload['mainFeature'] = entities[0].objectType.split('::')[-1] if count == 1 else f'{count} Entities Selected'
    payload['description'] = 'Use the buttons below to wrap preview text into a phase module header/footer.'
    payload['codePreview'] = build_code_preview(items)
    payload['phaseBlockCode'] = _build_phase_block_code(
        items,
        phase_name=phase_name or 'Generated Phase',
        phase_id=phase_id or 'p01_generated',
        template_number=template_number,
    )
    return payload