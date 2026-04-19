import re
from template_payload import _get_native, _label_for_entity


def safe_name(value):
    if not value:
        return ''
    text = re.sub(r'\s+', '_', str(value).strip())
    text = re.sub(r'[^0-9A-Za-z_]', '', text)
    return text


def get_parent_sketch_prefix(ent):
    """Return a safe_name'd prefix for ``ent``'s owning sketch, or None.

    Everything is inside a broad try/except because Python 3's
    ``getattr(obj, name, default)`` only swallows ``AttributeError`` —
    Fusion raises ``"3 : object does not support attributes"`` as a bare
    ``RuntimeError`` when a subtype's proxy refuses a slot access
    (constraints don't expose ``parentSketch`` on every subtype / in
    every state). Without this guard the RuntimeError escaped up
    through ``make_unique_label`` and took the rename handler down
    with it on CoincidentConstraint picks. Returning None falls
    through to the un-prefixed label, which is the correct behaviour
    for any entity whose parent sketch can't be probed.
    """
    try:
        sketch = getattr(ent, 'parentSketch', None)
        if sketch is not None and hasattr(sketch, 'name'):
            return safe_name(sketch.name)
    except Exception:
        pass
    return None


def make_unique_label(ent, base_label, label_counts, phase_prefix=None):
    """Return a unique label for ``ent``.

    Critical: we only probe ``ent.parentSketch`` when ``base_label``
    actually starts with ``"Sketch"`` — for any other label the prefix
    would be discarded anyway. This matters because
    ``get_parent_sketch_prefix`` is a proxy-sensitive call on a Fusion
    entity, and Python-level try/except can only catch Python
    exceptions — a Fusion native AV (observed on CoincidentConstraint
    proxies disturbed by concurrent selection-change rebuilds) kills
    the process outright. The old code called it unconditionally and
    threw the result away for non-Sketch labels, which meant
    constraints paid the full native-AV risk for a value that was
    never used. Guarding the call behind the label check eliminates
    the dead proxy probe entirely.

    The outer try/except is still here as a belt-and-braces Layer-2
    guard for the labels that DO go through the sketch-prefix path
    (Sketch-named curves), but no longer gets exercised by
    constraints.
    """
    try:
        label = base_label
        # Phase-prefix the generic type labels so they don't collide
        # across phases. ``Sketch*`` covers SketchLine/SketchArc/
        # SketchCircle/etc. that fell through to the objectType
        # fallback; ``dim_*`` covers the dimension subtypes that
        # ``_label_for_entity`` now normalises (``dim_radial``,
        # ``dim_linear``, …) so the final FB:ID comes out
        # ``{phase}_dim_radial`` — matching the existing
        # ``{phase}_SketchLine_NN`` convention for unnamed curves.
        if base_label.startswith('Sketch') or base_label.startswith('dim_'):
            if phase_prefix:
                label = f'{safe_name(phase_prefix)}_{base_label}'
            else:
                sketch_prefix = get_parent_sketch_prefix(ent)
                if sketch_prefix:
                    label = f'{sketch_prefix}_{base_label}'
        count = label_counts.get(label, 0) + 1
        label_counts[label] = count
        if count > 1:
            label = f'{label}_{count:02d}'
        return label
    except Exception:
        return base_label
