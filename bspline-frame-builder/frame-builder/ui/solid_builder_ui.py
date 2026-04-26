"""
Extrude Frame palette — focused on face selection and frame extrusion.
Auto-closes after a successful extrude.
"""
import adsk.core, adsk.fusion, traceback
import os, json, sys

# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Modular imports - initialized by the Entry Point (bspline-frame-builder.py)
frame_engine = None
from fb_engine import solid_coordinator

_active_handler = None

# Standard Logger setup
try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir)
except:
    diag_logger = None

PALETTE_ID = 'frameSolidBuilderPalette'
PALETTE_NAME = 'Extrude Frame'
PALETTE_HTML = 'html/solid_builder_palette.html'

BUILD_SOLID_CMD_ID = 'frameSolidBuildCommand'
_pending_build_request = None

handlers = []


def _create_hidden_command(cmd_defs, cmd_id, name):
    try:
        if cmd_defs.itemById(cmd_id):
            return
        cmd_def = cmd_defs.addButtonDefinition(cmd_id, name, '', '')
        handler = HiddenBuildCommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        handlers.append(handler)
    except:
        pass


def _ensure_hidden_commands(ui):
    """Ensure the hidden bridge commands exist for solid extrude dispatch."""
    try:
        cmd_defs = ui.commandDefinitions
        existing = cmd_defs.itemById(BUILD_SOLID_CMD_ID)
        if existing:
            try:
                existing.deleteMe()
            except:
                pass
        _create_hidden_command(cmd_defs, BUILD_SOLID_CMD_ID, 'Build Solid Frame')
    except Exception:
        if diag_logger:
            diag_logger.log_error(f"_ensure_hidden_commands FAILED:\n{traceback.format_exc()}")


def _schedule_hidden_build(data):
    global _pending_build_request
    _pending_build_request = {'data': data}
    if diag_logger: diag_logger.log("DISPATCH: queued solid build")
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        ui = app.userInterface
        cmd_def = ui.commandDefinitions.itemById(BUILD_SOLID_CMD_ID)
        if cmd_def:
            cmd_def.execute()
        else:
            if diag_logger: diag_logger.log_error(f"DISPATCH ABORT: '{BUILD_SOLID_CMD_ID}' not found")
    except:
        if diag_logger: diag_logger.log_error(f"Solid dispatch failed:\n{traceback.format_exc()}")


if diag_logger:
    diag_logger.log("SOLID BUILDER UI MODULE: Loaded")


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            global frame_engine
            run_palette(frame_engine, diag_logger=diag_logger)
        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"SolidBuilder CommandCreatedHandler CRASH:\n{traceback.format_exc()}")
            adsk.core.Application.get().userInterface.messageBox(f"Palette Launch Failed:\n{e}")


class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self, diag_logger=None):
        super().__init__()
        self.diag_logger = diag_logger
        self.selected_face = None

    def notify(self, args):
        try:
            event_args = adsk.core.HTMLEventArgs.cast(args)
            if not event_args: return

            action = event_args.action
            data_str = event_args.data

            if self.diag_logger:
                self.diag_logger.log(f">>> SOLID UI EVENT: {action} | DATA: {data_str[:100]}...")

            try:
                data = json.loads(data_str)
            except:
                data = {}

            app = adsk.core.Application.get()
            ui = app.userInterface

            if action == 'pick_face':
                self._handle_face_selection(ui)

            elif action == 'run_build':
                self._run_solid_build(data)

            elif action == 'ping':
                self._send_palette_message(ui.palettes.itemById(PALETTE_ID), 'response', {'data': 'PONG'})

        except Exception:
            if self.diag_logger: self.diag_logger.log_error(f"SolidPaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _send_palette_message(self, pal, action, payload):
        try:
            if not pal:
                return False
            pal.sendInfoToHTML(action, json.dumps(payload))
            return True
        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"Palette sendInfoToHTML failed ({action}): {e}")
            return False

    def _handle_face_selection(self, ui):
        pal = ui.palettes.itemById(PALETTE_ID)
        try:
            if self.diag_logger: self.diag_logger.log("FACE SELECTION TRIGGERED")
            self._send_palette_message(pal, 'status_update', {'msg': 'Awaiting face selection in Fusion...'})

            try:
                if hasattr(ui, 'activeSelections') and ui.activeSelections.count > 0:
                    ui.activeSelections.clear()
            except Exception:
                pass

            sel = None
            try:
                sel = ui.selectEntity('Select a face for extrusion', 'Faces')
            except Exception as e1:
                if self.diag_logger: self.diag_logger.log_error(f"Face selection first attempt failed: {e1}")
                try:
                    if hasattr(ui, 'activeSelections') and ui.activeSelections.count > 0:
                        ui.activeSelections.clear()
                except Exception:
                    pass
                try:
                    sel = ui.selectEntity('Select a face for extrusion', 'Faces')
                except Exception as e2:
                    if self.diag_logger: self.diag_logger.log_error(f"Face selection retry failed: {e2}")
                    self._send_palette_message(pal, 'status_update', {'msg': f'Selection attempt failed: {str(e2)}'})
                    raise

            if sel:
                self.selected_face = adsk.fusion.BRepFace.cast(sel.entity)
                if self.diag_logger:
                    self.diag_logger.log(f"FACE SELECTED: {self.selected_face.tempId} on body {self.selected_face.body.name}")
                payload = {
                    'success': True,
                    'name': f"1 Face Selected: {self.selected_face.body.name}",
                    'body_name': self.selected_face.body.name,
                    'face_id': self.selected_face.tempId,
                    'count': 1
                }
                self._send_palette_message(pal, 'status_update', {'msg': 'Face selected successfully.'})
                self._send_palette_message(pal, 'selection_result', payload)
            else:
                self._send_palette_message(pal, 'status_update', {'msg': 'Face selection cancelled.'})
                self._send_palette_message(pal, 'selection_result', {'success': False})
        except Exception as e:
            if self.diag_logger:
                self.diag_logger.log_error(f"Face selection CRITICAL ERROR:\n{traceback.format_exc()}")
            self._send_palette_message(pal, 'status_update', {'msg': f'Selection Error: {str(e)}'})
            self._send_palette_message(pal, 'selection_result', {'success': False})

    def _run_solid_build(self, data):
        if not self.selected_face:
            if self.diag_logger: self.diag_logger.log("Solid build aborted: No face selected")
            ui = adsk.core.Application.get().userInterface
            ui.messageBox("Please select a target face first.")
            return

        if self.diag_logger: self.diag_logger.log(f"Scheduling solid build with face: {self.selected_face.tempId}")
        request_data = dict(data)
        request_data['to_face'] = self.selected_face
        _schedule_hidden_build(request_data)


class HiddenBuildCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd = event_args.command
            self.on_execute = HiddenBuildCommandExecuteHandler()
            cmd.execute.add(self.on_execute)
            handlers.append(self.on_execute)
        except:
            if diag_logger: diag_logger.log_error(f"SolidBuild CommandCreated CRASH:\n{traceback.format_exc()}")


class HiddenBuildCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        global _pending_build_request
        try:
            request = _pending_build_request
            _pending_build_request = None
            if not request:
                return
            data = request.get('data', {})
            _run_solid_build_direct(data)
        except Exception:
            if diag_logger: diag_logger.log_error(f"SolidBuildExecute CRASH:\n{traceback.format_exc()}")


def _set_status(msg):
    try:
        app = adsk.core.Application.get()
        if app:
            app.userInterface.statusBarMessage = msg
    except:
        pass


def _notify_status(msg):
    try:
        pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
    except:
        pass


def _close_palette():
    try:
        pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.isVisible = False
    except:
        pass


def _run_solid_build_direct(data):
    transaction = None
    try:
        if diag_logger: diag_logger.log("RUN SOLID BUILD (hidden command) triggered")

        _set_status("Building solid frame…")
        transaction = _start_undo_transaction('Build Solid Frame')

        solid_coordinator.build_solid_logic_v3(
            to_face=data.get('to_face'),
            start_offset_expr=data.get('offset', '-1 in'),
            appearance_name=data.get('appearance', 'Polished Chrome'),
            external_logger=diag_logger
        )
        _commit_undo_transaction(transaction)
        _set_status("Solid frame complete")
        _notify_status("Solid Build Complete")
        # Auto-close on success
        _close_palette()
    except Exception as e:
        short = str(e).split('\n')[0][:120]
        _set_status(f"Solid build failed: {short} — see log")
        if diag_logger: diag_logger.log_error(f"Solid Build Logic Failed:\n{traceback.format_exc()}")
        _abort_undo_transaction(transaction)


def _start_undo_transaction(name):
    try:
        app = adsk.core.Application.get()
        if app and hasattr(app, 'startTransaction'):
            return app.startTransaction(name)
    except:
        pass
    return None


def _commit_undo_transaction(transaction):
    try:
        if not transaction:
            return
        if hasattr(transaction, 'commit'):
            transaction.commit()
        elif hasattr(transaction, 'end'):
            transaction.end()
    except:
        pass


def _abort_undo_transaction(transaction):
    try:
        if not transaction:
            return
        if hasattr(transaction, 'abort'):
            transaction.abort()
        elif hasattr(transaction, 'rollback'):
            transaction.rollback()
    except:
        pass


def run_palette(engine_instance, diag_logger=None):
    """Central runner to launch the Extrude Frame palette."""
    global frame_engine, _active_handler
    frame_engine = engine_instance

    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        # 1. Cleanup any old palette
        existing = ui.palettes.itemById(PALETTE_ID)
        if existing:
            existing.deleteMe()

        # 2. Create
        html_path = os.path.join(current_dir, PALETTE_HTML).replace('\\', '/')
        pal = ui.palettes.add(PALETTE_ID, PALETTE_NAME, html_path, True, True, True, 380, 460)
        pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
        pal.setMinimumSize(320, 360)

        # 3. Bridge
        _active_handler = PaletteHTMLEventHandler(diag_logger=diag_logger)
        pal.incomingFromHTML.add(_active_handler)
        pal.handler_anchor = _active_handler
        handlers.append(_active_handler)

        # 4. Show
        pal.isVisible = True

        # 5. Hidden commands
        _ensure_hidden_commands(ui)

    except Exception as e:
        if diag_logger:
            diag_logger.log_error(f"FAILURE IN solid run_palette: {e}\n{traceback.format_exc()}")
        raise e
