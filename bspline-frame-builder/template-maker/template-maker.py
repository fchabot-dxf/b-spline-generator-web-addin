"""
Template Maker — Selection-driven code preview for frame template creation.

Lifecycle rules (enforced below):
    * Sub-module loading happens inside `run()` via a full sys.modules wipe, so
      every Stop -> Start reloads the latest .py files. No Fusion restart needed
      for code edits.
    * `stop()` releases every event subscription (selection + documentActivated)
      and clears the handlers list in a `finally` block so it always runs.
    * A CustomEvent (`TemplateMaker_DeferredRefresh`) lets any palette fire a
      hot-reload via `app.fireCustomEvent('TemplateMaker_DeferredRefresh', '{}')`.
      The hidden command `TemplateMaker_ReloadCommand` fires the same event so a
      Fusion keyboard shortcut works too.
"""

import adsk.core, adsk.fusion, traceback, os, json, subprocess, sys, shutil
import importlib, importlib.util

# ── Module-level state ────────────────────────────────────────────────────────
_handlers             = []      # Per-run handlers (cleared on stop)
_refresh_handlers     = []      # CustomEvent handlers (alive for full session)
_html_handler         = None
_doc_activated_handler = None
_sel_handler          = None
_refresh_event        = None
_refresh_registered   = False

_last_sel_ids           = ""
_latest_payload         = ""
_latest_phase_id        = 'p01'
# Phase Number — the ``_MM`` position within a sketch in the filename
# scheme ``p{sketch:02}_{phase:02}_{descriptor}.py``. Carried through
# from the palette but only used for downstream tooling that needs the
# full filename stem; entity naming still uses ``phase_id`` alone.
_latest_phase_number    = '01'
# Full phase-file basename the palette has in its File Name field (no
# directory prefix, with ``.py``). The palette's ``substitutePhaseId``
# uses the stem of this value as the emitted ``PhaseID`` / ``Name``;
# the host keeps it around so future emit-to-disk code can land the
# file with the same name the user sees.
_latest_file_name       = 'p01_01.py'
_latest_sketch_name     = ''
_latest_template_number = 'T2'
# Coincidence-cluster round-trip state (Track B). See the matching
# global in ``template_bridge.py`` for the full rationale — mirrored
# here because this module runs its own HTML event handler.
_latest_cluster_picks   = {}

PALETTE_ID        = 'TemplateMaker_Palette'
CMD_ID            = 'TemplateMaker_Command'
PANEL_ID          = 'bsplinePanel'
RELOAD_CMD_ID     = 'TemplateMaker_ReloadCommand'
REFRESH_EVENT_ID  = 'TemplateMaker_DeferredRefresh'
PALETTE_WIDTH     = 1200
PALETTE_HEIGHT    = 700

# Lazy-loaded sub-modules. Kept as module references (never `from X import Y`)
# so reloads propagate automatically.
template_generator = None
template_payload   = None
template_code      = None
expression_coords  = None
rename_selection   = None
deferred_rebuild   = None
# Projection pipeline — mirrors the import block in ``template_bridge.py``.
# Held as a module reference (not ``from X import Y``) so reloads
# propagate the same way the other sub-modules do. Populated inside
# ``_reimport_project_modules`` below.
detect_projections = None

_current_dir = os.path.dirname(os.path.realpath(__file__))
_core_dir = os.path.join(_current_dir, 'core')
if _current_dir not in sys.path:
    sys.path.insert(0, _current_dir)
if _core_dir not in sys.path:
    sys.path.insert(0, _core_dir)

PALETTE_URL    = os.path.join(_current_dir, 'ui', 'template_maker_palette.html').replace('\\', '/')
RESOURCES_PATH = os.path.join(_current_dir, 'ui', 'ressources')

# All project-local modules that should be force-reloaded on run().
# Order irrelevant — we wipe then re-import the top-level ones we use directly.
_PROJECT_MODULES = [
    'entity_helpers',
    'entity_util',
    'expression_coords',
    'phase_parser',
    'role_points',
    'cc_proxy',
    'fb_attributes',
    'ownership_gate',
    'relation_hints',
    'coincidence_clusters',
    'template_code',
    'template_naming',
    'template_payload',
    'template_payload_builder',
    'template_variable_block',
    'rename_selection',
    'detect_projections',
    'template_generator',
    'deferred_rebuild',
]


# ── Utilities ─────────────────────────────────────────────────────────────────
def _cleanup_cache_files(directory):
    """Remove __pycache__ folders and stray .pyc files so reloads pull source."""
    try:
        if not directory or not os.path.isdir(directory):
            return
        for root, dirs, files in os.walk(directory, topdown=False):
            for name in files:
                if name.endswith('.pyc'):
                    try:
                        os.remove(os.path.join(root, name))
                    except Exception:
                        pass
            for name in dirs:
                if name == '__pycache__':
                    try:
                        shutil.rmtree(os.path.join(root, name))
                    except Exception:
                        pass
    except Exception:
        pass


def get_log_path():
    try:
        return os.path.join(_current_dir, 'template-maker-debug.log')
    except Exception:
        return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'template-maker-debug.log')


def _source_root_debug_log_path():
    """Mirror path in the source tree (resolved via ``project_path.json``),
    or ``None`` if we can't or shouldn't mirror.

    Matches the detection-log mirror in ``detection_log.py`` — when the
    add-in runs from the deployed AddIns folder, this lets an outside
    debugger (Claude, a separate VS Code window) follow along on the
    source tree without copy-pasting from ``%APPDATA%`` by hand. If the
    source root resolves to the same folder the add-in is already
    running from, we skip the mirror so log lines aren't duplicated.
    """
    try:
        import json as _json
        cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'project_path.json')
        if not os.path.isfile(cfg_path):
            return None
        with open(cfg_path, 'r', encoding='utf-8') as f:
            cfg = _json.load(f) or {}
        root = cfg.get('template_maker_root')
        if not root:
            return None
        if os.path.normcase(os.path.abspath(root)) == os.path.normcase(os.path.dirname(os.path.abspath(__file__))):
            return None
        return os.path.join(root, 'template-maker-debug.log')
    except Exception:
        return None


_SOURCE_DEBUG_LOG_PATH = _source_root_debug_log_path()


def _log(msg):
    # Timestamp + flush + fsync so a rename / palette / handler error
    # lands on disk before Fusion has a chance to segfault, and so lines
    # from this sink sort chronologically against the detection-log
    # sink next door. Both logs now live in separate files
    # (template-maker-debug.log here, template-maker-detection.log from
    # detection_log.py); previously they were aliases of each other
    # and the interleaved content made it impossible to tell which sink
    # wrote which line.
    #
    # We write to both the local deploy path AND the source-tree mirror
    # (if resolvable from project_path.json) so a debugger watching the
    # source folder sees live entries without copying from %APPDATA%.
    import datetime as _dt
    timestamp = _dt.datetime.now().isoformat(sep=' ', timespec='seconds')
    line = f"[{timestamp}] {msg}\n"
    paths = [get_log_path()]
    if _SOURCE_DEBUG_LOG_PATH:
        paths.append(_SOURCE_DEBUG_LOG_PATH)
    for path in paths:
        try:
            with open(path, 'a', encoding='utf-8') as f:
                f.write(line)
                f.flush()
                try:
                    os.fsync(f.fileno())
                except Exception:
                    pass
        except Exception:
            pass


def _reload_all_project_modules():
    """Full reload: wipe project sub-modules from sys.modules, then re-import
    the top-level ones we reference directly. This is what makes Stop -> Start
    pick up edits without a Fusion restart (importlib.reload alone doesn't
    cascade through dependencies)."""
    global template_generator, template_payload, template_code, expression_coords, rename_selection, deferred_rebuild, detect_projections

    _cleanup_cache_files(_current_dir)
    _cleanup_cache_files(_core_dir)

    # Wipe
    for name in _PROJECT_MODULES:
        try:
            if name in sys.modules:
                del sys.modules[name]
        except Exception:
            pass
        # Wipe sub-packages too (defensive)
        try:
            for key in list(sys.modules.keys()):
                if key.startswith(name + '.'):
                    del sys.modules[key]
        except Exception:
            pass

    # Re-import what this file uses directly
    template_generator = importlib.import_module('template_generator')
    template_payload   = importlib.import_module('template_payload')
    template_code      = importlib.import_module('template_code')
    expression_coords  = importlib.import_module('expression_coords')
    rename_selection   = importlib.import_module('rename_selection')
    deferred_rebuild   = importlib.import_module('deferred_rebuild')
    # Projection pipeline. Wired into ``_push_selection_to_palette`` below
    # so the deferred-rebuild tick classifies + formats projection picks
    # alongside the normal seed-path payload. Without this, live-link
    # projections (``isReference=True`` sketch proxies) fall through as
    # "N untagged entities skipped" even though the gate already
    # whitelists them and ``detect_projections`` knows how to emit a
    # ``Projections`` block for them.
    detect_projections = importlib.import_module('detect_projections')

    _log('[reload] project sub-modules reloaded')


# ── Event handlers ────────────────────────────────────────────────────────────
#
# Selection-change and document-activation handlers DO NOT rebuild the
# payload synchronously. Fusion fires these events while a sketch operation
# (e.g. creating a new constraint) is still mid-recompute; touching entity
# proxies during that window can segfault the Fusion C++ layer.
#
# Instead, both handlers just ask ``deferred_rebuild`` to schedule a
# rebuild on the next event-pump tick, at which point Fusion has finished
# settling and the walk is safe. See ``deferred_rebuild.py`` for the full
# explanation and the guards that back this up on the relation-hint path
# (``relation_hints._format_target_reference``, ``_iter_connected_entities``).
class _SelectionChangedHandler(adsk.core.ActiveSelectionEventHandler):
    def notify(self, args):
        try:
            if deferred_rebuild is not None:
                deferred_rebuild.schedule()
            else:
                # Pre-reload fallback — shouldn't normally hit since run()
                # imports deferred_rebuild before wiring event handlers,
                # but kept for belt-and-braces if an exception interrupts
                # initialisation part-way through.
                _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class _DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    def notify(self, args):
        try:
            if deferred_rebuild is not None:
                deferred_rebuild.schedule()
            else:
                _push_selection_to_palette()
        except Exception:
            _log(traceback.format_exc())


class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    """Runs stop() + run() on the Fusion event pump so code edits take effect
    without the user having to click Stop/Start in the Add-Ins dialog."""
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            stop(None)
            run(None)
        except Exception:
            _log('[DEFERRED_REFRESH] ' + traceback.format_exc())


class _ReloadCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    """Hidden command — fires the refresh CustomEvent. Bind a keyboard shortcut
    to `TemplateMaker_ReloadCommand` in Fusion to hot-reload from anywhere."""
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            adsk.core.Application.get().fireCustomEvent(REFRESH_EVENT_ID, '{}')
        except Exception:
            _log('[RELOAD_CMD] ' + traceback.format_exc())


def _register_refresh_event():
    """Register the refresh CustomEvent exactly once per Fusion session."""
    global _refresh_event, _refresh_registered
    if _refresh_registered:
        return
    try:
        app = adsk.core.Application.get()
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
        _refresh_event = app.registerCustomEvent(REFRESH_EVENT_ID)
        h = _DeferredRefreshHandler()
        _refresh_event.add(h)
        _refresh_handlers.append(h)
        _refresh_registered = True
        _log('[register] refresh CustomEvent registered')
    except Exception:
        _log('[REGISTER_EVENT] ' + traceback.format_exc())


# ── Phase helpers ─────────────────────────────────────────────────────────────
def _get_phase_prefix():
    # Delegate to ``rename_selection.build_phase_prefix`` — the single
    # source of truth for the "{sketch_name}_{phase_id}" format shared
    # with ``template_bridge._get_phase_prefix``. Going through
    # ``rename_selection`` (the module variable reassigned in ``run()``)
    # means a hot-reload picks up any future format change without
    # having to re-edit this helper.
    #
    # The ``rename_selection is None`` guard covers the narrow window
    # before ``run()`` fires — palette/rename callbacks only run after
    # it, so the guard is paranoia for import-time calls (e.g. a future
    # refactor that touches the prefix from module scope).
    if rename_selection is None:
        return None
    return rename_selection.build_phase_prefix(
        phase_id=_latest_phase_id,
        sketch_name=_latest_sketch_name,
    )


def _get_phase_name():
    # Same shape as the prefix; ``'Generated Phase'`` fallback is
    # specific to this caller — ``build_phase_prefix`` returns None
    # when both inputs are empty, which is the wrong output for a
    # phase-block header string.
    return _get_phase_prefix() or 'Generated Phase'


def _push_selection_to_palette():
    global _last_sel_ids, _latest_payload
    app = adsk.core.Application.get()
    ui = app.userInterface
    palette = ui.palettes.itemById(PALETTE_ID)
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

    if current_ids == _last_sel_ids and _last_sel_ids != '':
        return
    _last_sel_ids = current_ids

    payload = template_generator.build_template_payload(
        entities,
        phase_prefix=_get_phase_prefix(),
        phase_id=_latest_phase_id,
        phase_name=_get_phase_name(),
        template_number=_latest_template_number,
        cluster_picks=_latest_cluster_picks,
    )

    # Projection inference — mirror of the block in
    # ``template_bridge.py::_push_selection_to_palette``. Classifies the
    # current selection as 'empty' | 'seeds' | 'projections' | 'mixed'
    # and, for the projections case, emits a ready-to-paste
    # ``Projections`` block the palette renders in place of the usual
    # seed-block code.
    #
    # This local ``_push_selection_to_palette`` is the one registered
    # with ``deferred_rebuild`` (see ``register`` call below), so the
    # projection branch MUST live here — the ``template_bridge`` copy
    # is dead code on this entry path.
    try:
        from detection_log import _log_detection as _log_proj
        kind = detect_projections.classify_selection(entities)
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
            result = detect_projections.detect_projections(entities)
            if result.get('ok'):
                payload['projectionsOk'] = True
                payload['projections'] = result['projections']
                payload['projectionsNote'] = result.get('note')
                payload['projectionsBlockCode'] = detect_projections.format_projection_block(
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
    except Exception as e:
        _log(f"[ERROR_PROJ_INFER] {e}\n{traceback.format_exc()}")

    _latest_payload = json.dumps(payload)
    try:
        palette.sendInfoToHTML('update', _latest_payload)
    except Exception as e:
        _log(f"[ERROR] sendInfoToHTML failed: {e}")


# ── HTML bridge ───────────────────────────────────────────────────────────────
class _HTMLEventHandler(adsk.core.HTMLEventHandler):
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
                _log('[rename] entered')
                data = html_args.data or ''
                if isinstance(data, str):
                    data = json.loads(data)
                _latest_phase_id = str(data.get('phaseId', '') or 'p01')
                _latest_phase_number = str(data.get('phaseNumber', '') or '01')
                _latest_file_name = str(data.get('fileName', '') or 'p01_01.py')
                _latest_sketch_name = str(data.get('sketchName', '') or '')
                _latest_template_number = str(data.get('templateNumber', '') or 'T2')
                _log(f"[rename] phase={_latest_phase_id} pnum={_latest_phase_number} file={_latest_file_name} sketch={_latest_sketch_name} tpl={_latest_template_number}")
                app = adsk.core.Application.get()
                ui = app.userInterface
                sels = ui.activeSelections
                _log(f"[rename] activeSelections count={sels.count if sels else 0}")
                entities = []
                if sels:
                    for i in range(sels.count):
                        try:
                            ent = sels.item(i).entity
                            if ent:
                                entities.append(ent)
                                try:
                                    _log(f"[rename] sel[{i}] type={type(ent).__name__}")
                                except Exception:
                                    _log(f"[rename] sel[{i}] type=<unreadable>")
                        except Exception as _se:
                            _log(f"[rename] sel[{i}] fetch FAILED: {_se}")
                _log(f"[rename] entities collected={len(entities)} -> rename_selection()")
                renamed = rename_selection.rename_selection(entities, phase_prefix=_get_phase_prefix())
                _log(f"[rename] rename_selection() returned renamed={renamed}")
                if renamed > 0:
                    # Attribute writes + ``ent.name`` assignments triggered
                    # by rename_selection put Fusion into a sketch-recompute
                    # mid-stack-frame. Walking entity proxies synchronously
                    # from here would hit the same reentrancy segfault the
                    # selection-change handler dodges. Route the refresh
                    # through deferred_rebuild so it runs on the next
                    # event-pump tick, once Fusion has settled.
                    _last_sel_ids = ''
                    if deferred_rebuild is not None:
                        deferred_rebuild.schedule()
                    else:
                        _push_selection_to_palette()
                html_args.returnData = 'ok'
            except Exception as e:
                # Full traceback, not just ``str(e)`` — dim-rename errors
                # on freshly-created SketchRadialDimensions only show the
                # RuntimeError message without the stack (e.g. Fusion's
                # ``"3 : object does not support attributes"`` vs a
                # ``parentSketch`` probe raising on a settling proxy), so
                # the debug log can't tell the crash sites apart.
                _log(f"[ERROR_RENAME] {e}\n{traceback.format_exc()}")
                html_args.returnData = 'error'
        elif action == 'clusterPicks':
            # Palette round-trip for size-3+ coincidence clusters. See
            # the matching branch in ``template_bridge.HTMLEventHandler``
            # for the full rationale. Data shape: dict mapping
            # ``clusterId`` -> ``[index_a, index_b]`` (two integers into
            # the cluster's ``points`` list, in the same order the
            # palette received it on the previous push).
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
        elif action == 'reload':
            # Palette-driven hot-reload. Fire the deferred CustomEvent instead
            # of calling stop/run directly — you can't tear down a palette
            # while its HTML handler is still on the stack.
            try:
                adsk.core.Application.get().fireCustomEvent(REFRESH_EVENT_ID, '{}')
                html_args.returnData = 'ok'
            except Exception as e:
                _log(f"[ERROR_RELOAD] {e}")
                html_args.returnData = 'error'
        else:
            html_args.returnData = ''


# ── Palette command ───────────────────────────────────────────────────────────
class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        global _html_handler
        app = adsk.core.Application.get()
        ui = app.userInterface
        palette = ui.palettes.itemById(PALETTE_ID)
        newly_created = False
        if not palette:
            palette = ui.palettes.add(
                PALETTE_ID, 'Template Maker', PALETTE_URL,
                True, True, True, PALETTE_WIDTH, PALETTE_HEIGHT)
            newly_created = True

        # Dock the palette to the right edge of Fusion's main window. Without
        # this, Fusion would restore the palette wherever it floated last,
        # which on a multi-monitor setup tends to land it on the secondary
        # screen far away from the Fusion window. Docking forces it to live
        # inside the Fusion window so it always appears on the same screen.
        # We only set it on first creation so the user can still undock and
        # reposition it later — the palette ID survives Stop/Start, so an
        # already-existing palette keeps the user's chosen state.
        if newly_created:
            try:
                palette.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
                palette.setMinimumSize(PALETTE_WIDTH, 480)
            except Exception as e:
                _log(f"[WARN] Failed to dock Template Maker palette: {e}")

        if not _html_handler:
            _html_handler = _HTMLEventHandler()
            try:
                palette.incomingFromHTML.add(_html_handler)
                _handlers.append(_html_handler)
            except Exception as e:
                _log(f"[ERROR] Failed to add HTML event handler: {e}")

        palette.isVisible = True
        _push_selection_to_palette()


# ── run() ─────────────────────────────────────────────────────────────────────
def run(context):
    try:
        _log("[run] started")

        # 1. Fresh sub-modules every cycle — this is what makes Stop/Start
        #    pick up code edits without a Fusion restart.
        _reload_all_project_modules()

        app = adsk.core.Application.get()
        ui = app.userInterface

        # 2. Refresh CustomEvent (idempotent — survives Stop/Start).
        _register_refresh_event()

        # 2b. Deferred-rebuild CustomEvent. This is what routes selection /
        #     documentActivated events onto the next event-pump tick instead
        #     of rebuilding the payload synchronously inside the Fusion
        #     callback (which crashes when a constraint is mid-settle). See
        #     deferred_rebuild.py for the full rationale.
        try:
            deferred_rebuild.register(_push_selection_to_palette)
        except Exception:
            _log('[deferred_rebuild.register] ' + traceback.format_exc())

        # 3. Purge any stale command definitions for our IDs.
        for cid in (CMD_ID, RELOAD_CMD_ID):
            try:
                cd = ui.commandDefinitions.itemById(cid)
                if cd:
                    cd.deleteMe()
            except Exception:
                pass

        # 4. Main palette command.
        cmd_def = ui.commandDefinitions.addButtonDefinition(
            CMD_ID, 'Template Maker',
            'Launch the selection-driven template code generator.',
            RESOURCES_PATH)
        handler = CommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        _handlers.append(handler)

        # 5. Reload command — visible toolbar button. Right-click it in Fusion
        #    to bind a keyboard shortcut.
        reload_def = None
        try:
            reload_def = ui.commandDefinitions.addButtonDefinition(
                RELOAD_CMD_ID, 'Reload Template Maker',
                'Hot-reload template-maker code without restarting Fusion')
            rh = _ReloadCommandCreatedHandler()
            reload_def.commandCreated.add(rh)
            _handlers.append(rh)
        except Exception:
            _log('[reload cmd] ' + traceback.format_exc())

        # 6. Add both commands to toolbar panels.
        for target_id in ('SketchTab', 'SolidTab', 'MillingTab'):
            try:
                tab = ui.allToolbarTabs.itemById(target_id)
                if not tab:
                    for t in ui.allToolbarTabs:
                        if target_id in getattr(t, 'id', '') or target_id in getattr(t, 'name', ''):
                            tab = t
                            break
                if not tab:
                    _log(f'[Template Maker] could not find tab {target_id}. Available tabs:')
                    for t in ui.allToolbarTabs:
                        _log(f'  {getattr(t, "id", None)!r} / {getattr(t, "name", None)!r}')
                    continue

                _log(f'[Template Maker] using tab {target_id} (id={tab.id!r}, name={tab.name!r})')
                unique_panel_id = f"{PANEL_ID}_{tab.id}"
                panel = tab.toolbarPanels.itemById(unique_panel_id)
                if not panel:
                    panel = tab.toolbarPanels.add(unique_panel_id, 'B-Spline Builder', 'SelectPanel', False)
                if not panel.controls.itemById(CMD_ID):
                    ctrl = panel.controls.addCommand(cmd_def)
                    ctrl.isPromoted = True
                    ctrl.isPromotedByDefault = True
                    _log(f'[Template Maker] added {CMD_ID} to {unique_panel_id} on {tab.id!r} as promoted')
                # The reload button is completely removed from the UI panels.
            except Exception:
                _log('[Template Maker] toolbar registration failed\n' + traceback.format_exc())

        # 7. Selection + documentActivated subscriptions.
        global _sel_handler, _doc_activated_handler

        # Drop any previous instances first (defensive).
        try:
            if _sel_handler:
                ui.activeSelectionChanged.remove(_sel_handler)
        except Exception:
            pass
        _sel_handler = _SelectionChangedHandler()
        ui.activeSelectionChanged.add(_sel_handler)
        _handlers.append(_sel_handler)

        try:
            if _doc_activated_handler:
                app.documentActivated.remove(_doc_activated_handler)
        except Exception:
            pass
        _doc_activated_handler = _DocumentActivatedHandler()
        app.documentActivated.add(_doc_activated_handler)
        _handlers.append(_doc_activated_handler)

        _log('[run] complete')
    except Exception:
        _log('[run] exception\n' + traceback.format_exc())


# ── stop() ────────────────────────────────────────────────────────────────────
def stop(context):
    """Fully release add-in resources. The refresh CustomEvent is intentionally
    NOT unregistered — it stays alive for the Fusion session so palettes / the
    keyboard shortcut can still trigger a hot-reload."""
    global _html_handler, _sel_handler, _doc_activated_handler

    try:
        app = adsk.core.Application.get()
        if not app:
            _handlers.clear()
            _html_handler = None
            _sel_handler = None
            _doc_activated_handler = None
            return
        ui = app.userInterface

        # 1. Close + delete the palette so the HTML bridge is fully re-created
        #    on next start.
        try:
            palette = ui.palettes.itemById(PALETTE_ID)
            if palette:
                palette.deleteMe()
        except Exception:
            _log('[stop] palette cleanup\n' + traceback.format_exc())

        # 2. Remove toolbar controls + panels we own across all relevant tabs.
        for tab in ui.allToolbarTabs:
            try:
                if tab is None:
                    continue
                panels_to_check = []
                for p in tab.toolbarPanels:
                    if p.id.startswith(PANEL_ID):
                        panels_to_check.append(p)
                for panel in panels_to_check:
                    ctrl = panel.controls.itemById(CMD_ID)
                    if ctrl:
                        try:
                            ctrl.deleteMe()
                        except Exception:
                            pass
                    if panel.controls.count == 0:
                        try:
                            panel.deleteMe()
                        except Exception:
                            pass
            except Exception:
                pass

        # 3. Remove command definitions (main + hidden reload).
        for cid in (CMD_ID, RELOAD_CMD_ID):
            try:
                cd = ui.commandDefinitions.itemById(cid)
                if cd:
                    cd.deleteMe()
            except Exception:
                pass

        # 4. Unsubscribe app-level events — these survive module reload
        #    otherwise and fire ghost notifications.
        try:
            if _sel_handler:
                try:
                    ui.activeSelectionChanged.remove(_sel_handler)
                except Exception:
                    pass
        except Exception:
            pass

        try:
            if _doc_activated_handler:
                try:
                    app.documentActivated.remove(_doc_activated_handler)
                except Exception:
                    pass
        except Exception:
            pass

        # 4b. Tear down the deferred-rebuild CustomEvent. Done separately
        #     from the refresh event (which stays alive for the session so
        #     hot-reload keeps working); deferred_rebuild is only valid
        #     while the addin is running and needs its callback pointer
        #     cleared on stop so a ghost fire doesn't call into torn-down
        #     code.
        try:
            if deferred_rebuild is not None:
                deferred_rebuild.unregister()
        except Exception:
            _log('[deferred_rebuild.unregister] ' + traceback.format_exc())

        # 5. Wipe runtime cache files so the next reload reads source.
        _cleanup_cache_files(_current_dir)

    except Exception:
        _log('[stop] outer\n' + traceback.format_exc())
    finally:
        # Always clear — otherwise handlers accumulate across Start/Stop cycles
        # and fire multiple times per selection event.
        _handlers.clear()
        _html_handler = None
        _sel_handler = None
        _doc_activated_handler = None
