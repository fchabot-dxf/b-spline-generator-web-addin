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
PALETTE_HTML = 'html/frame_builder_palette.html'

BUILD_SKETCH_CMD_ID  = 'hybridBuildSketchCommand'
BUILD_SOLID_CMD_ID   = 'hybridBuildSolidCommand'
SCHEMA_PUSH_CMD_ID   = 'hybridSchemaPushCommand'
_pending_build_request = None
_pending_schema_style  = None

handlers = []
_doc_activated_handler = None  # Holds DocumentActivated subscription to prevent GC


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
    """
    Ensure the hidden bridge commands exist. These are used by the HTML palette 
    to trigger Python actions and do NOT need toolbar buttons.
    """
    try:
        cmd_defs = ui.commandDefinitions
        targets = (
            (BUILD_SKETCH_CMD_ID, 'Build Skeleton'),
            (BUILD_SOLID_CMD_ID,  'Build Solid Frame'),
            (SCHEMA_PUSH_CMD_ID,  'Push Schema'),
        )
        
        for cmd_id, cmd_name in targets:
            # 1. Clean up existing definitions to avoid 'already exists' errors
            existing = cmd_defs.itemById(cmd_id)
            if existing:
                try:
                    existing.deleteMe()
                except:
                    pass
            
            # 2. Re-register the hidden command
            _create_hidden_build_command(cmd_defs, cmd_id, cmd_name)
            
    except Exception:
        if diag_logger:
            diag_logger.log_error(f"_ensure_hidden_build_commands FAILED:\n{traceback.format_exc()}")
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

        if diag_logger:
            diag_logger.log(f"SCHEMA PUSH: trying to build schema for style_id='{style_id}'")

        template_spec = frame_engine.get_template_spec(style_id)
        if not template_spec:
            if diag_logger: diag_logger.log("SCHEMA PUSH: no template spec returned", "WARNING")
            return

        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        user_params = design.userParameters if design else None

        def _hydrate_params(raw_params):
            """Hydrate a param list with live Fusion values and resolved Min/Max expressions.
            Provides de-scaling for factor-based variables (ShoulderSpan -> 0.80)."""
            out = []
            
            # Pre-fetch drivers for de-scaling factors
            w_in = user_params.itemByName('widthIn').value if user_params and user_params.itemByName('widthIn') else 14.0
            h_in = user_params.itemByName('heightIn').value if user_params and user_params.itemByName('heightIn') else 5.0

            for p in raw_params:
                p_live = dict(p)
                p_name = p['Name']
                
                # Preferred: Get values from Fusion if they exist
                if user_params:
                    fp = user_params.itemByName(p_name)
                    if fp:
                        # 1. Start with raw physical value
                        raw_val = fp.value
                        
                        # 2. De-scale Factors (Physical CM -> Multiplier Ratio)
                        if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                            p_live['Val'] = round(raw_val / w_in, 4) if w_in != 0 else p.get('Val', 0)
                        elif p_name in ['TopGap', 'BottomGap',
                                        'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                            p_live['Val'] = round(raw_val / h_in, 4) if h_in != 0 else p.get('Val', 0)
                        elif p_name == 'WaistOffset':
                            p_live['Val'] = round(raw_val / (h_in / 2.0), 4) if h_in != 0 else p.get('Val', 0)
                        else:
                            # Standard absolute parameter
                            target_unit = p.get('Unit', 'cm')
                            p_live['Val'] = round(raw_val / 2.54, 4) if target_unit == 'in' else round(raw_val, 4)
                        
                        if diag_logger and p.get("ReadOnly"):
                            diag_logger.log(f"SCHEMA HYDRATE: {p_name} = {p_live['Val']}")
                
                # If Val is still a string (from template default), evaluate it
                if isinstance(p_live.get('Val'), str) and design:
                    try:
                        eval_val = design.unitsManager.evaluateExpression(p_live['Val'], p.get('Unit', 'cm'))
                        # If it's a factor, we still need to de-scale the evaluated result
                        if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                            p_live['Val'] = round(eval_val / w_in, 4) if w_in != 0 else 0.8
                        elif p_name in ['TopGap', 'BottomGap',
                                        'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                            p_live['Val'] = round(eval_val / h_in, 4) if h_in != 0 else 0.15
                        else:
                            p_live['Val'] = round(eval_val, 4)
                    except:
                        pass

                # Resolve Min/Max expressions (e.g. "widthIn * 0.2")
                for key in ['Min', 'Max']:
                    if key in p_live and isinstance(p_live[key], str):
                        try:
                            expr = p_live[key]
                            if design:
                                eval_val = design.unitsManager.evaluateExpression(expr, p_live.get('Unit', 'cm'))
                                p_live[key] = round(eval_val, 4)
                        except Exception as e:
                            if diag_logger: diag_logger.log(f"SCHEMA RESOLVE ERROR: {p_name}.{key} failed: {e}", "WARNING")
                out.append(p_live)
            return out

        # Build per-sketch payload and count phases
        sketches_out = []
        phase_count = 0
        for sketch in template_spec.get("Sketches", []):
            blocks = sketch.get("Blocks", [])
            sketch_phase_count = len(blocks) if blocks else 1
            phase_count += sketch_phase_count
            phase_files = []
            for block in blocks:
                if isinstance(block, dict):
                    phase_files.append(block.get("PhaseFile") or block.get("PhaseID") or '')
            sketches_out.append({
                "name":        sketch.get("Name", ""),
                "label":       sketch.get("Label", sketch.get("Name", "")),
                "parameters":  _hydrate_params(sketch.get("Parameters", [])),
                "phase_count": sketch_phase_count,
                "phase_files": phase_files,
            })

        total_params = sum(len(s["parameters"]) for s in sketches_out)
        pal = app.userInterface.palettes.itemById(PALETTE_ID) if app else None
        if pal:
            pal.sendInfoToHTML('render_schema', json.dumps({
                'template':   style_id,
                'sketches':   sketches_out,
                'phase_count': phase_count
            }))
            if diag_logger: diag_logger.log(f"SCHEMA PUSH: {total_params} params across {len(sketches_out)} sketches, {phase_count} phases for '{style_id}'")
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
        self.style_id = None
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
                # Keep the doc-activated handler's style reference in sync
                if hasattr(self, '_style_id_ref'):
                    self._style_id_ref[0] = self.style_id
                if self.diag_logger: self.diag_logger.log(f"STYLE SYNC: {self.style_id} — scheduling deferred schema push")
                # Defer the sendInfoToHTML call to a fresh Fusion event so we are
                # not calling back into the webview from inside this HTML event handler.
                _schedule_schema_push(self.style_id)

            elif action in ('request_template_list', 'get_templates'):
                self._send_template_list(ui.palettes.itemById(PALETTE_ID))

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

    def _send_template_list(self, pal):
        try:
            if not pal or not frame_engine:
                return False
            templates = frame_engine.get_available_templates()
            if self.diag_logger:
                self.diag_logger.log(f"TEMPLATE LIST: available={[t['value'] for t in templates]} selected={self.style_id}")
            payload = {
                'templates': templates,
                'selected': self.style_id
            }
            return self._send_palette_message(pal, 'template_list', payload)
        except Exception as e:
            if self.diag_logger:
                self.diag_logger.log_error(f"Template list send failed: {e}")
            return False

    def _update_fusion_param(self, design, name, value):
        try:
            if self.diag_logger:
                self.diag_logger.log(f"PARAM SYNC: {name} = {value}")
            params = design.userParameters
            p = params.itemByName(name)
            
            # Auto-create if missing (e.g. after a rename)
            if not p:
                if self.diag_logger: self.diag_logger.log(f"PARAM SYNC: Creating missing parameter '{name}'")
                try:
                    # Default to 'cm' for geometry, '' for toggles
                    unit = '' if name.startswith('en_') else 'cm'
                    p = params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Hybrid UI Sync")
                except Exception as ex:
                    if self.diag_logger: self.diag_logger.log(f"PARAM SYNC: Failed to create '{name}': {ex}", "ERROR")
                    return

            if p:
                from fb_engine import fb_value_resolver
                importlib.reload(fb_value_resolver)
                resolver = fb_value_resolver.FBValueResolver(design, self.diag_logger)
                expr = resolver.wrap_expression_if_factor(name, value)
                
                # Special case: Toggles use raw values (safety cast)
                if name.startswith('en_'):
                    expr = str(float(value))

                # Apply to Fusion 360
                p.expression = str(expr)
                if self.diag_logger:
                    self.diag_logger.log(f"PARAM SYNC FINAL: {name} expression set to '{expr}'")
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
        style_id = data.get('template') or self.style_id
        if self.diag_logger: self.diag_logger.log(f"RUN SKETCH BUILD triggered. Style: {style_id}")
        # Inject the latest shadow state into the build request
        request_data = dict(data)
        request_data['ui_state'] = self.active_vars
        _schedule_hidden_build('sketch', request_data, style_id)

    def _run_solid_build(self, data):
        if not self.selected_face:
            if self.diag_logger: self.diag_logger.log("Solid build aborted: No face selected")
            ui = adsk.core.Application.get().userInterface
            ui.messageBox("Please select a target face first.")
            return

        style_id = data.get('template') or self.style_id
        if self.diag_logger: self.diag_logger.log(f"Scheduling solid build with face: {self.selected_face.tempId} and style: {style_id}")
        request_data = dict(data)
        request_data['to_face'] = self.selected_face
        _schedule_hidden_build('solid', request_data, style_id)

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


def _set_status(msg):
    """Write a message to the Fusion status bar (bottom-left of the main window)."""
    try:
        app = adsk.core.Application.get()
        if app:
            app.userInterface.statusBarMessage = msg
    except:
        pass


def _run_sketch_build_direct(data, style_id):
    transaction = None
    try:
        if diag_logger: diag_logger.log(f"RUN SKETCH BUILD (hidden command) triggered. Style: {style_id}")

        max_phase = data.get('max_phase') if isinstance(data, dict) else None
        phase_label = f" · up to phase {max_phase}" if max_phase is not None else ""
        _set_status(f"Building {style_id}{phase_label}…")

        transaction = _start_undo_transaction('Build Skeleton')

        if frame_engine:
            if diag_logger: diag_logger.log(f"Calling engine with style_id: {style_id}")
            frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=diag_logger, data=data)
            _commit_undo_transaction(transaction)
            _set_status(f"{style_id} · sketch complete{phase_label}")
            _notify_status("Sketch Build Complete")
        else:
            if diag_logger: diag_logger.log_error("CRITICAL: frame_engine is NOT INJECTED (None)")
            _set_status("Build error: frame engine not loaded — restart add-in")
            _abort_undo_transaction(transaction)
    except Exception as e:
        short = str(e).split('\n')[0][:120]
        _set_status(f"Build failed: {short} — see log")
        if diag_logger: diag_logger.log_error(f"Sketch Build Logic Failed:\n{traceback.format_exc()}")
        _abort_undo_transaction(transaction)


def _run_solid_build_direct(data):
    transaction = None
    try:
        if diag_logger: diag_logger.log("RUN SOLID BUILD (hidden command) triggered")

        _set_status("Building solid frame…")
        transaction = _start_undo_transaction('Build Solid Frame')

        solid_coordinator.build_solid_logic_v3(
            to_face = data.get('to_face'),
            start_offset_expr = data.get('offset', '-1 in'),
            appearance_name = data.get('appearance', 'Polished Chrome'),
            external_logger = diag_logger
        )
        _commit_undo_transaction(transaction)
        _set_status("Solid frame complete")
        _notify_status("Solid Build Complete")
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
class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    """Re-pushes the palette schema whenever the user switches active documents.
    This keeps the palette sliders in sync with the parameters of the current file."""
    def __init__(self, style_id_ref, diag_logger=None):
        super().__init__()
        self._style_id_ref = style_id_ref  # mutable list so we always get the current style
        self.diag_logger = diag_logger

    def notify(self, args):
        try:
            # Only refresh if the palette is actually open
            app = adsk.core.Application.get()
            if not app:
                return
            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if pal and pal.isVisible:
                style = self._style_id_ref[0] if self._style_id_ref else "Template 1"
                if self.diag_logger:
                    self.diag_logger.log(f"DOC ACTIVATED: refreshing palette for style '{style}'")
                _schedule_schema_push(style)
        except Exception:
            if self.diag_logger:
                self.diag_logger.log_error(f"DocumentActivatedHandler CRASH:\n{traceback.format_exc()}")


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
        pal = ui.palettes.add(PALETTE_ID, PALETTE_NAME, html_path, True, True, True, 450, 700)
        pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
        pal.setMinimumSize(320, 500)

        # 3. RE-ATTACH BRIDGE: Ensure global handler reference
        _active_handler = PaletteHTMLEventHandler(diag_logger=diag_logger)
        pal.incomingFromHTML.add(_active_handler)

        # NUCLEAR ANCHOR: Tie the handler to the palette itself to prevent garbage collection
        # Fusion 360 sometimes drops the reference if it's only in a global list.
        pal.handler_anchor = _active_handler

        handlers.append(_active_handler)  # Secondary survival list

        # 3b. DOCUMENT SWITCH REFRESH: subscribe to documentActivated so the palette
        # re-reads parameter values whenever the user switches between open files.
        global _doc_activated_handler
        # Unsubscribe any previous instance first
        try:
            if _doc_activated_handler:
                app.documentActivated.remove(_doc_activated_handler)
        except Exception:
            pass
        # _active_handler.style_id is a plain string; wrap in a list so the doc handler
        # always sees the current value without needing a direct reference to _active_handler.
        _style_id_ref = [_active_handler.style_id]
        # Patch set_style so the ref list stays in sync when template changes
        _orig_style = _active_handler.__class__.notify
        _active_handler._style_id_ref = _style_id_ref  # expose ref on the handler

        _doc_activated_handler = DocumentActivatedHandler(_style_id_ref, diag_logger=diag_logger)
        app.documentActivated.add(_doc_activated_handler)
        handlers.append(_doc_activated_handler)

        if diag_logger:
            diag_logger.log(f"LAUNCHED PALETTE: {PALETTE_NAME} (Bridge Attached)")
            diag_logger.log(f"HANDLER REF: {_active_handler}")

        # 4. SHOW
        pal.isVisible = True
        
        # 5. SYNC: Ensure hidden build commands are fresh (includes SCHEMA_PUSH_CMD_ID)
        _ensure_hidden_build_commands(ui)

        # 5b. Use the first available template if the handler still has a default placeholder.
        try:
            if frame_engine:
                templates = frame_engine.get_available_templates()
                if templates:
                    first_template = templates[0]['value']
                    _active_handler.style_id = first_template
                    _style_id_ref[0] = first_template
                    if diag_logger:
                        diag_logger.log(f"INITIAL STYLE: selected first available template '{first_template}'")
        except Exception as e:
            if diag_logger:
                diag_logger.log(f"INITIAL STYLE: failed to derive first template: {e}", "WARNING")

        # 6. INITIAL SCHEMA PUSH via deferred hidden command
        # sendInfoToHTML cannot be called here (page not loaded yet), so we schedule
        # a schema push that fires in a fresh Fusion event once the commands are ready.
        _schedule_schema_push(_active_handler.style_id)
        if diag_logger: diag_logger.log(f"INITIAL SCHEMA PUSH scheduled for '{_active_handler.style_id}'.")

    except Exception as e:
        if diag_logger:
            diag_logger.log_error(f"FAILURE IN run_palette: {e}\n{traceback.format_exc()}")
        raise e
