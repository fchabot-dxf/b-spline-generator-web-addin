# Entry point for the unified Fusion 360 add-in: bspline-frame-builder
#
# Wiring map:
#   bsplineCommand      → b-spline-gen  CommandCreatedHandler  (palette / HTML UI)
#   sketchBuilderCommand → frame-builder           CommandCreatedHandler  (sketch dialog)
#   solidBuilderCommand  → frame-builder           SolidCommandCreatedHandler (solid dialog)
#
# Python cannot import hyphenated module names with 'import', so both sub-modules
# are loaded via importlib.util.spec_from_file_location with safe alias names.

import adsk.core, adsk.fusion, adsk.cam, traceback
import os, sys, importlib.util

# Disable bytecode generation to keep the add-in folder clean of __pycache__ and .pyc
sys.dont_write_bytecode = True

handlers = []

# --- GLOBAL STARTUP TRAP ---
try:
    # Use simpler path discovery for better cross-machine reliability
    addin_root = os.path.dirname(__file__)
except Exception as _path_e:
    addin_root = "."

try:
    # Setup Logger early to capture startup errors
    _utils_path = os.path.join(addin_root, 'frame-builder', 'fb_utils')
    if _utils_path not in sys.path:
        sys.path.insert(0, _utils_path)

    from logger import DebugLogger
    diag_logger = DebugLogger(os.path.join(addin_root, 'frame-builder'))

    def _load_submodule(safe_name, subdir, filename):
        """
        Load a .py file from a hyphenated sub-directory.
        Forces a fresh execution by clearing the module cache.
        """
        subdir_path = os.path.join(addin_root, subdir)
        if subdir_path not in sys.path:
            sys.path.insert(0, subdir_path)
        
        # FORCE RELOAD: Remove from sys.modules if already there
        if safe_name in sys.modules:
            del sys.modules[safe_name]

        filepath = os.path.join(subdir_path, filename)
        spec   = importlib.util.spec_from_file_location(safe_name, filepath)
        module = importlib.util.module_from_spec(spec)
        sys.modules[safe_name] = module # official registration
        spec.loader.exec_module(module)
        return module


    # frame-builder specialized components
    def _force_wipe(names):
        for name in names:
            try:
                if name in sys.modules:
                    del sys.modules[name]
            except: pass
            # Also wipe any sub-packages to be safe
            try:
                for key in list(sys.modules.keys()):
                    if key.startswith(name + "."):
                        del sys.modules[key]
            except: pass

    _force_wipe(['sketch_builder_ui', 'solid_builder_ui', 'fb_engine.frame_engine', 'fb_engine'])

    try:
        # 1. LOAD ENGINE FIRST
        _fb_root = os.path.join(addin_root, 'frame-builder')
        _sk_root = os.path.join(addin_root, 'frame-builder', 'sketches')
        
        # Add frame-builder root and all 4 template data directories to sys.path
        _search_paths = [_fb_root]
        for i in range(1, 5):
            _search_paths.append(os.path.join(_sk_root, f'template_{i}'))
            
        for d in _search_paths:
            if d not in sys.path:
                sys.path.insert(0, d)

        _engine_path = os.path.join(_fb_root, 'fb_engine', 'frame_engine.py')
        _eng_spec = importlib.util.spec_from_file_location('frame_engine_core', _engine_path)
        _engine = importlib.util.module_from_spec(_eng_spec)
        sys.modules['frame_engine_core'] = _engine
        _eng_spec.loader.exec_module(_engine)

        # 2. LOAD BUILDERS
        _fbs = _load_submodule('sketch_builder_ui', 'frame-builder/sketch-builder', 'sketch_builder.py')
        _fbo = _load_submodule('solid_builder_ui',  'frame-builder/solid-builder',  'solid_builder.py')
        
        # 3. DIRECT INJECTION: Force the builders to use our fresh engine object
        _fbs.frame_engine = _engine
        _fbo.frame_engine = _engine

        # 4. LOAD B-SPLINE
        _bs = _load_submodule('bspline_ui', 'b-spline-gen', 'b-spline-gen.py')
    except Exception as _inner_e:
        if 'diag_logger' in locals():
            diag_logger.log_error(f"INNER HUB LOAD ERROR: {_inner_e}\n{traceback.format_exc()}")
        raise _inner_e

except Exception as _global_e:
    # Critical failure during bootstrap
    if 'diag_logger' in locals():
        diag_logger.log_error(f"GLOBAL CRITICAL CRASH: {_global_e}\n{traceback.format_exc()}")
    else:
        # Fallback to message box if logger failed to even initialize
        try:
            adsk.core.Application.get().userInterface.messageBox(
                f"Add-In Critical Startup Error:\n{_global_e}\n\n{traceback.format_exc()}")
        except:
            pass

# ── Resource paths ────────────────────────────────────────────────────────────
_fb_res_sk = os.path.join(addin_root, 'frame-builder', 'sketch-builder', 'ressources')
_fb_res_so = os.path.join(addin_root, 'frame-builder', 'solid-builder',  'ressources')
_bs_res = os.path.join(addin_root, 'b-spline-gen', 'resources')

# ── Command table ─────────────────────────────────────────────────────────────
# handler_factory: callable (no args) → fresh CommandCreatedEventHandler instance.
# Using a factory (not a pre-built instance) keeps each run() call independent.
COMMANDS = [
    {
        'id':              'bsplineCommand',
        'name':            'B-Spline',
        'tooltip':         'Procedural B-Spline Surface & Solid Engine',
        'res_path':        _bs_res,
        'handler_factory': lambda: _bs.CommandCreatedHandler()
    },
    {
        'id':              'sketchBuilderCommand',
        'name':            'Sketch Builder',
        'tooltip':         'Procedural Sketch Builder for Fusion 360',
        'res_path':        os.path.join(_fb_res_sk, 'SketchCommand'),
        'handler_factory': lambda: _fbs.CommandCreatedHandler(_engine.build_sketch_logic_v3)
    },
    {
        'id':              'solidBuilderCommand',
        'name':            'Solid Builder',
        'tooltip':         'Procedural Solid Builder for Fusion 360',
        'res_path':        os.path.join(_fb_res_so, 'SolidCommand'),
        'handler_factory': lambda: _fbo.SolidCommandCreatedHandler()
    }
]

PANEL_ID = 'bsplinePanel'


def run(context):
    ui = None
    try:
        app = adsk.core.Application.get()
        ui  = app.userInterface
        
        if not _fbs or not _fbo or not _bs:
            ui.messageBox("Add-In Error: Sub-modules failed to load. Check logs.")
            return

        cmd_defs = ui.commandDefinitions

        # ── Register each command ─────────────────────────────────────────
        for cmd in COMMANDS:
            cmd_id = cmd['id']
            # Defensive cleanup of any previous definition (reload / crash recovery)
            try:
                existing = cmd_defs.itemById(cmd_id)
                if existing:
                    existing.deleteMe()
            except:
                pass

            new_def    = cmd_defs.addButtonDefinition(
                cmd_id, cmd['name'], cmd['tooltip'], cmd['res_path'])
            on_created = cmd['handler_factory']()
            new_def.commandCreated.add(on_created)
            handlers.append(on_created)          # keep alive

        # ── Add all buttons to one unified toolbar panel ──────────────────
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if not ws: ws = ui.activeWorkspace

        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            if not tab:
                for t in ws.toolbarTabs:
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t
                        break

            if tab:
                panel = tab.toolbarPanels.itemById(PANEL_ID)
                if not panel:
                    panel = tab.toolbarPanels.add(PANEL_ID, 'B-Spline Builder', 'SelectPanel', False)

                for cmd in COMMANDS:
                    cid = cmd['id']
                    if not panel.controls.itemById(cid):
                        ctrl = panel.controls.addCommand(cmd_defs.itemById(cid))
                        ctrl.isPromoted          = True
                        ctrl.isPromotedByDefault = True

    except:
        if ui:
            ui.messageBox('Add-In Start Failed:\n{}'.format(traceback.format_exc()))


def stop(context):
    try:
        app = adsk.core.Application.get()
        if not app:
            handlers.clear()
            return
        ui       = app.userInterface
        cmd_defs = ui.commandDefinitions

        # ── Remove toolbar panel (delete controls from END — live-collection safety) ──
        ws = ui.workspaces.itemById('FusionSolidEnvironment')
        if not ws: ws = ui.workspaces.itemById('SolidEnvironment')
        if ws:
            tab = ws.toolbarTabs.itemById('SolidTab')
            if not tab:
                for t in ws.toolbarTabs:
                    if 'Solid' in t.id or 'Solid' in t.name:
                        tab = t
                        break
            if tab:
                panel = tab.toolbarPanels.itemById(PANEL_ID) 
                if panel:
                    for _ in range(50):
                        if panel.controls.count == 0:
                            break
                        try:
                            panel.controls.item(panel.controls.count - 1).deleteMe()
                        except:
                            break
                    try:
                        panel.deleteMe()
                    except:
                        pass

        # ── Remove command definitions ─────────────────────────────────────
        for cmd in COMMANDS:
            try:
                cmd_def = cmd_defs.itemById(cmd['id'])
                if cmd_def:
                    cmd_def.deleteMe()
            except:
                pass

        # ── Close bspline palette if still open ───────────────────────────
        try:
            pal = ui.palettes.itemById(_bs.PALETTE_ID)
            if pal:
                pal.deleteMe()
        except:
            pass

    except:
        pass
    finally:
        handlers.clear()   # ALWAYS clear, even on error
