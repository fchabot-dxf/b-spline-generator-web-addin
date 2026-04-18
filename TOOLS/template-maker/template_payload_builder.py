from template_payload import (
    _build_entity_hint,
    _collect_design_variables,
    _collect_variables,
    _merge_variables,
    _strip_point_prefix,
    _get_native,
    _label_for_entity,
)
from template_naming import make_unique_label
from entity_helpers import get_entity_coord, get_fb_metadata
from expression_coords import get_entity_coord_expr
from template_code import wrap_statement


def build_payload_items(entities, phase_prefix=None):
    items = []
    label_counts = {}
    for ent in entities:
        native = _get_native(ent)
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
    return items


def build_code_preview(items):
    # Annotation comments (item name, coordExpr, FrameBuilder metadata) live
    # in the item panels in the palette UI; they're intentionally kept OUT
    # of the generated code preview so the copy-out is pure executable code
    # wrapped only by the header/footer. The only `# ...` lines in the
    # output belong to the header wrapper itself.
    lines = []
    for item in items:
        statement = wrap_statement(item['hint'])
        if statement:
            lines.append(statement)
    return '\n'.join(lines)
