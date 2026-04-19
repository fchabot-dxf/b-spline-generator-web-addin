"""
Selection → projection-spec inference.

Public API
----------
classify_selection(entities) -> str
    One of 'empty' | 'seeds' | 'projections' | 'mixed'. The bridge should call
    this first and route: seeds go through the existing seed/sequence path,
    projections go through `detect_projections()`, mixed gets refused.

detect_projections(entities) -> dict
    Returns a result dict:
        Success: {
            'ok':          True,
            'projections': [ {SourceSketch, SourceID, TargetID}, ... ],
            'sources':     {'1_bounding-box', ...},
            'note':        str | None,   # status-bar info ('', multi-source, etc.)
        }
        Refusal: {
            'ok':       False,
            'reason':   str,           # short code: 'untagged_source' | 'non_sketch_source'
            'message':  str,           # human-readable status-bar line
            'bad_picks': [entity_token, ...],
        }

Expected shape of a projection row (matches existing phase files):

    {'SourceSketch': '2_shape-outline',
     'SourceID':     'horn_TL',
     'TargetID':     'proj_horn_TL'}

Assumptions (matching the FrameBuilder runtime):
  - Every source entity is expected to carry a FrameBuilder 'ID' attribute.
    Untagged sources are a hard refusal — they indicate an upstream phase
    failed to stamp, and the downstream projection would be un-resolvable.
  - Source sketches in Fusion are named with the template prefix
    (e.g. 'T2_2_shape-outline') while projection specs use the unprefixed
    form ('2_shape-outline'); the prefix is stripped here.

Integration sketch (for the bridge):

    kind = classify_selection(entities)
    if kind == 'empty':
        return
    if kind == 'mixed':
        status_bar_amber('Mixed pick: seeds + projections. Pick one kind.')
        return
    if kind == 'seeds':
        existing_seed_path(entities)
        return
    # kind == 'projections'
    result = detect_projections(entities)
    if result['ok']:
        emit_projection_block(result['projections'])
        if result['note']:
            status_bar(result['note'])
    else:
        status_bar_amber(result['message'])
"""

import re

# Crash-durable diagnostic channel — same fsync-per-write log used by
# ``[bp-*]``, ``[gate-*]``, ``[attr-*]``, ``[foc-*]``. The projection
# path is the parallel sibling of the seed/ownership path: both run on
# every pick, but only the seed side has been instrumented so far.
# Adding ``[proj-*]`` probes closes the visibility gap the user flagged
# — when a picked SketchLine shows up as "0 owned, 1 unowned" the log
# should also tell us whether ``_is_projected`` saw ``isReference=True``,
# what ``classify_selection`` returned, and whether ``detect_projections``
# produced a block or a refusal. Line-up is on timestamp with the
# ``[bp-*]`` / ``[gate-*]`` traces of the same pick.
from detection_log import _log_detection


_PREFIX_RE = re.compile(r'^T\d+_')


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def _read_fb_id(entity):
    """Return the FrameBuilder ID on an entity, or '' if none."""
    try:
        attrs = getattr(entity, 'attributes', None)
        if attrs is None:
            return ''
        attr = attrs.itemByName('FrameBuilder', 'ID')
        if attr and attr.value:
            return attr.value
        # Backward-compat: older entities used 'name' instead of 'ID'.
        attr_old = attrs.itemByName('FrameBuilder', 'name')
        if attr_old and attr_old.value:
            return attr_old.value
    except Exception:
        pass
    return ''


def _strip_template_prefix(sketch_name):
    """Drop a leading 'T<digits>_' from a sketch name, if present."""
    if not sketch_name:
        return ''
    return _PREFIX_RE.sub('', sketch_name, count=1)


def _entity_token(entity):
    """Best-effort stable identifier for an entity, for reporting bad picks."""
    try:
        tok = getattr(entity, 'entityToken', None)
        if tok:
            return tok
        if hasattr(entity, 'tempId'):
            return f'tempId:{entity.tempId}'
    except Exception:
        pass
    return f'id:{id(entity)}'


def _candidate_forms(entity):
    """Return [entity, entity.nativeObject] minus duplicates — same fallback
    pattern as `_detect_sketch_name` uses in template_bridge.py."""
    candidates = [entity]
    native = getattr(entity, 'nativeObject', None)
    if native is not None and native is not entity:
        candidates.append(native)
    return candidates


def _is_projected(entity):
    """True if this entity (or its nativeObject) has isReference=True.

    Both candidate forms are probed because Fusion occasionally presents
    a Selection pick as a shallow proxy whose ``isReference`` slot reads
    False while the wrapped ``nativeObject`` reads True. The fallback
    makes the classifier agree with Fusion's own "is this a projection?"
    semantics regardless of which layer the pick arrived at.

    Instrumented with ``[proj-is]`` markers — one per candidate form so
    a log tail after a selection shows which form carried the verdict
    (or whether both failed to resolve).
    """
    ent_type = type(entity).__name__
    _log_detection(None, f"[proj-is]     enter type={ent_type}")
    for idx, c in enumerate(_candidate_forms(entity)):
        try:
            val = getattr(c, 'isReference', False)
            _log_detection(
                None,
                f"[proj-is]     [{idx}] type={type(c).__name__} "
                f"isReference={val}",
            )
            if val:
                _log_detection(None, "[proj-is]     verdict=True")
                return True
        except Exception as e:
            _log_detection(
                None,
                f"[proj-is]     [{idx}] raised {type(e).__name__}: {e}",
            )
            continue
    _log_detection(None, "[proj-is]     verdict=False")
    return False


def _get_source(entity):
    """
    If `entity` is a projected entity, return its sketch-side source entity
    (a SketchCurve or SketchPoint in the origin sketch). Returns:

        (source, kind)

    where kind is one of:
        'sketch' — source is a sketch entity, ready to read FB ID from
        'brep'   — source is BRep (body) geometry, can't produce a SourceID
        'none'   — entity isn't projected, or source not resolvable
    """
    for c in _candidate_forms(entity):
        try:
            if not getattr(c, 'isReference', False):
                continue
            ref = getattr(c, 'referencedEntity', None)
            if ref is None:
                continue
            if getattr(ref, 'parentSketch', None) is not None:
                return ref, 'sketch'
            # Projected from a body edge/face.
            return ref, 'brep'
        except Exception:
            continue
    return None, 'none'


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def classify_selection(entities):
    """
    Classify a selection as one of 'empty' | 'seeds' | 'projections' | 'mixed'.

    Any single projected entity makes the selection 'projections'. Any native
    (non-reference) entity makes it 'seeds'. Both present → 'mixed'.

    Instrumented with ``[proj-cls]`` markers — one per pick plus a final
    verdict line. The palette renders radically different UI depending on
    ``kind`` (projections panel vs seed/ownership path), so a disagreement
    between what the user expected and what actually got rendered almost
    always traces back to a single ``_is_projected`` call returning the
    wrong answer for the pick the user thought they were handing in. This
    log lets a tail answer "what did classify_selection decide for this
    exact pick?" without having to instrument the call-site.
    """
    _log_detection(None, f"[proj-cls]    enter count={len(entities) if entities else 0}")
    if not entities:
        _log_detection(None, "[proj-cls]    verdict=empty (no entities)")
        return 'empty'

    any_projected = False
    any_native = False
    for idx, ent in enumerate(entities):
        _log_detection(
            None,
            f"[proj-cls]    [{idx}] type={type(ent).__name__} "
            f"-> _is_projected",
        )
        if _is_projected(ent):
            any_projected = True
            _log_detection(None, f"[proj-cls]    [{idx}] -> projected")
        else:
            any_native = True
            _log_detection(None, f"[proj-cls]    [{idx}] -> native")
        if any_projected and any_native:
            _log_detection(None, "[proj-cls]    verdict=mixed (short-circuit)")
            return 'mixed'

    if any_projected:
        _log_detection(None, "[proj-cls]    verdict=projections")
        return 'projections'
    if any_native:
        _log_detection(None, "[proj-cls]    verdict=seeds")
        return 'seeds'
    _log_detection(None, "[proj-cls]    verdict=empty (no verdict)")
    return 'empty'


def detect_projections(entities):
    """
    Build a projection spec from a selection of projected entities.

    Policy (locked):
      - Caller is responsible for ensuring the selection is all projections
        (use `classify_selection` first).
      - Any projected pick whose source lacks a FrameBuilder ID → HARD REFUSAL.
        The upstream phase is compromised; fix it there, not here.
      - Any projected pick sourced from BRep geometry → HARD REFUSAL. Not in
        scope for this tool.
      - Multi-source is allowed. Result carries a `note` so the status bar
        can show 'N projections from a + b'.
      - Duplicate picks (same source) are de-duped silently.
    """
    _log_detection(
        None,
        f"[proj-det]    enter count={len(entities) if entities else 0}",
    )
    rows = []
    seen = set()
    sources = set()
    untagged_picks = []
    brep_picks = []

    for idx, ent in enumerate(entities or []):
        _log_detection(
            None,
            f"[proj-det]    [{idx}] type={type(ent).__name__} -> _get_source",
        )
        src, kind = _get_source(ent)
        _log_detection(
            None,
            f"[proj-det]    [{idx}] src_kind={kind} "
            f"src_type={type(src).__name__ if src is not None else 'None'}",
        )

        if kind == 'none':
            # Caller should have filtered these out via classify_selection.
            # If they leak through, treat as a refusal too — it means our
            # classifier disagreed with the resolver about what counts as
            # projected.
            _log_detection(None, f"[proj-det]    [{idx}] none -> untagged")
            untagged_picks.append(_entity_token(ent))
            continue

        if kind == 'brep':
            _log_detection(None, f"[proj-det]    [{idx}] brep -> refusal")
            brep_picks.append(_entity_token(ent))
            continue

        # kind == 'sketch'
        _log_detection(None, f"[proj-det]    [{idx}] read FB ID from source")
        source_id = _read_fb_id(src)
        _log_detection(
            None,
            f"[proj-det]    [{idx}] source_id={source_id or '<none>'}",
        )
        if not source_id:
            untagged_picks.append(_entity_token(ent))
            continue

        _log_detection(None, f"[proj-det]    [{idx}] read source.parentSketch.name")
        sketch_raw = getattr(src.parentSketch, 'name', '') or ''
        source_sketch = _strip_template_prefix(sketch_raw)
        _log_detection(
            None,
            f"[proj-det]    [{idx}] source_sketch={source_sketch or '<none>'} "
            f"(raw={sketch_raw or '<none>'})",
        )
        if not source_sketch:
            untagged_picks.append(_entity_token(ent))
            continue

        key = (source_sketch, source_id)
        if key in seen:
            _log_detection(None, f"[proj-det]    [{idx}] dedup key={key}")
            continue
        seen.add(key)
        sources.add(source_sketch)

        rows.append({
            'SourceSketch': source_sketch,
            'SourceID':     source_id,
            'TargetID':     f'proj_{source_id}',
        })
        _log_detection(None, f"[proj-det]    [{idx}] row emitted")

    # Refusal cases take priority — never emit a partial block.
    if brep_picks:
        _log_detection(
            None,
            f"[proj-det]    exit refused=brep count={len(brep_picks)}",
        )
        return {
            'ok':        False,
            'reason':    'non_sketch_source',
            'message':   (f'{len(brep_picks)} pick(s) projected from body '
                          'geometry — not supported. Project from a sketch.'),
            'bad_picks': brep_picks,
        }

    if untagged_picks:
        _log_detection(
            None,
            f"[proj-det]    exit refused=untagged count={len(untagged_picks)}",
        )
        return {
            'ok':        False,
            'reason':    'untagged_source',
            'message':   (f'{len(untagged_picks)} pick(s) have untagged '
                          'sources — fix the upstream phase.'),
            'bad_picks': untagged_picks,
        }
    _log_detection(None, f"[proj-det]    exit ok rows={len(rows)} sources={len(sources)}")

    # Success — build the note.
    note = None
    if len(sources) > 1:
        note = (f'{len(rows)} projections from '
                f'{" + ".join(sorted(sources))}')
    elif len(sources) == 1:
        note = f'{len(rows)} projections from {next(iter(sources))}'

    return {
        'ok':          True,
        'projections': rows,
        'sources':     sources,
        'note':        note,
    }


# Kept for backward compat with anything that imported the old helper.
def summarize(projections):
    sources = {p['SourceSketch'] for p in projections}
    return len(projections), sources


# ---------------------------------------------------------------------------
# Phase-file formatter
# ---------------------------------------------------------------------------

def format_projection_block(projections, phase_name='Projections',
                            phase_id='p01_projs'):
    """
    Format a list of projection dicts into the same get_block() shape used by
    existing phase files (see `T5_p03_projs.py`).

    Returns a string like:

        def get_block(ui_data=None):
            \"\"\"
            Auto-generated projections block.
            \"\"\"
            return {
                "PhaseID": "p03_projs",
                "Name": "Projections",
                "Projections": [
                    {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_TL', 'TargetID': 'proj_BB_corner_TL'},
                    ...
                ]
            }

    If `projections` is empty, returns a comment noting that.
    """
    if not projections:
        return '# No projections detected in the current selection.'

    # Column-align the three keys for readability, matching the pattern in
    # your hand-written phase files.
    max_src_sketch = max(len(p['SourceSketch']) for p in projections)
    max_src_id = max(len(p['SourceID']) for p in projections)
    max_tgt_id = max(len(p['TargetID']) for p in projections)

    rows = []
    for p in projections:
        src_sk = f"'{p['SourceSketch']}'".ljust(max_src_sketch + 3)
        src_id = f"'{p['SourceID']}'".ljust(max_src_id + 3)
        tgt_id = f"'{p['TargetID']}'".ljust(max_tgt_id + 2)
        rows.append(
            f"        {{'SourceSketch': {src_sk}"
            f"'SourceID': {src_id}"
            f"'TargetID': {tgt_id}}},"
        )

    return (
        "def get_block(ui_data=None):\n"
        '    """\n'
        "    Auto-generated projections block.\n"
        '    """\n'
        "    return {\n"
        f'        "PhaseID": "{phase_id}",\n'
        f'        "Name": "{phase_name}",\n'
        '        "Projections": [\n'
        + "\n".join(rows) + "\n"
        "        ]\n"
        "    }\n"
    )
