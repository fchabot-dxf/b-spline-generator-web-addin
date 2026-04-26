"""
Sketch Builder palette — focused on template selection, parameter authoring,
and skeleton sketch construction. Auto-closes after a successful build.
"""
import adsk.core, adsk.fusion, traceback
import os, json, sys, importlib

# Add parent directory to sys.path so we can import from core folders (engine, utils, etc.)
current_dir = os.path.dirname(os.path.realpath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

# Modular imports - initialized by the Entry Point (bspline-frame-builder.py)
frame_engine = None

_active_handler = None

# Standard Logger setup
try:
    from fb_utils import fb_logger as logger
    diag_logger = logger.DebugLogger(parent_dir)
except:
    diag_logger = None

PALETTE_ID = 'frameSketchBuilderPalette'
PALETTE_NAME = 'Sketch Builder'
PALETTE_HTML = 'html/sketch_builder_palette.html'

BUILD_SKETCH_CMD_ID = 'frameSketchBuildCommand'
SCHEMA_PUSH_CMD_ID  = 'frameSketchSchemaPushCommand'
_pending_build_request = None
_pending_schema_style  = None

handlers = []
_doc_activated_handler = None  # Holds DocumentActivated subscription to prevent GC


def _create_hidden_command(cmd_defs, cmd_id, name, handler_class):
    try:
        if cmd_defs.itemById(cmd_id):
            return
        cmd_def = cmd_defs.addButtonDefinition(cmd_id, name, '', '')
        handler = handler_class()
        cmd_def.commandCreated.add(handler)
        handlers.append(handler)
    except:
        pass


def _ensure_hidden_commands(ui):
    """Ensure the hidden bridge commands exist for sketch dispatch + schema push."""
    try:
        cmd_defs = ui.commandDefinitions
        targets = (
            (BUILD_SKETCH_CMD_ID, 'Build Skeleton',  HiddenBuildCommandCreatedHandler),
            (SCHEMA_PUSH_CMD_ID,  'Push Schema',     HiddenSchemaPushCommandCreatedHandler),
        )
        for cmd_id, cmd_name, handler_cls in targets:
            existing = cmd_defs.itemById(cmd_id)
            if existing:
                try:
                    existing.deleteMe()
                except:
                    pass
            _create_hidden_command(cmd_defs, cmd_id, cmd_name, handler_cls)
    except Exception:
        if diag_logger:
            diag_logger.log_error(f"_ensure_hidden_commands FAILED:\n{traceback.format_exc()}")


def _schedule_hidden_build(data, style_id="Template 1"):
    global _pending_build_request
    _pending_build_request = {'data': data, 'style_id': style_id}
    if diag_logger: diag_logger.log(f"DISPATCH: queued sketch build for style '{style_id}'")
    try:
        app = adsk.core.Application.get()
        if not app:
            return
        ui = app.userInterface
        cmd_def = ui.commandDefinitions.itemById(BUILD_SKETCH_CMD_ID)
        if cmd_def:
            cmd_def.execute()
        else:
            if diag_logger: diag_logger.log_error(f"DISPATCH ABORT: '{BUILD_SKETCH_CMD_ID}' not found")
    except:
        if diag_logger: diag_logger.log_error(f"Sketch dispatch failed:\n{traceback.format_exc()}")


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
    except:
        if diag_logger: diag_logger.log_error(f"_schedule_schema_push failed:\n{traceback.format_exc()}")


def _push_schema_direct(style_id="Template 1"):
    """Build the schema, hydrate ReadOnly params with live Fusion values,
    and send render_schema to the palette."""
    try:
        if not frame_engine:
            return

        template_spec = frame_engine.get_template_spec(style_id)
        if not template_spec:
            return

        app = adsk.core.Application.get()
        design = adsk.fusion.Design.cast(app.activeProduct) if app else None
        user_params = design.userParameters if design else None

        def _hydrate_params(raw_params):
            out = []
            w_in = user_params.itemByName('widthIn').value if user_params and user_params.itemByName('widthIn') else 14.0
            h_in = user_params.itemByName('heightIn').value if user_params and user_params.itemByName('heightIn') else 5.0

            for p in raw_params:
                p_live = dict(p)
                p_name = p['Name']

                if user_params:
                    fp = user_params.itemByName(p_name)
                    if fp:
                        raw_val = fp.value
                        if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                            p_live['Val'] = round(raw_val / w_in, 4) if w_in != 0 else p.get('Val', 0)
                        elif p_name in ['TopGap', 'BottomGap',
                                        'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                            p_live['Val'] = round(raw_val / h_in, 4) if h_in != 0 else p.get('Val', 0)
                        elif p_name == 'WaistOffset':
                            p_live['Val'] = round(raw_val / (h_in / 2.0), 4) if h_in != 0 else p.get('Val', 0)
                        else:
                            target_unit = p.get('Unit', 'cm')
                            p_live['Val'] = round(raw_val / 2.54, 4) if target_unit == 'in' else round(raw_val, 4)

                if isinstance(p_live.get('Val'), str) and design:
                    try:
                        eval_val = design.unitsManager.evaluateExpression(p_live['Val'], p.get('Unit', 'cm'))
                        if p_name in ['ShoulderSpan', 'WaistSpan', 'HipSpan']:
                            p_live['Val'] = round(eval_val / w_in, 4) if w_in != 0 else 0.8
                        elif p_name in ['TopGap', 'BottomGap',
                                        'ShoulderRadius', 'WaistRadius', 'HipRadius']:
                            p_live['Val'] = round(eval_val / h_in, 4) if h_in != 0 else 0.15
                        else:
                            p_live['Val'] = round(eval_val, 4)
                    except:
                        pass

                for key in ['Min', 'Max']:
                    if key in p_live and isinstance(p_live[key], str):
                        try:
                            expr = p_live[key]
                            if design:
                                eval_val = design.unitsManager.evaluateExpression(expr, p_live.get('Unit', 'cm'))
                                p_live[key] = round(eval_val, 4)
                        except:
                            pass
                out.append(p_live)
            return out

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

        pal = app.userInterface.palettes.itemById(PALETTE_ID) if app else None
        if pal:
            pal.sendInfoToHTML('render_schema', json.dumps({
                'template':   style_id,
                'sketches':   sketches_out,
                'phase_count': phase_count
            }))
    except Exception:
        if diag_logger: diag_logger.log_error(f"_push_schema_direct FAILED:\n{traceback.format_exc()}")


if diag_logger:
    diag_logger.log("SKETCH BUILDER UI MODULE: Loaded")


class CommandCreatedHandler(adsk.core.CommandCreatedEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        try:
            global frame_engine
            run_palette(frame_engine, diag_logger=diag_logger)
        except Exception as e:
            if diag_logger:
                diag_logger.log_error(f"SketchBuilder CommandCreatedHandler CRASH:\n{traceback.format_exc()}")
            adsk.core.Application.get().userInterface.messageBox(f"Palette Launch Failed:\n{e}")


class PaletteHTMLEventHandler(adsk.core.HTMLEventHandler):
    def __init__(self, diag_logger=None):
        super().__init__()
        self.diag_logger = diag_logger
        self.style_id = None
        self.active_vars = {}

    def notify(self, args):
        try:
            event_args = adsk.core.HTMLEventArgs.cast(args)
            if not event_args: return

            action = event_args.action
            data_str = event_args.data

            if self.diag_logger:
                self.diag_logger.log(f">>> SKETCH UI EVENT: {action} | DATA: {data_str[:100]}...")

            try:
                data = json.loads(data_str)
            except:
                data = {}

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
                if hasattr(self, '_style_id_ref'):
                    self._style_id_ref[0] = self.style_id
                _schedule_schema_push(self.style_id)

            elif action in ('request_template_list', 'get_templates'):
                self._send_template_list(ui.palettes.itemById(PALETTE_ID))

            elif action == 'run_build':
                self._run_sketch_build(data)

            elif action == 'ping':
                self._send_palette_message(ui.palettes.itemById(PALETTE_ID), 'response', {'data': 'PONG'})

        except Exception:
            if self.diag_logger: self.diag_logger.log_error(f"SketchPaletteHTMLEvent ERROR:\n{traceback.format_exc()}")

    def _send_template_list(self, pal):
        try:
            if not pal or not frame_engine:
                return False
            templates = frame_engine.get_available_templates()
            payload = {
                'templates': templates,
                'selected': self.style_id
            }
            return self._send_palette_message(pal, 'template_list', payload)
        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"Template list send failed: {e}")
            return False

    def _update_fusion_param(self, design, name, value):
        try:
            params = design.userParameters
            p = params.itemByName(name)
            if not p:
                try:
                    unit = '' if name.startswith('en_') else 'cm'
                    p = params.add(name, adsk.core.ValueInput.createByReal(0.0), unit, "Sketch Builder Sync")
                except Exception as ex:
                    if self.diag_logger: self.diag_logger.log(f"PARAM SYNC: Failed to create '{name}': {ex}", "ERROR")
                    return

            if p:
                from fb_engine import fb_value_resolver
                importlib.reload(fb_value_resolver)
                resolver = fb_value_resolver.FBValueResolver(design, self.diag_logger)
                expr = resolver.wrap_expression_if_factor(name, value)

                if name.startswith('en_'):
                    expr = str(float(value))

                p.expression = str(expr)
        except Exception as e:
            if self.diag_logger: self.diag_logger.log(f"PARAM SYNC ERROR: {e}")

    def _send_palette_message(self, pal, action, payload):
        try:
            if not pal:
                return False
            pal.sendInfoToHTML(action, json.dumps(payload))
            return True
        except Exception as e:
            if self.diag_logger: self.diag_logger.log_error(f"Palette sendInfoToHTML failed ({action}): {e}")
            return False

    def _run_sketch_build(self, data):
        style_id = data.get('template') or self.style_id
        if self.diag_logger: self.diag_logger.log(f"RUN SKETCH BUILD triggered. Style: {style_id}")
        request_data = dict(data)
        request_data['ui_state'] = self.active_vars
        _schedule_hidden_build(request_data, style_id)


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
            if diag_logger: diag_logger.log_error(f"SketchBuild CommandCreated CRASH:\n{traceback.format_exc()}")


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

            style_id = request.get('style_id', 'Template 1')
            data = request.get('data', {})
            _run_sketch_build_direct(data, style_id)
        except Exception:
            if diag_logger: diag_logger.log_error(f"SketchBuildExecute CRASH:\n{traceback.format_exc()}")


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
            if diag_logger: diag_logger.log_error(f"SketchSchemaPushCreated CRASH:\n{traceback.format_exc()}")


class HiddenSchemaPushExecuteHandler(adsk.core.CommandEventHandler):
    def __init__(self):
        super().__init__()
    def notify(self, args):
        global _pending_schema_style
        style = _pending_schema_style or "Template 1"
        _pending_schema_style = None
        _push_schema_direct(style)


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


def _run_sketch_build_direct(data, style_id):
    transaction = None
    try:
        if diag_logger: diag_logger.log(f"RUN SKETCH BUILD (hidden command). Style: {style_id}")

        max_phase = data.get('max_phase') if isinstance(data, dict) else None
        phase_label = f" · up to phase {max_phase}" if max_phase is not None else ""
        _set_status(f"Building {style_id}{phase_label}…")

        transaction = _start_undo_transaction('Build Skeleton')

        if frame_engine:
            frame_engine.build_sketch_logic_v3(style_id=style_id, external_logger=diag_logger, data=data)
            _commit_undo_transaction(transaction)
            _set_status(f"{style_id} · sketch complete{phase_label}")
            _notify_status("Sketch Build Complete")
            # Auto-close on success
            _close_palette()
        else:
            if diag_logger: diag_logger.log_error("CRITICAL: frame_engine is NOT INJECTED")
            _set_status("Build error: frame engine not loaded — restart add-in")
            _abort_undo_transaction(transaction)
    except Exception as e:
        short = str(e).split('\n')[0][:120]
        _set_status(f"Build failed: {short} — see log")
        if diag_logger: diag_logger.log_error(f"Sketch Build Logic Failed:\n{traceback.format_exc()}")
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


class DocumentActivatedHandler(adsk.core.DocumentEventHandler):
    """Re-pushes the palette schema whenever the user switches active documents."""
    def __init__(self, style_id_ref, diag_logger=None):
        super().__init__()
        self._style_id_ref = style_id_ref
        self.diag_logger = diag_logger

    def notify(self, args):
        try:
            app = adsk.core.Application.get()
            if not app:
                return
            pal = app.userInterface.palettes.itemById(PALETTE_ID)
            if pal and pal.isVisible:
                style = self._style_id_ref[0] if self._style_id_ref else "Template 1"
                _schedule_schema_push(style)
        except Exception:
            if self.diag_logger: self.diag_logger.log_error(f"DocumentActivatedHandler CRASH:\n{traceback.format_exc()}")


def run_palette(engine_instance, diag_logger=None):
    """Central runner to launch the Sketch Builder palette."""
    global frame_engine, _active_handler
    frame_engine = engine_instance
    if diag_logger:
        diag_logger.log(f"sketch run_palette: engine injected = {frame_engine is not None}")

    try:
        app = adsk.core.Application.get()
        ui = app.userInterface

        # 1. Cleanup any old palette
        existing = ui.palettes.itemById(PALETTE_ID)
        if existing:
            existing.deleteMe()

        # 2. Create
        html_path = os.path.join(current_dir, PALETTE_HTML).replace('\\', '/')
        pal = ui.palettes.add(PALETTE_ID, PALETTE_NAME, html_path, True, True, True, 450, 700)
        pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
        pal.setMinimumSize(320, 500)

        # 3. Bridge
        _active_handler = PaletteHTMLEventHandler(diag_logger=diag_logger)
        pal.incomingFromHTML.add(_active_handler)
        pal.handler_anchor = _active_handler
        handlers.append(_active_handler)

        # 3b. Doc switch refresh
        global _doc_activated_handler
        try:
            if _doc_activated_handler:
                app.documentActivated.remove(_doc_activated_handler)
        except Exception:
            pass
        _style_id_ref = [_active_handler.style_id]
        _active_handler._style_id_ref = _style_id_ref

        _doc_activated_handler = DocumentActivatedHandler(_style_id_ref, diag_logger=diag_logger)
        app.documentActivated.add(_doc_activated_handler)
        handlers.append(_doc_activated_handler)

        # 4. Show
        pal.isVisible = True

        # 5. Hidden commands
        _ensure_hidden_commands(ui)

        # 5b. Pick first available template
        try:
            if frame_engine:
                templates = frame_engine.get_available_templates()
                if templates:
                    first_template = templates[0]['value']
                    _active_handler.style_id = first_template
                    _style_id_ref[0] = first_template
        except Exception:
            pass

        # 6. Initial schema push via deferred command
        _schedule_schema_push(_active_handler.style_id)

    except Exception as e:
        if diag_logger:
            diag_logger.log_error(f"FAILURE IN sketch run_palette: {e}\n{traceback.format_exc()}")
        raise e
