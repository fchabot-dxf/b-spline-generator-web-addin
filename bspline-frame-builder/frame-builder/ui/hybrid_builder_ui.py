import adsk.core, adsk.fusion, traceback
import os, json, sys, importlib

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

PALETTE_ID = 'hybridFrameBuilderPalette'
PALETTE_NAME = 'Hybrid Frame Builder'
PALETTE_HTML = 'html/index.html'

BUILD_SKETCH_CMD_ID  = 'hybridBuildSketchCommand'
BUILD_SOLID_CMD_ID   = 'hybridBuildSolidCommand'
SCHEMA_PUSH_CMD_ID   = 'hybridSchemaPushCommand'
_pending_build_request = None
_pending_schema_style  = None

handlers = []


def _create_hidden_build_command(cmd_defs, cmd_id, name):
    try:
        if cmd_defs.itemById(cmd_id):
            return
        cmd_def = cmd_defs.addButtonDefinition(cmd_id, name, '', '')
        # Schema-push command gets its own lightweight handler
        if cmd_id == SCHEMA_PUSH_CMD_ID:
            handler = HiddenSchemaPushCommandCreatedHandler()
        else:
            handler = HiddenBuildCommandCreatedHandler()
        cmd_def.commandCreated.add(handler)
        handlers.append(handler)
    except:
        pass


def _ensure_hidden_build_commands(ui):
    try:
        cmd_defs = ui.commandDefinitions
        for cmd_id, cmd_name in (
            (BUILD_SKETCH_CMD_ID, 'Build Skeleton'),
            (BUILD_SOLID_CMD_ID,  'Build Solid Frame'),
            (SCHEMA_PUSH_CMD_ID,  'Push Schema'),
        ):
            existing = cmd_defs.itemById(cmd_id)
            if existing:
                try:
                    existing.deleteMe()
                except:
                    pass
            _create_hidden_build_command(cmd_defs, cmd_id, cmd_name)
    except:
        pass


def _schedule_hidden_build(build_type, data, style_id="Template 1"):
    global _pending_build_request
    _pending_build_request = {'type': build_type, 'data': data, 'style_id': style_id}
    if diag_logger: diag_logger.log(f"DISPATCH: queued '{build_type}' build for style '{style_id}'")
    try:
        app = adsk.core.Application.get()
        if not app:
            if diag_logger: diag_logger.log_error("DISPATCH ABORT: no app")
            return
        ui = app.userInterface
        cmd_id = BUILD_SKETCH_CMD_ID if build_type == 'sketch' else BUILD_SOLID_CMD_ID
        cmd_def = ui.commandDefinitions.itemById(cmd_id)
        if cmd_def:
            if diag_logger: diag_logger.log(f"DISPATCH: firing hidden command '{cmd_id}'")
            cmd_def.execute()
        else:
            if diag_logger: diag_logger.log_error(f"DISPATCH ABORT: cmd_def '{cmd_id}' not found — hidden commands not registered?")
    except:
        if diag_logger:
            diag_logger.log_error(f"Hidden build dispatch failed:\n{traceback.format_exc()}")

def _schedule_schema_push(style_id="Template 1"):
    """Defer a schema push to a fresh Fusion event (outside the HTML event handler)."""
    global _pending_schema_style
    _pending_schema_style = style_id
    if diag_logger: diag_logger.log(f"SCHEMA PUSH: scheduled for style '{style_id}'")
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        cmd_def = app.userInterface.commandDefinitions.itemById(SCHEMA_PUSH_CMD_ID)
        if cmd_def:
            cmd_def.execute()
        else:
            if diag_logger: diag_logger.log_error("SCHEMA PUSH: SCHEMA_PUSH_CMD_ID not registered")
    except:
        if diag_logger: diag_logger.log_error(f"_schedule_schema_push failed:\n{traceback.format_exc()}")


def _push_schema_direct(style_id="Template 1"):
    """Build the schema from the template spec, hydrate ReadOnly params with live
    Fusion values, and send render_schema to the palette."""
    try:
        if not frame_engine:
            if diag_logger: diag_logger.log("SCHEMA PUSH: frame_engine not ready", "WARNING")
            return

        template_spec = frame_engine.get_template_spec(style_id)
        if not template_spec or "Parameters" not in template_spec:
            if diag_logger: diag_logger.log("SCHEMA PUSH: spec has no Parameters", "WARNING")
            return

        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        user_params = design.userParameters if design else None

        params_out = []
        for p in template_spec["Parameters"]:
            p_live = dict(p)
            # ReadOnly params are owned by another add-in — read the live Fusion value.
            # fp.value is always in cm (Fusion internal); convert to the declared display unit.
            if p.get("ReadOnly") and user_params:
                fp = user_params.itemByName(p['Name'])
                if fp:
                    target_unit = p.get('Unit', 'cm')
                    p_live['Val'] = round(fp.value / 2.54, 4) if target_unit == 'in' else round(fp.value, 4)
                    if diag_logger: diag_logger.log(f"SCHEMA HYDRATE: {p['Name']} = {p_live['Val']} {target_unit}")
            params_out.append(p_live)

        # Count phases dynamically from the template's block-based sketches
        phase_count = 0
        for sketch in template_spec.get("Sketches", []):
            blocks = sketch.get("Blocks", [])
            if blocks:
                phase_count = max(phase_count, len(blocks))

        pal = app.userInterface.palettes.itemById(PALETTE_ID) if app else None
        if pal:
            pal.sendInfoToHTML('render_schema', json.dumps({'template': style_id, 'parameters': params_out, 'phase_count': phase_count}))
            if diag_logger: diag_logger.log(f"SCHEMA PUSH: sent {len(params_out)} params, {phase_count} phases for '{style_id}'")
        else:
            if diag_logger: diag_logger.log("SCHEMA PUSH: palette not found", "WARNING")
    except Exception:
        if diag_logger: diag_logger.log_error(f"_push_schema_direct FAILED:\n{traceback.format_exc()}")


if diag_logger:
    diag_logger.log("HYBRID UI MODULE: Loaded & Active (Nuclear Trace On)")

class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            event_args = adsk.core.CommandCreatedEventArgs.cast(args)
            cmd = event_args.command
            
            # Create/Show the palette via the central runner
            global frame_engine
            run_palette(frame_engine, diag_logger=diag_logger)
        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"CommandCreatedHandler CRASH:\n{traceback.format_exc()}")
            adsk.core.Application.get().userInterface.messageBox(f"Palette Launch Failed:\n{e}")

        except:
            if diag_logger: diag_logger.log_error(f"HybridCommandCreated CRASH:\n{traceback.format_exc()}")

class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self, diag_logger=None):
        super().__init__()
        self.diag_logger = diag_logger
        self.selected_face = None
        self.style_id = "Template 1"
        self.active_vars = {} # Shadow state for UI variables (locks and values)
        if self.diag_logger:
            self.diag_logger.log(f"HTMLEventHandler INSTANCE CREATED: {self}")

    def notify(self, args):
        try:
            event_args = adsk.core.HTMLEventArgs.cast(args)
            if not event_args: return

            action = event_args.action
            data_str = event_args.data
            
            # NUCLEAR TRACE: Log EVERY raw event immediately
            if self.diag_logger:
                self.diag_logger.log(f">>> UI EVENT: {action} | DATA: {data_str[:100]}...")

            try:
                data = json.loads(data_str)
            except:
                data = {}
                if self.diag_logger: 
                    self.diag_logger.log(f"WARNING: JSON parse failed for {action}", "WARNING")

            app = adsk.core.Application.get()
            ui = app.userInterface
            design = adsk.fusion.Design.cast(app.activeProduct)

            if action == 'update_param':
                p_id = data.get('id') or data.get('name')
                val = data.get('value')
                self.active_vars[p_id] = val
                self._update_fusion_param(design, p_id, val)
            
            elif action == 'update_lock':
                p_id = data.get('id') or data.get('name')
                is_locked = data.get('locked', False)
                lock_name = f"en_{p_id}"
                lock_val = 1.0 if is_locked else 0.0
                self.active_vars[lock_name] = lock_val
                self._update_fusion_param(design, lock_name, lock_val)

            elif action == 'change_template':
                self.style_id = data.get('template', "Template 1")
                if self.diag_logger: self.diag_logger.log(f"STYLE SYNC: {self.style_id} — scheduling deferred schema push")
                # Defer the sendInfoToHTML call to a fresh Fusion event so we are
                # not calling back into the webview from inside this HTML event handler.
                _schedule_schema_push(self.style_id)

            elif action == 'pick_face':
                self._handle_face_selection(ui)

            elif action == 'run_build':
                build_type = data.get('type')
                if self.diag_logger: self.diag_logger.log(f"RUN_BUILD TYPE: {build_type}")
                if build_type == 'sketch':
                    self._run_sketch_build(data)
                elif build_type == 'solid':
                    self._run_solid_build(data)
                    # Auto-close palette on solid generation
                    pal = ui.palettes.itemById(PALETTE_ID)
                    if pal:
                        pal.isVisible = False

            elif action == 'ping':
                self._send_palette_message(ui.palettes.itemById(PALETTE_ID), 'response', {'data': 'PONG'})
                if self.diag_logger: self.diag_logger.log("BRIDGE HEARTBEAT: PING -> PONG")

        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"PaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _update_fusion_param(self, design, name, value):
        try:
            if self.diag_logger:
                self.diag_logger.log(f"PARAM SYNC: {name} = {value}")
            params = design.userParameters
            p = params.itemByName(name)
            if p:
                # If it's a percentage slider (0-100), we need to scale it by the measured bounding box
                # which is handled by the Frame Engine logic normally, but here we just push the value.
                # However, for 'en_' params, it's a direct toggle.
                if name.startswith('en_'):
                    p.value = float(value)
                else:
                    # Scale by effective dimensions (accounting for aesthetic offset)
                    w = params.itemByName('widthIn').value if params.itemByName('widthIn') else 17.78
                    h = params.itemByName('heightIn').value if params.itemByName('heightIn') else 22.86
                    offset = params.itemByName('boundingboxoffset').value if params.itemByName('boundingboxoffset') else 0.635
                    
                    # effective = total - (2 * offset)
                    eff_w = w - (2 * offset)
                    eff_h = h - (2 * offset)
                    
                    # p.value = (float(value) / 100.0) * total
                    # REMOVED STATIC INJECTION: Let ValueResolver handle formulas during build.
        except Exception as e:
            if self.diag_logger: self.diag_logger.log(f"PARAM SYNC ERROR: {e}")

    def _send_palette_message(self, pal, action, payload):
        try:
            if not pal:
                return False
            
            # Reverting to sendInfoToHTML as executeJavaScript was missing on this environment.
            # We fix the previous 'Script error. at :0' by simplifying the receiving end in index.html.
            pal.sendInfoToHTML(action, json.dumps(payload))
            return True
        except Exception as e:
            if self.diag_logger:
                self.diag_logger.log_error(f"Palette sendInfoToHTML failed ({action}): {e}")
            return False

    def _handle_face_selection(self, ui):
        pal = ui.palettes.itemById(PALETTE_ID)
        try:
            if self.diag_logger: self.diag_logger.log("FACE SELECTION TRIGGERED: Entering selectEntity mode...")
            self._send_palette_message(pal, 'status_update', {'msg': 'Awaiting face selection in Fusion...'})

            # Clear any existing active selections before prompting.
            try:
                if hasattr(ui, 'activeSelections') and ui.activeSelections.count > 0:
                    ui.activeSelections.clear()
                    if self.diag_logger: self.diag_logger.log("Cleared existing active selections before face pick.")
            except Exception as sel_clear_exc:
                if self.diag_logger: self.diag_logger.log_error(f"Face selection clear warning: {sel_clear_exc}")

            sel = None
            try:
                sel = ui.selectEntity('Select a face for extrusion', 'Faces')
            except Exception as e1:
                if self.diag_logger: self.diag_logger.log_error(f"Face selection first attempt failed: {e1}")
                try:
                    if hasattr(ui, 'activeSelections') and ui.activeSelections.count > 0:
                        ui.activeSelections.clear()
                        if self.diag_logger: self.diag_logger.log("Cleared active selections before retry.")
                except Exception as sel_clear_exc:
                    if self.diag_logger: self.diag_logger.log_error(f"Face selection second-clear warning: {sel_clear_exc}")
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
                self._send_palette_message(pal, 'debug', {'msg': f"Face selection payload sent: {payload}"})
                if self.diag_logger: self.diag_logger.log(f"FACE SELECTION MESSAGE SENT: {payload}")
            else:
                if self.diag_logger: self.diag_logger.log("FACE SELECTION CANCELLED by user or failed.")
                self._send_palette_message(pal, 'status_update', {'msg': 'Face selection cancelled.'})
                self._send_palette_message(pal, 'selection_result', {'success': False})
        except Exception as e:
            if self.diag_logger:
                self.diag_logger.log_error(f"Face selection CRITICAL ERROR:\n{traceback.format_exc()}")
            self._send_palette_message(pal, 'status_update', {'msg': f'Selection Error: {str(e)}'})
            self._send_palette_message(pal, 'selection_result', {'success': False})
            try:
                ui.messageBox(f"Selection Error: {str(e)}")
            except:
                pass

    def _start_undo_transaction(self, name):
        try:
            app = adsk.core.Application.get()
            if app and hasattr(app, 'startTransaction'):
                return app.startTransaction(name)
        except:
            pass
        return None

    def _commit_undo_transaction(self, transaction):
        try:
            if not transaction:
                return
            if hasattr(transaction, 'commit'):
                transaction.commit()
            elif hasattr(transaction, 'end'):
                transaction.end()
        except:
            pass

    def _abort_undo_transaction(self, transaction):
        try:
            if not transaction:
                return
            if hasattr(transaction, 'abort'):
                transaction.abort()
            elif hasattr(transaction, 'rollback'):
                transaction.rollback()
        except:
            pass

    def _run_sketch_build(self, data):
        if self.diag_logger: self.diag_logger.log(f"RUN SKETCH BUILD triggered. Style: {self.style_id}")
        # Inject the latest shadow state into the build request
        request_data = dict(data)
        request_data['ui_state'] = self.active_vars
        _schedule_hidden_build('sketch', request_data, self.style_id)

    def _run_solid_build(self, data):
        if not self.selected_face:
            if self.diag_logger: self.diag_logger.log("Solid build aborted: No face selected")
            ui = adsk.core.Application.get().userInterface
            ui.messageBox("Please select a target face first.")
            return

        if self.diag_logger: self.diag_logger.log(f"Scheduling solid build with face: {self.selected_face.tempId}")
        request_data = dict(data)
        request_data['to_face'] = self.selected_face
        _schedule_hidden_build('solid', request_data, self.style_id)

    def _notify_status(self, msg):
        try:
            pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
            if pal:
                pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
        except: pass


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
            if diag_logger:
                diag_logger.log_error(f"HiddenBuildCommandCreated CRASH:\n{traceback.format_exc()}")


class HiddenBuildCommandExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        global _pending_build_request
        if diag_logger: diag_logger.log("HIDDEN CMD EXECUTE: handler fired")
        try:
            request = _pending_build_request
            _pending_build_request = None
            if not request:
                if diag_logger: diag_logger.log_error("HIDDEN CMD EXECUTE: no pending request found")
                return

            req_type = request.get('type')
            style_id = request.get('style_id', 'Template 1')
            if diag_logger: diag_logger.log(f"HIDDEN CMD EXECUTE: type='{req_type}' style='{style_id}'")

            data = request.get('data', {})
            if req_type == 'sketch':
                _run_sketch_build_direct(data, style_id)
            elif req_type == 'solid':
                _run_solid_build_direct(data)
            else:
                if diag_logger: diag_logger.log_error(f"HIDDEN CMD EXECUTE: unknown type '{req_type}'")
        except Exception:
            if diag_logger:
                diag_logger.log_error(f"HiddenBuildCommandExecute CRASH:\n{traceback.format_exc()}")


class HiddenSchemaPushCommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            cmd = adsk.core.CommandCreatedEventArgs.cast(args).command
            h = HiddenSchemaPushExecuteHandler()
            cmd.execute.add(h)
            handlers.append(h)
        except:
            if diag_logger: diag_logger.log_error(f"SchemaPushCreated CRASH:\n{traceback.format_exc()}")


class HiddenSchemaPushExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        global _pending_schema_style
        style = _pending_schema_style or "Template 1"
        _pending_schema_style = None
        if diag_logger: diag_logger.log(f"SCHEMA PUSH EXECUTE: style='{style}'")
        _push_schema_direct(style)


def _run_sketch_build_direct(data, style_id):
    transaction = None
    try:
        if diag_logger: diag_logger.log(f"RUN SKETCH BUILD (hidden command) triggered. Style: {style_id}")
        transaction = _start_undo_transaction('Build Skeleton')

        if frame_engine:
            if diag_logger: diag_logger.log(f"Calling engine with style_id: {style_id}")
            frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=diag_logger, data=data)
            _commit_undo_transaction(transaction)
            _notify_status("Sketch Build Complete")
        else:
            if diag_logger: diag_logger.log_error("CRITICAL: frame_engine is NOT INJECTED (None)")
            ui = adsk.core.Application.get().userInterface
            ui.messageBox("Internal Error: Frame Engine not loaded.")
            _abort_undo_transaction(transaction)
    except Exception as e:
        if diag_logger: diag_logger.log_error(f"Sketch Build Logic Failed:\n{traceback.format_exc()}")
        _abort_undo_transaction(transaction)
        ui = adsk.core.Application.get().userInterface
        ui.messageBox(f"Sketch Build Failed:\n{e}")


def _run_solid_build_direct(data):
    transaction = None
    try:
        if diag_logger: diag_logger.log("RUN SOLID BUILD (hidden command) triggered")

        transaction = _start_undo_transaction('Build Solid Frame')
        if diag_logger: diag_logger.log(f"Calling solid coordinator for hybrid solid build")

        solid_coordinator.build_solid_logic_v3(
            to_face = data.get('to_face'),
            start_offset_expr = data.get('offset', '-1 in'),
            appearance_name = data.get('appearance', 'Polished Chrome'),
            external_logger = diag_logger
        )
        _commit_undo_transaction(transaction)
        _notify_status("Solid Build Complete")
    except Exception as e:
        if diag_logger: diag_logger.log_error(f"Solid Build Logic Failed:\n{traceback.format_exc()}")
        _abort_undo_transaction(transaction)
        ui = adsk.core.Application.get().userInterface
        ui.messageBox(f"Solid Build Failed:\n{e}")


def _start_undo_transaction(name):
    try:
        app = adsk.core.Application.get()
        if app and hasattr(app, 'startTransaction'):
            return app.startTransaction(name)
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        if design and hasattr(design, 'startTransaction'):
            return design.startTransaction(name)
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


def _notify_status(msg):
    try:
        pal = adsk.core.Application.get().userInterface.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('status_update', json.dumps({'msg': msg}))
    except:
        pass
def run_palette(engine_instance, diag_logger=None):
    """
    Central runner to launch the palette and maintain the bridge reference.
    """
    global frame_engine, _active_handler
    frame_engine = engine_instance
    if diag_logger:
        diag_logger.log(f"run_palette: engine injected = {frame_engine is not None} | type = {type(frame_engine).__name__}")

    try:
        app = adsk.core.Application.get()
        ui = app.userInterface
        
        # 1. CLEANUP: Ensure any old palette is totally gone
        existing = ui.palettes.itemById(PALETTE_ID)
        if existing:
            existing.deleteMe()

        # 2. CREATE: New palette instance
        html_path = os.path.join(current_dir, PALETTE_HTML).replace('\\', '/')
        pal = ui.palettes.add(PALETTE_ID, PALETTE_NAME, html_path, True, True, True, 340, 700)
        pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
        pal.setMinimumSize(320, 500)

        # 3. RE-ATTACH BRIDGE: Ensure global handler reference
        _active_handler = PaletteHTMLEventHandler(diag_logger=diag_logger)
        pal.incomingFromHTML.add(_active_handler)
        
        # NUCLEAR ANCHOR: Tie the handler to the palette itself to prevent garbage collection
        # Fusion 360 sometimes drops the reference if it's only in a global list.
        pal.handler_anchor = _active_handler
        
        handlers.append(_active_handler) # Secondary survival list

        if diag_logger:
            diag_logger.log(f"LAUNCHED PALETTE: {PALETTE_NAME} (Bridge Attached)")
            diag_logger.log(f"HANDLER REF: {_active_handler}")

        # 4. SHOW
        pal.isVisible = True
        
        # 5. SYNC: Ensure hidden build commands are fresh (includes SCHEMA_PUSH_CMD_ID)
        _ensure_hidden_build_commands(ui)

        # 6. INITIAL SCHEMA PUSH via deferred hidden command
        # sendInfoToHTML cannot be called here (page not loaded yet), so we schedule
        # a schema push that fires in a fresh Fusion event once the commands are ready.
        _schedule_schema_push("Template 1")
        if diag_logger: diag_logger.log("INITIAL SCHEMA PUSH scheduled.")

    except Exception as e:
        if diag_logger:
            diag_logger.log_error(f"FAILURE IN run_palette: {e}\n{traceback.format_exc()}")
        raise e
