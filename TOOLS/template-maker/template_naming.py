import re
from template_payload import _get_native, _label_for_entity


def safe_name(value):
    if not value:
        return ''
    text = re.sub(r'\s+', '_', str(value).strip())
    text = re.sub(r'[^0-9A-Za-z_]', '', text)
    return text


def get_parent_sketch_prefix(ent):
    sketch = getattr(ent, 'parentSketch', None)
    if sketch is not None and hasattr(sketch, 'name'):
        return safe_name(sketch.name)
    return None


def make_unique_label(ent, base_label, label_counts, phase_prefix=None):
    label = base_label
    if phase_prefix and base_label.startswith('Sketch'):
        label = f'{safe_name(phase_prefix)}_{base_label}'
    else:
        sketch_prefix = get_parent_sketch_prefix(ent)
        if sketch_prefix and base_label.startswith('Sketch'):
            label = f'{sketch_prefix}_{base_label}'
    count = label_counts.get(label, 0) + 1
    label_counts[label] = count
    if count > 1:
        label = f'{label}_{count:02d}'
    return label
