import json
import subprocess
import traceback
import adsk.core
import adsk.fusion
from template_generator import build_template_payload
from rename_selection import rename_selection, build_phase_prefix
from detect_projections import (
    classify_selection,
    detect_projections,
    format_projection_block,
)
# Bridge-level marker for the projection branch. ``detect_projections``
# has its own ``[proj-cls]`` / ``[proj-det]`` probes; the ``[proj-kind]``
# line below lines those up against the ``Ownership gate: X owned, Y
# unowned`` summary that ``build_template_payload`` emits on the same
# selection. Together they answer "did the seed-path gate and the
# projection classifier agree on what this pick was?".
from detection_log import _log_detection as _log_proj

_latest_payload = ''
_last_sel_ids = ''
_latest_phase_id = 'p01'
# Phase Number — ``_MM`` position within a sketch in the filename scheme
# ``p{sketch:02}_{phase:02}_{descriptor}.py``. Carried through from the
# palette; entity naming still uses ``phase_id`` alone.
_latest_phase_number = '01'
# Full phase-file basename the palette shows in its File Name field.
_latest_file_name = 'p01_01.py'
_latest_sketch_name = ''          # User's explicit override (empty = use detected)
_latest_template_number = 'T2'
_detected_sketch_name = ''        # Auto-detected from current selection / edit context
# Coincidence-cluster round-trip state. Populated by the ``clusterPicks``
# HTML event — the palette sends a dict mapping ``clusterId`` →
# ``[index_a, index_b]`` for each size-3+ cluster where the user has
# checked exactly 2 points. Consumed by ``build_template_payload`` via
# the ``cluster_picks`` kwarg so size-3+ clusters resolve to auto-pairs
# on the next push.
#
# Kept as a module global (not a per-call param from the palette) for
# two reasons: (1) ``_push_selection_to_palette`` is the only place
# that calls ``build_template_payload``, and it has no other path to
# receive palette-side state; (2) cluster picks need to SURVIVE the
# next selection-change refresh so the user doesn't lose their choices
# to an unrelated sketch tweak. Cleared only when the selection
# fingerprint changes clusters out from under the saved picks.
_latest_cluster_picks = {}


def _effective_sketch_name():
    """Prefer the user's explicit sketch-name override; fall back to the
    sketch detected from the current selection or the active edit object."""
    return _latest_sketch_name or _detected_sketch_name or ''


def _get_phase_prefix():
    # Delegate to ``rename_selection.build_phase_prefix`` — the single
    # source of truth for the "{sketch_name}_{phase_id}" format. Before
    # consolidation this function, ``template-maker._get_phase_prefix``,
    # and ``build_phase_prefix`` itself each carried their own concat,
    # and at one point they drifted (template_bridge used the raw sketch
    # name while build_phase_prefix ran it through ``safe_name`` to
    # strip hyphens — so a sketch named "T2_2_shape-outline" stamped
    # "T2_2_shapeoutline_p03" on entities but the palette-side phase
    # name showed "T2_2_shape-outline_p03"). One helper closes that gap.
    return build_phase_prefix(
        phase_id=_latest_phase_id,
        sketch_name=_effective_sketch_name(),
    )


def _get_phase_name():
    # Human-facing phase name — same shape as the prefix. The extra
    # ``'Generated Phase'`` fallback is here (not in ``build_phase_prefix``)
    # because the prefix returns None when both inputs are empty, and
    # callers on this side prefer a placeholder label over an empty
    # string when rendering the phase block header.
    return build_phase_prefix(
        phase_id=_latest_phase_id,
        sketch_name=_effective_sketch_name(),
    ) or 'Generated Phase'


def _detect_sketch_name(entities):
    """Return the name of the sketch that owns the current selection, or the
    sketch the user is currently editing in Fusion. Empty string if we can't
    determine one unambiguously (e.g. selection spans multiple sketches)."""
    # 1) Selection-driven: walk each entity's parent sketch.
    sketch_names = set()
    for ent in entities or []:
        try:
            sketch = getattr(ent, 'parentSketch', None)
            if sketch is None:
                # SketchPoints that were selected indirectly sometimes expose
                # the owning sketch via a different attribute on the native
                # object — grab it via ``nativeObject`` as a fallback.
                native = getattr(ent, 'nativeObject', None)
                if native is not None:
                    sketch = getattr(native, 'parentSketch', None)
            if sketch is not None:
                name = getattr(sketch, 'name', None)
                if name:
                    sketch_names.add(name)
        except Exception:
            continue
    if len(sketch_names) == 1:
        return next(iter(sketch_names))
    if len(sketch_names) > 1:
        # Ambiguous — don't guess. User will have to set it manually or
        # deselect the cross-sketch members.
        return ''

    # 2) No selection (or selection didn't expose a parent sketch) — fall
    # back to the active edit object. When the user is in-sketch, this is
    # the sketch itself.
    try:
        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        if design:
            active = design.activeEditObject
            if active and getattr(active, 'objectType', '') == adsk.fusion.Sketch.classType():
                return getattr(active, 'name', '') or ''
    except Exception:
        pass

    return ''


def _push_selection_to_palette():
    global _last_sel_ids, _latest_payload, _detected_sketch_name
    app = adsk.core.Application.get()
    ui = app.userInterface
    palette = ui.palettes.itemById('TemplateMaker_Palette')
    if not palette or not palette.isValid or not palette.isVisible:
        return

    doc = app.activeDocument
    doc_key = ''
    try:
        if doc:
            doc_key = getattr(doc, 'fullFilename', None) or getattr(doc, 'name', None) or str(doc)
    except Exception:
        doc_key = ''

    sels = ui.activeSelections
    count = sels.count if sels else 0
    entities = []
    current_ids = f'{doc_key}|'

    if count > 0:
        for i in range(count):
            try:
                ent = sels.item(i).entity
                if ent:
                    entities.append(ent)
                    key = getattr(ent, 'entityToken', None)
                    if not key and hasattr(ent, 'tempId'):
                        key = ent.tempId
                    current_ids += str(key or id(ent)) + '|'
            except Exception:
                pass

    # Always refresh the auto-detected sketch name on every push — the user
    # may have switched sketches even without a selection change.
    _detected_sketch_name = _detect_sketch_name(entities)
    # Include the detected name in the selection fingerprint so a sketch
    # switch (without a selection change) still triggers a re-push.
    current_ids += f'@{_detected_sketch_name}|'

    if current_ids == _last_sel_ids and _last_sel_ids != '':
        return
    _last_sel_ids = current_ids

    payload = build_template_payload(
        entities,
        phase_prefix=_get_phase_prefix(),
        phase_id=_latest_phase_id,
        phase_name=_get_phase_name(),
        template_number=_latest_template_number,
        detected_sketch_name=_detected_sketch_name,
        cluster_picks=_latest_cluster_picks,
    )

    # Projection inference — classify the selection, then either emit a ready
    # projection block, surface a refusal, or leave the payload's seed path
    # untouched.
    kind = classify_selection(entities)
    _log_proj(None, f"[proj-kind]   classify -> {kind} (count={len(entities)})")
    payload['selectionKind'] = kind
    payload['projections'] = []
    payload['projectionsOk'] = None
    payload['projectionsNote'] = None
    payload['projectionsError'] = None
    payload['projectionsReason'] = None
    payload['projectionsBlockCode'] = ''
    payload['badPicks'] = []
    payload['mixedPickWarning'] = None

    if kind == 'projections':
        result = detect_projections(entities)
        if result.get('ok'):
            payload['projectionsOk'] = True
            payload['projections'] = result['projections']
            payload['projectionsNote'] = result.get('note')
            payload['projectionsBlockCode'] = format_projection_block(
                result['projections'],
                phase_name=_get_phase_name(),
                phase_id=_latest_phase_id or 'p01_projs',
            )
        else:
            payload['projectionsOk'] = False
            payload['projectionsError'] = result.get('message', '')
            payload['projectionsReason'] = result.get('reason', '')
            payload['badPicks'] = result.get('bad_picks', [])
    elif kind == 'mixed':
        payload['mixedPickWarning'] = (
            'Mixed pick: seeds + projections. Pick one kind at a time.'
        )

    _latest_payload = json.dumps(payload)
    try:
        palette.sendInfoToHTML('update', _latest_payload)
    except Exception as e:
        _log(f"[ERROR] sendInfoToHTML failed: {e}")


def _log(msg):
    try:
        with open('template-maker-debug.log', 'a', encoding='utf-8') as f:
            f.write(f"{msg}\n")
    except Exception:
        pass


class SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def notify(self, args):
        try:
            _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class HTMLEventHandler(adsk.core.HTMLEventHandler):
    def notify(self, args):
        global _latest_phase_id, _latest_phase_number, _latest_file_name, _latest_sketch_name, _latest_template_number, _last_sel_ids, _latest_cluster_picks
        html_args = adsk.core.HTMLEventArgs.cast(args)
        action = html_args.action
        if action == 'poll':
            html_args.returnData = _latest_payload
        elif action == 'copy':
            try:
                payload = html_args.data or ''
                proc = subprocess.Popen(['clip'], stdin=subprocess.PIPE, shell=False)
                proc.communicate(input=payload.encode('utf-8'))
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_COPY] {e}")
                html_args.returnData = 'error'
        elif action == 'settings':
            try:
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data)
                _latest_phase_id = str(data.get('phaseId', '') or 'p01')
                _latest_phase_number = str(data.get('phaseNumber', '') or '01')
                _latest_file_name = str(data.get('fileName', '') or 'p01_01.py')
                _latest_sketch_name = str(data.get('sketchName', '') or '')
                _latest_template_number = str(data.get('templateNumber', '') or 'T2')
                _last_sel_ids = ''
                _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_SETTINGS] {e}")
                html_args.returnData = 'error'
        elif action == 'rename':
            try:
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data)
                _latest_phase_id = str(data.get('phaseId', '') or 'p01')
                _latest_phase_number = str(data.get('phaseNumber', '') or '01')
                _latest_file_name = str(data.get('fileName', '') or 'p01_01.py')
                _latest_sketch_name = str(data.get('sketchName', '') or '')
                _latest_template_number = str(data.get('templateNumber', '') or 'T2')
                app = adsk.core.Application.get()
                ui = app.userInterface
                sels = ui.activeSelections
                entities = []
                if sels:
                    for i in range(sels.count):
                        try:
                            ent = sels.item(i).entity
                            if ent:
                                entities.append(ent)
                        except Exception:
                            pass
                renamed = rename_selection(entities, phase_prefix=_get_phase_prefix())
                if renamed > 0:
                    _last_sel_ids = ''
                    _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_RENAME] {e}")
                html_args.returnData = 'error'
        elif action == 'clusterPicks':
            # Palette sends a JSON object mapping ``clusterId`` ->
            # ``[index_a, index_b]`` (two integers into the cluster's
            # ``points`` list). We store it on the module global and
            # force a re-push so the next ``build_template_payload``
            # pass resolves the forced picks via
            # ``detect_coincidence_pairs``'s ``forced_picks`` path.
            #
            # Bad shapes (non-dict data, non-list values, non-int
            # indices) are tolerated by ``detect_coincidence_pairs``
            # itself — it falls through to the ambiguous branch and
            # logs, so a corrupt payload just re-surfaces the cluster
            # rather than crashing the pipeline.
            try:
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data) if data else {}
                if not isinstance(data, dict):
                    data = {}
                _latest_cluster_picks = data
                _last_sel_ids = ''
                _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_CLUSTERPICKS] {e}")
                html_args.returnData = 'error'
        else:
            html_args.returnData = ''
