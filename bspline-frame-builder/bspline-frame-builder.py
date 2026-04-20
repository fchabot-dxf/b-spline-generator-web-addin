# Entry point for the unified Fusion 360 add-in: bspline-frame-builder
#
# Wiring map:
#   bsplineCommand          -> b-spline-gen   CommandCreatedHandler (SVG / B-Spline palette)
#   hybridBuilderCommand    -> frame-builder  ui/hybrid_builder_ui.py (Unified Palette)
#   bsplineFbReloadCommand  -> deferred refresh (stop + bootstrap + run) via CustomEvent
#
# Lifecycle rules (enforced below):
#   * Sub-module loading happens inside `run()` so every Stop -> Start reloads the
#     latest .py files. No Fusion restart needed for code edits.
#   * `stop()` delegates to sub-modules so their panels, palettes, and app-level
#     event subscriptions (e.g. documentActivated) are fully released.
#   * A CustomEvent (`BsFb_DeferredRefresh`) lets any palette fire a hot-reload by
#     calling `app.fireCustomEvent('BsFb_DeferredRefresh', '{}')`. The hidden
#     command `bsplineFbReloadCommand` fires the same event so a keyboard shortcut
#     works too.

import adsk.core, adsk.fusion, adsk.cam, traceback
import os, sys, importlib.util

# Keep the add-in folder clean of __pycache__ / .pyc so reloads always see fresh source.
sys.dont_write_bytecode = True

# ── Module-level state ────────────────────────────────────────────────────────
handlers          = []       # Command / event handlers from the current run cycle
_refresh_handlers = []       # CustomEvent handlers (kept alive for whole session)
_bs               = None     # b-spline-gen module (reloaded every run)
_fbh              = None     # hybrid_builder_ui module (reloaded every run)
_engine           = None     # frame_engine module (reloaded every run)
_tm               = None     # template-maker module (reloaded every run)
_fi               = None     # fusion-inspector module (reloaded every run)
_fe               = None     # fusion-exporter module (reloaded every run)
_diag_logger      = None     # DebugLogger (re-created every run)
_refresh_event    = None     # Registered once per Fusion session
_refresh_registered = False

REFRESH_EVENT_ID   = 'BsFb_DeferredRefresh'
RELOAD_COMMAND_ID  = 'bsplineFbReloadCommand'
PANEL_ID           = 'bsplinePanel'

try:
    _addin_root = os.path.dirname(__file__)
except Exception:
    _addin_root = '.'


# ── Small fallback logger so early failures still leave a trace ───────────────
def _fallback_log(msg):
    try:
        path = os.path.join(_addin_root, 'frame-builder', 'frame-builder-debug.log')
        with open(path, 'a', encoding='utf-8') as f:
            f.write(msg + '\n')
    except Exception:
        pass


def _log(msg):
    if _diag_logger is not None:
        try:
            _diag_logger.log(msg)
            return
        except Exception:
            pass
    _fallback_log('[INFO] ' + msg)


def _log_error(msg):
    if _diag_logger is not None:
        try:
            _diag_logger.log_error(msg)
            return
        except Exception:
            pass
    _fallback_log('[ERROR] ' + msg)


# ── Sub-module loading helpers ────────────────────────────────────────────────
def _force_wipe(names):
    """Remove the given modules (and any sub-packages) from sys.modules so the
    next import re-executes the file from disk."""
    for name in names:
        try:
            if name in sys.modules:
                del sys.modules[name]
        except Exception:
            pass
        try:
            for key in list(sys.modules.keys()):
                if key.startswith(name + '.'):
                    del sys.modules[key]
        except Exception:
            pass


def _load_submodule(safe_name, subdir, filename):
    """Load a .py file from a hyphenated sub-directory under a safe alias."""
    subdir_path = os.path.join(_addin_root, subdir)
    if subdir_path not in sys.path:
        sys.path.insert(0, subdir_path)

    if safe_name in sys.modules:
        del sys.modules[safe_name]

    filepath = os.path.join(subdir_path, filename)
    spec    = importlib.util.spec_from_file_location(safe_name, filepath)
    module  = importlib.util.module_from_spec(spec)
    sys.modules[safe_name] = module
    spec.loader.exec_module(module)
    return module


def _normalize_module_path(path):
    try:
        return os.path.normcase(os.path.normpath(path))
    except Exception:
        return path


def _find_related_addin_modules():
    current_path = _normalize_module_path(__file__)
    suffixes = [
        os.path.normcase(os.path.normpath(os.path.join('b-spline-gen', 'b-spline-gen.py'))),
        os.path.normcase(os.path.normpath(os.path.join('frame-builder', 'ui', 'hybrid_builder_ui.py'))),
        os.path.normcase(os.path.normpath(os.path.join('frame-inspector', 'fusion-inspector.py'))),
        os.path.normcase(os.path.normpath(os.path.join('fusion-exporter', 'fusion-exporter.py'))),
        os.path.normcase(os.path.normpath(os.path.join('template-maker', 'template-maker.py'))),
    ]

    for mod in list(sys.modules.values()):
        mod_file = getattr(mod, '__file__', None)
        if not mod_file:
            continue
        mod_path = _normalize_module_path(mod_file)
        if mod_path == current_path:
            continue
        mod_path = os.path.splitext(mod_path)[0]
        for suffix in suffixes:
            if mod_path.endswith(os.path.splitext(suffix)[0]):
                yield mod
                break


def _invoke_addin_action(modules, action_name):
    for mod in modules:
        action = getattr(mod, action_name, None)
        if not callable(action):
            continue
        try:
            action(None)
        except Exception:
            _log_error(
                f'{action_name} failed for related addin module '
                f'{getattr(mod, "__file__", repr(mod))}\n'
                + traceback.format_exc()
            )


def _stop_related_addins(modules):
    _invoke_addin_action(modules, 'stop')


def _run_related_addins(modules):
    _invoke_addin_action(modules, 'run')


# ── Bootstrap (runs on every Start so code edits take effect) ─────────────────
def _bootstrap():
    """Load logger, frame engine, and UI sub-modules. Safe to call repeatedly."""
    global _bs, _fbh, _engine, _tm, _fi, _fe, _diag_logger

    # --- Logger ---
    _utils_path = os.path.join(_addin_root, 'frame-builder', 'fb_utils')
    if _utils_path not in sys.path:
        sys.path.insert(0, _utils_path)
    if 'fb_logger' in sys.modules:
        del sys.modules['fb_logger']
    from fb_logger import DebugLogger
    _diag_logger = DebugLogger(os.path.join(_addin_root, 'frame-builder'))

    # --- Clear cached sub-module state ---
    _force_wipe([
        'bspline_ui',
        'hybrid_builder_ui',
        'frame_engine_core',
        'fb_engine.frame_engine',
        'fb_engine',
    ])

    # --- Engine ---
    _fb_root = os.path.join(_addin_root, 'frame-builder')
    _sk_root = os.path.join(_fb_root, 'sketches')

    _search_paths = [_fb_root]
    for i in range(1, 5):
        _search_paths.append(os.path.join(_sk_root, f'template_{i}'))
    for d in _search_paths:
        if d not in sys.path:
            sys.path.insert(0, d)

    _engine_path = os.path.join(_fb_root, 'fb_engine', 'frame_engine.py')
    eng_spec = importlib.util.spec_from_file_location('frame_engine_core', _engine_path)
    _engine = importlib.util.module_from_spec(eng_spec)
    sys.modules['frame_engine_core'] = _engine
    eng_spec.loader.exec_module(_engine)

    # --- UI sub-modules ---
    _bs  = _load_submodule('bspline_ui',        'b-spline-gen',      'b-spline-gen.py')
    _fbh = _load_submodule('hybrid_builder_ui', 'frame-builder/ui',  'hybrid_builder_ui.py')

    # Inject the fresh engine object
    _fbh.frame_engine = _engine

    # --- Consolidated former-standalone add-ins ---
    # These three modules used to install as separate Fusion add-ins. They now
    # live inside this add-in so there's a single entry in Fusion's Add-Ins
    # dialog. Each sub-module registers its own button in the shared
    # 'bsplinePanel' toolbar panel on its own `run()` call (see `run()` below).
    #
    # IMPORTANT: template-maker and frame-inspector each ship their OWN copy of
    # shared-name project modules (expression_coords.py, entity_helpers.py,
    # etc.). If a previous _bootstrap() already cached one version in
    # sys.modules, the sub-module we're about to load would bind to the WRONG
    # version on re-import. Wipe those names before each load so each sub's
    # top-level imports resolve fresh from its own folder (sys.path[0] gets
    # set by the sub-module's own module-level `sys.path.insert(0, ...)`).
    _shared_project_names = [
        'expression_coords', 'entity_helpers', 'entity_util', 'payload_builder',
        'phase_parser', 'role_points', 'cc_proxy', 'fb_attributes',
        'ownership_gate', 'relation_hints', 'coincidence_clusters',
        'template_generator', 'template_code', 'template_payload',
        'detect_projections', 'rename_selection', 'deferred_rebuild',
        'exporter',
    ]

    _force_wipe(_shared_project_names)
    try:
        _fe = _load_submodule('fusion_exporter_mod',  'fusion-exporter', 'fusion-exporter.py')
    except Exception:
        _log_error('fusion-exporter submodule load failed\n' + traceback.format_exc())
        _fe = None

    _force_wipe(_shared_project_names)
    try:
        _fi = _load_submodule('fusion_inspector_mod', 'frame-inspector', 'fusion-inspector.py')
    except Exception:
        _log_error('fusion-inspector submodule load failed\n' + traceback.format_exc())
        _fi = None

    _force_wipe(_shared_project_names)
    try:
        _tm = _load_submodule('template_maker_mod',   'template-maker',  'template-maker.py')
    except Exception:
        _log_error('template-maker submodule load failed\n' + traceback.format_exc())
        _tm = None

    _diag_logger.log('BOOTSTRAP: sub-modules loaded (fresh from disk)')


# ── Submodule teardown (called from stop) ─────────────────────────────────────
def _teardown_submodules():
    """Release resources held by loaded sub-modules before we drop our refs."""
    global _bs, _fbh, _engine, _tm, _fi, _fe

    app = None
    try:
        app = adsk.core.Application.get()
    except Exception:
        pass

    # 1. Hybrid Builder — remove its app.documentActivated subscription and clear
    #    its own handlers list. Those survive module reloads otherwise.
    if _fbh is not None:
        try:
            doc_handler = getattr(_fbh, '_doc_activated_handler', None)
            if doc_handler is not None and app is not None:
                try:
                    app.documentActivated.remove(doc_handler)
                except Exception:
                    pass
                try:
                    setattr(_fbh, '_doc_activated_handler', None)
                except Exception:
                    pass
        except Exception:
            _log_error('teardown: hybrid doc handler\n' + traceback.format_exc())

        try:
            if hasattr(_fbh, 'handlers'):
                _fbh.handlers.clear()
        except Exception:
            pass

    # 2. B-Spline UI — delegate to its own stop() which closes its palette and
    #    removes its legacy panel / command-definition if anything still exists.
    if _bs is not None and hasattr(_bs, 'stop'):
        try:
            _bs.stop(None)
        except Exception:
            _log_error('teardown: _bs.stop failed\n' + traceback.format_exc())

    # 3. Consolidated former-standalone add-ins — each cleans up its own
    #    command defs, palettes, event subscriptions, and panel buttons.
    #    Stop in REVERSE of the run order so late-bound resources (palettes,
    #    selection handlers) release before earlier commands.
    for _sub_label, _sub_mod in (('template-maker',   _tm),
                                 ('fusion-inspector', _fi),
                                 ('fusion-exporter',  _fe)):
        if _sub_mod is None:
            continue
        _sub_stop = getattr(_sub_mod, 'stop', None)
        if not callable(_sub_stop):
            continue
        try:
            _sub_stop(None)
        except Exception:
            _log_error(f'teardown: {_sub_label} stop() failed\n' + traceback.format_exc())

    _bs = None
    _fbh = None
    _engine = None
    _tm = None
    _fi = None
    _fe = None


# ── Deferred refresh via CustomEvent ──────────────────────────────────────────
class _DeferredRefreshHandler(adsk.core.CustomEventHandler):
    def __init__(self):
        super().__init__()

    def notify(self, args):
        # Since template-maker, fusion-inspector, and fusion-exporter are now
        # consolidated into this add-in's own run()/stop() lifecycle (see
        # _bootstrap() and _teardown_submodules()), the former
        # `_find_related_addin_modules` scan is redundant — a plain stop/run
        # cycle already tears down and rebuilds every sub-module from disk.
        try:
            stop(None)
            run(None)
        except Exception:
            _log_error('deferred refresh failed\n' + traceback.format_exc())


def _register_refresh_event():
    """Register the refresh CustomEvent exactly once per Fusion session."""
    global _refresh_event, _refresh_registered
    if _refresh_registered:
        return
    try:
        app = adsk.core.Application.get()
        # If a prior session left it behind, unregister first (best-effort).
        try:
            app.unregisterCustomEvent(REFRESH_EVENT_ID)
        except Exception:
            pass
        _refresh_event = app.registerCustomEvent(REFRESH_EVENT_ID)
        h = _DeferredRefreshHandler()
        _refresh_event.add(h)
        _refresh_handlers.append(h)
        _refresh_registered = True
    except Exception:
        _log_error('_register_refresh_event failed\n' + traceback.format_exc())


class _ReloadCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    """Hidden command that fires the refresh event. Bind a keyboard shortcut to
    `bsplineFbReloadCommand` in Fusion to hot-reload without the Add-Ins dialog."""
    def __init__(self):
        super().__init__()

    def notify(self, args):
        try:
            adsk.core.Application.get().fireCustomEvent(REFRESH_EVENT_ID, '{}')
        except Exception:
            _log_error('fireCustomEvent failed\n' + traceback.format_exc())


# ── Resource paths (evaluated lazily inside run) ──────────────────────────────
def _res_paths():
    fb_res_so = os.path.join(_addin_root, 'frame-builder', 'resources', 'SolidCommand')
    bs_res    = os.path.join(_addin_root, 'b-spline-gen', 'resources')
    return fb_res_so, bs_res


# ── run() ─────────────────────────────────────────────────────────────────────
def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface

        # 1. Ensure refresh event is live for this Fusion session (idempotent).
        _register_refresh_event()

        # 2. Bootstrap sub-modules fresh — this is the key to hot-reload.
        try:
            _bootstrap()
        except Exception:
            tb = traceback.format_exc()
            _log_error('BOOTSTRAP FAILED\n' + tb)
            if ui:
                ui.messageBox('Frame Builder bootstrap failed:\n' + tb)
            return

        if not _bs or not _fbh:
            _log_error(f'Sub-modules did not load (BS: {bool(_bs)}, FBH: {bool(_fbh)})')
            return

        # 3. Kill any leftover palettes so the new bridge/HTML is picked up.
        for pid in (getattr(_fbh, 'PALETTE_ID', None),
                    getattr(_bs,  'PALETTE_ID', None)):
            if not pid:
                continue
            try:
                pal = ui.palettes.itemById(pid)
                if pal:
                    pal.deleteMe()
            except Exception:
                pass

        cmd_defs = ui.commandDefinitions
        fb_res_so, bs_res = _res_paths()

        COMMANDS = [
            {
                'id':              'bsplineCommand',
                'name':            'SVG Editor',
                'tooltip':         'Procedural B-Spline Surface & Solid Editor',
                'res_path':        bs_res,
                'handler_factory': lambda: _bs.CommandCreatedHandler(),
            },
            {
                'id':              'hybridBuilderCommand',
                'name':            'Frame Builder',
                'tooltip':         'Unified Hybrid Frame Builder (Sketch + Solid)',
                'res_path':        fb_res_so,
                'handler_factory': lambda: _fbh.CommandCreatedHandler(),
            },
        ]

        # 4. Purge any stale command definitions for our IDs (including the reload cmd).
        for cid in ('bsplineCommand', 'hybridBuilderCommand', RELOAD_COMMAND_ID):
            try:
                existing = cmd_defs.itemById(cid)
                if existing:
                    existing.deleteMe()
            except Exception:
                pass

        # 5. Register user-facing commands.
        for cmd in COMMANDS:
            new_def = cmd_defs.addButtonDefinition(
                cmd['id'], cmd['name'], cmd['tooltip'], cmd['res_path'])
            on_created = cmd['handler_factory']()
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)

        # 6. Register the hidden reload command (bindable to a keyboard shortcut).
        try:
            reload_def = cmd_defs.addButtonDefinition(
                RELOAD_COMMAND_ID,
                'Reload bspline-frame-builder',
                'Hot-reload add-in code without restarting Fusion')
            reload_handler = _ReloadCommandCreatedHandler()
            reload_def.commandCreated.add(reload_handler)
            handlers.append(reload_handler)
        except Exception:
            _log_error('reload cmd registration failed\n' + traceback.format_exc())

        # 7. Add buttons to the unified toolbar panel on both Solid and Sketch environments.
        # Registration must target the specific workspace's tab collection to ensure visibility.
        ENVIRONMENT_TARGETS = (
            ('FusionSolidEnvironment',  'SolidTab'),
            ('FusionSketchEnvironment', 'SketchTab'),
        )

        for ws_id, tab_id in ENVIRONMENT_TARGETS:
            try:
                # 1. Attempt to find the tab within the specific workspace.
                ws = ui.workspaces.itemById(ws_id)
                tab = None
                if ws:
                    tab = ws.toolbarTabs.itemById(tab_id)
                
                # 2. Fallback: Search allToolbarTabs directly if workspace lookup was unsuccessful.
                if not tab:
                    tab = ui.allToolbarTabs.itemById(tab_id)
                
                # 3. Last stand: Fuzzy search by name/partial ID.
                if not tab:
                    for t in ui.allToolbarTabs:
                        if tab_id in getattr(t, 'id', '') or tab_id in getattr(t, 'name', ''):
                            tab = t
                            break

                if not tab:
                    _log(f'ERROR: Target tab {tab_id!r} not found (WS context: {ws_id!r}).')
                    # Diagnostics: list what IS available to help user debug.
                    _log('Available Workspaces:')
                    for w in ui.workspaces:
                        _log(f'  - {getattr(w, "id", "???")!r} ({getattr(w, "name", "???")!r})')
                    _log('Available Toolbar Tabs:')
                    for t in ui.allToolbarTabs:
                        _log(f'  - {getattr(t, "id", "???")!r} ({getattr(t, "name", "???")!r})')
                    continue

                unique_panel_id = f"{PANEL_ID}_{tab.id}"
                _log(f'Registering in {ws_id!r} context -> {tab_id!r} (Found ID={tab.id!r})')
                panel = tab.toolbarPanels.itemById(unique_panel_id)
                if not panel:
                    panel = tab.toolbarPanels.add(unique_panel_id, 'B-Spline Builder', 'SelectPanel', False)
                    _log(f'Created panel {unique_panel_id} in tab {tab.id!r}')
                else:
                    _log(f'Found existing panel {unique_panel_id} in tab {tab.id!r}')

                for cmd in COMMANDS:
                    cid = cmd['id']
                    ctrl = panel.controls.itemById(cid)
                    if not ctrl:
                        ctrl = panel.controls.addCommand(cmd_defs.itemById(cid))
                        _log(f'Added command {cid} to panel {unique_panel_id} in tab {tab.id!r}')
                    else:
                        _log(f'Command {cid} already exists in panel {unique_panel_id} on tab {tab.id!r}')
                    try:
                        ctrl.isPromoted = True
                        ctrl.isPromotedByDefault = True

                    except Exception:
                        pass

                rctrl = panel.controls.itemById(RELOAD_COMMAND_ID)
                if not rctrl:
                    try:
                        rctrl = panel.controls.addCommand(cmd_defs.itemById(RELOAD_COMMAND_ID))
                        _log(f'Added reload command to panel {unique_panel_id} in tab {tab.id!r}')
                    except Exception:
                        _log_error('reload button add failed\n' + traceback.format_exc())
                if rctrl:
                    try:
                        rctrl.isPromoted = False
                        rctrl.isPromotedByDefault = False
                    except Exception:
                        pass
            except Exception:
                _log_error(f'Panel registration failed for {ws_id}/{tab_id}\n' + traceback.format_exc())

        # 8. Run the consolidated former-standalone sub-add-ins. Each one
        #    registers its own command definition and adds a button to the
        #    shared 'bsplinePanel'. Failures are isolated — one bad sub-module
        #    shouldn't take down the whole add-in.
        for _sub_label, _sub_mod in (('fusion-exporter',  _fe),
                                     ('fusion-inspector', _fi),
                                     ('template-maker',   _tm)):
            if _sub_mod is None:
                continue
            _sub_run = getattr(_sub_mod, 'run', None)
            if not callable(_sub_run):
                continue
            try:
                _sub_run(context)
            except Exception:
                _log_error(f'{_sub_label} run() failed\n' + traceback.format_exc())

        if _diag_logger:
            _diag_logger.log('RUN complete')

    except Exception:
        _log_error('run() failed\n' + traceback.format_exc())


# ── stop() ────────────────────────────────────────────────────────────────────
def stop(context):
    """Fully release add-in resources so Start can reload from scratch.

    NOTE: the refresh CustomEvent is intentionally NOT unregistered — we want it
    to stay alive for the full Fusion session so palettes (or a keyboard shortcut)
    can still trigger a hot-reload after a crash during run().
    """
    try:
        app = adsk.core.Application.get()
        if not app:
            handlers.clear()
            return
        ui       = app.userInterface
        cmd_defs = ui.commandDefinitions

        # 1. Let sub-modules release their own resources first (palettes,
        #    documentActivated subs, their own panels / cmd defs).
        try:
            _teardown_submodules()
        except Exception:
            _log_error('teardown_submodules failed\n' + traceback.format_exc())

        # 2. Remove the unified toolbar panel (controls + panel itself) from both Solid and Sketch tabs.
        try:
            for tab in ui.allToolbarTabs:
                try:
                    if tab is None:
                        continue
                    # Clean up any panels matching our unique prefix
                    panels_to_delete = []
                    for p in tab.toolbarPanels:
                        if p.id.startswith(PANEL_ID):
                            panels_to_delete.append(p)
                    
                    for panel in panels_to_delete:
                        for _ in range(50):      # safety counter
                            if panel.controls.count == 0:
                                break
                            try:
                                panel.controls.item(panel.controls.count - 1).deleteMe()
                            except Exception:
                                break
                        try:
                            panel.deleteMe()
                        except Exception:
                            pass
                except Exception:
                    pass
        except Exception:
            _log_error('panel cleanup failed\n' + traceback.format_exc())

        # 3. Remove our command definitions.
        for cid in ('bsplineCommand', 'hybridBuilderCommand', RELOAD_COMMAND_ID):
            try:
                cd = cmd_defs.itemById(cid)
                if cd:
                    cd.deleteMe()
            except Exception:
                pass

        # 4. Close any palettes that are still open.
        for pid in ('fusionHybridPalette', 'hybridFrameBuilderPalette'):
            try:
                pal = ui.palettes.itemById(pid)
                if pal:
                    pal.deleteMe()
            except Exception:
                pass

    except Exception:
        _log_error('stop() outer exception\n' + traceback.format_exc())
    finally:
        # ALWAYS clear, even on error. Keeps handlers GC-able across restarts.
        handlers.clear()
